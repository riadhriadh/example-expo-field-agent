import type { BubbleState, PermissionName, Permissions, TrackingState } from 'expo-field-agent';

/**
 * The single service state. Everything the plugin is told — cadence, bubble,
 * which screen is shown — is derived from it here, so a transition can never
 * update one half of the pair and forget the other.
 */
export type Service = 'OFFLINE' | 'IDLE' | 'OFFERED' | 'TO_PICKUP' | 'ARRIVED' | 'IN_TRIP';
export type Step = 'arrived' | 'started' | 'completed';
export type Online = Exclude<Service, 'OFFLINE'>;

export const TUNING: Record<Online, { interval: number; bubble: [BubbleState, string]; label: string }> = {
  IDLE: { interval: 20, bubble: ['ok', 'En ligne'], label: 'En ligne — en attente de course' },
  OFFERED: { interval: 20, bubble: ['urgent', 'Nouvelle course'], label: 'Nouvelle course proposée' },
  TO_PICKUP: { interval: 5, bubble: ['warn', 'Vers le client'], label: 'en route' },
  ARRIVED: { interval: 10, bubble: ['warn', 'Sur place'], label: 'sur place' },
  IN_TRIP: { interval: 5, bubble: ['ok', 'Course en cours'], label: 'en cours' },
};

/** Only these three come after a completed step; the rest are user-driven. */
export const NEXT: Record<'TO_PICKUP' | 'ARRIVED' | 'IN_TRIP', { step: Step; then: Service; cta: string }> = {
  TO_PICKUP: { step: 'arrived', then: 'ARRIVED', cta: 'Je suis arrivé' },
  ARRIVED: { step: 'started', then: 'IN_TRIP', cta: 'Démarrer la course' },
  IN_TRIP: { step: 'completed', then: 'IDLE', cta: 'Terminer la course' },
};

export const TRIP_STATES: Service[] = ['TO_PICKUP', 'ARRIVED', 'IN_TRIP'];

/**
 * Le texte de la notification permanente de service. Jusqu'à la 1.2.0 il était
 * figé au build et l'application ne pouvait pas le faire suivre l'étape ;
 * `setStrings` (1.3.0) le rend réglable à chaud, donc la notification dit
 * maintenant la même chose que la bulle et que l'écran.
 */
export function noticeFor(service: Service, jobId: string | null): { title: string; body: string } | null {
  const reference = jobId ? `Course #${jobId}` : 'En service';
  switch (service) {
    case 'OFFLINE':
      return null;
    case 'IDLE':
    case 'OFFERED':
      return { title: 'En ligne', body: 'En attente de course.' };
    case 'TO_PICKUP':
      return { title: reference, body: 'En route vers le client.' };
    case 'ARRIVED':
      return { title: reference, body: 'Sur place, en attente du client.' };
    case 'IN_TRIP':
      return { title: reference, body: 'Course en cours.' };
  }
}

/**
 * A queue that is filling up and a permission that was revoked are worth more
 * on the bubble than the step itself: the step is visible in the app, the
 * failure is not.
 */
export function bubbleFor(service: Service, queued: number, permissionLost: boolean): [BubbleState, string] | null {
  if (service === 'OFFLINE') return null;
  if (permissionLost) return ['bad', 'Localisation coupée'];
  if (queued > 0) return ['warn', 'Hors réseau'];
  return TUNING[service].bubble;
}

/** The waiting cadence is a setting; the others are fixed by the step. */
export function intervalFor(service: Service, idleSeconds: number): number | null {
  if (service === 'OFFLINE') return null;
  if (service === 'IDLE' || service === 'OFFERED') return idleSeconds;
  return TUNING[service].interval;
}

export function serviceFromStep(step: Step | null | undefined): Service {
  if (step === 'started') return 'IN_TRIP';
  if (step === 'arrived') return 'ARRIVED';
  return 'TO_PICKUP';
}

/**
 * Counted from the instant the native side accepted the alert, never from the
 * mount: the full-screen activity has to boot the React Native engine first,
 * which costs two to four seconds on a low-end phone.
 */
export function remainingMs(receivedAt: number, ttlSeconds: number, now: number): number {
  return ttlSeconds * 1000 - (now - receivedAt);
}

/**
 * Expo Go n'embarque aucun module natif : le plugin rend alors *toutes* les
 * permissions en `unsupported`. Sur un vrai build, `location` et `notifications`
 * ne le sont jamais, y compris sur iOS — d'où le « toutes » plutôt qu'un échantillon.
 */
export function nativeMissing(perms: Permissions | null): boolean {
  return perms !== null && Object.values(perms).every((state) => state === 'unsupported');
}

/** Tracking cannot even start without these three. */
export const REQUIRED: PermissionName[] = ['location', 'backgroundLocation', 'notifications'];

/**
 * What still blocks going online. `autostart` counts only when the plugin says
 * `undetermined`: on MIUI, ColorOS, FunTouch and EMUI the service never comes
 * back after a system clean without it, and no API can read or grant it — the
 * plugin marks it granted once the user has been through the screen. Brands
 * with no such screen report `unsupported`, which blocks nothing.
 */
export function blockers(perms: Permissions | null): PermissionName[] {
  if (!perms) return REQUIRED;
  const out = REQUIRED.filter((name) => perms[name] !== 'granted');
  if (perms.autostart === 'undetermined') out.push('autostart');
  return out;
}

/** A full queue is a tunnel. A dead service or a stale fix is the real outage. */
export function serviceLost(tracking: TrackingState | null, now: number): boolean {
  if (!tracking) return false;
  if (!tracking.running) return true;
  return tracking.lastFixAt !== null && now - tracking.lastFixAt > 10 * 60 * 1000;
}
