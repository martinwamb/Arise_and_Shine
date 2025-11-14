import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
import { createApiClient, normaliseBaseUrl } from '../shared/api-client';
import type { DriverOnboardingForm } from '../shared/driver-onboarding';
import { createEmptyDriverOnboardingForm, renderDriverOnboardingHtml } from '../shared/driver-onboarding';
import { createSecureTokenStorage, readStoredToken } from './src/storage/tokenStorage';

type Article = {
  id: string;
  title: string;
  summary?: string | null;
  topic?: string | null;
  createdAt?: string | null;
};

type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  driverId?: string | null;
};

type MobileReportDefinition = {
  key: string;
  title: string;
  description: string;
  filters?: {
    requiresDateRange?: boolean;
    allowDriverId?: boolean;
    allowTruckId?: boolean;
  };
};

const fallbackBase = __DEV__ ? 'http://localhost:4000' : 'https://www.ariseandshinetransporters.com';
const configApiBase = (Constants.expoConfig?.extra as { apiBase?: string } | undefined)?.apiBase;
const apiBase = normaliseBaseUrl(configApiBase, fallbackBase);
const secureTokenStorage = createSecureTokenStorage();
const sharedClient = createApiClient(apiBase, secureTokenStorage, axios.create);
const { api, API_BASE, setToken, requestPasswordReset } = sharedClient;

