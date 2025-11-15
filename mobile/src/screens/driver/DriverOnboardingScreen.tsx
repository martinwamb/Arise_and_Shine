import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import type { DriverOnboardingForm } from '../../../../shared/driver-onboarding';
import { createEmptyDriverOnboardingForm, renderDriverOnboardingHtml } from '../../../../shared/driver-onboarding';

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

export default function DriverOnboardingScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [form, setForm] = useState<DriverOnboardingForm | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  const loadForm = useCallback(async () => {
    try {
      setStatus('loading');
      setMessage(null);
      const res = await api.get('/api/profile/employment-form');
      if (res.data?.form) {
        setForm(res.data.form as DriverOnboardingForm);
      } else if (res.data) {
        setForm(res.data as DriverOnboardingForm);
      } else {
        setForm(createEmptyDriverOnboardingForm());
      }
      setStatus('idle');
    } catch (err: any) {
      setStatus('idle');
      setMessage(err?.response?.data?.error || 'Unable to load onboarding form.');
      setForm(null);
    }
  }, [api]);

  useEffect(() => {
    loadForm();
  }, [loadForm]);

  const filteredDocuments = useMemo(() => {
    const isMarried = (form?.personalDetails?.maritalStatus || '').toLowerCase() === 'married';
    return (form?.documentsChecklist || []).filter((doc) => !doc?.requiresSpouse || isMarried);
  }, [form]);

  const updateField = useCallback((path: string, value: string) => {
    setForm((prev) => {
      if (!prev) return prev;
      const next = cloneDriverForm(prev);
      const segments = path.split('.');
      let cursor: any = next;
      for (let i = 0; i < segments.length - 1; i += 1) {
        const key = segments[i];
        const isIndex = /^[0-9]+$/.test(key);
        const target = isIndex ? Number(key) : key;
        const current = cursor[target];
        cursor[target] = Array.isArray(current) ? [...current] : { ...(current || {}) };
        cursor = cursor[target];
      }
      const last = segments[segments.length - 1];
      const isIndex = /^[0-9]+$/.test(last);
      const target = isIndex ? Number(last) : last;
      cursor[target] = value;
      return next;
    });
  }, []);

  const updateDocument = useCallback((index: number, key: 'provided' | 'remarks', value: boolean | string) => {
    setForm((prev) => {
      if (!prev) return prev;
      const next = cloneDriverForm(prev);
      const docs = Array.isArray(next.documentsChecklist) ? [...next.documentsChecklist] : [];
      if (!docs[index]) return prev;
      docs[index] = key === 'provided' ? { ...docs[index], provided: Boolean(value) } : { ...docs[index], remarks: String(value) };
      next.documentsChecklist = docs;
      return next;
    });
  }, []);

  const save = useCallback(
    async (target: 'draft' | 'submitted') => {
      if (!form) return;
      if (target === 'submitted') {
        if (!form.personalDetails?.surname || !form.personalDetails?.otherNames) {
          setMessage('Provide your surname and other names before submitting.');
          return;
        }
        if (!form.personalDetails?.idNumber) {
          setMessage('National ID / Passport number is required before submission.');
          return;
        }
      }
      setStatus('saving');
      setMessage(null);
      try {
        const res = await api.put('/api/profile/employment-form', { form: { ...form, status: target } });
        setForm((res.data?.form as DriverOnboardingForm) || form);
        setMessage(target === 'submitted' ? 'Form submitted successfully.' : 'Draft saved.');
      } catch (err: any) {
        setMessage(err?.response?.data?.error || 'Failed to save the onboarding form.');
      } finally {
        setStatus('idle');
      }
    },
    [api, form],
  );

  const printForm = useCallback(() => {
    if (!form) {
      Alert.alert('Form not ready', 'Load the onboarding form before printing.');
      return;
    }
    try {
      const html = renderDriverOnboardingHtml(form, {
        brand: 'Arise & Shine Transporters',
        driverLabel: `${form.personalDetails?.surname || ''} ${form.personalDetails?.otherNames || ''}`.trim(),
      });
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      Linking.openURL(dataUrl).catch(() => {
        Alert.alert('Unable to open form', 'Try again on the web portal to print this document.');
      });
    } catch {
      Alert.alert('Unable to prepare form', 'Please try again after saving the latest changes.');
    }
  }, [form]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Driver onboarding</Text>
      <Text style={styles.subtitle}>Complete HR paperwork from your phone and track submission status.</Text>

      {status === 'loading' && (
        <View style={styles.statusRow}>
          <ActivityIndicator />
          <Text style={styles.statusText}>Loading form…</Text>
        </View>
      )}

      {message && <Text style={styles.helper}>{message}</Text>}

      {!form && status !== 'loading' && (
        <TouchableOpacity style={styles.primaryButton} onPress={loadForm}>
          <Text style={styles.primaryButtonText}>Reload form</Text>
        </TouchableOpacity>
      )}

      {form && (
        <>
          {mobileDriverFieldGroups.map((group) => (
            <View key={group.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{group.title}</Text>
              {group.fields.map((field) => (
                <View key={field.path} style={styles.field}>
                  <Text style={styles.label}>{field.label}</Text>
                  <TextInput
                    style={[styles.input, field.multiline && styles.textarea]}
                    value={getNestedValue(form, field.path)}
                    multiline={field.multiline}
                    onChangeText={(text) => updateField(field.path, text)}
                  />
                </View>
              ))}
            </View>
          ))}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Documents checklist</Text>
            {filteredDocuments.slice(0, 6).map((doc, index) => {
              const docIndex = (form.documentsChecklist || []).indexOf(doc);
              return (
                <View key={doc.code || index} style={styles.documentRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.label}>{doc.label}</Text>
                    <TextInput
                      style={[styles.input, styles.textarea]}
                      placeholder="Remarks"
                      placeholderTextColor="#94a3b8"
                      value={doc.remarks || ''}
                      onChangeText={(text) => updateDocument(docIndex, 'remarks', text)}
                    />
                  </View>
                  <Switch value={Boolean(doc.provided)} onValueChange={(value) => updateDocument(docIndex, 'provided', value)} />
                </View>
              );
            })}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.primaryButton, styles.actionButton]} onPress={() => save('draft')} disabled={status === 'saving'}>
              <Text style={styles.primaryButtonText}>{status === 'saving' ? 'Saving…' : 'Save draft'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryButton, styles.actionButton, styles.submitButton]}
              onPress={() => save('submitted')}
              disabled={status === 'saving'}
            >
              <Text style={styles.primaryButtonText}>Submit form</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.secondaryButton} onPress={printForm}>
            <Text style={styles.secondaryButtonText}>Open printable version</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

function cloneDriverForm(form: DriverOnboardingForm): DriverOnboardingForm {
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fef9f2',
  },
  content: {
    padding: 20,
    gap: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 13,
    color: '#475569',
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
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 12,
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
    backgroundColor: '#fff',
    color: '#0f172a',
    fontSize: 14,
  },
  textarea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
  },
  primaryButton: {
    borderRadius: 999,
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    alignItems: 'center',
  },
  submitButton: {
    backgroundColor: '#16a34a',
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
  helper: {
    fontSize: 12,
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
});
