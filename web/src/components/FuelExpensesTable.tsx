import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { api } from '../api';
import { fmt, todayStr, mondayOf, addDays, weekdayLabel, dayNum, FuelMatrix } from '../lib/dates';

type View = 'day' | 'truck';

const kes = (n: number) => `KES ${Number(n || 0).toLocaleString()}`;

// Interactive fuel-expenses table for the dashboard. Reuses the fuel-matrix API:
// "By day" shows the trucks × days grid for a week; "By truck" totals per truck.
export default function FuelExpensesTable() {
  const [view, setView] = useState<View>('day');
  const [weekFrom, setWeekFrom] = useState(fmt(mondayOf(todayStr())));
  const weekTo = useMemo(() => addDays(weekFrom, 6), [weekFrom]);
  const [matrix, setMatrix] = useState<FuelMatrix | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/api/admin/finance/fuel-matrix', { params: { from: weekFrom, to: weekTo } });
      setMatrix(res.data || null);
    } catch {
      setMatrix(null);
    } finally {
      setLoading(false);
    }
  }, [weekFrom, weekTo]);

  useEffect(() => {
    load();
  }, [load]);

  const shiftWeek = (weeks: number) => setWeekFrom((prev) => addDays(prev, weeks * 7));

  const byTruck = useMemo(() => {
    const rows = (matrix?.rows || []).filter((r) => r.weekTotal > 0).slice();
    rows.sort((a, b) => b.weekTotal - a.weekTotal);
    return rows;
  }, [matrix]);

  const days = matrix?.days || [];

  return (
    <div className='rounded-xl border bg-white p-4'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <div>
          <h3 className='text-sm font-semibold text-slate-900'>Fuel expenses</h3>
          <p className='text-xs text-slate-400'>
            {weekFrom} → {weekTo} · total {kes(matrix?.grandTotal || 0)}
          </p>
        </div>
        <div className='flex items-center gap-2 text-xs'>
          <div className='flex overflow-hidden rounded border border-slate-200'>
            <button
              type='button'
              onClick={() => setView('day')}
              className={view === 'day' ? 'bg-slate-900 px-3 py-1 font-semibold text-white' : 'px-3 py-1 text-slate-600 hover:bg-slate-100'}
            >
              By day
            </button>
            <button
              type='button'
              onClick={() => setView('truck')}
              className={view === 'truck' ? 'bg-slate-900 px-3 py-1 font-semibold text-white' : 'px-3 py-1 text-slate-600 hover:bg-slate-100'}
            >
              By truck
            </button>
          </div>
          <button type='button' onClick={() => shiftWeek(-1)} className='rounded border border-slate-200 px-2 py-1 hover:border-slate-300'>
            ← Prev
          </button>
          <button
            type='button'
            onClick={() => setWeekFrom(fmt(mondayOf(todayStr())))}
            className='rounded border border-slate-200 px-2 py-1 hover:border-slate-300'
          >
            This week
          </button>
          <button type='button' onClick={() => shiftWeek(1)} className='rounded border border-slate-200 px-2 py-1 hover:border-slate-300'>
            Next →
          </button>
          <input
            type='date'
            className='rounded border border-slate-200 px-2 py-1'
            value={weekFrom}
            onChange={(e) => e.target.value && setWeekFrom(fmt(mondayOf(e.target.value)))}
            title='Jump to the week containing this date'
          />
        </div>
      </div>

      {view === 'day' ? (
        <div className='mt-3 overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-sky-50 text-slate-600'>
              <tr>
                <th className='px-3 py-2 text-left font-semibold'>Truck</th>
                {days.map((d) => (
                  <th key={d} className='px-3 py-2 text-right font-semibold'>
                    <div>{weekdayLabel(d)}</div>
                    <div className='text-[10px] text-slate-400'>{dayNum(d)}</div>
                  </th>
                ))}
                <th className='px-3 py-2 text-right font-semibold'>Weekly total</th>
              </tr>
            </thead>
            <tbody>
              {(matrix?.rows || []).map((row) => (
                <tr key={row.truckId} className='border-t border-slate-100'>
                  <td className='whitespace-nowrap px-3 py-2 font-semibold text-slate-900'>{row.plate}</td>
                  {days.map((d) => (
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
                  <td colSpan={(days.length || 7) + 2} className='px-3 py-6 text-center text-slate-500'>
                    {loading ? 'Loading…' : 'No fuel recorded.'}
                  </td>
                </tr>
              )}
            </tbody>
            {matrix?.rows?.length ? (
              <tfoot>
                <tr className='border-t border-slate-200 bg-slate-50 font-semibold text-slate-900'>
                  <td className='px-3 py-2 text-left'>Daily total</td>
                  {days.map((d) => (
                    <td key={d} className='px-3 py-2 text-right'>
                      {matrix.columnTotals[d] ? Number(matrix.columnTotals[d]).toLocaleString() : '-'}
                    </td>
                  ))}
                  <td className='px-3 py-2 text-right'>{matrix.grandTotal ? Number(matrix.grandTotal).toLocaleString() : '-'}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      ) : (
        <div className='mt-3'>
          {byTruck.length ? (
            <>
              <div className='h-56'>
                <ResponsiveContainer width='100%' height='100%'>
                  <BarChart data={byTruck} layout='vertical' margin={{ left: 8, right: 16 }}>
                    <CartesianGrid strokeDasharray='3 3' horizontal={false} />
                    <XAxis type='number' tick={{ fontSize: 11 }} />
                    <YAxis type='category' dataKey='plate' width={80} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => kes(Number(v))} />
                    <Bar dataKey='weekTotal' fill='#d97706' radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <table className='mt-3 w-full text-sm'>
                <tbody>
                  {byTruck.map((row) => (
                    <tr key={row.truckId} className='border-t border-slate-100'>
                      <td className='px-3 py-2 font-semibold text-slate-900'>{row.plate}</td>
                      <td className='px-3 py-2 text-right text-slate-700'>{kes(row.weekTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <div className='flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-500'>
              {loading ? 'Loading…' : 'No fuel recorded for this week.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