export default function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState({ email: '', password: '' });
  const [resetState, setResetState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [driverForm, setDriverForm] = useState<DriverOnboardingForm | null>(null);
  const [driverFormStatus, setDriverFormStatus] = useState<'idle' | 'loading' | 'saving'>('idle');
  const [driverFormMessage, setDriverFormMessage] = useState<string | null>(null);
  const [reportDefs, setReportDefs] = useState<MobileReportDefinition[]>([]);
  const [reportFormats, setReportFormats] = useState<string[]>(['excel', 'pdf']);
  const [selectedReport, setSelectedReport] = useState('');
  const [selectedReportFormat, setSelectedReportFormat] = useState<'excel' | 'pdf'>('excel');
  const [reportFromDate, setReportFromDate] = useState('');
  const [reportToDate, setReportToDate] = useState('');
  const [reportStatus, setReportStatus] = useState<'idle' | 'loading'>('idle');
  const [reportMessage, setReportMessage] = useState<string | null>(null);

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

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  useEffect(() => {
    (async () => {
      try {
        const storedToken = await readStoredToken();
        if (storedToken) {
          setToken(storedToken);
          const me = await api.get('/api/me');
          setUser(me.data?.user || null);
        }
      } catch {
        setToken(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

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
      const res = await api.post('/api/auth/login', { email, password });
      const nextUser = res.data?.user as AuthUser;
      if (res.data?.token) {
        setToken(res.data.token);
      }
      setUser(nextUser || null);
    } catch (err: any) {
      setAuthError(err?.response?.data?.error || 'Login failed. Check credentials and try again.');
      setUser(null);
      setToken(null);
    } finally {
      setAuthLoading(false);
    }
  }, [credentials]);

  const handleLogout = useCallback(() => {
    setUser(null);
    setCredentials({ email: '', password: '' });
    setToken(null);
    resetDriverFormState();
  }, [resetDriverFormState]);

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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadArticles({ silent: true });
    setRefreshing(false);
  }, [loadArticles]);

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

  useEffect(() => {
    if (user) {
      fetchDriverForm();
    } else {
      resetDriverFormState();
    }
  }, [fetchDriverForm, resetDriverFormState, user]);

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

  if (booting) {
    return (
      <SafeAreaView style={styles.bootContainer}>
        <ActivityIndicator size="large" color="#0b6efd" />
        <Text style={styles.bootText}>Preparing Arise Mobile…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        <Text style={styles.heading}>Arise &amp; Shine Mobile</Text>
        <Text style={styles.subheading}>
          This Expo app shares the same Express API as the website. Pull to refresh or tap reload to confirm connectivity.
        </Text>

        <KeyboardAvoidingView
          style={styles.loginCard}
          behavior={Platform.select({ ios: 'padding', android: undefined })}
        >
          {user ? (
            <View>
              <Text style={styles.sectionHeading}>Signed in</Text>
              <Text style={styles.userName}>{user.name || user.email}</Text>
              <Text style={styles.userRole}>{user.role}</Text>
              <Text style={styles.userEmail}>{user.email}</Text>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleLogout}>
                <Text style={styles.secondaryButtonText}>Sign out</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <Text style={styles.sectionHeading}>Sign in</Text>
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
          )}
        </KeyboardAvoidingView>

        {user && (
          <DriverFormSection
            form={driverForm}
            status={driverFormStatus}
            message={driverFormMessage}
            onChange={updateDriverFormField}
            onDocChange={updateDriverDocument}
            onSave={saveDriverForm}
            onPrint={printDriverForm}
            onReload={fetchDriverForm}
          />
        )}

        {(user?.role === 'ADMIN' || user?.role === 'OPS') && (
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
        )}

        <View style={styles.metaCard}>
          <Text style={styles.metaLabel}>API Base</Text>
          <Text style={styles.metaValue}>{API_BASE}</Text>
          {lastUpdated ? (
            <Text style={styles.metaHint}>Latest article: {lastUpdated}</Text>
          ) : (
            <Text style={styles.metaHint}>No articles yet. Use the admin dashboard to seed content.</Text>
          )}
        </View>

        <TouchableOpacity style={styles.reloadButton} onPress={() => loadArticles()}>
          <Text style={styles.reloadText}>Reload articles</Text>
        </TouchableOpacity>

        {status === 'loading' && (
          <View style={styles.stateRow}>
            <ActivityIndicator size="small" color="#0b6efd" />
            <Text style={styles.stateText}>Contacting server…</Text>
          </View>
        )}

        {status === 'error' && error && (
          <View style={[styles.stateRow, styles.errorRow]}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <View>
          {articles.map((article, index) => (
            <View key={article.id} style={[styles.card, index > 0 && styles.cardSpacing]}>
              <Text style={styles.cardTitle}>{article.title}</Text>
              {article.topic ? <Text style={styles.cardTag}>{article.topic}</Text> : null}
              <Text style={styles.cardSummary}>{article.summary || 'No summary available yet.'}</Text>
            </View>
          ))}
          {!articles.length && status !== 'loading' && (
            <Text style={styles.emptyCopy}>Once articles exist in the backend they will be listed here.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
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
  bootContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  bootText: {
    color: '#475569',
    fontSize: 15,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 6,
    color: '#0f172a',
  },
  subheading: {
    fontSize: 15,
    color: '#475569',
    marginBottom: 18,
  },
  loginCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
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
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'android' ? 10 : 12,
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#0b6efd',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
  linkButton: {
    marginTop: 12,
    alignItems: 'center',
  },
  linkButtonText: {
    color: '#0369a1',
    fontWeight: '600',
  },
  successText: {
    marginTop: 8,
    color: '#15803d',
    fontWeight: '600',
  },
  userName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#0f172a',
  },
  userRole: {
    fontSize: 14,
    color: '#3b82f6',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  userEmail: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 18,
  },
  secondaryButton: {
    borderColor: '#0b6efd',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#0b6efd',
    fontWeight: '600',
  },
  metaCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 16,
  },
  metaLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#94a3b8',
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
  },
  metaHint: {
    marginTop: 6,
    fontSize: 13,
    color: '#64748b',
  },
  reloadButton: {
    backgroundColor: '#0b6efd',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 20,
  },
  reloadText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  stateText: {
    marginLeft: 8,
    color: '#475569',
  },
  errorRow: {
    backgroundColor: '#fee2e2',
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    color: '#b91c1c',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 1,
  },
  cardSpacing: {
    marginTop: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  cardTag: {
    fontSize: 13,
    fontWeight: '500',
    color: '#0ea5e9',
    marginBottom: 6,
  },
  cardSummary: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
  },
  emptyCopy: {
    textAlign: 'center',
    color: '#94a3b8',
    marginTop: 12,
  },
  onboardCard: {
    backgroundColor: '#f9fafb',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  onboardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  onboardReload: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5f5',
  },
  onboardReloadText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563eb',
  },
  onboardHint: {
    fontSize: 13,
    color: '#475569',
    marginBottom: 12,
  },
  stepTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  stepTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  stepTabActive: {
    borderColor: '#f97316',
    backgroundColor: '#fff7ed',
  },
  stepTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  stepTabTextActive: {
    color: '#c2410c',
  },
  onboardStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  onboardStatusText: {
    fontSize: 13,
    color: '#475569',
  },
  onboardSection: {
    marginBottom: 14,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  onboardTitle: {
    fontSize: 14,
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
