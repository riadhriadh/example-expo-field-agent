import type { PermissionName, PermissionState } from 'expo-field-agent';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { REQUIRED, blockers, nativeMissing } from '../src/derive';
import { useRider } from '../src/store';
import { Btn, C, Card, s } from '../src/ui';

/** What the driver actually loses. A red dot with no sentence teaches nothing. */
const COPY: Record<PermissionName, { title: string; loss: string; settingsOnly?: boolean }> = {
  location: {
    title: 'Position précise',
    loss: 'Sans elle, rien ne démarre : le service de suivi refuse de se lancer.',
  },
  backgroundLocation: {
    title: 'Position « Toujours autoriser »',
    loss: 'Sans elle, ta position s’arrête dès que l’écran s’éteint ou que tu ouvres Waze.',
  },
  notifications: {
    title: 'Notifications',
    loss: 'Sans elles, pas de notification de service, donc pas de suivi en arrière-plan, et aucune offre affichée.',
  },
  overlay: {
    title: 'Affichage par-dessus les autres applications',
    loss: 'Pas de bulle pendant la navigation, et l’offre risque de ne pas s’ouvrir seule.',
  },
  fullScreenIntent: {
    title: 'Alertes plein écran',
    loss: 'L’offre arrivera en notification ordinaire : tu devras déverrouiller le téléphone pour la voir.',
  },
  autostart: {
    title: 'Démarrage automatique (réglage constructeur)',
    loss: 'Sans lui, le service ne revient pas après un nettoyage système : tu rates les courses sans le savoir.',
    settingsOnly: true,
  },
  batteryUnrestricted: {
    title: 'Batterie sans restriction',
    loss: 'Le système peut geler le suivi pendant les longues attentes.',
    settingsOnly: true,
  },
  notificationAccess: {
    title: 'Accès aux notifications',
    loss: 'Sert au pont de notifications : sans lui, un push venu d’un système qu’on ne contrôle pas arrive en notification ordinaire au lieu d’ouvrir l’offre en plein écran.',
    settingsOnly: true,
  },
  dndAccess: {
    title: 'Accès « Ne pas déranger »',
    loss: 'En mode Ne pas déranger, l’offre peut arriver sans un son.',
  },
};

const TONE: Record<PermissionState, string> = {
  granted: C.ok,
  denied: C.bad,
  undetermined: C.warn,
  unsupported: C.dim,
};

const LABEL: Record<PermissionState, string> = {
  granted: 'accordée',
  denied: 'refusée',
  undetermined: 'à faire',
  unsupported: 'indisponible',
};

export default function Onboarding() {
  const { perms, refreshPerms, requestPerms, openSetting } = useRider();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // The driver comes back from a system settings screen, so the states are
  // re-read on every return rather than trusted from the first read.
  useFocusEffect(
    useCallback(() => {
      void refreshPerms();
    }, [refreshPerms]),
  );

  const blocked = blockers(perms);
  const entries = Object.entries(perms ?? {}) as [PermissionName, PermissionState][];

  // Sans le module natif, la liste serait vide et « Continuer » grisé sans un mot :
  // le seul message utile ici est celui qui explique comment lancer l'application.
  if (nativeMissing(perms)) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.pad}>
        <Card>
          <Text style={s.h2}>Development build requis</Text>
          <Text style={s.p}>
            Rider repose sur du code natif — service de suivi, bulle flottante, alerte plein écran. Expo Go ne l’embarque
            pas, donc aucune permission n’est même lisible ici.
          </Text>
          <Text style={[s.mono, { paddingTop: 6 }]}>npx expo prebuild{'\n'}npx expo run:android</Text>
          <Text style={[s.p, { paddingTop: 6 }]}>
            Le serveur de développement lancé par « yarn start » sert le même bundle : c’est l’application installée par
            la commande ci-dessus qu’il faut ouvrir, pas Expo Go.
          </Text>
        </Card>
      </ScrollView>
    );
  }

  async function requestAll() {
    setBusy(true);
    try {
      // Asked once and refused is asked no more: the ladder would stop there
      // anyway, and a fatigued refusal is never taken back.
      await requestPerms(perms?.dndAccess === 'denied' ? ['dndAccess'] : []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.p}>
        Dans l’ordre imposé par Android. Les trois premières sont bloquantes ; le démarrage automatique l’est aussi sur
        Xiaomi, Oppo, Vivo et Huawei.
      </Text>

      {entries
        // Hiding beats greying out: a switch that cannot do anything is worse
        // than no switch. What the platform lacks is stated once, below.
        .filter(([, state]) => state !== 'unsupported')
        .map(([name, state]) => (
          <Card key={name}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[s.dot, { backgroundColor: TONE[state] }]} />
              <Text style={[s.h2, { flex: 1 }]}>{COPY[name].title}</Text>
              <Text style={{ color: TONE[state], fontSize: 12, fontWeight: '700' }}>{LABEL[state].toUpperCase()}</Text>
            </View>
            <Text style={s.p}>{COPY[name].loss}</Text>
            {state !== 'granted' ? (
              <Pressable onPress={() => void openSetting(name)} hitSlop={8}>
                <Text style={{ color: C.ok, fontWeight: '700', paddingTop: 4 }}>
                  {COPY[name].settingsOnly ? 'Ouvrir le réglage système' : 'Ouvrir les réglages'}
                </Text>
              </Pressable>
            ) : null}
            {REQUIRED.includes(name) || (name === 'autostart' && state === 'undetermined') ? (
              <Text style={{ color: C.warn, fontSize: 12 }}>Bloquant pour passer en ligne.</Text>
            ) : null}
          </Card>
        ))}

      <Btn label="Tout autoriser" busy={busy} onPress={() => void requestAll()} />

      <Btn
        label={blocked.length ? `${blocked.length} autorisation(s) manquante(s)` : 'Continuer'}
        tone="ghost"
        disabled={blocked.length > 0}
        onPress={() => router.replace('/')}
      />

      {Platform.OS === 'ios' ? (
        <Text style={[s.p, { fontSize: 12 }]}>
          Sur iPhone : pas de bulle flottante (aucune API ne l’autorise), et le suivi ne repart pas seul après un
          redémarrage ou une fermeture forcée. L’offre arrive en notification sensible au temps, pas en plein écran.
        </Text>
      ) : null}
    </ScrollView>
  );
}
