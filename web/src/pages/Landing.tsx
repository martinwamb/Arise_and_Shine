import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Calculator,
  CheckCircle,
  MapPin,
  MessageCircle,
  Phone,
  Send,
} from 'lucide-react';
import { api } from '../api';
import { BANK_OPTIONS } from '../constants/payment';

type Article = {
  id: string;
  title: string;
  summary?: string;
  imageUrl?: string;
  createdAt: string;
};

type PricingGuide = {
  basePrice: number;
  baseDistanceKm: number;
  incrementKm: number;
  incrementAmount: number;
};

type Quote = {
  perTruck: number;
  total: number;
  distanceKm: number;
  sandType: string;
  truckCount: number;
  distanceSource?: string;
};

type LandingOrderForm = {
  name: string;
  phone: string;
  email: string;
  site: string;
  sandType: 'coarse' | 'smooth';
  trucks: number;
  distanceKm: string;
  dateNeeded: string;
};

type OrderSummary = {
  id: string;
  status: string;
  perTruck: number;
  total: number;
  distanceKm: number;
  distanceSource?: string;
  truckCount: number;
  sandType: string;
};

type LandingAccountResponse = {
  token: string;
  user: { id: number; email: string; name: string; role: string; driverId?: number | null };
  created?: boolean;
} | null;

const CONTACT_PHONE = '0728885783';
const CONTACT_EMAIL = 'wambugujusk@gmail.com';
const INITIAL_FORM: LandingOrderForm = {
  name: '',
  phone: '',
  email: '',
  site: '',
  sandType: 'coarse',
  trucks: 2,
  distanceKm: '',
  dateNeeded: '',
};

