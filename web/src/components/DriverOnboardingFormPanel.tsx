import React, { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw, Save, Send, Upload } from 'lucide-react';
import type { DriverOnboardingForm } from '@shared/driver-onboarding';
import { createEmptyDriverOnboardingForm, summarizeDriverOnboardingGaps } from '@shared/driver-onboarding';
import { api } from '../api';
import SignaturePad from './SignaturePad';

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
  owner?: { name: string } | null;
  form: DriverOnboardingForm;
  completionSummary?: ReturnType<typeof summarizeDriverOnboardingGaps>;
};

type EmployeeOption = { id: string; name: string; role: string; email: string; driverId?: string | null };

const STEP_FLOW = [
  { id: 'personal', label: 'Personal details' },
  { id: 'contact', label: 'Residence & contacts' },
  { id: 'health', label: 'Health & compliance' },
  { id: 'referees', label: 'Referees & kin' },
  { id: 'documents', label: 'Declarations & documents' },
] as const;

const MARITAL_OPTIONS = ['Single', 'Married', 'Divorced', 'Separated', 'Widowed'];

export default function DriverOnboardingFormPanel({ driverId, role, driverName }: Props) {
  const [form, setForm] = useState<DriverOnboardingForm>(() => createEmptyDriverOnboardingForm());
  const [status, setStatus] = useState<'draft' | 'submitted'>('draft');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isAdmin = role === 'ADMIN' || role === 'OPS';
  const isSelfService = !driverId;
  const listEndpoint = isSelfService ? '/api/profile/employment-form' : isAdmin ? `/api/admin/driver-forms/${driverId}` : '/api/driver/onboarding-form';
  const saveEndpoint = isSelfService ? '/api/profile/employment-form' : isAdmin ? `/api/admin/driver-forms/${driverId}` : '/api/driver/onboarding-form';
  const docUploadEnabled = isSelfService;

  const completion = useMemo(() => form.completionSummary || summarizeDriverOnboardingGaps(form), [form]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      setNotice(null);
      try {
        const res = await api.get(listEndpoint);
        if (!active) return;
        const payload = res.data as RemoteDriverForm;
        if (payload?.form) {
          setForm(payload.form);
          setStatus(payload.status || payload.form.status || 'draft');
          setUpdatedAt(payload.updatedAt || payload.form.updatedAt || null);
          setSubmittedAt(payload.submittedAt || payload.form.submittedAt || null);
        }
      } catch (err: any) {
        if (!active) return;
        setError(err?.response?.data?.error || 'Unable to load employment form.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [listEndpoint]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await api.get('/api/profile/employment-form/employees');
        if (!active) return;
        setEmployeeOptions(res.data || []);
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleFieldChange = useCallback((path: string, value: any) => {
    setForm((prev) => setValue(prev, path, value));
  }, []);

  const handleArrayChange = useCallback((path: string, index: number, key: string, value: any) => {
    setForm((prev) => {
      const list = ensureArray(prev, path).map((item) => ({ ...item }));
      list[index] = { ...(list[index] || {}), [key]: value };
      return setValue(prev, path, list);
    });
  }, []);

  const handleAddRow = useCallback((path: string, template: Record<string, string>) => {
    setForm((prev) => {
      const list = ensureArray(prev, path).map((item) => ({ ...item }));
      list.push({ ...template });
      return setValue(prev, path, list);
    });
  }, []);

  const handleSave = useCallback(
    async (target: 'draft' | 'submitted') => {
      setSaving(true);
      setMessage(null);
      setError(null);
      try {
        if (target === 'submitted') {
          const validation = validateBeforeSubmit(form);
          if (validation) {
            setSaving(false);
            setMessage(null);
            setError(validation);
            return;
          }
        }
        const payload = { ...form, status: target };
        const res = await api.put(saveEndpoint, { form: payload });
        const next = (res.data as RemoteDriverForm) || null;
        if (next?.form) {
          setForm(next.form);
          setStatus(next.status || target);
          setUpdatedAt(next.updatedAt || next.form.updatedAt || null);
          setSubmittedAt(next.submittedAt || next.form.submittedAt || null);
          setMessage(target === 'submitted' ? 'Submitted for review.' : 'Draft saved.');
        } else {
          setMessage('Saved.');
        }
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Failed to save form.');
      } finally {
        setSaving(false);
      }
    },
    [form, saveEndpoint],
  );

  const handleDocumentUpload = useCallback(
    async (docCode: string, file: File, remarks: string) => {
      if (!docUploadEnabled) return;
      const dataUrl = await fileToDataUrl(file);
      setUploadingDoc(docCode);
      setNotice(null);
      setError(null);
      try {
        const res = await api.post(`/api/profile/employment-form/documents/${docCode}`, { fileData: dataUrl, remarks });
        const payload = res.data as RemoteDriverForm;
        if (payload?.form) {
          setForm(payload.form);
          setStatus(payload.status || payload.form.status || 'draft');
          setUpdatedAt(payload.updatedAt || payload.form.updatedAt || null);
          setNotice('Document uploaded and queued for AI verification.');
        }
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Unable to upload document.');
      } finally {
        setUploadingDoc(null);
      }
    },
    [docUploadEnabled],
  );
  const personalStep = (
    <div className='space-y-4'>
      <FieldGrid
        fields={[
          { path: 'personalDetails.surname', label: 'Surname' },
          { path: 'personalDetails.otherNames', label: 'Other names' },
          { path: 'personalDetails.dateOfBirth', label: 'Date of birth', type: 'date' },
          { path: 'personalDetails.nationality', label: 'Nationality' },
          { path: 'personalDetails.idNumber', label: 'National ID / Passport' },
          { path: 'personalDetails.pinNumber', label: 'KRA PIN' },
          { path: 'personalDetails.mobileNumber', label: 'Mobile number' },
          { path: 'personalDetails.emailAddress', label: 'Email address' },
        ]}
        form={form}
        onChange={handleFieldChange}
        disabled={saving || status === 'submitted'}
      />
      <label className='block text-xs font-semibold uppercase tracking-wide text-slate-500'>
        Marital status
        <select
          className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none disabled:bg-slate-50'
          value={form.personalDetails.maritalStatus}
          onChange={(e) => handleFieldChange('personalDetails.maritalStatus', e.target.value)}
          disabled={saving || status === 'submitted'}
        >
          {MARITAL_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      {form.personalDetails.maritalStatus === 'Married' && (
        <FieldGrid
          fields={[
            { path: 'spouse.name', label: 'Spouse name' },
            { path: 'spouse.idNumber', label: 'Spouse ID / Passport' },
            { path: 'spouse.mobileNumber', label: 'Spouse mobile number' },
            { path: 'spouse.dateOfBirth', label: 'Spouse date of birth', type: 'date' },
          ]}
          form={form}
          onChange={handleFieldChange}
          disabled={saving || status === 'submitted'}
        />
      )}
    </div>
  );

  const contactStep = (
    <div className='space-y-5'>
      <ToggleRow
        label='Are you related to an Arise & Shine employee?'
        checked={Boolean(form.relatedEmployeeDisclosure.hasRelation)}
        onChange={(val) => handleFieldChange('relatedEmployeeDisclosure.hasRelation', val)}
        disabled={saving || status === 'submitted'}
      />
      {form.relatedEmployeeDisclosure.hasRelation && (
        <div className='rounded-2xl border border-slate-100 bg-white p-4'>
          <label className='block text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Select employee
            <select
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none disabled:bg-slate-50'
              value={form.relatedEmployeeDisclosure.employeeUserId || ''}
              onChange={(e) => handleFieldChange('relatedEmployeeDisclosure.employeeUserId', e.target.value)}
            >
              <option value=''>Choose employee</option>
              {employeeOptions.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} ({employee.role})
                </option>
              ))}
            </select>
          </label>
          <FieldGrid
            fields={[
              { path: 'relatedEmployeeDisclosure.personName', label: 'Employee name (override)' },
              { path: 'relatedEmployeeDisclosure.position', label: 'Employee position' },
              { path: 'relatedEmployeeDisclosure.relationship', label: 'Relationship' },
              { path: 'relatedEmployeeDisclosure.narrative', label: 'Details', type: 'textarea' },
            ]}
            form={form}
            onChange={handleFieldChange}
            disabled={saving || status === 'submitted'}
            columns={2}
          />
        </div>
      )}
      <FieldGrid
        fields={[
          { path: 'residentialAddress.postalAddress', label: 'Current postal address' },
          { path: 'residentialAddress.postalCode', label: 'Postal code' },
          { path: 'residentialAddress.estate', label: 'Estate' },
          { path: 'residentialAddress.roadOrStreet', label: 'Road / Street' },
          { path: 'residentialAddress.houseNumber', label: 'House / Flat no.' },
          { path: 'residentialAddress.telephone', label: 'House telephone' },
        ]}
        form={form}
        onChange={handleFieldChange}
        disabled={saving || status === 'submitted'}
      />
      <FieldGrid
        fields={[
          { path: 'homeAddress.district', label: 'Home district / county' },
          { path: 'homeAddress.location', label: 'Location' },
          { path: 'homeAddress.subLocation', label: 'Sub-location' },
          { path: 'homeAddress.postalAddress', label: 'Home postal address' },
          { path: 'homeAddress.postalCode', label: 'Home postal code' },
          { path: 'homeAddress.areaChiefName', label: 'Area chief name' },
          { path: 'homeAddress.areaChiefTel', label: 'Area chief phone' },
        ]}
        form={form}
        onChange={handleFieldChange}
        disabled={saving || status === 'submitted'}
      />
      <ArraySection
        title='Next of kin'
        columns={[
          { key: 'name', label: 'Full name' },
          { key: 'relationship', label: 'Relationship' },
          { key: 'phone', label: 'Phone' },
          { key: 'address', label: 'Postal address' },
        ]}
        items={form.nextOfKin}
        onChange={(idx, key, value) => handleArrayChange('nextOfKin', idx, key, value)}
        onAdd={() => handleAddRow('nextOfKin', { name: '', relationship: '', phone: '', address: '' })}
        disabled={saving || status === 'submitted'}
      />
    </div>
  );
  const healthStep = (
    <div className='space-y-5'>
      <ToggleDetails
        label='Do you have any terminal or chronic condition?'
        checked={Boolean(form.healthDisclosure.hasTerminalCondition)}
        onChange={(val) => handleFieldChange('healthDisclosure.hasTerminalCondition', val)}
        disabled={saving || status === 'submitted'}
      >
        <textarea
          className='mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none disabled:bg-slate-50'
          rows={3}
          value={form.healthDisclosure.terminalConditionDetails}
          onChange={(e) => handleFieldChange('healthDisclosure.terminalConditionDetails', e.target.value)}
          disabled={saving || status === 'submitted'}
        />
      </ToggleDetails>
      <ToggleDetails
        label='Do you have any disabilities or allergies?'
        checked={Boolean(form.healthDisclosure.hasDisabilities)}
        onChange={(val) => handleFieldChange('healthDisclosure.hasDisabilities', val)}
        disabled={saving || status === 'submitted'}
      >
        <textarea
          className='mt-3 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none disabled:bg-slate-50'
          rows={3}
          value={form.healthDisclosure.disabilityDetails}
          onChange={(e) => handleFieldChange('healthDisclosure.disabilityDetails', e.target.value)}
          disabled={saving || status === 'submitted'}
        />
      </ToggleDetails>
      <ToggleDetails
        label='Have you been involved in any criminal or civil cases?'
        checked={Boolean(form.criminalHistory.hasRecord)}
        onChange={(val) => handleFieldChange('criminalHistory.hasRecord', val)}
        disabled={saving || status === 'submitted'}
      >
        <ArraySection
          title='Criminal / Civil cases'
          columns={[
            { key: 'date', label: 'Date' },
            { key: 'nature', label: 'Nature' },
            { key: 'penalty', label: 'Outcome' },
          ]}
          items={form.criminalHistory.entries}
          onChange={(idx, key, value) => handleArrayChange('criminalHistory.entries', idx, key, value)}
          onAdd={() =>
            handleAddRow('criminalHistory.entries', { date: '', nature: '', penalty: '' })
          }
          disabled={saving || status === 'submitted'}
        />
      </ToggleDetails>
      <ToggleDetails
        label='Have you ever been dismissed from employment for misconduct?'
        checked={Boolean(form.misconductHistory.hasRecord)}
        onChange={(val) => handleFieldChange('misconductHistory.hasRecord', val)}
        disabled={saving || status === 'submitted'}
      >
        <ArraySection
          title='Dismissals'
          columns={[
            { key: 'date', label: 'Date' },
            { key: 'reason', label: 'Details' },
          ]}
          items={form.misconductHistory.entries}
          onChange={(idx, key, value) => handleArrayChange('misconductHistory.entries', idx, key, value)}
          onAdd={() => handleAddRow('misconductHistory.entries', { date: '', reason: '' })}
          disabled={saving || status === 'submitted'}
        />
      </ToggleDetails>
    </div>
  );

  const refereesStep = (
    <div className='space-y-5'>
      <ArraySection
        title='Referees'
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'relationship', label: 'Relationship' },
          { key: 'phone', label: 'Phone' },
          { key: 'email', label: 'Email' },
          { key: 'knownDuration', label: 'Known duration' },
        ]}
        items={form.referees}
        onChange={(idx, key, value) => handleArrayChange('referees', idx, key, value)}
        onAdd={() =>
          handleAddRow('referees', { name: '', relationship: '', phone: '', email: '', knownDuration: '', notes: '' })
        }
        disabled={saving || status === 'submitted'}
      />
      <ArraySection
        title='Employment history'
        columns={[
          { key: 'employer', label: 'Employer' },
          { key: 'periodFrom', label: 'From' },
          { key: 'periodTo', label: 'To' },
          { key: 'jobTitle', label: 'Job title' },
          { key: 'reasonForLeaving', label: 'Reason for leaving' },
        ]}
        items={form.employmentHistory}
        onChange={(idx, key, value) => handleArrayChange('employmentHistory', idx, key, value)}
        onAdd={() =>
          handleAddRow('employmentHistory', {
            employer: '',
            periodFrom: '',
            periodTo: '',
            jobTitle: '',
            reasonForLeaving: '',
            contactPerson: '',
            contactDetails: '',
          })
        }
        disabled={saving || status === 'submitted'}
      />
    </div>
  );
  const documentsStep = (
    <div className='space-y-6'>
      <div className='rounded-3xl border border-slate-100 bg-white p-5 shadow-sm'>
        <p className='text-sm text-slate-600'>
          Tick all statements then sign digitally. Your signature is stored securely and embedded in the HR PDF export.
        </p>
        <div className='mt-4 grid gap-3'>
          {['A', 'B', 'C', 'D'].map((letter, index) => {
            const mapping: Record<number, keyof typeof form.declarations> = {
              0: 'statementA',
              1: 'statementB',
              2: 'statementC',
              3: 'statementD',
            };
            const textMap = [
              'That the information in this form is correct and filled to the best of my knowledge.',
              'That I have no criminal convictions, whether current, pending or past, which I have not declared.',
              'That any misrepresentation of facts may lead to rejection, disciplinary proceedings, or criminal charges.',
              'That I will cooperate with evaluators when they contact referees, employers, institutions or agencies.',
            ];
            const key = mapping[index];
            return (
              <label key={letter} className='flex items-start gap-3 rounded-2xl border border-slate-200 p-3 text-sm text-slate-700'>
                <input
                  type='checkbox'
                  className='mt-1 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500'
                  checked={Boolean(form.declarations[key])}
                  onChange={(e) => handleFieldChange(`declarations.${key}`, e.target.checked)}
                  disabled={saving || status === 'submitted'}
                />
                <span>
                  <span className='font-semibold'>({letter.toLowerCase()}) </span>
                  {textMap[index]}
                </span>
              </label>
            );
          })}
        </div>
        <div className='mt-4 grid gap-3 md:grid-cols-3'>
          <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Applicant name
            <input
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none disabled:bg-slate-50'
              value={form.declarations.applicantName}
              onChange={(e) => handleFieldChange('declarations.applicantName', e.target.value)}
              disabled={saving || status === 'submitted'}
            />
          </label>
          <label className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Date signed
            <input
              type='date'
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none disabled:bg-slate-50'
              value={form.declarations.signedAt}
              onChange={(e) => handleFieldChange('declarations.signedAt', e.target.value)}
              disabled={saving || status === 'submitted'}
            />
          </label>
        </div>
        <div className='mt-4'>
          <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Signature</p>
          <SignaturePad
            value={form.declarations.signature}
            onChange={(value) => handleFieldChange('declarations.signature', value)}
            disabled={saving || status === 'submitted'}
          />
        </div>
      </div>

      <div className='rounded-3xl border border-slate-100 bg-white p-5 shadow-sm'>
        <div className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
          <div>
            <p className='text-base font-semibold text-slate-900'>Document uploads</p>
            <p className='text-sm text-slate-500'>Upload scans or clear photos. Our AI checks for mismatches automatically.</p>
          </div>
          {notice && <span className='rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700'>{notice}</span>}
        </div>
        <div className='mt-4 grid gap-3'>
          {form.documentsChecklist.map((doc) => (
            <div key={doc.code} className='flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4 text-sm md:flex-row md:items-center md:justify-between'>
              <div>
                <p className='font-semibold text-slate-800'>{doc.label}</p>
                <p className='text-xs text-slate-500'>
                  Status:{' '}
                  {doc.validationStatus === 'flagged'
                    ? 'Needs resubmission'
                    : doc.validationStatus === 'verified'
                      ? 'Verified'
                      : doc.attachmentPath
                        ? 'Pending AI review'
                        : 'Not uploaded'}
                </p>
                {doc.flagMessage && <p className='text-xs text-rose-600'>{doc.flagMessage}</p>}
              </div>
              <div className='flex flex-1 flex-col gap-2 md:flex-row md:items-center md:justify-end'>
                <input
                  type='text'
                  className='w-full rounded-2xl border border-slate-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none md:max-w-xs'
                  placeholder='Remarks'
                  value={doc.remarks || ''}
                  onChange={(e) => handleFieldChange(`documentsChecklist.${form.documentsChecklist.indexOf(doc)}.remarks`, e.target.value)}
                />
                <label className='inline-flex cursor-pointer items-center rounded-full bg-white px-4 py-2 text-xs font-semibold text-amber-700 shadow-sm ring-1 ring-amber-100 hover:bg-amber-50'>
                  <Upload className='mr-2 h-4 w-4' />
                  {uploadingDoc === doc.code ? 'Uploading...' : 'Upload'}
                  <input
                    type='file'
                    accept='image/*'
                    className='hidden'
                    disabled={!docUploadEnabled || uploadingDoc === doc.code || saving || status === 'submitted'}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      if (!e.target.files || !e.target.files[0]) return;
                      handleDocumentUpload(doc.code, e.target.files[0], doc.remarks || '');
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
  const stepsContent = [personalStep, contactStep, healthStep, refereesStep, documentsStep];

  return (
    <section className='rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm backdrop-blur'>
      <div className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-[0.2em] text-amber-600'>Employment dossier</p>
          <h2 className='text-xl font-bold text-slate-900'>{driverName || form.owner?.name || 'Your details'}</h2>
          <p className='text-sm text-slate-500'>Complete each stage below. You can save midway and return later.</p>
        </div>
        <div className='rounded-2xl border border-slate-200 px-4 py-2 text-right'>
          <p className='text-xs text-slate-500'>Completion</p>
          <p className='text-2xl font-extrabold text-amber-600'>{completion.completionPercent}%</p>
          {updatedAt && <p className='text-xs text-slate-500'>Updated {new Date(updatedAt).toLocaleDateString()}</p>}
        </div>
      </div>

      {error && (
        <div className='mt-4 flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700'>
          <AlertTriangle className='h-4 w-4' /> {error}
        </div>
      )}
      {message && (
        <div className='mt-4 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700'>
          <CheckCircle2 className='h-4 w-4' /> {message}
        </div>
      )}

      <div className='mt-6 flex flex-wrap gap-2'>
        {STEP_FLOW.map((step, index) => {
          const progress = completion.steps.find((item) => item.id === step.id);
          return (
            <button
              key={step.id}
              type='button'
              onClick={() => setActiveStep(index)}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                activeStep === index
                  ? 'bg-amber-600 text-white'
                  : progress?.complete
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-slate-100 text-slate-600'
              }`}
            >
              {step.label}
            </button>
          );
        })}
      </div>

      <div className='mt-6'>{loading ? <LoadingState /> : stepsContent[activeStep]}</div>

      <div className='mt-6 flex flex-wrap gap-3'>
        <button
          type='button'
          onClick={() => handleSave('draft')}
          disabled={saving}
          className='inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50'
        >
          {saving ? <Loader2 className='h-4 w-4 animate-spin' /> : <Save className='h-4 w-4' />}
          Save draft
        </button>
        <button
          type='button'
          onClick={() => handleSave('submitted')}
          disabled={saving || status === 'submitted'}
          className='inline-flex items-center gap-2 rounded-full bg-amber-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-amber-500 disabled:opacity-60'
        >
          <Send className='h-4 w-4' />
          Submit for review
        </button>
        <button
          type='button'
          onClick={() => setForm((prev) => ({ ...prev }))}
          className='inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50'
        >
          <RefreshCcw className='h-4 w-4' />
          Refresh
        </button>
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <div className='flex items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-500'>
      <Loader2 className='h-4 w-4 animate-spin text-amber-600' />
      Loading form...
    </div>
  );
}

function FieldGrid({
  fields,
  form,
  onChange,
  disabled,
  columns = 2,
}: {
  fields: { path: string; label: string; type?: 'text' | 'date' | 'textarea' }[];
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
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none disabled:bg-slate-50'
              rows={3}
              value={getValue(form, field.path) || ''}
              onChange={(e) => onChange(field.path, e.target.value)}
              disabled={disabled}
            />
          ) : (
            <input
              type={field.type === 'date' ? 'date' : 'text'}
              className='mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none disabled:bg-slate-50'
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

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className='flex items-center gap-3 rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700'>
      <input
        type='checkbox'
        className='h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500'
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      {label}
    </label>
  );
}

function ToggleDetails({
  label,
  checked,
  onChange,
  disabled,
  children,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className='rounded-2xl border border-slate-200 p-4'>
      <div className='flex items-center gap-3'>
        <input
          type='checkbox'
          className='h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500'
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <p className='text-sm font-semibold text-slate-700'>{label}</p>
      </div>
      {checked && <div className='mt-3'>{children}</div>}
    </div>
  );
}

function ArraySection({
  title,
  columns,
  items,
  onChange,
  onAdd,
  disabled,
}: {
  title: string;
  columns: { key: string; label: string }[];
  items: any[];
  onChange: (index: number, key: string, value: string) => void;
  onAdd: () => void;
  disabled?: boolean;
}) {
  return (
    <div className='rounded-2xl border border-slate-100 bg-white px-3 py-4'>
      <div className='mb-3 flex items-center justify-between'>
        <p className='text-sm font-semibold text-slate-900'>{title}</p>
        <button
          type='button'
          onClick={onAdd}
          className='rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50'
          disabled={disabled}
        >
          + Add
        </button>
      </div>
      <div className='overflow-x-auto'>
        <table className='w-full border-collapse text-xs'>
          <thead>
            <tr className='bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500'>
              {columns.map((col) => (
                <th key={col.key} className='border border-slate-200 px-2 py-1'>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={`${title}-${index}`}>
                {columns.map((col) => (
                  <td key={col.key} className='border border-slate-200 px-2 py-1'>
                    <input
                      className='w-full border-none bg-transparent text-sm focus:outline-none'
                      value={item?.[col.key] || ''}
                      onChange={(e) => onChange(index, col.key, e.target.value)}
                      disabled={disabled}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function getValue(form: DriverOnboardingForm, path: string) {
  return path.split('.').reduce<any>((value, segment) => (value ? value[segment] : undefined), form);
}

function ensureArray(form: DriverOnboardingForm, path: string) {
  const value = getValue(form, path);
  return Array.isArray(value) ? value : [];
}

function setValue(form: DriverOnboardingForm, path: string, nextValue: any) {
  const segments = path.split('.');
  const baseClone = typeof structuredClone === 'function' ? structuredClone(form) : JSON.parse(JSON.stringify(form));
  const clone: any = baseClone;
  let cursor = clone;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i];
    cursor[key] = Array.isArray(cursor[key]) ? [...cursor[key]] : { ...(cursor[key] || {}) };
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = nextValue;
  return clone as DriverOnboardingForm;
}

function validateBeforeSubmit(form: DriverOnboardingForm) {
  if (!form.personalDetails.surname || !form.personalDetails.otherNames) {
    return 'Provide your surname and other names as they appear on official documents.';
  }
  if (!form.personalDetails.idNumber) {
    return 'National ID / Passport number is required.';
  }
  if (!form.personalDetails.mobileNumber) {
    return 'Provide a contact mobile number.';
  }
  if (!form.declarations.applicantName || !form.declarations.signedAt || !form.declarations.signature) {
    return 'Please fill and sign the declaration before submitting.';
  }
  return null;
}

async function fileToDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}
