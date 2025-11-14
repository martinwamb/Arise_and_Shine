import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import DriverOnboardingFormPanel from '../components/DriverOnboardingFormPanel';

type CompletionSummary = {
  isComplete: boolean;
  completionPercent: number;
  missingFields: string[];
  missingDocuments: string[];
  steps: { id: string; title: string; complete: boolean; missing: string[] }[];
};

type FormStatusResponse = {
  status: string;
  updatedAt?: string | null;
  submittedAt?: string | null;
  completionSummary?: CompletionSummary;
  deadlineAt?: string | null;
};

export default function Profile() {
  const [status, setStatus] = useState<FormStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = (typeof window !== 'undefined' ? localStorage.getItem('role') : '') as
    | 'ADMIN'
    | 'OPS'
    | 'CUSTOMER'
    | 'DRIVER'
    | 'FUEL'
    | null;

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.get('/api/profile/employment-form/status');
        if (!active) return;
        setStatus(res.data as FormStatusResponse);
      } catch (err: any) {
        if (!active) return;
        setError(err?.response?.data?.error || 'Unable to load employment form status.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const summaryList = useMemo(() => status?.completionSummary?.steps || [], [status]);
  const missingHighlights = useMemo(() => status?.completionSummary?.missingFields?.slice(0, 3) || [], [status]);

  return (
    <div className='bg-gradient-to-b from-slate-50 via-amber-50/60 to-white py-10'>
      <div className='mx-auto flex max-w-6xl flex-col gap-6 px-4'>
        <div className='rounded-3xl border border-amber-100 bg-white/90 p-6 shadow-sm backdrop-blur'>
          <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
            <div>
              <p className='text-xs font-semibold uppercase tracking-[0.2em] text-amber-600'>Arise &amp; Shine Transporters</p>
              <h1 className='text-2xl font-bold text-slate-900'>Personal &amp; employment details</h1>
              <p className='text-sm text-slate-600'>
                Complete the onboarding dossier to keep your account active. Your dashboard stays live while you work through the steps.
              </p>
            </div>
            <div className='rounded-2xl border border-slate-200 px-4 py-3 text-right'>
              <p className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Completion</p>
              <p className='text-3xl font-extrabold text-amber-600'>
                {status?.completionSummary?.completionPercent ?? 0}
                <span className='text-base font-semibold text-slate-500'>%</span>
              </p>
              <p className='text-xs text-slate-500'>
                Updated {status?.updatedAt ? new Date(status.updatedAt).toLocaleDateString() : 'just now'}
              </p>
            </div>
          </div>
          {loading && <p className='mt-4 text-sm text-slate-600'>Checking your profile...</p>}
          {!loading && error && <p className='mt-4 text-sm text-rose-600'>{error}</p>}
          {!loading && !error && status?.completionSummary && !status.completionSummary.isComplete && (
            <div className='mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-900'>
              <p className='font-semibold'>Missing details</p>
              <p className='text-sm'>
                {missingHighlights.length ? missingHighlights.join(', ') : 'Complete the remaining sections.'}
              </p>
              {status.deadlineAt && (
                <p className='text-xs text-amber-800'>
                  Complete before {new Date(status.deadlineAt).toLocaleDateString()} to avoid temporary account suspension.
                </p>
              )}
            </div>
          )}
          {summaryList.length > 0 && (
            <div className='mt-4 grid gap-3 md:grid-cols-3'>
              {summaryList.map((step) => (
                <div
                  key={step.id}
                  className={`rounded-2xl border px-4 py-3 text-sm ${
                    step.complete ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  <p className='font-semibold'>{step.title}</p>
                  <p className='text-xs'>{step.complete ? 'Complete' : `${step.missing.length} items pending`}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <DriverOnboardingFormPanel driverId={null} role={role || ''} />
      </div>
    </div>
  );
}
