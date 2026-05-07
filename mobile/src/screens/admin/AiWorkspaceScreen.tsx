import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';

type InsightResponse = {
  insights?: string;
  alerts?: string[];
  telemetryAlerts?: {
    id: string;
    truckId?: string;
    plate?: string;
    alertType: string;
    severity: string;
    summary: string;
    createdAt: string;
  }[];
};

type ChatMessage = { role: 'user' | 'assistant'; content: string };

export default function AiWorkspaceScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [insights, setInsights] = useState<InsightResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Hi! Ask me about orders, trucks, or costs.' },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  const loadInsights = useCallback(async () => {
    try {
      setStatus('loading');
      const res = await api.get('/api/admin/ai/insights');
      setInsights(res.data || null);
      setStatus('idle');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.response?.data?.error || 'Failed to load AI insights.');
    }
  }, [api]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const sendChat = useCallback(async () => {
    const prompt = chatInput.trim();
    if (!prompt || chatLoading) return;
    setChatMessages((prev) => [...prev, { role: 'user', content: prompt }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const history = chatMessages.slice(-5).concat({ role: 'user', content: prompt });
      const res = await api.post('/api/admin/ai/chat', {
        prompt,
        history: history.map((msg) => ({ role: msg.role, content: msg.content })),
      });
      const answer = res.data?.answer || 'No answer right now.';
      setChatMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: err?.response?.data?.error || 'Failed to contact AI assistant.' },
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [api, chatInput, chatLoading, chatMessages]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.title}>AI insights</Text>
          <TouchableOpacity onPress={loadInsights}>
            <Text style={styles.link}>Refresh</Text>
          </TouchableOpacity>
        </View>
        {status === 'loading' && (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text style={styles.statusText}>Gathering telemetry and orders…</Text>
          </View>
        )}
        {status === 'error' && message && <Text style={styles.error}>{message}</Text>}
        {insights?.insights && (
          <Text style={styles.insightText}>{insights.insights}</Text>
        )}
        {insights?.alerts?.length ? (
          <View style={styles.alertList}>
            {insights.alerts.map((alert, index) => (
              <Text key={index} style={styles.alertItem}>
                {alert}
              </Text>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Assistant chat</Text>
        <FlatList
          data={chatMessages}
          keyExtractor={(_, index) => String(index)}
          renderItem={({ item }) => (
            <View style={[styles.messageBubble, item.role === 'assistant' ? styles.assistantBubble : styles.userBubble]}>
              <Text style={styles.messageText}>{item.content}</Text>
            </View>
          )}
          contentContainerStyle={{ gap: 8 }}
        />
        <View style={styles.chatRow}>
          <TextInput
            style={styles.chatInput}
            placeholder="Ask the assistant…"
            value={chatInput}
            onChangeText={setChatInput}
            placeholderTextColor="#94a3b8"
          />
          <TouchableOpacity style={styles.chatButton} onPress={sendChat} disabled={chatLoading}>
            <Text style={styles.chatButtonText}>{chatLoading ? '...' : 'Send'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 20,
    gap: 16,
  },
  section: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#cbd5f5',
    padding: 16,
    backgroundColor: '#fff',
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  link: {
    color: '#0f172a',
    fontWeight: '600',
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
  error: {
    color: '#b91c1c',
  },
  insightText: {
    fontSize: 14,
    color: '#0f172a',
  },
  alertList: {
    gap: 6,
  },
  alertItem: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fcd34d',
    padding: 10,
    backgroundColor: '#fffbeb',
    color: '#92400e',
  },
  messageBubble: {
    borderRadius: 16,
    padding: 12,
  },
  assistantBubble: {
    backgroundColor: '#f1f5f9',
    alignSelf: 'flex-start',
  },
  userBubble: {
    backgroundColor: '#0f172a',
    alignSelf: 'flex-end',
  },
  messageText: {
    color: '#0f172a',
  },
  chatRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  chatInput: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    color: '#0f172a',
  },
  chatButton: {
    borderRadius: 16,
    backgroundColor: '#0f172a',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chatButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
});
