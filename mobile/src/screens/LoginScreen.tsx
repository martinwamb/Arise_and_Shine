import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';

export default function LoginScreen() {
  const navigation = useNavigation<any>();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      await login(email.trim().toLowerCase(), password);
      // RootNavigator automatically redirects to role workspace after login
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.kav}>
        <View style={s.content}>

          <TouchableOpacity style={s.back} onPress={() => navigation.goBack()}>
            <Text style={s.backText}>← Back</Text>
          </TouchableOpacity>

          <View style={s.header}>
            <Image source={require('../../assets/logo.jpeg')} style={s.logo} />
            <Text style={s.title}>Sign in</Text>
            <Text style={s.subtitle}>Access your workspace</Text>
          </View>

          <View style={s.card}>
            <View style={s.field}>
              <Text style={s.label}>EMAIL</Text>
              <TextInput
                style={s.input}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="you@example.com"
                placeholderTextColor="#94a3b8"
              />
            </View>

            <View style={s.field}>
              <Text style={s.label}>PASSWORD</Text>
              <TextInput
                style={s.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder="••••••••"
                placeholderTextColor="#94a3b8"
              />
            </View>

            {error && (
              <View style={s.errorBox}>
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[s.btn, loading && s.btnDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.btnText}>Sign in</Text>
              }
            </TouchableOpacity>
          </View>

          <View style={s.rolesInfo}>
            <Text style={s.rolesTitle}>After signing in you will see:</Text>
            {[
              ['Admin / Ops', 'Orders, fleet, stock, finance, reports'],
              ['Driver', 'Assigned loads, earnings, onboarding'],
              ['Fuel', 'Fuel log capture and review'],
              ['Customer', 'Order placement and tracking'],
            ].map(([role, desc]) => (
              <View key={role} style={s.roleRow}>
                <Text style={s.roleKey}>{role}</Text>
                <Text style={s.roleDesc}>{desc}</Text>
              </View>
            ))}
          </View>

        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  kav: { flex: 1 },
  content: { flex: 1, padding: 20, gap: 20 },

  back: { paddingTop: 8 },
  backText: { fontSize: 14, color: '#64748b', fontWeight: '500' },

  header: { gap: 6 },
  logo: { width: 140, height: 48, resizeMode: 'contain' },
  title: { fontSize: 26, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 14, color: '#64748b' },

  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    padding: 20,
    gap: 16,
  },

  field: { gap: 6 },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    letterSpacing: 0.8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },

  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    padding: 12,
  },
  errorText: { color: '#dc2626', fontSize: 13 },

  btn: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },

  rolesInfo: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  rolesTitle: { fontSize: 12, fontWeight: '600', color: '#94a3b8', letterSpacing: 0.5 },
  roleRow: { gap: 2 },
  roleKey: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  roleDesc: { fontSize: 13, color: '#64748b' },
});
