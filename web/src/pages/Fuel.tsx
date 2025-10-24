import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import FleetLocationPanel from '../components/FleetLocationPanel';

type FuelLog = {
  id: string;
  truckId: string;
  plate?: string;
  litres: number | null;
  odometer: number | null;
  mileage: number | null;
  cost: number | null;
  driverId?: string | null;
  driverName?: string | null;
  note?: string;
  capturedAt: string;
  photoPath?: string | null;
  createdBy?: string | null;
  isDuplicate?: boolean;
  duplicateOf?: string | null;
  confirmedBy?: number | null;
  confirmedAt?: string | null;
};

const initialTimestamp = () => new Date().toISOString().slice(0, 16);

type FuelPayload = {
  truckId: string | null;
  litres: number | null;
  odometer: number | null;
  cost: number | null;
  note: string;
  capturedAt?: string;
  photoData?: string;
};

type DuplicateFuelRecord = {
  id?: string;
  truck_id?: string | null;
  litres?: number | null;
  cost?: number | null;
  note?: string | null;
  captured_at?: string | null;
  duplicate_of?: string | null;
};

type DuplicateFuelPrompt = {
  message: string;
  existing: DuplicateFuelRecord | null;
  payload: FuelPayload;
};

export default function Fuel() {
  const [logs, setLogs] = useState<FuelLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<DuplicateFuelPrompt | null>(null);
  const [confirmingDuplicate, setConfirmingDuplicate] = useState(false);
  const [trucks, setTrucks] = useState<any[]>([]);
  const [form, setForm] = useState({
    truckId: '',
    litres: '',
    odometer: '',
    cost: '',
    capturedAt: initialTimestamp(),
    note: '',
    photoData: '',
    photoPreview: '',
    driverName: '',
  });

  const resetForm = () =>
    setForm({
      truckId: '',
      litres: '',
      odometer: '',
      cost: '',
      capturedAt: initialTimestamp(),
      note: '',
      photoData: '',
      photoPreview: '',
      driverName: '',
    });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/api/fuel/logs', { params: { limit: 50 } });
      setLogs(Array.isArray(res.data) ? res.data : []);
      setError(null);
      setDuplicateWarning(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load fuel logs');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTrucks = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/trucks');
      setTrucks(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.warn('Truck list load failed', err);
    }
  }, []);

  useEffect(() => {
    load();
    loadTrucks();
  }, [load, loadTrucks]);

  const handleFile = (file: File | undefined | null) => {
    if (!file) {
      setForm((prev) => ({ ...prev, photoData: '', photoPreview: '' }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result?.toString() || '';
      setForm((prev) => ({ ...prev, photoData: result, photoPreview: result }));
    };
    reader.readAsDataURL(file);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setDuplicateWarning(null);
    const payload: FuelPayload = {
      truckId: form.truckId ? form.truckId : null,
      litres: form.litres ? Number(form.litres) : null,
      odometer: form.odometer ? Number(form.odometer) : null,
      cost: form.cost ? Number(form.cost) : null,
      note: form.note,
      capturedAt: form.capturedAt ? new Date(form.capturedAt).toISOString() : undefined,
      photoData: form.photoData || undefined,
    };
    try {
      await api.post('/api/fuel/logs', payload);
      resetForm();
      await load();
    } catch (err: any) {
      if (err?.response?.status === 409 && err?.response?.data?.duplicate) {
        setDuplicateWarning({
          message: err?.response?.data?.message || 'Potential duplicate fuel entry detected.',
          existing: err?.response?.data?.existing || null,
          payload,
        });
      } else {
        setError(err?.response?.data?.error || err?.message || 'Failed to save the fuel log');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDuplicate = async () => {
    if (!duplicateWarning) return;
    const duplicateOf =
      duplicateWarning.existing?.duplicate_of || duplicateWarning.existing?.id || undefined;
    setConfirmingDuplicate(true);
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/api/fuel/logs', {
        ...duplicateWarning.payload,
        overrideDuplicate: true,
        duplicateOf,
      });
      resetForm();
      setDuplicateWarning(null);
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to confirm duplicate fuel log');
    } finally {
      setConfirmingDuplicate(false);
      setSubmitting(false);
    }
  };

  const dismissDuplicateWarning = () => {
    setDuplicateWarning(null);
  };

  const weeklyLitres = logs.reduce((total, log) => total + (log.litres || 0), 0);

  return (
    <main className='mx-auto max-w-5xl px-4 py-16'>
      <div className='mb-6'>
        <h1 className='text-3xl font-bold text-slate-900'>Fuel &amp; mileage monitor</h1>
        <p className='text-sm text-slate-600'>
          Capture pump readings, odometer photos, and notes. Dispatch instantly sees the history per truck.
        </p>
      </div>

      <section className='mt-8'>
        <FleetLocationPanel allowReassign={false} />
      </section>


      <section className='grid gap-6 lg:grid-cols-2'>
        <form onSubmit={submit} className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4'>
          <div className='flex items-center justify-between'>
            <h2 className='text-sm font-semibold text-slate-900'>Record fuel stop</h2>
            <span className='text-xs text-slate-500'>
              This week: <strong>{weeklyLitres.toLocaleString()}</strong> litres
            </span>
          </div>
          {duplicateWarning && (
            <div className='rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900'>
              <div>
                <h3 className='text-sm font-semibold text-amber-700'>Possible duplicate fuel log</h3>
                <p className='mt-1 text-xs text-amber-800'>
                  {duplicateWarning.message || 'An existing log matches this entry. Confirm to flag it intentionally.'}
                </p>
              </div>
              <div className='mt-3 grid gap-3 sm:grid-cols-2'>
                <div>
                  <div className='text-[11px] font-semibold uppercase tracking-wide text-amber-700'>
                    Existing entry
                  </div>
                  <ul className='mt-1 space-y-1'>
                    <li>Truck: {duplicateWarning.existing?.truck_id || 'n/a'}</li>
                    <li>
                      Litres:{' '}
                      {duplicateWarning.existing?.litres !== undefined && duplicateWarning.existing?.litres !== null
                        ? Number(duplicateWarning.existing.litres).toLocaleString()
                        : 'n/a'}
                    </li>
                    <li>
                      Cost:{' '}
                      {duplicateWarning.existing?.cost !== undefined && duplicateWarning.existing?.cost !== null
                        ? Number(duplicateWarning.existing.cost).toLocaleString()
                        : 'n/a'}
                    </li>
                    <li>
                      Captured:{' '}
                      {duplicateWarning.existing?.captured_at
                        ? new Date(duplicateWarning.existing.captured_at).toLocaleString()
                        : 'n/a'}
                    </li>
                    <li>Note: {duplicateWarning.existing?.note || 'No note'}</li>
                  </ul>
                </div>
                <div>
                  <div className='text-[11px] font-semibold uppercase tracking-wide text-amber-700'>
                    New submission
                  </div>
                  <ul className='mt-1 space-y-1'>
                    <li>Truck: {duplicateWarning.payload.truckId || 'n/a'}</li>
                    <li>
                      Litres:{' '}
                      {duplicateWarning.payload.litres !== null && duplicateWarning.payload.litres !== undefined
                        ? Number(duplicateWarning.payload.litres).toLocaleString()
                        : 'n/a'}
                    </li>
                    <li>
                      Cost:{' '}
                      {duplicateWarning.payload.cost !== null && duplicateWarning.payload.cost !== undefined
                        ? Number(duplicateWarning.payload.cost).toLocaleString()
                        : 'n/a'}
                    </li>
                    <li>
                      Captured:{' '}
                      {duplicateWarning.payload.capturedAt
                        ? new Date(duplicateWarning.payload.capturedAt).toLocaleString()
                        : 'n/a'}
                    </li>
                    <li>Note: {duplicateWarning.payload.note || 'No note'}</li>
                  </ul>
                </div>
              </div>
              <div className='mt-4 flex flex-wrap gap-2 text-xs'>
                <button
                  type='button'
                  onClick={confirmDuplicate}
                  disabled={confirmingDuplicate}
                  className='rounded bg-amber-600 px-3 py-2 font-semibold text-white shadow hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60'
                >
                  {confirmingDuplicate ? 'Flagging duplicate…' : 'Confirm and flag duplicate'}
                </button>
                <button
                  type='button'
                  onClick={dismissDuplicateWarning}
                  className='rounded border border-amber-400 px-3 py-2 font-semibold text-amber-700 hover:bg-amber-100'
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {error && (
            <div className='rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700'>
              {error}
            </div>
          )}
          <div className='grid gap-3 text-sm sm:grid-cols-2'>
            <label className='block'>
              <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Truck ID / Plate</span>
              <input
                value={form.truckId}
                onChange={(e) => {
                  const value = e.target.value;
                  const selected = trucks.find((t) => t.id === value);
                  setForm((prev) => ({
                    ...prev,
                    truckId: value,
                    driverName: selected?.driverName || selected?.primaryDriverId || '',
                  }));
                }}
                list='fuel-trucks'
                required
                placeholder='Enter or pick truck ID'
                className='mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-teal-600 focus:outline-none'
              />
              <datalist id='fuel-trucks'>
                {trucks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.plate} ({t.capacityT || t.capacity_t}t){t.driverName ? ` �?� ${t.driverName}` : ''}
                  </option>
                ))}
              </datalist>
              <p className='mt-1 text-[11px] text-slate-500'>
                {form.driverName ? `Driver: ${form.driverName}` : 'No primary driver assigned yet.'}
              </p>
            </label>
            <label className='block'>
              <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Captured at</span>
              <input
                type='datetime-local'
                value={form.capturedAt}
                onChange={(e) => setForm({ ...form, capturedAt: e.target.value })}
                className='mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-teal-600 focus:outline-none'
              />
            </label>
            <label className='block'>
              <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Litres pumped</span>
              <input
                type='number'
                min='0'
                step='0.1'
                value={form.litres}
                onChange={(e) => setForm({ ...form, litres: e.target.value })}
                className='mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-teal-600 focus:outline-none'
              />
            </label>
            <label className='block'>
              <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Total cost (KES)</span>
              <input
                type='number'
                min='0'
                step='1'
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
                required
                className='mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-teal-600 focus:outline-none'
                placeholder='e.g. 12,800'
              />
            </label>
            <label className='block'>
              <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Odometer (km)</span>
              <input
                type='number'
                min='0'
                value={form.odometer}
                onChange={(e) => setForm({ ...form, odometer: e.target.value })}
                className='mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-teal-600 focus:outline-none'
              />
            </label>
          </div>
          <label className='block text-sm'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Notes</span>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              className='mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-teal-600 focus:outline-none'
              rows={3}
              placeholder='E.g. “Topped up at Shell Athi River, receipt left with supervisor.”'
            />
          </label>
          <label className='block text-sm'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Photo (pump or dashboard)</span>
            <input
              type='file'
              accept='image/*'
              onChange={(e) => handleFile(e.target.files?.[0])}
              className='mt-1 block w-full text-xs text-slate-500 file:mr-3 file:rounded-full file:border-0 file:bg-amber-100 file:px-4 file:py-2 file:text-amber-700'
            />
          </label>
          {form.photoPreview && (
            <img src={form.photoPreview} alt='Preview' className='h-32 w-auto rounded-xl border border-slate-200 object-cover' />
          )}
          <button
            type='submit'
            disabled={submitting}
            className='w-full rounded-2xl bg-gradient-to-tr from-amber-500 to-teal-600 px-4 py-3 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-60'
          >
            {submitting ? 'Saving…' : 'Save fuel log'}
          </button>
        </form>

        <div className='rounded-3xl border border-slate-200 bg-white p-6 shadow-sm'>
          <div className='mb-3 flex items-center justify-between'>
            <h2 className='text-sm font-semibold text-slate-900'>Latest entries</h2>
            <button
              onClick={load}
              className='rounded border border-slate-200 px-3 py-1 text-xs text-slate-700 hover:border-slate-300'
            >
              Refresh
            </button>
          </div>
          {loading ? (
            <div className='rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-600'>
              Loading fuel logs…
            </div>
          ) : logs.length === 0 ? (
            <div className='rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500'>
              No fuel entries captured yet.
            </div>
          ) : (
            <ul className='space-y-4'>
              {logs.map((log) => {
                const flagged = Boolean(log.isDuplicate || log.duplicateOf);
                const itemClass = flagged
                  ? 'rounded-2xl border border-amber-300 bg-amber-50/80 p-4'
                  : 'rounded-2xl border border-slate-100 bg-slate-50/70 p-4';
                return (
                  <li key={log.id} className={itemClass}>
                    <div className='flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700'>
                      <div>
                        <div className='font-semibold text-slate-900'>{log.plate || log.truckId}</div>
                        <div className='text-xs text-slate-500'>{new Date(log.capturedAt).toLocaleString()}</div>
                      </div>
                      {log.litres !== null && (
                        <span className='rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700'>
                          {log.litres.toLocaleString()} litres
                        </span>
                      )}
                      {log.cost !== null && (
                        <span className='rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700'>
                          KES {log.cost.toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className='mt-2 grid gap-3 text-xs text-slate-500 sm:grid-cols-3'>
                      <div>Odometer: {log.odometer !== null ? `${log.odometer.toLocaleString()} km` : '—'}</div>
                      <div>Mileage since last: {log.mileage !== null ? `${log.mileage.toLocaleString()} km` : '—'}</div>
                      <div>Driver: {log.driverName || 'Not set'}</div>
                    </div>
                    {flagged && (
                      <div className='mt-2 text-xs font-semibold text-amber-700'>
                        Marked as duplicate for audit
                        {log.confirmedAt ? ` · ${new Date(log.confirmedAt).toLocaleString()}` : ''}
                        {log.duplicateOf ? ` · Reference ${log.duplicateOf}` : ''}
                      </div>
                    )}
                    {log.note && <p className='mt-2 text-sm text-slate-700'>{log.note}</p>}
                    {log.photoPath && (
                      <img
                        src={log.photoPath}
                        alt='Fuel proof'
                        className='mt-3 max-h-40 w-auto rounded-xl border border-slate-200 object-cover'
                      />
                    )}
                    {log.createdBy && (
                      <div className='mt-2 text-xs text-slate-400'>Logged by {log.createdBy}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
