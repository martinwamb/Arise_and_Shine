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
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../contexts/AuthContext';
import type { FuelFormState, FuelLog, TruckOption } from '../../types';
import { formatDateTime, formatKes } from '../../utils/format';

const initialFuelForm = (): FuelFormState => ({
  truckId: '',
  litres: '',
  cost: '',
  odometer: '',
  note: '',
  photoData: '',
  photoPreview: '',
});

type DuplicatePrompt = {
  message: string;
  existing: Partial<FuelLog> | null;
  payload: any;
};

export default function FuelMonitorScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState(initialFuelForm());
  const [submitting, setSubmitting] = useState(false);
  const [trucks, setTrucks] = useState<TruckOption[]>([]);
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePrompt | null>(null);
  const [confirmingDuplicate, setConfirmingDuplicate] = useState(false);

  const loadLogs = useCallback(async () => {
    try {
      setStatus('loading');
      setMessage(null);
      const res = await api.get('/api/fuel/logs', { params: { limit: 50 } });
      setLogs(Array.isArray(res.data) ? res.data : []);
      setStatus('idle');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.response?.data?.error || 'Unable to load fuel logs.');
    }
  }, [api]);

  const loadTrucks = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/trucks');
      setTrucks(Array.isArray(res.data) ? res.data : []);
    } catch {
      setTrucks([]);
    }
  }, [api]);

  useEffect(() => {
    loadLogs();
    loadTrucks();
  }, [loadLogs, loadTrucks]);

  const processPickerResult = useCallback((result: ImagePicker.ImagePickerResult) => {
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const preview = asset.uri || '';
    const data = asset.base64 ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}` : '';
    setForm((prev) => ({ ...prev, photoPreview: preview, photoData: data }));
  }, []);

  const pickPhoto = useCallback(() => {
    Alert.alert('Add receipt photo', 'Choose how to attach the pump slip', [
      {
        text: 'Take photo',
        onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Permission required', 'Allow camera access to take pump slip photos.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, base64: true });
          processPickerResult(result);
        },
      },
      {
        text: 'Choose from library',
        onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            Alert.alert('Permission required', 'Allow photo library access to attach pump slips.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, base64: true });
          processPickerResult(result);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [processPickerResult]);

  const resetForm = useCallback(() => {
    setForm(initialFuelForm());
  }, []);

  const submitLog = useCallback(
    async (override?: { duplicateOf?: string }) => {
      if (submitting) return;
      setSubmitting(true);
      setMessage(null);
      setDuplicatePrompt(null);
      try {
        const payload: any = {
          truckId: form.truckId || null,
          litres: form.litres ? Number(form.litres) : null,
          cost: form.cost ? Number(form.cost) : null,
          odometer: form.odometer ? Number(form.odometer) : null,
          note: form.note,
          photoData: form.photoData || undefined,
        };
        if (override?.duplicateOf) {
          payload.overrideDuplicate = true;
          payload.duplicateOf = override.duplicateOf;
        }
        await api.post('/api/fuel/logs', payload);
        setMessage('Fuel log captured.');
        resetForm();
        await loadLogs();
      } catch (err: any) {
        if (err?.response?.status === 409 && err?.response?.data?.duplicate) {
          setDuplicatePrompt({
            message: err?.response?.data?.message || 'Potential duplicate entry detected.',
            existing: err?.response?.data?.existing || null,
            payload: {
              truckId: form.truckId || null,
              litres: form.litres ? Number(form.litres) : null,
              cost: form.cost ? Number(form.cost) : null,
              odometer: form.odometer ? Number(form.odometer) : null,
              note: form.note,
              photoData: form.photoData || undefined,
            },
          });
        } else {
          setMessage(err?.response?.data?.error || 'Failed to save the fuel log.');
        }
      } finally {
        setSubmitting(false);
      }
    },
    [api, form.cost, form.litres, form.note, form.odometer, form.photoData, form.truckId, loadLogs, resetForm, submitting],
  );

  const confirmDuplicate = useCallback(async () => {
    if (!duplicatePrompt) return;
    setConfirmingDuplicate(true);
    try {
      const duplicateOf = duplicatePrompt.existing?.duplicateOf || duplicatePrompt.existing?.id || undefined;
      await submitLog({ duplicateOf });
      setDuplicatePrompt(null);
    } finally {
      setConfirmingDuplicate(false);
    }
  }, [duplicatePrompt, submitLog]);

  const truckName = useCallback(
    (truckId: string) => {
      const truck = trucks.find((t) => t.id === truckId);
      return truck?.plate || truckId || 'Truck';
    },
    [trucks],
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.title}>Fuel & mileage monitor</Text>
        <Text style={styles.subtitle}>Capture pump readings, odometer photos, and notes.</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Truck</Text>
          <View style={styles.select}>
            {trucks.map((truck) => {
              const active = truck.id === form.truckId;
              return (
                <TouchableOpacity
                  key={truck.id}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setForm((prev) => ({ ...prev, truckId: truck.id }))}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {truck.plate || truck.id}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.row}>
          <FuelInput label="Litres" value={form.litres} onChangeText={(text) => setForm((prev) => ({ ...prev, litres: text }))} keyboardType="numeric" />
          <FuelInput label="Cost" value={form.cost} onChangeText={(text) => setForm((prev) => ({ ...prev, cost: text }))} keyboardType="numeric" />
        </View>

        <FuelInput
          label="Odometer"
          value={form.odometer}
          onChangeText={(text) => setForm((prev) => ({ ...prev, odometer: text }))}
          keyboardType="numeric"
        />

        <FuelInput
          label="Note"
          multiline
          value={form.note}
          onChangeText={(text) => setForm((prev) => ({ ...prev, note: text }))}
          placeholder="Station, driver, etc."
        />

        <TouchableOpacity style={styles.secondaryButton} onPress={pickPhoto}>
          <Text style={styles.secondaryButtonText}>{form.photoPreview ? 'Replace photo' : 'Attach photo'}</Text>
        </TouchableOpacity>

        {duplicatePrompt && (
          <View style={styles.alert}>
            <Text style={styles.alertText}>{duplicatePrompt.message}</Text>
            <View style={styles.alertActions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setDuplicatePrompt(null)}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={confirmDuplicate}
                disabled={confirmingDuplicate}
              >
                <Text style={styles.primaryButtonText}>
                  {confirmingDuplicate ? 'Confirming…' : 'Ignore & submit'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {message && <Text style={status === 'error' ? styles.error : styles.success}>{message}</Text>}

        <TouchableOpacity style={styles.primaryButton} onPress={() => submitLog()} disabled={submitting}>
          <Text style={styles.primaryButtonText}>{submitting ? 'Saving…' : 'Log fuel stop'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Recent logs</Text>
        {status === 'loading' && (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text style={styles.statusText}>Syncing logs…</Text>
          </View>
        )}
        {logs.map((log) => (
          <View key={log.id} style={styles.logRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.logTitle}>
                {truckName(log.truckId)} · {log.litres || 0} L @ {formatKes(log.cost)}
              </Text>
              <Text style={styles.logMeta}>{formatDateTime(log.capturedAt)}</Text>
              <Text style={styles.logMeta}>{log.note || 'No note'}</Text>
            </View>
            {log.isDuplicate && <Text style={styles.logDuplicate}>Duplicate</Text>}
          </View>
        ))}
        {!logs.length && status === 'idle' && <Text style={styles.subtitle}>No logs captured yet.</Text>}
      </View>
    </ScrollView>
  );
}

function FuelInput({
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
  field: {
    gap: 6,
  },
  label: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#94a3b8',
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    fontSize: 14,
    color: '#0f172a',
  },
  textarea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  select: {
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
  row: {
    flexDirection: 'row',
    gap: 12,
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
  success: {
    color: '#065f46',
  },
  logRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    gap: 12,
  },
  logTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  logMeta: {
    fontSize: 12,
    color: '#475569',
  },
  logDuplicate: {
    color: '#b45309',
    fontWeight: '700',
  },
  alert: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f59e0b',
    padding: 12,
    backgroundColor: '#fffbeb',
    gap: 8,
  },
  alertText: {
    fontSize: 13,
    color: '#92400e',
  },
  alertActions: {
    flexDirection: 'row',
    gap: 10,
  },
});
