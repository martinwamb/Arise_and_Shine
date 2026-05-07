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
import { formatKes } from '../../utils/format';

type OrderSummary = { total: number; pending: number; dispatched: number; delivered: number };
type FleetSummary = { total: number; moving: number; idle: number; offline: number };
type StockSummary = { coarse: number; smooth: number };

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <View style={s.statCard}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
      {sub ? <Text style={s.statSub}>{sub}</Text> : null}
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={s.sectionTitle}>{title}</Text>;
}

export default function OpsHomeScreen() {
  const { apiClient: { api }, user } = useAuth();
  const navigation = useNavigation<any>();

  const [orders, setOrders] = useState<OrderSummary>({ total: 0, pending: 0, dispatched: 0, delivered: 0 });
  const [fleet, setFleet] = useState<FleetSummary>({ total: 0, moving: 0, idle: 0, offline: 0 });
  const [stock, setStock] = useState<StockSummary>({ coarse: 0, smooth: 0 });
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [ordersRes, telemetryRes, stockRes] = await Promise.allSettled([
        api.get('/api/admin/orders', { params: { limit: 50 } }),
        api.get('/api/telemetry/trucks'),
        api.get('/api/admin/stock'),
      ]);

      if (ordersRes.status === 'fulfilled') {
        const list: any[] = Array.isArray(ordersRes.value.data) ? ordersRes.value.data : [];
        setRecentOrders(list.slice(0, 5));
        setOrders({
          total: list.length,
          pending: list.filter((o) => o.status === 'Received' || o.status === 'Confirmed').length,
          dispatched: list.filter((o) => o.status === 'Dispatched').length,
          delivered: list.filter((o) => o.status === 'Delivered').length,
        });
      }

      if (telemetryRes.status === 'fulfilled') {
        const trucks: any[] = Array.isArray(telemetryRes.value.data) ? telemetryRes.value.data : [];
        setFleet({
          total: trucks.length,
          moving: trucks.filter((t) => t.status === 'moving').length,
          idle: trucks.filter((t) => t.status === 'idle').length,
          offline: trucks.filter((t) => t.status === 'offline').length,
        });
      }

      if (stockRes.status === 'fulfilled') {
        const s = stockRes.value.data;
        setStock({ coarse: s?.coarse ?? 0, smooth: s?.smooth ?? 0 });
      }
    } catch {
      setError('Unable to load operations data.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator size="large" color="#0f172a" />
          <Text style={s.loadingText}>Loading operations data…</Text>
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
          <Text style={s.greeting}>Operations</Text>
          <Text style={s.greetingName}>{user?.name?.split(' ')[0] ?? 'Ops'}</Text>
        </View>

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* Orders summary */}
        <SectionHeader title="Orders" />
        <View style={s.statsRow}>
          <StatCard label="TOTAL" value={orders.total} />
          <StatCard label="PENDING" value={orders.pending} />
          <StatCard label="DISPATCHED" value={orders.dispatched} />
          <StatCard label="DELIVERED" value={orders.delivered} />
        </View>

        {/* Fleet summary */}
        <SectionHeader title="Live Fleet" />
        <View style={s.statsRow}>
          <StatCard label="TRUCKS" value={fleet.total} />
          <StatCard label="MOVING" value={fleet.moving} sub="active" />
          <StatCard label="IDLE" value={fleet.idle} />
          <StatCard label="OFFLINE" value={fleet.offline} />
        </View>

        {/* Stock summary */}
        <SectionHeader title="Yard Stock" />
        <View style={s.statsRow}>
          <StatCard label="COARSE SAND" value={`${stock.coarse} units`} />
          <StatCard label="SMOOTH SAND" value={`${stock.smooth} units`} />
        </View>

        {/* Recent orders */}
        <SectionHeader title="Recent Orders" />
        {recentOrders.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyText}>No orders yet today.</Text>
          </View>
        ) : (
          recentOrders.map((order) => (
            <View key={order.id} style={s.orderCard}>
              <View style={s.orderRow}>
                <Text style={s.orderSite}>{order.site || 'Unknown site'}</Text>
                <View style={[s.badge, getBadgeStyle(order.status)]}>
                  <Text style={[s.badgeText, getBadgeTextStyle(order.status)]}>{order.status}</Text>
                </View>
              </View>
              <Text style={s.orderMeta}>
                {order.trucks} truck{order.trucks !== 1 ? 's' : ''} · {order.sand_type?.toUpperCase() || 'N/A'} · {formatKes(order.total)}
              </Text>
              <Text style={s.orderMeta}>{order.name || order.email || '—'}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function getBadgeStyle(status: string) {
  switch (status) {
    case 'Delivered': return s.badgeGreen;
    case 'Dispatched': return s.badgeBlue;
    case 'Confirmed': return s.badgeAmber;
    default: return s.badgeGrey;
  }
}

function getBadgeTextStyle(status: string) {
  switch (status) {
    case 'Delivered': return s.badgeTextGreen;
    case 'Dispatched': return s.badgeTextBlue;
    case 'Confirmed': return s.badgeTextAmber;
    default: return s.badgeTextGrey;
  }
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

  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCard: {
    flexGrow: 1,
    minWidth: '44%',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  statLabel: { fontSize: 10, fontWeight: '600', color: '#94a3b8', letterSpacing: 0.8 },
  statValue: { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  statSub: { fontSize: 11, color: '#94a3b8' },

  orderCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    gap: 5,
  },
  orderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  orderSite: { fontSize: 15, fontWeight: '600', color: '#0f172a', flex: 1, marginRight: 8 },
  orderMeta: { fontSize: 13, color: '#64748b' },

  emptyCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: { color: '#94a3b8', fontSize: 14 },

  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  badgeGreen: { backgroundColor: '#dcfce7' },
  badgeTextGreen: { color: '#15803d' },
  badgeBlue: { backgroundColor: '#dbeafe' },
  badgeTextBlue: { color: '#1d4ed8' },
  badgeAmber: { backgroundColor: '#fef9c3' },
  badgeTextAmber: { color: '#a16207' },
  badgeGrey: { backgroundColor: '#f1f5f9' },
  badgeTextGrey: { color: '#475569' },
});
