import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import type { TelemetryItem } from '../../types';

type DriverOption = { id: string; name: string };

export default function FleetViewScreen() {
  const {
    apiClient: { api },
    user,
  } = useAuth();
  const [telemetry, setTelemetry] = useState<TelemetryItem[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [savingDriverFor, setSavingDriverFor] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const canReassign = useMemo(() => user?.role === 'ADMIN' || user?.role === 'OPS', [user?.role]);

  const fetchTelemetry = useCallback(
    async ({ silent }: { silent?: boolean } = {}) => {
      try {
        if (!silent) setStatus('loading');
        const res = await api.get('/api/telemetry/trucks');
        setTelemetry(Array.isArray(res.data) ? res.data : []);
        setStatus('idle');
      } catch (err: any) {
        if (!silent) {
          setStatus('error');
          setMessage(err?.response?.data?.error || 'Unable to fetch live truck data.');
        }
      }
    },
    [api],
  );

  const loadDrivers = useCallback(async () => {
    if (!canReassign) return;
    try {
      const res = await api.get('/api/admin/drivers');
      const list = Array.isArray(res.data)
        ? res.data.map((d: any) => ({ id: d.id, name: d.name || d.id }))
        : [];
      setDrivers(list);
    } catch {
      setDrivers([]);
    }
  }, [api, canReassign]);

  useEffect(() => {
    fetchTelemetry();
    loadDrivers();
    const interval = setInterval(() => fetchTelemetry({ silent: true }), 30000);
    return () => clearInterval(interval);
  }, [fetchTelemetry, loadDrivers]);

  const assignDriver = useCallback(
    async (truckId: string, driverId: string | null) => {
      if (!canReassign) return;
      setSavingDriverFor(truckId);
      try {
        await api.patch(`/api/admin/trucks/${truckId}`, { primaryDriverId: driverId });
        await fetchTelemetry({ silent: true });
        Alert.alert('Driver updated', 'Assignment saved successfully.');
      } catch (err: any) {
        Alert.alert('Failed to update', err?.response?.data?.error || 'Unable to update driver assignment.');
      } finally {
        setSavingDriverFor(null);
      }
    },
    [api, canReassign, fetchTelemetry],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([fetchTelemetry()]);
    setRefreshing(false);
  }, [fetchTelemetry]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <Text style={styles.title}>Fleet telemetry</Text>
      <Text style={styles.subtitle}>Live GPS, load board, and driver reassignment.</Text>

      {status === 'loading' && (
        <View style={styles.statusRow}>
          <ActivityIndicator />
          <Text style={styles.statusText}>Fetching live truck data…</Text>
        </View>
      )}
      {status === 'error' && message && <Text style={styles.error}>{message}</Text>}

      {telemetry.length === 0 && status === 'idle' && (
        <Text style={styles.helper}>No telemetry yet. Configure your Protrack credentials to begin streaming.</Text>
      )}

      {telemetry.map((item) => (
        <View key={item.truckId} style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>{item.plate || item.truckId}</Text>
              <Text style={styles.cardMeta}>{item.status || 'Awaiting update'}</Text>
            </View>
            <Text style={[styles.badge, Number(item.speed || 0) > 5 ? styles.badgeGreen : styles.badgeAmber]}>
              {item.speed !== null && item.speed !== undefined ? `${Math.round(Number(item.speed))} km/h` : 'n/a'}
            </Text>
          </View>
          <Text style={styles.cardMeta}>
            {item.address
              ? item.address
              : item.lat && item.lng
              ? `Lat ${Number(item.lat).toFixed(3)}, Lng ${Number(item.lng).toFixed(3)}`
              : 'Location refreshing'}
          </Text>
          <View style={styles.row}>
            <Text style={styles.cardMeta}>
              Updated {item.lastUpdated ? new Date(item.lastUpdated).toLocaleTimeString() : 'just now'}
            </Text>
            {typeof item.idleMinutes === 'number' && (
              <Text style={styles.cardMeta}>{item.idleMinutes} min idle</Text>
            )}
          </View>
          <View style={styles.row}>
            <Text style={styles.cardMeta}>
              Driver: {item.driverName || 'Unassigned'}
              {item.driverPhone ? ` · ${item.driverPhone}` : ''}
            </Text>
          </View>
          {canReassign && (
            <View style={styles.assignRow}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.select}>
                <TouchableOpacity
                  style={[styles.chip, !item.driverId && styles.chipActive]}
                  onPress={() => assignDriver(item.truckId, null)}
                  disabled={savingDriverFor === item.truckId}
                >
                  <Text style={[styles.chipText, !item.driverId && styles.chipTextActive]}>Unassign</Text>
                </TouchableOpacity>
                {drivers.map((driver) => {
                  const active = driver.id === item.driverId;
                  return (
                    <TouchableOpacity
                      key={driver.id}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => assignDriver(item.truckId, driver.id)}
                      disabled={savingDriverFor === item.truckId}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{driver.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </View>
      ))}
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
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 14,
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
  helper: {
    fontSize: 13,
    color: '#475569',
  },
  error: {
    color: '#b91c1c',
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    padding: 16,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardMeta: {
    fontSize: 12,
    color: '#475569',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: '700',
  },
  badgeGreen: {
    backgroundColor: '#d1fae5',
    color: '#065f46',
  },
  badgeAmber: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  assignRow: {
    marginTop: 8,
  },
  select: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  chipText: {
    fontSize: 12,
    color: '#475569',
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
});
