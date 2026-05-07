// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Linking,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import type { DriverOnboardingForm } from '../../../shared/driver-onboarding';
import { createEmptyDriverOnboardingForm, renderDriverOnboardingHtml } from '../../../shared/driver-onboarding';
import { useAuth } from '../contexts/AuthContext';
import type {
  Article,
  CustomerOrder,
  DriverDashboard,
  FuelFormState,
  FuelLog,
  GuestOrderForm,
  GuestOrderSummary,
  LandingAccountResponse,
  MobileReportDefinition,
  PricingGuide,
  Quote,
} from '../types';
import { BANK_OPTIONS, DISTANCE_SOURCE_LABELS, HERO_FACTS, INITIAL_ORDER_FORM, WORKSPACE_SECTIONS } from '../constants';
import { formatDateTime, formatDistance, formatKes } from '../utils/format';

type LegacyExperienceProps = {
  variant: 'landing' | 'workspace';
};

const initialFuelFormState = (): FuelFormState => ({
  truckId: '',
  litres: '',
  cost: '',
  odometer: '',
  note: '',
  photoData: '',
  photoPreview: '',
});

export default function LegacyExperience({ variant }: LegacyExperienceProps) {
  const {
    user,
    login,
    logout,
    requestPasswordReset,
    applySession,
    apiClient: { api, API_BASE },
  } = useAuth();
  const scrollRef = useRef<ScrollView | null>(null);
  const orderSectionY = useRef(0);
  const [articles, setArticles] = useState<Article[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState({ email: '', password: '' });
  const [resetState, setResetState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [driverForm, setDriverForm] = useState<DriverOnboardingForm | null>(null);
  const [driverFormStatus, setDriverFormStatus] = useState<'idle' | 'loading' | 'saving'>('idle');
  const [driverFormMessage, setDriverFormMessage] = useState<string | null>(null);
  const [pricingGuide, setPricingGuide] = useState<PricingGuide | null>(null);
  const [orderForm, setOrderForm] = useState<GuestOrderForm>(INITIAL_ORDER_FORM);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [createAccount, setCreateAccount] = useState(false);
  const [accountPassword, setAccountPassword] = useState('');
  const [accountConfirm, setAccountConfirm] = useState('');
  const [orderStatus, setOrderStatus] = useState<{ kind: 'idle' | 'success' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });
  const [placingOrder, setPlacingOrder] = useState(false);
  const [orderSummary, setOrderSummary] = useState<GuestOrderSummary | null>(null);
  const [orderContact, setOrderContact] = useState<GuestOrderForm | null>(null);
  const [reportDefs, setReportDefs] = useState<MobileReportDefinition[]>([]);
  const [reportFormats, setReportFormats] = useState<string[]>(['excel', 'pdf']);
  const [selectedReport, setSelectedReport] = useState('');
  const [selectedReportFormat, setSelectedReportFormat] = useState<'excel' | 'pdf'>('excel');
  const [reportFromDate, setReportFromDate] = useState('');
  const [reportToDate, setReportToDate] = useState('');
  const [reportStatus, setReportStatus] = useState<'idle' | 'loading'>('idle');
  const [reportMessage, setReportMessage] = useState<string | null>(null);
  const [myOrders, setMyOrders] = useState<CustomerOrder[]>([]);
  const [ordersStatus, setOrdersStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [ordersMessage, setOrdersMessage] = useState<string | null>(null);
  const [driverDashboard, setDriverDashboard] = useState<DriverDashboard | null>(null);
  const [driverDashboardStatus, setDriverDashboardStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [driverDashboardMessage, setDriverDashboardMessage] = useState<string | null>(null);
  const [fuelLogs, setFuelLogs] = useState<FuelLog[]>([]);
  const [fuelStatus, setFuelStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [fuelMessage, setFuelMessage] = useState<string | null>(null);
  const [fuelSubmitting, setFuelSubmitting] = useState(false);
  const [fuelForm, setFuelForm] = useState<FuelFormState>(initialFuelFormState());
  const [workspaceTab, setWorkspaceTab] = useState('orders');

  const handleOrderSectionLayout = useCallback((event: LayoutChangeEvent) => {
    orderSectionY.current = event.nativeEvent.layout.y;
  }, []);

  const scrollToOrder = useCallback(() => {
    const target = Math.max(orderSectionY.current - 16, 0);
    scrollRef.current?.scrollTo({ y: target, animated: true });
  }, []);

  const updateOrderForm = useCallback((patch: Partial<GuestOrderForm>) => {
    setOrderForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const loadArticles = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        setStatus('loading');
      }
      setError(null);
      try {
        const response = await api.get('/api/articles', { params: { limit: 5 } });
        const rows = Array.isArray(response.data) ? (response.data as Article[]) : [];
        setArticles(rows);
        setStatus('idle');
      } catch (err: any) {
        setError(err?.response?.data?.error || err?.message || 'Unable to reach Arise & Shine API');
        setStatus('error');
      }
    },
    [setArticles],
  );

  const loadPricing = useCallback(async () => {
    try {
      const res = await api.get('/api/pricing');
      setPricingGuide(res.data || null);
    } catch {
      setPricingGuide(null);
    }
  }, []);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  useEffect(() => {
    loadPricing();
  }, [loadPricing]);


  useEffect(() => {
    if (!orderForm.site.trim()) {
      setQuote(null);
      setQuoteError(null);
      setQuoteStatus('idle');
      return;
    }
    setQuoteStatus('loading');
    setQuoteError(null);
    const timeout = setTimeout(async () => {
      try {
        const res = await api.post('/api/pricing/quote', {
          site: orderForm.site,
          sandType: orderForm.sandType,
          trucks: orderForm.trucks,
          distanceKm: orderForm.distanceKm ? Number(orderForm.distanceKm) : undefined,
        });
        setQuote(res.data || null);
        setQuoteStatus('idle');
      } catch (err: any) {
        setQuote(null);
        setQuoteStatus('error');
        setQuoteError(err?.response?.data?.error || 'Unable to refresh quote.');
      }
    }, 350);
    return () => clearTimeout(timeout);
  }, [api, orderForm.distanceKm, orderForm.sandType, orderForm.site, orderForm.trucks]);

  const handleLogin = useCallback(async () => {
    const email = credentials.email.trim();
    const password = credentials.password;
    if (!email || !password) {
      setAuthError('Enter both email and password.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    setResetState('idle');
    try {
      await login(email, password);
    } catch (err: any) {
      setAuthError(err?.response?.data?.error || err?.message || 'Login failed. Check credentials and try again.');
    } finally {
      setAuthLoading(false);
    }
  }, [credentials, login]);

  const handleLogout = useCallback(() => {
    setCredentials({ email: '', password: '' });
    logout();
    resetDriverFormState();
    setWorkspaceTab('orders');
  }, [logout, resetDriverFormState]);

  const handlePasswordReset = useCallback(async () => {
    const email = credentials.email.trim();
    if (!email) {
      setAuthError('Enter your email before requesting a reset link.');
      return;
    }
    setResetState('sending');
    try {
      await requestPasswordReset(email);
      setResetState('sent');
    } catch (err: any) {
      setResetState('error');
      setAuthError(err?.response?.data?.error || 'Could not start password reset.');
    }
  }, [credentials.email]);

  const resetGuestOrderFlow = useCallback(() => {
    setOrderForm(INITIAL_ORDER_FORM);
    setCreateAccount(false);
    setAccountPassword('');
    setAccountConfirm('');
    setOrderStatus({ kind: 'idle', message: '' });
    setOrderSummary(null);
    setOrderContact(null);
    setQuote(null);
    setQuoteStatus('idle');
    setQuoteError(null);
  }, []);

  const submitGuestOrder = useCallback(async () => {
    if (placingOrder) return;
    const name = orderForm.name.trim();
    const phone = orderForm.phone.trim();
    const site = orderForm.site.trim();
    if (!name || !phone || !site) {
      setOrderStatus({ kind: 'error', message: 'Name, phone, and delivery site are required.' });
      return;
    }
    if (createAccount) {
      if (!orderForm.email.trim()) {
        setOrderStatus({ kind: 'error', message: 'Email is required to create an account.' });
        return;
      }
      if (accountPassword.trim().length < 8) {
        setOrderStatus({ kind: 'error', message: 'Password must be at least 8 characters.' });
        return;
      }
      if (accountPassword.trim() !== accountConfirm.trim()) {
        setOrderStatus({ kind: 'error', message: 'Passwords do not match.' });
        return;
      }
    }
    setOrderStatus({ kind: 'idle', message: '' });
    setPlacingOrder(true);
    try {
      const payload: any = {
        ...orderForm,
        name,
        phone,
        site,
        sandType: orderForm.sandType,
        trucks: orderForm.trucks,
        distanceKm: orderForm.distanceKm ? Number(orderForm.distanceKm) : undefined,
        dateNeeded: orderForm.dateNeeded || undefined,
        email: orderForm.email.trim() || undefined,
      };
      if (createAccount) {
        payload.account = { password: accountPassword.trim() };
      }
      const res = await api.post('/api/orders/guest', payload);
      const summary: GuestOrderSummary = {
        id: res.data?.id || 'pending',
        status: res.data?.status || 'PENDING',
        perTruck: Number(res.data?.perTruck) || 0,
        total: Number(res.data?.total) || 0,
        distanceKm: Number(res.data?.distanceKm) || Number(payload.distanceKm) || 0,
        distanceSource: res.data?.distanceSource || res.data?.distance_source || null,
        sandType: res.data?.sandType || orderForm.sandType,
        truckCount: Number(res.data?.truckCount ?? orderForm.trucks) || orderForm.trucks,
      };
      setOrderSummary(summary);
      setOrderContact(orderForm);
      const account = res.data?.account as LandingAccountResponse;
      if (account?.token && account.user) {
        applySession(account.token, account.user);
      }
      setOrderStatus({
        kind: 'success',
        message: 'Order placed! Share MPESA reference to dispatch and watch updates under My orders.',
      });
      setOrderForm(INITIAL_ORDER_FORM);
      setCreateAccount(false);
      setAccountPassword('');
      setAccountConfirm('');
      setQuote(null);
      setQuoteStatus('idle');
      setQuoteError(null);
      if (user?.role === 'CUSTOMER' || account?.user?.role === 'CUSTOMER') {
        loadCustomerOrders();
      }
    } catch (err: any) {
      setOrderStatus({ kind: 'error', message: err?.response?.data?.error || 'Could not submit the order.' });
    } finally {
      setPlacingOrder(false);
    }
  }, [
    accountConfirm,
    accountPassword,
    api,
    createAccount,
    applySession,
    loadCustomerOrders,
    orderForm,
    placingOrder,
    user?.role,
  ]);
  const updateFuelForm = useCallback((patch: Partial<FuelFormState>) => {
    setFuelForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const pickFuelPhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', 'Allow photo library access to attach pump slips.');
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
    setFuelForm((prev) => ({ ...prev, photoPreview: preview, photoData: data }));
  }, []);

  const submitFuelLog = useCallback(async () => {
    if (fuelSubmitting) return;
    setFuelMessage(null);
    setFuelStatus('idle');
    setFuelSubmitting(true);
    try {
      const payload = {
        truckId: fuelForm.truckId.trim() || null,
        litres: fuelForm.litres ? Number(fuelForm.litres) : null,
        cost: fuelForm.cost ? Number(fuelForm.cost) : null,
        odometer: fuelForm.odometer ? Number(fuelForm.odometer) : null,
        note: fuelForm.note,
        photoData: fuelForm.photoData || undefined,
      };
      await api.post('/api/fuel/logs', payload);
      setFuelMessage('Fuel log captured.');
      setFuelForm(initialFuelFormState());
      await loadFuelLogs();
    } catch (err: any) {
      setFuelStatus('error');
      setFuelMessage(err?.response?.data?.error || 'Failed to save the fuel log.');
    } finally {
      setFuelSubmitting(false);
    }
  }, [api, fuelForm, fuelSubmitting, loadFuelLogs]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const tasks: Promise<any>[] = [loadArticles({ silent: true }), loadPricing()];
    if (user?.role === 'CUSTOMER') {
      tasks.push(loadCustomerOrders());
    }
    if (user?.role === 'DRIVER') {
      tasks.push(loadDriverDashboard(user.driverId));
    }
    if (user?.role === 'FUEL' || user?.role === 'ADMIN') {
      tasks.push(loadFuelLogs());
    }
    await Promise.allSettled(tasks);
    setRefreshing(false);
  }, [loadArticles, loadCustomerOrders, loadDriverDashboard, loadFuelLogs, loadPricing, user?.driverId, user?.role]);

  const resetDriverFormState = useCallback(() => {
    setDriverForm(null);
    setDriverFormStatus('idle');
    setDriverFormMessage(null);
  }, []);

  const fetchDriverForm = useCallback(async () => {
    if (!user) {
      resetDriverFormState();
      return;
    }
    setDriverFormStatus('loading');
    setDriverFormMessage(null);
    try {
      const res = await api.get('/api/profile/employment-form');
      if (res.data?.form) {
        setDriverForm(res.data.form as DriverOnboardingForm);
      } else {
        setDriverForm(createEmptyDriverOnboardingForm());
      }
    } catch (err: any) {
      setDriverFormMessage(err?.response?.data?.error || 'Unable to load employment form.');
    } finally {
      setDriverFormStatus('idle');
    }
  }, [resetDriverFormState, user]);

  const loadCustomerOrders = useCallback(async () => {
    setOrdersStatus('loading');
    setOrdersMessage(null);
    try {
      const res = await api.get('/api/orders/my');
      setMyOrders(Array.isArray(res.data) ? res.data : []);
      setOrdersStatus('idle');
    } catch (err: any) {
      setMyOrders([]);
      setOrdersStatus('error');
      setOrdersMessage(err?.response?.data?.error || 'Failed to load orders.');
    }
  }, []);

  const loadDriverDashboard = useCallback(
    async (driverId?: string | null) => {
      if (!driverId) {
        setDriverDashboard(null);
        setDriverDashboardStatus('error');
        setDriverDashboardMessage('Driver profile not linked to this account.');
        return;
      }
      try {
        setDriverDashboardStatus('loading');
        setDriverDashboardMessage(null);
        const res = await api.get('/api/driver/dashboard', { params: { driverId } });
        setDriverDashboard(res.data || null);
        setDriverDashboardStatus('idle');
      } catch (err: any) {
        setDriverDashboard(null);
        setDriverDashboardStatus('error');
        setDriverDashboardMessage(err?.response?.data?.error || 'Driver dashboard unavailable.');
      }
    },
    [],
  );

  const loadFuelLogs = useCallback(async () => {
    setFuelStatus('loading');
    setFuelMessage(null);
    try {
      const res = await api.get('/api/fuel/logs', { params: { limit: 10 } });
      setFuelLogs(Array.isArray(res.data) ? res.data : []);
      setFuelStatus('idle');
    } catch (err: any) {
      setFuelLogs([]);
      setFuelStatus('error');
      setFuelMessage(err?.response?.data?.error || 'Unable to load fuel logs.');
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchDriverForm();
    } else {
      resetDriverFormState();
    }
  }, [fetchDriverForm, resetDriverFormState, user]);

  useEffect(() => {
    if (user?.role === 'CUSTOMER') {
      loadCustomerOrders();
    } else {
      setMyOrders([]);
      setOrdersStatus('idle');
      setOrdersMessage(null);
    }
  }, [loadCustomerOrders, user?.role]);

  useEffect(() => {
    if (user?.role === 'DRIVER') {
      loadDriverDashboard(user.driverId);
    } else {
      setDriverDashboard(null);
      setDriverDashboardStatus('idle');
      setDriverDashboardMessage(null);
    }
  }, [loadDriverDashboard, user?.driverId, user?.role]);

  useEffect(() => {
    if (user?.role === 'FUEL' || user?.role === 'ADMIN') {
      loadFuelLogs();
    } else {
      setFuelLogs([]);
      setFuelStatus('idle');
      setFuelMessage(null);
    }
  }, [loadFuelLogs, user?.role]);

  const updateDriverFormField = useCallback((path: string, value: string) => {
    setDriverForm((prev) => {
      if (!prev) return prev;
      const next = deepCloneForm(prev);
      const segments = path.split('.');
      let cursor: any = next;
      for (let i = 0; i < segments.length - 1; i += 1) {
        const key = segments[i];
        const isIndex = /^[0-9]+$/.test(key);
        const targetKey = isIndex ? Number(key) : key;
        const current = cursor[targetKey];
        cursor[targetKey] = Array.isArray(current) ? [...current] : { ...(current || {}) };
        cursor = cursor[targetKey];
      }
      const lastKey = segments[segments.length - 1];
      const isIndex = /^[0-9]+$/.test(lastKey);
      const targetKey = isIndex ? Number(lastKey) : lastKey;
      cursor[targetKey] = value;
      return next;
    });
  }, []);

  const updateDriverDocument = useCallback((index: number, key: 'provided' | 'remarks', value: boolean | string) => {
    setDriverForm((prev) => {
      if (!prev) return prev;
      const next = deepCloneForm(prev);
      const docs = Array.isArray(next.documentsChecklist) ? [...next.documentsChecklist] : [];
      if (!docs[index]) return prev;
      docs[index] = key === 'provided' ? { ...docs[index], provided: Boolean(value) } : { ...docs[index], remarks: String(value) };
      next.documentsChecklist = docs;
      return next;
    });
  }, []);

  const saveDriverForm = useCallback(
    async (target: 'draft' | 'submitted') => {
      if (!user || !driverForm) return;
      if (target === 'submitted') {
        if (!driverForm.personalDetails.surname || !driverForm.personalDetails.otherNames) {
          setDriverFormMessage('Please provide your surname and other names before submitting.');
          return;
        }
        if (!driverForm.personalDetails.idNumber) {
          setDriverFormMessage('National ID / Passport number is required before submission.');
          return;
        }
      }
      setDriverFormStatus('saving');
      setDriverFormMessage(null);
      try {
        const res = await api.put('/api/profile/employment-form', { form: { ...driverForm, status: target } });
        setDriverForm((res.data?.form as DriverOnboardingForm) || driverForm);
        setDriverFormMessage(target === 'submitted' ? 'Form submitted successfully.' : 'Draft saved.');
      } catch (err: any) {
        setDriverFormMessage(err?.response?.data?.error || 'Could not save the employment form.');
      } finally {
        setDriverFormStatus('idle');
      }
    },
    [driverForm, user],
  );

  const printDriverForm = useCallback(() => {
    if (!driverForm) {
      Alert.alert('Form not ready', 'Load the onboarding form before printing.');
      return;
    }
    try {
      const html = renderDriverOnboardingHtml(driverForm, {
        brand: 'Arise & Shine Transporters',
        driverLabel: `${driverForm.personalDetails.surname} ${driverForm.personalDetails.otherNames}`.trim(),
      });
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      Linking.openURL(dataUrl).catch(() => {
        Alert.alert('Unable to open form', 'Please try again on the web portal to print this document.');
      });
    } catch {
      Alert.alert('Unable to prepare form', 'Please try again after saving the latest changes.');
    }
  }, [driverForm]);

  const loadReportDefinitions = useCallback(async () => {
    if (!user?.role || (user.role !== 'ADMIN' && user.role !== 'OPS')) {
      setReportDefs([]);
      setReportMessage(null);
      setSelectedReport('');
      setReportFromDate('');
      setReportToDate('');
      return;
    }
    try {
      const res = await api.get('/api/reports/definitions');
      setReportDefs(res.data?.definitions || []);
      setReportFormats(res.data?.formats || ['excel', 'pdf']);
      if (!selectedReport && res.data?.definitions?.length) {
        setSelectedReport(res.data.definitions[0].key);
        const defaultDays = res.data.definitions[0]?.filters?.defaultRangeDays;
        if (defaultDays) {
          const end = new Date();
          const start = new Date();
          start.setDate(start.getDate() - Math.max(1, defaultDays));
          setReportToDate(end.toISOString().slice(0, 10));
          setReportFromDate(start.toISOString().slice(0, 10));
        }
      }
    } catch (err: any) {
      setReportMessage(err?.response?.data?.error || 'Unable to load report definitions.');
    }
  }, [selectedReport, user?.role]);

  useEffect(() => {
    const current = reportDefs.find((def) => def.key === selectedReport);
    if (!current?.filters?.defaultRangeDays || (reportFromDate && reportToDate)) return;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - Math.max(1, current.filters.defaultRangeDays));
    setReportToDate(end.toISOString().slice(0, 10));
    setReportFromDate(start.toISOString().slice(0, 10));
  }, [reportDefs, reportFromDate, reportToDate, selectedReport]);

  useEffect(() => {
    if (user?.role === 'ADMIN' || user?.role === 'OPS') {
      loadReportDefinitions();
    } else {
      setReportDefs([]);
    }
  }, [loadReportDefinitions, user?.role]);

  const exportReport = useCallback(async () => {
    if (!selectedReport) {
      setReportMessage('Select a report to export.');
      return;
    }
    setReportStatus('loading');
    setReportMessage(null);
    try {
      const payload: any = {
        reportKey: selectedReport,
        format: selectedReportFormat,
        filters: {
          fromDate: reportFromDate || undefined,
          toDate: reportToDate || undefined,
        },
      };
      const res = await api.post('/api/reports/export', payload);
      const fileName = res.data?.fileName || `${selectedReport}.${selectedReportFormat === 'excel' ? 'xlsx' : 'pdf'}`;
      const mimeType =
        res.data?.mimeType ||
        (selectedReportFormat === 'excel'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'application/pdf');
      const dataUrl = `data:${mimeType};base64,${res.data?.data}`;
      await Linking.openURL(dataUrl);
      setReportMessage(`Export ready: ${fileName}`);
    } catch (err: any) {
      setReportMessage(err?.response?.data?.error || 'Unable to export report.');
    } finally {
      setReportStatus('idle');
    }
  }, [reportFromDate, reportToDate, selectedReport, selectedReportFormat]);

  const lastUpdated = useMemo(() => {
    if (!articles.length) return null;
    const sample = articles[0]?.createdAt;
    if (!sample) return null;
    try {
      return new Date(sample).toLocaleString();
    } catch {
      return sample;
    }
  }, [articles]);

  const canManageFuel = user?.role === 'FUEL' || user?.role === 'ADMIN';
  const isAdminOrOps = user?.role === 'ADMIN' || user?.role === 'OPS';
  const workspaceSections = useMemo(() => {
    if (!user?.role) return [];
    return WORKSPACE_SECTIONS.filter((section) => section.roles.includes(user.role));
  }, [user?.role]);

  useEffect(() => {
    if (!workspaceSections.length) return;
    if (!workspaceSections.some((section) => section.key === workspaceTab)) {
      setWorkspaceTab(workspaceSections[0].key);
    }
  }, [workspaceSections, workspaceTab]);

  useEffect(() => {
    if (!user) {
      setWorkspaceTab('orders');
    }
  }, [user]);

  const renderWorkspaceContent = () => {
    if (!user) {
      return (
        <View style={styles.workspacePanel}>
          <Text style={styles.ordersHint}>Sign in to access operational dashboards.</Text>
        </View>
      );
    }
    const wrap = (node: React.ReactNode) => <View style={styles.workspacePanel}>{node}</View>;
    switch (workspaceTab) {
      case 'orders':
        return wrap(
          user.role === 'CUSTOMER' ? (
            <MyOrdersSection orders={myOrders} status={ordersStatus} message={ordersMessage} onReload={loadCustomerOrders} />
          ) : (
            <WorkspacePlaceholder
              title="Orders desk"
              description="Operations teams can manage the full order lifecycle from the web console."
              actionLabel="Open web portal"
              actionUrl="https://www.ariseandshinetransporters.com/login"
            />
          ),
        );
      case 'driver':
        return wrap(
          user.role === 'DRIVER' ? (
            <DriverPulse
              dashboard={driverDashboard}
              status={driverDashboardStatus}
              message={driverDashboardMessage}
              onReload={() => loadDriverDashboard(user.driverId)}
            />
          ) : (
            <WorkspacePlaceholder
              title="Driver pulse"
              description="Switch to a driver login to view assignments, telemetry, and leaderboard stats."
              actionLabel="Switch account"
            />
          ),
        );
      case 'driverDocs':
        return wrap(
          <DriverFormSection
            form={driverForm}
            status={driverFormStatus}
            message={driverFormMessage}
            onChange={updateDriverFormField}
            onDocChange={updateDriverDocument}
            onSave={saveDriverForm}
            onPrint={printDriverForm}
            onReload={fetchDriverForm}
          />,
        );
      case 'fuel':
        return wrap(
          canManageFuel ? (
            <FuelSection
              logs={fuelLogs}
              status={fuelStatus}
              message={fuelMessage}
              form={fuelForm}
              onChange={updateFuelForm}
              onSubmit={submitFuelLog}
              submitting={fuelSubmitting}
              onPickPhoto={pickFuelPhoto}
            />
          ) : (
            <WorkspacePlaceholder
              title="Fuel monitor"
              description="Only fuel and admin profiles can capture pump stops."
              actionLabel="Request access"
            />
          ),
        );
      case 'reports':
        return wrap(
          isAdminOrOps ? (
            <ReportsSection
              definitions={reportDefs}
              formats={reportFormats}
              selectedReport={selectedReport}
              onSelectReport={setSelectedReport}
              selectedFormat={selectedReportFormat}
              onSelectFormat={(value) => setSelectedReportFormat(value as 'excel' | 'pdf')}
              fromDate={reportFromDate}
              toDate={reportToDate}
              onFromDate={setReportFromDate}
              onToDate={setReportToDate}
              onExport={exportReport}
              status={reportStatus}
              message={reportMessage}
            />
          ) : (
            <WorkspacePlaceholder
              title="Reports & exports"
              description="Excel and PDF packs live under admin or ops credentials."
              actionLabel="Switch account"
            />
          ),
        );
      case 'fleet':
        return wrap(
          <WorkspacePlaceholder
            title="Fleet view"
            description="Live GPS, load board, and truck reassignment sit inside the full web dashboard."
            actionLabel="Open fleet dashboard"
            actionUrl="https://www.ariseandshinetransporters.com/dashboard"
          />,
        );
      case 'ai':
        return wrap(
          <WorkspacePlaceholder
            title="AI workspace"
            description="Chat with dispatch AI, run audits, and unlock automations via the admin console."
            actionLabel="Open AI console"
            actionUrl="https://www.ariseandshinetransporters.com/dashboard?tab=ai"
          />,
        );
      case 'news':
        return wrap(<ArticlesSection articles={articles} status={status} error={error} onReload={() => loadArticles()} />);
      default:
        return wrap(
          <Text style={styles.ordersHint}>Select a workspace option to get started.</Text>
        );
    }
  };

  if (variant === 'landing') {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          <HeroSection pricing={pricingGuide} lastUpdated={lastUpdated} onOrder={scrollToOrder} onRefresh={() => loadArticles({ silent: true })} />

          <View onLayout={handleOrderSectionLayout}>
            <CustomerOrderSection
              form={orderForm}
              onFormChange={updateOrderForm}
              quote={quote}
              quoteStatus={quoteStatus}
              quoteError={quoteError}
              pricing={pricingGuide}
              createAccount={createAccount}
              onToggleAccount={setCreateAccount}
              accountPassword={accountPassword}
              onAccountPassword={setAccountPassword}
              accountConfirm={accountConfirm}
              onAccountConfirm={setAccountConfirm}
              status={orderStatus}
              summary={orderSummary}
              contact={orderContact}
              onSubmit={submitGuestOrder}
              submitting={placingOrder}
              onReset={resetGuestOrderFlow}
              bankOptions={BANK_OPTIONS}
            />
          </View>

          <WorkspacesIntro userRole={user?.role} isAuthenticated={Boolean(user)} />

          <TouchableOpacity
            style={styles.workspaceSwitch}
            onPress={() =>
              Alert.alert('Sign in required', 'Enter your credentials below to access the team workspace.')
            }
          >
            <Text style={styles.workspaceSwitchText}>Access team workspace</Text>
          </TouchableOpacity>

          <ArticlesSection articles={articles} status={status} error={error} onReload={() => loadArticles()} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <View style={styles.workspaceHeader}>
          <Text style={styles.workspaceTitle}>Arise &amp; Shine workspace</Text>
        </View>

        {user ? (
          <>
            <View style={styles.workspaceHeroCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.workspaceHeroTitle}>{user.name || user.email}</Text>
                <Text style={styles.workspaceHeroRole}>{user.role}</Text>
                <Text style={styles.workspaceHeroMeta}>{user.email}</Text>
              </View>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleLogout}>
                <Text style={styles.secondaryButtonText}>Sign out</Text>
              </TouchableOpacity>
            </View>

            {workspaceSections.length > 0 ? (
              <WorkspaceTabs sections={workspaceSections} active={workspaceTab} onSelect={setWorkspaceTab} />
            ) : (
              <Text style={styles.ordersHint}>No workspace modules available for this role yet.</Text>
            )}

            {renderWorkspaceContent()}
          </>
        ) : (
          <KeyboardAvoidingView
            style={styles.loginCard}
            behavior={Platform.select({ ios: 'padding', android: undefined })}
          >
            <View>
              <Text style={styles.sectionHeading}>Sign in to your workspace</Text>
              <Text style={styles.loginHelper}>
                Admin, ops, fuel, driver, and customer accounts share one secure gateway.
              </Text>
              <View style={styles.roleChipRow}>
                {['Customer', 'Driver', 'Ops', 'Fuel', 'Admin'].map((role) => (
                  <View key={role} style={styles.roleChip}>
                    <Text style={styles.roleChipText}>{role}</Text>
                  </View>
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#94a3b8"
                autoCapitalize="none"
                keyboardType="email-address"
                value={credentials.email}
                textContentType="emailAddress"
                onChangeText={(text) => setCredentials((prev) => ({ ...prev, email: text }))}
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#94a3b8"
                secureTextEntry
                textContentType="password"
                value={credentials.password}
                onChangeText={(text) => setCredentials((prev) => ({ ...prev, password: text }))}
              />
              {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
              <TouchableOpacity style={styles.primaryButton} onPress={handleLogin} disabled={authLoading}>
                {authLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Sign in</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.linkButton} onPress={handlePasswordReset} disabled={authLoading}>
                <Text style={styles.linkButtonText}>Forgot password?</Text>
              </TouchableOpacity>
              {resetState === 'sent' && <Text style={styles.successText}>Reset email queued (check your inbox).</Text>}
              {resetState === 'error' && <Text style={styles.errorText}>Could not send reset email.</Text>}
            </View>
          </KeyboardAvoidingView>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

type HeroSectionProps = {
  pricing: PricingGuide | null;
  lastUpdated: string | null;
  onOrder: () => void;
  onRefresh: () => void;
};

function HeroSection({ pricing, lastUpdated, onOrder, onRefresh }: HeroSectionProps) {
  const baseRate = pricing ? `KES ${pricing.basePrice.toLocaleString()} / ${pricing.baseDistanceKm} km` : 'Live quote';
  return (
    <ImageBackground
      source={require('../../assets/truck-1.jpg')}
      style={styles.heroImage}
      imageStyle={{ borderRadius: 24 }}
    >
      <View style={styles.heroDark}>
        <View style={styles.heroCopy}>
          <Text style={styles.heroTitle}>Order Now.{'\n'}We Deliver.</Text>
          <Text style={styles.heroSubtitle}>Premium river sand, same-day dispatch across Kenya.</Text>
        </View>
        <View style={styles.heroStatRow}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatLabel}>BASE RATE</Text>
            <Text style={styles.heroStatValue}>{baseRate}</Text>
          </View>
          {HERO_FACTS.map((fact) => (
            <View key={fact.label} style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>{fact.label.toUpperCase()}</Text>
              <Text style={styles.heroStatValue}>{fact.value}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity style={styles.ctaButton} onPress={onOrder}>
          <Text style={styles.ctaButtonText}>Order sand  →</Text>
        </TouchableOpacity>
      </View>
    </ImageBackground>
  );
}

type CustomerOrderSectionProps = {
  form: GuestOrderForm;
  onFormChange: (patch: Partial<GuestOrderForm>) => void;
  quote: Quote | null;
  quoteStatus: 'idle' | 'loading' | 'error';
  quoteError: string | null;
  pricing: PricingGuide | null;
  createAccount: boolean;
  onToggleAccount: (value: boolean) => void;
  accountPassword: string;
  onAccountPassword: (value: string) => void;
  accountConfirm: string;
  onAccountConfirm: (value: string) => void;
  status: { kind: 'idle' | 'success' | 'error'; message: string };
  summary: GuestOrderSummary | null;
  contact: GuestOrderForm | null;
  onSubmit: () => void;
  submitting: boolean;
  onReset: () => void;
  bankOptions: typeof BANK_OPTIONS;
};

function CustomerOrderSection({
  form,
  onFormChange,
  quote,
  quoteStatus,
  quoteError,
  pricing,
  createAccount,
  onToggleAccount,
  accountPassword,
  onAccountPassword,
  accountConfirm,
  onAccountConfirm,
  status,
  summary,
  contact,
  onSubmit,
  submitting,
  onReset,
  bankOptions,
}: CustomerOrderSectionProps) {
  const truckLabel = `${form.trucks} truck${form.trucks > 1 ? 's' : ''}`;
  return (
    <View style={styles.orderCard}>
      <Text style={styles.orderHeading}>Premium sand deliveries</Text>
      <Text style={styles.orderSubheading}>Tell us where to deliver and dispatch will confirm in minutes.</Text>
      <View style={styles.quoteCard}>
        <Text style={styles.quoteLabel}>Live estimate</Text>
        {quoteStatus === 'loading' ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Text style={styles.quoteValue}>{quote ? formatKes(quote.perTruck) : 'Requesting...'}</Text>
            <Text style={styles.quoteHint}>
              {quote
                ? `${formatKes(quote.total)} • ${formatDistance(quote.distanceKm, quote.distanceSource)}`
                : pricing
                ? `Base ${formatKes(pricing.basePrice)} within ${pricing.baseDistanceKm} km`
                : 'Share your site to unlock pricing.'}
            </Text>
            {quoteError ? <Text style={styles.quoteError}>{quoteError}</Text> : null}
          </>
        )}
      </View>
      <View style={styles.orderFormGrid}>
        <View style={styles.orderField}>
          <Text style={styles.orderLabel}>Contact name</Text>
          <TextInput style={styles.orderInput} value={form.name} onChangeText={(text) => onFormChange({ name: text })} />
        </View>
        <View style={styles.orderField}>
          <Text style={styles.orderLabel}>Phone (MPESA)</Text>
          <TextInput
            style={styles.orderInput}
            value={form.phone}
            onChangeText={(text) => onFormChange({ phone: text })}
            keyboardType="phone-pad"
          />
        </View>
        <View style={styles.orderField}>
          <Text style={styles.orderLabel}>Email</Text>
          <TextInput
            style={styles.orderInput}
            value={form.email}
            autoCapitalize="none"
            onChangeText={(text) => onFormChange({ email: text })}
            keyboardType="email-address"
          />
        </View>
        <View style={styles.orderField}>
          <Text style={styles.orderLabel}>Delivery site</Text>
          <TextInput style={styles.orderInput} value={form.site} onChangeText={(text) => onFormChange({ site: text })} />
        </View>
        <View style={styles.orderField}>
          <Text style={styles.orderLabel}>Sand type</Text>
          <View style={styles.orderChips}>
            {(['coarse', 'smooth'] as const).map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.orderChip, form.sandType === type && styles.orderChipActive]}
                onPress={() => onFormChange({ sandType: type })}
              >
                <Text style={[styles.orderChipText, form.sandType === type && styles.orderChipTextActive]}>
                  {type === 'coarse' ? 'Coarse' : 'Smooth'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.orderField}>
          <Text style={styles.orderLabel}>Trucks</Text>
          <View style={styles.truckStepper}>
            <TouchableOpacity
              style={styles.truckButton}
              onPress={() => onFormChange({ trucks: Math.max(1, form.trucks - 1) })}
            >
              <Text style={styles.truckButtonText}>-</Text>
            </TouchableOpacity>
            <Text style={styles.truckCount}>{truckLabel}</Text>
            <TouchableOpacity
              style={styles.truckButton}
              onPress={() => onFormChange({ trucks: Math.min(20, form.trucks + 1) })}
            >
              <Text style={styles.truckButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.orderField}>
          <Text style={styles.orderLabel}>Distance (km)</Text>
          <TextInput
            style={styles.orderInput}
            placeholder="optional"
            value={form.distanceKm}
            onChangeText={(text) => onFormChange({ distanceKm: text })}
            keyboardType="number-pad"
          />
        </View>
        <View style={styles.orderField}>
          <Text style={styles.orderLabel}>Required date</Text>
          <TextInput
            style={styles.orderInput}
            placeholder="YYYY-MM-DD"
            value={form.dateNeeded}
            onChangeText={(text) => onFormChange({ dateNeeded: text })}
          />
        </View>
      </View>
      <View style={styles.orderToggleRow}>
        <Text style={styles.orderLabel}>Create customer portal account</Text>
        <Switch value={createAccount} onValueChange={onToggleAccount} />
      </View>
      {createAccount && (
        <>
          <TextInput
            style={styles.orderInput}
            placeholder="Password"
            secureTextEntry
            value={accountPassword}
            onChangeText={onAccountPassword}
          />
          <TextInput
            style={styles.orderInput}
            placeholder="Confirm password"
            secureTextEntry
            value={accountConfirm}
            onChangeText={onAccountConfirm}
          />
        </>
      )}
      {status.message ? (
        <Text style={status.kind === 'error' ? styles.errorText : styles.successText}>{status.message}</Text>
      ) : null}
      <TouchableOpacity style={[styles.primaryButton, styles.orderButton]} onPress={onSubmit} disabled={submitting}>
        <Text style={styles.primaryButtonText}>{submitting ? 'Submitting...' : 'Place order'}</Text>
      </TouchableOpacity>
      {summary && (
        <OrderSummaryCard summary={summary} contact={contact} onReset={onReset} bankOptions={bankOptions} />
      )}
    </View>
  );
}

type OrderSummaryCardProps = {
  summary: GuestOrderSummary;
  contact: GuestOrderForm | null;
  onReset: () => void;
  bankOptions: typeof BANK_OPTIONS;
};

function OrderSummaryCard({ summary, contact, onReset, bankOptions }: OrderSummaryCardProps) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryHeader}>
        <Text style={styles.summaryTitle}>Order #{summary.id}</Text>
        <TouchableOpacity onPress={onReset}>
          <Text style={styles.summaryReset}>Start another</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.summaryStatus}>Status: {summary.status}</Text>
      <View style={styles.summaryRows}>
        <Text style={styles.summaryRow}>Site: {contact?.site || 'n/a'}</Text>
        <Text style={styles.summaryRow}>
          Trucks: {summary.truckCount} ({summary.sandType.toUpperCase()})
        </Text>
        <Text style={styles.summaryRow}>Per truck: {formatKes(summary.perTruck)}</Text>
        <Text style={styles.summaryRow}>Total: {formatKes(summary.total)}</Text>
        <Text style={styles.summaryRow}>Distance: {formatDistance(summary.distanceKm, summary.distanceSource)}</Text>
      </View>
      <Text style={styles.summaryHint}>Paybill options (Account name: Arise &amp; Shine)</Text>
      {bankOptions.map((bank) => (
        <View key={bank.bank} style={styles.bankRow}>
          <Text style={styles.bankName}>{bank.bank}</Text>
          <Text style={styles.bankDetails}>Paybill {bank.paybill}</Text>
          <Text style={styles.bankDetails}>Account {bank.account}</Text>
        </View>
      ))}
      <Text style={styles.summaryNote}>Share the MPESA reference via the portal or call dispatch to mobilise trucks.</Text>
    </View>
  );
}

type WorkspacesIntroProps = {
  userRole?: string | null;
  isAuthenticated: boolean;
};

function WorkspacesIntro({ userRole, isAuthenticated }: WorkspacesIntroProps) {
  const cards = [
    { key: 'customer', title: 'Customer', copy: 'Request quotes, confirm payment, and track truck assignments.' },
    { key: 'driver', title: 'Driver', copy: 'View loads, capture onboarding, and monitor your earnings trend.' },
    { key: 'ops', title: 'Ops', copy: 'Reconcile orders, manage stock, and watch telemetry in real time.' },
    { key: 'fuel', title: 'Fuel', copy: 'Log pump stops, mileage, and receipts for instant audit trails.' },
    { key: 'admin', title: 'Admin', copy: 'Unlock reports, AI copilot, fleet management, and audit history.' },
  ];
  return (
    <View style={styles.workspacesCard}>
      <Text style={styles.workspacesHeading}>Workspaces</Text>
      <Text style={styles.workspacesSubheading}>
        {isAuthenticated ? 'You are connected. Jump into any workspace below.' : 'Sign in to unlock every workspace.'}
      </Text>
      <View style={styles.workspacesGrid}>
        {cards.map((card) => {
          const active = userRole?.toLowerCase() === card.key || (card.key === 'ops' && userRole === 'ADMIN');
          return (
            <View key={card.key} style={[styles.workspaceTile, active && styles.workspaceTileActive]}>
              <Text style={styles.workspaceTitle}>{card.title}</Text>
              <Text style={styles.workspaceCopy}>{card.copy}</Text>
              <Text style={[styles.workspaceStatus, active && styles.workspaceStatusActive]}>
                {active ? 'Signed in' : 'Requires login'}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

type MyOrdersSectionProps = {
  orders: CustomerOrder[];
  status: 'idle' | 'loading' | 'error';
  message: string | null;
  onReload: () => void;
};

function MyOrdersSection({ orders, status, message, onReload }: MyOrdersSectionProps) {
  return (
    <View style={styles.ordersCard}>
      <View style={styles.ordersHeader}>
        <Text style={styles.sectionHeading}>My sand orders</Text>
        <TouchableOpacity onPress={onReload}>
          <Text style={styles.linkButtonText}>Refresh</Text>
        </TouchableOpacity>
      </View>
      {status === 'loading' && <Text style={styles.ordersHint}>Loading your deliveries...</Text>}
      {status === 'error' && message && <Text style={styles.errorText}>{message}</Text>}
      {!orders.length && status === 'idle' && !message && (
        <Text style={styles.ordersHint}>No orders yet. Use the form above to place your first request.</Text>
      )}
      {orders.map((order) => (
        <View key={order.id} style={styles.orderItem}>
          <View style={styles.orderItemHeader}>
            <Text style={styles.orderItemTitle}>{order.site}</Text>
            <Text style={styles.orderBadge}>{order.status}</Text>
          </View>
          <Text style={styles.orderItemMeta}>{new Date(order.created_at).toLocaleString()}</Text>
          <Text style={styles.orderItemMeta}>
            {order.trucks} truck(s) • {order.sand_type?.toUpperCase() || 'N/A'} • {formatKes(order.total)}
          </Text>
          <Text style={styles.orderItemMeta}>Distance {formatDistance(order.distance_km, order.distance_source)}</Text>
          <Text style={styles.orderItemMeta}>Payment: {order.payment_status || 'PENDING'}</Text>
        </View>
      ))}
    </View>
  );
}

type DriverPulseProps = {
  dashboard: DriverDashboard | null;
  status: 'idle' | 'loading' | 'error';
  message: string | null;
  onReload: () => void;
};

function DriverPulse({ dashboard, status, message, onReload }: DriverPulseProps) {
  return (
    <View style={styles.driverCard}>
      <View style={styles.ordersHeader}>
        <Text style={styles.sectionHeading}>Driver pulse</Text>
        <TouchableOpacity onPress={onReload}>
          <Text style={styles.linkButtonText}>Refresh</Text>
        </TouchableOpacity>
      </View>
      {status === 'loading' && <Text style={styles.ordersHint}>Loading assignments...</Text>}
      {status === 'error' && message && <Text style={styles.errorText}>{message}</Text>}
      {dashboard?.summary && (
        <View style={styles.driverStats}>
          <View style={styles.driverStat}>
            <Text style={styles.driverStatLabel}>Loads delivered</Text>
            <Text style={styles.driverStatValue}>{dashboard.summary.loadsDelivered}</Text>
          </View>
          <View style={styles.driverStat}>
            <Text style={styles.driverStatLabel}>Tonnes delivered</Text>
            <Text style={styles.driverStatValue}>{dashboard.summary.tonnesDelivered}</Text>
          </View>
          <View style={styles.driverStat}>
            <Text style={styles.driverStatLabel}>Earnings</Text>
            <Text style={styles.driverStatValue}>{formatKes(dashboard.summary.earningsDelivered)}</Text>
          </View>
        </View>
      )}
      {dashboard?.assignments?.length ? (
        dashboard.assignments.slice(0, 3).map((assignment) => (
          <View key={assignment.id} style={styles.assignmentRow}>
            <Text style={styles.assignmentTitle}>{assignment.site || assignment.id}</Text>
            <Text style={styles.assignmentMeta}>{assignment.status || 'TBC'}</Text>
            <Text style={styles.assignmentMeta}>
              {assignment.scheduledAt ? new Date(assignment.scheduledAt).toLocaleString() : 'Schedule TBC'}
            </Text>
          </View>
        ))
      ) : (
        <Text style={styles.ordersHint}>Dispatch will share your next assignment soon.</Text>
      )}
    </View>
  );
}

type FuelSectionProps = {
  logs: FuelLog[];
  status: 'idle' | 'loading' | 'error';
  message: string | null;
  form: FuelFormState;
  onChange: (patch: Partial<FuelFormState>) => void;
  onSubmit: () => void;
  submitting: boolean;
  onPickPhoto: () => void;
};

function FuelSection({ logs, status, message, form, onChange, onSubmit, submitting, onPickPhoto }: FuelSectionProps) {
  return (
    <View style={styles.fuelCard}>
      <Text style={styles.sectionHeading}>Fuel &amp; mileage monitor</Text>
      <View style={styles.fuelFormRow}>
        <View style={styles.orderField}>
          <Text style={styles.orderLabel}>Truck ID</Text>
          <TextInput style={styles.orderInput} value={form.truckId} onChangeText={(text) => onChange({ truckId: text })} />
        </View>
        <View style={styles.orderField}>
          <Text style={styles.orderLabel}>Litres</Text>
          <TextInput
            style={styles.orderInput}
            value={form.litres}
            onChangeText={(text) => onChange({ litres: text })}
            keyboardType="number-pad"
          />
        </View>
        <View style={styles.orderField}>
          <Text style={styles.orderLabel}>Cost</Text>
          <TextInput
            style={styles.orderInput}
            value={form.cost}
            onChangeText={(text) => onChange({ cost: text })}
            keyboardType="number-pad"
          />
        </View>
        <View style={styles.orderField}>
          <Text style={styles.orderLabel}>Odometer</Text>
          <TextInput
            style={styles.orderInput}
            value={form.odometer}
            onChangeText={(text) => onChange({ odometer: text })}
            keyboardType="number-pad"
          />
        </View>
      </View>
      <TextInput
        style={[styles.orderInput, styles.fuelNote]}
        placeholder="Note (station, driver, etc)"
        value={form.note}
        onChangeText={(text) => onChange({ note: text })}
        multiline
      />
      <View style={styles.fuelActions}>
        <TouchableOpacity style={styles.secondaryButton} onPress={onPickPhoto}>
          <Text style={styles.secondaryButtonText}>{form.photoData ? 'Replace photo' : 'Attach photo'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.primaryButton, styles.orderButton]} onPress={onSubmit} disabled={submitting}>
          <Text style={styles.primaryButtonText}>{submitting ? 'Saving...' : 'Log fuel stop'}</Text>
        </TouchableOpacity>
      </View>
      {message && <Text style={status === 'error' ? styles.errorText : styles.successText}>{message}</Text>}
      <Text style={styles.fuelHistoryTitle}>Recent logs</Text>
      {status === 'loading' && <Text style={styles.ordersHint}>Syncing logs...</Text>}
      {logs.map((log) => (
        <View key={log.id} style={styles.fuelLogRow}>
          <Text style={styles.fuelLogTitle}>
            {log.plate || log.truckId} • {log.litres || 0} L @ {formatKes(log.cost)}
          </Text>
          <Text style={styles.fuelLogMeta}>{formatDateTime(log.capturedAt)}</Text>
          <Text style={styles.fuelLogMeta}>{log.note || 'No note'}</Text>
        </View>
      ))}
      {!logs.length && status === 'idle' && <Text style={styles.ordersHint}>No logs captured yet.</Text>}
    </View>
  );
}

type ArticlesSectionProps = {
  articles: Article[];
  status: 'idle' | 'loading' | 'error';
  error: string | null;
  onReload: () => void;
};

function ArticlesSection({ articles, status, error, onReload }: ArticlesSectionProps) {
  return (
    <View style={styles.articlesCard}>
      <View style={styles.ordersHeader}>
        <Text style={styles.sectionHeading}>Operations feed</Text>
        <TouchableOpacity onPress={onReload}>
          <Text style={styles.linkButtonText}>Reload</Text>
        </TouchableOpacity>
      </View>
      {status === 'loading' && <Text style={styles.ordersHint}>Contacting server...</Text>}
      {status === 'error' && error && <Text style={styles.errorText}>{error}</Text>}
      {articles.map((article) => (
        <View key={article.id} style={styles.articleCard}>
          <Text style={styles.articleTitle}>{article.title}</Text>
          <Text style={styles.articleSummary}>{article.summary || 'Stay tuned for more updates.'}</Text>
          <Text style={styles.articleMeta}>
            {article.topic ? `${article.topic.toUpperCase()} • ` : ''}
            {article.createdAt ? new Date(article.createdAt).toLocaleDateString() : 'Draft'}
          </Text>
        </View>
      ))}
      {!articles.length && status === 'idle' && <Text style={styles.ordersHint}>No articles yet.</Text>}
    </View>
  );
}

type WorkspaceTabsProps = {
  sections: WorkspaceSection[];
  active: string;
  onSelect: (key: string) => void;
};

function WorkspaceTabs({ sections, active, onSelect }: WorkspaceTabsProps) {
  if (!sections.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.workspaceNav}>
      {sections.map((section) => {
        const selected = section.key === active;
        return (
          <TouchableOpacity
            key={section.key}
            style={[styles.workspaceNavButton, selected && styles.workspaceNavButtonActive]}
            onPress={() => onSelect(section.key)}
          >
            <Text style={[styles.workspaceNavText, selected && styles.workspaceNavTextActive]}>{section.label}</Text>
            <Text style={[styles.workspaceNavHint, selected && styles.workspaceNavTextActive]}>{section.description}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

type WorkspacePlaceholderProps = {
  title: string;
  description: string;
  actionLabel?: string;
  actionUrl?: string;
};

function WorkspacePlaceholder({ title, description, actionLabel, actionUrl }: WorkspacePlaceholderProps) {
  const handlePress = () => {
    if (!actionUrl) return;
    Linking.openURL(actionUrl).catch(() => Alert.alert('Unable to open link', 'Please try again from a browser.'));
  };
  return (
    <View style={styles.placeholderCard}>
      <Text style={styles.placeholderTitle}>{title}</Text>
      <Text style={styles.placeholderCopy}>{description}</Text>
      {actionLabel && (
        <TouchableOpacity style={styles.placeholderButton} onPress={handlePress} disabled={!actionUrl}>
          <Text style={styles.placeholderButtonText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function AriseLogo({ size = 96 }: { size?: number }) {
  const height = size * 0.6;
  return (
    <Svg width={size} height={height} viewBox="0 0 200 120">
      <Defs>
        <LinearGradient id="sunGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <Stop offset="0%" stopColor="#0f172a" />
          <Stop offset="100%" stopColor="#0f172a" />
        </LinearGradient>
      </Defs>
      <Circle cx="80" cy="55" r="35" fill="url(#sunGradient)" />
      {[...Array(8)].map((_, index) => {
        const angle = (Math.PI / 4) * index;
        const x1 = 80 + Math.cos(angle) * 38;
        const y1 = 55 + Math.sin(angle) * 38;
        const x2 = 80 + Math.cos(angle) * 55;
        const y2 = 55 + Math.sin(angle) * 55;
        return <Path key={index} d={`M ${x1} ${y1} L ${x2} ${y2}`} stroke="#0f172a" strokeWidth={4} strokeLinecap="round" />;
      })}
      <Rect x="95" y="55" width="80" height="30" rx="8" fill="#0f172a" />
      <Path d="M165 50 L185 50 L190 70 L165 70 Z" fill="#0f172a" />
      <Circle cx="115" cy="90" r="12" fill="#0f172a" />
      <Circle cx="170" cy="90" r="12" fill="#0f172a" />
      <Path d="M95 58 H70 C60 58 55 65 55 72 H95 Z" fill="#0f172a" />
    </Svg>
  );
}

type DriverFormSectionProps = {
  form: DriverOnboardingForm | null;
  status: 'idle' | 'loading' | 'saving';
  message: string | null;
  onChange: (path: string, value: string) => void;
  onDocChange: (index: number, key: 'provided' | 'remarks', value: boolean | string) => void;
  onSave: (status: 'draft' | 'submitted') => void;
  onPrint: () => void;
  onReload: () => void;
};

const mobileDriverFieldGroups: { title: string; fields: { path: string; label: string; multiline?: boolean }[] }[] = [
  {
    title: 'Personal details',
    fields: [
      { path: 'personalDetails.surname', label: 'Surname' },
      { path: 'personalDetails.otherNames', label: 'Other names' },
      { path: 'personalDetails.idNumber', label: 'ID / Passport number' },
      { path: 'personalDetails.mobileNumber', label: 'Mobile number' },
      { path: 'personalDetails.emailAddress', label: 'Email address' },
    ],
  },
  {
    title: 'Job & contact info',
    fields: [
      { path: 'jobDetails.positionAppliedFor', label: 'Position applied for' },
      { path: 'jobDetails.preferredLocation', label: 'Preferred location' },
      { path: 'jobDetails.vehicleNumber', label: 'Vehicle number' },
      { path: 'jobDetails.payrollNumber', label: 'Payroll number' },
      { path: 'residentialAddress.postalAddress', label: 'Postal address' },
    ],
  },
  {
    title: 'Emergency contact',
    fields: [
      { path: 'nextOfKin.0.name', label: 'Next of kin name' },
      { path: 'nextOfKin.0.relationship', label: 'Relationship' },
      { path: 'nextOfKin.0.phone', label: 'Phone' },
      { path: 'nextOfKin.0.address', label: 'Postal address', multiline: true },
    ],
  },
];

function DriverFormSection({ form, status, message, onChange, onDocChange, onSave, onPrint, onReload }: DriverFormSectionProps) {
  const isMarried = (form?.personalDetails?.maritalStatus || '').toLowerCase() === 'married';
  const documents = (form?.documentsChecklist || []).filter((doc) => !doc?.requiresSpouse || isMarried);
  return (
    <View style={styles.onboardCard}>
      <View style={styles.onboardHeader}>
        <Text style={styles.sectionHeading}>Driver onboarding</Text>
        <TouchableOpacity onPress={onReload} style={styles.onboardReload}>
          <Text style={styles.onboardReloadText}>Reload</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.onboardHint}>Fill out the key registration details requested by Arise &amp; Shine HR.</Text>
      {status === 'loading' && (
        <View style={styles.onboardStatusRow}>
          <ActivityIndicator size="small" color="#0b6efd" />
          <Text style={styles.onboardStatusText}>Loading form...</Text>
        </View>
      )}
      {!form && status !== 'loading' && (
        <TouchableOpacity style={styles.primaryButton} onPress={onReload}>
          <Text style={styles.primaryButtonText}>Load onboarding form</Text>
        </TouchableOpacity>
      )}
      {form && (
        <>
          {mobileDriverFieldGroups.map((group) => (
            <View key={group.title} style={styles.onboardSection}>
              <Text style={styles.onboardTitle}>{group.title}</Text>
              {group.fields.map((field) => (
                <View key={field.path} style={styles.onboardField}>
                  <Text style={styles.onboardLabel}>{field.label}</Text>
                  <TextInput
                    style={[styles.input, styles.onboardInput, field.multiline && styles.onboardTextarea]}
                    multiline={field.multiline}
                    value={getNestedValue(form, field.path)}
                    onChangeText={(text) => onChange(field.path, text)}
                  />
                </View>
              ))}
            </View>
          ))}

          <View style={styles.onboardSection}>
            <Text style={styles.onboardTitle}>Documents checklist</Text>
            {documents.slice(0, 6).map((doc, index) => {
              const docIndex = (form?.documentsChecklist || []).indexOf(doc);
              return (
              <View key={doc.code || index} style={styles.onboardDocumentRow}>
                <View style={styles.onboardDocumentInfo}>
                  <Text style={styles.onboardLabel}>{doc.label}</Text>
                  <TextInput
                    style={[styles.input, styles.onboardInput, styles.onboardDocRemark]}
                    placeholder="Remarks"
                    placeholderTextColor="#94a3b8"
                    value={doc.remarks || ''}
                    onChangeText={(text) => onDocChange(docIndex, 'remarks', text)}
                  />
                </View>
                <Switch value={Boolean(doc.provided)} onValueChange={(value) => onDocChange(docIndex, 'provided', value)} />
              </View>
              );
            })}
          </View>

          {message && <Text style={styles.onboardMessage}>{message}</Text>}

          <View style={styles.onboardActions}>
            <TouchableOpacity style={[styles.primaryButton, styles.onboardActionButton]} onPress={() => onSave('draft')} disabled={status === 'saving'}>
              <Text style={styles.primaryButtonText}>{status === 'saving' ? 'Saving...' : 'Save draft'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, styles.onboardActionButton, styles.onboardSubmitButton]}
              onPress={() => onSave('submitted')}
              disabled={status === 'saving'}
            >
              <Text style={styles.primaryButtonText}>Submit form</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.secondaryButton} onPress={onPrint}>
            <Text style={styles.secondaryButtonText}>Open printable form</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

function deepCloneForm(form: DriverOnboardingForm): DriverOnboardingForm {
  return JSON.parse(JSON.stringify(form));
}

function getNestedValue(form: DriverOnboardingForm, path: string) {
  const resolved = path.split('.').reduce<any>((value, segment) => {
    if (value === null || value === undefined) return undefined;
    if (/^[0-9]+$/.test(segment)) {
      const idx = Number(segment);
      return Array.isArray(value) ? value[idx] : undefined;
    }
    return value[segment];
  }, form);
  return resolved ?? '';
}

type ReportsSectionProps = {
  definitions: MobileReportDefinition[];
  formats: string[];
  selectedReport: string;
  onSelectReport: (key: string) => void;
  selectedFormat: string;
  onSelectFormat: (key: string) => void;
  fromDate: string;
  toDate: string;
  onFromDate: (value: string) => void;
  onToDate: (value: string) => void;
  onExport: () => void;
  status: 'idle' | 'loading';
  message: string | null;
};

function ReportsSection({
  definitions,
  formats,
  selectedReport,
  onSelectReport,
  selectedFormat,
  onSelectFormat,
  fromDate,
  toDate,
  onFromDate,
  onToDate,
  onExport,
  status,
  message,
}: ReportsSectionProps) {
  if (!definitions.length) {
    return (
      <View style={styles.reportCard}>
        <Text style={styles.sectionHeading}>Reports workspace</Text>
        <Text style={styles.onboardHint}>Sign in as an admin to request Excel or PDF exports.</Text>
      </View>
    );
  }
  return (
    <View style={styles.reportCard}>
      <Text style={styles.sectionHeading}>Reports workspace</Text>
      <Text style={styles.onboardHint}>Generate stock, driver earnings, or truck performance exports.</Text>
      <Text style={styles.reportLabel}>Report type</Text>
      <View style={styles.reportChipList}>
        {definitions.map((def) => (
          <TouchableOpacity
            key={def.key}
            style={[styles.reportChip, selectedReport === def.key && styles.reportChipActive]}
            onPress={() => onSelectReport(def.key)}
          >
            <Text style={[styles.reportChipText, selectedReport === def.key && styles.reportChipTextActive]}>{def.title}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.reportDescription}>
        {definitions.find((def) => def.key === selectedReport)?.description || 'Select a report to continue.'}
      </Text>
      <Text style={styles.reportLabel}>Format</Text>
      <View style={styles.reportChipList}>
        {formats.map((fmt) => (
          <TouchableOpacity
            key={fmt}
            style={[styles.reportChip, selectedFormat === fmt && styles.reportChipActive]}
            onPress={() => onSelectFormat(fmt)}
          >
            <Text style={[styles.reportChipText, selectedFormat === fmt && styles.reportChipTextActive]}>{fmt.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.reportDates}>
        <View style={{ flex: 1 }}>
          <Text style={styles.reportLabel}>From date</Text>
          <TextInput
            style={[styles.input, styles.onboardInput]}
            placeholder="YYYY-MM-DD"
            value={fromDate}
            onChangeText={onFromDate}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.reportLabel}>To date</Text>
          <TextInput
            style={[styles.input, styles.onboardInput]}
            placeholder="YYYY-MM-DD"
            value={toDate}
            onChangeText={onToDate}
          />
        </View>
      </View>
      {message && <Text style={styles.onboardMessage}>{message}</Text>}
      <TouchableOpacity
        style={[styles.primaryButton, styles.onboardActionButton]}
        onPress={onExport}
        disabled={status === 'loading' || !selectedReport}
      >
        <Text style={styles.primaryButtonText}>{status === 'loading' ? 'Preparing...' : 'Export report'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 18,
  },
  workspaceSwitch: {
    marginTop: 12,
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0f172a',
    paddingVertical: 12,
    backgroundColor: '#0f172a',
  },
  workspaceSwitchText: {
    color: '#fff',
    fontWeight: '700',
  },
  loginCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    shadowColor: 'rgba(15, 23, 42, 0.15)',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 6,
  },
  workspaceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  workspaceTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
  },
  workspaceHeroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 18,
    shadowColor: 'rgba(15, 23, 42, 0.08)',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 4,
  },
  workspaceHeroTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  workspaceHeroRole: {
    fontSize: 12,
    textTransform: 'uppercase',
    color: '#0f172a',
    marginTop: 2,
  },
  workspaceHeroMeta: {
    fontSize: 13,
    color: '#475569',
    marginTop: 4,
  },
  sectionHeading: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    color: '#0f172a',
  },
  input: {
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'android' ? 10 : 12,
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  orderInput: {
    borderColor: '#f4d8a8',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'android' ? 10 : 12,
    fontSize: 15,
    color: '#0f172a',
    backgroundColor: '#fff',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
  },
  secondaryButton: {
    borderColor: '#0f172a',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '600',
  },
  linkButton: {
    marginTop: 12,
    alignItems: 'center',
  },
  linkButtonText: {
    color: '#0f172a',
    fontWeight: '600',
  },
  successText: {
    marginTop: 8,
    color: '#15803d',
    fontWeight: '600',
  },
  errorText: {
    marginTop: 8,
    color: '#dc2626',
    fontWeight: '600',
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  userRole: {
    fontSize: 14,
    color: '#0f172a',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  userEmail: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 18,
  },
  loginHelper: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 12,
  },
  roleChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  roleChip: {
    borderColor: '#0f172a',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  roleChipText: {
    color: '#0f172a',
    fontWeight: '600',
    fontSize: 12,
  },
  workspaceNav: {
    paddingVertical: 12,
    paddingLeft: 4,
    paddingRight: 12,
  },
  workspaceNavButton: {
    width: 220,
    marginRight: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
    padding: 14,
  },
  workspaceNavButtonActive: {
    borderColor: '#0f172a',
    backgroundColor: '#0f172a',
  },
  workspaceNavText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  workspaceNavTextActive: {
    color: '#fff',
  },
  workspaceNavHint: {
    marginTop: 4,
    fontSize: 12,
    color: '#475569',
  },
  workspacePanel: {
    marginTop: 16,
    marginBottom: 8,
  },
  placeholderCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#f4d8a8',
    padding: 18,
    backgroundColor: '#ffffff',
  },
  placeholderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  placeholderCopy: {
    marginTop: 6,
    fontSize: 13,
    color: '#64748b',
  },
  placeholderButton: {
    marginTop: 12,
    alignSelf: 'flex-start',
    backgroundColor: '#0f172a',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  placeholderButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  heroImage: {
    borderRadius: 24,
    overflow: 'hidden',
    minHeight: 340,
  },
  heroDark: {
    backgroundColor: 'rgba(15, 23, 42, 0.68)',
    padding: 24,
    gap: 18,
    borderRadius: 24,
    minHeight: 340,
    justifyContent: 'flex-end',
  },
  heroCopy: {
    gap: 6,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: '900',
    color: '#ffffff',
    lineHeight: 42,
  },
  heroSubtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.75)',
  },
  heroStatRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  heroStat: {
    flexGrow: 1,
    minWidth: 90,
    backgroundColor: 'rgba(255,255,255,0.12)',
    padding: 10,
    borderRadius: 12,
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
  },
  heroStatLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  heroStatValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  ctaButton: {
    backgroundColor: '#0f172a',
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  orderCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 20,
    gap: 12,
    shadowColor: 'rgba(15, 23, 42, 0.05)',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 4,
  },
  orderHeading: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  orderSubheading: {
    fontSize: 14,
    color: '#475569',
  },
  quoteCard: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 16,
  },
  quoteLabel: {
    color: '#fcd34d',
    fontSize: 12,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  quoteValue: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
  },
  quoteHint: {
    color: '#e2e8f0',
    fontSize: 13,
    marginTop: 4,
  },
  quoteError: {
    color: '#0f172a',
    marginTop: 4,
    fontWeight: '600',
  },
  orderFormGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  orderField: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  orderLabel: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 6,
  },
  orderChips: {
    flexDirection: 'row',
    gap: 8,
  },
  orderChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  orderChipActive: {
    backgroundColor: '#0f172a',
  },
  orderChipText: {
    color: '#0f172a',
    fontWeight: '600',
    fontSize: 13,
  },
  orderChipTextActive: {
    color: '#fff',
  },
  truckStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: '#f4d8a8',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    gap: 12,
  },
  truckButton: {
    backgroundColor: '#0f172a',
    borderRadius: 999,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  truckButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 20,
  },
  truckCount: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  orderToggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  orderButton: {
    marginTop: 12,
  },
  summaryCard: {
    marginTop: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#f4d8a8',
    padding: 16,
    backgroundColor: '#fffdf5',
  },
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  summaryReset: {
    color: '#0f172a',
    fontWeight: '600',
  },
  summaryStatus: {
    marginTop: 6,
    color: '#0f172a',
    fontWeight: '600',
  },
  summaryRows: {
    marginTop: 10,
    gap: 4,
  },
  summaryRow: {
    fontSize: 13,
    color: '#475569',
  },
  summaryHint: {
    fontSize: 12,
    textTransform: 'uppercase',
    marginTop: 12,
    color: '#64748b',
  },
  bankRow: {
    marginTop: 6,
  },
  bankName: {
    fontWeight: '700',
    color: '#0f172a',
  },
  bankDetails: {
    fontSize: 13,
    color: '#475569',
  },
  summaryNote: {
    marginTop: 10,
    fontSize: 12,
    color: '#475569',
  },
  workspacesCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    shadowColor: 'rgba(15, 23, 42, 0.08)',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14,
    elevation: 4,
    gap: 12,
  },
  workspacesHeading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  workspacesSubheading: {
    fontSize: 14,
    color: '#475569',
  },
  workspacesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  workspaceTile: {
    flexBasis: '48%',
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    backgroundColor: '#fff',
  },
  workspaceTileActive: {
    borderColor: '#0f172a',
    backgroundColor: '#ffffff',
  },
  workspaceTitle: {
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  workspaceCopy: {
    fontSize: 12,
    color: '#475569',
  },
  workspaceStatus: {
    marginTop: 8,
    fontSize: 11,
    color: '#94a3b8',
  },
  workspaceStatusActive: {
    color: '#0f172a',
    fontWeight: '700',
  },
  ordersCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    gap: 10,
    shadowColor: 'rgba(15, 23, 42, 0.08)',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 4,
  },
  ordersHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ordersHint: {
    fontSize: 13,
    color: '#475569',
  },
  orderItem: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f4d8a8',
    padding: 14,
    marginTop: 8,
  },
  orderItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderItemTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  orderBadge: {
    backgroundColor: '#0f172a',
    color: '#fff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 12,
    fontWeight: '700',
  },
  orderItemMeta: {
    fontSize: 12,
    color: '#475569',
    marginTop: 4,
  },
  driverCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    gap: 12,
    shadowColor: 'rgba(15, 23, 42, 0.08)',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 4,
  },
  driverStats: {
    flexDirection: 'row',
    gap: 12,
  },
  driverStat: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 12,
  },
  driverStatLabel: {
    fontSize: 12,
    color: '#475569',
    textTransform: 'uppercase',
  },
  driverStatValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 4,
  },
  assignmentRow: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginTop: 8,
  },
  assignmentTitle: {
    fontWeight: '600',
    color: '#0f172a',
  },
  assignmentMeta: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  fuelCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    gap: 12,
    shadowColor: 'rgba(15, 23, 42, 0.08)',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 4,
  },
  fuelFormRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  fuelNote: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  fuelActions: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  fuelHistoryTitle: {
    fontWeight: '700',
    color: '#0f172a',
  },
  fuelLogRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
    marginTop: 8,
  },
  fuelLogTitle: {
    fontWeight: '600',
    color: '#0f172a',
  },
  fuelLogMeta: {
    fontSize: 12,
    color: '#475569',
  },
  articlesCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    gap: 12,
    shadowColor: 'rgba(15, 23, 42, 0.05)',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 4,
  },
  articleCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
  },
  articleTitle: {
    fontWeight: '700',
    color: '#0f172a',
    fontSize: 15,
  },
  articleSummary: {
    fontSize: 13,
    color: '#475569',
    marginTop: 4,
  },
  articleMeta: {
    marginTop: 6,
    fontSize: 12,
    color: '#94a3b8',
  },
  metaCard: {
    backgroundColor: '#0f172a',
    borderRadius: 20,
    padding: 20,
    gap: 4,
  },
  metaLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#94a3b8',
  },
  metaValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  metaHint: {
    fontSize: 13,
    color: '#94a3b8',
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  stateText: {
    color: '#475569',
  },
  errorRow: {
    backgroundColor: '#fee2e2',
    padding: 12,
    borderRadius: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
  },
  cardSpacing: {
    marginTop: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  cardSummary: {
    marginTop: 4,
    fontSize: 13,
    color: '#475569',
  },
  cardMeta: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 6,
  },
  emptyCopy: {
    marginTop: 12,
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
  },
  onboardCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 20,
  },
  onboardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  onboardReload: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#0b6efd',
  },
  onboardReloadText: {
    color: '#fff',
    fontWeight: '600',
  },
  onboardHint: {
    fontSize: 13,
    color: '#475569',
    marginBottom: 10,
  },
  onboardStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  onboardStatusText: {
    fontSize: 13,
    color: '#475569',
  },
  onboardSection: {
    marginTop: 16,
  },
  onboardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 8,
  },
  onboardField: {
    marginBottom: 10,
  },
  onboardLabel: {
    fontSize: 12,
    color: '#475569',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  onboardInput: {
    backgroundColor: '#fff',
  },
  onboardTextarea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  onboardDocumentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 10,
  },
  onboardDocumentInfo: {
    flex: 1,
  },
  onboardDocRemark: {
    marginTop: 6,
  },
  onboardToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  declarationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cbd5f5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#0b6efd',
    borderColor: '#0b6efd',
  },
  checkboxTick: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  declarationText: {
    fontSize: 13,
    color: '#475569',
  },
  onboardMessage: {
    color: '#0f172a',
    fontSize: 13,
    marginBottom: 10,
  },
  onboardActions: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 10,
  },
  onboardActionButton: {
    flex: 1,
  },
  onboardSubmitButton: {
    backgroundColor: '#059669',
  },
  reportCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 20,
  },
  reportChipList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 8,
  },
  reportChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5f5',
  },
  reportChipActive: {
    backgroundColor: '#1d4ed8',
    borderColor: '#1d4ed8',
  },
  reportChipText: {
    fontSize: 12,
    color: '#1d4ed8',
    fontWeight: '600',
  },
  reportChipTextActive: {
    color: '#fff',
  },
  reportLabel: {
    fontSize: 12,
    color: '#475569',
    marginTop: 10,
    textTransform: 'uppercase',
  },
  reportDescription: {
    fontSize: 13,
    color: '#475569',
    marginBottom: 8,
  },
  reportDates: {
    flexDirection: 'row',
    gap: 12,
    marginVertical: 12,
  },
});
