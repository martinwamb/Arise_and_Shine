import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { createApiClient, normaliseBaseUrl } from '../shared/api-client';
import { createSecureTokenStorage, readStoredToken } from './src/storage/tokenStorage';

type Article = {
  id: string;
  title: string;
  summary?: string | null;
  topic?: string | null;
  createdAt?: string | null;
};

type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  driverId?: string | null;
};

const fallbackBase = __DEV__ ? 'http://localhost:4000' : 'https://www.ariseandshinetransporters.com';
const configApiBase = (Constants.expoConfig?.extra as { apiBase?: string } | undefined)?.apiBase;
const apiBase = normaliseBaseUrl(configApiBase, fallbackBase);
const secureTokenStorage = createSecureTokenStorage();
const sharedClient = createApiClient(apiBase, secureTokenStorage, axios.create);
const { api, API_BASE, setToken, requestPasswordReset } = sharedClient;

export default function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState({ email: '', password: '' });
  const [resetState, setResetState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const loadArticles = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        setStatus('loading');
      }
      setError(null);
      try {
        const response = await api.get('/api/articles', { params: { limit: 5 } });
        const rows = Array.isArray(response.data) ? (response.data as Article[]) : [];
        setArticles(rows);
        setStatus('idle');
      } catch (err: any) {
        setError(err?.response?.data?.error || err?.message || 'Unable to reach Arise & Shine API');
        setStatus('error');
      }
    },
    [setArticles],
  );

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  useEffect(() => {
    (async () => {
      try {
        const storedToken = await readStoredToken();
        if (storedToken) {
          setToken(storedToken);
          const me = await api.get('/api/me');
          setUser(me.data?.user || null);
        }
      } catch {
        setToken(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const handleLogin = useCallback(async () => {
    const email = credentials.email.trim();
    const password = credentials.password;
    if (!email || !password) {
      setAuthError('Enter both email and password.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    setResetState('idle');
    try {
      const res = await api.post('/api/auth/login', { email, password });
      const nextUser = res.data?.user as AuthUser;
      if (res.data?.token) {
        setToken(res.data.token);
      }
      setUser(nextUser || null);
    } catch (err: any) {
      setAuthError(err?.response?.data?.error || 'Login failed. Check credentials and try again.');
      setUser(null);
      setToken(null);
    } finally {
      setAuthLoading(false);
    }
  }, [credentials]);

  const handleLogout = useCallback(() => {
    setUser(null);
    setCredentials({ email: '', password: '' });
    setToken(null);
  }, []);

  const handlePasswordReset = useCallback(async () => {
    const email = credentials.email.trim();
    if (!email) {
      setAuthError('Enter your email before requesting a reset link.');
      return;
    }
    setResetState('sending');
    try {
      await requestPasswordReset(email);
      setResetState('sent');
    } catch (err: any) {
      setResetState('error');
      setAuthError(err?.response?.data?.error || 'Could not start password reset.');
    }
  }, [credentials.email]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadArticles({ silent: true });
    setRefreshing(false);
  }, [loadArticles]);

  const lastUpdated = useMemo(() => {
    if (!articles.length) return null;
    const sample = articles[0]?.createdAt;
    if (!sample) return null;
    try {
      return new Date(sample).toLocaleString();
    } catch {
      return sample;
    }
  }, [articles]);

  if (booting) {
    return (
      <SafeAreaView style={styles.bootContainer}>
        <ActivityIndicator size="large" color="#0b6efd" />
        <Text style={styles.bootText}>Preparing Arise Mobile…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Text style={styles.heading}>Arise &amp; Shine Mobile</Text>
        <Text style={styles.subheading}>
          This Expo app shares the same Express API as the website. Pull to refresh or tap reload to confirm connectivity.
        </Text>

        <KeyboardAvoidingView
          style={styles.loginCard}
          behavior={Platform.select({ ios: 'padding', android: undefined })}
        >
          {user ? (
            <View>
              <Text style={styles.sectionHeading}>Signed in</Text>
              <Text style={styles.userName}>{user.name || user.email}</Text>
              <Text style={styles.userRole}>{user.role}</Text>
              <Text style={styles.userEmail}>{user.email}</Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleLogout}>
                <Text style={styles.secondaryButtonText}>Sign out</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text style={styles.sectionHeading}>Sign in</Text>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                keyboardType="email-address"
                value={credentials.email}
                textContentType="emailAddress"
                onChangeText={(text) => setCredentials((prev) => ({ ...prev, email: text }))}
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#94a3b8"
                secureTextEntry
                textContentType="password"
                value={credentials.password}
                onChangeText={(text) => setCredentials((prev) => ({ ...prev, password: text }))}
              />
              {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
              <TouchableOpacity style={styles.primaryButton} onPress={handleLogin} disabled={authLoading}>
                {authLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Sign in</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkButton} onPress={handlePasswordReset} disabled={authLoading}>
                <Text style={styles.linkButtonText}>Forgot password?</Text>
              </TouchableOpacity>
              {resetState === 'sent' && <Text style={styles.successText}>Reset email queued (check your inbox).</Text>}
              {resetState === 'error' && <Text style={styles.errorText}>Could not send reset email.</Text>}
            </View>
          )}
        </KeyboardAvoidingView>

        <View style={styles.metaCard}>
          <Text style={styles.metaLabel}>API Base</Text>
          <Text style={styles.metaValue}>{API_BASE}</Text>
          {lastUpdated ? (
            <Text style={styles.metaHint}>Latest article: {lastUpdated}</Text>
          ) : (
            <Text style={styles.metaHint}>No articles yet. Use the admin dashboard to seed content.</Text>
          )}
        </View>

        <TouchableOpacity style={styles.reloadButton} onPress={() => loadArticles()}>
          <Text style={styles.reloadText}>Reload articles</Text>
        </TouchableOpacity>

        {status === 'loading' && (
          <View style={styles.stateRow}>
            <ActivityIndicator size="small" color="#0b6efd" />
            <Text style={styles.stateText}>Contacting server…</Text>
          </View>
        )}

        {status === 'error' && error && (
          <View style={[styles.stateRow, styles.errorRow]}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View>
          {articles.map((article, index) => (
            <View key={article.id} style={[styles.card, index > 0 && styles.cardSpacing]}>
              <Text style={styles.cardTitle}>{article.title}</Text>
              {article.topic ? <Text style={styles.cardTag}>{article.topic}</Text> : null}
              <Text style={styles.cardSummary}>{article.summary || 'No summary available yet.'}</Text>
            </View>
          ))}
          {!articles.length && status !== 'loading' && (
            <Text style={styles.emptyCopy}>Once articles exist in the backend they will be listed here.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  bootContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  bootText: {
    color: '#475569',
    fontSize: 15,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
    color: '#0f172a',
  },
  subheading: {
    fontSize: 15,
    color: '#475569',
    marginBottom: 18,
  },
  loginCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    color: '#0f172a',
  },
  input: {
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'android' ? 10 : 12,
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#0b6efd',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
  linkButton: {
    marginTop: 12,
    alignItems: 'center',
  },
  linkButtonText: {
    color: '#0369a1',
    fontWeight: '600',
  },
  successText: {
    marginTop: 8,
    color: '#15803d',
    fontWeight: '600',
  },
  userName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#0f172a',
  },
  userRole: {
    fontSize: 14,
    color: '#3b82f6',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  userEmail: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 18,
  },
  secondaryButton: {
    borderColor: '#0b6efd',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#0b6efd',
    fontWeight: '600',
  },
  metaCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 16,
  },
  metaLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#94a3b8',
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  metaHint: {
    marginTop: 6,
    fontSize: 13,
    color: '#64748b',
  },
  reloadButton: {
    backgroundColor: '#0b6efd',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 20,
  },
  reloadText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  stateText: {
    marginLeft: 8,
    color: '#475569',
  },
  errorRow: {
    backgroundColor: '#fee2e2',
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    color: '#b91c1c',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 1,
  },
  cardSpacing: {
    marginTop: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  cardTag: {
    fontSize: 13,
    fontWeight: '500',
    color: '#0ea5e9',
    marginBottom: 6,
  },
  cardSummary: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
  },
  emptyCopy: {
    textAlign: 'center',
    color: '#94a3b8',
    marginTop: 12,
  },
});
