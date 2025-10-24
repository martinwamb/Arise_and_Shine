import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type Driver = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  nationalIdPath?: string | null;
  photoPath?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type Status = { kind: 'idle' | 'success' | 'error'; message: string };

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result?.toString() || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function AdminDriversPanel() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    id: '',
    name: '',
    email: '',
    phone: '',
    nationalIdData: '',
    photoData: '',
  });

  async function load() {
    try {
      setLoading(true);
      const res = await api.get('/api/admin/drivers');
      setDrivers(Array.isArray(res.data) ? res.data : []);
      setStatus({ kind: 'idle', message: '' });
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to load drivers.',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredDrivers = useMemo(() => {
    if (!search) return drivers;
    const needle = search.toLowerCase();
    return drivers.filter((driver) =>
      [driver.name, driver.email, driver.phone, driver.id].some((value) =>
        value ? value.toLowerCase().includes(needle) : false
      )
    );
  }, [drivers, search]);

  const resetForm = () => {
    setForm({ id: '', name: '', email: '', phone: '', nationalIdData: '', photoData: '' });
    setEditingId(null);
    setStatus({ kind: 'idle', message: '' });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setStatus({ kind: 'error', message: 'Driver name is required.' });
      return;
    }
    try {
      if (editingId) {
        await api.patch(`/api/admin/drivers/${editingId}`, {
          name: form.name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          nationalIdData: form.nationalIdData || undefined,
          photoData: form.photoData || undefined,
        });
        setStatus({ kind: 'success', message: 'Driver updated successfully.' });
      } else {
        if (!form.id.trim()) {
          setStatus({ kind: 'error', message: 'Provide a unique driver ID.' });
          return;
        }
        await api.post('/api/admin/drivers', {
          id: form.id.trim(),
          name: form.name.trim(),
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
        });
        setStatus({ kind: 'success', message: 'Driver created successfully.' });
      }
      resetForm();
      await load();
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to save driver.',
      });
    }
  }

  const startEdit = (driver: Driver) => {
    setEditingId(driver.id);
    setForm({
      id: driver.id,
      name: driver.name || '',
      email: driver.email || '',
      phone: driver.phone || '',
      nationalIdData: '',
      photoData: '',
    });
    setStatus({ kind: 'idle', message: '' });
  };

  const handleFile = async (key: 'nationalIdData' | 'photoData', file: File | null) => {
    if (!file) {
      setForm((prev) => ({ ...prev, [key]: '' }));
      return;
    }
    try {
      const base64 = await readFileAsBase64(file);
      setForm((prev) => ({ ...prev, [key]: base64 }));
    } catch (err) {
      setStatus({ kind: 'error', message: 'Failed to load the selected file.' });
    }
  };

  return (
    <div className='space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-sm font-semibold text-slate-900'>Driver directory</h2>
          <p className='text-xs text-slate-500'>
            Maintain contact details and identification docs for every driver in the fleet.
          </p>
        </div>
        <div className='flex items-center gap-2 text-xs'>
          <input
            className='rounded border border-slate-300 px-2 py-1'
            placeholder='Search driver'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            onClick={() => load()}
            className='rounded border border-slate-300 px-2 py-1 hover:border-slate-400'
          >
            Refresh
          </button>
        </div>
      </div>

      <form onSubmit={submit} className='grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-sm md:grid-cols-4'>
        <label className='block md:col-span-1'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Driver ID</span>
          <input
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={form.id}
            onChange={(e) => setForm((prev) => ({ ...prev, id: e.target.value }))}
            placeholder='Unique ID'
            disabled={!!editingId}
          />
        </label>
        <label className='block md:col-span-1'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Name</span>
          <input
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder='Driver name'
          />
        </label>
        <label className='block md:col-span-1'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Email</span>
          <input
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={form.email}
            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
            placeholder='Optional email'
          />
        </label>
        <label className='block md:col-span-1'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Phone</span>
          <input
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={form.phone}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
            placeholder='07XX...'
          />
        </label>
        <label className='block md:col-span-2'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>National ID image</span>
          <input
            type='file'
            accept='image/*'
            className='mt-1 block w-full text-xs text-slate-500 file:mr-3 file:rounded-full file:border-0 file:bg-amber-100 file:px-4 file:py-2 file:text-amber-700'
            onChange={(e) => handleFile('nationalIdData', e.target.files?.[0] || null)}
          />
        </label>
        <label className='block md:col-span-2'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Profile photo</span>
          <input
            type='file'
            accept='image/*'
            className='mt-1 block w-full text-xs text-slate-500 file:mr-3 file:rounded-full file:border-0 file:bg-emerald-100 file:px-4 file:py-2 file:text-emerald-700'
            onChange={(e) => handleFile('photoData', e.target.files?.[0] || null)}
          />
        </label>
        <div className='md:col-span-4 flex items-center gap-2'>
          <button
            type='submit'
            className='rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800'
          >
            {editingId ? 'Update driver' : 'Add driver'}
          </button>
          {editingId && (
            <button
              type='button'
              onClick={resetForm}
              className='rounded border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-slate-400'
            >
              Cancel edit
            </button>
          )}
          {status.kind !== 'idle' && (
            <span
              className={`text-xs font-semibold ${
                status.kind === 'success' ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              {status.message}
            </span>
          )}
        </div>
      </form>

      <div className='overflow-auto rounded-2xl border border-slate-200'>
        <table className='min-w-full text-sm'>
          <thead className='bg-amber-50 text-slate-600'>
            <tr>
              <th className='px-3 py-2 text-left'>Driver</th>
              <th className='px-3 py-2 text-left'>Contact</th>
              <th className='px-3 py-2 text-left'>Docs</th>
              <th className='px-3 py-2 text-left'>Updated</th>
              <th className='px-3 py-2'></th>
            </tr>
          </thead>
          <tbody>
            {filteredDrivers.map((driver) => (
              <tr key={driver.id} className='border-t border-slate-100'>
                <td className='px-3 py-2 font-medium text-slate-900'>
                  {driver.name}
                  <div className='text-xs text-slate-500'>ID: {driver.id}</div>
                </td>
                <td className='px-3 py-2 text-xs text-slate-500'>
                  {[driver.phone, driver.email].filter(Boolean).join(' | ') || '—'}
                </td>
                <td className='px-3 py-2 text-xs text-slate-500'>
                  {driver.nationalIdPath ? 'National ID uploaded' : 'National ID missing'}
                  <br />
                  {driver.photoPath ? 'Photo uploaded' : 'Photo missing'}
                </td>
                <td className='px-3 py-2 text-xs text-slate-500'>
                  {driver.updatedAt ? new Date(driver.updatedAt).toLocaleString() : '—'}
                </td>
                <td className='px-3 py-2 text-right'>
                  <button
                    onClick={() => startEdit(driver)}
                    className='rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-slate-400'
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {filteredDrivers.length === 0 && (
              <tr>
                <td colSpan={5} className='px-3 py-6 text-center text-xs text-slate-500'>
                  {loading ? 'Loading drivers...' : 'No drivers match the current filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
