import React, { useEffect, useState } from 'react';
import { api } from '../api';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Mail,
  RefreshCcw,
  SendHorizontal,
} from 'lucide-react';

type Recipient = {
  id: number;
  name: string;
  email: string;
  role: string;
  telegramChatId: string;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type EmailNotification = {
  id: string;
  email: string;
  subject: string;
  status: string;
  attempts: number;
  created_at: string;
  sent_at?: string;
  last_error?: string;
  last_attempt_at?: string;
  next_attempt_at?: string;
};

export default function AdminNotificationSettings() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [botConfigured, setBotConfigured] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [emailSummary, setEmailSummary] = useState<{ host: string | null; service: string | null; from: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<Record<number, SaveState>>({});
  const [queue, setQueue] = useState<EmailNotification[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchMessage, setDispatchMessage] = useState<string | null>(null);

  useEffect(() => {
    refreshAll();
  }, []);

  async function refreshAll() {
    await Promise.all([loadRecipients(), loadQueue()]);
  }

  async function loadRecipients() {
    try {
      setLoading(true);
      const res = await api.get('/api/admin/notification-targets');
      setRecipients(res.data?.recipients || []);
      setBotConfigured(Boolean(res.data?.botConfigured));
      setEmailConfigured(Boolean(res.data?.emailConfigured));
      setEmailSummary(
        res.data?.email
          ? {
              host: res.data.email.host ?? null,
              service: res.data.email.service ?? null,
              from: res.data.email.from ?? null,
            }
          : null
      );
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load Telegram targets.');
    } finally {
      setLoading(false);
    }
  }

  async function loadQueue() {
    try {
      setQueueLoading(true);
      const res = await api.get('/api/admin/notifications', { params: { limit: 50 } });
      const rows: EmailNotification[] = Array.isArray(res.data) ? res.data : [];
      setQueue(rows);
      setQueueError(null);
    } catch (err: any) {
      setQueueError(err?.response?.data?.error || err?.message || 'Failed to load email queue.');
    } finally {
      setQueueLoading(false);
    }
  }

  function updateRecipient(id: number, telegramChatId: string) {
    setRecipients((prev) =>
      prev.map((r) => (r.id === id ? { ...r, telegramChatId } : r))
    );
    setSaveState((prev) => ({ ...prev, [id]: 'idle' }));
  }

  async function saveRecipient(id: number) {
    const recipient = recipients.find((r) => r.id === id);
    if (!recipient) return;
    try {
      setSaveState((prev) => ({ ...prev, [id]: 'saving' }));
      const res = await api.put(`/api/admin/notification-targets/${id}`, {
        telegramChatId: recipient.telegramChatId || '',
      });
      const updated = res.data?.recipient;
      if (updated) {
        setRecipients((prev) =>
          prev.map((r) => (r.id === id ? { ...r, telegramChatId: updated.telegramChatId || '' } : r))
        );
      }
      setSaveState((prev) => ({ ...prev, [id]: 'saved' }));
      setTimeout(() => {
        setSaveState((prev) => ({ ...prev, [id]: 'idle' }));
      }, 2500);
    } catch (err: any) {
      setSaveState((prev) => ({ ...prev, [id]: 'error' }));
    }
  }

  async function dispatchQueue() {
    try {
      setDispatching(true);
      setDispatchMessage(null);
      const res = await api.post('/api/admin/notifications/dispatch', { limit: 25 });
      const summary = res.data || {};
      if (summary.skipped && summary.reason === 'email-not-configured') {
        setDispatchMessage('Email delivery is not configured yet.');
      } else if (summary.skipped && summary.reason === 'busy') {
        setDispatchMessage('Dispatcher is already running. Try again shortly.');
      } else {
        const sent = Number(summary.sent || 0);
        const failures = Number(summary.failures || 0);
        const remaining = Number(summary.remaining ?? 0);
        const messageParts = [];
        if (sent > 0) messageParts.push(`Sent ${sent} email${sent === 1 ? '' : 's'}`);
        if (failures > 0) messageParts.push(`${failures} failed`);
        if (!messageParts.length) messageParts.push('No queued emails to dispatch.');
        if (remaining > 0) messageParts.push(`${remaining} still pending`);
        setDispatchMessage(messageParts.join('. '));
      }
      await loadQueue();
    } catch (err: any) {
      setDispatchMessage(err?.response?.data?.error || err?.message || 'Failed to dispatch notifications.');
    } finally {
      setDispatching(false);
    }
  }

  const statusClasses: Record<string, string> = {
    QUEUED: 'bg-amber-100 text-amber-700',
    RETRY: 'bg-orange-100 text-orange-700',
    SENDING: 'bg-slate-200 text-slate-700',
    SENT: 'bg-emerald-100 text-emerald-700',
    FAILED: 'bg-rose-100 text-rose-700',
  };

  function formatTimestamp(value?: string | null) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  return (
    <section className='rounded-xl border border-slate-200 bg-white p-5'>
      <div className='flex items-center justify-between'>
        <h2 className='text-sm font-semibold text-slate-900'>Telegram alert routing</h2>
        <button
          onClick={refreshAll}
          className='inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700'
        >
          <RefreshCcw className='h-3 w-3' />
          Refresh
        </button>
      </div>

      {!botConfigured && (
        <div className='mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800'>
          <AlertCircle className='h-4 w-4 flex-none' />
          <span>
            Set the <code>TELEGRAM_BOT_TOKEN</code> environment variable and restart the server. Use @BotFather to
            create a bot, start a chat with it, and send a message so you can copy the numeric chat ID from
            <code>@userinfobot</code> (people) or the <code>-100...</code> id (groups).
          </span>
        </div>
      )}

      {loading && (
        <div className='mt-4 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600'>
          <Loader2 className='h-4 w-4 animate-spin' /> Loading recipients…
        </div>
      )}

      {error && !loading && (
        <div className='mt-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-600'>
          <AlertCircle className='h-4 w-4 flex-none' />
          {error}
        </div>
      )}

      {!loading && !error && recipients.length === 0 && (
        <p className='mt-3 text-xs text-slate-500'>
          No admin or ops accounts found yet. Create an admin user to add Telegram routing.
        </p>
      )}

      {!loading && !error && recipients.length > 0 && (
        <div className='mt-4 overflow-auto'>
          <table className='min-w-full text-sm'>
            <thead className='bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500'>
              <tr>
                <th className='px-3 py-2'>User</th>
                <th className='px-3 py-2'>Role</th>
                <th className='px-3 py-2'>Telegram chat id</th>
                <th className='px-3 py-2 text-right'>Actions</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((recipient) => {
                const state = saveState[recipient.id] || 'idle';
                return (
                  <tr key={recipient.id} className='border-t'>
                    <td className='px-3 py-2'>
                      <div className='font-medium text-slate-900'>{recipient.name}</div>
                      <div className='text-xs text-slate-500'>{recipient.email}</div>
                    </td>
                    <td className='px-3 py-2'>
                      <span className='rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700'>
                        {recipient.role}
                      </span>
                    </td>
                    <td className='px-3 py-2'>
                      <input
                        value={recipient.telegramChatId || ''}
                        onChange={(e) => updateRecipient(recipient.id, e.target.value)}
                        placeholder='Enter numeric chat id'
                        className='w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none'
                      />
                      <p className='mt-1 text-[11px] text-slate-400'>
                        DM your bot, then forward the reply from @userinfobot or use group ID (starts with -100).
                      </p>
                    </td>
                    <td className='px-3 py-2 text-right'>
                      <button
                        onClick={() => saveRecipient(recipient.id)}
                        className='inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60'
                        disabled={state === 'saving'}
                      >
                        {state === 'saving' ? (
                          <Loader2 className='h-3.5 w-3.5 animate-spin' />
                        ) : state === 'saved' ? (
                          <CheckCircle className='h-3.5 w-3.5 text-emerald-300' />
                        ) : state === 'error' ? (
                          <AlertCircle className='h-3.5 w-3.5 text-rose-300' />
                        ) : (
                          <SendHorizontal className='h-3.5 w-3.5' />
                        )}
                        Save
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className='mt-6 border-t border-slate-200 pt-5'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <h3 className='text-sm font-semibold text-slate-900'>Email notifications</h3>
          <div className='flex flex-wrap items-center gap-2'>
            <button
              onClick={loadQueue}
              className='inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-amber-400 hover:text-amber-600 disabled:opacity-60'
              disabled={queueLoading}
            >
              {queueLoading ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <RefreshCcw className='h-3.5 w-3.5' />}
              Refresh queue
            </button>
            <button
              onClick={dispatchQueue}
              className='inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60'
              disabled={!emailConfigured || dispatching}
            >
              {dispatching ? <Loader2 className='h-3.5 w-3.5 animate-spin' /> : <SendHorizontal className='h-3.5 w-3.5' />}
              Send pending
            </button>
          </div>
        </div>

        {emailConfigured ? (
          <div className='mt-3 flex items-start gap-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600'>
            <Mail className='h-4 w-4 text-slate-500' />
            <div>
              <div>From: {emailSummary?.from || 'not set'}</div>
              {emailSummary?.service ? (
                <div>Service: {emailSummary.service}</div>
              ) : (
                <div>Host: {emailSummary?.host || 'not set'}</div>
              )}
            </div>
          </div>
        ) : (
          <div className='mt-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-600'>
            <AlertTriangle className='h-4 w-4 flex-none' />
            <span>
              Configure SMTP credentials in the server environment (<code>SMTP_HOST</code>/<code>SMTP_PORT</code> or
              <code>SMTP_URL</code>) plus <code>SMTP_USER</code>/<code>SMTP_PASS</code> if needed, then restart the
              server.
            </span>
          </div>
        )}

        {dispatchMessage && (
          <div className='mt-3 rounded-lg bg-slate-100 p-3 text-xs text-slate-600'>{dispatchMessage}</div>
        )}

        {queueLoading && (
          <div className='mt-3 flex items-center gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600'>
            <Loader2 className='h-4 w-4 animate-spin' /> Checking email queue...
          </div>
        )}

        {queueError && !queueLoading && (
          <div className='mt-3 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-600'>
            <AlertCircle className='h-4 w-4 flex-none' />
            {queueError}
          </div>
        )}

        {!queueLoading && !queueError && queue.length === 0 && (
          <p className='mt-3 text-xs text-slate-500'>No email notifications queued.</p>
        )}

        {!queueLoading && !queueError && queue.length > 0 && (
          <div className='mt-3 overflow-auto'>
            <table className='min-w-full text-sm'>
              <thead className='bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500'>
                <tr>
                  <th className='px-3 py-2'>Subject</th>
                  <th className='px-3 py-2'>Recipient</th>
                  <th className='px-3 py-2'>Status</th>
                  <th className='px-3 py-2'>Attempts</th>
                  <th className='px-3 py-2'>Last update</th>
                  <th className='px-3 py-2'>Next attempt</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((item) => {
                  const status = (item.status || '').toUpperCase();
                  const badgeClass = statusClasses[status] || 'bg-slate-200 text-slate-700';
                  return (
                    <tr key={item.id} className='border-t'>
                      <td className='px-3 py-2'>
                        <div className='font-medium text-slate-900'>{item.subject}</div>
                        <div className='text-[11px] text-slate-500'>Queued {formatTimestamp(item.created_at)}</div>
                        {item.last_error && (
                          <div className='mt-1 text-[11px] text-rose-600'>Last error: {item.last_error}</div>
                        )}
                      </td>
                      <td className='px-3 py-2 text-xs text-slate-600'>{item.email}</td>
                      <td className='px-3 py-2'>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>
                          {status}
                        </span>
                      </td>
                      <td className='px-3 py-2 text-xs text-slate-600'>{item.attempts ?? 0}</td>
                      <td className='px-3 py-2 text-xs text-slate-500'>
                        {item.sent_at
                          ? `Sent ${formatTimestamp(item.sent_at)}`
                          : item.last_attempt_at
                          ? `Tried ${formatTimestamp(item.last_attempt_at)}`
                          : 'Pending'}
                      </td>
                      <td className='px-3 py-2 text-xs text-slate-500'>
                        {item.next_attempt_at
                          ? formatTimestamp(item.next_attempt_at)
                          : status === 'FAILED'
                          ? '-'
                          : 'Immediate'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
