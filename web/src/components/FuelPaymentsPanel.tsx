import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { todayStr } from '../lib/dates';

type Payment = { id: string; amount: number; paidOn: string; reference?: string | null; note?: string | null; createdAt?: string };
type Summary = { accrued: number; paid: number; outstanding: number };
type Status = { kind: 'idle' | 'success' | 'error'; message: string };

const kes = (n: number) => `KES ${Number(n || 0).toLocaleString()}`;

// Fuel accrues as usage is recorded; each lump-sum payment draws down the running
// balance. Payments are not tied to specific fuel records — one global balance.
export default function FuelPaymentsPanel({ isAdmin, reloadSignal }: { isAdmin: boolean; reloadSignal?: number }) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [summary, setSummary] = useState<Summary>({ accrued: 0, paid: 0, outstanding: 0 });
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(todayStr);
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/api/admin/fuel/payments');
      setPayments(Array.isArray(res.data?.payments) ? res.data.payments : []);
      if (res.data?.summary) setSummary(res.data.summary);
    } catch (err: any) {
      setStatus({ kind: 'error', message: err?.response?.data?.error || err?.message || 'Failed to load payments.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, reloadSignal]);

  async function record() {
    const value = parseFloat(amount || '0');
    if (!Number.isFinite(value) || value <= 0) {
      setStatus({ kind: 'error', message: 'Enter an amount greater than zero.' });
      return;
    }
    try {
      setSaving(true);
      const res = await api.post('/api/admin/fuel/payments', { amount: value, paidOn, reference: reference.trim() });
      if (res.data?.summary) setSummary(res.data.summary);
      setAmount('');
      setReference('');
      setStatus({ kind: 'success', message: 'Payment recorded.' });
      await load();
    } catch (err: any) {
      setStatus({ kind: 'error', message: err?.response?.data?.error || err?.message || 'Failed to record payment.' });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this payment? The outstanding balance will go back up.')) return;
    try {
      await api.delete(`/api/admin/fuel/payments/${id}`);
      await load();
    } catch (err: any) {
      setStatus({ kind: 'error', message: err?.response?.data?.error || err?.message || 'Failed to remove payment.' });
    }
  }

  return (
    <div className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
      <div>
        <h3 className='text-sm font-semibold text-slate-900'>Fuel payments & balance</h3>
        <p className='text-xs text-slate-500'>
          Fuel usage builds up an outstanding balance. Record each lump-sum payment made to the
          supplier and it draws the balance down.
        </p>
      </div>

      {/* Balance summary */}
      <div className='mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3'>
        <div className='rounded-2xl border border-amber-200 bg-amber-50 p-4'>
          <div className='text-[11px] font-semibold uppercase tracking-wide text-amber-700'>Outstanding balance</div>
          <div className='mt-1 text-xl font-bold text-amber-900'>{kes(summary.outstanding)}</div>
        </div>
        <div className='rounded-2xl border border-slate-200 p-4'>
          <div className='text-[11px] font-semibold uppercase tracking-wide text-slate-500'>Fuel recorded (total)</div>
          <div className='mt-1 text-lg font-semibold text-slate-800'>{kes(summary.accrued)}</div>
        </div>
        <div className='rounded-2xl border border-slate-200 p-4'>
          <div className='text-[11px] font-semibold uppercase tracking-wide text-slate-500'>Paid (total)</div>
          <div className='mt-1 text-lg font-semibold text-emerald-700'>{kes(summary.paid)}</div>
        </div>
      </div>

      {/* Record payment (admin only) */}
      {isAdmin && (
        <div className='mt-4 rounded-2xl border border-slate-200 p-4'>
          <div className='mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500'>Record a payment</div>
          <div className='grid gap-2 sm:grid-cols-4'>
            <input
              type='number'
              inputMode='decimal'
              min={0}
              step='0.01'
              placeholder='Amount (KES)'
              className='rounded border border-slate-300 px-2 py-1 text-sm'
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              type='date'
              className='rounded border border-slate-300 px-2 py-1 text-sm'
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
            <input
              className='rounded border border-slate-300 px-2 py-1 text-sm sm:col-span-1'
              placeholder='Reference / note (optional)'
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
            <button
              type='button'
              onClick={record}
              disabled={saving}
              className='rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60'
            >
              {saving ? 'Saving…' : 'Record payment'}
            </button>
          </div>
          {status.kind !== 'idle' && (
            <p className={`mt-2 text-xs font-semibold ${status.kind === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
              {status.message}
            </p>
          )}
        </div>
      )}

      {/* Payment history */}
      <div className='mt-4'>
        <div className='mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500'>Payment history</div>
        <div className='space-y-1 text-sm'>
          {payments.map((p) => (
            <div key={p.id} className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2'>
              <div className='min-w-0'>
                <span className='font-semibold text-slate-900'>{kes(p.amount)}</span>
                <span className='ml-2 text-slate-500'>{p.paidOn}</span>
                {p.reference && <span className='ml-2 text-slate-400'>· {p.reference}</span>}
              </div>
              {isAdmin && (
                <button
                  type='button'
                  onClick={() => remove(p.id)}
                  className='rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:border-rose-300 hover:text-rose-600'
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {!payments.length && (
            <div className='py-3 text-center text-xs text-slate-400'>{loading ? 'Loading…' : 'No payments recorded yet.'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
