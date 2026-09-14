import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { useRider } from '../src/store';
import { C, Card, Row, s } from '../src/ui';

const time = (at: number) => new Date(at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export default function History() {
  const { earnings, refreshEarnings } = useRider();

  useFocusEffect(
    useCallback(() => {
      void refreshEarnings();
    }, [refreshEarnings]),
  );

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card>
        <Row label="Aujourd’hui" value={`${earnings?.total ?? 0} DT`} tone={C.ok} />
        <Row label="Cette semaine" value={`${earnings?.week ?? 0} DT`} />
        <Row label="Courses du jour" value={String(earnings?.trips.length ?? 0)} />
      </Card>

      {earnings?.trips.length ? (
        earnings.trips.map((trip) => (
          <Card key={trip.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={s.h2}>#{trip.id}</Text>
              <Text style={[s.h2, { color: C.ok }]}>{trip.fare} DT</Text>
            </View>
            <Text style={s.p}>
              {time(trip.endedAt)} · {trip.dropoff}
            </Text>
          </Card>
        ))
      ) : (
        <Text style={s.p}>Aucune course terminée aujourd’hui.</Text>
      )}
    </ScrollView>
  );
}
