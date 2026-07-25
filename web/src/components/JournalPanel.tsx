import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import AdminCostsPanel from './AdminCostsPanel';

type TruckOption = { id: string; plate?: string };
type DraftRow = { amount: string; note: string };
type Earning = { id: string; note: string; amount: number; createdAt?: string };
type Status = { kind: 'idle' | 'success' | 'error'; message: string };

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyRow = (): DraftRow => ({ amount: '', note: '' });

export default function JournalPanel() {
  const [trucks, setTrucks] = useState<TruckOption[]>([]);
  const [truckId, setTruckId] = useState('');
  const [date, setDate] = useState(todayStr);
  const [draftRows, setDraftRows] = useState<DraftRow[]>([emptyRow()]);
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingEarnings, setLoadingEarnings] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });

  useEffect(() => {
    api
      .get('/api/admin/trucks')
      .then((res) => setTrucks(Array.isArray(res.data) ? res.data : []))
      .catch(() => setTrucks([]));
  }, []);

  const loadEarnings = useCallback(async () => {
    if (!truckId || !date) {
      setEarnings([]);
      return;
    }
    try {
      setLoadingEarnings(true);
      const res = await api.get('/api/admin/journal/orders', { params: { truckId, date } });
      setEarnings(Array.isArray(res.data) ? res.data : []);
    } catch {
      setEarnings([]);
    } finally {
      setLoadingEarnings(false);
    }
  }, [truckId, date]);

  useEffect(() => {
    loadEarnings();
  }, [loadEarnings]);

  const dayTotal = useMemo(() => earnings.reduce((s, e) => s + Number(e.amount || 0), 0), [earnings]);

  const updateRow = (index: number, patch: Partial<DraftRow>) => {
    setDraftRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const addRow = () => setDraftRows((prev) => [...prev, emptyRow()]);
  const removeRow = (index: number) =>
    setDraftRows((prev) => (prev.length === 1 ? [emptyRow()] : prev.filter((_, i) => i !== index)));

  async function saveEarnings() {
    if (!truckId) {
      setStatus({ kind: 'error', message: 'Select a truck first.' });
      return;
    }
    const payloads = draftRows
      .map((row) => ({ amount: parseFloat(row.amount || '0'), note: row.note.trim() }))
      .filter((row) => Number.isFinite(row.amount) && row.amount > 0);
    if (!payloads.length) {
      setStatus({ kind: 'error', message: 'Enter at least one order amount.' });
      return;
    }
    try {
      setSaving(true);
      setStatus({ kind: 'idle', message: '' });
      for (const p of payloads) {
        await api.post('/api/admin/journal/orders', { truckId, date, amount: p.amount, note: p.note });
      }
      setDraftRows([emptyRow()]);
      setStatus({
        kind: 'success',
        message: `${payloads.length} order${payloads.length === 1 ? '' : 's'} saved.`,
      });
      await loadEarnings();
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to save earnings.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteEarning(id: string) {
    try {
      await api.delete(`/api/admin/journal/orders/${id}`);
      await loadEarnings();
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to remove earning.',
      });
    }
  }

  return (
    <div className='space-y-4'>
      <div className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
        <div>
          <h2 className='text-sm font-semibold text-slate-900'>Journal</h2>
          <p className='text-xs text-slate-500'>
            Pick a truck and day, log what it earned, then log its costs — all in one place.
          </p>
        </div>

        <div className='mt-4 grid gap-3 sm:grid-cols-2'>
          <label className='block'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Truck</span>
            <select
              className='mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm'
              value={truckId}
              onChange={(e) => {
                setTruckId(e.target.value);
                setDraftRows([emptyRow()]);
                setStatus({ kind: 'idle', message: '' });
              }}
            >
              <option value=''>Select truck...</option>
              {trucks.map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.plate || truck.id}
                </option>
              ))}
            </select>
          </label>
          <label className='block'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Date</span>
            <input
              type='date'
              className='mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm'
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>

        {!truckId ? (
          <div className='mt-4 text-xs text-slate-400'>Select a truck to start the day's journal.</div>
        ) : (
          <div className='mt-4 space-y-4'>
            <div className='rounded-2xl border border-slate-200 bg-slate-50/60 p-4'>
              <div className='mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400'>
                Orders / earnings
              </div>
              <div className='space-y-2'>
                {draftRows.map((row, index) => (
                  <div key={index} className='grid grid-cols-[7rem_1fr_auto] items-center gap-2'>
                    <input
                      type='number'
                      inputMode='decimal'
                      min={0}
                      step='0.01'
                      placeholder='Amount'
                      className='w-full rounded border border-slate-300 px-2 py-1 text-sm'
                      value={row.amount}
                      onChange={(e) => updateRow(index, { amount: e.target.value })}
                    />
                    <input
                      className='w-full rounded border border-slate-300 px-2 py-1 text-sm'
                      placeholder='Note / customer (optional)'
                      value={row.note}
                      onChange={(e) => updateRow(index, { note: e.target.value })}
                    />
                    <button
                      type='button'
                      onClick={() => removeRow(index)}
                      className='rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:border-slate-400'
                      aria-label='Remove order row'
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className='mt-3 flex flex-wrap items-center gap-2'>
                <button
                  type='button'
                  onClick={addRow}
                  className='rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-400'
                >
                  + Add order
                </button>
                <button
                  type='button'
                  onClick={saveEarnings}
                  disabled={saving}
                  className='rounded bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60'
                >
                  {saving ? 'Saving…' : 'Save earnings'}
                </button>
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

              <div className='mt-4'>
                <div className='mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400'>
                  <span>Recorded this day</span>
                  <span>Total: KES {dayTotal.toLocaleString()}</span>
                </div>
                <div className='space-y-1 text-sm'>
                  {earnings.map((e, i) => (
                    <div
                      key={e.id}
                      className='flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2'
                    >
                      <div>
                        <span className='font-semibold text-slate-900'>Order {i + 1}</span>
                        <span className='ml-2 text-slate-700'>KES {Number(e.amount).toLocaleString()}</span>
                        {e.note && <span className='ml-2 text-slate-500'>· {e.note}</span>}
                      </div>
                      <button
                        type='button'
                        onClick={() => deleteEarning(e.id)}
                        className='rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:border-rose-300 hover:text-rose-600'
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                  {!earnings.length && (
                    <div className='py-3 text-center text-xs text-slate-400'>
                      {loadingEarnings ? 'Loading…' : 'No orders recorded for this truck and day yet.'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div>
              <div className='mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400'>
                Costs for this truck
              </div>
              <AdminCostsPanel
                controlledTruckId={truckId}
                controlledIncurredAt={`${date}T12:00`}
                hideFuel
                hideTruckDatePickers
                hideLedger
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
