import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Printer, RotateCcw, Save, Send, Plus } from 'lucide-react';
import { api } from '../api';
import type { DriverOnboardingForm } from '@shared/driver-onboarding';
import { createEmptyDriverOnboardingForm, renderDriverOnboardingHtml } from '@shared/driver-onboarding';

type Props = {
  driverId?: string | null;
  role: string;
  driverName?: string | null;
};

type RemoteDriverForm = {
  driverId: string;
  status: 'draft' | 'submitted';
  updatedAt?: string | null;
  submittedAt?: string | null;
  form: DriverOnboardingForm;
};

type FieldConfig = {
  path: string;
  label: string;
  type?: 'text' | 'date' | 'textarea';
};

type ToggleConfig = { path: string; label: string };

type ArraySectionConfig = {
  title: string;
  path: string;
  columns: { key: string; label: string }[];
  template: Record<string, string>;
  addLabel: string;
};

const jobFields: FieldConfig[] = [
  { path: 'jobDetails.positionAppliedFor', label: 'Position applied for' },
  { path: 'jobDetails.preferredLocation', label: 'Preferred location' },
  { path: 'jobDetails.payrollNumber', label: 'Payroll number' },
  { path: 'jobDetails.vehicleNumber', label: 'Vehicle number' },
  { path: 'jobDetails.jobTitle', label: 'Job title' },
  { path: 'jobDetails.employedSince', label: 'Employed since' },
];

const introFields: FieldConfig[] = [
  { path: 'introduction.introducerName', label: 'Introducer name' },
  { path: 'introduction.introducerPayrollNumber', label: 'Introducer payroll no.' },
  { path: 'introduction.introducerVehicleNumber', label: 'Introducer vehicle no.' },
  { path: 'introduction.introducerJobTitle', label: 'Introducer job title' },
  { path: 'introduction.introducerEmployedSince', label: 'Introducer employed since' },
  { path: 'introduction.applicantName', label: 'Applicant name' },
  { path: 'introduction.applicantIdNumber', label: 'Applicant ID number' },
  { path: 'introduction.relationship', label: 'Relationship with applicant' },
  { path: 'introduction.knownDuration', label: 'How long have you known them?' },
  { path: 'introduction.currentEmployer', label: 'Current employer' },
  { path: 'introduction.reasons', label: 'Reasons for introduction', type: 'textarea' },
  { path: 'introduction.reasonsForLeaving', label: 'Reasons for leaving previous employer', type: 'textarea' },
  { path: 'introduction.criminalOffences', label: 'Criminal offences known', type: 'textarea' },
];

const personalFields: FieldConfig[] = [
  { path: 'personalDetails.surname', label: 'Surname' },
  { path: 'personalDetails.otherNames', label: 'Other names' },
  { path: 'personalDetails.dateOfBirth', label: 'Date of birth', type: 'date' },
  { path: 'personalDetails.ageYears', label: 'Age (years)' },
  { path: 'personalDetails.nationality', label: 'Nationality' },
  { path: 'personalDetails.idNumber', label: 'ID / Passport no.' },
  { path: 'personalDetails.pinNumber', label: 'PIN number' },
  { path: 'personalDetails.nssfNumber', label: 'NSSF number' },
  { path: 'personalDetails.nhifNumber', label: 'NHIF number' },
  { path: 'personalDetails.homeDistrict', label: 'Home district' },
  { path: 'personalDetails.mobileNumber', label: 'Mobile number' },
  { path: 'personalDetails.emailAddress', label: 'Email address' },
  { path: 'personalDetails.religion', label: 'Religion' },
];

const spouseFields: FieldConfig[] = [
  { path: 'spouse.name', label: 'Spouse name' },
  { path: 'spouse.dateOfBirth', label: 'Spouse date of birth', type: 'date' },
  { path: 'spouse.ageYears', label: 'Spouse age (years)' },
  { path: 'spouse.idNumber', label: 'Spouse ID / Passport' },
  { path: 'spouse.mobileNumber', label: 'Spouse mobile number' },
];

