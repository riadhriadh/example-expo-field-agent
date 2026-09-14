import Constants from 'expo-constants';
import type { Position } from 'expo-field-agent';
import { Link, Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TRIP_STATES, TUNING, blockers } from '../src/derive';
import { NATIVE } from '../src/native';
import { useRider, useTrackingPoll } from '../src/store';
import { Banner, Btn, C, Card, Row, s } from '../src/ui';

const TUNIS = { latitude: 36.8065, longitude: 10.1815, latitudeDelta: 0.06, longitudeDelta: 0.06 };

/**
 * Google Maps kills the process outright when the API key meta-data is absent —
 * it does not fall back to grey tiles. Apple Maps needs no key. So the map is
 * mounted only where it can actually work, and everywhere else the same fix is
 * shown as text instead of taking the whole app down with it.
 */
const MAP_USABLE = Platform.OS === 'ios' || !!Constants.expoConfig?.android?.config?.googleMaps?.apiKey;

function NoMap({ last }: { last: Position | null }) {
  return (
    <View style={[{ flex: 1, justifyContent: 'center' }, s.pad]}>
      <Card>
        <Text style={s.h2}>Carte désactivée</Text>
        <Text style={s.p}>
          Aucune clé Google Maps n’est configurée ({'android.config.googleMaps.apiKey'} dans app.json). Le suivi, lui,
          tourne : voici la dernière position reçue du service.
        </Text>
        <Row label="Latitude" value={last ? last.latitude.toFixed(5) : '—'} />
        <Row label="Longitude" value={last ? last.longitude.toFixed(5) : '—'} />
        <Row label="Vitesse" value={last ? `${Math.max(0, Math.round(last.speed * 3.6))} km/h` : '—'} />
        <Row label="Précision" value={last ? `±${Math.round(last.accuracy)} m` : '—'} />
        <Row label="Relevé à" value={last ? new Date(last.timestamp).toLocaleTimeString('fr-FR') : '—'} />
      </Card>
    </View>
  );
}

export default function Home() {
  const rider = useRider();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  useTrackingPoll();

  if (!rider.ready) {
    return (
      <View style={[s.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={C.ok} />
      </View>
    );
  }
  if (!rider.driver) return <Redirect href="/login" />;
  // Expo Go n'a aucune permission a accorder : y renvoyer serait une boucle.
  if (NATIVE && rider.service === 'OFFLINE' && blockers(rider.perms).length > 0)
    return <Redirect href="/onboarding" />;
  // Killed mid-trip, or rebooted with the service back up: the driver comes
  // back to the trip, not to a home screen that forgot the client.
  if (TRIP_STATES.includes(rider.service)) return <Redirect href="/trip" />;

  const online = rider.service !== 'OFFLINE';
  const label = rider.service === 'OFFLINE' ? 'Hors ligne' : TUNING[rider.service].label;

  async function toggle() {
    setBusy(true);
    try {
      if (!online) {
        const blocked = await rider.goOnline();
        if (blocked) router.push('/onboarding');
      } else {
        await rider.goOffline();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.screen}>
      {MAP_USABLE ? (
        <MapView
          style={{ flex: 1 }}
          initialRegion={TUNIS}
          region={
            rider.last
              ? { latitude: rider.last.latitude, longitude: rider.last.longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 }
              : undefined
          }>
          {rider.last ? (
            <Marker
              coordinate={{ latitude: rider.last.latitude, longitude: rider.last.longitude }}
              title={rider.driver.name}
              description={`${Math.max(0, Math.round(rider.last.speed * 3.6))} km/h · ±${Math.round(rider.last.accuracy)} m`}
              pinColor={online ? C.ok : C.dim}
            />
          ) : null}
        </MapView>
      ) : (
        <NoMap last={rider.last} />
      )}

      <View style={[s.pad, { paddingBottom: insets.bottom + 16 }]}>
        <Banner />

        <Card>
          <Row label="État" value={label} tone={online ? C.ok : C.dim} />
          <Row label="Gains du jour" value={`${rider.earnings?.total ?? 0} DT`} />
          <Row label="Courses" value={String(rider.earnings?.trips.length ?? 0)} />
        </Card>

        <Btn
          label={online ? 'Passer hors ligne' : 'Passer en ligne'}
          tone={online ? 'bad' : 'ok'}
          busy={busy}
          onPress={() => void toggle()}
        />

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 4 }}>
          <Link href="/history" style={s.link}>
            Historique
          </Link>
          <Link href="/settings" style={s.link}>
            Réglages
          </Link>
          <Link href="/diagnostics" style={s.link}>
            Diagnostic
          </Link>
        </View>
      </View>
    </View>
  );
}
