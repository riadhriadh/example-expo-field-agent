import type { AlertPayload } from 'expo-field-agent';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { api, type Job, type Place } from './api';
import { remainingMs } from './derive';
import { useRider } from './store';
import { Btn, C, Card, Row, s } from './ui';

/** Kept equal to `alert.ttlSeconds` in app.json: the native ringtone runs on that value. */
const FALLBACK_TTL = 45;

/** Ce que le serveur rend quand l'alerte n'a pas pu porter la course elle-même. */
type PendingOffer = Job & { remainingSeconds: number };

export function Offer({ alert, dismiss }: { alert: AlertPayload; dismiss: () => Promise<void> }) {
  const { accept, decline, expire } = useRider();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  // Le pont de notifications ne transporte que le titre et le texte : la table
  // `data` d'un message FCM ne survit pas à la notification qu'Android a déjà
  // posée. La course se retrouve alors par l'API, jamais devinée.
  const bridged = alert.data?.source === 'notificationBridge';
  const [remote, setRemote] = useState<{ offer: PendingOffer; deadline: number } | null>(null);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    if (!bridged) return;
    // La date limite est ancrée sur l'instant de la réponse, pas sur une heure
    // envoyée par le serveur : deux horloges qui divergent fausseraient le
    // compte à rebours, et c'est lui que le chauffeur regarde.
    void api<PendingOffer | null>('/api/jobs/offer')
      .then((offer) =>
        offer ? setRemote({ offer, deadline: Date.now() + offer.remainingSeconds * 1000 }) : setLost(true),
      )
      .catch(() => setLost(true));
  }, [bridged]);

  const ttlMs = bridged ? (remote?.offer.remainingSeconds ?? 0) * 1000 : Number(alert.data?.ttl ?? FALLBACK_TTL) * 1000;
  // Compté depuis l'instant où le natif a accepté l'alerte, jamais depuis le
  // montage : l'activité plein écran doit d'abord démarrer le moteur React
  // Native, deux à quatre secondes sur un téléphone d'entrée de gamme.
  const left = bridged
    ? remote
      ? remote.deadline - now
      : Number.POSITIVE_INFINITY
    : remainingMs(alert.receivedAt, ttlMs / 1000, now);
  const spent = lost || left <= 0;

  useEffect(() => {
    if (spent) {
      void expire(dismiss);
      return;
    }
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [spent, dismiss, expire]);

  // Déjà partie avant le premier rendu : rien à montrer, et l'alerte est
  // relâchée plutôt que laissée à sonner jusqu'à son TTL.
  if (spent) return null;

  const waiting = bridged && !remote;
  const pickup = (bridged ? remote?.offer.pickup : (alert.data?.pickup as Place | undefined)) ?? undefined;
  const dropoff = (bridged ? remote?.offer.dropoff : (alert.data?.dropoff as Place | undefined)) ?? undefined;
  const customer = bridged ? remote?.offer.customer : alert.data?.customer;
  const fare = bridged ? remote?.offer.fare : alert.data?.fare;
  const distance = bridged ? remote?.offer.distanceKm : alert.data?.distanceKm;
  const jobId = String(alert.data?.jobId ?? remote?.offer.id ?? '');

  async function answer(action: (jobId: string, dismiss: () => Promise<void>) => Promise<void>) {
    setBusy(true);
    try {
      await action(jobId, dismiss);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[s.screen, { justifyContent: 'center', padding: 20, gap: 18 }]}>
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Text style={[s.h2, { color: C.urgent, letterSpacing: 1 }]}>NOUVELLE COURSE</Text>
        {waiting ? (
          <ActivityIndicator color={C.urgent} size="large" style={{ height: 86 }} />
        ) : (
          <Text style={{ color: C.text, fontSize: 72, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
            {Math.ceil(left / 1000)}
          </Text>
        )}
        <View style={{ height: 6, width: '100%', backgroundColor: C.line, borderRadius: 3, overflow: 'hidden' }}>
          <View
            style={{
              height: 6,
              backgroundColor: C.urgent,
              width: `${waiting ? 100 : Math.max(0, Math.min(100, (left / ttlMs) * 100))}%`,
            }}
          />
        </View>
      </View>

      <Card>
        <Row label="Client" value={typeof customer === 'string' ? customer : waiting ? '…' : '—'} />
        <Row label="Départ" value={pickup?.label ?? (waiting ? '…' : '—')} />
        <Row label="Arrivée" value={dropoff?.label ?? (waiting ? '…' : '—')} />
        <Row label="Distance" value={distance ? `${distance} km` : waiting ? '…' : '—'} />
        <Row label="Prix estimé" value={fare ? `${fare} DT` : waiting ? '…' : '—'} tone={C.ok} />
      </Card>

      <View style={{ gap: 10 }}>
        {/* Accepter sans identifiant de course enverrait le chauffeur dans le vide. */}
        <Btn label="Accepter" tone="ok" busy={busy} disabled={!jobId} onPress={() => void answer(accept)} />
        <Btn label="Refuser" tone="ghost" disabled={busy} onPress={() => void answer(decline)} />
      </View>
    </View>
  );
}
