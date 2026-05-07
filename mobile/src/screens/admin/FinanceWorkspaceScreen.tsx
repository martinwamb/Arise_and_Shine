import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import type {
  FinancePnl,
  FinanceSummary,
  FinanceTimeseriesPoint,
  FinanceTruckBreakdown,
} from '../../types';
import { formatKes } from '../../utils/format';

type TimeWindow = '7d' | '30d' | '90d';

export default function FinanceWorkspaceScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [timeseries, setTimeseries] = useState<FinanceTimeseriesPoint[]>([]);
  const [pnl, setPnl] = useState<FinancePnl | null>(null);
  const [truckBreakdown, setTruckBreakdown] = useState<FinanceTruckBreakdown[]>([]);
  const [timeline, setTimeline] = useState<TimeWindow>('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFinance = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const windowParams = timeframeToParams(timeline);
      const [summaryRes, tsRes, pnlRes, truckRes] = await Promise.all([
        api.get('/api/admin/finance/summary', { params: windowParams }),
        api.get('/api/admin/finance/timeseries', { params: windowParams }),
        api.get('/api/admin/finance/pnl'),
        api.get('/api/admin/finance/truck-breakdown', { params: windowParams }),
      ]);
      setSummary(summaryRes.data);
      setTimeseries(Array.isArray(tsRes.data) ? tsRes.data : []);
      setPnl(pnlRes.data);
      setTruckBreakdown(Array.isArray(truckRes.data) ? truckRes.data : []);
      setLoading(false);
    } catch (err: any) {
      setLoading(false);
      setError(err?.response?.data?.error || 'Failed to load finance data.');
    }
  }, [api, timeline]);

  useEffect(() => {
    loadFinance();
  }, [loadFinance]);

  const costShare = useMemo(() => {
    if (!summary?.costs?.length) return [];
    const total = summary.costTotal || 1;
    return summary.costs.map((c) => ({
      type: c.type,
      amount: Number(c.total || 0),
      percent: Math.round(((Number(c.total || 0) / total) * 100) * 10) / 10,
    }));
  }, [summary]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.title}>Finance summary</Text>
        <View style={styles.chipRow}>
          {(['7d', '30d', '90d'] as TimeWindow[]).map((value) => {
            const active = value === timeline;
            return (
              <TouchableOpacity key={value} style={[styles.chip, active && styles.chipActive]} onPress={() => setTimeline(value)}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{value}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {loading && (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text style={styles.statusText}>Crunching revenue & expenses…</Text>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        {summary && (
          <View style={styles.summaryGrid}>
            <SummaryCard label="Revenue" value={formatKes(summary.revenue)} detail={`${summary.orders} orders`} />
            <SummaryCard label="Costs" value={formatKes(summary.costTotal)} detail={`${costShare.length} categories`} />
            <SummaryCard label="Gross profit" value={formatKes(summary.gross)} detail={`Margin ${summary.margin.toFixed(1)}%`} />
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Costs breakdown</Text>
        {costShare.map((item) => (
          <View key={item.type} style={styles.costRow}>
            <Text style={styles.costLabel}>{item.type}</Text>
            <Text style={styles.costValue}>{formatKes(item.amount)}</Text>
            <Text style={styles.costMeta}>{item.percent}%</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Profit & loss (current month)</Text>
        {pnl && (
          <>
            <SummaryCard label="Revenue" value={formatKes(pnl.revenue)} />
            <SummaryCard label="Costs" value={formatKes(pnl.costs)} />
            <SummaryCard label="Profit" value={formatKes(pnl.profit)} />
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.title}>Top trucks</Text>
        {truckBreakdown.slice(0, 6).map((truck) => (
          <View key={truck.truckId} style={styles.truckRow}>
            <View>
              <Text style={styles.truckName}>{truck.plate || truck.truckId}</Text>
              <Text style={styles.truckMeta}>{truck.loads} loads</Text>
            </View>
            <Text style={styles.truckValue}>{formatKes(truck.revenue)}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function timeframeToParams(window: TimeWindow) {
  if (window === '7d') return { from: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10) };
  if (window === '30d') return { from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) };
  return { from: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10) };
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
  chipRow: {
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
    borderColor: '#e2e8f0',
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
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    backgroundColor: '#ffffff',
  },
  costLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  costValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  costMeta: {
    fontSize: 12,
    color: '#475569',
  },
  truckRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    backgroundColor: '#f8fafc',
  },
  truckName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  truckMeta: {
    fontSize: 12,
    color: '#475569',
  },
  truckValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
});
