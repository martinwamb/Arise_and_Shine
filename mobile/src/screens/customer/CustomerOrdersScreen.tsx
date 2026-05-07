import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import type { CustomerOrder, Quote } from '../../types';
import { BANK_OPTIONS, DISTANCE_SOURCE_LABELS } from '../../constants';
import { formatDateTime, formatDistance, formatKes } from '../../utils/format';

const trucksOptions = Array.from({ length: 20 }, (_, idx) => idx + 1);

type OrderFormState = {
  site: string;
  sandType: 'coarse' | 'smooth';
  trucks: number;
  distanceKm: string;
  dateNeeded: string;
};

type PaymentState = {
  method: string;
  reference: string;
  message: string;
};

const initialForm: OrderFormState = {
  site: '',
  sandType: 'coarse',
  trucks: 1,
  distanceKm: '',
  dateNeeded: '',
};

const initialPayment: PaymentState = {
  method: BANK_OPTIONS[0].bank,
  reference: '',
  message: '',
};

export default function CustomerOrdersScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [form, setForm] = useState<OrderFormState>(initialForm);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [orderFeedback, setOrderFeedback] = useState<{ kind: 'idle' | 'success' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [ordersStatus, setOrdersStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [ordersMessage, setOrdersMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<Quote & { id: string; status: string } | null>(null);
  const [payment, setPayment] = useState<PaymentState>(initialPayment);
  const [paymentStatus, setPaymentStatus] = useState<{ kind: 'idle' | 'success' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const updateForm = useCallback((patch: Partial<OrderFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      setOrdersStatus('loading');
      setOrdersMessage(null);
      const res = await api.get('/api/orders/my');
      setOrders(Array.isArray(res.data) ? res.data : []);
      setOrdersStatus('idle');
    } catch (err: any) {
      setOrders([]);
      setOrdersStatus('error');
      setOrdersMessage(err?.response?.data?.error || 'Failed to load orders.');
    }
  }, [api]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (!form.site.trim()) {
      setQuote(null);
      setQuoteStatus('idle');
      setQuoteError(null);
      return;
    }
    setQuoteStatus('loading');
    setQuoteError(null);
    const timeout = setTimeout(async () => {
      try {
        const res = await api.post('/api/pricing/quote', {
          site: form.site,
          sandType: form.sandType,
          trucks: form.trucks,
          distanceKm: form.distanceKm ? Number(form.distanceKm) : undefined,
        });
        setQuote(res.data || null);
        setQuoteStatus('idle');
      } catch (err: any) {
        setQuote(null);
        setQuoteStatus('error');
        setQuoteError(err?.response?.data?.error || 'Unable to refresh quote.');
      }
    }, 250);
    return () => clearTimeout(timeout);
  }, [api, form.distanceKm, form.sandType, form.site, form.trucks]);

  const submitOrder = useCallback(async () => {
    if (submitting) return;
    if (!form.site.trim()) {
      setOrderFeedback({ kind: 'error', message: 'Delivery site is required.' });
      return;
    }
    setSubmitting(true);
    setOrderFeedback({ kind: 'idle', message: '' });
    setPaymentStatus({ kind: 'idle', message: '' });
    try {
      const payload: any = {
        site: form.site.trim(),
        sandType: form.sandType,
        trucks: form.trucks,
        distanceKm: form.distanceKm ? Number(form.distanceKm) : undefined,
        dateNeeded: form.dateNeeded || undefined,
      };
      const res = await api.post('/api/orders', payload);
      const summaryPayload: Quote & { id: string; status: string } = {
        id: res.data.id,
        status: res.data.status,
        perTruck: res.data.perTruck,
        total: res.data.total,
        distanceKm: res.data.distanceKm,
        distanceSource: res.data.distanceSource || res.data.distance_source,
        sandType: form.sandType,
        truckCount: form.trucks,
      };
      setSummary(summaryPayload);
      setOrderFeedback({
        kind: 'success',
        message: 'Order captured. Share the payment confirmation so dispatch can mobilise trucks.',
      });
      setForm(initialForm);
      setPayment(initialPayment);
      await loadOrders();
    } catch (err: any) {
      const message =
        err?.response?.status === 401
          ? 'Session expired. Please sign in again.'
          : err?.response?.data?.error || 'Failed to place order.';
      setOrderFeedback({ kind: 'error', message });
    } finally {
      setSubmitting(false);
    }
  }, [api, form, loadOrders, submitting]);

  const submitPayment = useCallback(async () => {
    if (!summary) {
      setPaymentStatus({ kind: 'error', message: 'Place an order first so we can attach the payment reference.' });
      return;
    }
    if (!payment.reference.trim()) {
      setPaymentStatus({ kind: 'error', message: 'Enter the MPESA reference or bank transaction ID.' });
      return;
    }
    setPaymentLoading(true);
    setPaymentStatus({ kind: 'idle', message: '' });
    try {
      await api.post(`/api/orders/${summary.id}/payment`, {
        method: payment.method,
        reference: payment.reference.trim(),
        message: payment.message.trim() || undefined,
      });
      setPaymentStatus({ kind: 'success', message: 'Payment shared with dispatch.' });
      setPayment((prev) => ({ ...prev, reference: '', message: '' }));
      await loadOrders();
    } catch (err: any) {
      setPaymentStatus({
        kind: 'error',
        message: err?.response?.data?.error || 'Failed to share payment confirmation.',
      });
    } finally {
      setPaymentLoading(false);
    }
  }, [api, loadOrders, payment.method, payment.message, payment.reference, summary]);

  const quoteDistanceLabel = useMemo(() => {
    if (!quote) return 'estimated';
    return DISTANCE_SOURCE_LABELS[quote.distanceSource ?? ''] || 'estimated';
  }, [quote]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.allSettled([loadOrders()]);
    setRefreshing(false);
  }, [loadOrders]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <View style={styles.section}>
        <Text style={styles.heading}>Create a sand order</Text>
        <Text style={styles.helper}>
          Share the site details and we will calculate distance-based pricing instantly. Once captured, add the MPESA or
          bank transaction reference so dispatch can schedule trucks.
        </Text>
        <View style={styles.quoteCard}>
          <Text style={styles.quoteLabel}>Live estimate</Text>
          {quoteStatus === 'loading' ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.quoteValue}>{quote ? formatKes(quote.perTruck) : 'Requesting...'}</Text>
              <Text style={styles.quoteHint}>
                {quote
                  ? `${formatKes(quote.total)} · ${Math.round(quote.distanceKm)} km (${quoteDistanceLabel})`
                  : 'Enter a delivery site to unlock pricing.'}
              </Text>
              {quoteError && <Text style={styles.quoteError}>{quoteError}</Text>}
            </>
          )}
        </View>
        <View style={styles.fieldGrid}>
          <LabeledInput label="Delivery site" value={form.site} onChangeText={(text) => updateForm({ site: text })} />
          <LabeledInput
            label="Sand type"
            component={
              <View style={styles.chipRow}>
                {(['coarse', 'smooth'] as const).map((type) => {
                  const active = form.sandType === type;
                  return (
                    <TouchableOpacity
                      key={type}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => updateForm({ sandType: type })}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {type === 'coarse' ? 'Coarse' : 'Smooth'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            }
          />
          <LabeledInput
            label="Trucks"
            component={
              <View style={styles.select}>
                {trucksOptions.map((value) => {
                  const active = form.trucks === value;
                  return (
                    <TouchableOpacity
                      key={value}
                      style={[styles.selectOption, active && styles.selectOptionActive]}
                      onPress={() => updateForm({ trucks: value })}
                    >
                      <Text style={[styles.selectOptionText, active && styles.selectOptionTextActive]}>{value}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            }
          />
          <LabeledInput
            label="Distance (km)"
            placeholder="Optional override"
            value={form.distanceKm}
            keyboardType="number-pad"
            onChangeText={(text) => updateForm({ distanceKm: text })}
          />
          <LabeledInput
            label="Date needed"
            placeholder="YYYY-MM-DD"
            value={form.dateNeeded}
            onChangeText={(text) => updateForm({ dateNeeded: text })}
          />
        </View>
        {orderFeedback.kind !== 'idle' && (
          <Text style={orderFeedback.kind === 'error' ? styles.error : styles.success}>{orderFeedback.message}</Text>
        )}
        <TouchableOpacity style={styles.primaryButton} onPress={submitOrder} disabled={submitting}>
          <Text style={styles.primaryButtonText}>{submitting ? 'Submitting…' : 'Place order'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>Share payment confirmation</Text>
        <Text style={styles.helper}>
          Use MPESA Paybill <Text style={styles.highlight}>ARISE &amp; SHINE TRANSPORTERS</Text> or your preferred bank
          below, then attach the receipt reference so finance can confirm dispatch readiness.
        </Text>
        {summary ? (
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Order #{summary.id}</Text>
            <Text style={styles.summaryMeta}>
              {summary.truckCount} truck(s) · {summary.sandType.toUpperCase()} sand · {formatKes(summary.total)}
            </Text>
            <Text style={styles.summaryMeta}>Distance {formatDistance(summary.distanceKm, summary.distanceSource)}</Text>
          </View>
        ) : (
          <Text style={styles.helper}>Capture a new order to unlock payment sharing.</Text>
        )}
        <View style={styles.bankList}>
          {BANK_OPTIONS.map((option) => (
            <View
              key={option.bank}
              style={[
                styles.bankRow,
                payment.method === option.bank ? styles.bankRowActive : undefined,
              ]}
            >
              <TouchableOpacity onPress={() => setPayment((prev) => ({ ...prev, method: option.bank }))}>
                <Text style={styles.bankName}>{option.bank}</Text>
                <Text style={styles.bankMeta}>Paybill {option.paybill}</Text>
                <Text style={styles.bankMeta}>Account {option.account}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <LabeledInput
          label="Reference number"
          placeholder="e.g. QFW12XYZ"
          value={payment.reference}
          onChangeText={(text) => setPayment((prev) => ({ ...prev, reference: text }))}
        />
        <LabeledInput
          label="Message (optional)"
          placeholder="Add driver or project notes"
          value={payment.message}
          onChangeText={(text) => setPayment((prev) => ({ ...prev, message: text }))}
        />
        {paymentStatus.kind !== 'idle' && (
          <Text style={paymentStatus.kind === 'error' ? styles.error : styles.success}>{paymentStatus.message}</Text>
        )}
        <TouchableOpacity style={styles.secondaryButton} onPress={submitPayment} disabled={paymentLoading}>
          <Text style={styles.secondaryButtonText}>
            {paymentLoading ? 'Submitting…' : 'Submit payment confirmation'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.heading}>My orders & dispatch</Text>
        <Text style={styles.helper}>
          Track payment status, truck assignments, and delivery stages. Orders move through{' '}
          <Text style={styles.highlight}>Awaiting Payment → Payment Review → Received → In Transit → Delivered.</Text>
        </Text>
        {ordersStatus === 'loading' && <Text style={styles.helper}>Loading your latest orders…</Text>}
        {ordersStatus === 'error' && ordersMessage && <Text style={styles.error}>{ordersMessage}</Text>}
        {!orders.length && ordersStatus === 'idle' && (
          <Text style={styles.helper}>No orders captured yet. Create one above to get started.</Text>
        )}
        {orders.map((order) => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderTitle}>{order.site}</Text>
                <Text style={styles.orderMeta}>{formatDateTime(order.created_at)}</Text>
              </View>
              <View style={styles.badgeGroup}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{order.status}</Text>
                </View>
                <View style={[styles.badge, styles.badgeMuted]}>
                  <Text style={[styles.badgeText, styles.badgeMutedText]}>
                    Payment {order.payment_status || 'PENDING'}
                  </Text>
                </View>
              </View>
            </View>
            <View style={styles.orderGrid}>
              <OrderSummaryItem label="Sand type" value={order.sand_type?.toUpperCase() || 'N/A'} />
              <OrderSummaryItem label="Trucks" value={order.trucks.toString()} />
              <OrderSummaryItem label="Per truck" value={formatKes(order.per_truck)} />
              <OrderSummaryItem label="Total" value={formatKes(order.total)} />
              <OrderSummaryItem label="Distance" value={formatDistance(order.distance_km, order.distance_source)} />
              <OrderSummaryItem
                label="Assignments"
                value={order.assignments?.length ? `${order.assignments.length}` : '0'}
              />
            </View>
            <View style={styles.assignmentList}>
              {order.assignments?.length ? (
                order.assignments.map((assignment) => (
                  <View key={assignment.id} style={styles.assignmentRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.assignmentTitle}>{assignment.plate || assignment.truckId}</Text>
                      <Text style={styles.assignmentMeta}>
                        {assignment.scheduledAt
                          ? `Schedule ${formatDateTime(assignment.scheduledAt)}`
                          : 'Schedule pending'}
                      </Text>
                    </View>
                    <View style={styles.assignmentBadge}>
                      <Text style={styles.assignmentBadgeText}>{assignment.status || 'TBC'}</Text>
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.helper}>
                  Dispatch has not assigned trucks yet. Confirm payment so the control room can schedule your fleet.
                </Text>
              )}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function LabeledInput({
  label,
  component,
  ...inputProps
}: {
  label: string;
  component?: React.ReactNode;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {component ? (
        component
      ) : (
        <TextInput
          {...inputProps}
          style={[styles.input, inputProps.multiline ? styles.inputMultiline : null]}
          placeholderTextColor="#94a3b8"
        />
      )}
    </View>
  );
}

function OrderSummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
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
    gap: 20,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 14,
  },
  heading: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  helper: {
    fontSize: 13,
    color: '#475569',
  },
  highlight: {
    fontWeight: '700',
    color: '#0f172a',
  },
  fieldGrid: {
    gap: 14,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: '#94a3b8',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  inputMultiline: {
    minHeight: 80,
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
    borderColor: '#cbd5f5',
  },
  chipActive: {
    backgroundColor: '#0f172a',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  chipTextActive: {
    color: '#fff',
  },
  select: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  selectOption: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  selectOptionActive: {
    borderColor: '#0f172a',
    backgroundColor: '#0f172a',
  },
  selectOptionText: {
    fontSize: 12,
    color: '#475569',
  },
  selectOptionTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  quoteCard: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 16,
    gap: 6,
  },
  quoteLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    color: '#0f172a',
    letterSpacing: 1,
  },
  quoteValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
  },
  quoteHint: {
    fontSize: 13,
    color: '#94a3b8',
  },
  quoteError: {
    fontSize: 12,
    color: '#fed7aa',
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
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  error: {
    color: '#b91c1c',
    fontSize: 13,
  },
  success: {
    color: '#065f46',
    fontSize: 13,
  },
  summaryCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    gap: 4,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  summaryMeta: {
    fontSize: 13,
    color: '#475569',
  },
  bankList: {
    gap: 8,
  },
  bankRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
  },
  bankRowActive: {
    borderColor: '#0f172a',
    backgroundColor: '#0f172a11',
  },
  bankName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  bankMeta: {
    fontSize: 12,
    color: '#475569',
  },
  orderCard: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  orderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  orderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  orderMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  badgeGroup: {
    gap: 6,
    alignItems: 'flex-end',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#0f172a',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  badgeMuted: {
    backgroundColor: '#f1f5f9',
  },
  badgeMutedText: {
    color: '#475569',
  },
  orderGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryItem: {
    width: '48%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#fdf2f8',
    backgroundColor: '#ffffff',
    padding: 10,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  summaryLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    color: '#c2410c',
  },
  assignmentList: {
    gap: 8,
  },
  assignmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    gap: 10,
  },
  assignmentTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  assignmentMeta: {
    fontSize: 12,
    color: '#64748b',
  },
  assignmentBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: '#0f172a',
  },
  assignmentBadgeText: {
    fontSize: 11,
    color: '#fff',
    fontWeight: '700',
  },
});
