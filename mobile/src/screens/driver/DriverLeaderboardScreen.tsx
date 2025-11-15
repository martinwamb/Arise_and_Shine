import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import type { DriverLeaderboardEntry } from '../../types';
import { formatKes } from '../../utils/format';

const PRESET_WINDOWS = [7, 14, 30] as const;

export default function DriverLeaderboardScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [days, setDays] = useState<(typeof PRESET_WINDOWS)[number]>(7);
  const [entries, setEntries] = useState<DriverLeaderboardEntry[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(
    async (windowDays: number) => {
      try {
        setStatus('loading');
        setMessage(null);
        const res = await api.get('/api/driver/leaderboard', { params: { days: windowDays } });
        setEntries(Array.isArray(res.data) ? res.data : []);
        setStatus('idle');
      } catch (err: any) {
        setEntries([]);
        setStatus('error');
        setMessage(err?.response?.data?.error || 'Unable to load leaderboard.');
      }
    },
    [api],
  );

  useEffect(() => {
    load(days);
  }, [days, load]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Driver leaderboard</Text>
        <Text style={styles.subtitle}>Top performers by delivered revenue</Text>
      </View>
      <View style={styles.filterRow}>
        {PRESET_WINDOWS.map((value) => {
          const active = value === days;
          return (
            <TouchableOpacity
              key={value}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setDays(value)}
              disabled={status === 'loading'}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{value} days</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {status === 'loading' && (
        <View style={styles.statusRow}>
          <ActivityIndicator />
          <Text style={styles.statusText}>Crunching performance…</Text>
        </View>
      )}
      {status === 'error' && message && <Text style={styles.error}>{message}</Text>}
      {status === 'idle' && !entries.length && <Text style={styles.helper}>No data yet. Complete a delivery to appear.</Text>}
      {entries.map((entry, index) => (
        <View key={entry.driverId} style={styles.row}>
          <Text style={styles.rank}>#{index + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{entry.name || entry.driverId}</Text>
            <Text style={styles.meta}>
              {Number(entry.loads || 0).toLocaleString()} loads · {Math.round(Number(entry.tonnes || 0))} tonnes
            </Text>
          </View>
          <Text style={styles.value}>{formatKes(entry.revenue)}</Text>
        </View>
      ))}
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
    gap: 12,
  },
  header: {
    gap: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  filterChipActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  filterChipText: {
    fontSize: 13,
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    backgroundColor: '#fff',
    gap: 12,
  },
  rank: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  meta: {
    fontSize: 12,
    color: '#94a3b8',
  },
  value: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
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
  helper: {
    fontSize: 13,
    color: '#475569',
  },
  error: {
    color: '#b91c1c',
    fontSize: 13,
  },
});
