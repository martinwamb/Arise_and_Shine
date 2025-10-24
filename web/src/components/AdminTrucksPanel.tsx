import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type Truck = {
  id: string;
  plate: string;
  capacityT: number;
  primaryDriverId?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  driverEmail?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type DriverOption = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
};

type Status = { kind: 'idle' | 'success' | 'error'; message: string };

export default function AdminTrucksPanel() {
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    id: '',
    plate: '',
    capacityT: '',
    primaryDriverId: '',
  });
  const [search, setSearch] = useState('');

  async function load() {
    try {
      setLoading(true);
      const [trucksRes, driversRes] = await Promise.all([
        api.get('/api/admin/trucks'),
        api.get('/api/admin/drivers'),
      ]);
      setTrucks(Array.isArray(trucksRes.data) ? trucksRes.data : []);
      const driverOptions: DriverOption[] = Array.isArray(driversRes.data)
        ? driversRes.data.map((d: any) => ({
            id: d.id,
            name: d.name || d.id,
            phone: d.phone || '',
            email: d.email || '',
          }))
        : [];
      setDrivers(driverOptions);
      setStatus({ kind: 'idle', message: '' });
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to load trucks.',
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredTrucks = useMemo(() => {
    if (!search) return trucks;
    const needle = search.toLowerCase();
    return trucks.filter((truck) =>
      [truck.id, truck.plate, truck.driverName].some((value) =>
        value ? value.toLowerCase().includes(needle) : false
      )
    );
  }, [trucks, search]);

  const resetForm = () => {
    setForm({ id: '', plate: '', capacityT: '', primaryDriverId: '' });
    setEditingId(null);
    setStatus({ kind: 'idle', message: '' });
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      id: form.id.trim(),
      plate: form.plate.trim(),
      capacityT: form.capacityT ? Number(form.capacityT) : NaN,
      primaryDriverId: form.primaryDriverId || null,
    };
    if (!payload.plate) {
      setStatus({ kind: 'error', message: 'Plate is required.' });
      return;
    }
    if (!Number.isFinite(payload.capacityT) || payload.capacityT <= 0) {
      setStatus({ kind: 'error', message: 'Capacity (tonnes) must be greater than zero.' });
      return;
    }
    try {
      if (editingId) {
        await api.patch(`/api/admin/trucks/${editingId}`, {
          plate: payload.plate,
          capacityT: payload.capacityT,
          primaryDriverId: payload.primaryDriverId,
        });
        setStatus({ kind: 'success', message: 'Truck updated successfully.' });
      } else {
        if (!payload.id) {
          setStatus({ kind: 'error', message: 'Provide a unique truck ID.' });
          return;
        }
        await api.post('/api/admin/trucks', payload);
        setStatus({ kind: 'success', message: 'Truck created successfully.' });
      }
      resetForm();
      await load();
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to save truck.',
      });
    }
  }

  const startEdit = (truck: Truck) => {
    setEditingId(truck.id);
    setForm({
      id: truck.id,
      plate: truck.plate || '',
      capacityT: truck.capacityT?.toString() || '',
      primaryDriverId: truck.primaryDriverId || '',
    });
    setStatus({ kind: 'idle', message: '' });
  };

  return (
    <div className='space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-sm font-semibold text-slate-900'>Truck registry</h2>
          <p className='text-xs text-slate-500'>
            Register trucks, track capacities, and link the default driver used for assignments.
          </p>
        </div>
        <div className='flex items-center gap-2 text-xs'>
          <input
            className='rounded border border-slate-300 px-2 py-1'
            placeholder='Search truck or driver'
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
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Truck ID</span>
          <input
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={form.id}
            onChange={(e) => setForm((prev) => ({ ...prev, id: e.target.value }))}
            placeholder='Unique ID'
            disabled={!!editingId}
          />
        </label>
        <label className='block md:col-span-1'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Plate number</span>
          <input
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={form.plate}
            onChange={(e) => setForm((prev) => ({ ...prev, plate: e.target.value }))}
            placeholder='e.g. KCC 123A'
          />
        </label>
        <label className='block md:col-span-1'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Capacity (tonnes)</span>
          <input
            type='number'
            min={1}
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={form.capacityT}
            onChange={(e) => setForm((prev) => ({ ...prev, capacityT: e.target.value }))}
          />
        </label>
        <label className='block md:col-span-1'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Default driver</span>
          <select
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={form.primaryDriverId}
            onChange={(e) => setForm((prev) => ({ ...prev, primaryDriverId: e.target.value }))}
          >
            <option value=''>Unassigned</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.name}
              </option>
            ))}
          </select>
        </label>
        <div className='md:col-span-4 flex items-center gap-2'>
          <button
            type='submit'
            className='rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800'
          >
            {editingId ? 'Update truck' : 'Add truck'}
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
              <th className='px-3 py-2 text-left'>Truck</th>
              <th className='px-3 py-2 text-left'>Capacity (t)</th>
              <th className='px-3 py-2 text-left'>Linked driver</th>
              <th className='px-3 py-2 text-left'>Contact</th>
              <th className='px-3 py-2 text-left'>Updated</th>
              <th className='px-3 py-2'></th>
            </tr>
          </thead>
          <tbody>
            {filteredTrucks.map((truck) => (
              <tr key={truck.id} className='border-t border-slate-100'>
                <td className='px-3 py-2 font-medium text-slate-900'>
                  {truck.plate || truck.id}
                  <div className='text-xs text-slate-500'>ID: {truck.id}</div>
                </td>
                <td className='px-3 py-2 text-slate-700'>{Number(truck.capacityT || 0).toLocaleString()}</td>
                <td className='px-3 py-2 text-slate-700'>
                  {truck.driverName || 'Unassigned'}
                  {truck.primaryDriverId ? (
                    <div className='text-xs text-slate-500'>#{truck.primaryDriverId}</div>
                  ) : null}
                </td>
                <td className='px-3 py-2 text-xs text-slate-500'>
                  {[truck.driverPhone, truck.driverEmail].filter(Boolean).join(' | ') || '—'}
                </td>
                <td className='px-3 py-2 text-xs text-slate-500'>
                  {truck.updatedAt ? new Date(truck.updatedAt).toLocaleString() : '—'}
                </td>
                <td className='px-3 py-2 text-right'>
                  <button
                    onClick={() => startEdit(truck)}
                    className='rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-slate-400'
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {filteredTrucks.length === 0 && (
              <tr>
                <td colSpan={6} className='px-3 py-6 text-center text-xs text-slate-500'>
                  {loading ? 'Loading trucks...' : 'No trucks match the current filter.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
