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
  weight_tonnes?: number | null;
  cost_per_tonne?: number | null;
  photo_path?: string | null;
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

  const [category, setCategory] = useState('');
  const [truckId, setTruckId] = useState('');
  const [trucksIn, setTrucksIn] = useState('');
  const [costPerTonne, setCostPerTonne] = useState('');
  const [weightTonnes, setWeightTonnes] = useState('');
  const [photoData, setPhotoData] = useState('');
  const [photoPreview, setPhotoPreview] = useState('');
  const [photoName, setPhotoName] = useState('');
  const [readingImage, setReadingImage] = useState(false);

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
      return [
        entry.id,
        entry.truck_id,
        entry.reason,
        entry.kind,
        entry.weight_tonnes,
        entry.cost_per_tonne,
      ].some((value) =>
        value ? String(value).toLowerCase().includes(needle) : false
      );
    });
  }, [transactions, filterCategory, filterQuery]);

  const exportCsv = () => {
    if (!filteredTransactions.length) {
      setStatus({ kind: 'error', message: 'No stock transactions match the current filters.' });
      return;
    }
    const header = [
      'Datetime',
      'Kind',
      'Trucks',
      'Weight (t)',
      'Category',
      'Truck ID',
      'KES per tonne',
      'Reason',
      'Photo URL',
    ];
    const rows = filteredTransactions.map((entry) => [
      entry.created_at ? new Date(entry.created_at).toISOString() : '',
      entry.kind,
      entry.trucks,
      entry.weight_tonnes ?? entry.tonnes,
      entry.category,
      entry.truck_id || '',
      entry.cost_per_tonne ?? '',
      (entry.reason || '').replace(/\n/g, ' '),
      entry.photo_path || '',
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

  const resetForm = () => {
    setCategory('');
    setTruckId('');
    setTrucksIn('');
    setCostPerTonne('');
    setWeightTonnes('');
    setPhotoData('');
    setPhotoPreview('');
    setPhotoName('');
    setReadingImage(false);
  };

  async function handlePhotoSelection(file?: File | null) {
    if (!file) {
      setPhotoData('');
      setPhotoPreview('');
      setPhotoName('');
      return;
    }
    setReadingImage(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });
      setPhotoData(dataUrl);
      setPhotoPreview(dataUrl);
      setPhotoName(file.name);
      setStatus({ kind: 'idle', message: '' });
    } catch (err) {
      console.error('Failed to read weighbridge image', err);
      setPhotoData('');
      setPhotoPreview('');
      setPhotoName('');
      setStatus({ kind: 'error', message: 'Failed to read weighbridge image. Try a different file.' });
    } finally {
      setReadingImage(false);
    }
  }

  async function submitReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (readingImage) {
      setStatus({ kind: 'error', message: 'Please wait for the weighbridge photo to finish uploading.' });
      return;
    }
    const categoryValue = category.trim().toLowerCase();
    const trucksValue = parseFloat(trucksIn || '0');
    const costValue = parseFloat(costPerTonne || '0');
    const weightValue = parseFloat(weightTonnes || '0');
    if (!categoryValue) {
      setStatus({ kind: 'error', message: 'Select the sand category being delivered.' });
      return;
    }
    if (!truckId) {
      setStatus({ kind: 'error', message: 'Select the truck delivering this load.' });
      return;
    }
    if (!Number.isFinite(trucksValue) || trucksValue <= 0) {
      setStatus({ kind: 'error', message: 'Enter the number of trucks (must be greater than zero).' });
      return;
    }
    if (!Number.isFinite(weightValue) || weightValue <= 0) {
      setStatus({ kind: 'error', message: 'Capture the weighbridge tonnage for this delivery.' });
      return;
    }
    if (!Number.isFinite(costValue) || costValue <= 0) {
      setStatus({ kind: 'error', message: 'Provide the KES cost per tonne.' });
      return;
    }
    if (!photoData) {
      setStatus({ kind: 'error', message: 'Attach the weighbridge ticket photo.' });
      return;
    }
    try {
      await api.post('/api/admin/stock/receipt', {
        truckId,
        trucks: trucksValue,
        category: categoryValue,
        costPerTonne: costValue,
        weightTonnes: weightValue,
        photoData,
        description: `Weighbridge receipt ${photoName || ''}`.trim(),
      });
      resetForm();
      setStatus({ kind: 'success', message: 'Stock receipt recorded.' });
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

      <form
        onSubmit={submitReceipt}
        className='grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-sm md:grid-cols-6'
      >
        <label className='block md:col-span-2'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Category</span>
          <select
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value=''>Select category…</option>
            <option value='coarse'>Coarse</option>
            <option value='smooth'>Smooth</option>
          </select>
        </label>
        <label className='block md:col-span-2'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Truck</span>
          <select
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={truckId}
            onChange={(e) => setTruckId(e.target.value)}
          >
            <option value=''>Select truck…</option>
            {trucks.map((truck) => (
              <option key={truck.id} value={truck.id}>
                {truck.plate || truck.id}
              </option>
            ))}
          </select>
        </label>
        <label className='block md:col-span-1'>
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
        <label className='block md:col-span-1'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Weight (t)</span>
          <input
            type='number'
            min={0.01}
            step='0.01'
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={weightTonnes}
            onChange={(e) => setWeightTonnes(e.target.value)}
          />
        </label>
        <label className='block md:col-span-2'>
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
        <label className='block md:col-span-3'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Weighbridge photo</span>
          <input
            type='file'
            accept='image/*'
            className='mt-1 w-full rounded border border-dashed border-slate-300 px-2 py-2 text-xs'
            onChange={async (event) => {
              await handlePhotoSelection(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {(photoName || readingImage) && (
            <div className='mt-2 flex items-center justify-between gap-3 rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600'>
              <span className='truncate'>{readingImage ? 'Processing image…' : photoName}</span>
              {photoName && (
                <button
                  type='button'
                  onClick={() => handlePhotoSelection(null)}
                  className='rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-300'
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </label>
        {photoPreview && (
          <div className='md:col-span-3 rounded border border-slate-200 bg-white p-2'>
            <div className='text-[11px] font-semibold uppercase tracking-wide text-slate-500'>Preview</div>
            <img src={photoPreview} alt='Weighbridge ticket preview' className='mt-2 h-32 w-full rounded object-cover' />
          </div>
        )}
        <div className='md:col-span-6 flex flex-wrap items-center gap-2'>
          <button
            type='submit'
            disabled={readingImage}
            className='rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60'
          >
            Record receipt
          </button>
          <button
            type='button'
            onClick={() => {
              resetForm();
              setStatus({ kind: 'idle', message: '' });
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
          {filteredTransactions.map((entry) => {
            const weight = Number(entry.weight_tonnes ?? entry.tonnes ?? 0);
            const weightText = Number.isFinite(weight) && weight > 0 ? `${weight.toFixed(2)} t` : 'n/a';
            const trucksText = Number.isFinite(Number(entry.trucks))
              ? Number(entry.trucks || 0).toFixed(2)
              : '0.00';
            const cost = Number(entry.cost_per_tonne ?? 0);
            const costText = Number.isFinite(cost) && cost > 0 ? `KES ${cost.toLocaleString()}` : 'n/a';
            return (
              <div key={entry.id} className='flex items-start justify-between border-b py-2'>
                <div className='space-y-1'>
                  <div className='font-semibold text-slate-900'>
                    {entry.created_at ? new Date(entry.created_at).toLocaleString() : 'Timestamp pending'}
                  </div>
                  <div className='text-slate-600'>
                    • {entry.kind} • {trucksText} trucks ({entry.category || 'n/a'}) • Truck {entry.truck_id || '-'}
                  </div>
                  <div className='text-slate-600'>Weight: {weightText} • Cost/tonne: {costText}</div>
                  <div className='flex flex-wrap items-center gap-2 text-slate-500'>
                    <span>{entry.reason || 'No note recorded'}</span>
                    {entry.photo_path && (
                      <a
                        href={entry.photo_path}
                        target='_blank'
                        rel='noreferrer'
                        className='rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-slate-400'
                      >
                        View ticket
                      </a>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setEditingTx({ id: entry.id, reason: entry.reason || '' })}
                  className='rounded border border-slate-300 px-2 py-1 text-slate-600 hover:border-slate-400'
                >
                  Edit note
                </button>
              </div>
            );
          })}
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
