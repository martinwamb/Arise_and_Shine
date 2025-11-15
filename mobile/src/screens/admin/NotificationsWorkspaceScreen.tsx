import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateTime } from '../../utils/format';

type Recipient = {
  id: number;
  name: string;
  email: string;
  role: string;
  telegramChatId: string;
};

type NotificationRow = {
  id: string;
  email: string;
  subject: string;
  status: string;
  attempts: number;
  created_at: string;
  sent_at?: string;
  last_error?: string;
};

export default function NotificationsWorkspaceScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [queue, setQueue] = useState<NotificationRow[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(true);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [savingRecipientId, setSavingRecipientId] = useState<number | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadRecipients = useCallback(async () => {
    try {
      setLoadingRecipients(true);
      const res = await api.get('/api/admin/notification-targets');
      setRecipients(res.data?.recipients || []);
    } catch (err: any) {
      setMessage(err?.response?.data?.error || 'Failed to load recipients.');
    } finally {
      setLoadingRecipients(false);
    }
  }, [api]);

  const loadQueue = useCallback(async () => {
    try {
      setLoadingQueue(true);
      const res = await api.get('/api/admin/notifications', { params: { limit: 50 } });
      setQueue(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      setMessage(err?.response?.data?.error || 'Failed to load email queue.');
    } finally {
      setLoadingQueue(false);
    }
  }, [api]);

  useEffect(() => {
    loadRecipients();
    loadQueue();
  }, [loadQueue, loadRecipients]);

  const saveRecipient = useCallback(
    async (recipient: Recipient) => {
      setSavingRecipientId(recipient.id);
      try {
        await api.put(`/api/admin/notification-targets/${recipient.id}`, {
          telegramChatId: recipient.telegramChatId || '',
        });
      } catch (err: any) {
        Alert.alert('Failed to save recipient', err?.response?.data?.error || 'Unable to save recipient.');
      } finally {
        setSavingRecipientId(null);
      }
    },
    [api],
  );

  const dispatchQueue = useCallback(async () => {
    try {
      setDispatching(true);
      const res = await api.post('/api/admin/notifications/dispatch', { limit: 25 });
      setMessage(res.data?.skipped ? res.data.reason : `Sent ${res.data?.sent || 0} emails.`);
      await loadQueue();
    } catch (err: any) {
      Alert.alert('Failed to dispatch queue', err?.response?.data?.error || 'Unable to dispatch emails.');
    } finally {
      setDispatching(false);
    }
  }, [api, loadQueue]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.title}>Telegram targets</Text>
        {loadingRecipients && (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text style={styles.statusText}>Loading recipients…</Text>
          </View>
        )}
        {recipients.map((recipient) => (
          <View key={recipient.id} style={styles.recipientRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.recipientName}>
                {recipient.name} · {recipient.role}
              </Text>
              <Text style={styles.recipientMeta}>{recipient.email}</Text>
              <TextInput
                style={styles.input}
                placeholder="Telegram chat ID"
                placeholderTextColor="#94a3b8"
                value={recipient.telegramChatId}
                onChangeText={(text) =>
                  setRecipients((prev) =>
                    prev.map((r) => (r.id === recipient.id ? { ...r, telegramChatId: text } : r)),
                  )
                }
              />
            </View>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => saveRecipient(recipient)}
              disabled={savingRecipientId === recipient.id}
            >
              <Text style={styles.secondaryButtonText}>{savingRecipientId === recipient.id ? 'Saving…' : 'Save'}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.title}>Email queue</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={dispatchQueue} disabled={dispatching}>
            <Text style={styles.primaryButtonText}>{dispatching ? 'Dispatching…' : 'Dispatch now'}</Text>
          </TouchableOpacity>
        </View>
        {loadingQueue && (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text style={styles.statusText}>Loading queue…</Text>
          </View>
        )}
        {queue.map((row) => (
          <View key={row.id} style={styles.queueRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.queueSubject}>{row.subject}</Text>
              <Text style={styles.queueMeta}>{row.email}</Text>
              <Text style={styles.queueMeta}>Status {row.status}</Text>
              {row.last_error && <Text style={styles.queueError}>{row.last_error}</Text>}
            </View>
            <Text style={styles.queueMeta}>{formatDateTime(row.created_at)}</Text>
          </View>
        ))}
      </View>
      {message && <Text style={styles.helper}>{message}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fef9f2',
  },
  content: {
    padding: 20,
    gap: 16,
  },
  section: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#cbd5f5',
    backgroundColor: '#fff',
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: {
    fontSize: 13,
    color: '#475569',
  },
  recipientRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    gap: 8,
  },
  recipientName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  recipientMeta: {
    fontSize: 12,
    color: '#475569',
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
  },
  primaryButton: {
    borderRadius: 999,
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  queueRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  queueSubject: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  queueMeta: {
    fontSize: 12,
    color: '#475569',
  },
  queueError: {
    fontSize: 12,
    color: '#b91c1c',
  },
  helper: {
    fontSize: 12,
    color: '#475569',
  },
});
