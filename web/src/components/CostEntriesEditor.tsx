import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { COST_TYPE_LABELS } from './AdminCostsPanel';

type CostRow = {
  id: string;
  truck_id?: string | null;
  type: string;
  amount: number;
  description?: string | null;
  incurred_at?: string | null;
};

type Props = {
  date: string;
  truckId?: string; // scope to one truck (Journal); omit to list all trucks (Fuel)
  type?: string; // e.g. 'FUEL'
  trucks?: { id: string; plate?: string }[];
  title?: string;
  canEdit?: boolean; // when false, render a read-only list (no Edit/Remove)
  reloadSignal?: number; // bump to force a refresh from a parent
  onChanged?: () => void;
};

export default function CostEntriesEditor({
  date,
  truckId,
  type,
  trucks,
  title,
  canEdit = true,
  reloadSignal,
  onChanged,
}: Props) {
  const [rows, setRows] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const plateFor = useMemo(() => {
    const map = new Map<string, string>();
    (trucks || []).forEach((t) => map.set(t.id, t.plate || t.id));
    return (id?: string | null) => (id ? map.get(id) || id : '—');
  }, [trucks]);

  const load = useCallback(async () => {
    if (!date) {
      setRows([]);
      return;
    }
    try {
      setLoading(true);
      const params: Record<string, string> = { from: date, to: date };
      if (truckId) params.truckId = truckId;
      if (type) params.type = type;
      const res = await api.get('/api/admin/costs', { params });
      setRows(Array.isArray(res.data) ? res.data : []);
      setError('');
    } catch (err: any) {
      setRows([]);
      setError(err?.response?.data?.error || err?.message || 'Failed to load entries.');
    } finally {
      setLoading(false);
    }
  }, [date, truckId, type, reloadSignal]);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = (row: CostRow) => {
    setEditingId(row.id);
    setEditAmount(String(row.amount ?? ''));
    setError('');
  };

  async function saveEdit(id: string) {
    const value = parseFloat(editAmount || '0');
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    try {
      setBusyId(id);
      await api.patch(`/api/admin/costs/${id}`, { amount: value });
      setEditingId(null);
      await load();
      onChanged?.();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save.');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Remove this entry? It will no longer count in the dashboards.')) return;
    try {
      setBusyId(id);
      await api.delete(`/api/admin/costs/${id}`);
      await load();
      onChanged?.();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to remove.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className='rounded-2xl border border-slate-200 bg-white p-4'>
      <div className='mb-2 flex items-center justify-between'>
        <h3 className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
          {title || 'Recorded entries — edit or remove'}
        </h3>
        {error && <span className='text-xs font-semibold text-rose-600'>{error}</span>}
      </div>
      <div className='space-y-1 text-sm'>
        {rows.map((row) => {
          const isEditing = editingId === row.id;
          const busy = busyId === row.id;
          return (
            <div
              key={row.id}
              className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2'
            >
              <div className='min-w-0'>
                <span className='font-semibold text-slate-900'>{COST_TYPE_LABELS[row.type] || row.type}</span>
                {!truckId && <span className='ml-2 text-slate-500'>{plateFor(row.truck_id)}</span>}
                {row.description && <span className='ml-2 text-slate-400'>· {row.description}</span>}
              </div>
              <div className='flex items-center gap-2'>
                {isEditing ? (
                  <>
                    <input
                      type='number'
                      inputMode='decimal'
                      min={0}
                      step='0.01'
                      className='w-28 rounded border border-slate-300 px-2 py-1 text-sm'
                      value={editAmount}
                      onChange={(e) => setEditAmount(e.target.value)}
                      autoFocus
                    />
                    <button
                      type='button'
                      onClick={() => saveEdit(row.id)}
                      disabled={busy}
                      className='rounded bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60'
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type='button'
                      onClick={() => setEditingId(null)}
                      className='rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-slate-400'
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className='font-semibold text-slate-800'>KES {Number(row.amount).toLocaleString()}</span>
                    {canEdit && (
                      <>
                        <button
                          type='button'
                          onClick={() => startEdit(row)}
                          className='rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-slate-400'
                        >
                          Edit
                        </button>
                        <button
                          type='button'
                          onClick={() => remove(row.id)}
                          disabled={busy}
                          className='rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:border-rose-300 hover:text-rose-600 disabled:opacity-60'
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
        {!rows.length && (
          <div className='py-3 text-center text-xs text-slate-400'>
            {loading ? 'Loading…' : 'No entries recorded for this day yet.'}
          </div>
        )}
      </div>
    </div>
  );
}
