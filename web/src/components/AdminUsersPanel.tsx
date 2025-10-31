import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type TeamRole = 'ADMIN' | 'OPS' | 'FUEL' | 'DRIVER';

type RawUser = {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  driverId?: string | null;
  createdAt?: string | null;
};

type TeamUser = {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: TeamRole;
  driverId: string | null;
  createdAt: string | null;
  pendingRole: TeamRole;
  pendingDriverId: string;
};

type Status =
  | { kind: 'idle'; message: '' }
  | { kind: 'success' | 'error'; message: string };

const ROLE_OPTIONS: { value: TeamRole; label: string }[] = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'OPS', label: 'Operations' },
  { value: 'FUEL', label: 'Fuel' },
  { value: 'DRIVER', label: 'Driver' },
];

export default function AdminUsersPanel() {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });
  const [credentialNotice, setCredentialNotice] = useState<{ email: string; password: string } | null>(null);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [resettingId, setResettingId] = useState<number | null>(null);
  const [createForm, setCreateForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'OPS' as TeamRole,
    driverId: '',
  });

  async function load() {
    try {
      setLoading(true);
      const res = await api.get('/api/admin/users');
      const rows: RawUser[] = Array.isArray(res.data) ? res.data : [];
      const mapped: TeamUser[] = rows
        .map((row) => {
          const normalizedRole = (row.role || '').toUpperCase();
          if (!['ADMIN', 'OPS', 'FUEL', 'DRIVER'].includes(normalizedRole)) return null;
          const teamRole = normalizedRole as TeamRole;
          return {
            id: row.id,
            name: row.name || '',
            email: row.email || '',
            phone: row.phone || '',
            role: teamRole,
            driverId: row.driverId || null,
            createdAt: row.createdAt || null,
            pendingRole: teamRole,
            pendingDriverId: row.driverId || '',
          };
        })
        .filter((row): row is TeamUser => Boolean(row));
      setUsers(mapped);
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to load team members.',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredUsers = useMemo(() => {
    if (!search) return users;
    const needle = search.toLowerCase();
    return users.filter((user) =>
      [user.name, user.email, user.phone, user.role, user.driverId || '', String(user.id)]
        .filter(Boolean)
        .some((value) => value && value.toLowerCase().includes(needle))
    );
  }, [users, search]);

  function handleCreateChange(field: 'name' | 'email' | 'phone' | 'role' | 'driverId', value: string) {
    setCreateForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'role' && value !== 'DRIVER') {
        next.driverId = '';
      }
      return next;
    });
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setCredentialNotice(null);
    if (!createForm.name.trim()) {
      setStatus({ kind: 'error', message: 'Name is required to create an account.' });
      return;
    }
    if (!createForm.email.trim() || !createForm.email.includes('@')) {
      setStatus({ kind: 'error', message: 'Enter a valid email address.' });
      return;
    }
    if (createForm.role === 'DRIVER' && !createForm.driverId.trim()) {
      setStatus({ kind: 'error', message: 'Provide the driver ID to link this login.' });
      return;
    }
    try {
      setCreating(true);
      const payload: Record<string, string> = {
        name: createForm.name.trim(),
        email: createForm.email.trim(),
        phone: createForm.phone.trim(),
        role: createForm.role,
      };
      if (createForm.role === 'DRIVER') {
        payload.driverId = createForm.driverId.trim();
      }
      const res = await api.post('/api/admin/users', payload);
      const tempPassword: string | undefined = res?.data?.temporaryPassword;
      const createdEmail: string = res?.data?.user?.email || payload.email;
      setStatus({ kind: 'success', message: 'Team member account created.' });
      if (tempPassword) {
        setCredentialNotice({ email: createdEmail, password: tempPassword });
      }
      setCreateForm({ name: '', email: '', phone: '', role: 'OPS', driverId: '' });
      await load();
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to create the account.',
      });
    } finally {
      setCreating(false);
    }
  }

  function updatePendingRole(id: number, role: TeamRole) {
    setUsers((prev) =>
      prev.map((user) => {
        if (user.id !== id) return user;
        return {
          ...user,
          pendingRole: role,
          pendingDriverId: role === 'DRIVER' ? user.pendingDriverId : '',
        };
      })
    );
  }

  function updatePendingDriver(id: number, driverId: string) {
    setUsers((prev) =>
      prev.map((user) => {
        if (user.id !== id) return user;
        return { ...user, pendingDriverId: driverId };
      })
    );
  }

  async function saveUser(id: number) {
    const target = users.find((user) => user.id === id);
    if (!target) return;
    setCredentialNotice(null);
    if (target.pendingRole === 'DRIVER' && !target.pendingDriverId.trim()) {
      setStatus({ kind: 'error', message: 'Driver logins must remain linked to a driver ID.' });
      return;
    }
    const currentDriver = target.driverId || '';
    const desiredDriver = target.pendingRole === 'DRIVER' ? target.pendingDriverId.trim() : '';
    const hasChanges =
      target.pendingRole !== target.role || desiredDriver !== currentDriver;
    if (!hasChanges) return;
    try {
      setUpdatingId(id);
      const payload: Record<string, string | null> = {
        role: target.pendingRole,
      };
      payload.driverId = target.pendingRole === 'DRIVER' ? desiredDriver : null;
      await api.patch(`/api/admin/users/${id}`, payload);
      setStatus({ kind: 'success', message: `${target.name || target.email} updated.` });
      await load();
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to update the account.',
      });
    } finally {
      setUpdatingId(null);
    }
  }

  async function resetPassword(id: number) {
    const target = users.find((user) => user.id === id);
    if (!target) return;
    setCredentialNotice(null);
    try {
      setResettingId(id);
      const res = await api.post(`/api/admin/users/${id}/reset-password`);
      const tempPassword: string | undefined = res?.data?.temporaryPassword;
      setStatus({
        kind: 'success',
        message: `Temporary password generated for ${target.email}.`,
      });
      if (tempPassword) {
        setCredentialNotice({ email: target.email, password: tempPassword });
      }
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to reset the password.',
      });
    } finally {
      setResettingId(null);
    }
  }

  return (
    <div className='space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
      <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
        <div>
          <h2 className='text-sm font-semibold text-slate-900'>Team access control</h2>
          <p className='text-xs text-slate-500'>
            Invite teammates and keep their roles up to date for the admin, ops, driver, and fuel portals.
          </p>
        </div>
        <div className='flex items-center gap-2 text-xs'>
          <input
            className='w-40 rounded border border-slate-300 px-2 py-1'
            placeholder='Search name or email'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type='button'
            onClick={() => load()}
            className='rounded border border-slate-300 px-3 py-1.5 hover:border-slate-400'
          >
            Refresh
          </button>
        </div>
      </div>

      {status.kind !== 'idle' && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            status.kind === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-600'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {status.message}
        </div>
      )}

      {credentialNotice && (
        <div className='rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800'>
          <div className='font-semibold text-amber-900'>Share these credentials securely</div>
          <div className='mt-2'>
            Email:{' '}
            <code className='rounded bg-white px-1 py-0.5 text-xs text-amber-900'>{credentialNotice.email}</code>
          </div>
          <div className='mt-2'>
            Temporary password:{' '}
            <code className='rounded bg-white px-1 py-0.5 text-xs text-amber-900'>{credentialNotice.password}</code>
          </div>
          <div className='mt-3 text-[11px] text-amber-700'>
            Ask the teammate to sign in and change their password immediately after first login.
          </div>
        </div>
      )}

      <form
        onSubmit={submitCreate}
        className='grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-sm md:grid-cols-6'
      >
        <label className='md:col-span-2'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Full name</span>
          <input
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={createForm.name}
            onChange={(e) => handleCreateChange('name', e.target.value)}
            placeholder='Teammate name'
          />
        </label>
        <label className='md:col-span-2'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Email</span>
          <input
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={createForm.email}
            onChange={(e) => handleCreateChange('email', e.target.value)}
            placeholder='name@example.com'
          />
        </label>
        <label className='md:col-span-1'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Phone</span>
          <input
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={createForm.phone}
            onChange={(e) => handleCreateChange('phone', e.target.value)}
            placeholder='Optional contact'
          />
        </label>
        <label className='md:col-span-1'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Role</span>
          <select
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={createForm.role}
            onChange={(e) => handleCreateChange('role', e.target.value as TeamRole)}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {createForm.role === 'DRIVER' && (
          <label className='md:col-span-2'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Driver ID</span>
            <input
              className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
              value={createForm.driverId}
              onChange={(e) => handleCreateChange('driverId', e.target.value)}
              placeholder='Match an existing driver record'
            />
          </label>
        )}
        <div className='md:col-span-6 flex justify-end gap-2'>
          <button
            type='button'
            onClick={() => setCreateForm({ name: '', email: '', phone: '', role: 'OPS', driverId: '' })}
            className='rounded border border-slate-300 px-3 py-1 text-xs hover:border-slate-400'
          >
            Clear
          </button>
          <button
            type='submit'
            disabled={creating}
            className='rounded border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60'
          >
            {creating ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>

      <div className='rounded-2xl border border-slate-200'>
        <div className='hidden grid-cols-12 gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:grid'>
          <div className='col-span-3'>Member</div>
          <div className='col-span-2'>Phone</div>
          <div className='col-span-2'>Role</div>
          <div className='col-span-2'>Driver ID</div>
          <div className='col-span-3 text-right'>Actions</div>
        </div>
        {loading ? (
          <div className='px-4 py-6 text-xs text-slate-500'>Loading team directory…</div>
        ) : filteredUsers.length === 0 ? (
          <div className='px-4 py-6 text-xs text-slate-500'>
            No team members captured yet. Invite your first admin, ops, driver, or fuel teammate above.
          </div>
        ) : (
          filteredUsers.map((user) => {
            const currentDriver = user.driverId || '';
            const desiredDriver = user.pendingRole === 'DRIVER' ? (user.pendingDriverId || '').trim() : '';
            const dirty = user.pendingRole !== user.role || desiredDriver !== currentDriver;
            return (
              <div
                key={user.id}
                className='border-t border-slate-200 px-4 py-4 text-sm md:grid md:grid-cols-12 md:items-center md:gap-2'
              >
                <div className='md:col-span-3'>
                  <div className='font-medium text-slate-900'>{user.name || user.email}</div>
                  <div className='text-xs text-slate-500'>{user.email}</div>
                  {user.createdAt && (
                    <div className='mt-1 text-[11px] text-slate-400'>
                      Added {new Date(user.createdAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <div className='mt-3 text-xs text-slate-500 md:col-span-2 md:mt-0'>
                  {user.phone ? user.phone : '—'}
                </div>
                <div className='mt-3 md:col-span-2 md:mt-0'>
                  <select
                    className='w-full rounded border border-slate-300 px-2 py-1 text-xs'
                    value={user.pendingRole}
                    onChange={(e) => updatePendingRole(user.id, e.target.value as TeamRole)}
                    disabled={updatingId === user.id}
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className='mt-3 md:col-span-2 md:mt-0'>
                  {user.pendingRole === 'DRIVER' ? (
                    <input
                      className='w-full rounded border border-slate-300 px-2 py-1 text-xs'
                      value={user.pendingDriverId}
                      onChange={(e) => updatePendingDriver(user.id, e.target.value)}
                      placeholder='Driver ID'
                      disabled={updatingId === user.id}
                    />
                  ) : (
                    <div className='text-xs text-slate-400'>Not linked</div>
                  )}
                </div>
                <div className='mt-3 flex gap-2 text-xs md:col-span-3 md:mt-0 md:justify-end'>
                  <button
                    type='button'
                    onClick={() => saveUser(user.id)}
                    disabled={!dirty || updatingId === user.id}
                    className='rounded border border-slate-300 px-3 py-1 font-medium hover:border-slate-400 disabled:opacity-60'
                  >
                    {updatingId === user.id ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type='button'
                    onClick={() => resetPassword(user.id)}
                    disabled={resettingId === user.id}
                    className='rounded border border-amber-500 px-3 py-1 font-medium text-amber-700 hover:border-amber-600 disabled:opacity-60'
                  >
                    {resettingId === user.id ? 'Resetting…' : 'Reset password'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
