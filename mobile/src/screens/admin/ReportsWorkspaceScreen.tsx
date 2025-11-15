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

type ReportDefinition = {
  key: string;
  title: string;
  description: string;
  filters?: {
    requiresDateRange?: boolean;
    allowDriverId?: boolean;
    allowTruckId?: boolean;
    defaultRangeDays?: number;
  };
};

const FORMATS = ['excel', 'pdf'] as const;

export default function ReportsWorkspaceScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [definitions, setDefinitions] = useState<ReportDefinition[]>([]);
  const [formats, setFormats] = useState<string[]>(FORMATS as any);
  const [selectedReport, setSelectedReport] = useState('');
  const [selectedFormat, setSelectedFormat] = useState('excel');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [driverId, setDriverId] = useState('');
  const [truckId, setTruckId] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const loadDefinitions = useCallback(async () => {
    try {
      const res = await api.get('/api/reports/definitions');
      setDefinitions(res.data?.definitions || []);
      setFormats(res.data?.formats || FORMATS);
      if (!selectedReport && res.data?.definitions?.length) {
        setSelectedReport(res.data.definitions[0].key);
        const defaultRange = res.data.definitions[0]?.filters?.defaultRangeDays;
        if (defaultRange) {
          const end = new Date();
          const start = new Date();
          start.setDate(start.getDate() - defaultRange);
          setFromDate(start.toISOString().slice(0, 10));
          setToDate(end.toISOString().slice(0, 10));
        }
      }
    } catch (err: any) {
      setMessage(err?.response?.data?.error || 'Unable to load report definitions.');
    }
  }, [api, selectedReport]);

  useEffect(() => {
    loadDefinitions();
  }, [loadDefinitions]);

  const handleExport = useCallback(async () => {
    if (!selectedReport) {
      setMessage('Select a report to export.');
      return;
    }
    setStatus('loading');
    setMessage(null);
    try {
      const filters: any = {
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      };
      if (driverId) filters.driverId = driverId;
      if (truckId) filters.truckId = truckId;
      const res = await api.post('/api/reports/export', {
        reportKey: selectedReport,
        format: selectedFormat,
        filters,
      });
      Alert.alert('Export ready', `File: ${res.data?.fileName || 'report'}`);
    } catch (err: any) {
      setMessage(err?.response?.data?.error || 'Failed to export report.');
    } finally {
      setStatus('idle');
    }
  }, [api, driverId, fromDate, selectedFormat, selectedReport, toDate, truckId]);

  const selectedDefinition = definitions.find((def) => def.key === selectedReport);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.title}>Reports workspace</Text>
        <Text style={styles.subtitle}>Export Excel/PDF packs for finance, fleet, and compliance.</Text>
        {status === 'loading' && (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text style={styles.statusText}>Preparing export…</Text>
          </View>
        )}
        {message && <Text style={styles.error}>{message}</Text>}
        <Text style={styles.label}>Report</Text>
        <View style={styles.chipRow}>
          {definitions.map((def) => {
            const active = def.key === selectedReport;
            return (
              <TouchableOpacity key={def.key} style={[styles.chip, active && styles.chipActive]} onPress={() => setSelectedReport(def.key)}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{def.title}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.helper}>{selectedDefinition?.description}</Text>

        <Text style={styles.label}>Format</Text>
        <View style={styles.chipRow}>
          {formats.map((fmt) => {
            const active = fmt === selectedFormat;
            return (
              <TouchableOpacity key={fmt} style={[styles.chip, active && styles.chipActive]} onPress={() => setSelectedFormat(fmt)}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{fmt.toUpperCase()}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {selectedDefinition?.filters?.requiresDateRange !== false && (
          <>
            <Field label="From date" value={fromDate} onChangeText={setFromDate} placeholder="YYYY-MM-DD" />
            <Field label="To date" value={toDate} onChangeText={setToDate} placeholder="YYYY-MM-DD" />
          </>
        )}
        {selectedDefinition?.filters?.allowDriverId && (
          <Field label="Driver ID" value={driverId} onChangeText={setDriverId} placeholder="e.g. DRV-001" />
        )}
        {selectedDefinition?.filters?.allowTruckId && (
          <Field label="Truck ID" value={truckId} onChangeText={setTruckId} placeholder="e.g. TRK-001" />
        )}

        <TouchableOpacity style={styles.primaryButton} onPress={handleExport} disabled={status === 'loading'}>
          <Text style={styles.primaryButtonText}>{status === 'loading' ? 'Exporting…' : 'Export report'}</Text>
        </TouchableOpacity>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fef9f2',
  },
  content: {
    padding: 20,
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
  label: {
    fontSize: 11,
    textTransform: 'uppercase',
    color: '#94a3b8',
    fontWeight: '600',
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
  field: {
    gap: 6,
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  textarea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  helper: {
    fontSize: 12,
    color: '#475569',
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
});
