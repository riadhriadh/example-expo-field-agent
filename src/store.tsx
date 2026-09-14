import * as FieldAgent from 'expo-field-agent';
import type { PermissionName, Permissions, Position, TrackingState } from 'expo-field-agent';
import { useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';

import arrowIcon from '../assets/bubble-arrow.png';
import passengerIcon from '../assets/bubble-passenger.png';
import pinIcon from '../assets/bubble-pin.png';
import wheelIcon from '../assets/bubble-wheel.png';
import { api, HttpError, login, logout, reauth, restore, type Driver, type Earnings, type Job } from './api';
import { NATIVE } from './native';
import { NEXT, REQUIRED, blockers, bubbleFor, intervalFor, noticeFor, serviceFromStep, type Online, type Service } from './derive';

/**
 * Le glyphe de la bulle suit l'étape, comme sa couleur. Par-dessus Waze, au
 * milieu d'un carrefour, une forme se lit plus vite qu'un mot.
 */
const BUBBLE_IMAGE: Record<Online, number> = {
  IDLE: wheelIcon,
  OFFERED: wheelIcon,
  TO_PICKUP: arrowIcon,
  ARRIVED: pinIcon,
  IN_TRIP: passengerIcon,
};

const SOUND_KEY = 'rider.sound';
const IDLE_KEY = 'rider.idle';

type LoggedError = { at: number; code: string; message: string };

type State = {
  ready: boolean;
  driver: Driver | null;
  service: Service;
  job: Job | null;
  shiftId: string | null;
  perms: Permissions | null;
  tracking: TrackingState | null;
  last: Position | null;
  /** showBubble() has answered true at least once — the only honest gate for bubble UI. */
  bubbleUsable: boolean;
  bubbleOn: boolean;
  bubbleTaps: number;
  permissionLost: boolean;
  syncedAt: number | null;
  errors: LoggedError[];
  earnings: Earnings | null;
  idleSeconds: number;
  sound: boolean;
};

type Action =
  | { type: 'boot'; driver: Driver | null; service: Service; job: Job | null; perms: Permissions; idleSeconds: number; sound: boolean }
  | { type: 'driver'; driver: Driver | null }
  | { type: 'perms'; perms: Permissions }
  | { type: 'online'; shiftId: string | null; bubbleUsable: boolean }
  | { type: 'offline' }
  | { type: 'offered' }
  | { type: 'idle' }
  | { type: 'job'; job: Job; service: Service }
  | { type: 'tracking'; tracking: TrackingState }
  | { type: 'position'; position: Position }
  | { type: 'sent'; queued: number }
  | { type: 'unsync' }
  | { type: 'error'; code: string; message: string }
  | { type: 'earnings'; earnings: Earnings }
  | { type: 'settings'; idleSeconds?: number; sound?: boolean }
  | { type: 'bubble'; on: boolean }
  | { type: 'tap' };

const initial: State = {
  ready: false,
  driver: null,
  service: 'OFFLINE',
  job: null,
  shiftId: null,
  perms: null,
  tracking: null,
  last: null,
  bubbleUsable: false,
  bubbleOn: false,
  bubbleTaps: 0,
  permissionLost: false,
  syncedAt: null,
  errors: [],
  earnings: null,
  idleSeconds: 20,
  sound: true,
};

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'boot':
      return { ...s, ready: true, driver: a.driver, service: a.service, job: a.job, perms: a.perms, idleSeconds: a.idleSeconds, sound: a.sound };
    case 'driver':
      return a.driver ? { ...s, driver: a.driver } : { ...initial, ready: true, perms: s.perms };
    case 'perms':
      return { ...s, perms: a.perms, permissionLost: REQUIRED.some((name) => a.perms[name] !== 'granted') };
    case 'online':
      return { ...s, service: 'IDLE', shiftId: a.shiftId, bubbleUsable: s.bubbleUsable || a.bubbleUsable, bubbleOn: a.bubbleUsable };
    case 'offline':
      return { ...s, service: 'OFFLINE', job: null, shiftId: null, bubbleOn: false, last: null };
    // An offer only ever interrupts waiting. A stray alert during a trip must
    // not rewrite the step the driver is actually in.
    case 'offered':
      return s.service === 'IDLE' ? { ...s, service: 'OFFERED' } : s;
    case 'idle':
      return { ...s, service: 'IDLE', job: null };
    case 'job':
      return { ...s, job: a.job, service: a.service };
    case 'tracking':
      return { ...s, tracking: a.tracking };
    case 'position':
      return { ...s, last: a.position };
    case 'sent':
      return { ...s, syncedAt: Date.now(), tracking: s.tracking ? { ...s.tracking, queued: a.queued } : s.tracking };
    case 'unsync':
      return { ...s, syncedAt: null };
    case 'error':
      return {
        ...s,
        permissionLost: a.code === 'PERMISSION' ? true : s.permissionLost,
        errors: [{ at: Date.now(), code: a.code, message: a.message }, ...s.errors].slice(0, 20),
      };
    case 'earnings':
      return { ...s, earnings: a.earnings };
    case 'settings':
      return { ...s, idleSeconds: a.idleSeconds ?? s.idleSeconds, sound: a.sound ?? s.sound };
    case 'bubble':
      return { ...s, bubbleOn: a.on, bubbleUsable: s.bubbleUsable || a.on };
    case 'tap':
      return { ...s, bubbleTaps: s.bubbleTaps + 1 };
  }
}