const contactFields: FieldConfig[] = [
  { path: 'residentialAddress.postalAddress', label: 'Present postal address' },
  { path: 'residentialAddress.postalCode', label: 'Postal code' },
  { path: 'residentialAddress.estate', label: 'Estate' },
  { path: 'residentialAddress.roadOrStreet', label: 'Road / Street' },
  { path: 'residentialAddress.houseNumber', label: 'House / Flat no.' },
  { path: 'residentialAddress.plotNumber', label: 'Plot no.' },
  { path: 'residentialAddress.telephone', label: 'House telephone' },
  { path: 'homeAddress.district', label: 'Home district / county' },
  { path: 'homeAddress.division', label: 'Division' },
  { path: 'homeAddress.location', label: 'Location' },
  { path: 'homeAddress.subLocation', label: 'Sub-location' },
  { path: 'homeAddress.postalAddress', label: 'Home postal address' },
  { path: 'homeAddress.postalCode', label: 'Home postal code' },
  { path: 'homeAddress.areaChiefName', label: 'Area chief name' },
  { path: 'homeAddress.areaChiefTel', label: 'Area chief phone' },
  { path: 'homeAddress.areaChiefPostalAddress', label: 'Area chief postal address' },
];

const healthFields: FieldConfig[] = [
  { path: 'healthDisclosure.terminalConditionDetails', label: 'Terminal / chronic condition details', type: 'textarea' },
  { path: 'healthDisclosure.disabilityDetails', label: 'Disability / allergy details', type: 'textarea' },
];

const declarationToggles: ToggleConfig[] = [
  { path: 'declarations.statementA', label: 'Declaration A' },
  { path: 'declarations.statementB', label: 'Declaration B' },
  { path: 'declarations.statementC', label: 'Declaration C' },
  { path: 'declarations.statementD', label: 'Declaration D' },
];

const arraySections: ArraySectionConfig[] = [
  {
    title: 'Children',
    path: 'children',
    template: { name: '', yearOfBirth: '', ageYears: '', gender: '' },
    columns: [
      { key: 'name', label: 'Child name' },
      { key: 'yearOfBirth', label: 'Year of birth' },
      { key: 'ageYears', label: 'Age' },
      { key: 'gender', label: 'Gender' },
    ],
    addLabel: 'Add child',
  },
  {
    title: 'Next of kin',
    path: 'nextOfKin',
    template: { label: 'Contact', name: '', address: '', relationship: '', phone: '' },
    columns: [
      { key: 'label', label: 'Label' },
      { key: 'name', label: 'Full names' },
      { key: 'address', label: 'Postal address & code' },
      { key: 'relationship', label: 'Relationship' },
      { key: 'phone', label: 'Phone' },
    ],
    addLabel: 'Add contact',
  },
  {
    title: 'Academic & professional qualifications',
    path: 'academicHistory',
    template: { period: '', institution: '', course: '', certificate: '' },
    columns: [
      { key: 'period', label: 'Period' },
      { key: 'institution', label: 'School / College' },
      { key: 'course', label: 'Course studied' },
      { key: 'certificate', label: 'Certificates awarded' },
    ],
    addLabel: 'Add academic record',
  },
  {
    title: 'Employment history',
    path: 'employmentHistory',
    template: { employer: '', periodFrom: '', periodTo: '', jobTitle: '', reasonForLeaving: '', contactPerson: '', contactDetails: '' },
    columns: [
      { key: 'employer', label: 'Employer' },
      { key: 'periodFrom', label: 'From' },
      { key: 'periodTo', label: 'To' },
      { key: 'jobTitle', label: 'Job title' },
      { key: 'reasonForLeaving', label: 'Reason for leaving' },
      { key: 'contactPerson', label: 'Contact person' },
      { key: 'contactDetails', label: 'Telephone / Email' },
    ],
    addLabel: 'Add employment',
  },
  {
    title: 'Criminal / civil cases',
    path: 'criminalHistory.entries',
    template: { date: '', nature: '', penalty: '' },
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'nature', label: 'Nature' },
      { key: 'penalty', label: 'Penalty' },
    ],
    addLabel: 'Add case',
  },
  {
    title: 'Employment dismissals',
    path: 'misconductHistory.entries',
    template: { date: '', reason: '' },
    columns: [
      { key: 'date', label: 'Date' },
      { key: 'reason', label: 'Reason / details' },
    ],
    addLabel: 'Add dismissal record',
  },
  {
    title: 'Personal referees',
    path: 'referees',
    template: { label: 'Referee', name: '', relationship: '', phone: '', email: '', knownDuration: '', notes: '' },
    columns: [
      { key: 'label', label: 'Label' },
      { key: 'name', label: 'Name' },
      { key: 'relationship', label: 'Relationship' },
      { key: 'phone', label: 'Phone' },
      { key: 'email', label: 'Email' },
      { key: 'knownDuration', label: 'Known duration' },
      { key: 'notes', label: 'Notes' },
    ],
    addLabel: 'Add referee',
  },
];