export default function Landing() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [pricingInfo, setPricingInfo] = useState<PricingGuide | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'idle' | 'success' | 'error'; message: string }>({
    kind: 'idle',
    message: '',
  });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<LandingOrderForm>(INITIAL_FORM);
  const [orderContact, setOrderContact] = useState<LandingOrderForm | null>(null);
  const [createAccount, setCreateAccount] = useState(false);
  const [accountPassword, setAccountPassword] = useState('');
  const [accountConfirm, setAccountConfirm] = useState('');
  const [orderSummary, setOrderSummary] = useState<OrderSummary | null>(null);
  const [accountInfo, setAccountInfo] = useState<LandingAccountResponse>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        setLoading(true);
        const [pricingRes, articleRes] = await Promise.all([
          api.get('/api/pricing'),
          api.get('/api/articles', { params: { limit: 3 } }),
        ]);
        if (!ignore) {
          setPricingInfo(pricingRes.data);
          if (Array.isArray(articleRes.data)) setArticles(articleRes.data);
        }
      } catch (err) {
        console.warn('Landing bootstrap failed', err);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

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
          trucks: form.trucks,
          sandType: form.sandType,
          distanceKm: form.distanceKm ? Number(form.distanceKm) : undefined,
        });
        if (!cancelled) {
          setQuote(res.data);
          setQuoteError(null);
        }
      } catch (err: any) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(err?.response?.data?.error || 'Could not refresh quote right now.');
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [form.site, form.trucks, form.sandType, form.distanceKm]);

  const trucksOptions = useMemo(() => Array.from({ length: 20 }).map((_, idx) => idx + 1), []);
  const quoteDistanceLabel = quote ? DISTANCE_SOURCE_LABELS[quote.distanceSource ?? ''] || 'estimated' : 'estimated';

  async function submitQuickOrder(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: 'idle', message: '' });
    if (createAccount) {
      if (!form.email.trim()) {
        setStatus({ kind: 'error', message: 'Email is required to create your portal login.' });
        return;
      }
      if (accountPassword !== accountConfirm) {
        setStatus({ kind: 'error', message: 'Passwords do not match.' });
        return;
      }
      if (accountPassword.trim().length < 8) {
        setStatus({ kind: 'error', message: 'Password must be at least 8 characters long.' });
        return;
      }
    }
    try {
      const payload: any = {
        ...form,
        distanceKm: form.distanceKm ? Number(form.distanceKm) : undefined,
      };
      if (createAccount) {
        payload.account = { password: accountPassword.trim() };
      }
      const res = await api.post('/api/orders/guest', payload);
      const summary: OrderSummary = {
        id: res.data.id,
        status: res.data.status,
        perTruck: Number(res.data.perTruck),
        total: Number(res.data.total),
        distanceKm: Number(res.data.distanceKm),
        distanceSource: res.data.distanceSource,
        truckCount: Number(res.data.truckCount ?? form.trucks),
        sandType: res.data.sandType ?? form.sandType,
      };
      setOrderSummary(summary);
      setOrderContact(form);
      if (res.data?.account?.token && res.data?.account?.user) {
        localStorage.setItem('token', res.data.account.token);
        localStorage.setItem('role', res.data.account.user.role);
        localStorage.setItem('userName', res.data.account.user.name || '');
        localStorage.setItem('userEmail', res.data.account.user.email || '');
        localStorage.removeItem('driverId');
        setAccountInfo(res.data.account);
      } else {
        setAccountInfo(null);
      }
      setStatus({
        kind: 'success',
        message: 'Order placed! Review MPESA paybill options below to complete payment.',
      });
      setForm(INITIAL_FORM);
      setCreateAccount(false);
      setAccountPassword('');
      setAccountConfirm('');
      setQuote(null);
      setQuoteError(null);
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || 'Failed to submit order. Please try again.',
      });
    }
  }

  function resetOrderFlow() {
    setOrderSummary(null);
    setOrderContact(null);
    setAccountInfo(null);
    setStatus({ kind: 'idle', message: '' });
    setCreateAccount(false);
    setAccountPassword('');
    setAccountConfirm('');
    setForm(INITIAL_FORM);
    setQuote(null);
    setQuoteError(null);
  }

  return (
    <main className='bg-amber-50 pb-24 text-slate-900'>
      <section className='mx-auto flex max-w-7xl flex-col gap-12 px-4 pt-16 lg:flex-row lg:items-start'>
        <div className='flex-1 space-y-6'>
          <div>
            <span className='inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700'>
              <Calculator className='h-3 w-3' /> Instant quote + logistics control
            </span>
            <h1 className='mt-4 text-4xl font-black tracking-tight text-slate-900 sm:text-5xl lg:text-6xl'>
              Sand logistics that adapts to your site schedule
            </h1>
            <p className='mt-4 max-w-2xl text-lg text-slate-700'>
              Request coarse or smooth sand, confirm payment, and watch dispatch assign trucks - with telemetry,
              fuel logs, and AI briefings keeping your build on track.
            </p>
          </div>
          <div className='grid gap-4 sm:grid-cols-2'>
            <HeroStat
              label='Base price (<=15 km)'
              value={pricingInfo ? `KES ${pricingInfo.basePrice.toLocaleString()}` : 'KES 32,000'}
              detail='Thika - Juja corridor'
            />
            <HeroStat
              label='Distance increments'
              value={pricingInfo ? `+KES ${pricingInfo.incrementAmount.toLocaleString()}` : 'KES 1,000'}
              detail={`Every ${pricingInfo?.incrementKm || 5} km beyond base`}
            />
          </div>
        </div>
        <div className='w-full max-w-md rounded-3xl border border-amber-100 bg-white p-6 shadow-xl'>
          <div className='flex items-center justify-between'>
            <h2 className='text-lg font-semibold text-slate-900'>Get a same-day quote</h2>
            <MapPin className='h-5 w-5 text-amber-500' />
          </div>
          <p className='mt-1 text-xs text-slate-500'>
            Pricing adjusts automatically based on site distance and sand type. Each truck carries 20 tonnes.
          </p>
          {orderSummary ? (
            <OrderSuccessPanel
              summary={orderSummary}
              contact={orderContact}
              status={status}
              accountInfo={accountInfo}
              onNewOrder={resetOrderFlow}
            />
          ) : (
            <form onSubmit={submitQuickOrder} className='mt-4 space-y-3 text-sm'>
              <div className='grid gap-3 sm:grid-cols-2'>
                <TextInput
                  label='Name'
                  value={form.name}
                  onChange={(value) => setForm((p) => ({ ...p, name: value }))}
                />
                <TextInput
                  label='Phone'
                  value={form.phone}
                  onChange={(value) => setForm((p) => ({ ...p, phone: value }))}
                  placeholder='07XX...'
                />
                <TextInput
                  label='Email'
                  type='email'
                  value={form.email}
                  onChange={(value) => setForm((p) => ({ ...p, email: value }))}
                  placeholder='you@site.co.ke'
                />
                <TextInput
                  label='Date needed'
                  type='date'
                  value={form.dateNeeded}
                  onChange={(value) => setForm((p) => ({ ...p, dateNeeded: value }))}
                />
              </div>
              <TextInput
                label='Site location'
                value={form.site}
                onChange={(value) => setForm((p) => ({ ...p, site: value }))}
                placeholder='e.g. Juja South Estate, Gate B'
                required
              />
              <div className='grid gap-3 sm:grid-cols-2'>
                <label className='block text-xs font-semibold uppercase tracking-wide text-slate-500'>
                  Sand type
                  <select
                    className='mt-1 w-full rounded-lg border border-slate-200 px-3 py-2'
                    value={form.sandType}
                    onChange={(e) => setForm((p) => ({ ...p, sandType: e.target.value as 'coarse' | 'smooth' }))}
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
                    {trucksOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt} truck{opt > 1 ? 's' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <TextInput
                label='Distance estimate (km)'
                value={form.distanceKm}
                onChange={(value) => setForm((p) => ({ ...p, distanceKm: value }))}
                placeholder='Optional - we infer from site if blank'
              />
              <div className='rounded-2xl border border-amber-100 bg-amber-50/40 px-3 py-3 text-xs text-slate-600'>
                <div className='font-semibold text-slate-700'>Track this order online?</div>
                <p className='mt-1 leading-relaxed'>
                  Create a customer login so you can upload payment confirmations, view dispatch updates, and repeat
                  orders without retyping details.
                </p>
                <label className='mt-3 flex items-center gap-2 font-semibold text-slate-700'>
                  <input
                    type='checkbox'
                    checked={createAccount}
                    onChange={(e) => setCreateAccount(e.target.checked)}
                    className='h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500'
                  />
                  Create portal login now (optional)
                </label>
              </div>
              {createAccount && (
                <div className='grid gap-3 sm:grid-cols-2'>
                  <TextInput
                    label='Create password'
                    type='password'
                    value={accountPassword}
                    onChange={setAccountPassword}
                    placeholder='Min 8 characters'
                  />
                  <TextInput
                    label='Confirm password'
                    type='password'
                    value={accountConfirm}
                    onChange={setAccountConfirm}
                  />
                </div>
              )}
              {quote && (
                <div className='rounded-2xl bg-emerald-50 px-4 py-3 text-xs text-emerald-900'>
                  <div className='flex items-center gap-2 text-sm font-semibold'>
                    <CheckCircle className='h-4 w-4' /> Quote ready
                  </div>
                  <ul className='mt-2 space-y-1'>
                    <li>
                      Per truck: <strong>KES {quote.perTruck.toLocaleString()}</strong>
                    </li>
                    <li>
                      Total ({quote.truckCount} truck{quote.truckCount > 1 ? 's' : ''}):
                      <strong className='ml-1'>KES {quote.total.toLocaleString()}</strong>
                    </li>
                    <li>
                      Distance basis:{' '}
                      <strong>
                        {Math.round(quote.distanceKm)} km ({quoteDistanceLabel})
                      </strong>
                    </li>
                  </ul>
                </div>
              )}
              {quoteError && (
                <div className='flex items-center gap-2 rounded-2xl bg-rose-50 px-4 py-2 text-xs text-rose-600'>
                  <AlertCircle className='h-4 w-4' /> {quoteError}
                </div>
              )}
              {status.kind === 'error' && (
                <div className='flex items-center gap-2 rounded-2xl bg-rose-50 px-4 py-2 text-xs text-rose-600'>
                  <AlertCircle className='h-4 w-4' /> {status.message}
                </div>
              )}
              <button
                type='submit'
                className='group flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-800'
              >
                Place order &amp; view payment <ArrowRight className='h-4 w-4 transition group-hover:translate-x-1' />
              </button>
              <p className='text-[11px] text-slate-500'>
                You will see secure MPESA paybill options immediately after submitting.
              </p>
            </form>
          )}
        </div>
      </section>

      <section className='mx-auto max-w-7xl px-4 pb-20 pt-10'>
        <div className='grid gap-8 lg:grid-cols-[1.6fr_1fr]'>
          <div className='space-y-6 rounded-3xl border border-amber-100 bg-white p-6 shadow-sm'>
            <h2 className='text-2xl font-bold text-slate-900'>Why contractors pick Arise &amp; Shine</h2>
            <ul className='space-y-4 text-sm text-slate-700'>
              <FeatureItem
                title='Telemetry & fuel transparency'
                description='Every truck is tracked in real time with matching fuel logs - see litres, odometer, cost, and photo proof directly in the portal.'
              />
              <FeatureItem
                title='Dynamic pricing that matches distance'
                description='Start at KES 32,000 per truck (<=15 km). Each 5 km adds KES 1,000 automatically, so quotes stay predictable as projects move outward.'
              />
              <FeatureItem
                title='Coarse & smooth stock management'
                description='Stock is managed in truck loads (20 tonnes each) with separate coarse/smooth balances and automatic deductions when dispatch assigns loads.'
              />
            </ul>
            <Link
              to='/register'
              className='inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800'
            >
              Create customer login <ArrowRight className='h-4 w-4' />
            </Link>
          </div>
          <div className='space-y-6'>
            <ArticlesSection articles={articles} loading={loading} />
            <ContactSection />
          </div>
        </div>
      </section>

      <ChatbotWidget quote={quote} pricing={pricingInfo} />
    </main>
  );
}

function HeroStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className='rounded-2xl border border-amber-100 bg-white/80 p-4 shadow'>
      <div className='text-xs font-semibold uppercase tracking-wide text-amber-600'>{label}</div>
      <div className='mt-2 text-2xl font-bold text-slate-900'>{value}</div>
      <div className='mt-1 text-xs text-slate-500'>{detail}</div>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className='block text-xs font-semibold uppercase tracking-wide text-slate-500'>
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className='mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 focus:border-amber-500 focus:outline-none'
      />
    </label>
  );
}

function OrderSuccessPanel({
  summary,
  contact,
  status,
  accountInfo,
  onNewOrder,
}: {
  summary: OrderSummary;
  contact: LandingOrderForm | null;
  status: { kind: 'idle' | 'success' | 'error'; message: string };
  accountInfo: LandingAccountResponse;
  onNewOrder: () => void;
}) {
  const distanceLabel = DISTANCE_SOURCE_LABELS[summary.distanceSource ?? ''] || 'estimated';
  const trucksLabel = summary.truckCount === 1 ? 'truck' : 'trucks';
  const paymentBlurb =
    'Use any paybill below. Enter the account exactly as shown, then upload the MPESA/RTGS confirmation in the portal so dispatch can mobilise trucks.';
  return (
    <div className='mt-4 space-y-4 text-sm'>
      {status.kind === 'success' && (
        <div className='flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800'>
          <CheckCircle className='h-4 w-4' /> {status.message}
        </div>
      )}
      <div className='rounded-2xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-xs text-emerald-900'>
        <div className='text-sm font-semibold text-emerald-900'>Order {summary.id} captured</div>
        <ul className='mt-2 space-y-1'>
          <li>
            {summary.truckCount} {trucksLabel} of {summary.sandType} sand &middot;{' '}
            <strong>KES {summary.total.toLocaleString()}</strong> total ({summary.perTruck.toLocaleString()} per truck)
          </li>
          <li>
            Distance basis: {Math.round(summary.distanceKm)} km ({distanceLabel})
          </li>
          {contact?.site && <li>Site: {contact.site}</li>}
          {contact?.dateNeeded && <li>Needed: {new Date(contact.dateNeeded).toLocaleDateString()}</li>}
          {contact?.phone && <li>Contact: {contact.name || 'Customer'} &middot; {contact.phone}</li>}
        </ul>
      </div>
      <div className='rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-4 text-xs text-slate-700'>
        <div className='text-sm font-semibold text-slate-900'>Payment options (MPESA paybill / bank)</div>
        <p className='mt-2 leading-relaxed'>{paymentBlurb}</p>
        <ul className='mt-3 space-y-2'>
          {BANK_OPTIONS.map((bank) => (
            <li
              key={bank.bank}
              className='flex flex-col gap-1 rounded-xl bg-white/80 px-3 py-2 text-slate-800 sm:flex-row sm:items-center sm:justify-between'
            >
              <span className='font-semibold text-slate-900'>{bank.bank}</span>
              <span>
                Paybill <strong>{bank.paybill}</strong> &middot; Account <strong>{bank.account}</strong>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className='rounded-2xl border border-slate-200 bg-white px-4 py-4 text-xs text-slate-600'>
        <div className='text-sm font-semibold text-slate-900'>
          {accountInfo ? 'Portal login ready' : 'Set up portal access'}
        </div>
        {accountInfo ? (
          <p className='mt-2 leading-relaxed'>
            You are signed in as <strong>{accountInfo.user.email}</strong>. Open the customer portal to share payment
            confirmations and follow dispatch updates for this order.
          </p>
        ) : (
          <p className='mt-2 leading-relaxed'>
            Register with {contact?.email || 'the same email'} to track this order online, or log in if you already
            have a customer account.
          </p>
        )}
        <div className='mt-3 flex flex-col gap-2 sm:flex-row'>
          {accountInfo ? (
            <Link
              to='/customer'
              className='inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-white hover:bg-slate-800'
            >
              Open customer portal
            </Link>
          ) : (
            <>
              <Link
                to='/register'
                className='inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-white hover:bg-slate-800'
              >
                Create login
              </Link>
              <Link
                to='/login'
                className='inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-100'
              >
                Log in
              </Link>
            </>
          )}
          <button
            onClick={onNewOrder}
            className='inline-flex items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-100'
          >
            Place another order
          </button>
        </div>
      </div>
    </div>
  );
}

function ArticlesSection({ articles, loading }: { articles: Article[]; loading: boolean }) {
  if (loading && articles.length === 0) {
    return (
      <div id='articles' className='rounded-3xl border border-amber-100 bg-white p-6 text-sm text-slate-600'>
        Fetching the latest build insights...
      </div>
    );
  }

  return (
    <section id='articles' className='rounded-3xl border border-amber-100 bg-white p-6 shadow-sm'>
      <div className='flex items-center justify-between'>
        <h2 className='flex items-center gap-2 text-lg font-semibold text-slate-900'>
          <BookOpen className='h-5 w-5 text-amber-500' />
          Project insights
        </h2>
        <Link to='/articles' className='text-xs text-amber-600 hover:underline'>
          View all articles
        </Link>
      </div>
      <div className='mt-4 grid gap-4'>
        {articles.map((article) => (
          <article key={article.id} className='flex gap-4 rounded-2xl border border-amber-50 bg-amber-50/50 p-4'>
            <div className='hidden h-20 w-24 flex-none overflow-hidden rounded-xl bg-amber-100 sm:block'>
              {article.imageUrl ? (
                <img src={article.imageUrl} alt={article.title} className='h-full w-full object-cover' />
              ) : (
                <div className='flex h-full items-center justify-center text-xs text-amber-500'>Sand insights</div>
              )}
            </div>
            <div className='flex-1 text-sm'>
              <h3 className='font-semibold text-slate-900'>{article.title}</h3>
              <p className='mt-1 text-slate-600'>{article.summary || 'Daily AI briefing generated at 5:20am.'}</p>
              <div className='mt-2 text-xs text-slate-500'>
                {new Date(article.createdAt).toLocaleString()}
              </div>
            </div>
          </article>
        ))}
        {articles.length === 0 && (
          <div className='rounded-xl border border-dashed border-amber-200 p-4 text-xs text-slate-500'>
            Check back tomorrow for AI-authored build briefings.
          </div>
        )}
      </div>
    </section>
  );
}

function ContactSection() {
  return (
    <section className='rounded-3xl border border-amber-100 bg-white p-6 shadow-sm'>
      <h2 className='flex items-center gap-2 text-lg font-semibold text-slate-900'>
        <Phone className='h-5 w-5 text-amber-500' /> Talk to dispatch
      </h2>
      <ul className='mt-4 space-y-3 text-sm'>
        <li>
          <strong>Call:</strong>{' '}
          <a className='text-amber-600 hover:underline' href={`tel:${CONTACT_PHONE}`}>
            {CONTACT_PHONE}
          </a>
        </li>
        <li>
          <strong>Email:</strong>{' '}
          <a className='text-amber-600 hover:underline' href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </li>
        <li>
          <strong>WhatsApp:</strong>{' '}
          <a
            className='text-amber-600 hover:underline'
            href={`https://wa.me/254${CONTACT_PHONE.slice(1)}?text=Hello%20Arise%20%26%20Shine,%20I%20need%20a%20sand%20delivery%20quote.`}
            target='_blank'
            rel='noreferrer'
          >
            Chat now
          </a>
        </li>
      </ul>
      <p className='mt-4 text-xs text-slate-500'>
        Dispatch operates 06:30 - 19:00 daily. Overnight pours are available on request.
      </p>
    </section>
  );
}

function FeatureItem({ title, description }: { title: string; description: string }) {
  return (
    <li className='rounded-2xl border border-amber-50 bg-amber-50/70 p-4'>
      <div className='text-sm font-semibold text-slate-900'>{title}</div>
      <p className='mt-1 text-xs text-slate-600'>{description}</p>
    </li>
  );
}

function ChatbotWidget({ quote, pricing }: { quote: Quote | null; pricing: PricingGuide | null }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ from: 'bot' | 'user'; text: string }[]>([
    {
      from: 'bot',
      text:
        'Hi! I am the Arise & Shine assistant. Ask me about pricing, payment confirmation, truck telemetry, or stock levels.',
    },
  ]);
  const [loadingReply, setLoadingReply] = useState(false);
  const scrollAnchor = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      scrollAnchor.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loadingReply, open]);

  const context = quote
    ? `Latest quote context: ${quote.truckCount} truck(s) headed approximately ${Math.round(
        quote.distanceKm
      )} km (${quote.distanceSource || 'estimated'}) at KES ${quote.perTruck.toLocaleString()} per truck (total KES ${quote.total.toLocaleString()}).`
    : pricing
    ? `Pricing guide: base price KES ${pricing.basePrice.toLocaleString()} within ${pricing.baseDistanceKm} km. Every ${pricing.incrementKm} km adds KES ${pricing.incrementAmount.toLocaleString()}.`
    : '';

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loadingReply) return;

    const nextConversation = [...messages, { from: 'user', text: question }];
    setMessages(nextConversation);
    setInput('');
    setLoadingReply(true);
    try {
      const payload = nextConversation.map((msg) => ({
        role: msg.from === 'bot' ? 'assistant' : 'user',
        content: msg.text,
      }));
      const res = await api.post('/api/chatbot', {
        messages: payload,
        context,
      });
      const answer =
        res.data?.answer?.trim() ||
        'I could not reach the assistant right now. Please call 0728885783 for immediate support.';
      setMessages((prev) => [...prev, { from: 'bot', text: answer }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          from: 'bot',
          text: 'Sorry, I could not reach the assistant right now. Kindly retry or call 0728885783.',
        },
      ]);
    } finally {
      setLoadingReply(false);
    }
  }

  return (
    <div className='fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3'>
      {open && (
        <div className='w-full max-w-sm rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-2xl backdrop-blur'>
          <div className='mb-2 flex items-center justify-between'>
            <div className='flex items-center gap-2 text-sm font-semibold text-slate-900'>
              <MessageCircle className='h-4 w-4 text-amber-500' /> Ask dispatch
            </div>
            <button
              onClick={() => setOpen(false)}
              className='rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100'
            >
              Close
            </button>
          </div>
          <div className='max-h-64 space-y-2 overflow-y-auto text-xs text-slate-700'>
            {messages.map((msg, idx) => (
              <div
                key={`${msg.from}-${idx}`}
                className={`rounded-2xl px-3 py-2 ${
                  msg.from === 'bot'
                    ? 'bg-amber-50 text-amber-900'
                    : 'ml-auto bg-slate-900 text-white'
                }`}
              >
                {msg.text}
              </div>
            ))}
            {loadingReply && (
              <div className='rounded-2xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800'>
                Assistant is typing...
              </div>
            )}
            <div ref={scrollAnchor} />
          </div>
          <form onSubmit={sendMessage} className='mt-3 flex items-center gap-2'>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className='flex-1 rounded-full border border-slate-200 px-3 py-2 text-xs focus:border-amber-500 focus:outline-none'
              placeholder='Ask about pricing, status, payment...'
              disabled={loadingReply}
            />
            <button
              type='submit'
              disabled={loadingReply}
              className='inline-flex items-center justify-center rounded-full bg-slate-900 p-2 text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60'
            >
              <Send className='h-4 w-4' />
            </button>
          </form>
        </div>
      )}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className='inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-slate-800'
      >
        <MessageCircle className='h-4 w-4' />
        Chat with us
      </button>
    </div>
  );
}
const DISTANCE_SOURCE_LABELS: Record<string, string> = {
  manual: 'manual distance',
  geocoded: 'geocoded',
  heuristic: 'name heuristic',
  default: 'default estimate',
};
