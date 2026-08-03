import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import CostEntriesEditor from './CostEntriesEditor';
import FuelPaymentsPanel from './FuelPaymentsPanel';
import { fmt, todayStr, mondayOf, addDays, dayIso, weekdayLabel, dayNum, FuelMatrix, FuelMatrixRow } from '../lib/dates';

const isAdmin = () => (typeof localStorage !== 'undefined' ? localStorage.getItem('role') === 'ADMIN' : false);

type TruckOption = { id: string; plate?: string };
type Status = { kind: 'idle' | 'success' | 'error'; message: string };
type FuelPayload = { truckId: string; type: 'FUEL'; amount: number; incurredAt: string; overrideSameDay?: boolean };
// `sameDay` marks the day-level warning (fuel already on the books for this truck
// that day, any amount) as opposed to an exact-amount duplicate. Confirming a
// same-day entry records a clean row; confirming an exact duplicate flags it.
type DuplicatePrompt = { payload: FuelPayload; existing: any | null; message: string; sameDay: boolean };

type Matrix = FuelMatrix;

export default function FuelPanel() {
  const [trucks, setTrucks] = useState<TruckOption[]>([]);
  const [date, setDate] = useState(todayStr);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [queueTotal, setQueueTotal] = useState(0);
  const [dupPrompt, setDupPrompt] = useState<DuplicatePrompt | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });

  const initialMonday = fmt(mondayOf(todayStr()));
  const [weekFrom, setWeekFrom] = useState(initialMonday);
  const weekTo = useMemo(() => addDays(weekFrom, 6), [weekFrom]);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [loadingMatrix, setLoadingMatrix] = useState(false);
  // Bumped whenever fuel entries change so the payments/balance panel re-fetches.
  const [balanceRefresh, setBalanceRefresh] = useState(0);

  // Fuel already recorded per truck for the selected day, from ANY source (the
  // driver fuel app mirrors into the same costs total). Used to warn before an
  // admin adds fuel a driver already logged.
  const [existingByDay, setExistingByDay] = useState<Record<string, number>>({});
  const [dayConfirm, setDayConfirm] = useState<{
    trucks: { id: string; plate: string; existing: number; amount: number }[];
    payloads: FuelPayload[];
  } | null>(null);

  // Holds the remaining batch while a duplicate prompt is open.
  const pendingQueueRef = useRef<{ rest: FuelPayload[]; saved: number; total: number } | null>(null);

  useEffect(() => {
    api
      .get('/api/admin/trucks')
      .then((res) => setTrucks(Array.isArray(res.data) ? res.data : []))
      .catch(() => setTrucks([]));
  }, []);

  const loadDayExisting = useCallback(async () => {
    if (!date) return;
    try {
      const res = await api.get('/api/admin/finance/fuel-matrix', { params: { from: date, to: date } });
      const map: Record<string, number> = {};
      (res.data?.rows || []).forEach((r: FuelMatrixRow) => {
        if (r.weekTotal) map[r.truckId] = Number(r.weekTotal);
      });
      setExistingByDay(map);
    } catch {
      setExistingByDay({});
    }
  }, [date]);

  useEffect(() => {
    loadDayExisting();
  }, [loadDayExisting]);

  // Keep the weekly grid on the week containing the day being entered. Without
  // this the picker and the grid drift apart, so someone entering an older date
  // sees a week that does not contain it and cannot tell what is already there.
  useEffect(() => {
    if (!date) return;
    setWeekFrom(fmt(mondayOf(date)));
  }, [date]);

  const loadMatrix = useCallback(async () => {
    try {
      setLoadingMatrix(true);
      const res = await api.get('/api/admin/finance/fuel-matrix', { params: { from: weekFrom, to: weekTo } });
      setMatrix(res.data || null);
    } catch {
      setMatrix(null);
    } finally {
      setLoadingMatrix(false);
    }
  }, [weekFrom, weekTo]);

  useEffect(() => {
    loadMatrix();
  }, [loadMatrix]);

  const truckPlate = useMemo(() => {
    const map = new Map<string, string>();
    trucks.forEach((t) => map.set(t.id, t.plate || t.id));
    return map;
  }, [trucks]);

  async function processQueue(queue: FuelPayload[], saved: number, total: number) {
    if (!queue.length) {
      setSaving(false);
      setStatus(
        saved > 0
          ? { kind: 'success', message: `${saved} fuel entr${saved === 1 ? 'y' : 'ies'} saved.` }
          : { kind: 'idle', message: '' }
      );
      if (saved > 0) {
        setAmounts({});
        setBalanceRefresh((k) => k + 1);
        await Promise.all([loadMatrix(), loadDayExisting()]);
      }
      return;
    }
    const [next, ...rest] = queue;
    try {
      await api.post('/api/admin/costs', next);
      setAmounts((prev) => {
        const copy = { ...prev };
        delete copy[next.truckId];
        return copy;
      });
      setSavedCount(saved + 1);
      await processQueue(rest, saved + 1, total);
    } catch (err: any) {
      if (err?.response?.status === 409 && err?.response?.data?.duplicate) {
        setDupPrompt({
          payload: next,
          existing: err?.response?.data?.existing || null,
          message: err?.response?.data?.message || 'Potential duplicate fuel entry detected.',
          sameDay: Boolean(err?.response?.data?.sameDay),
        });
        setSaving(false);
        // Stash the remaining queue on the prompt via closure re-entry after resolution.
        pendingQueueRef.current = { rest, saved, total };
        return;
      }
      setSaving(false);
      setStatus({
        kind: 'error',
        message: `Saved ${saved} of ${total} — stopped: ${
          err?.response?.data?.error || err?.message || `failed to save ${truckPlate.get(next.truckId) || next.truckId}`
        }`,
      });
    }
  }

  async function proceedSave(payloads: FuelPayload[]) {
    setDayConfirm(null);
    setStatus({ kind: 'idle', message: '' });
    setQueueTotal(payloads.length);
    setSavedCount(0);
    setSaving(true);
    await processQueue(payloads, 0, payloads.length);
  }

  async function saveFuel() {
    const payloads: FuelPayload[] = Object.entries(amounts)
      .map(([truckId, v]) => ({ truckId, amount: parseFloat(v || '0') }))
      .filter((r) => Number.isFinite(r.amount) && r.amount > 0)
      .map((r) => ({ truckId: r.truckId, type: 'FUEL', amount: r.amount, incurredAt: dayIso(date) }));
    if (!payloads.length) {
      setStatus({ kind: 'error', message: 'Enter fuel for at least one truck.' });
      return;
    }
    // Warn if any of these trucks already have fuel recorded for this day from
    // any source (e.g. a driver already logged it in the fuel app).
    const overlaps = payloads
      .filter((p) => (existingByDay[p.truckId] || 0) > 0)
      .map((p) => ({
        id: p.truckId,
        plate: truckPlate.get(p.truckId) || p.truckId,
        existing: existingByDay[p.truckId] || 0,
        amount: p.amount,
      }));
    if (overlaps.length) {
      setDayConfirm({ trucks: overlaps, payloads });
      return;
    }
    await proceedSave(payloads);
  }

  async function confirmDuplicate() {
    if (!dupPrompt) return;
    const duplicateOf = dupPrompt.existing?.duplicate_of || dupPrompt.existing?.id || undefined;
    // A second genuine fill on the same day is not a duplicate — only override the
    // day gate so the row is recorded clean, not flagged for audit.
    const body = dupPrompt.sameDay
      ? { ...dupPrompt.payload, overrideSameDay: true }
      : { ...dupPrompt.payload, overrideDuplicate: true, duplicateOf };
    try {
      setConfirming(true);
      await api.post('/api/admin/costs', body);
      setAmounts((prev) => {
        const copy = { ...prev };
        delete copy[dupPrompt.payload.truckId];
        return copy;
      });
      setDupPrompt(null);
      const pending = pendingQueueRef.current;
      pendingQueueRef.current = null;
      const nextSaved = (pending?.saved ?? savedCount) + 1;
      setSavedCount(nextSaved);
      setSaving(true);
      await processQueue(pending?.rest ?? [], nextSaved, pending?.total ?? queueTotal);
    } catch (err: any) {
      setStatus({
        kind: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to confirm duplicate.',
      });
    } finally {
      setConfirming(false);
    }
  }

  function skipDuplicate() {
    const pending = pendingQueueRef.current;
    pendingQueueRef.current = null;
    setDupPrompt(null);
    if (pending) {
      setSaving(true);
      processQueue(pending.rest, pending.saved, pending.total);
    }
  }

  const shiftWeek = (weeks: number) => setWeekFrom((prev) => addDays(prev, weeks * 7));

  return (
    <div className='space-y-4'>
      <div className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
        <div>
          <h2 className='text-sm font-semibold text-slate-900'>Fuel</h2>
          <p className='text-xs text-slate-500'>
            Record daily fuel per truck — the fleet's biggest and most behaviour-revealing cost.
            Fuel here and fuel logged by drivers in the fuel app feed the same daily total, so a
            truck already showing "logged today" has fuel captured — enter each fill only once.
          </p>
        </div>

        {dayConfirm && (
          <div className='mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900'>
            <h3 className='text-sm font-semibold text-amber-700'>Some trucks already have fuel today</h3>
            <p className='mt-1'>
              These trucks already have fuel recorded for {date} (from an earlier entry or the driver
              fuel app). Add the new amounts on top?
            </p>
            <ul className='mt-2 space-y-1'>
              {dayConfirm.trucks.map((t) => (
                <li key={t.id}>
                  {t.plate}: already KES {t.existing.toLocaleString()} today · adding KES{' '}
                  {t.amount.toLocaleString()}
                </li>
              ))}
            </ul>
            <div className='mt-3 flex flex-wrap gap-2'>
              <button
                type='button'
                onClick={() => {
                  // Only the trucks listed above were confirmed — the rest still get
                  // the server-side day check, which catches anything logged since.
                  const confirmed = new Set(dayConfirm.trucks.map((t) => t.id));
                  proceedSave(
                    dayConfirm.payloads.map((p) =>
                      confirmed.has(p.truckId) ? { ...p, overrideSameDay: true } : p
                    )
                  );
                }}
                className='rounded bg-amber-600 px-3 py-2 font-semibold text-white shadow hover:bg-amber-500'
              >
                Add anyway
              </button>
              <button
                type='button'
                onClick={() => setDayConfirm(null)}
                className='rounded border border-amber-400 px-3 py-2 font-semibold text-amber-700 hover:bg-amber-100'
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {dupPrompt && (
          <div className='mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900'>
            <h3 className='text-sm font-semibold text-amber-700'>
              {dupPrompt.sameDay ? 'This truck already has fuel for this day' : 'Possible duplicate fuel entry'}
            </h3>
            <p className='mt-1'>{dupPrompt.message}</p>
            <ul className='mt-2 space-y-1'>
              <li>Truck: {truckPlate.get(dupPrompt.payload.truckId) || dupPrompt.payload.truckId}</li>
              <li>New amount: KES {Number(dupPrompt.payload.amount).toLocaleString()}</li>
              {dupPrompt.sameDay ? (
                <li>
                  Already recorded for {date}: KES{' '}
                  {Number(dupPrompt.existing?.total || 0).toLocaleString()} across{' '}
                  {Number(dupPrompt.existing?.entries || 0)} entr
                  {Number(dupPrompt.existing?.entries || 0) === 1 ? 'y' : 'ies'}
                </li>
              ) : (
                <>
                  {dupPrompt.existing?.amount != null && (
                    <li>Existing amount: KES {Number(dupPrompt.existing.amount).toLocaleString()}</li>
                  )}
                  {dupPrompt.existing?.incurred_at && (
                    <li>Existing time: {new Date(dupPrompt.existing.incurred_at).toLocaleString()}</li>
                  )}
                </>
              )}
            </ul>
            <div className='mt-3 flex flex-wrap gap-2'>
              <button
                type='button'
                onClick={confirmDuplicate}
                disabled={confirming}
                className='rounded bg-amber-600 px-3 py-2 font-semibold text-white shadow hover:bg-amber-500 disabled:opacity-60'
              >
                {confirming ? 'Saving…' : dupPrompt.sameDay ? 'Add on top anyway' : 'Save anyway (flag duplicate)'}
              </button>
              <button
                type='button'
                onClick={skipDuplicate}
                className='rounded border border-amber-400 px-3 py-2 font-semibold text-amber-700 hover:bg-amber-100'
              >
                Skip this truck
              </button>
            </div>
          </div>
        )}

        <div className='mt-4 grid gap-3 sm:grid-cols-2'>
          <label className='block'>
            <span className='text-xs font-semibold uppercase tracking-wide text-slate-500'>Day</span>
            <input
              type='date'
              className='mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm'
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setStatus({ kind: 'idle', message: '' });
              }}
            />
          </label>
        </div>

        <div className='mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
          {trucks.map((truck) => {
            const already = existingByDay[truck.id] || 0;
            return (
              <label key={truck.id} className='block'>
                <span className='flex items-center justify-between text-xs text-slate-600'>
                  <span>{truck.plate || truck.id}</span>
                  {already > 0 && (
                    <span
                      className='font-semibold text-amber-600'
                      title={`Fuel already recorded for ${date} (this tab or the driver fuel app)`}
                    >
                      already recorded: KES {already.toLocaleString()}
                    </span>
                  )}
                </span>
                <input
                  type='number'
                  inputMode='decimal'
                  min={0}
                  step='0.01'
                  placeholder='Fuel (KES)'
                  className={[
                    'mt-1 w-full rounded border px-2 py-1 text-sm',
                    already > 0 ? 'border-amber-300 bg-amber-50/40' : 'border-slate-300',
                  ].join(' ')}
                  value={amounts[truck.id] || ''}
                  onChange={(e) => setAmounts((prev) => ({ ...prev, [truck.id]: e.target.value }))}
                />
              </label>
            );
          })}
          {!trucks.length && <div className='text-xs text-slate-400'>No trucks found.</div>}
        </div>

        <div className='mt-4 flex flex-wrap items-center gap-2'>
          <button
            type='button'
            onClick={saveFuel}
            disabled={saving}
            className='rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60'
          >
            {saving ? `Saving… (${savedCount}/${queueTotal})` : 'Save fuel'}
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

        {/* Everyone who can enter fuel can see what is already on the books for the
            day — otherwise OPS keys blind and re-enters figures. Editing stays
            ADMIN-only (canEdit), which is also enforced on PATCH/DELETE server-side. */}
        <div className='mt-4'>
          <CostEntriesEditor
            date={date}
            type='FUEL'
            trucks={trucks}
            canEdit={isAdmin()}
            reloadSignal={balanceRefresh}
            title={
              isAdmin()
                ? `Fuel entries for ${date} — edit or remove`
                : `Fuel already recorded for ${date}`
            }
            onChanged={() => {
              loadMatrix();
              loadDayExisting();
              setBalanceRefresh((k) => k + 1);
            }}
          />
        </div>
      </div>

      <div className='rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <h3 className='text-sm font-semibold text-slate-900'>Weekly fuel per truck</h3>
            <p className='text-xs text-slate-500'>
              {weekFrom} → {weekTo}
            </p>
          </div>
          <div className='flex items-center gap-2 text-xs'>
            <button
              type='button'
              onClick={() => shiftWeek(-1)}
              className='rounded border border-slate-300 px-2 py-1 hover:border-slate-400'
            >
              ← Prev
            </button>
            <button
              type='button'
              onClick={() => setWeekFrom(fmt(mondayOf(todayStr())))}
              className='rounded border border-slate-300 px-2 py-1 hover:border-slate-400'
            >
              This week
            </button>
            <button
              type='button'
              onClick={() => shiftWeek(1)}
              className='rounded border border-slate-300 px-2 py-1 hover:border-slate-400'
            >
              Next →
            </button>
          </div>
        </div>

        <div className='mt-3 overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-sky-50 text-slate-600'>
              <tr>
                <th className='px-3 py-2 text-left'>Truck</th>
                {(matrix?.days || []).map((d) => (
                  <th key={d} className='px-3 py-2 text-right whitespace-nowrap'>
                    <div>{weekdayLabel(d)}</div>
                    <div className='text-[10px] font-normal text-slate-400'>{dayNum(d)}</div>
                  </th>
                ))}
                <th className='px-3 py-2 text-right font-semibold'>Weekly total</th>
              </tr>
            </thead>
            <tbody>
              {(matrix?.rows || []).map((row) => (
                <tr key={row.truckId} className='border-b border-slate-100'>
                  <td className='px-3 py-2 font-semibold text-slate-900 whitespace-nowrap'>{row.plate}</td>
                  {(matrix?.days || []).map((d) => (
                    <td key={d} className='px-3 py-2 text-right text-slate-700'>
                      {row.cells[d] ? Number(row.cells[d]).toLocaleString() : '-'}
                    </td>
                  ))}
                  <td className='px-3 py-2 text-right font-semibold text-slate-900'>
                    {row.weekTotal ? Number(row.weekTotal).toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
              {!matrix?.rows?.length && (
                <tr>
                  <td colSpan={(matrix?.days?.length || 7) + 2} className='px-3 py-6 text-center text-slate-500'>
                    {loadingMatrix ? 'Loading…' : 'No trucks found.'}
                  </td>
                </tr>
              )}
            </tbody>
            {matrix?.rows?.length ? (
              <tfoot>
                <tr className='border-t border-slate-200 bg-slate-50 font-semibold text-slate-900'>
                  <td className='px-3 py-2 text-left'>Daily total</td>
                  {matrix.days.map((d) => (
                    <td key={d} className='px-3 py-2 text-right'>
                      {matrix.columnTotals[d] ? Number(matrix.columnTotals[d]).toLocaleString() : '-'}
                    </td>
                  ))}
                  <td className='px-3 py-2 text-right'>
                    {matrix.grandTotal ? Number(matrix.grandTotal).toLocaleString() : '-'}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      <FuelPaymentsPanel isAdmin={isAdmin()} reloadSignal={balanceRefresh} />
    </div>
  );
}
