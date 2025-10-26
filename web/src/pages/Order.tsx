import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { AlertCircle, ArrowRight, Banknote, CheckCircle } from 'lucide-react';
import { BANK_OPTIONS } from '../constants/payment';

type Quote = { perTruck: number; total: number; distanceKm: number; sandType: string; truckCount: number; distanceSource?: string };
const DISTANCE_SOURCE_LABELS: Record<string, string> = {
  manual: 'manual distance',
  geocoded: 'geocoded',
  heuristic: 'name heuristic',
  default: 'default estimate',
};

export default function Order() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    site: '',
    sandType: 'coarse',
    trucks: 1,
    distanceKm: '',
    dateNeeded: '',
  });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'idle' | 'error' | 'success'; message: string }>({
    kind: 'idle',
    message: '',
  });
  const [order, setOrder] = useState<{
    id: string;
    status: string;
    perTruck: number;
    total: number;
    distanceKm: number;
    sandType: string;
    truckCount: number;
    distanceSource?: string;
  } | null>(null);
  const [payment, setPayment] = useState({ method: BANK_OPTIONS[0].bank, reference: '', message: '' });
  const [paymentStatus, setPaymentStatus] = useState<{ kind: 'idle' | 'success' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });

  useEffect(() => {
    if (!form.site.trim()) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        const res = await api.post('/api/pricing/quote', {
          site: form.site,
          sandType: form.sandType,
          trucks: form.trucks,
          distanceKm: form.distanceKm ? Number(form.distanceKm) : undefined,
        });
        if (!cancelled) {
          setQuote(res.data);
          setQuoteError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(err?.response?.data?.error || 'Could not refresh pricing.');
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [form.site, form.sandType, form.trucks, form.distanceKm]);

  const trucksOptions = useMemo(() => Array.from({ length: 20 }).map((_, idx) => idx + 1), []);
  const quoteDistanceLabel = quote
    ? DISTANCE_SOURCE_LABELS[quote.distanceSource ?? ''] || 'estimated'
    : 'estimated';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFeedback({ kind: 'idle', message: '' });
    setPaymentStatus({ kind: 'idle', message: '' });
    try {
      const res = await api.post('/api/orders', {
        site: form.site,
        sandType: form.sandType,
        trucks: form.trucks,
        distanceKm: form.distanceKm ? Number(form.distanceKm) : undefined,
        dateNeeded: form.dateNeeded || undefined,
      });
      setOrder({
        id: res.data.id,
        status: res.data.status,
        perTruck: res.data.perTruck,
        total: res.data.total,
        distanceKm: res.data.distanceKm,
        sandType: form.sandType,
        truckCount: form.trucks,
        distanceSource: res.data.distanceSource || res.data.distance_source,
      });
      setFeedback({
        kind: 'success',
        message: 'Order captured. Share the payment confirmation below so dispatch can mobilise trucks.',
      });
    } catch (err: any) {
      const message = err?.response?.status === 401 ? 'Please sign in as a customer first.' : err?.response?.data?.error;
      if (err?.response?.status === 401) nav('/login');
      setFeedback({
        kind: 'error',
        message: message || 'Failed to place order.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!order) return;
    setPaymentStatus({ kind: 'idle', message: '' });
    try {
      const res = await api.post(`/api/orders/${order.id}/payment`, {
        method: payment.method,
        reference: payment.reference,
        message: payment.message,
        status: undefined,
      });
      setOrder((prev) =>
        prev
          ? {
              ...prev,
              status: res.data.status,
            }
          : prev
      );
      setPaymentStatus({
        kind: 'success',
        message: 'Payment confirmation submitted. Operations will review and schedule trucks.',
      });
      setPayment({ ...payment, reference: '', message: '' });
    } catch (err: any) {
      setPaymentStatus({
        kind: 'error',
        message: err?.response?.data?.error || 'Could not register payment confirmation.',
      });
    }
  }

  return (
    <main className='mx-auto max-w-4xl px-4 py-16'>
      <h1 className='text-3xl font-extrabold tracking-tight text-slate-900'>Customer order portal</h1>
      <p className='mt-2 max-w-2xl text-sm text-slate-600'>
        Pricing adapts to distance automatically. After submitting your order, confirm payment so operations can assign
        trucks and update status to <strong>Received</strong>.
      </p>
      <div className='mt-6 grid gap-8 lg:grid-cols-[1.2fr_1fr]'>
        <section className='rounded-3xl border border-amber-100 bg-white p-6 shadow-sm'>
          <h2 className='text-lg font-semibold text-slate-900'>1. Capture order details</h2>
          <form onSubmit={submit} className='mt-4 space-y-3 text-sm'>
            <label className='block text-xs font-semibold uppercase tracking-wide text-slate-500'>
              Site location
              <input
                required
                className='mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-amber-500 focus:outline-none'
                value={form.site}
                onChange={(e) => setForm((p) => ({ ...p, site: e.target.value }))}
                placeholder='e.g. Thika Greens Phase 2, Gate 4'
              />
            </label>
            <div className='grid gap-3 sm:grid-cols-2'>
              <label className='block text-xs font-semibold uppercase tracking-wide text-slate-500'>
                Sand type
                <select
                  className='mt-1 w-full rounded-lg border border-slate-200 px-3 py-2'
                  value={form.sandType}
                  onChange={(e) => setForm((p) => ({ ...p, sandType: e.target.value }))}
                >
                  <option value='coarse'>Coarse (foundations, slabs)</option>
                  <option value='smooth'>Smooth (plastering, finishes)</option>
                </select>
              </label>
              <label className='block text-xs font-semibold uppercase tracking-wide text-slate-500'>
                Trucks needed
                <select
                  className='mt-1 w-full rounded-lg border border-slate-200 px-3 py-2'
                  value={form.trucks}
                  onChange={(e) => setForm((p) => ({ ...p, trucks: Number(e.target.value) }))}
                >
                  {trucksOptions.map((option) => (
                    <option key={option} value={option}>
                      {option} truck{option > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className='grid gap-3 sm:grid-cols-2'>
              <label className='block text-xs font-semibold uppercase tracking-wide text-slate-500'>
                Distance estimate (km)
                <input
                  className='mt-1 w-full rounded-lg border border-slate-200 px-3 py-2'
                  value={form.distanceKm}
                  onChange={(e) => setForm((p) => ({ ...p, distanceKm: e.target.value }))}
                  placeholder='Optional'
                />
              </label>
              <label className='block text-xs font-semibold uppercase tracking-wide text-slate-500'>
                Date needed
                <input
                  type='date'
                  className='mt-1 w-full rounded-lg border border-slate-200 px-3 py-2'
                  value={form.dateNeeded}
                  onChange={(e) => setForm((p) => ({ ...p, dateNeeded: e.target.value }))}
                />
              </label>
            </div>
            {quote && (
              <div className='rounded-2xl bg-emerald-50 px-4 py-3 text-xs text-emerald-900'>
                <div className='flex items-center gap-2 text-sm font-semibold'>
                  <CheckCircle className='h-4 w-4' /> Quote ready
                </div>
                <p className='mt-1'>
                  Per truck <strong>KES {quote.perTruck.toLocaleString()}</strong> | Total{' '}
                  <strong>KES {quote.total.toLocaleString()}</strong> ({quote.truckCount} truck
                  {quote.truckCount > 1 ? 's' : ''}) based on ~{Math.round(quote.distanceKm)} km ({quoteDistanceLabel})
                </p>
              </div>
            )}
            {quoteError && (
              <div className='flex items-center gap-2 rounded-2xl bg-rose-50 px-4 py-2 text-xs text-rose-600'>
                <AlertCircle className='h-4 w-4' /> {quoteError}
              </div>
            )}
            {feedback.kind !== 'idle' && (
              <div
                className={`flex items-center gap-2 rounded-2xl px-4 py-2 text-xs ${
                  feedback.kind === 'success'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-rose-50 text-rose-600'
                }`}
              >
                {feedback.kind === 'success' ? <CheckCircle className='h-4 w-4' /> : <AlertCircle className='h-4 w-4' />}
                {feedback.message}
              </div>
            )}
            <button
              type='submit'
              disabled={submitting}
              className='group flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60'
            >
              {submitting ? 'Submitting...' : 'Submit order'} <ArrowRight className='h-4 w-4 transition group-hover:translate-x-1' />
            </button>
          </form>
        </section>
        <section className='space-y-6'>
          <PaymentOptions order={order} />
          <PaymentForm
            disabled={!order}
            payment={payment}
            onChange={setPayment}
            onSubmit={submitPayment}
            status={paymentStatus}
          />
        </section>
      </div>
    </main>
  );
}

function PaymentOptions({ order }: { order: { id: string; perTruck: number; total: number; status: string; distanceKm: number; distanceSource?: string } | null }) {
  const distanceLabel =
    order && Number.isFinite(order.distanceKm)
      ? DISTANCE_SOURCE_LABELS[order.distanceSource ?? ''] || 'estimated'
      : 'estimated';
  return (
    <div className='rounded-3xl border border-amber-100 bg-white p-6 shadow-sm'>
      <div className='flex items-center gap-2 text-lg font-semibold text-slate-900'>
        <Banknote className='h-5 w-5 text-amber-500' /> 2. Payment details
      </div>
      <p className='mt-2 text-xs text-slate-600'>
        Use any bank below (MPESA paybill). Enter the account exactly as shown, then share the MPESA/RTGS message in
        the form. We reconcile and activate the order immediately after confirmation.
      </p>
      <ul className='mt-4 space-y-3 text-sm'>
        {BANK_OPTIONS.map((bank) => (
          <li key={bank.bank} className='rounded-2xl border border-amber-50 bg-amber-50/70 p-3'>
            <div className='font-semibold text-slate-900'>{bank.bank}</div>
            <div className='mt-1 text-xs text-slate-600'>
              Paybill <strong>{bank.paybill}</strong> &middot; Account{' '}
              <strong className='uppercase'>{bank.account}</strong>
            </div>
          </li>
        ))}
      </ul>
      {order && (
        <div className='mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-xs text-emerald-900'>
          <div className='font-semibold'>Order summary</div>
          <div>Reference: {order.id}</div>
          <div>Status: {order.status}</div>
          <div>Per truck: KES {order.perTruck.toLocaleString()}</div>
          <div>Total: KES {order.total.toLocaleString()}</div>
          <div>
            Distance:{' '}
            {Number.isFinite(order.distanceKm)
              ? `~${Math.round(order.distanceKm)} km (${distanceLabel})`
              : 'n/a'}
          </div>
        </div>
      )}
    </div>
  );
}

function PaymentForm({
  disabled,
  payment,
  onChange,
  onSubmit,
  status,
}: {
  disabled: boolean;
  payment: { method: string; reference: string; message: string };
  onChange: (payment: { method: string; reference: string; message: string }) => void;
  onSubmit: (e: React.FormEvent) => void;
  status: { kind: 'idle' | 'success' | 'error'; message: string };
}) {
  return (
    <form
      onSubmit={onSubmit}
      className='rounded-3xl border border-amber-100 bg-white p-6 shadow-sm text-sm disabled:opacity-60'
    >
      <h2 className='text-lg font-semibold text-slate-900'>3. Share payment confirmation</h2>
      <div className='mt-3 space-y-3'>
        <label className='block text-xs font-semibold uppercase tracking-wide text-slate-500'>
          Bank used
          <select
            value={payment.method}
            onChange={(e) => onChange({ ...payment, method: e.target.value })}
            disabled={disabled}
            className='mt-1 w-full rounded-lg border border-slate-200 px-3 py-2'
          >
            {BANK_OPTIONS.map((bank) => (
              <option key={bank.bank} value={bank.bank}>
                {bank.bank}
              </option>
            ))}
          </select>
        </label>
        <label className='block text-xs font-semibold uppercase tracking-wide text-slate-500'>
          Transaction reference / message
          <input
            value={payment.reference}
            onChange={(e) => onChange({ ...payment, reference: e.target.value })}
            disabled={disabled}
            className='mt-1 w-full rounded-lg border border-slate-200 px-3 py-2'
            placeholder='e.g. MPESA QYZ123ABC'
            required
          />
        </label>
        <label className='block text-xs font-semibold uppercase tracking-wide text-slate-500'>
          Additional notes (optional)
          <textarea
            value={payment.message}
            onChange={(e) => onChange({ ...payment, message: e.target.value })}
            disabled={disabled}
            className='mt-1 w-full rounded-lg border border-slate-200 px-3 py-2'
            rows={3}
            placeholder='Site manager contact, upload reference, etc.'
          />
        </label>
        {status.kind !== 'idle' && (
          <div
            className={`flex items-center gap-2 rounded-2xl px-4 py-2 text-xs ${
              status.kind === 'success'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-rose-50 text-rose-600'
            }`}
          >
            {status.kind === 'success' ? <CheckCircle className='h-4 w-4' /> : <AlertCircle className='h-4 w-4' />}
            {status.message}
          </div>
        )}
        <button
          type='submit'
          disabled={disabled}
          className='group flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60'
        >
          Send confirmation <ArrowRight className='h-4 w-4 transition group-hover:translate-x-1' />
        </button>
      </div>
    </form>
  );
}


