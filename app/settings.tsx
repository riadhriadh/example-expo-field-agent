import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';

import { NATIVE } from '../src/native';
import { useRider } from '../src/store';
import { Btn, C, Card, Row, s } from '../src/ui';

const CADENCES = [10, 20, 60];

export default function Settings() {
  const rider = useRider();
  const router = useRouter();

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card>
        <Row label="Chauffeur" value={rider.driver?.name ?? '—'} />
        <Row label="Téléphone" value={rider.driver?.phone ?? '—'} />
      </Card>

      {NATIVE ? (
      <Card>
        <View style={s.row}>
          <Text style={[s.h2, { flex: 1 }]}>Son des offres</Text>
          <Switch
            value={rider.sound}
            onValueChange={(value) => void rider.setSound(value)}
            trackColor={{ true: C.ok, false: C.line }}
          />
        </View>
        <Text style={s.p}>
          Coupé, l’offre n’émet aucun son et le volume d’alarme n’est pas touché. L’écran s’allume quand même.
        </Text>
      </Card>
      ) : null}

      <Card>
        <Text style={s.h2}>Cadence en attente</Text>
        <Text style={s.p}>Fréquence d’envoi entre deux courses. En course, elle passe à 5 s automatiquement.</Text>
        <View style={{ flexDirection: 'row', gap: 8, paddingTop: 4 }}>
          {CADENCES.map((seconds) => (
            <Pressable
              key={seconds}
              onPress={() => void rider.setIdleSeconds(seconds)}
              style={[
                s.btn,
                { flex: 1, paddingVertical: 12 },
                rider.idleSeconds === seconds ? { backgroundColor: C.ok } : s.btnGhost,
              ]}>
              <Text style={[s.btnText, rider.idleSeconds !== seconds && { color: C.text }]}>{seconds} s</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {/*
        Gated on what showBubble() actually returned, not on Platform.OS: on
        Android without the overlay permission it returns false too, and a
        switch that does nothing is worse than no switch.
      */}
      {rider.bubbleUsable ? (
        <Card>
          <View style={s.row}>
            <Text style={[s.h2, { flex: 1 }]}>Bulle flottante</Text>
            <Switch
              value={rider.bubbleOn}
              onValueChange={(value) => void rider.toggleBubble(value)}
              trackColor={{ true: C.ok, false: C.line }}
            />
          </View>
          <Text style={s.p}>Affiche l’étape par-dessus Waze. Un appui ramène Rider au premier plan.</Text>
        </Card>
      ) : null}

      <Btn label="Diagnostic" tone="ghost" onPress={() => router.push('/diagnostics')} />
      <Btn label="Se déconnecter" tone="bad" onPress={() => void rider.signOut()} />
    </ScrollView>
  );
}