function confirm(title: string, message: string, ok: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
        { text: ok, style: 'destructive', onPress: () => resolve(true) },
      ],
      { onDismiss: () => resolve(false) },
    );
  });
}

function actionsFor(state: () => State, dispatch: (a: Action) => void) {
  async function refreshEarnings(): Promise<void> {
    const earnings = await api<Earnings>('/api/earnings/today').catch(() => null);
    if (earnings) dispatch({ type: 'earnings', earnings });
  }

  async function refreshTracking(): Promise<void> {
    dispatch({ type: 'tracking', tracking: await FieldAgent.getState() });
  }

  async function refreshPerms(): Promise<void> {
    dispatch({ type: 'perms', perms: await FieldAgent.getPermissions() });
  }

  async function goOffline(): Promise<void> {
    const { job, shiftId } = state();
    if (job) {
      const ok = await confirm(
        'Course en cours',
        `Le client de la course #${job.id} est encore en charge. Passer hors ligne maintenant est un incident, pas un état.`,
        'Passer hors ligne',
      );
      if (!ok) return;
    }
    // Le serveur renvoie un récapitulatif ; l'ignorer serait laisser le chauffeur
    // terminer sa journée sans savoir ce qu'elle a donné.
    const ended = await api<{ summary?: { trips: number; total: number } }>('/api/shifts/end', {
      method: 'POST',
      body: JSON.stringify({ shiftId, abandonedJobId: job?.id ?? null }),
    }).catch(() => null);
    if (NATIVE) await FieldAgent.stop();
    await FieldAgent.hideBubble();
    dispatch({ type: 'offline' });
    if (ended?.summary) {
      Alert.alert('Service terminé', `${ended.summary.trips} course(s) · ${ended.summary.total} DT`);
    }
  }

  async function flush(): Promise<void> {
    await FieldAgent.flush().catch(() => {});
    await refreshTracking();
  }

  let lastReauth = 0;

  async function report(code: string, message: string): Promise<void> {
    dispatch({ type: 'error', code, message });
    // The plugin never drops a 401/403 point, so nothing is lost yet — but the
    // queue keeps growing until someone renews the token and hands it back.
    // Only JavaScript can do that, and only on this signal.
    if ((code === 'HTTP_401' || code === 'HTTP_403') && Date.now() - lastReauth > 30_000) {
      lastReauth = Date.now();
      if (await reauth()) await flush();
    }
  }

  return {
    refreshEarnings,
    refreshTracking,
    refreshPerms,
    goOffline,
    flush,
    report,

    async signIn(phone: string, password: string): Promise<void> {
      const driver = await login(phone, password);
      dispatch({ type: 'driver', driver });
      await refreshPerms();
    },

    async signOut(): Promise<void> {
      if (state().service !== 'OFFLINE') await goOffline();
      await logout();
      dispatch({ type: 'driver', driver: null });
    },

    async requestPerms(skip: PermissionName[] = []): Promise<void> {
      dispatch({ type: 'perms', perms: await FieldAgent.requestPermissions({ skip }) });
    },

    openSetting(which: PermissionName): Promise<void> {
      return NATIVE ? FieldAgent.openSettings(which) : Promise.resolve();
    },

    /** Returns what still blocks, or null once the service is running. */
    async goOnline(): Promise<PermissionName[] | null> {
      const perms = await FieldAgent.getPermissions();
      dispatch({ type: 'perms', perms });
      // Dans Expo Go il n'y a rien a autoriser : le plugin rend tout
      // `unsupported`, donc le ladder renverrait les trois requises sans fin.
      const blocked = NATIVE ? blockers(perms) : [];
      if (blocked.length) return blocked;

      if (NATIVE) await FieldAgent.start({ intervalSeconds: state().idleSeconds });
      const bubbleUsable = await FieldAgent.showBubble();
      // The shift is bookkeeping; the positions are the job. A flaky network
      // must not keep the driver offline.
      const shift = await api<{ shiftId: string }>('/api/shifts/start', { method: 'POST' }).catch(() => null);
      dispatch({ type: 'online', shiftId: shift?.shiftId ?? null, bubbleUsable });
      void refreshEarnings();
      await refreshTracking();
      return null;
    },

    /**
     * Accepting is a race, not a certainty. Whatever the server answers, the
     * ringtone has to stop — a screen still shouting after a lost race reads as
     * a crash.
     */
    async accept(jobId: string, dismiss: () => Promise<void>): Promise<void> {
      try {
        const out = await api<{ job: Job }>(`/api/jobs/${jobId}/accept`, { method: 'POST' });
        dispatch({ type: 'job', job: out.job, service: serviceFromStep(out.job.step) });
      } catch (error) {
        const reason =
          error instanceof HttpError && error.status === 409
            ? error.payload?.reason === 'expired'
              ? "L'offre a expiré avant ta réponse."
              : 'Un autre chauffeur a pris la course.'
            : "Réseau indisponible : la course n'a pas pu être confirmée.";
        dispatch({ type: 'idle' });
        Alert.alert('Course non attribuée', reason);
      } finally {
        await dismiss();
      }
    },

    async decline(jobId: string, dismiss: () => Promise<void>): Promise<void> {
      dispatch({ type: 'idle' });
      await dismiss();
      await api(`/api/jobs/${jobId}/decline`, { method: 'POST' }).catch(() => {});
    },

    async expire(dismiss: () => Promise<void>): Promise<void> {
      dispatch({ type: 'idle' });
      await dismiss();
    },

    async advance(): Promise<void> {
      const { service, job } = state();
      if (!job || (service !== 'TO_PICKUP' && service !== 'ARRIVED' && service !== 'IN_TRIP')) return;
      const next = NEXT[service];
      await api(`/api/jobs/${job.id}/step`, { method: 'POST', body: JSON.stringify({ step: next.step }) });
      if (next.step === 'completed') {
        dispatch({ type: 'idle' });
        void refreshEarnings();
      } else {
        dispatch({ type: 'job', job: { ...job, step: next.step }, service: next.then });
      }
    },

    async setSound(sound: boolean): Promise<void> {
      dispatch({ type: 'settings', sound });
      if (NATIVE) await FieldAgent.setAlertSound(sound);
      await SecureStore.setItemAsync(SOUND_KEY, String(sound));
    },

    async setIdleSeconds(idleSeconds: number): Promise<void> {
      dispatch({ type: 'settings', idleSeconds });
      await SecureStore.setItemAsync(IDLE_KEY, String(idleSeconds));
    },

    async toggleBubble(on: boolean): Promise<void> {
      if (!on) {
        await FieldAgent.hideBubble();
        dispatch({ type: 'bubble', on: false });
        return;
      }
      dispatch({ type: 'bubble', on: await FieldAgent.showBubble() });
    },

    /**
     * `bridged` reproduit ce que le pont de notifications livre réellement : un
     * titre, un texte, et rien d'autre. C'est le seul moyen d'exercer ce chemin
     * sans un projet Firebase et un émetteur qu'on ne contrôle pas.
     */
    testAlert(bridged = false): Promise<void> {
      if (!NATIVE) return Promise.resolve();
      if (bridged) {
        return FieldAgent.triggerAlert({
          title: 'Nouvelle course',
          body: 'Arrivée par le pont de notifications',
          data: { source: 'notificationBridge' },
        });
      }
      return FieldAgent.triggerAlert({
        title: 'Nouvelle course',
        body: 'Test depuis le diagnostic',
        data: {
          jobId: 'TEST',
          ttl: 30,
          pickup: { label: 'Test — départ', latitude: 36.8065, longitude: 10.1815 },
          dropoff: { label: 'Test — arrivée', latitude: 36.8465, longitude: 10.2015 },
          fare: 12,
          distanceKm: 3.2,
        },
      });
    },
  };
}

