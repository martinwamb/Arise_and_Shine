import React, { useCallback, useEffect, useRef, useState } from 'react';
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

type TimelineEvent =
  | { type: 'arrival'; startDisplay: string; endDisplay: string; location: string; durationMin: number }
  | { type: 'stop'; startDisplay: string; endDisplay: string; location: string; durationMin: number }
  | { type: 'trip'; startDisplay: string; endDisplay: string; destination: string; distanceKm: number | null; durationMin: number }
  | { type: 'ongoing'; startDisplay: string; destination: string };

type TimelineDay = { date: string; dateDisplay: string; events: TimelineEvent[] };
type TimelineTruck = { plate: string; truckId: string; days: TimelineDay[] };
type TimelineData = { trucks: TimelineTruck[] };

const FORMATS = ['excel', 'pdf'] as const;

function fmtDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '';
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

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

  // Timeline state (vehicle-trip-timeline only)
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);

  const isTimelineReport = selectedReport === 'vehicle-trip-timeline';

  const loadDefinitions = useCallback(async () => {
    try {
      const res = await api.get('/api/reports/definitions');
      setDefinitions(res.data?.definitions || []);
      setFormats(res.data?.formats || FORMATS);
      if (!selectedReport && res.data?.definitions?.length) {
        const first = res.data.definitions[0];
        setSelectedReport(first.key);
        const defaultRange = first?.filters?.defaultRangeDays;
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

  // Update date range whenever the selected report changes
  useEffect(() => {
    const def = definitions.find((d) => d.key === selectedReport);
    if (!def?.filters?.defaultRangeDays) return;
    const days = def.filters.defaultRangeDays;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - Math.max(1, days));
    setToDate(end.toISOString().slice(0, 10));
    setFromDate(start.toISOString().slice(0, 10));
  }, [selectedReport]);

  const fetchTimeline = useCallback(async () => {
    if (!selectedReport) return;
    setTimelineLoading(true);
    setTimelineError(null);
    try {
      const filters: any = { fromDate: fromDate || undefined, toDate: toDate || undefined };
      if (truckId) filters.truckId = truckId;
      const res = await api.post('/api/reports/data', { reportKey: selectedReport, filters });
      setTimelineData(res.data?.timeline || null);
    } catch (err: any) {
      setTimelineError(err?.response?.data?.error || 'Failed to load timeline.');
      setTimelineData(null);
    } finally {
      setTimelineLoading(false);
    }
  }, [api, selectedReport, fromDate, toDate, truckId]);

  // Auto-fetch timeline when report/dates change
  useEffect(() => {
    if (!isTimelineReport || !fromDate || !toDate) return;
    setTimelineData(null);
    fetchTimeline();
  }, [selectedReport, fromDate, toDate, truckId]);

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
      {/* ── Export controls ── */}
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
              <TouchableOpacity
                key={def.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setSelectedReport(def.key)}
              >
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
              <TouchableOpacity
                key={fmt}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setSelectedFormat(fmt)}
              >
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

      {/* ── Timeline view (vehicle-trip-timeline only) ── */}
      {isTimelineReport && (
        <View style={styles.timelineSection}>
          <View style={styles.timelineHeader}>
            <Text style={styles.timelineTitle}>Trip Timeline</Text>
            <TouchableOpacity onPress={fetchTimeline} disabled={timelineLoading} style={styles.refreshBtn}>
              <Text style={styles.refreshBtnText}>{timelineLoading ? 'Loading…' : 'Refresh'}</Text>
            </TouchableOpacity>
          </View>

          {timelineError && <Text style={styles.error}>{timelineError}</Text>}

          {timelineLoading && (
            <View style={styles.statusRow}>
              <ActivityIndicator size="small" color="#94a3b8" />
              <Text style={styles.statusText}>Loading timeline…</Text>
            </View>
          )}

          {!timelineLoading && timelineData !== null && timelineData.trucks.length === 0 && (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>No trip data for the selected period.</Text>
              <Text style={styles.emptyHint}>Try a different date range or truck filter.</Text>
            </View>
          )}

          {timelineData?.trucks.map((truck) => (
            <View key={truck.truckId} style={styles.truckCard}>
              {/* Truck header */}
              <View style={styles.truckHeader}>
                <Text style={styles.truckPlate}>{truck.plate}</Text>
                <Text style={styles.truckMeta}>
                  {truck.days.length} day{truck.days.length !== 1 ? 's' : ''} ·{' '}
                  {truck.days.reduce((n, d) => n + d.events.length, 0)} events
                </Text>
              </View>

              {/* Days */}
              {truck.days.map((day) => (
                <View key={day.date} style={styles.dayGroup}>
                  <Text style={styles.dayLabel}>{day.dateDisplay}</Text>

                  {/* Events */}
                  <View style={styles.eventList}>
                    {day.events.map((ev, i) => {
                      const isLast = i === day.events.length - 1;
                      return (
                        <View key={i} style={styles.eventRow}>
                          {/* Dot + connector line */}
                          <View style={styles.dotCol}>
                            <View
                              style={[
                                styles.dot,
                                ev.type === 'arrival' && styles.dotArrival,
                                ev.type === 'stop' && styles.dotStop,
                                ev.type === 'trip' && styles.dotTrip,
                                ev.type === 'ongoing' && styles.dotOngoing,
                              ]}
                            />
                            {!isLast && <View style={styles.connector} />}
                          </View>

                          {/* Event content */}
                          <View style={[styles.eventContent, !isLast && { paddingBottom: 12 }]}>
                            <Text style={styles.eventTime}>
                              {ev.type !== 'ongoing'
                                ? `${ev.startDisplay}–${ev.endDisplay}`
                                : `${ev.startDisplay}–now`}
                            </Text>

                            {(ev.type === 'arrival' || ev.type === 'stop') && (
                              <View style={styles.eventDescRow}>
                                <Text style={[styles.eventLocation, ev.type === 'arrival' && styles.bold]}>
                                  {ev.location}
                                </Text>
                                {ev.type === 'arrival' && (
                                  <View style={styles.arrivalBadge}>
                                    <Text style={styles.arrivalBadgeText}>ARRIVAL</Text>
                                  </View>
                                )}
                                {ev.durationMin > 0 && (
                                  <Text style={styles.eventMeta}>{fmtDuration(ev.durationMin)}</Text>
                                )}
                              </View>
                            )}

                            {ev.type === 'trip' && (
                              <View style={styles.eventDescRow}>
                                <Text style={styles.eventVerb}>Drove to</Text>
                                <Text style={[styles.eventLocation, styles.bold]}>{ev.destination}</Text>
                                {ev.distanceKm != null && (
                                  <View style={styles.distBadge}>
                                    <Text style={styles.distBadgeText}>{ev.distanceKm} km</Text>
                                  </View>
                                )}
                                <Text style={styles.eventMeta}>{fmtDuration(ev.durationMin)}</Text>
                              </View>
                            )}

                            {ev.type === 'ongoing' && (
                              <View style={styles.eventDescRow}>
                                <Text style={styles.eventVerb}>Driving to</Text>
                                <Text style={[styles.eventLocation, styles.bold, styles.amber]}>
                                  {ev.destination}
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
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
    fontSize: 12,
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

  // ── Timeline ──
  timelineSection: {
    gap: 10,
  },
  timelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timelineTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  refreshBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  emptyBox: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#94a3b8',
  },
  emptyHint: {
    fontSize: 11,
    color: '#cbd5e1',
    marginTop: 4,
  },
  truckCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  truckHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  truckPlate: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  truckMeta: {
    fontSize: 11,
    color: '#94a3b8',
  },
  dayGroup: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  dayLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#94a3b8',
    marginBottom: 8,
  },
  eventList: {
    marginLeft: 4,
  },
  eventRow: {
    flexDirection: 'row',
    gap: 10,
  },
  dotCol: {
    alignItems: 'center',
    width: 12,
    marginTop: 3,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#cbd5e1',
  },
  dotArrival: {
    backgroundColor: '#0f172a',
  },
  dotStop: {
    backgroundColor: '#cbd5e1',
  },
  dotTrip: {
    width: 8,
    height: 8,
    borderRadius: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    // arrow symbol rendered via text instead
  },
  dotOngoing: {
    backgroundColor: '#f59e0b',
  },
  connector: {
    width: 2,
    flex: 1,
    minHeight: 12,
    backgroundColor: '#f1f5f9',
    marginTop: 2,
  },
  eventContent: {
    flex: 1,
    paddingBottom: 2,
    gap: 2,
  },
  eventTime: {
    fontSize: 11,
    color: '#94a3b8',
    fontVariant: ['tabular-nums'],
  },
  eventDescRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  eventVerb: {
    fontSize: 12,
    color: '#64748b',
  },
  eventLocation: {
    fontSize: 12,
    color: '#334155',
  },
  bold: {
    fontWeight: '700',
    color: '#0f172a',
  },
  amber: {
    color: '#b45309',
  },
  eventMeta: {
    fontSize: 11,
    color: '#94a3b8',
  },
  arrivalBadge: {
    borderRadius: 4,
    backgroundColor: '#0f172a',
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  arrivalBadgeText: {
    fontSize: 9,
    color: '#fff',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  distBadge: {
    borderRadius: 4,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  distBadgeText: {
    fontSize: 10,
    color: '#475569',
    fontWeight: '600',
  },
});
