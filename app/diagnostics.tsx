import Constants from 'expo-constants';
import type { PermissionName, PermissionState } from 'expo-field-agent';
import { ScrollView, Text, View } from 'react-native';

import { NATIVE } from '../src/native';
import { useRider, useTrackingPoll } from '../src/store';
import { Btn, C, Card, Row, s } from '../src/ui';

const ago = (at: number | null) => (at === null ? 'jamais' : `il y a ${Math.round((Date.now() - at) / 1000)} s`);

/**
 * La configuration du plugin telle qu'app.json l'a déclarée — c'est le même blob
 * que le natif lit dans le manifeste. Sans elle, un ticket de support commence
 * par trois allers-retours pour savoir quelle URL et quelles cadences tournent.
 */
const PLUGIN = (Constants.expoConfig?.plugins ?? []).find(
  (entry): entry is [string, Record<string, any>] => Array.isArray(entry) && entry[0] === 'expo-field-agent',
)?.[1];

const TONE: Record<PermissionState, string> = {
  granted: C.ok,
  denied: C.bad,
  undetermined: C.warn,
  unsupported: C.dim,
};

export default function Diagnostics() {
  const rider = useRider();
  useTrackingPoll();

  const tracking = rider.tracking;
  const perms = Object.entries(rider.perms ?? {}) as [PermissionName, PermissionState][];

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card>
        <Text style={s.h2}>Service</Text>
        <Row label="running" value={String(tracking?.running ?? '—')} tone={tracking?.running ? C.ok : C.bad} />
        <Row label="queued" value={String(tracking?.queued ?? '—')} tone={(tracking?.queued ?? 0) > 0 ? C.warn : C.ok} />
        <Row label="lastFixAt" value={tracking ? ago(tracking.lastFixAt) : '—'} />
        <Row label="lastSentAt" value={tracking ? ago(tracking.lastSentAt) : '—'} />
        <Row label="lastError" value={tracking?.lastError ?? 'aucune'} tone={tracking?.lastError ? C.bad : C.ok} />
        <Row label="état applicatif" value={rider.service} />
        <Row label="appuis sur la bulle" value={String(rider.bubbleTaps)} />
      </Card>

      <Card>
        <Text style={s.h2}>Permissions</Text>
        {perms.map(([name, state]) => (
          <Row key={name} label={name} value={state} tone={TONE[state]} />
        ))}
      </Card>

      <Card>
        <Text style={s.h2}>Configuration</Text>
        <Row label="version app" value={String(Constants.expoConfig?.version ?? '—')} />
        <Row label="serveur" value={String(PLUGIN?.tracking?.url ?? '—')} />
        <Row label="cadence en course" value={`${PLUGIN?.tracking?.intervalSeconds ?? '—'} s`} />
        <Row label="cadence au repos" value={`${rider.idleSeconds} s (réglage)`} />
        <Row label="filtre de distance" value={`${PLUGIN?.tracking?.distanceFilterMeters ?? '—'} m`} />
        <Row label="battement de cœur" value={`${PLUGIN?.tracking?.heartbeatSeconds ?? '—'} s`} />
        <Row label="plafond de file" value={String(PLUGIN?.tracking?.queueSize ?? '—')} />
        <Row label="TTL de l’alerte" value={`${PLUGIN?.alert?.ttlSeconds ?? '—'} s`} />
        <Row label="son embarqué" value={PLUGIN?.alert?.sound ? 'oui' : 'sonneries système'} />
        <Row label="volume forcé" value={PLUGIN?.alert?.forceVolume === false ? 'non' : `oui (${PLUGIN?.alert?.volumeLevel ?? 1})`} />
        <Row label="pont de notifications" value={PLUGIN?.alert?.notificationBridge ? 'activé' : 'désactivé'} />
      </Card>

      <Btn label="Vider la file maintenant (flush)" tone="warn" onPress={() => void rider.flush()} />
      {NATIVE ? (
        <>
          <Btn label="Tester une alerte plein écran" tone="urgent" onPress={() => void rider.testAlert()} />
          {/* Charge vide, comme le pont : l'offre doit aller la chercher par l'API. */}
          <Btn label="Tester une alerte du pont (sans charge)" tone="ghost" onPress={() => void rider.testAlert(true)} />
        </>
      ) : null}

      <Card>
        <Text style={s.h2}>Derniers événements d’erreur</Text>
        {rider.errors.length === 0 ? <Text style={s.p}>Aucun.</Text> : null}
        {rider.errors.map((error) => (
          <View key={`${error.at}-${error.code}`}>
            <Text style={s.mono}>
              {new Date(error.at).toLocaleTimeString('fr-FR')} · {error.code}
            </Text>
            <Text style={s.p}>{error.message}</Text>
          </View>
        ))}
      </Card>

      <Text style={[s.p, { fontSize: 12 }]}>
        Aucune coordonnée n’est journalisée, ici ni ailleurs : seuls les horodatages sont affichés.
      </Text>
    </ScrollView>
  );
}
