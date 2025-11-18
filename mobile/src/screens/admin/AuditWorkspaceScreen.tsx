import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import type { AuditRecord } from '../../types';
import { formatDateTime, formatKes } from '../../utils/format';

type EntityFilter = 'all' | 'cost' | 'fuel';
type StatusFilter = 'pending' | 'reviewed' | 'voided' | 'all';

export default function AuditWorkspaceScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [entity, setEntity] = useState<EntityFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    try {
      setLoading(true);
      setMessage(null);
      const res = await api.get('/api/admin/audit/duplicates', {
        params: {
          entity: entity === 'all' ? undefined : entity,
          status: status === 'all' ? undefined : status,
          limit: 200,
        },
      });
      setRecords(Array.isArray(res.data) ? res.data.map(mapAuditRecord) : []);
    } catch (err: any) {
      setMessage(err?.response?.data?.error || 'Failed to load potential duplicates.');
    } finally {
      setLoading(false);
    }
  }, [api, entity, status]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const reviewRecord = useCallback(
    async (record: AuditRecord) => {
      try {
        await api.post(`/api/admin/audit/duplicates/${record.entity}/${record.id}/review`, { note: 'Reviewed via mobile' });
        await loadRecords();
      } catch (err: any) {
        Alert.alert('Review failed', err?.response?.data?.error || 'Unable to mark as reviewed.');
      }
    },
    [api, loadRecords],
  );

  const voidRecord = useCallback(
    async (record: AuditRecord) => {
      Alert.alert('Void record', 'Are you sure you want to void this duplicate?', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Void',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.post(`/api/admin/audit/duplicates/${record.entity}/${record.id}/void`, {
                reason: 'Voided via mobile audit console',
              });
              await loadRecords();
            } catch (err: any) {
              Alert.alert('Void failed', err?.response?.data?.error || 'Unable to void record.');
            }
          },
        },
      ]);
    },
    [api, loadRecords],
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.title}>Audit console</Text>
        <Text style={styles.subtitle}>Review and void potential duplicate costs and fuel logs.</Text>
        <View style={styles.chipRow}>
          {(['all', 'cost', 'fuel'] as EntityFilter[]).map((value) => {
            const active = value === entity;
            return (
              <TouchableOpacity key={value} style={[styles.chip, active && styles.chipActive]} onPress={() => setEntity(value)}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{value.toUpperCase()}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.chipRow}>
          {(['pending', 'reviewed', 'voided', 'all'] as StatusFilter[]).map((value) => {
            const active = value === status;
            return (
              <TouchableOpacity key={value} style={[styles.chip, active && styles.chipActive]} onPress={() => setStatus(value)}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{value.toUpperCase()}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity style={styles.secondaryButton} onPress={loadRecords}>
          <Text style={styles.secondaryButtonText}>Refresh</Text>
        </TouchableOpacity>
        {loading && (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text style={styles.statusText}>Scanning duplicates…</Text>
          </View>
        )}
        {message && <Text style={styles.error}>{message}</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.subtitle}>Potential duplicates</Text>
        {records.map((record) => (
          <View key={record.id} style={styles.recordCard}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.recordTitle}>
                {record.entity.toUpperCase()} · {record.summary}
              </Text>
              <Text style={styles.recordMeta}>
                {record.truckId ? `Truck ${record.truckId}` : 'Truck n/a'} · {record.driverId ? `Driver ${record.driverId}` : 'Driver n/a'}
              </Text>
              {record.amount !== null && record.amount !== undefined && (
                <Text style={styles.recordMeta}>Amount {formatKes(record.amount)}</Text>
              )}
              <Text style={styles.recordMeta}>{record.eventAt ? formatDateTime(record.eventAt) : 'Event time n/a'}</Text>
              <Text style={styles.recordMeta}>Status {record.status.toUpperCase()}</Text>
            </View>
            {record.status === 'voided' ? null : (
              <View style={styles.actions}>
                {record.status !== 'reviewed' && (
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => reviewRecord(record)}>
                    <Text style={styles.secondaryButtonText}>Mark reviewed</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.primaryButton} onPress={() => voidRecord(record)}>
                  <Text style={styles.primaryButtonText}>Void</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
        {!records.length && !loading && <Text style={styles.subtitle}>No duplicates found.</Text>}
      </View>
    </ScrollView>
  );
}

const mapAuditRecord = (row: any): AuditRecord => ({
  id: row.id,
  entity: (row.entity || row.entityType || 'cost') as AuditRecord['entity'],
  status: (row.status || 'pending') as AuditRecord['status'],
  summary: row.summary || row.message || 'Potential duplicate',
  truckId: row.truckId || row.truck_id || null,
  driverId: row.driverId || row.driver_id || null,
  amount: row.amount !== undefined ? Number(row.amount) : null,
  eventAt: row.eventAt || row.createdAt || row.created_at || null,
});

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
    padding: 16,
    backgroundColor: '#fff',
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 13,
    color: '#475569',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  secondaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  primaryButton: {
    borderRadius: 999,
    backgroundColor: '#b91c1c',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
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
  recordCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    backgroundColor: '#fff7ed',
    flexDirection: 'row',
    gap: 10,
  },
  recordTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  recordMeta: {
    fontSize: 12,
    color: '#475569',
  },
  actions: {
    gap: 6,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
