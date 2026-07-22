import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type CostRecord = {
  id: string;
  truck_id?: string | null;
  driver_id?: string | null;
  type: string;
  amount: number;
  description?: string | null;
  incurred_at?: string | null;
  created_at?: string | null;
  is_duplicate?: number | boolean;
  duplicate_of?: string | null;
  confirmed_by?: number | null;
  confirmed_at?: string | null;
};

type TruckOption = {
  id: string;
  plate?: string;
  primaryDriverId?: string | null;
  driverName?: string | null;
  tanboyName?: string | null;
  tanboyPhone?: string | null;
};

type DriverOption = {
  id: string;
  name: string;
  phone?: string | null;
  assignedTruckId?: string | null;
  assignedTruckPlate?: string | null;
};

type Status = { kind: 'idle' | 'success' | 'error'; message: string };

type CostPayload = {
  truckId: string;
  type: string;
  amount: number;
  description: string;
  incurredAt?: string;
  driverId?: string;
};

type DuplicateCostPrompt = {
  message: string;
  existing: Partial<CostRecord> | null;
  payload: CostPayload;
};

const COST_TYPE_GROUPS: { label: string; types: string[] }[] = [
  {
    label: 'Trip costs',
    types: ['CUTTING', 'LOADING', 'OFFLOADING', 'EXCHANGE', 'DRIVER_TIP', 'MWINGI_TRIP'],
  },
  {
    label: 'Vehicle costs',
    types: ['FUEL', 'REPAIR', 'MAINTENANCE', 'CAR_WASH', 'GREASING', 'TIRE_REPAIR', 'CESS'],
  },
  {
    label: 'Salary',
    types: ['SALARY_DRIVER', 'SALARY_TANBOY'],
  },
  {
    label: 'Other',
    types: ['STOCK_PURCHASE', 'OTHER'],
  },
];

const COST_TYPES = COST_TYPE_GROUPS.flatMap((g) => g.types);
const SALARY_TYPES = ['SALARY_DRIVER', 'SALARY_TANBOY'];

export const COST_TYPE_LABELS: Record<string, string> = {
  CUTTING: 'Cutting',
  LOADING: 'Loading',
  OFFLOADING: 'Off-loading',
  EXCHANGE: 'Exchange',
  DRIVER_TIP: 'Driver tip',
  MWINGI_TRIP: 'Mwingi trip',
  FUEL: 'Fuel',
  REPAIR: 'Repair',
  MAINTENANCE: 'Maintenance',
  CAR_WASH: 'Car wash',
  GREASING: 'Greasing',
  TIRE_REPAIR: 'Tire repair',
  CESS: 'Cess',
  SALARY_DRIVER: 'Driver salary',
  SALARY_TANBOY: 'Tanboy salary',
  STOCK_PURCHASE: 'Stock purchase',
  OTHER: 'Other',
};

type CostFormState = {
  type: string;
  truckId: string;
  driverId: string;
  amount: string;
  description: string;
  incurredAt: string;
};

const createEmptyFormState = (): CostFormState => ({
  type: '',
  truckId: '',
  driverId: '',
  amount: '',
  description: '',
  incurredAt: '',
});

