import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type AuditEntity = 'COST' | 'FUEL';
type AuditStatus = 'pending' | 'reviewed' | 'voided';

type AuditRecord = {
  entity: AuditEntity;
  id: string;
  truckId: string | null;
  truckPlate: string | null;
  driverId: string | null;
  driverName: string | null;
  type?: string;
  amount?: number | null;
  description?: string;
  litres?: number | null;
  cost?: number | null;
  odometer?: number | null;
  mileage?: number | null;
  note?: string;
  incurredAt?: string | null;
  capturedAt?: string | null;
  createdAt?: string | null;
  eventAt?: string | null;
  duplicateOf?: string | null;
  createdBy?: number | null;
  createdByName?: string | null;
  createdByEmail?: string | null;
  confirmedBy?: number | null;
  confirmedByName?: string | null;
  confirmedAt?: string | null;
  reviewedBy?: number | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  voidedBy?: number | null;
  voidedByName?: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  status: AuditStatus;
  linkedCostId?: string | null;
};

type TruckOption = { id: string; plate?: string };

const COST_TYPES = [
  'FUEL',
  'SALARY',
  'REPAIR',
  'MAINTENANCE',
  'LOADING',
  'OFFLOADING',
  'STOCK_PURCHASE',
  'OTHER',
];

const STATUS_BADGES: Record<AuditStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  reviewed: 'bg-emerald-100 text-emerald-700',
  voided: 'bg-rose-100 text-rose-700',
};

const entityLabel = (value: AuditEntity) => (value === 'COST' ? 'Cost' : 'Fuel log');

const STATUS_ORDER: AuditStatus[] = ['pending', 'reviewed', 'voided'];