const MARITAL_OPTIONS = ['Single', 'Married', 'Divorced', 'Separated', 'Widowed'];

function getValue(form: DriverOnboardingForm, path: string) {
  return path.split('.').reduce<any>((value, segment) => (value ? value[segment] : undefined), form);
}

function cloneDeep<T>(value: T): T {
  const structured = (globalThis as any).structuredClone;
  if (typeof structured === 'function') {
    return structured(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function setValue(form: DriverOnboardingForm, path: string, nextValue: any) {
  const segments = path.split('.');
  const clone: any = cloneDeep(form);
  let cursor = clone;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i];
    cursor[key] = Array.isArray(cursor[key]) ? [...cursor[key]] : { ...(cursor[key] || {}) };
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = nextValue;
  return clone as DriverOnboardingForm;
}

function ensureArray(form: DriverOnboardingForm, path: string) {
  const value = getValue(form, path);
  return Array.isArray(value) ? value : [];
}

export default function DriverOnboardingFormPanel({ driverId, role, driverName }: Props) {
  const [form, setForm] = useState<DriverOnboardingForm>(() => createEmptyDriverOnboardingForm());
  const [status, setStatus] = useState<'draft' | 'submitted'>('draft');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isDriver = role === 'DRIVER';
  const endpoint = isDriver ? '/api/driver/onboarding-form' : driverId ? `/api/admin/driver-forms/${driverId}` : '';
  const canEdit = Boolean(driverId || isDriver) && (status !== 'submitted' || role === 'ADMIN' || role === 'OPS');

  useEffect(() => {
    if (!endpoint) return;
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get(endpoint);
        if (!active) return;
        const payload = res.data as RemoteDriverForm;
        if (payload?.form) {
          setForm(payload.form);
          setStatus(payload.status || payload.form.status || 'draft');
          setUpdatedAt(payload.updatedAt || payload.form.updatedAt || null);
          setSubmittedAt(payload.submittedAt || payload.form.submittedAt || null);
        } else {
          const blank = createEmptyDriverOnboardingForm({ driverId: driverId || '' });
          setForm(blank);
          setStatus(blank.status || 'draft');
          setUpdatedAt(blank.updatedAt || null);
          setSubmittedAt(blank.submittedAt || null);
        }
      } catch (err: any) {
        if (!active) return;
        setError(err?.response?.data?.error || 'Unable to load onboarding form.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [endpoint, driverId]);

  const updateField = useCallback(
    (path: string, value: any) => {
      setForm((prev) => setValue(prev, path, value));
    },
    [],
  );

  const handleArrayChange = useCallback((path: string, index: number, key: string, value: string) => {
    setForm((prev) => {
      const list = ensureArray(prev, path).map((item) => ({ ...item }));
      list[index] = { ...(list[index] || {}), [key]: value };
      return setValue(prev, path, list);
    });
  }, []);

  const appendArrayItem = useCallback((path: string, template: Record<string, string>) => {
    setForm((prev) => {
      const list = ensureArray(prev, path).map((item) => ({ ...item }));
      list.push({ ...template });
      return setValue(prev, path, list);
    });
  }, []);

  const documents = form.documentsChecklist || [];

  const validateBeforeSubmit = useCallback(() => {
    if (!form.personalDetails.surname || !form.personalDetails.otherNames) {
      return 'Provide your surname and other names as they appear on official documents.';
    }
    if (!form.personalDetails.idNumber) {
      return 'ID / Passport number is required.';
    }
    if (!form.jobDetails.positionAppliedFor) {
      return 'Specify the position you are applying for.';
    }
    if (!form.residentialAddress.postalAddress) {
      return 'Enter your present postal address.';
    }
    return null;
  }, [form]);

  const handleSave = useCallback(
    async (nextStatus: 'draft' | 'submitted') => {
      if (!endpoint) return;
      if (nextStatus === 'submitted') {
        const issue = validateBeforeSubmit();
        if (issue) {
          setError(issue);
          return;
        }
      }
      setSaving(true);
      setError(null);
      setNotice(null);
      try {
        const payload: DriverOnboardingForm = { ...form, status: nextStatus };
        const res = await api.put(endpoint, payload);
        const updated = (res.data?.form as DriverOnboardingForm) || payload;
        setForm(updated);
        setStatus(res.data?.status || updated.status || nextStatus);
        setUpdatedAt(res.data?.updatedAt || updated.updatedAt || new Date().toISOString());
        setSubmittedAt(res.data?.submittedAt || (nextStatus === 'submitted' ? new Date().toISOString() : null));
        setNotice(nextStatus === 'submitted' ? 'Form submitted successfully.' : 'Draft saved.');
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Unable to save onboarding form.');
      } finally {
        setSaving(false);
      }
    },
    [endpoint, form, validateBeforeSubmit],
  );

  const handlePrint = useCallback(() => {
    const html = renderDriverOnboardingHtml(form, {
      brand: 'Arise & Shine Transporters',
      driverLabel: driverName || `${form.personalDetails.surname} ${form.personalDetails.otherNames}`.trim(),
    });
    try {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank', 'noopener=yes');
      if (!win) {
        setError('Pop-up blocked. Downloading the printable form instead.');
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `driver-onboarding-${form.driverId || 'form'}.html`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
      win.focus();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err: any) {
      console.error('Failed to open onboarding printout', err);
      setError('Unable to render the printable form. Please try saving first.');
    }
  }, [form, driverName]);

  const metadata = useMemo(() => ({
    updated: updatedAt ? new Date(updatedAt).toLocaleString() : 'Not captured yet',
    submitted: submittedAt ? new Date(submittedAt).toLocaleString() : null,
  }), [updatedAt, submittedAt]);

  if (!driverId && !isDriver) {
    return (
      <div className='rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-6 text-sm text-slate-600'>
        Select a driver to load the onboarding form.
      </div>
    );
  }

  return (
    <section className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
      <header className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Driver onboarding form</p>
          <h2 className='text-lg font-semibold text-slate-900'>
            {driverName || form.personalDetails.surname || 'Driver'}
            <span className='ml-2 text-sm font-normal text-slate-500'>({status === 'submitted' ? 'Submitted' : 'Draft'})</span>
          </h2>
          <p className='text-xs text-slate-500'>Last updated: {metadata.updated}</p>
          {metadata.submitted && <p className='text-xs text-emerald-600'>Submitted on: {metadata.submitted}</p>}
        </div>
        <div className='flex flex-wrap gap-2'>
          <button type='button' onClick={handlePrint} className='inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50'>
            <Printer className='h-4 w-4' />
            Print
          </button>
          {status === 'submitted' && (role === 'ADMIN' || role === 'OPS') && (
            <button
              type='button'
              onClick={() => handleSave('draft')}
              className='inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100'
              disabled={saving}
            >
              <RotateCcw className='h-4 w-4' /> Reopen for edits
            </button>
          )}
          <button
            type='button'
            onClick={() => handleSave('draft')}
            className='inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60'
            disabled={!canEdit || saving}
          >
            {saving ? <Loader2 className='h-4 w-4 animate-spin' /> : <Save className='h-4 w-4' />}
            Save draft
          </button>
          <button
            type='button'
            onClick={() => handleSave('submitted')}
            className='inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60'
            disabled={!canEdit || saving}
          >
            {saving ? <Loader2 className='h-4 w-4 animate-spin' /> : <Send className='h-4 w-4' />}
            Submit form
          </button>
        </div>
      </header>
      {error && <p className='mt-4 rounded-2xl bg-rose-50 px-4 py-2 text-sm text-rose-700'>{error}</p>}
      {notice && <p className='mt-4 rounded-2xl bg-emerald-50 px-4 py-2 text-sm text-emerald-700'>{notice}</p>}
      {loading && (
        <p className='mt-6 flex items-center gap-2 text-sm text-slate-600'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading onboarding data…
        </p>
      )}
      {!loading && (
        <div className='mt-6 space-y-6 text-sm text-slate-700'>
          <FieldSection title='Job details & introduction'>
            <FieldGrid fields={jobFields} form={form} onChange={updateField} disabled={!canEdit} />
            <FieldGrid fields={introFields} form={form} onChange={updateField} disabled={!canEdit} />
          </FieldSection>

          <FieldSection title='Personal details'>
            <FieldGrid fields={personalFields} form={form} onChange={updateField} disabled={!canEdit} columns={3} />
            <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Marital status
              <select
                className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none disabled:bg-slate-50'
                value={form.personalDetails.maritalStatus}
                onChange={(e) => updateField('personalDetails.maritalStatus', e.target.value)}
                disabled={!canEdit}
              >
                {MARITAL_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </FieldSection>

          <FieldSection title='Spouse details'>
            <FieldGrid fields={spouseFields} form={form} onChange={updateField} disabled={!canEdit} columns={2} />
          </FieldSection>

          <FieldSection title='Residence & contacts'>
            <FieldGrid fields={contactFields} form={form} onChange={updateField} disabled={!canEdit} columns={2} />
            <ToggleRow
              label='Related to an Arise & Shine employee?'
              checked={form.relatedEmployeeDisclosure.hasRelation}
              onChange={(val) => updateField('relatedEmployeeDisclosure.hasRelation', val)}
              disabled={!canEdit}
            />
            <FieldGrid
              fields={[
                { path: 'relatedEmployeeDisclosure.personName', label: 'Employee name' },
                { path: 'relatedEmployeeDisclosure.position', label: 'Position' },
                { path: 'relatedEmployeeDisclosure.relationship', label: 'Relationship' },
                { path: 'relatedEmployeeDisclosure.narrative', label: 'Details', type: 'textarea' },
              ]}
              form={form}
              onChange={updateField}
              disabled={!canEdit}
            />
          </FieldSection>

          <FieldSection title='Health declaration'>
            <ToggleRow
              label='Terminal medical condition?'
              checked={form.healthDisclosure.hasTerminalCondition}
              onChange={(val) => updateField('healthDisclosure.hasTerminalCondition', val)}
              disabled={!canEdit}
            />
            <ToggleRow
              label='Disabilities or allergies?'
              checked={form.healthDisclosure.hasDisabilities}
              onChange={(val) => updateField('healthDisclosure.hasDisabilities', val)}
              disabled={!canEdit}
            />
            <FieldGrid fields={healthFields} form={form} onChange={updateField} disabled={!canEdit} />
          </FieldSection>

          {arraySections.map((section) => (
            <ArraySection
              key={section.path}
              config={section}
              form={form}
              onChange={handleArrayChange}
              onAdd={() => appendArrayItem(section.path, section.template)}
              disabled={!canEdit}
            />
          ))}

          <FieldSection title='Declarations & documents'>
            <div className='grid gap-3 md:grid-cols-2'>
              {declarationToggles.map((toggle) => (
                <ToggleRow key={toggle.path} label={toggle.label} checked={Boolean(getValue(form, toggle.path))} onChange={(val) => updateField(toggle.path, val)} disabled={!canEdit} />
              ))}
            </div>
            <FieldGrid
              fields={[
                { path: 'declarations.applicantName', label: 'Applicant name' },
                { path: 'declarations.signature', label: 'Signature' },
                { path: 'declarations.signedAt', label: 'Date', type: 'date' },
              ]}
              form={form}
              onChange={updateField}
              disabled={!canEdit}
              columns={3}
            />
            <div className='overflow-x-auto'>
              <table className='w-full border-collapse text-xs'>
                <thead>
                  <tr className='bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500'>
                    <th className='border border-slate-200 px-2 py-1'>Document</th>
                    <th className='border border-slate-200 px-2 py-1 text-center'>Provided</th>
                    <th className='border border-slate-200 px-2 py-1'>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc, index) => (
                    <tr key={doc.code || index}>
                      <td className='border border-slate-200 px-2 py-1'>{doc.label}</td>
                      <td className='border border-slate-200 px-2 py-1 text-center'>
                        <input
                          type='checkbox'
                          className='h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500'
                          checked={Boolean(doc.provided)}
                          onChange={(e) => handleArrayChange('documentsChecklist', index, 'provided', e.target.checked ? 'true' : 'false')}
                          disabled={!canEdit}
                        />
                      </td>
                      <td className='border border-slate-200 px-2 py-1'>
                        <input
                          className='w-full border-none bg-transparent text-sm focus:outline-none'
                          value={doc.remarks || ''}
                          onChange={(e) => handleArrayChange('documentsChecklist', index, 'remarks', e.target.value)}
                          disabled={!canEdit}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <FieldGrid
              fields={[
                { path: 'verification.verifiedBy', label: 'Verifier name' },
                { path: 'verification.signature', label: 'Verifier signature' },
                { path: 'verification.verifiedAt', label: 'Verification date', type: 'date' },
                { path: 'verification.notes', label: 'Verification notes', type: 'textarea' },
              ]}
              form={form}
              onChange={updateField}
              disabled={!canEdit}
            />
          </FieldSection>
        </div>
      )}
    </section>
  );
}

function FieldSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className='rounded-2xl border border-slate-100 p-4'>
      <h3 className='mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600'>{title}</h3>
      <div className='space-y-3'>{children}</div>
    </section>
  );
}

function FieldGrid({
  fields,
  form,
  onChange,
  disabled,
  columns = 2,
}: {
  fields: FieldConfig[];
  form: DriverOnboardingForm;
  onChange: (path: string, value: string) => void;
  disabled?: boolean;
  columns?: number;
}) {
  const gridClass =
    columns === 1 ? 'grid gap-3' : columns === 3 ? 'grid gap-3 md:grid-cols-3' : 'grid gap-3 md:grid-cols-2';
  return (
    <div className={gridClass}>
      {fields.map((field) => (
        <label key={field.path} className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
          {field.label}
          {field.type === 'textarea' ? (
            <textarea
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none disabled:bg-slate-50'
              rows={3}
              value={getValue(form, field.path) || ''}
              onChange={(e) => onChange(field.path, e.target.value)}
              disabled={disabled}
            />
          ) : (
            <input
              type={field.type === 'date' ? 'date' : 'text'}
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none disabled:bg-slate-50'
              value={getValue(form, field.path) || ''}
              onChange={(e) => onChange(field.path, e.target.value)}
              disabled={disabled}
            />
          )}
        </label>
      ))}
    </div>
  );
}

function ToggleRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className='flex items-center gap-3 rounded-2xl border border-slate-200 px-3 py-2'>
      <input type='checkbox' className='h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500' checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className='text-xs font-semibold uppercase tracking-wide text-slate-600'>{label}</span>
    </label>
  );
}

function ArraySection({
  config,
  form,
  onChange,
  onAdd,
  disabled,
}: {
  config: ArraySectionConfig;
  form: DriverOnboardingForm;
  onChange: (path: string, index: number, key: string, value: string | boolean) => void;
  onAdd: () => void;
  disabled?: boolean;
}) {
  const items = ensureArray(form, config.path);
  return (
    <section className='rounded-2xl border border-slate-100 p-4'>
      <div className='mb-3 flex items-center justify-between'>
        <h3 className='text-sm font-semibold uppercase tracking-wide text-slate-600'>{config.title}</h3>
        <button type='button' onClick={onAdd} className='inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60' disabled={disabled}>
          <Plus className='h-3 w-3' /> {config.addLabel}
        </button>
      </div>
      <div className='overflow-x-auto'>
        <table className='w-full border-collapse text-xs'>
          <thead>
            <tr className='bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500'>
              {config.columns.map((col) => (
                <th key={col.key} className='border border-slate-200 px-2 py-1'>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item: any, index: number) => (
              <tr key={`${config.path}-${index}`}>
                {config.columns.map((col) => (
                  <td key={col.key} className='border border-slate-200 px-2 py-1'>
                    <input
                      className='w-full border-none bg-transparent text-sm focus:outline-none'
                      value={item[col.key] || ''}
                      onChange={(e) => onChange(config.path, index, col.key, e.target.value)}
                      disabled={disabled}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

