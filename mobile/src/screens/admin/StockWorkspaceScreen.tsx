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
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../contexts/AuthContext';
import type { StockSummary, StockTransaction } from '../../types';
import { formatDateTime } from '../../utils/format';

type ReceiptForm = {
  truckId: string;
  category: 'coarse' | 'smooth';
  trucks: string;
  weightTonnes: string;
  costPerTonne: string;
  description: string;
  photoData: string;
  photoPreview: string;
};

const initialReceiptForm: ReceiptForm = {
  truckId: '',
  category: 'coarse',
  trucks: '',
  weightTonnes: '',
  costPerTonne: '',
  description: '',
  photoData: '',
  photoPreview: '',
};

export default function StockWorkspaceScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [stock, setStock] = useState<StockSummary | null>(null);
  const [transactions, setTransactions] = useState<StockTransaction[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<ReceiptForm>(initialReceiptForm);
  const [submitting, setSubmitting] = useState(false);

  const loadStock = useCallback(async () => {
    try {
      setStatus('loading');
      setMessage(null);
      const [summaryRes, txRes] = await Promise.all([
        api.get('/api/admin/stock'),
        api.get('/api/admin/stock/tx'),
      ]);
      setStock(mapStock(summaryRes.data));
      setTransactions(Array.isArray(txRes.data) ? txRes.data.map(mapTransaction) : []);
      setStatus('idle');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.response?.data?.error || 'Failed to load stock data.');
    }
  }, [api]);

  useEffect(() => {
    loadStock();
  }, [loadStock]);

  const pickPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Allow photo library access to attach weighbridge slips.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const preview = asset.uri || '';
    const data = asset.base64 ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}` : '';
    setForm((prev) => ({ ...prev, photoData: data, photoPreview: preview }));
  }, []);

  const submitReceipt = useCallback(async () => {
    if (submitting) return;
    if (!form.truckId.trim()) {
      Alert.alert('Truck required', 'Enter the truck ID that delivered the stock.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        truckId: form.truckId.trim(),
        category: form.category,
        trucks: form.trucks ? Number(form.trucks) : undefined,
        weightTonnes: form.weightTonnes ? Number(form.weightTonnes) : undefined,
        costPerTonne: form.costPerTonne ? Number(form.costPerTonne) : undefined,
        description: form.description.trim() || undefined,
        photoData: form.photoData || undefined,
      };
      await api.post('/api/admin/stock/receipt', payload);
      setForm(initialReceiptForm);
      await loadStock();
      Alert.alert('Receipt captured', 'Stock levels updated.');
    } catch (err: any) {
      Alert.alert('Failed to capture receipt', err?.response?.data?.error || 'Unable to process stock receipt.');
    } finally {
      setSubmitting(false);
    }
  }, [api, form, loadStock, submitting]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.title}>Stock summary</Text>
        {status === 'loading' && (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text style={styles.statusText}>Updating yard totals…</Text>
          </View>
        )}
        {status === 'error' && message && <Text style={styles.error}>{message}</Text>}
        {stock && (
          <View style={styles.summaryGrid}>
            <SummaryCard label="Total trucks" value={stock.trucksCoarse + stock.trucksSmooth} detail={`${stock.tonnes} tonnes`} />
            <SummaryCard label="Coarse" value={stock.trucksCoarse} detail={`${stock.trucksCoarse * stock.unitTonnes} tonnes`} />
            <SummaryCard label="Smooth" value={stock.trucksSmooth} detail={`${stock.trucksSmooth * stock.unitTonnes} tonnes`} />
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Capture stock receipt</Text>
        <Text style={styles.subtitle}>Log incoming trucks with weighbridge photos and cost.</Text>
        <Field label="Truck ID" value={form.truckId} onChangeText={(text) => setForm((prev) => ({ ...prev, truckId: text }))} />
        <View style={styles.chipRow}>
          {(['coarse', 'smooth'] as const).map((type) => {
            const active = form.category === type;
            return (
              <TouchableOpacity key={type} style={[styles.chip, active && styles.chipActive]} onPress={() => setForm((prev) => ({ ...prev, category: type }))}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{type.toUpperCase()}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Field label="Trucks" value={form.trucks} onChangeText={(text) => setForm((prev) => ({ ...prev, trucks: text }))} keyboardType="numeric" />
        <Field label="Weight (tonnes)" value={form.weightTonnes} onChangeText={(text) => setForm((prev) => ({ ...prev, weightTonnes: text }))} keyboardType="numeric" />
        <Field label="Cost per tonne" value={form.costPerTonne} onChangeText={(text) => setForm((prev) => ({ ...prev, costPerTonne: text }))} keyboardType="numeric" />
        <Field label="Description" value={form.description} onChangeText={(text) => setForm((prev) => ({ ...prev, description: text }))} />
        <TouchableOpacity style={styles.secondaryButton} onPress={pickPhoto}>
          <Text style={styles.secondaryButtonText}>{form.photoPreview ? 'Replace photo' : 'Attach weighbridge photo'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.primaryButton} onPress={submitReceipt} disabled={submitting}>
          <Text style={styles.primaryButtonText}>{submitting ? 'Submitting…' : 'Capture receipt'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Recent transactions</Text>
        {transactions.map((tx) => (
          <View key={tx.id} style={styles.txRow}>
            <View>
              <Text style={styles.txTitle}>
                {tx.kind} · {tx.category?.toUpperCase()}
              </Text>
              <Text style={styles.txMeta}>
                {tx.trucks} trucks · {tx.tonnes} tonnes
              </Text>
              <Text style={styles.txMeta}>{tx.reason}</Text>
            </View>
            <Text style={styles.txMeta}>{formatDateTime(tx.createdAt)}</Text>
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

function SummaryCard({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
      {detail && <Text style={styles.summaryDetail}>{detail}</Text>}
    </View>
  );
}

const mapStock = (row: any): StockSummary => ({
  yardName: row?.yard_name || row?.yardName || 'Main yard',
  tonnes: Number(row?.tonnes || 0),
  trucksCoarse: Number(row?.trucks_coarse || row?.trucksCoarse || 0),
  trucksSmooth: Number(row?.trucks_smooth || row?.trucksSmooth || 0),
  unitTonnes: Number(row?.unit_tonnes || row?.unitTonnes || 20),
  updatedAt: row?.updated_at || row?.updatedAt || null,
});

const mapTransaction = (row: any): StockTransaction => ({
  id: row.id,
  kind: row.kind,
  tonnes: Number(row.tonnes || 0),
  trucks: Number(row.trucks || 0),
  category: row.category || '',
  reason: row.reason || '',
  orderId: row.order_id || null,
  truckId: row.truck_id || null,
  createdAt: row.created_at || row.createdAt || new Date().toISOString(),
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
    borderColor: '#fde68a',
    backgroundColor: '#fff',
    padding: 16,
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
    borderColor: '#fde68a',
    padding: 14,
  },
  summaryLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    color: '#94a3b8',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  summaryDetail: {
    fontSize: 12,
    color: '#475569',
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
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
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
  txRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    backgroundColor: '#fff7ed',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  txTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  txMeta: {
    fontSize: 12,
    color: '#475569',
  },
});
