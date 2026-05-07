import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { formatDateTime, formatKes } from '../../utils/format';

type FuelLog = {
  id: number;
  truck_id: string;
  litres: number;
  cost: number;
  odometer: number;
  note: string;
  created_at: string;
  is_duplicate?: boolean;
};

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
      {sub ? <Text style={s.statSub}>{sub}</Text> : null}
    </View>
  );
}

export default function FuelHomeScreen() {
  const { apiClient: { api }, user } = useAuth();
  const navigation = useNavigation<any>();

  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await api.get('/api/fuel/logs', { params: { limit: 50 } });
      setLogs(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError('Unable to load fuel logs.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const today = new Date().toDateString();
  const todayLogs = logs.filter((l) => new Date(l.created_at).toDateString() === today);
  const todayLitres = todayLogs.reduce((sum, l) => sum + (l.litres || 0), 0);
  const todayCost = todayLogs.reduce((sum, l) => sum + (l.cost || 0), 0);
  const duplicates = logs.filter((l) => l.is_duplicate).length;
  const recentLogs = logs.slice(0, 8);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator size="large" color="#0f172a" />
          <Text style={s.loadingText}>Loading fuel logs…</Text>
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
        {/* Header */}
        <View style={s.header}>
          <Text style={s.greeting}>Fuel Monitor</Text>
          <Text style={s.greetingName}>{user?.name?.split(' ')[0] ?? 'Monitor'}</Text>
        </View>

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* Today summary */}
        <Text style={s.sectionTitle}>Today</Text>
        <View style={s.statsRow}>
          <StatCard label="ENTRIES" value={todayLogs.length} sub="today" />
          <StatCard label="LITRES" value={todayLitres.toFixed(0)} sub="logged" />
          <StatCard label="COST" value={formatKes(todayCost)} sub="today" />
          <StatCard label="ALERTS" value={duplicates} sub="duplicates" />
        </View>

        {/* Duplicate alert */}
        {duplicates > 0 && (
          <TouchableOpacity
            style={s.alertCard}
            onPress={() => navigation.navigate('FuelMonitor')}
          >
            <Text style={s.alertTitle}>⚠ {duplicates} duplicate alert{duplicates > 1 ? 's' : ''} need review</Text>
            <Text style={s.alertSub}>Tap to open fuel log and review flagged entries</Text>
          </TouchableOpacity>
        )}

        {/* Quick action */}
        <TouchableOpacity
          style={s.captureBtn}
          onPress={() => navigation.navigate('FuelMonitor')}
        >
          <Text style={s.captureBtnText}>+ Log new fuel entry</Text>
        </TouchableOpacity>

        {/* Recent logs */}
        <Text style={s.sectionTitle}>Recent Entries</Text>
        {recentLogs.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyText}>No fuel logs yet. Tap above to add the first entry.</Text>
          </View>
        ) : (
          recentLogs.map((log) => (
            <View key={log.id} style={[s.logCard, log.is_duplicate && s.logCardDuplicate]}>
              <View style={s.logRow}>
                <Text style={s.logTruck}>{log.truck_id || 'Unknown truck'}</Text>
                {log.is_duplicate && (
                  <View style={s.dupBadge}>
                    <Text style={s.dupBadgeText}>DUPLICATE</Text>
                  </View>
                )}
              </View>
              <View style={s.logMeta}>
                <Text style={s.logMetaItem}>{log.litres} L</Text>
                <Text style={s.logDot}>·</Text>
                <Text style={s.logMetaItem}>{formatKes(log.cost)}</Text>
                {log.odometer ? (
                  <>
                    <Text style={s.logDot}>·</Text>
                    <Text style={s.logMetaItem}>{log.odometer.toLocaleString()} km</Text>
                  </>
                ) : null}
              </View>
              <Text style={s.logDate}>{formatDateTime(log.created_at)}</Text>
              {log.note ? <Text style={s.logNote}>{log.note}</Text> : null}
            </View>
          ))
        )}

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
  greeting: { fontSize: 13, fontWeight: '500', color: '#94a3b8', letterSpacing: 0.5 },
  greetingName: { fontSize: 26, fontWeight: '800', color: '#0f172a' },

  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 12,
  },
  errorText: { color: '#dc2626', fontSize: 13 },

  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginTop: 4,
  },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: {
    flexGrow: 1,
    minWidth: '44%',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    gap: 3,
  },
  statLabel: { fontSize: 10, fontWeight: '600', color: '#94a3b8', letterSpacing: 0.8 },
  statValue: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  statSub: { fontSize: 11, color: '#94a3b8' },

  alertCard: {
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  alertTitle: { fontSize: 14, fontWeight: '700', color: '#9a3412' },
  alertSub: { fontSize: 13, color: '#c2410c' },

  captureBtn: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  captureBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },

  emptyCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: { color: '#94a3b8', fontSize: 14, textAlign: 'center' },

  logCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    gap: 5,
  },
  logCardDuplicate: { borderColor: '#fed7aa', backgroundColor: '#fff7ed' },
  logRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logTruck: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  logMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  logMetaItem: { fontSize: 13, color: '#475569', fontWeight: '500' },
  logDot: { color: '#cbd5e1', fontSize: 13 },
  logDate: { fontSize: 12, color: '#94a3b8' },
  logNote: { fontSize: 12, color: '#64748b', fontStyle: 'italic' },

  dupBadge: {
    backgroundColor: '#fed7aa',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  dupBadgeText: { fontSize: 10, fontWeight: '700', color: '#9a3412' },
});
