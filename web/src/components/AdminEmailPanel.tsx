import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type Mailbox = {
  username: string;
  name: string;
  local_part: string;
  domain: string;
  quota: number;
  quota_used: number;
  messages: number;
  active: number;
  last_imap_login: number;
};

type Status = { kind: 'idle' | 'success' | 'error'; message: string };

const WEBMAIL_URL = 'https://mail.ariseandshinetransporters.com/SOGo';
const DOMAIN = 'ariseandshinetransporters.com';

function formatBytes(bytes: number) {
  if (!bytes) return '0 MB';
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function formatLastLogin(ts: number) {
  if (!ts) return 'Never';
  return new Date(ts * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const emptyForm = { local_part: '', name: '', password: '', quota: '1024' };

export default function AdminEmailPanel() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [showCreate, setShowCreate] = useState(false);
  const [editingPw, setEditingPw] = useState<string | null>(null);
  const [newPw, setNewPw] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const res = await api.get('/api/admin/email/mailboxes');
      setMailboxes(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      setStatus({ kind: 'error', message: err?.response?.data?.error || 'Failed to load mailboxes.' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!search) return mailboxes;
    const q = search.toLowerCase();
    return mailboxes.filter(m =>
      m.username.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    );
  }, [mailboxes, search]);

  const totalQuota = mailboxes.reduce((s, m) => s + (m.quota_used || 0), 0);

  async function createMailbox(e: React.FormEvent) {
    e.preventDefault();
    if (!form.local_part || !form.name || form.password.length < 8) {
      setStatus({ kind: 'error', message: 'Fill all fields. Password must be at least 8 characters.' });
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/admin/email/mailboxes', {
        local_part: form.local_part.toLowerCase().trim(),
        name: form.name.trim(),
        password: form.password,
        quota: Number(form.quota) || 1024,
      });
      setStatus({ kind: 'success', message: `${form.local_part}@${DOMAIN} created.` });
      setForm(emptyForm);
      setShowCreate(false);
      await load();
    } catch (err: any) {
      setStatus({ kind: 'error', message: err?.response?.data?.error || 'Failed to create mailbox.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function changePassword(email: string) {
    if (newPw.length < 8) {
      setStatus({ kind: 'error', message: 'Password must be at least 8 characters.' });
      return;
    }
    setSubmitting(true);
    try {
      await api.patch(`/api/admin/email/mailboxes/${encodeURIComponent(email)}`, { password: newPw });
      setStatus({ kind: 'success', message: `Password updated for ${email}.` });
      setEditingPw(null);
      setNewPw('');
    } catch (err: any) {
      setStatus({ kind: 'error', message: err?.response?.data?.error || 'Failed to update password.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteMailbox(email: string) {
    setSubmitting(true);
    try {
      await api.delete(`/api/admin/email/mailboxes/${encodeURIComponent(email)}`);
      setStatus({ kind: 'success', message: `${email} deleted.` });
      setConfirmDelete(null);
      await load();
    } catch (err: any) {
      setStatus({ kind: 'error', message: err?.response?.data?.error || 'Failed to delete mailbox.' });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className='p-6 text-sm text-slate-500'>Loading mailboxes…</div>;

  return (
    <div className='space-y-6 p-4 md:p-6'>

      {/* Header */}
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-lg font-semibold text-slate-800'>Email Management</h2>
          <p className='text-xs text-slate-500 mt-0.5'>{DOMAIN}</p>
        </div>
        <button
          onClick={() => { setShowCreate(!showCreate); setStatus({ kind: 'idle', message: '' }); }}
          className='rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700'
        >
          {showCreate ? 'Cancel' : '+ New Mailbox'}
        </button>
      </div>

      {/* Stats */}
      <div className='grid grid-cols-2 gap-4 md:grid-cols-4'>
        {[
          { label: 'Total Mailboxes', value: mailboxes.length },
          { label: 'Active', value: mailboxes.filter(m => m.active).length },
          { label: 'Storage Used', value: formatBytes(totalQuota) },
          { label: 'Domain', value: DOMAIN.split('.')[0] },
        ].map(s => (
          <div key={s.label} className='rounded-xl border border-slate-200 bg-white p-4'>
            <p className='text-xs text-slate-500'>{s.label}</p>
            <p className='mt-1 text-xl font-semibold text-slate-800'>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Status message */}
      {status.kind !== 'idle' && (
        <div className={`rounded-lg px-4 py-2 text-sm ${
          status.kind === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'
        }`}>
          {status.message}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <form onSubmit={createMailbox} className='rounded-xl border border-slate-200 bg-white p-5 space-y-4'>
          <h3 className='font-medium text-slate-800'>New Mailbox</h3>
          <div className='grid gap-4 md:grid-cols-2'>
            <div>
              <label className='text-xs font-medium text-slate-600'>Username (before @)</label>
              <div className='mt-1 flex rounded-lg border border-slate-300 overflow-hidden'>
                <input
                  className='flex-1 px-3 py-2 text-sm outline-none'
                  placeholder='e.g. logistics'
                  value={form.local_part}
                  onChange={e => setForm(f => ({ ...f, local_part: e.target.value }))}
                />
                <span className='bg-slate-100 px-3 py-2 text-sm text-slate-500'>@{DOMAIN}</span>
              </div>
            </div>
            <div>
              <label className='text-xs font-medium text-slate-600'>Display Name</label>
              <input
                className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none'
                placeholder='Logistics Manager'
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className='text-xs font-medium text-slate-600'>Password (min 8 chars)</label>
              <input
                type='password'
                className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none'
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              />
            </div>
            <div>
              <label className='text-xs font-medium text-slate-600'>Quota (MB)</label>
              <input
                type='number'
                className='mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none'
                value={form.quota}
                onChange={e => setForm(f => ({ ...f, quota: e.target.value }))}
              />
            </div>
          </div>
          <button
            type='submit'
            disabled={submitting}
            className='rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50'
          >
            {submitting ? 'Creating…' : 'Create Mailbox'}
          </button>
        </form>
      )}

      {/* Search */}
      <input
        className='w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none'
        placeholder='Search mailboxes…'
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* Mailbox list */}
      <div className='space-y-3'>
        {filtered.length === 0 && (
          <p className='text-sm text-slate-500 text-center py-8'>No mailboxes found.</p>
        )}
        {filtered.map(m => {
          const usedPct = m.quota > 0 ? Math.round((m.quota_used / m.quota) * 100) : 0;
          const isEditing = editingPw === m.username;
          const isDeleting = confirmDelete === m.username;

          return (
            <div key={m.username} className='rounded-xl border border-slate-200 bg-white p-4'>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <div className='flex items-center gap-2'>
                    <span className='inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700'>
                      {m.name?.[0]?.toUpperCase() || m.local_part?.[0]?.toUpperCase()}
                    </span>
                    <div>
                      <p className='font-medium text-slate-800 text-sm'>{m.name}</p>
                      <p className='text-xs text-slate-500'>{m.username}</p>
                    </div>
                  </div>
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    m.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {m.active ? 'Active' : 'Inactive'}
                  </span>
                  <a
                    href={WEBMAIL_URL}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50'
                  >
                    Open Inbox ↗
                  </a>
                  <button
                    onClick={() => { setEditingPw(isEditing ? null : m.username); setNewPw(''); setStatus({ kind: 'idle', message: '' }); }}
                    className='rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50'
                  >
                    {isEditing ? 'Cancel' : 'Change Password'}
                  </button>
                  <button
                    onClick={() => { setConfirmDelete(isDeleting ? null : m.username); }}
                    className='rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50'
                  >
                    {isDeleting ? 'Cancel' : 'Delete'}
                  </button>
                </div>
              </div>

              {/* Stats row */}
              <div className='mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500'>
                <span>{m.messages ?? 0} messages</span>
                <span>{formatBytes(m.quota_used)} / {formatBytes(m.quota)} used ({usedPct}%)</span>
                <span>Last login: {formatLastLogin(m.last_imap_login)}</span>
              </div>

              {/* Quota bar */}
              <div className='mt-2 h-1.5 w-full rounded-full bg-slate-100'>
                <div
                  className={`h-1.5 rounded-full ${usedPct > 80 ? 'bg-rose-400' : 'bg-emerald-400'}`}
                  style={{ width: `${Math.min(usedPct, 100)}%` }}
                />
              </div>

              {/* Change password inline */}
              {isEditing && (
                <div className='mt-3 flex gap-2'>
                  <input
                    type='password'
                    className='flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none'
                    placeholder='New password (min 8 chars)'
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                  />
                  <button
                    onClick={() => changePassword(m.username)}
                    disabled={submitting}
                    className='rounded-lg bg-slate-800 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50'
                  >
                    {submitting ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}

              {/* Confirm delete */}
              {isDeleting && (
                <div className='mt-3 flex items-center gap-3 rounded-lg bg-rose-50 px-3 py-2 text-sm'>
                  <span className='text-rose-700 flex-1'>Delete <strong>{m.username}</strong>? This cannot be undone.</span>
                  <button
                    onClick={() => deleteMailbox(m.username)}
                    disabled={submitting}
                    className='rounded-lg bg-rose-600 px-3 py-1.5 text-xs text-white hover:bg-rose-700 disabled:opacity-50'
                  >
                    {submitting ? 'Deleting…' : 'Confirm Delete'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Webmail link */}
      <div className='rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600'>
        <strong>Webmail:</strong> To read emails, open{' '}
        <a href={WEBMAIL_URL} target='_blank' rel='noopener noreferrer' className='text-blue-600 underline'>
          mail.ariseandshinetransporters.com/SOGo
        </a>{' '}
        and log in with the mailbox email and password.
      </div>
    </div>
  );
}
