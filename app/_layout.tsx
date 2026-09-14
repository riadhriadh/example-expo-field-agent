// Imported for its side effects: the push task must be defined at bundle
// evaluation, because on Android the headless JS run has no screens at all.
import '../src/push';

import { AlertHost } from 'expo-field-agent';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TRIP_STATES } from '../src/derive';
import { Offer } from '../src/offer';
import { RiderProvider, useRider } from '../src/store';
import { C } from '../src/ui';

/**
 * L'offre est un Modal au-dessus de l'écran courant : accepter depuis les
 * Réglages ou le Diagnostic y laissait le chauffeur, avec la seule bulle pour
 * dire qu'une course tournait. L'entrée en course mène à la course, d'où qu'on
 * vienne. En sortir est déjà traité par l'écran de course lui-même.
 */
function TripRoute() {
  const { service } = useRider();
  const router = useRouter();
  const onTrip = TRIP_STATES.includes(service);

  useEffect(() => {
    if (onTrip) router.replace('/trip');
  }, [onTrip, router]);

  return null;
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <RiderProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: C.bg },
            headerTintColor: C.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: C.bg },
          }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ title: 'Autorisations' }} />
          <Stack.Screen name="trip" options={{ title: 'Course en cours', headerBackVisible: false }} />
          <Stack.Screen name="history" options={{ title: 'Historique et gains' }} />
          <Stack.Screen name="settings" options={{ title: 'Réglages' }} />
          <Stack.Screen name="diagnostics" options={{ title: 'Diagnostic' }} />
        </Stack>

        {/*
          Mounted once, above the router. It reads the pending alert
          synchronously at its first render, which is the only thing that works
          when the full-screen activity is what started this process.
        */}
        <AlertHost dismissOnBack={false} render={(alert, actions) => <Offer alert={alert} dismiss={actions.dismiss} />} />
        <TripRoute />
      </RiderProvider>
    </SafeAreaProvider>
  );
}