export default function AdminAuditConsole() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<'all' | 'cost' | 'fuel'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AuditStatus>('pending');
  const [typeFilter, setTypeFilter] = useState('');
  const [truckFilter, setTruckFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [trucks, setTrucks] = useState<TruckOption[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [forms, setForms] = useState<
    Record<string, { reviewNote: string; voidReason: string; cascadeCost: boolean }>
  >({});

  const loadTrucks = useCallback(async () => {
    try {
      const res = await api.get('/api/admin/trucks');
      setTrucks(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.warn('Audit console truck load failed', err);
    }
  }, []);

  useEffect(() => {
    loadTrucks();
  }, [loadTrucks]);

  const loadRecords = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, any> = { limit: 400 };
      if (entityFilter !== 'all') params.entity = entityFilter;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter.trim()) params.type = typeFilter.trim();
      if (truckFilter.trim()) params.truckId = truckFilter.trim();
      if (fromDate) params.from = fromDate;
      if (toDate) params.to = toDate;
      const res = await api.get('/api/admin/audit/duplicates', { params });
      const data: AuditRecord[] = Array.isArray(res.data) ? res.data : [];
      data.sort((a, b) => {
        const aTime = a?.eventAt ? new Date(a.eventAt).getTime() : 0;
        const bTime = b?.eventAt ? new Date(b.eventAt).getTime() : 0;
        return bTime - aTime;
      });
      setRecords(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load duplicate records.');
    } finally {
      setLoading(false);
    }
  }, [entityFilter, statusFilter, typeFilter, truckFilter, fromDate, toDate]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  const stats = useMemo(() => {
    const summary: Record<AuditStatus, number> = { pending: 0, reviewed: 0, voided: 0 };
    for (const record of records) {
      summary[record.status] = (summary[record.status] || 0) + 1;
    }
    return summary;
  }, [records]);

  const handleExpand = (key: string) => {
    setExpanded((prev) => (prev === key ? null : key));
    setForms((prev) =>
      prev[key]
        ? prev
        : {
            ...prev,
            [key]: {
              reviewNote: '',
              voidReason: '',
              cascadeCost: false,
            },
          }
    );
  };

  const handleFormChange = (
    key: string,
    update: Partial<{ reviewNote: string; voidReason: string; cascadeCost: boolean }>
  ) => {
    setForms((prev) => ({
      ...prev,
      [key]: {
        reviewNote: prev[key]?.reviewNote || '',
        voidReason: prev[key]?.voidReason || '',
        cascadeCost: prev[key]?.cascadeCost || false,
        ...update,
      },
    }));
  };

  const performReview = async (record: AuditRecord) => {
    const key = `${record.entity}-${record.id}`;
    setActionBusy(key);
    try {
      const payload = { note: forms[key]?.reviewNote?.trim() || '' };
      await api.post(`/api/admin/audit/duplicates/${record.entity.toLowerCase()}/${record.id}/review`, payload);
      await loadRecords();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to mark record as reviewed.');
    } finally {
      setActionBusy(null);
    }
  };

  const performVoid = async (record: AuditRecord) => {
    const key = `${record.entity}-${record.id}`;
    const reason = forms[key]?.voidReason?.trim() || '';
    if (!reason) {
      setError('Provide a reason before voiding the duplicate record.');
      return;
    }
    setActionBusy(key);
    try {
      const payload: any = { reason };
      if (record.entity === 'FUEL' && forms[key]?.cascadeCost) {
        payload.cascadeCost = true;
      }
      await api.post(`/api/admin/audit/duplicates/${record.entity.toLowerCase()}/${record.id}/void`, payload);
      await loadRecords();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to void duplicate record.');
    } finally {
      setActionBusy(null);
    }
  };

  const uniqueCostTypes = useMemo(() => {
    const types = new Set<string>();
    records.filter((r) => r.entity === 'COST' && r.type).forEach((r) => types.add(r.type!));
    return Array.from(types).sort();
  }, [records]);

  return (
    <div className='space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-sm font-semibold text-slate-900'>Audit console</h2>
          <p className='text-xs text-slate-500'>
            Review duplicate cost and fuel entries, add notes, or roll back erroneous submissions.
          </p>
        </div>
        <button
          onClick={loadRecords}
          className='rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-slate-400'
        >
          Refresh
        </button>
      </div>

      <div className='grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-xs md:grid-cols-6'>
        <label className='block'>
          <span className='font-semibold uppercase tracking-wide text-slate-500'>Entity</span>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value as 'all' | 'cost' | 'fuel')}
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
          >
            <option value='all'>All</option>
            <option value='cost'>Costs</option>
            <option value='fuel'>Fuel logs</option>
          </select>
        </label>
        <label className='block'>
          <span className='font-semibold uppercase tracking-wide text-slate-500'>Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | AuditStatus)}
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
          >
            <option value='all'>Any</option>
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className='block'>
          <span className='font-semibold uppercase tracking-wide text-slate-500'>Type</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
          >
            <option value=''>All</option>
            {(entityFilter === 'fuel'
              ? ['FUEL']
              : Array.from(new Set([...COST_TYPES, ...uniqueCostTypes, 'FUEL']))).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <label className='block'>
          <span className='font-semibold uppercase tracking-wide text-slate-500'>Truck</span>
          <input
            list='audit-trucks'
            value={truckFilter}
            onChange={(e) => setTruckFilter(e.target.value)}
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            placeholder='Filter by truck ID'
          />
          <datalist id='audit-trucks'>
            {trucks.map((truck) => (
              <option key={truck.id} value={truck.id}>
                {truck.plate || truck.id}
              </option>
            ))}
          </datalist>
        </label>
        <label className='block'>
          <span className='font-semibold uppercase tracking-wide text-slate-500'>From</span>
          <input
            type='date'
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
          />
        </label>
        <label className='block'>
          <span className='font-semibold uppercase tracking-wide text-slate-500'>To</span>
          <input
            type='date'
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
          />
        </label>
      </div>

      <div className='grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 text-xs md:grid-cols-3'>
        {STATUS_ORDER.map((status) => (
          <div key={status} className='rounded-lg border border-slate-200 bg-white px-3 py-2'>
            <div className='font-semibold text-slate-600'>{status.charAt(0).toUpperCase() + status.slice(1)}</div>
            <div className='text-lg font-bold text-slate-900'>{stats[status] || 0}</div>
          </div>
        ))}
      </div>

      {error && <div className='rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700'>{error}</div>}

      <div className='rounded-3xl border border-slate-200 bg-white p-4'>
        {loading ? (
          <div className='rounded-xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-600'>
            Loading duplicate records…
          </div>
        ) : records.length === 0 ? (
          <div className='rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500'>
            No duplicate submissions match the selected filters.
          </div>
        ) : (
          <ul className='space-y-4'>
            {records.map((record) => {
              const key = `${record.entity}-${record.id}`;
              const statusPill = STATUS_BADGES[record.status] || 'bg-slate-200 text-slate-600';
              const isExpanded = expanded === key;
              const formState = forms[key] || { reviewNote: '', voidReason: '', cascadeCost: false };
              const isActionDisabled = actionBusy === key || record.status === 'voided';
              return (
                <li key={key} className='rounded-2xl border border-slate-100 bg-slate-50/70 p-4'>
                  <div className='flex flex-wrap items-center justify-between gap-3 text-sm text-slate-700'>
                    <div className='flex flex-col gap-1'>
                      <div className='flex items-center gap-2'>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusPill}`}>
                          {record.status.toUpperCase()}
                        </span>
                        <span className='text-xs uppercase tracking-wide text-slate-500'>
                          {entityLabel(record.entity)}
                          {record.entity === 'COST' && record.type ? ` · ${record.type}` : ''}
                        </span>
                      </div>
                      <div className='text-sm font-semibold text-slate-900'>
                        {record.truckPlate || record.truckId || 'Unknown truck'}
                      </div>
                      <div className='text-xs text-slate-500'>
                        {record.eventAt ? new Date(record.eventAt).toLocaleString() : 'Timestamp not recorded'}
                        {record.duplicateOf ? ` · Duplicate of ${record.duplicateOf}` : ''}
                      </div>
                    </div>
                    <div className='flex flex-wrap items-center gap-2 text-xs text-slate-500'>
                      {record.entity === 'COST' && typeof record.amount === 'number' && (
                        <span className='rounded-full bg-slate-900/90 px-2 py-1 font-semibold text-white'>
                          KES {record.amount.toLocaleString()}
                        </span>
                      )}
                      {record.entity === 'FUEL' && record.litres !== null && (
                        <span className='rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-700'>
                          {record.litres?.toLocaleString()} L
                        </span>
                      )}
                      {record.entity === 'FUEL' && record.cost !== null && (
                        <span className='rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-700'>
                          KES {record.cost?.toLocaleString()}
                        </span>
                      )}
                      <button
                        onClick={() => handleExpand(key)}
                        className='rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:border-slate-400'
                      >
                        {isExpanded ? 'Hide details' : 'View details'}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className='mt-3 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600'>
                      <div className='grid gap-2 sm:grid-cols-2'>
                        <DetailLine label='Created by' value={record.createdByName || 'Not captured'} secondary={record.createdByEmail || undefined} />
                        <DetailLine label='Confirmed by' value={record.confirmedByName || 'Not confirmed'} secondary={record.confirmedAt ? new Date(record.confirmedAt).toLocaleString() : undefined} />
                        <DetailLine label='Reviewed by' value={record.reviewedByName || 'Pending'} secondary={record.reviewedAt ? new Date(record.reviewedAt).toLocaleString() : undefined} />
                        <DetailLine label='Voided by' value={record.voidedByName || 'Active'} secondary={record.voidedAt ? new Date(record.voidedAt).toLocaleString() : undefined} />
                      </div>

                      {record.description && record.entity === 'COST' && (
                        <DetailLine label='Description' value={record.description} />
                      )}
                      {record.note && record.entity === 'FUEL' && (
                        <DetailLine label='Note' value={record.note} />
                      )}
                      {record.reviewNote && (
                        <DetailLine label='Review note' value={record.reviewNote} />
                      )}
                      {record.voidReason && (
                        <DetailLine label='Void reason' value={record.voidReason} />
                      )}
                      {record.linkedCostId && record.entity === 'FUEL' && (
                        <DetailLine label='Linked cost entry' value={record.linkedCostId} />
                      )}

                      <div className='grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2'>
                        <div>
                          <label className='mb-1 block font-semibold uppercase tracking-wide text-slate-500'>
                            Review note
                          </label>
                          <textarea
                            value={formState.reviewNote}
                            onChange={(e) => handleFormChange(key, { reviewNote: e.target.value })}
                            rows={3}
                            placeholder='Optional note when marking as reviewed'
                            className='w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none'
                          />
                        </div>
                        <div>
                          <label className='mb-1 block font-semibold uppercase tracking-wide text-slate-500'>
                            Void reason
                          </label>
                          <textarea
                            value={formState.voidReason}
                            onChange={(e) => handleFormChange(key, { voidReason: e.target.value })}
                            rows={3}
                            placeholder='Explain why the duplicate should be voided'
                            className='w-full rounded border border-slate-300 px-2 py-1 text-xs focus:border-slate-500 focus:outline-none'
                          />
                          {record.entity === 'FUEL' && (
                            <label className='mt-2 flex items-center gap-2 text-[11px] text-slate-600'>
                              <input
                                type='checkbox'
                                checked={formState.cascadeCost}
                                onChange={(e) => handleFormChange(key, { cascadeCost: e.target.checked })}
                              />
                              Also void matching fuel cost entry
                            </label>
                          )}
                        </div>
                      </div>

                      <div className='flex flex-wrap gap-2 pt-2 text-xs'>
                        <button
                          onClick={() => performReview(record)}
                          disabled={isActionDisabled}
                          className='rounded bg-slate-900 px-3 py-2 font-semibold text-white shadow hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60'
                        >
                          {actionBusy === key ? 'Saving…' : 'Mark as reviewed'}
                        </button>
                        <button
                          onClick={() => performVoid(record)}
                          disabled={isActionDisabled}
                          className='rounded border border-rose-400 px-3 py-2 font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60'
                        >
                          {actionBusy === key ? 'Voiding…' : 'Void entry'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function DetailLine({ label, value, secondary }: { label: string; value: string; secondary?: string }) {
  return (
    <div>
      <div className='text-[11px] font-semibold uppercase tracking-wide text-slate-500'>{label}</div>
      <div className='text-xs text-slate-700'>{value || '—'}</div>
      {secondary && <div className='text-[11px] text-slate-500'>{secondary}</div>}
    </div>
  );
}
