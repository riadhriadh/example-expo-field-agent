import { Redirect } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';

import { HttpError } from '../src/api';
import { useRider } from '../src/store';
import { Btn, C, s } from '../src/ui';

export default function Login() {
  const { driver, signIn } = useRider();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (driver) return <Redirect href="/" />;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signIn(phone.trim(), password);
    } catch (cause) {
      // Sans module natif (Expo Go), `setAuthHeader` lève : accuser le mot de
      // passe enverrait chercher la panne au mauvais endroit.
      setError(
        cause instanceof HttpError
          ? 'Numéro ou mot de passe refusé.'
          : 'Build de développement requis : npx expo prebuild && npx expo run:android',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[s.pad, { flex: 1, justifyContent: 'center', gap: 14 }]}>
        <Text style={s.h1}>Rider</Text>
        <Text style={s.p}>Connecte-toi pour prendre ton service.</Text>

        <TextInput
          style={s.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="Téléphone"
          placeholderTextColor={C.dim}
          keyboardType="phone-pad"
          autoComplete="tel"
        />
        <TextInput
          style={s.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Mot de passe"
          placeholderTextColor={C.dim}
          secureTextEntry
          onSubmitEditing={() => void submit()}
        />

        {error ? <Text style={{ color: C.bad }}>{error}</Text> : null}

        <Btn label="Se connecter" busy={busy} disabled={!phone || !password} onPress={() => void submit()} />
        <Text style={[s.p, { fontSize: 12 }]}>
          Le refresh token est stocké dans le keystore du téléphone (expo-secure-store), jamais en clair.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}
