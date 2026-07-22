import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import type { CostRecord, TruckOption } from '../../types';
import { formatDateTime, formatKes } from '../../utils/format';

const COST_TYPES = [
  'CUTTING',
  'LOADING',
  'OFFLOADING',
  'EXCHANGE',
  'DRIVER_TIP',
  'MWINGI_TRIP',
  'FUEL',
  'REPAIR',
  'MAINTENANCE',
  'CAR_WASH',
  'GREASING',
  'TIRE_REPAIR',
  'CESS',
  'SALARY_DRIVER',
  'SALARY_TANBOY',
  'STOCK_PURCHASE',
  'OTHER',
];

type CostFormState = {
  truckId: string;
  driverId: string;
  type: string;
  amount: string;
  description: string;
  incurredAt: string;
};

const createEmptyForm = (): CostFormState => ({
  truckId: '',
  driverId: '',
  type: 'FUEL',
  amount: '',
  description: '',
  incurredAt: '',
});

export default function CostsWorkspaceScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [costs, setCosts] = useState<CostRecord[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<CostFormState>(createEmptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [filterType, setFilterType] = useState('');
  const [duplicatePrompt, setDuplicatePrompt] = useState<{ payload: any; existing?: any } | null>(null);
  const [confirmingDuplicate, setConfirmingDuplicate] = useState(false);

  const loadCosts = useCallback(async () => {
    try {
      setStatus('loading');
      setMessage(null);
      const res = await api.get('/api/admin/costs', {
        params: {
          q: filterText || undefined,
          type: filterType || undefined,
        },
      });
      setCosts(Array.isArray(res.data) ? res.data.map(mapCost) : []);
      setStatus('idle');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.response?.data?.error || 'Failed to load costs.');
    }
  }, [api, filterText, filterType]);

  useEffect(() => {
    loadCosts();
  }, [loadCosts]);

  const filteredCosts = useMemo(() => costs, [costs]);

  const handleSubmit = useCallback(
    async (override?: { duplicateOf?: string }) => {
      if (submitting) return;
      if (!form.truckId.trim()) {
        Alert.alert('Truck required', 'Select the truck this cost relates to.');
        return;
      }
      if (form.type === 'OTHER' && !form.description.trim()) {
        Alert.alert('Description required', 'Say what this "Other" cost was for.');
        return;
      }
      const amountValue = Number(form.amount);
      if (!Number.isFinite(amountValue) || amountValue <= 0) {
        Alert.alert('Amount invalid', 'Enter a valid amount.');
        return;
      }
      setSubmitting(true);
      try {
        const payload: any = {
          truckId: form.truckId.trim(),
          driverId: form.driverId.trim() || undefined,
          type: form.type,
          amount: amountValue,
          description: form.description.trim(),
          incurredAt: form.incurredAt || undefined,
        };
        if (override?.duplicateOf) {
          payload.overrideDuplicate = true;
          payload.duplicateOf = override.duplicateOf;
        }
        await api.post('/api/admin/costs', payload);
        setForm(createEmptyForm());
        setDuplicatePrompt(null);
        await loadCosts();
      } catch (err: any) {
        if (err?.response?.status === 409 && err?.response?.data?.duplicate) {
          setDuplicatePrompt({
            payload: {
              truckId: form.truckId.trim(),
              driverId: form.driverId.trim() || undefined,
              type: form.type,
              amount: Number(form.amount),
              description: form.description.trim(),
              incurredAt: form.incurredAt || undefined,
            },
            existing: err.response.data.existing,
          });
        } else {
          Alert.alert('Failed to save cost', err?.response?.data?.error || 'Unable to save cost.');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [api, form, loadCosts, submitting],
  );

  const confirmDuplicate = useCallback(async () => {
    if (!duplicatePrompt) return;
    setConfirmingDuplicate(true);
    try {
      await handleSubmit({ duplicateOf: duplicatePrompt.existing?.duplicate_of || duplicatePrompt.existing?.id });
      setDuplicatePrompt(null);
    } finally {
      setConfirmingDuplicate(false);
    }
  }, [duplicatePrompt, handleSubmit]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.title}>Capture cost</Text>
        <Field label="Truck ID" value={form.truckId} onChangeText={(text) => setForm((prev) => ({ ...prev, truckId: text }))} />
        <Field label="Driver ID" value={form.driverId} onChangeText={(text) => setForm((prev) => ({ ...prev, driverId: text }))} />
        <View style={styles.chipRow}>
          {COST_TYPES.map((type) => {
            const active = form.type === type;
            return (
              <TouchableOpacity key={type} style={[styles.chip, active && styles.chipActive]} onPress={() => setForm((prev) => ({ ...prev, type }))}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{type}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Field label="Amount" value={form.amount} onChangeText={(text) => setForm((prev) => ({ ...prev, amount: text }))} keyboardType="numeric" />
        <Field label="Description" value={form.description} onChangeText={(text) => setForm((prev) => ({ ...prev, description: text }))} />
        <Field label="Incurred date" placeholder="YYYY-MM-DD" value={form.incurredAt} onChangeText={(text) => setForm((prev) => ({ ...prev, incurredAt: text }))} />
        <TouchableOpacity style={styles.primaryButton} onPress={() => handleSubmit()} disabled={submitting}>
          <Text style={styles.primaryButtonText}>{submitting ? 'Saving…' : 'Save cost'}</Text>
        </TouchableOpacity>
        {duplicatePrompt && (
          <View style={styles.alert}>
            <Text style={styles.alertText}>Potential duplicate detected. Continue?</Text>
            <View style={styles.alertActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setDuplicatePrompt(null)}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButton} onPress={confirmDuplicate} disabled={confirmingDuplicate}>
                <Text style={styles.primaryButtonText}>{confirmingDuplicate ? 'Confirming…' : 'Confirm'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Costs history</Text>
        <View style={styles.filterRow}>
          <Field label="Search" value={filterText} onChangeText={setFilterText} />
          <Field label="Type" value={filterType} onChangeText={setFilterType} />
          <TouchableOpacity style={styles.secondaryButton} onPress={loadCosts}>
            <Text style={styles.secondaryButtonText}>Filter</Text>
          </TouchableOpacity>
        </View>
        {status === 'loading' && (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text style={styles.statusText}>Loading costs…</Text>
          </View>
        )}
        {status === 'error' && message && <Text style={styles.error}>{message}</Text>}
        {filteredCosts.map((cost) => (
          <View key={cost.id} style={styles.costRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.costTitle}>
                {cost.type} · {formatKes(cost.amount)}
              </Text>
              <Text style={styles.costMeta}>{cost.description}</Text>
              <Text style={styles.costMeta}>
                Truck {cost.truckId || 'n/a'} · Driver {cost.driverId || 'n/a'}
              </Text>
            </View>
            <Text style={styles.costMeta}>{formatDateTime(cost.incurredAt)}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Field({
  label,
  ...inputProps
}: {
  label: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        style={[styles.input, inputProps.multiline && styles.textarea]}
        placeholderTextColor="#94a3b8"
      />
    </View>
  );
}

const mapCost = (row: any): CostRecord => ({
  id: row.id,
  truckId: row.truck_id || row.truckId || null,
  driverId: row.driver_id || row.driverId || null,
  orderId: row.order_id || row.orderId || null,
  type: row.type,
  amount: Number(row.amount || 0),
  description: row.description || '',
  incurredAt: row.incurred_at || row.incurredAt || row.created_at || new Date().toISOString(),
  duplicateOf: row.duplicate_of || row.duplicateOf || null,
  isDuplicate: Boolean(row.is_duplicate || row.isDuplicate),
});

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
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    padding: 16,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 11,
    textTransform: 'uppercase',
    color: '#94a3b8',
    fontWeight: '600',
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
  textarea: {
    minHeight: 70,
    textAlignVertical: 'top',
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
  primaryButton: {
    borderRadius: 999,
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0f172a',
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 10,
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
  error: {
    color: '#b91c1c',
  },
  alert: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
    padding: 12,
    gap: 8,
  },
  alertText: {
    color: '#92400e',
  },
  alertActions: {
    flexDirection: 'row',
    gap: 8,
  },
  costRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
  },
  costTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  costMeta: {
    fontSize: 12,
    color: '#475569',
  },
});
