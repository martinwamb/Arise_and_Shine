import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { AlertCircle, CheckCircle, Loader2, SendHorizontal } from 'lucide-react';

type Recipient = {
  id: number;
  name: string;
  email: string;
  role: string;
  telegramChatId: string;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function AdminNotificationSettings() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [botConfigured, setBotConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<Record<number, SaveState>>({});

  useEffect(() => {
    loadRecipients();
  }, []);

  async function loadRecipients() {
    try {
      setLoading(true);
      const res = await api.get('/api/admin/notification-targets');
      setRecipients(res.data?.recipients || []);
      setBotConfigured(Boolean(res.data?.botConfigured));
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load Telegram targets.');
    } finally {
      setLoading(false);
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

  return (
    <section className='rounded-xl border border-slate-200 bg-white p-5'>
      <div className='flex items-center justify-between'>
        <h2 className='text-sm font-semibold text-slate-900'>Telegram alert routing</h2>
        <button
          onClick={loadRecipients}
          className='text-xs text-slate-500 hover:text-slate-700'
        >
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
    </section>
  );
}
