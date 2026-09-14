import { Redirect } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { NEXT, TUNING } from '../src/derive';
import type { Place } from '../src/api';
import { useRider, useTrackingPoll } from '../src/store';
import { Banner, Btn, C, Card, Row, s } from '../src/ui';

/**
 * Waze first, Google Maps as the fallback. `canOpenURL` is not used on purpose:
 * on Android 11+ it answers false for an unlisted scheme, which would need a
 * manifest `<queries>` block — a native edit this app does not make. A failed
 * openURL rejects, and that is the same signal for free.
 */
async function navigate(to: Place) {
  const waze = `waze://?ll=${to.latitude},${to.longitude}&navigate=yes`;
  const maps = `google.navigation:q=${to.latitude},${to.longitude}`;
  const web = `https://waze.com/ul?ll=${to.latitude},${to.longitude}&navigate=yes`;
  try {
    await Linking.openURL(waze);
  } catch {
    await Linking.openURL(maps).catch(() => Linking.openURL(web));
  }
}

export default function Trip() {
  const rider = useRider();
  const [busy, setBusy] = useState(false);
  useTrackingPoll();

  const service = rider.service;
  if (!rider.job || (service !== 'TO_PICKUP' && service !== 'ARRIVED' && service !== 'IN_TRIP')) {
    return <Redirect href="/" />;
  }

  const job = rider.job;
  const step = NEXT[service];
  const target = service === 'IN_TRIP' ? job.dropoff : job.pickup;

  async function advance() {
    setBusy(true);
    try {
      await rider.advance();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[s.screen, s.pad]}>
      <Banner />

      <Card>
        <Text style={s.h1}>Course #{job.id}</Text>
        <Text style={[s.h2, { color: C.warn }]}>{TUNING[service].label}</Text>
        <Row label="Client" value={job.customer} />
        <Row label="Départ" value={job.pickup.label} />
        <Row label="Arrivée" value={job.dropoff.label} />
        <Row label="Distance" value={`${job.distanceKm} km`} />
        <Row label="Course" value={`${job.fare} DT`} tone={C.ok} />
      </Card>

      <Btn
        label={`Naviguer vers ${service === 'IN_TRIP' ? "l'arrivée" : 'le client'}`}
        tone="warn"
        onPress={() => void navigate(target)}
      />
      <Btn label={step.cta} busy={busy} onPress={() => void advance()} />

      <Text style={[s.p, { fontSize: 12 }]}>
        La navigation met Rider en arrière-plan : le suivi continue, c’est exactement le moment où le dispatch a besoin
        de tes positions.
      </Text>
    </View>
  );
}
