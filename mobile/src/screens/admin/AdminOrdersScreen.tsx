import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import type { AdminAssignment, AdminOrder, TruckOption } from '../../types';
import { formatDateTime, formatKes } from '../../utils/format';

type CreateOrderForm = {
  name: string;
  phone: string;
  email: string;
  site: string;
  sandType: 'coarse' | 'smooth';
  trucks: string;
  distanceKm: string;
  dateNeeded: string;
  customerId: string;
  perTruckOverride: string;
};

const initialCreateForm: CreateOrderForm = {
  name: '',
  phone: '',
  email: '',
  site: '',
  sandType: 'coarse',
  trucks: '1',
  distanceKm: '',
  dateNeeded: '',
  customerId: '',
  perTruckOverride: '',
};

type OrderEditState = {
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  paymentReference: string;
  paymentMessage: string;
};

type AssignmentForm = {
  truckId: string;
  driverId: string;
  tonnes: string;
};

const initialAssignmentForm: AssignmentForm = { truckId: '', driverId: '', tonnes: '' };

export default function AdminOrdersScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateOrderForm>(initialCreateForm);
  const [creating, setCreating] = useState(false);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [orderAssignments, setOrderAssignments] = useState<Record<string, AdminAssignment[]>>({});
  const [orderEdits, setOrderEdits] = useState<Record<string, OrderEditState>>({});
  const [assignmentForms, setAssignmentForms] = useState<Record<string, AssignmentForm>>({});
  const [drivers, setDrivers] = useState<{ id: string; name: string }[]>([]);
  const [trucks, setTrucks] = useState<TruckOption[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const sandOptions = useMemo(() => ['coarse', 'smooth'] as const, []);

  const loadOrders = useCallback(async () => {
    try {
      setStatus('loading');
      setMessage(null);
      const res = await api.get('/api/admin/orders');
      const rows: AdminOrder[] = Array.isArray(res.data)
        ? res.data.map(mapAdminOrder)
        : [];
      setOrders(rows);
      setStatus('idle');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.response?.data?.error || 'Failed to load orders.');
    }
  }, [api]);

  const loadDrivers = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/drivers');
      setDrivers(
        Array.isArray(res.data)
          ? res.data.map((driver: any) => ({
              id: driver.id,
              name: driver.name || driver.id,
            }))
          : [],
      );
    } catch {
      setDrivers([]);
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
    loadOrders();
    loadDrivers();
    loadTrucks();
  }, [loadDrivers, loadOrders, loadTrucks]);

  const loadAssignments = useCallback(
    async (orderId: string) => {
      try {
        const res = await api.get(`/api/admin/orders/${orderId}/assignments`);
        setOrderAssignments((prev) => ({
          ...prev,
          [orderId]: Array.isArray(res.data) ? res.data.map(mapAssignment) : [],
        }));
      } catch (err: any) {
        Alert.alert('Assignments unavailable', err?.response?.data?.error || 'Failed to load assignments.');
      }
    },
    [api],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  }, [loadOrders]);

  const handleCreateOrder = useCallback(async () => {
    if (!createForm.site.trim()) {
      setMessage('Delivery site is required.');
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      const payload: any = {
        name: createForm.name.trim() || undefined,
        phone: createForm.phone.trim() || undefined,
        email: createForm.email.trim() || undefined,
        site: createForm.site.trim(),
        sandType: createForm.sandType,
        trucks: Number(createForm.trucks) || 1,
        distanceKm: createForm.distanceKm ? Number(createForm.distanceKm) : undefined,
        dateNeeded: createForm.dateNeeded || undefined,
        customerId: createForm.customerId.trim() || undefined,
        perTruckOverride: createForm.perTruckOverride ? Number(createForm.perTruckOverride) : undefined,
      };
      await api.post('/api/admin/orders', payload);
      setCreateForm(initialCreateForm);
      await loadOrders();
      Alert.alert('Order created', 'Manual order captured successfully.');
    } catch (err: any) {
      Alert.alert('Failed to create order', err?.response?.data?.error || 'Unable to create order.');
    } finally {
      setCreating(false);
    }
  }, [api, createForm, loadOrders]);

  const toggleExpanded = useCallback(
    (orderId: string) => {
      setExpandedOrder((prev) => {
        const next = prev === orderId ? null : orderId;
        if (next && !orderAssignments[next]) {
          loadAssignments(next);
        }
        return next;
      });
    },
    [loadAssignments, orderAssignments],
  );

  const getEditState = useCallback(
    (order: AdminOrder): OrderEditState => {
      return (
        orderEdits[order.id] || {
          status: order.status || '',
          paymentStatus: order.paymentStatus || '',
          paymentMethod: order.paymentMethod || '',
          paymentReference: order.paymentReference || '',
          paymentMessage: order.paymentMessage || '',
        }
      );
    },
    [orderEdits],
  );

  const updateOrder = useCallback(
    async (order: AdminOrder) => {
      const edit = getEditState(order);
      try {
        await api.patch(`/api/admin/orders/${order.id}`, {
          status: edit.status,
          paymentStatus: edit.paymentStatus,
          paymentMethod: edit.paymentMethod,
          paymentReference: edit.paymentReference,
          paymentMessage: edit.paymentMessage,
        });
        Alert.alert('Order updated', `Order ${order.id} updated.`);
        await loadOrders();
      } catch (err: any) {
        Alert.alert('Failed to update order', err?.response?.data?.error || 'Unable to update order.');
      }
    },
    [api, getEditState, loadOrders],
  );

  const handleAssignment = useCallback(
    async (orderId: string) => {
      const formState = assignmentForms[orderId] || initialAssignmentForm;
      if (!formState.truckId) {
        Alert.alert('Truck required', 'Select a truck to assign.');
        return;
      }
      try {
        await api.post(`/api/admin/orders/${orderId}/assignments`, {
          truckId: formState.truckId,
          driverId: formState.driverId || undefined,
          tonnes: formState.tonnes ? Number(formState.tonnes) : undefined,
        });
        Alert.alert('Assignment saved', 'Truck assigned successfully.');
        setAssignmentForms((prev) => ({ ...prev, [orderId]: initialAssignmentForm }));
        await loadAssignments(orderId);
        await loadOrders();
      } catch (err: any) {
        Alert.alert('Failed to assign', err?.response?.data?.error || 'Unable to assign truck.');
      }
    },
    [api, assignmentForms, loadAssignments, loadOrders],
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Create manual order</Text>
        <Text style={styles.helper}>
          Capture customer requests manually, override pricing, and notify dispatch instantly.
        </Text>
        <View style={styles.fieldGrid}>
          <Field label="Customer name" value={createForm.name} onChangeText={(text) => setCreateForm((prev) => ({ ...prev, name: text }))} />
          <Field label="Phone" value={createForm.phone} onChangeText={(text) => setCreateForm((prev) => ({ ...prev, phone: text }))} keyboardType="phone-pad" />
          <Field label="Email" value={createForm.email} onChangeText={(text) => setCreateForm((prev) => ({ ...prev, email: text }))} autoCapitalize="none" keyboardType="email-address" />
          <Field label="Customer ID (optional)" value={createForm.customerId} onChangeText={(text) => setCreateForm((prev) => ({ ...prev, customerId: text }))} />
          <Field label="Delivery site" value={createForm.site} onChangeText={(text) => setCreateForm((prev) => ({ ...prev, site: text }))} />
          <View style={styles.field}>
            <Text style={styles.label}>Sand type</Text>
            <View style={styles.chipRow}>
              {sandOptions.map((type) => {
                const active = createForm.sandType === type;
                return (
                  <TouchableOpacity key={type} style={[styles.chip, active && styles.chipActive]} onPress={() => setCreateForm((prev) => ({ ...prev, sandType: type }))}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{type === 'coarse' ? 'Coarse' : 'Smooth'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          <Field label="Trucks" value={createForm.trucks} keyboardType="numeric" onChangeText={(text) => setCreateForm((prev) => ({ ...prev, trucks: text }))} />
          <Field label="Distance (km)" value={createForm.distanceKm} keyboardType="numeric" onChangeText={(text) => setCreateForm((prev) => ({ ...prev, distanceKm: text }))} />
          <Field label="Date needed" placeholder="YYYY-MM-DD" value={createForm.dateNeeded} onChangeText={(text) => setCreateForm((prev) => ({ ...prev, dateNeeded: text }))} />
          <Field label="Per truck override (KES)" keyboardType="numeric" value={createForm.perTruckOverride} onChangeText={(text) => setCreateForm((prev) => ({ ...prev, perTruckOverride: text }))} />
        </View>
        <TouchableOpacity style={styles.primaryButton} onPress={handleCreateOrder} disabled={creating}>
          <Text style={styles.primaryButtonText}>{creating ? 'Creating…' : 'Create order'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Orders queue</Text>
        <Text style={styles.helper}>Track statuses, payment progress, and assignments.</Text>
        {status === 'loading' && (
          <View style={styles.statusRow}>
            <ActivityIndicator />
            <Text style={styles.statusText}>Loading orders…</Text>
          </View>
        )}
        {status === 'error' && message && <Text style={styles.error}>{message}</Text>}
        {!orders.length && status === 'idle' && <Text style={styles.helper}>No orders captured yet.</Text>}
        {orders.map((order) => {
          const expanded = expandedOrder === order.id;
          const edit = getEditState(order);
          const assignmentList = orderAssignments[order.id] || [];
          const assignmentForm = assignmentForms[order.id] || initialAssignmentForm;
          return (
            <View key={order.id} style={styles.orderCard}>
              <TouchableOpacity onPress={() => toggleExpanded(order.id)} style={styles.orderHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderTitle}>{order.site}</Text>
                  <Text style={styles.orderMeta}>
                    {order.sandType?.toUpperCase() || 'SAND'} · {order.trucks} trucks · {formatKes(order.perTruck)} per truck
                  </Text>
                  <Text style={styles.orderMeta}>Total {formatKes(order.total)}</Text>
                </View>
                <View style={styles.badgeColumn}>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{order.status}</Text>
                  </View>
                  <View style={[styles.badge, styles.badgeMuted]}>
                    <Text style={[styles.badgeText, styles.badgeMutedText]}>
                      Payment {order.paymentStatus || 'PENDING'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
              <Text style={styles.orderMeta}>
                Created {formatDateTime(order.createdAt)}
                {order.distanceKm !== null && order.distanceKm !== undefined
                  ? ` • ${Math.round(order.distanceKm)} km`
                  : ''}
              </Text>
              {expanded && (
                <View style={styles.orderDetails}>
                  <Text style={styles.detailsHeading}>Update statuses</Text>
                  <View style={styles.fieldGrid}>
                    <Field
                      label="Order status"
                      value={edit.status}
                      onChangeText={(text) =>
                        setOrderEdits((prev) => ({
                          ...prev,
                          [order.id]: { ...edit, status: text },
                        }))
                      }
                    />
                    <Field
                      label="Payment status"
                      value={edit.paymentStatus}
                      onChangeText={(text) =>
                        setOrderEdits((prev) => ({
                          ...prev,
                          [order.id]: { ...edit, paymentStatus: text },
                        }))
                      }
                    />
                    <Field
                      label="Payment method"
                      value={edit.paymentMethod}
                      onChangeText={(text) =>
                        setOrderEdits((prev) => ({
                          ...prev,
                          [order.id]: { ...edit, paymentMethod: text },
                        }))
                      }
                    />
                    <Field
                      label="Payment reference"
                      value={edit.paymentReference}
                      onChangeText={(text) =>
                        setOrderEdits((prev) => ({
                          ...prev,
                          [order.id]: { ...edit, paymentReference: text },
                        }))
                      }
                    />
                    <Field
                      label="Payment note"
                      value={edit.paymentMessage}
                      onChangeText={(text) =>
                        setOrderEdits((prev) => ({
                          ...prev,
                          [order.id]: { ...edit, paymentMessage: text },
                        }))
                      }
                    />
                  </View>
                  <TouchableOpacity style={styles.secondaryButton} onPress={() => updateOrder(order)}>
                    <Text style={styles.secondaryButtonText}>Update order</Text>
                  </TouchableOpacity>

                  <Text style={styles.detailsHeading}>Assignments</Text>
                  <View style={styles.fieldGrid}>
                    <Field
                      label="Truck ID"
                      value={assignmentForm.truckId}
                      onChangeText={(text) =>
                        setAssignmentForms((prev) => ({
                          ...prev,
                          [order.id]: { ...assignmentForm, truckId: text },
                        }))
                      }
                    />
                    <Field
                      label="Driver ID"
                      value={assignmentForm.driverId}
                      onChangeText={(text) =>
                        setAssignmentForms((prev) => ({
                          ...prev,
                          [order.id]: { ...assignmentForm, driverId: text },
                        }))
                      }
                    />
                    <Field
                      label="Tonnes"
                      value={assignmentForm.tonnes}
                      keyboardType="numeric"
                      onChangeText={(text) =>
                        setAssignmentForms((prev) => ({
                          ...prev,
                          [order.id]: { ...assignmentForm, tonnes: text },
                        }))
                      }
                    />
                  </View>
                  <View style={styles.helperRow}>
                    <Text style={styles.helper}>
                      Trucks available: {trucks.map((t) => t.plate || t.id).slice(0, 4).join(', ')}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.primaryButton} onPress={() => handleAssignment(order.id)}>
                    <Text style={styles.primaryButtonText}>Assign truck</Text>
                  </TouchableOpacity>
                  <View style={styles.assignmentList}>
                    {assignmentList.length === 0 ? (
                      <Text style={styles.helper}>No assignments yet.</Text>
                    ) : (
                      assignmentList.map((assignment) => (
                        <View key={assignment.id} style={styles.assignmentCard}>
                          <View>
                            <Text style={styles.assignmentTitle}>
                              {assignment.truckId || 'Truck'} · {Number(assignment.tonnes || 0).toLocaleString()} t
                            </Text>
                            <Text style={styles.assignmentMeta}>
                              Status {assignment.status || 'Scheduled'}
                            </Text>
                          </View>
                          <Text style={styles.assignmentMeta}>
                            {assignment.scheduledAt ? formatDateTime(assignment.scheduledAt) : 'Schedule pending'}
                          </Text>
                        </View>
                      ))
                    )}
                  </View>
                </View>
              )}
            </View>
          );
        })}
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

const mapAdminOrder = (row: any): AdminOrder => ({
  id: row.id,
  name: row.name || row.customer_name || null,
  phone: row.phone || row.customer_phone || null,
  email: row.email || row.customer_email || null,
  site: row.site,
  sandType: row.sand_type || row.sandType || null,
  trucks: Number(row.trucks || 0),
  perTruck: Number(row.per_truck || row.perTruck || 0),
  total: Number(row.total || 0),
  distanceKm: row.distance_km !== undefined ? Number(row.distance_km) : row.distanceKm !== undefined ? Number(row.distanceKm) : null,
  distanceSource: row.distance_source || row.distanceSource || null,
  status: row.status,
  paymentStatus: row.payment_status || row.paymentStatus || null,
  paymentMethod: row.payment_method || null,
  paymentReference: row.payment_reference || null,
  paymentMessage: row.payment_message || null,
  dateNeeded: row.date_needed || null,
  createdAt: row.created_at || row.createdAt || new Date().toISOString(),
  assignmentsCount: Number(row.assigns || row.assignments || 0),
});

const mapAssignment = (row: any): AdminAssignment => ({
  id: row.id,
  orderId: row.order_id,
  truckId: row.truck_id,
  driverId: row.driver_id,
  status: row.status,
  scheduledAt: row.scheduled_at,
  deliveredAt: row.delivered_at,
  tonnes: row.tonnes !== undefined && row.tonnes !== null ? Number(row.tonnes) : null,
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
    padding: 16,
    backgroundColor: '#fff',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  helper: {
    fontSize: 13,
    color: '#475569',
  },
  helperRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  fieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  field: {
    flexBasis: '48%',
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
    backgroundColor: '#fff',
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
  orderCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 16,
    gap: 10,
    backgroundColor: '#ffffff',
  },
  orderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  orderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  orderMeta: {
    fontSize: 12,
    color: '#475569',
  },
  badgeColumn: {
    gap: 6,
    alignItems: 'flex-end',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#0f172a',
  },
  badgeMuted: {
    backgroundColor: '#f1f5f9',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  badgeMutedText: {
    color: '#475569',
  },
  orderDetails: {
    gap: 12,
    marginTop: 8,
  },
  detailsHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  assignmentList: {
    gap: 8,
  },
  assignmentCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
    backgroundColor: '#fff',
  },
  assignmentTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  assignmentMeta: {
    fontSize: 11,
    color: '#475569',
  },
});
