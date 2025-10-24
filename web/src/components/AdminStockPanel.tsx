import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type StockSummary = {
  yard_name: string;
  tonnes: number;
  trucks_coarse: number;
  trucks_smooth: number;
  unit_tonnes: number;
  trucks_total?: number;
};

type StockTransaction = {
  id: string;
  created_at: string;
  kind: string;
  trucks: number;
  tonnes: number;
  category: string;
  truck_id?: string | null;
  reason?: string | null;
};

type TruckOption = { id: string; plate?: string };

type Status = { kind: 'idle' | 'success' | 'error'; message: string };

function StockBadge({ title, value, detail }: { title: string; value: number; detail: string }) {
  return (
    <div className='rounded-2xl border border-amber-50 bg-amber-50/60 p-3'>
      <div className='text-xs uppercase tracking-wide text-slate-500'>{title}</div>
      <div className='mt-1 text-xl font-bold text-slate-900'>{value.toLocaleString()}</div>
      <div className='text-[11px] text-slate-500'>{detail}</div>
    </div>
  );
}

export default function AdminStockPanel() {
  const [stock, setStock] = useState<StockSummary>({
    yard_name: 'Main yard',
    tonnes: 0,
    trucks_coarse: 0,
    trucks_smooth: 0,
    unit_tonnes: 20,
  });
  const [transactions, setTransactions] = useState<StockTransaction[]>([]);
  const [trucks, setTrucks] = useState<TruckOption[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });
  const [loading, setLoading] = useState(true);

  const [category, setCategory] = useState<'coarse' | 'smooth'>('coarse');
  const [truckId, setTruckId] = useState('');
  const [trucksIn, setTrucksIn] = useState('');
  const [costPerTonne, setCostPerTonne] = useState('');

  const [filterCategory, setFilterCategory] = useState<'all' | 'coarse' | 'smooth'>('all');
  const [filterQuery, setFilterQuery] = useState('');

  const [editingTx, setEditingTx] = useState<{ id: string; reason: string } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [stockRes, txRes, trucksRes] = await Promise.all([
        api.get('/api/admin/stock'),
        api.get('/api/admin/stock/tx'),
        api.get('/api/admin/trucks'),
      ]);
      setStock(stockRes.data);
      setTransactions(Array.isArray(txRes.data) ? txRes.data : []);
      setTrucks(Array.isArray(trucksRes.data) ? trucksRes.data : []);
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to load stock data.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredTransactions = useMemo(() => {
    const byCategory = (entry: StockTransaction) =>
      filterCategory === 'all' || (entry.category || '').toLowerCase() === filterCategory;
    const needle = filterQuery.trim().toLowerCase();
    return transactions.filter((entry) => {
      if (!byCategory(entry)) return false;
      if (!needle) return true;
      return [entry.id, entry.truck_id, entry.reason, entry.kind].some((value) =>
        value ? String(value).toLowerCase().includes(needle) : false
      );
    });
  }, [transactions, filterCategory, filterQuery]);

  const exportCsv = () => {
    if (!filteredTransactions.length) {
      setStatus({ kind: 'error', message: 'No stock transactions match the current filters.' });
      return;
    }
    const header = ['Datetime', 'Kind', 'Trucks', 'Tonnes', 'Category', 'Truck ID', 'Reason'];
    const rows = filteredTransactions.map((entry) => [
      entry.created_at ? new Date(entry.created_at).toISOString() : '',
      entry.kind,
      entry.trucks,
      entry.tonnes,
      entry.category,
      entry.truck_id || '',
      (entry.reason || '').replace(/\n/g, ' '),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'stock-transactions.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  async function submitReceipt(e: React.FormEvent) {
    e.preventDefault();
    const trucksValue = parseFloat(trucksIn || '0');
    const costValue = parseFloat(costPerTonne || '0');
    if (!truckId) {
      setStatus({ kind: 'error', message: 'Select the truck receiving stock.' });
      return;
    }
    if (!Number.isFinite(trucksValue) || trucksValue <= 0) {
      setStatus({ kind: 'error', message: 'Enter trucks received (must be greater than zero).' });
      return;
    }
    if (!Number.isFinite(costValue) || costValue <= 0) {
      setStatus({ kind: 'error', message: 'Provide cost per tonne (KES).' });
      return;
    }
    try {
      await api.post('/api/admin/stock/receipt', {
        truckId,
        trucks: trucksValue,
        category,
        costPerTonne: costValue,
        description: 'Yard receipt',
      });
      setStatus({ kind: 'success', message: 'Stock receipt recorded.' });
      setTruckId('');
      setTrucksIn('');
      setCostPerTonne('');
      await load();
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to record stock receipt.',
      });
    }
  }

  async function saveTransactionNote() {
    if (!editingTx) return;
    const reason = editingTx.reason.trim();
    if (!reason) {
      setStatus({ kind: 'error', message: 'Add a short note for this transaction.' });
      return;
    }
    try {
      setSavingEdit(true);
      await api.patch(`/api/admin/stock/tx/${editingTx.id}`, { reason });
      setStatus({ kind: 'success', message: 'Transaction note updated.' });
      setEditingTx(null);
      await load();
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to update transaction.',
      });
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className='space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-sm font-semibold text-slate-900'>Stock receipts & adjustments</h2>
          <p className='text-xs text-slate-500'>
            Record incoming loads and keep notes on each stock movement for audit transparency.
          </p>
        </div>
        <button
          onClick={() => load()}
          className='rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-slate-400'
        >
          Refresh
        </button>
      </div>

      <div className='grid gap-3 text-xs md:grid-cols-3'>
        <StockBadge
          title='Coarse trucks'
          value={stock.trucks_coarse || 0}
          detail={`${(stock.trucks_coarse * (stock.unit_tonnes || 20)).toLocaleString()} t`}
        />
        <StockBadge
          title='Smooth trucks'
          value={stock.trucks_smooth || 0}
          detail={`${(stock.trucks_smooth * (stock.unit_tonnes || 20)).toLocaleString()} t`}
        />
        <StockBadge
          title='Total trucks'
          value={
            stock.trucks_total ?? (Number(stock.trucks_coarse || 0) + Number(stock.trucks_smooth || 0))
          }
          detail={`${Number(stock.tonnes || 0).toLocaleString()} t`}
        />
      </div>

      <form onSubmit={submitReceipt} className='grid gap-2 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-sm md:grid-cols-5'>
        <label className='block'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Category</span>
          <select
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={category}
            onChange={(e) => setCategory(e.target.value as 'coarse' | 'smooth')}
          >
            <option value='coarse'>Coarse</option>
            <option value='smooth'>Smooth</option>
          </select>
        </label>
        <label className='block'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Trucks</span>
          <input
            type='number'
            min={0.01}
            step='0.01'
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={trucksIn}
            onChange={(e) => setTrucksIn(e.target.value)}
          />
        </label>
        <label className='block md:col-span-2'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Truck</span>
          <select
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={truckId}
            onChange={(e) => setTruckId(e.target.value)}
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
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>KES per tonne</span>
          <input
            type='number'
            min={0.01}
            step='0.01'
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={costPerTonne}
            onChange={(e) => setCostPerTonne(e.target.value)}
          />
        </label>
        <div className='md:col-span-5 flex items-center gap-2'>
          <button
            type='submit'
            className='rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800'
          >
            Record receipt
          </button>
          <button
            type='button'
            onClick={() => {
              setTruckId('');
              setTrucksIn('');
              setCostPerTonne('');
              setCategory('coarse');
            }}
            className='rounded border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:border-slate-400'
          >
            Clear
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
      </form>

      <div className='rounded-2xl border border-slate-200 p-4'>
        <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
          <h3 className='text-sm font-semibold text-slate-900'>Transaction history</h3>
          <div className='flex items-center gap-2 text-xs'>
            <select
              className='rounded border border-slate-300 px-2 py-1'
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value as 'all' | 'coarse' | 'smooth')}
            >
              <option value='all'>Category: all</option>
              <option value='coarse'>Coarse</option>
              <option value='smooth'>Smooth</option>
            </select>
            <input
              className='rounded border border-slate-300 px-2 py-1'
              placeholder='Search notes or truck'
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
            <button
              onClick={exportCsv}
              className='rounded border border-slate-300 px-2 py-1 hover:border-slate-400'
            >
              Export CSV
            </button>
          </div>
        </div>
        <div className='max-h-80 overflow-auto text-xs'>
          {filteredTransactions.map((entry) => (
            <div key={entry.id} className='flex items-start justify-between border-b py-2'>
              <div>
                <div className='font-semibold text-slate-900'>
                  {entry.created_at ? new Date(entry.created_at).toLocaleString() : 'Timestamp pending'}
                </div>
                <div className='text-slate-600'>
                  • {entry.kind} {Number(entry.trucks || 0).toFixed(2)} trucks ({entry.category || 'n/a'}) • Truck{' '}
                  {entry.truck_id || '-'}
                </div>
                <div className='text-slate-500'>{entry.reason || 'No note recorded'}</div>
              </div>
              <button
                onClick={() => setEditingTx({ id: entry.id, reason: entry.reason || '' })}
                className='rounded border border-slate-300 px-2 py-1 text-slate-600 hover:border-slate-400'
              >
                Edit note
              </button>
            </div>
          ))}
          {!filteredTransactions.length && (
            <div className='py-6 text-center text-slate-500'>
              {loading ? 'Loading transactions...' : 'No records match the current filters.'}
            </div>
          )}
        </div>
      </div>

      {editingTx && (
        <div className='rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 p-4 text-sm'>
          <div className='font-semibold text-slate-900'>Update transaction note</div>
          <textarea
            className='mt-2 h-24 w-full rounded border border-slate-300 px-2 py-1 text-sm'
            value={editingTx.reason}
            onChange={(e) => setEditingTx((prev) => (prev ? { ...prev, reason: e.target.value } : prev))}
          />
          <div className='mt-3 flex items-center gap-2 text-xs'>
            <button
              onClick={saveTransactionNote}
              disabled={savingEdit}
              className='rounded bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-800 disabled:opacity-60'
            >
              {savingEdit ? 'Saving...' : 'Save note'}
            </button>
            <button
              onClick={() => setEditingTx(null)}
              className='rounded border border-slate-300 px-2 py-1 text-slate-600 hover:border-slate-400'
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