export type Rider = State & ReturnType<typeof actionsFor>;

const Ctx = createContext<Rider>(null as unknown as Rider);

export function useRider(): Rider {
  return useContext(Ctx);
}

export function RiderProvider({ children }: { children: ReactNode }): ReactNode {
  const [s, dispatch] = useReducer(reducer, initial);
  const snapshot = useRef(s);
  snapshot.current = s;

  const actions = useMemo(() => actionsFor(() => snapshot.current, dispatch), []);

  // Rebuilt from the plugin and the server, never from what JS remembered: the
  // process may have been killed mid-trip, or the phone rebooted with the
  // service back up on its own.
  useEffect(() => {
    void (async () => {
      const [driver, running, perms, sound, idle] = await Promise.all([
        restore().catch(() => null),
        FieldAgent.isRunning(),
        FieldAgent.getPermissions(),
        SecureStore.getItemAsync(SOUND_KEY).catch(() => null),
        SecureStore.getItemAsync(IDLE_KEY).catch(() => null),
      ]);
      const job = driver ? await api<Job | null>('/api/jobs/active').catch(() => null) : null;
      // Read synchronously, not awaited as an event: when the full-screen alert
      // is what started the engine, the event fired long before this listener.
      const pending = FieldAgent.getPendingAlertSync();
      const service: Service = !running ? 'OFFLINE' : job ? serviceFromStep(job.step) : pending ? 'OFFERED' : 'IDLE';
      dispatch({
        type: 'boot',
        driver,
        service,
        job,
        perms,
        sound: sound !== 'false',
        idleSeconds: Number(idle) || initial.idleSeconds,
      });
      if (sound === 'false' && NATIVE) await FieldAgent.setAlertSound(false);
      if (running) await actions.refreshTracking();
      if (driver) void actions.refreshEarnings();
    })();
  }, [actions]);

  useEffect(() => {
    const subs = [
      FieldAgent.addListener('position', (position) => dispatch({ type: 'position', position })),
      FieldAgent.addListener('sent', ({ queued }) => dispatch({ type: 'sent', queued })),
      FieldAgent.addListener('error', ({ code, message }) => void actions.report(code, message)),
      FieldAgent.addListener('alert', () => dispatch({ type: 'offered' })),
      // Measured, never navigated from: this can fire before the router exists.
      FieldAgent.addListener('bubblePress', () => dispatch({ type: 'tap' })),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, [actions]);

  // Navigating in Waze puts this app in the background — that is exactly when
  // the server needs the positions most. Nothing here ever calls stop().
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void (async () => {
        await actions.refreshPerms();
        if (snapshot.current.service === 'OFFLINE') return;
        await actions.flush();
        // An offer may have landed while the app was in the background.
        const pending = await FieldAgent.getPendingAlert();
        if (pending) dispatch({ type: 'offered' });
        // The full-screen alert hosts its own React tree, so an offer answered
        // from there is only known to the server. And an offer whose TTL ran out
        // while nothing was mounted to count it down would strand the app in
        // OFFERED for ever. The server is the arbiter on every return.
        const active = await api<Job | null>('/api/jobs/active').catch(() => undefined);
        if (active) dispatch({ type: 'job', job: active, service: serviceFromStep(active.step) });
        else if (active === null && !pending) dispatch({ type: 'idle' });
      })();
    });
    return () => sub.remove();
  }, [actions]);

  const backlog = (s.tracking?.queued ?? 0) > 0;

  const jobId = s.job?.id ?? null;

  useEffect(() => {
    const seconds = intervalFor(s.service, s.idleSeconds);
    if (seconds !== null && NATIVE) void FieldAgent.setInterval(seconds);

    const bubble = bubbleFor(s.service, backlog ? 1 : 0, s.permissionLost);
    if (bubble) void FieldAgent.setBubbleState(bubble[0], bubble[1]);
    if (s.service !== 'OFFLINE') void FieldAgent.setBubbleImage(BUBBLE_IMAGE[s.service]);

    // `setStrings` est persisté nativement : après un redémarrage, le service
    // reprend le dernier texte connu, même sans JavaScript pour le lui redire.
    // C'est voulu — et c'est pourquoi cet effet tourne aussi au boot, pour le
    // corriger si la course s'est terminée entre-temps.
    const notice = noticeFor(s.service, jobId);
    if (notice) void FieldAgent.setStrings({ serviceTitle: notice.title, serviceBody: notice.body });
  }, [s.service, s.idleSeconds, backlog, s.permissionLost, jobId]);

  useEffect(() => {
    if (!s.syncedAt) return;
    const id = setTimeout(() => dispatch({ type: 'unsync' }), 3000);
    return () => clearTimeout(id);
  }, [s.syncedAt]);

  const value = useMemo(() => ({ ...s, ...actions }), [s, actions]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** getState() is polled only while a screen that shows it is actually visible. */
export function useTrackingPoll(): void {
  const { refreshTracking } = useRider();
  useFocusEffect(
    useCallback(() => {
      void refreshTracking();
      const id = setInterval(() => void refreshTracking(), 5000);
      return () => clearInterval(id);
    }, [refreshTracking]),
  );
}
