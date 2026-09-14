import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { serviceLost } from './derive';
import { NATIVE } from './native';
import { useRider } from './store';

export const C = {
  bg: '#0B0F14',
  card: '#141B24',
  line: '#22303F',
  text: '#E8EEF5',
  dim: '#8A9AAB',
  ok: '#1DB954',
  warn: '#F5A623',
  bad: '#E5484D',
  urgent: '#7C4DFF',
};

export type Tone = 'ok' | 'warn' | 'bad' | 'urgent' | 'ghost';

export function Btn({
  label,
  onPress,
  tone = 'ok',
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: Tone;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const ghost = tone === 'ghost';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.btn,
        ghost ? s.btnGhost : { backgroundColor: C[tone] },
        (disabled || busy) && s.btnOff,
        pressed && s.btnDown,
        style,
      ]}>
      {busy ? <ActivityIndicator color={ghost ? C.text : '#08110A'} /> : null}
      <Text style={[s.btnText, ghost && { color: C.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, tone ? { color: tone } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  pad: { padding: 16, gap: 12 },
  h1: { color: C.text, fontSize: 26, fontWeight: '700' },
  h2: { color: C.text, fontSize: 17, fontWeight: '600' },
  p: { color: C.dim, fontSize: 14, lineHeight: 20 },
  mono: { color: C.text, fontSize: 13, fontFamily: 'monospace' },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: C.line },
  btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingVertical: 15, paddingHorizontal: 18 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line },
  btnOff: { opacity: 0.45 },
  btnDown: { opacity: 0.8 },
  btnText: { color: '#08110A', fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 6 },
  rowLabel: { color: C.dim, fontSize: 14, flexShrink: 1 },
  rowValue: { color: C.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  input: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    color: C.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 12, borderWidth: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  link: { color: C.dim, fontSize: 14, fontWeight: '600' },
});

/**
 * Shown only when it has something to say. A queue is a tunnel, a car park or a
 * flaky operator — never a driver to be logged out.
 */
export function Banner() {
  const { tracking, permissionLost, syncedAt, service, errors, flush, openSetting } = useRider();
  const queued = tracking?.queued ?? 0;

  // Rien ne suit la voiture dans Expo Go : le dire au-dessus de tout le reste,
  // sinon l'ecran « En ligne » promet un service qui n'existe pas.
  if (!NATIVE) {
    return <Bar tone={C.warn} text="Expo Go : interface seule, aucun suivi ni alerte." />;
  }
  if (permissionLost) {
    return <Bar tone={C.bad} text="Localisation coupée : plus rien ne part." label="Réglages" onPress={() => void openSetting('location')} />;
  }
  if (service !== 'OFFLINE' && serviceLost(tracking, Date.now())) {
    return <Bar tone={C.bad} text="Service arrêté, ou aucune position depuis plus de 10 min." />;
  }
  if (errors[0]?.code === 'HTTP_401' && queued > 0) {
    return <Bar tone={C.bad} text="Session expirée : renouvellement en cours." label="Réessayer" onPress={() => void flush()} />;
  }
  if (queued > 0) {
    return <Bar tone={C.warn} text={`${queued} position(s) en attente — réseau indisponible.`} label="Réessayer" onPress={() => void flush()} />;
  }
  if (syncedAt) {
    return <Bar tone={C.ok} text="Synchronisé" />;
  }
  return null;
}

function Bar({ tone, text, label, onPress }: { tone: string; text: string; label?: string; onPress?: () => void }) {
  return (
    <View style={[s.banner, { borderColor: tone, backgroundColor: `${tone}1A` }]}>
      <View style={[s.dot, { backgroundColor: tone }]} />
      <Text style={[s.p, { color: C.text, flex: 1 }]}>{text}</Text>
      {label && onPress ? (
        <Pressable onPress={onPress} hitSlop={8}>
          <Text style={{ color: tone, fontWeight: '700' }}>{label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
