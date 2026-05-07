import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import type { DriverAssignment, DriverDashboard, DriverTelemetry } from '../../types';
import { formatDateTime, formatKes } from '../../utils/format';

export default function DriverDashboardScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [data, setData] = useState<DriverDashboard | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus('loading');
      setMessage(null);
      const res = await api.get('/api/driver/dashboard');
      setData(res.data || null);
      setStatus('idle');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.response?.data?.error || 'Unable to load driver dashboard.');
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const assignments = useMemo<DriverAssignment[]>(() => data?.assignments || [], [data?.assignments]);
  const telemetryEntries = useMemo<DriverTelemetry[]>(() => data?.telemetry || [], [data?.telemetry]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      {status === 'loading' && (
        <View style={styles.statusRow}>
          <ActivityIndicator />
          <Text style={styles.statusText}>Loading live metrics…</Text>
        </View>
      )}
      {status === 'error' && message && <Text style={styles.error}>{message}</Text>}
      {data && (
        <>
          <View style={styles.header}>
            <Text style={styles.title}>{data.driverName || 'Driver workspace'}</Text>
            {typeof data.rank === 'number' && (
              <Text style={styles.subtitle}>Leaderboard rank #{data.rank}</Text>
            )}
          </View>

          <View style={styles.summaryGrid}>
            <SummaryCard
              label="Loads delivered"
              value={data.summary?.loadsDelivered?.toLocaleString() || '0'}
              detail="Completed assignments"
            />
            <SummaryCard
              label="Tonnes delivered"
              value={Math.round(data.summary?.tonnesDelivered || 0).toLocaleString()}
              detail="This week"
            />
            <SummaryCard
              label="Earnings"
              value={formatKes(data.summary?.earningsDelivered)}
              detail="All-time delivered"
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent assignments</Text>
            {assignments.length === 0 && (
              <Text style={styles.helper}>
                No assignments yet. Dispatch will share details once a load is scheduled.
              </Text>
            )}
            {assignments.slice(0, 5).map((assignment) => (
              <View key={assignment.id} style={styles.assignmentCard}>
                <View style={styles.assignmentHeader}>
                  <View>
                    <Text style={styles.assignmentTitle}>{assignment.site || 'Site TBC'}</Text>
                    <Text style={styles.assignmentMeta}>{assignment.plate || assignment.truckId || 'Truck TBC'}</Text>
                  </View>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{assignment.status || 'Pending'}</Text>
                  </View>
                </View>
                <View style={styles.assignmentRow}>
                  <Text style={styles.assignmentValue}>
                    {Math.round(Number(assignment.tonnes || 0)).toLocaleString()} tonnes
                  </Text>
                  <Text style={styles.assignmentValue}>{formatKes(assignment.estimatedRevenue)}</Text>
                </View>
                <Text style={styles.assignmentMeta}>
                  Scheduled {assignment.scheduledAt ? formatDateTime(assignment.scheduledAt) : 'TBC'}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Assigned trucks & telemetry</Text>
            {telemetryEntries.length === 0 && (
              <Text style={styles.helper}>
                Trucks will appear here once dispatch links your next delivery.
              </Text>
            )}
            {telemetryEntries.map((telemetry) => (
              <View key={telemetry.truckId || telemetry.plate || String(Math.random())} style={styles.telemetryCard}>
                <View style={styles.telemetryHeader}>
                  <View>
                    <Text style={styles.assignmentTitle}>{telemetry.plate || telemetry.truckId || 'Truck'}</Text>
                    <Text style={styles.assignmentMeta}>{telemetry.status || 'Status pending'}</Text>
                  </View>
                  <View style={[styles.badge, Number(telemetry.speed || 0) > 5 ? styles.badgeGreen : styles.badgeAmber]}>
                    <Text
                      style={[
                        styles.badgeText,
                        Number(telemetry.speed || 0) > 5 ? styles.badgeTextDark : styles.badgeTextDark,
                      ]}
                    >
                      {telemetry.speed !== null && telemetry.speed !== undefined
                        ? `${Math.round(Number(telemetry.speed))} km/h`
                        : 'n/a'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.assignmentMeta}>
                  {telemetry.address
                    ? telemetry.address
                    : telemetry.lat && telemetry.lng
                    ? `Lat ${Number(telemetry.lat).toFixed(3)}, Lng ${Number(telemetry.lng).toFixed(3)}`
                    : 'Location refreshing'}
                </Text>
                <View style={styles.assignmentRow}>
                  <Text style={styles.assignmentMeta}>
                    Updated {telemetry.lastUpdated ? formatDateTime(telemetry.lastUpdated) : 'just now'}
                  </Text>
                  {typeof telemetry.idleMinutes === 'number' && (
                    <Text style={styles.assignmentMeta}>{telemetry.idleMinutes} min idle</Text>
                  )}
                </View>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Leaderboard snapshot</Text>
            {(!data.leaderboard || data.leaderboard.length === 0) && (
              <Text style={styles.helper}>Leaderboard data will appear after your first delivery.</Text>
            )}
            {data.leaderboard?.slice(0, 5).map((entry, index) => (
              <View key={entry.driverId} style={styles.leaderboardRow}>
                <Text style={styles.leaderboardRank}>#{index + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.leaderboardName}>{entry.name || entry.driverId}</Text>
                  <Text style={styles.leaderboardMeta}>
                    {Number(entry.loads || 0).toLocaleString()} loads · {Math.round(Number(entry.tonnes || 0))} tonnes
                  </Text>
                </View>
                <Text style={styles.leaderboardValue}>{formatKes(entry.revenue)}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
      {detail && <Text style={styles.summaryDetail}>{detail}</Text>}
    </View>
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
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryCard: {
    flexBasis: '30%',
    flexGrow: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    backgroundColor: '#fff',
  },
  summaryLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    color: '#94a3b8',
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  summaryDetail: {
    fontSize: 12,
    color: '#475569',
  },
  section: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  assignmentCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#fef3c7',
    padding: 12,
    gap: 8,
    backgroundColor: '#ffffff',
  },
  assignmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  assignmentTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  assignmentMeta: {
    fontSize: 12,
    color: '#475569',
  },
  assignmentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  assignmentValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#0f172a',
  },
  badgeGreen: {
    backgroundColor: '#d1fae5',
  },
  badgeAmber: {
    backgroundColor: '#fef3c7',
  },
  badgeText: {
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700',
    color: '#fff',
  },
  badgeTextDark: {
    color: '#0f172a',
  },
  telemetryCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    gap: 6,
    backgroundColor: '#f8fafc',
  },
  telemetryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    gap: 12,
  },
  leaderboardRank: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  leaderboardName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  leaderboardMeta: {
    fontSize: 12,
    color: '#475569',
  },
  leaderboardValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  helper: {
    fontSize: 12,
    color: '#475569',
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
    fontSize: 13,
  },
});