export default function AdminCostsPanel() {
  const [rows, setRows] = useState<CostRecord[]>([]);
  const [trucks, setTrucks] = useState<TruckOption[]>([]);
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });
  const [loading, setLoading] = useState(true);
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicateCostPrompt | null>(null);
  const [confirmingDuplicate, setConfirmingDuplicate] = useState(false);

  const [form, setForm] = useState<CostFormState>(createEmptyFormState);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [filterType, setFilterType] = useState<'all' | string>('all');
  const [filterTruck, setFilterTruck] = useState<'all' | string>('all');
  const [filterText, setFilterText] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [costRes, truckRes, driverRes] = await Promise.all([
        api.get('/api/admin/costs'),
        api.get('/api/admin/trucks'),
        api.get('/api/admin/drivers'),
      ]);
      const costRows: CostRecord[] = Array.isArray(costRes.data) ? costRes.data : [];
      const truckRows: TruckOption[] = Array.isArray(truckRes.data) ? truckRes.data : [];
      const driverRows = Array.isArray(driverRes.data) ? driverRes.data : [];
      setRows(costRows);
      setTrucks(truckRows);
      const truckByDriver = new Map<string, TruckOption>();
      for (const truck of truckRows) {
        if (truck?.primaryDriverId) {
          truckByDriver.set(truck.primaryDriverId, truck);
        }
      }
      const driverOptions: DriverOption[] = driverRows.map((driver: any) => {
        const assigned = truckByDriver.get(driver.id);
        return {
          id: driver.id,
          name: driver.name || driver.id,
          phone: driver.phone || '',
          assignedTruckId: assigned?.id || null,
          assignedTruckPlate: assigned?.plate || null,
        };
      });
      setDrivers(driverOptions);
      setStatus({ kind: 'idle', message: '' });
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to load cost records.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const typeFilter = filterType === 'all' ? null : filterType;
    const truckFilter = filterTruck === 'all' ? null : filterTruck;
    const needle = filterText.trim().toLowerCase();
    return rows.filter((row) => {
      if (typeFilter && row.type !== typeFilter) return false;
      if (truckFilter && row.truck_id !== truckFilter) return false;
      if (!needle) return true;
      return [row.description, row.truck_id, row.type].some((value) =>
        value ? String(value).toLowerCase().includes(needle) : false
      );
    });
  }, [rows, filterType, filterTruck, filterText]);

  const truckById = useMemo(() => {
    const map = new Map<string, TruckOption>();
    trucks.forEach((truck) => map.set(truck.id, truck));
    return map;
  }, [trucks]);

  const driverById = useMemo(() => {
    const map = new Map<string, DriverOption>();
    drivers.forEach((driver) => map.set(driver.id, driver));
    return map;
  }, [drivers]);

  const selectedDriver = form.driverId ? driverById.get(form.driverId) || null : null;
  const driverDefaultTruckId = selectedDriver?.assignedTruckId || null;
  const driverDefaultTruckLabel = driverDefaultTruckId
    ? truckById.get(driverDefaultTruckId)?.plate ||
      selectedDriver?.assignedTruckPlate ||
      driverDefaultTruckId
    : null;
  const formTruckLabel = form.truckId ? truckById.get(form.truckId)?.plate || form.truckId : null;
  const showTruckLabel = formTruckLabel || driverDefaultTruckLabel;
  const driverTruckMismatch =
    Boolean(formTruckLabel && driverDefaultTruckLabel && formTruckLabel !== driverDefaultTruckLabel);

  const exportCsv = () => {
    if (!filteredRows.length) {
      setStatus({ kind: 'error', message: 'No cost records match the current filters.' });
      return;
    }
    const header = ['Datetime', 'Type', 'Driver', 'Truck', 'Amount', 'Description'];
    const data = filteredRows.map((row) => [
      row.incurred_at ? new Date(row.incurred_at).toISOString() : '',
      row.type,
      row.driver_id ? driverById.get(row.driver_id)?.name || row.driver_id : '',
      row.truck_id ? truckById.get(row.truck_id)?.plate || row.truck_id : '',
      row.amount,
      (row.description || '').replace(/\n/g, ' '),
    ]);
    const csv = [header, ...data]
      .map((line) => line.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'costs.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setDuplicatePrompt(null);
    const amountValue = parseFloat(form.amount || '0');
    if (!form.type) {
      setStatus({ kind: 'error', message: 'Select a cost category.' });
      return;
    }
    if (form.type === 'SALARY_DRIVER' && !form.driverId) {
      setStatus({ kind: 'error', message: 'Select the driver receiving this salary.' });
      return;
    }
    if (!form.truckId) {
      setStatus({
        kind: 'error',
        message:
          form.type === 'SALARY_DRIVER'
            ? 'The selected driver is not linked to a truck. Assign them to a truck first.'
            : 'Select the truck for this cost.',
      });
      return;
    }
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setStatus({ kind: 'error', message: 'Enter an amount greater than zero.' });
      return;
    }
    if (form.type === 'OTHER' && !form.description.trim()) {
      setStatus({ kind: 'error', message: 'Provide a short description for "Other" costs.' });
      return;
    }
    const truckForForm = form.truckId ? truckById.get(form.truckId) || null : null;
    const autoDescription =
      form.type === 'SALARY_TANBOY' && truckForForm?.tanboyName
        ? `Tanboy: ${truckForForm.tanboyName}`
        : '';
    const payload: CostPayload = {
      truckId: form.truckId,
      type: form.type,
      amount: amountValue,
      description: form.description.trim() || autoDescription,
      incurredAt: form.incurredAt ? new Date(form.incurredAt).toISOString() : undefined,
    };
    if (form.driverId) {
      payload.driverId = form.driverId;
    }
    try {
      if (editingId) {
        await api.patch(`/api/admin/costs/${editingId}`, payload);
        setStatus({ kind: 'success', message: 'Cost updated successfully.' });
        setForm(createEmptyFormState());
        setEditingId(null);
      } else {
        await api.post('/api/admin/costs', payload);
        setStatus({ kind: 'success', message: 'Cost recorded. Add the next one below.' });
        // Keep the truck/driver/date selected so logging several costs for the same trip
        // doesn't mean re-picking the truck every time — only category/amount/description clear.
        setForm((prev) => ({
          ...createEmptyFormState(),
          truckId: prev.truckId,
          incurredAt: prev.incurredAt,
        }));
      }
      await load();
    } catch (err: any) {
      if (!editingId && err?.response?.status === 409 && err?.response?.data?.duplicate) {
        setDuplicatePrompt({
          message: err?.response?.data?.message || 'Potential duplicate cost detected.',
          existing: err?.response?.data?.existing || null,
          payload,
        });
        setStatus({
          kind: 'error',
          message: 'Potential duplicate found. Review the details below before confirming.',
        });
        return;
      }
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to save cost record.',
      });
    }
  }

  const startEdit = (row: CostRecord) => {
    setEditingId(row.id);
    setForm({
      type: row.type,
      truckId: row.truck_id || '',
      driverId: row.driver_id || '',
      amount: row.amount?.toString() || '',
      description: row.description || '',
      incurredAt: row.incurred_at ? row.incurred_at.slice(0, 16) : '',
    });
    setStatus({ kind: 'idle', message: '' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(createEmptyFormState());
    setStatus({ kind: 'idle', message: '' });
  };

  const confirmDuplicate = async () => {
    if (!duplicatePrompt) return;
    const duplicateOf = duplicatePrompt.existing?.duplicate_of || duplicatePrompt.existing?.id || null;
    try {
      setConfirmingDuplicate(true);
      await api.post('/api/admin/costs', {
        ...duplicatePrompt.payload,
        overrideDuplicate: true,
        duplicateOf: duplicateOf || undefined,
      });
      setStatus({ kind: 'success', message: 'Duplicate cost recorded and flagged for audit.' });
      setForm(createEmptyFormState());
      setEditingId(null);
      setDuplicatePrompt(null);
      await load();
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to confirm duplicate cost.',
      });
    } finally {
      setConfirmingDuplicate(false);
    }
  };

  const dismissDuplicatePrompt = () => {
    setDuplicatePrompt(null);
    setStatus({ kind: 'idle', message: '' });
  };

  const duplicateExistingDriverLabel = duplicatePrompt?.existing?.driver_id
    ? driverById.get(duplicatePrompt.existing.driver_id)?.name ||
      duplicatePrompt.existing.driver_id ||
      ''
    : '';
  const duplicateNewDriverLabel = duplicatePrompt?.payload?.driverId
    ? driverById.get(duplicatePrompt.payload.driverId)?.name || duplicatePrompt.payload.driverId || ''
    : '';

  return (
    <div className='space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
      <div className='flex items-center justify-between'>
      <div>
        <h2 className='text-sm font-semibold text-slate-900'>Cost ledger</h2>
        <p className='text-xs text-slate-500'>
          Capture fleet expenditure per truck and keep an auditable trail with notes.
        </p>
      </div>
      <button
        onClick={() => load()}
        className='rounded border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:border-slate-400'
      >
        Refresh
      </button>
    </div>

    {duplicatePrompt && (
      <div className='rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900'>
        <div>
          <h3 className='text-sm font-semibold text-amber-700'>Possible duplicate cost detected</h3>
          <p className='mt-1 text-xs text-amber-800'>
            {duplicatePrompt.message || 'An existing cost entry closely matches this submission.'}
          </p>
        </div>
        <div className='mt-3 grid gap-3 sm:grid-cols-2'>
          <div>
            <div className='text-[11px] font-semibold uppercase tracking-wide text-amber-700'>Existing entry</div>
            <ul className='mt-1 space-y-1'>
              <li>Truck: {duplicatePrompt.existing?.truck_id || 'n/a'}</li>
              <li>
                Driver:{' '}
                {duplicateExistingDriverLabel ||
                  duplicatePrompt.existing?.driver_id ||
                  'n/a'}
              </li>
              <li>
                Amount:{' '}
                {duplicatePrompt.existing?.amount !== undefined && duplicatePrompt.existing?.amount !== null
                  ? Number(duplicatePrompt.existing.amount).toLocaleString()
                  : 'n/a'}
              </li>
              <li>
                Incurred:{' '}
                {duplicatePrompt.existing?.incurred_at
                  ? new Date(duplicatePrompt.existing.incurred_at).toLocaleString()
                  : 'n/a'}
              </li>
              <li>Description: {duplicatePrompt.existing?.description || 'No description'}</li>
            </ul>
          </div>
          <div>
            <div className='text-[11px] font-semibold uppercase tracking-wide text-amber-700'>New submission</div>
            <ul className='mt-1 space-y-1'>
              <li>Truck: {duplicatePrompt.payload.truckId || 'n/a'}</li>
              <li>
                Driver:{' '}
                {duplicateNewDriverLabel || duplicatePrompt.payload.driverId || 'n/a'}
              </li>
              <li>Amount: {Number(duplicatePrompt.payload.amount).toLocaleString()}</li>
              <li>
                Incurred:{' '}
                {duplicatePrompt.payload.incurredAt
                  ? new Date(duplicatePrompt.payload.incurredAt).toLocaleString()
                  : 'n/a'}
              </li>
              <li>Description: {duplicatePrompt.payload.description || 'No description'}</li>
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
            onClick={dismissDuplicatePrompt}
            className='rounded border border-amber-400 px-3 py-2 font-semibold text-amber-700 hover:bg-amber-100'
          >
            Cancel
          </button>
        </div>
      </div>
    )}

    <form onSubmit={submit} className='grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 text-sm md:grid-cols-5'>
        <label className='block'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Type</span>
          <select
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={form.type}
            onChange={(e) => {
              const nextType = e.target.value;
              setForm((prev) => {
                if (SALARY_TYPES.includes(nextType)) {
                  return { ...prev, type: nextType, driverId: '', truckId: '' };
                }
                return { ...prev, type: nextType, driverId: '' };
              });
              if (status.kind !== 'idle') {
                setStatus({ kind: 'idle', message: '' });
              }
            }}
          >
            <option value=''>Select category...</option>
            {COST_TYPE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.types.map((option) => (
                  <option key={option} value={option}>
                    {COST_TYPE_LABELS[option] || option}
                  </option>
                ))}
              </optgroup>
            ))}
            {form.type && !COST_TYPES.includes(form.type) && (
              <option value={form.type}>{form.type}</option>
            )}
          </select>
        </label>
        {form.type === 'SALARY_DRIVER' ? (
          <label className='block'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Driver</span>
            <select
              className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
              value={form.driverId}
              onChange={(e) => {
                const value = e.target.value;
                const driver = value ? driverById.get(value) || null : null;
                setForm((prev) => ({
                  ...prev,
                  driverId: value,
                  truckId: value ? driver?.assignedTruckId || '' : '',
                }));
                if (status.kind !== 'idle') {
                  setStatus({ kind: 'idle', message: '' });
                }
              }}
            >
              <option value=''>Select driver...</option>
              {drivers.map((driver) => {
                const truckLabel =
                  driver.assignedTruckPlate ||
                  (driver.assignedTruckId ? driver.assignedTruckId : 'No truck linked');
                return (
                  <option key={driver.id} value={driver.id}>
                    {driver.name} · {truckLabel}
                  </option>
                );
              })}
            </select>
            {form.driverId ? (
              showTruckLabel ? (
                <>
                  <div className='mt-1 text-[11px] text-slate-500'>Linked truck: {showTruckLabel}</div>
                  {driverTruckMismatch && driverDefaultTruckLabel && (
                    <div className='mt-1 text-[11px] font-semibold text-amber-600'>
                      Driver&apos;s current default truck is {driverDefaultTruckLabel}.
                    </div>
                  )}
                </>
              ) : (
                <div className='mt-1 text-[11px] font-semibold text-amber-600'>
                  No truck is linked to this driver yet. Update the truck registry to assign one.
                </div>
              )
            ) : (
              <div className='mt-1 text-[11px] text-slate-400'>Select a driver to tag their truck automatically.</div>
            )}
          </label>
        ) : form.type === 'SALARY_TANBOY' ? (
          <label className='block'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Truck</span>
            <select
              className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
              value={form.truckId}
              onChange={(e) => setForm((prev) => ({ ...prev, truckId: e.target.value }))}
            >
              <option value=''>Select truck...</option>
              {trucks.map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.plate || truck.id}
                </option>
              ))}
            </select>
            {form.truckId ? (
              truckById.get(form.truckId)?.tanboyName ? (
                <div className='mt-1 text-[11px] text-slate-500'>
                  Tanboy: {truckById.get(form.truckId)?.tanboyName}
                </div>
              ) : (
                <div className='mt-1 text-[11px] font-semibold text-amber-600'>
                  No tanboy saved for this truck yet — add one on the Trucks tab.
                </div>
              )
            ) : (
              <div className='mt-1 text-[11px] text-slate-400'>Select the truck to tag its tanboy automatically.</div>
            )}
          </label>
        ) : (
          <label className='block'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Truck</span>
            <select
              className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
              value={form.truckId}
              onChange={(e) => setForm((prev) => ({ ...prev, truckId: e.target.value }))}
            >
              <option value=''>Select truck...</option>
              {trucks.map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.plate || truck.id}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className='block'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Amount (KES)</span>
          <input
            type='number'
            min={0.01}
            step='0.01'
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={form.amount}
            onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
          />
        </label>
        <label className='block'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Incurred on</span>
          <input
            type='datetime-local'
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={form.incurredAt}
            onChange={(e) => setForm((prev) => ({ ...prev, incurredAt: e.target.value }))}
          />
        </label>
        <label className='block md:col-span-2'>
          <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>
            Description {form.type === 'OTHER' ? '' : '(optional)'}
          </span>
          <input
            className='mt-1 w-full rounded border border-slate-300 px-2 py-1'
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            placeholder={form.type === 'OTHER' ? 'Required — say what this cost was for' : 'Short note (optional)'}
          />
        </label>
        <div className='md:col-span-5 flex items-center gap-2'>
          <button
            type='submit'
            className='rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800'
          >
            {editingId ? 'Update cost' : 'Add cost'}
          </button>
          {editingId && (
            <button
              type='button'
              onClick={cancelEdit}
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

      <div className='rounded-2xl border border-slate-200 p-4'>
        <div className='mb-2 flex flex-wrap items-center justify-between gap-2'>
          <h3 className='text-sm font-semibold text-slate-900'>Recent costs</h3>
          <div className='flex flex-wrap items-center gap-2 text-xs'>
            <select
              className='rounded border border-slate-300 px-2 py-1'
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value='all'>Type: all</option>
              {COST_TYPES.map((option) => (
                <option key={option} value={option}>
                  {COST_TYPE_LABELS[option] || option}
                </option>
              ))}
            </select>
            <select
              className='rounded border border-slate-300 px-2 py-1'
              value={filterTruck}
              onChange={(e) => setFilterTruck(e.target.value)}
            >
              <option value='all'>Truck: all</option>
              {trucks.map((truck) => (
                <option key={truck.id} value={truck.id}>
                  {truck.plate || truck.id}
                </option>
              ))}
            </select>
            <input
              className='rounded border border-slate-300 px-2 py-1'
              placeholder='Search description'
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
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
          {filteredRows.map((row) => {
            const flagged = Boolean(row.is_duplicate);
            const truckLabel = row.truck_id
              ? truckById.get(row.truck_id)?.plate || row.truck_id
              : '-';
            const driverLabel = row.driver_id
              ? driverById.get(row.driver_id)?.name || row.driver_id
              : null;
            const summaryParts = [
              COST_TYPE_LABELS[row.type] || row.type,
              driverLabel ? `Driver ${driverLabel}` : null,
              `Truck ${truckLabel}`,
              `KES ${Number(row.amount).toLocaleString()}`,
            ].filter(Boolean) as string[];
            const className = flagged
              ? 'flex items-start justify-between rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2'
              : 'flex items-start justify-between border-b py-2';
            return (
              <div key={row.id} className={className}>
                <div>
                  <div className='font-semibold text-slate-900'>
                    {row.incurred_at ? new Date(row.incurred_at).toLocaleString() : 'Timestamp pending'}
                  </div>
                  <div className='text-slate-600'>• {summaryParts.join(' • ')}</div>
                  <div className='text-slate-500'>{row.description || 'No description recorded'}</div>
                  {flagged && (
                    <div className='mt-1 text-[11px] font-semibold text-amber-700'>
                      Marked as duplicate for audit
                      {row.confirmed_at ? ` · ${new Date(row.confirmed_at).toLocaleString()}` : ''}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => startEdit(row)}
                  className='rounded border border-slate-300 px-2 py-1 text-slate-600 hover:border-slate-400'
                >
                  Edit
                </button>
              </div>
            );
          })}
          {!filteredRows.length && (
            <div className='py-6 text-center text-slate-500'>
              {loading ? 'Loading cost records...' : 'No records match the current filters.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
