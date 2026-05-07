import React, { useState } from 'react';
import { api } from '../api';

type Step = 'form' | 'submitting' | 'done' | 'error';

export default function DataDeletion() {
  const [step, setStep] = useState<Step>('form');
  const [form, setForm] = useState({ name: '', email: '', reason: '', confirm: false });
  const [errorMsg, setErrorMsg] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email || !form.confirm) return;
    setStep('submitting');
    try {
      await api.post('/api/data-deletion-request', {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        reason: form.reason.trim(),
      });
      setStep('done');
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.error || 'Something went wrong. Please email us directly.');
      setStep('error');
    }
  }

  return (
    <div className='min-h-screen bg-slate-50 py-10 px-4'>
      <div className='max-w-xl mx-auto'>

        {/* Header */}
        <div className='text-center mb-8'>
          <div className='inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-900 text-white text-2xl mb-4'>🗑️</div>
          <h1 className='text-2xl font-bold text-slate-900'>Request Data Deletion</h1>
          <p className='text-slate-500 mt-2 text-sm'>Arise &amp; Shine Transporters</p>
        </div>

        {step === 'done' && (
          <div className='bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center'>
            <div className='text-4xl mb-4'>✅</div>
            <h2 className='text-xl font-semibold text-slate-800 mb-2'>Request Received</h2>
            <p className='text-slate-600 leading-relaxed'>
              We have received your data deletion request for <strong>{form.email}</strong>.
              Our team will process it within <strong>30 days</strong> and send a confirmation
              to your email address once complete.
            </p>
            <p className='text-sm text-slate-400 mt-4'>
              If you have urgent concerns, email us at{' '}
              <a href='mailto:admin@ariseandshinetransporters.com' className='text-blue-600 underline'>
                admin@ariseandshinetransporters.com
              </a>
            </p>
          </div>
        )}

        {step === 'error' && (
          <div className='bg-white rounded-2xl border border-rose-200 shadow-sm p-8 text-center'>
            <div className='text-4xl mb-4'>⚠️</div>
            <h2 className='text-xl font-semibold text-slate-800 mb-2'>Submission Failed</h2>
            <p className='text-slate-600'>{errorMsg}</p>
            <p className='text-sm text-slate-500 mt-3'>
              Please email your request directly to{' '}
              <a href='mailto:admin@ariseandshinetransporters.com' className='text-blue-600 underline'>
                admin@ariseandshinetransporters.com
              </a>
            </p>
            <button
              onClick={() => setStep('form')}
              className='mt-4 text-sm text-slate-600 underline'
            >
              Try again
            </button>
          </div>
        )}

        {(step === 'form' || step === 'submitting') && (
          <div className='bg-white rounded-2xl border border-slate-200 shadow-sm p-8'>

            <p className='text-slate-600 text-sm leading-relaxed mb-6'>
              Use this form to request deletion of your personal data from the Arise &amp; Shine
              Transporters platform. We will process your request within <strong>30 days</strong> and
              notify you by email. Note that some data may be retained where required by law or for
              legitimate operational purposes (e.g. financial records).
            </p>

            <form onSubmit={submit} className='space-y-5'>

              <div>
                <label className='block text-sm font-medium text-slate-700 mb-1'>
                  Full Name <span className='text-slate-400 font-normal'>(optional)</span>
                </label>
                <input
                  type='text'
                  className='w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-500'
                  placeholder='Your name'
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div>
                <label className='block text-sm font-medium text-slate-700 mb-1'>
                  Email Address <span className='text-rose-500'>*</span>
                </label>
                <input
                  type='email'
                  required
                  className='w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-500'
                  placeholder='The email address on your account'
                  value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                />
                <p className='text-xs text-slate-400 mt-1'>Must match the email used to register your account</p>
              </div>

              <div>
                <label className='block text-sm font-medium text-slate-700 mb-1'>
                  Reason <span className='text-slate-400 font-normal'>(optional)</span>
                </label>
                <textarea
                  rows={3}
                  className='w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-500 resize-none'
                  placeholder='Why are you requesting deletion? (optional)'
                  value={form.reason}
                  onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                />
              </div>

              <div className='bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 space-y-1'>
                <p className='font-medium'>What will be deleted:</p>
                <ul className='list-disc pl-4 space-y-0.5 text-amber-700'>
                  <li>Your account and login credentials</li>
                  <li>Personal profile information (name, phone, email)</li>
                  <li>Uploaded photos and documents</li>
                  <li>Order history and associated data</li>
                </ul>
                <p className='font-medium mt-2'>What may be retained:</p>
                <ul className='list-disc pl-4 space-y-0.5 text-amber-700'>
                  <li>Financial records required for audit purposes</li>
                  <li>Data required by Kenyan law</li>
                </ul>
              </div>

              <label className='flex items-start gap-3 cursor-pointer'>
                <input
                  type='checkbox'
                  className='mt-0.5 h-4 w-4 accent-slate-800'
                  checked={form.confirm}
                  onChange={e => setForm(f => ({ ...f, confirm: e.target.checked }))}
                />
                <span className='text-sm text-slate-600'>
                  I understand that this action is irreversible and confirm that I want my personal
                  data deleted from the Arise &amp; Shine Transporters platform.
                </span>
              </label>

              <button
                type='submit'
                disabled={!form.email || !form.confirm || step === 'submitting'}
                className='w-full rounded-lg bg-slate-900 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors'
              >
                {step === 'submitting' ? 'Submitting…' : 'Submit Deletion Request'}
              </button>

            </form>
          </div>
        )}

        <p className='text-center text-xs text-slate-400 mt-6'>
          <a href='/privacy' className='underline hover:text-slate-600'>Privacy Policy</a>
          {' · '}
          <a href='/' className='underline hover:text-slate-600'>Back to website</a>
        </p>

      </div>
    </div>
  );
}
