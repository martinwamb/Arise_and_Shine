import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';

type Mailbox = {
  username: string;
  name: string;
  local_part: string;
  quota: number;
  quota_used: number;
  messages: number;
  active: number;
  last_imap_login: number;
};

const WEBMAIL = 'https://mail.ariseandshinetransporters.com/SOGo';
const DOMAIN = 'ariseandshinetransporters.com';

function mb(bytes: number) {
  if (!bytes) return '0 MB';
  const m = bytes / 1024 / 1024;
  return m >= 1024 ? `${(m / 1024).toFixed(1)} GB` : `${Math.round(m)} MB`;
}

export default function EmailManagementScreen() {
  const { apiClient: { api } } = useAuth();
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ local_part: '', name: '', password: '', quota: '1024' });
  const [submitting, setSubmitting] = useState(false);
  const [changingPw, setChangingPw] = useState<string | null>(null);
  const [newPw, setNewPw] = useState('');
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get('/api/admin/email/mailboxes');
      setMailboxes(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError('Unable to load mailboxes.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const filtered = useMemo(() => {
    if (!search) return mailboxes;
    const q = search.toLowerCase();
    return mailboxes.filter(m => m.username.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  }, [mailboxes, search]);

  async function createMailbox() {
    if (!form.local_part || !form.name || form.password.length < 8) {
      Alert.alert('Validation', 'Fill all fields. Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/admin/email/mailboxes', { ...form, quota: Number(form.quota) || 1024 });
      setSuccess(`${form.local_part}@${DOMAIN} created.`);
      setForm({ local_part: '', name: '', password: '', quota: '1024' });
      setShowCreate(false);
      load();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || 'Failed to create mailbox.');
    } finally {
      setSubmitting(false);
    }
  }

  async function changePassword(email: string) {
    if (newPw.length < 8) { Alert.alert('Validation', 'Password must be at least 8 characters.'); return; }
    setSubmitting(true);
    try {
      await api.patch(`/api/admin/email/mailboxes/${encodeURIComponent(email)}`, { password: newPw });
      setSuccess(`Password updated for ${email}.`);
      setChangingPw(null);
      setNewPw('');
    } catch {
      Alert.alert('Error', 'Failed to update password.');
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteMailbox(email: string) {
    Alert.alert('Delete mailbox', `Permanently delete ${email}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            await api.delete(`/api/admin/email/mailboxes/${encodeURIComponent(email)}`);
            setSuccess(`${email} deleted.`);
            load();
          } catch {
            Alert.alert('Error', 'Failed to delete mailbox.');
          }
        }
      }
    ]);
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator size="large" color="#0f172a" />
          <Text style={s.loadingText}>Loading mailboxes…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0f172a" />}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.header}>
          <Text style={s.title}>Email</Text>
          <Text style={s.subtitle}>{DOMAIN}</Text>
        </View>

        {/* Stats */}
        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={s.statLabel}>MAILBOXES</Text>
            <Text style={s.statValue}>{mailboxes.length}</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statLabel}>ACTIVE</Text>
            <Text style={s.statValue}>{mailboxes.filter(m => m.active).length}</Text>
          </View>
          <View style={s.statCard}>
            <Text style={s.statLabel}>MESSAGES</Text>
            <Text style={s.statValue}>{mailboxes.reduce((s, m) => s + (m.messages || 0), 0)}</Text>
          </View>
        </View>

        {success && (
          <View style={s.successBox}>
            <Text style={s.successText}>{success}</Text>
            <TouchableOpacity onPress={() => setSuccess(null)}><Text style={s.successDismiss}>✕</Text></TouchableOpacity>
          </View>
        )}

        {error && <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>}

        {/* Actions */}
        <View style={s.actions}>
          <TouchableOpacity style={s.primaryBtn} onPress={() => setShowCreate(!showCreate)}>
            <Text style={s.primaryBtnText}>{showCreate ? 'Cancel' : '+ New Mailbox'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.outlineBtn} onPress={() => Linking.openURL(WEBMAIL)}>
            <Text style={s.outlineBtnText}>Open Webmail ↗</Text>
          </TouchableOpacity>
        </View>

        {/* Create form */}
        {showCreate && (
          <View style={s.card}>
            <Text style={s.cardTitle}>New Mailbox</Text>
            <View style={s.field}>
              <Text style={s.fieldLabel}>USERNAME</Text>
              <View style={s.domainRow}>
                <TextInput
                  style={[s.input, { flex: 1 }]}
                  value={form.local_part}
                  onChangeText={v => setForm(f => ({ ...f, local_part: v.toLowerCase() }))}
                  placeholder="e.g. logistics"
                  placeholderTextColor="#94a3b8"
                  autoCapitalize="none"
                />
                <Text style={s.domainLabel}>@{DOMAIN}</Text>
              </View>
            </View>
            <View style={s.field}>
              <Text style={s.fieldLabel}>DISPLAY NAME</Text>
              <TextInput style={s.input} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))} placeholder="Full name" placeholderTextColor="#94a3b8" />
            </View>
            <View style={s.field}>
              <Text style={s.fieldLabel}>PASSWORD (min 8 chars)</Text>
              <TextInput style={s.input} value={form.password} onChangeText={v => setForm(f => ({ ...f, password: v }))} secureTextEntry placeholder="••••••••" placeholderTextColor="#94a3b8" />
            </View>
            <View style={s.field}>
              <Text style={s.fieldLabel}>QUOTA (MB)</Text>
              <TextInput style={s.input} value={form.quota} onChangeText={v => setForm(f => ({ ...f, quota: v }))} keyboardType="numeric" placeholder="1024" placeholderTextColor="#94a3b8" />
            </View>
            <TouchableOpacity style={[s.primaryBtn, submitting && { opacity: 0.5 }]} onPress={createMailbox} disabled={submitting}>
              <Text style={s.primaryBtnText}>{submitting ? 'Creating…' : 'Create Mailbox'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Search */}
        <TextInput
          style={s.input}
          value={search}
          onChangeText={setSearch}
          placeholder="Search mailboxes…"
          placeholderTextColor="#94a3b8"
        />

        {/* Mailbox list */}
        {filtered.map(m => {
          const usedPct = m.quota > 0 ? Math.round((m.quota_used / m.quota) * 100) : 0;
          const isChanging = changingPw === m.username;
          return (
            <View key={m.username} style={s.card}>
              <View style={s.mailboxRow}>
                <View style={s.avatar}>
                  <Text style={s.avatarText}>{(m.name?.[0] || m.local_part?.[0] || '?').toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.mailboxName}>{m.name}</Text>
                  <Text style={s.mailboxEmail}>{m.username}</Text>
                </View>
                <View style={[s.activeBadge, !m.active && s.inactiveBadge]}>
                  <Text style={[s.activeBadgeText, !m.active && s.inactiveBadgeText]}>{m.active ? 'Active' : 'Inactive'}</Text>
                </View>
              </View>

              <View style={s.mailboxMeta}>
                <Text style={s.metaItem}>{m.messages || 0} msgs</Text>
                <Text style={s.metaDot}>·</Text>
                <Text style={s.metaItem}>{mb(m.quota_used)} / {mb(m.quota)}</Text>
              </View>

              {/* Quota bar */}
              <View style={s.quotaBar}>
                <View style={[s.quotaFill, { width: `${Math.min(usedPct, 100)}%` as any }, usedPct > 80 && s.quotaFillHigh]} />
              </View>

              {/* Actions */}
              <View style={s.mailboxActions}>
                <TouchableOpacity style={s.smBtn} onPress={() => { setChangingPw(isChanging ? null : m.username); setNewPw(''); }}>
                  <Text style={s.smBtnText}>{isChanging ? 'Cancel' : 'Change Password'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.smBtn} onPress={() => Linking.openURL(WEBMAIL)}>
                  <Text style={s.smBtnText}>Webmail ↗</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.smBtnDanger} onPress={() => deleteMailbox(m.username)}>
                  <Text style={s.smBtnDangerText}>Delete</Text>
                </TouchableOpacity>
              </View>

              {isChanging && (
                <View style={s.pwRow}>
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    value={newPw}
                    onChangeText={setNewPw}
                    secureTextEntry
                    placeholder="New password (min 8 chars)"
                    placeholderTextColor="#94a3b8"
                  />
                  <TouchableOpacity style={[s.primaryBtn, { paddingHorizontal: 14 }, submitting && { opacity: 0.5 }]} onPress={() => changePassword(m.username)} disabled={submitting}>
                    <Text style={s.primaryBtnText}>{submitting ? '…' : 'Save'}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: '#64748b' },

  header: { paddingVertical: 8 },
  title: { fontSize: 26, fontWeight: '800', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b' },

  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 12, gap: 3 },
  statLabel: { fontSize: 10, fontWeight: '600', color: '#94a3b8', letterSpacing: 0.8 },
  statValue: { fontSize: 20, fontWeight: '800', color: '#0f172a' },

  successBox: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 10, padding: 12, flexDirection: 'row', alignItems: 'center' },
  successText: { flex: 1, color: '#15803d', fontSize: 13 },
  successDismiss: { color: '#15803d', fontSize: 16, paddingLeft: 8 },
  errorBox: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, padding: 12 },
  errorText: { color: '#dc2626', fontSize: 13 },

  actions: { flexDirection: 'row', gap: 8 },
  primaryBtn: { flex: 1, backgroundColor: '#0f172a', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  outlineBtn: { flex: 1, borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingVertical: 12, alignItems: 'center', backgroundColor: '#fff' },
  outlineBtnText: { color: '#475569', fontWeight: '600', fontSize: 14 },

  card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 14, padding: 16, gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  field: { gap: 6 },
  fieldLabel: { fontSize: 10, fontWeight: '600', color: '#94a3b8', letterSpacing: 0.8 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#0f172a', backgroundColor: '#f8fafc' },
  domainRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  domainLabel: { fontSize: 13, color: '#64748b', fontWeight: '500' },

  mailboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  mailboxName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  mailboxEmail: { fontSize: 12, color: '#64748b' },
  activeBadge: { backgroundColor: '#dcfce7', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  inactiveBadge: { backgroundColor: '#f1f5f9' },
  activeBadgeText: { fontSize: 11, fontWeight: '700', color: '#15803d' },
  inactiveBadgeText: { color: '#64748b' },

  mailboxMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaItem: { fontSize: 12, color: '#64748b' },
  metaDot: { color: '#cbd5e1', fontSize: 12 },

  quotaBar: { height: 4, backgroundColor: '#f1f5f9', borderRadius: 999, overflow: 'hidden' },
  quotaFill: { height: 4, backgroundColor: '#0f172a', borderRadius: 999 },
  quotaFillHigh: { backgroundColor: '#dc2626' },

  mailboxActions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  smBtn: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: '#fff' },
  smBtnText: { fontSize: 12, color: '#475569', fontWeight: '500' },
  smBtnDanger: { borderWidth: 1, borderColor: '#fecaca', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  smBtnDangerText: { fontSize: 12, color: '#dc2626', fontWeight: '500' },

  pwRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});
