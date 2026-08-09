import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ReferenceLine } from 'recharts';
import { api } from '../api';
import { fmt, todayStr, mondayOf, addDays } from '../lib/dates';

type EfficiencyRow = {
  truckId: string;
  plate: string;
  totalFuelKes: number;
  totalKm: number;
  kesPerKm: number | null;
  fillDays: number;
};

type EfficiencyData = {
  from: string;
  to: string;
  trucks: EfficiencyRow[];
  fleetAvgKesPerKm: number | null;
};

function efficiencyColor(kesPerKm: number | null, fleetAvg: number | null): string {
  if (kesPerKm === null) return '#94a3b8';
  const avg = fleetAvg || kesPerKm;
  const ratio = kesPerKm / avg;
  if (ratio > 1.25) return '#ef4444';
  if (ratio > 1.10) return '#f97316';
  if (ratio > 0.90) return '#eab308';
  return '#22c55e';
}

function ratingLabel(kesPerKm: number | null, fleetAvg: number | null): string {
  if (kesPerKm === null) return '—';
  const avg = fleetAvg || kesPerKm;
  const ratio = kesPerKm / avg;
  if (ratio > 1.25) return 'High';
  if (ratio > 1.10) return 'Watch';
  if (ratio > 0.90) return 'Normal';
  return 'Efficient';
}

export default function FuelEfficiencyTable() {
  const [data, setData] = useState<EfficiencyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialMonday = fmt(mondayOf(todayStr()));
  const [weekFrom, setWeekFrom] = useState(initialMonday);
  const weekTo = useMemo(() => addDays(weekFrom, 6), [weekFrom]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/api/admin/finance/fuel-efficiency', {
        params: { from: weekFrom, to: weekTo },
      });
      setData(res.data || null);
      setError(null);
    } catch (err: any) {
      setData(null);
      setError(err?.response?.data?.error || err?.message || 'Failed to load fuel efficiency data');
    } finally {
      setLoading(false);
    }
  }, [weekFrom, weekTo]);

  useEffect(() => {
    load();
  }, [load]);

  const shiftWeek = (weeks: number) => setWeekFrom((prev) => addDays(prev, weeks * 7));

  const chartData = useMemo(() => {
    if (!data?.trucks?.length) return [];
    return data.trucks.filter((t) => t.kesPerKm !== null);
  }, [data]);

  const hasData = chartData.length > 0;

  return (
    <div className='rounded-xl border bg-white p-4'>
      <div className='flex flex-wrap items-baseline justify-between gap-2'>
        <div>
          <h3 className='text-sm font-semibold text-slate-900'>Fuel efficiency rating</h3>
          <p className='text-xs text-slate-400'>
            {weekFrom} &rarr; {weekTo}
            {data?.fleetAvgKesPerKm != null && (
              <> &middot; fleet avg <strong>{data.fleetAvgKesPerKm.toFixed(1)} KES/km</strong></>
            )}
          </p>
        </div>
        <div className='flex items-center gap-2 text-xs'>
          <button
            type='button'
            onClick={() => shiftWeek(-1)}
            className='rounded border border-slate-200 px-2 py-1 hover:border-slate-300'
          >
            &larr; Prev
          </button>
          <button
            type='button'
            onClick={() => setWeekFrom(fmt(mondayOf(todayStr())))}
            className='rounded border border-slate-200 px-2 py-1 hover:border-slate-300'
          >
            This week
          </button>
          <button
            type='button'
            onClick={() => shiftWeek(1)}
            className='rounded border border-slate-200 px-2 py-1 hover:border-slate-300'
          >
            Next &rarr;
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

      {error && (
        <div className='mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700'>
          {error}
          <button onClick={load} className='ml-2 font-semibold underline underline-offset-2'>
            Retry
          </button>
        </div>
      )}

      {!hasData && !loading && !error && (
        <div className='mt-3 flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-500'>
          No fuel efficiency data for this period. Needs both fuel cost entries and GPS telemetry.
        </div>
      )}

      {loading && !data && (
        <div className='mt-3 flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-500'>
          Loading fuel efficiency data&hellip;
        </div>
      )}

      {hasData && (
        <div className='mt-3 grid gap-4 lg:grid-cols-2'>
          {/* Bar chart */}
          <div className='h-64'>
            <ResponsiveContainer width='100%' height='100%'>
              <BarChart data={chartData} layout='vertical' margin={{ left: 8, right: 24 }}>
                <CartesianGrid strokeDasharray='3 3' horizontal={false} />
                <XAxis type='number' tick={{ fontSize: 11 }} unit=' KES/km' />
                <YAxis type='category' dataKey='plate' width={80} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number) => [`${v.toFixed(1)} KES/km`, 'Efficiency']}
                  labelFormatter={(plate: string) => plate}
                />
                {data?.fleetAvgKesPerKm != null && (
                  <ReferenceLine
                    x={data.fleetAvgKesPerKm}
                    stroke='#64748b'
                    strokeDasharray='3 3'
                    label={{ value: `Avg ${data.fleetAvgKesPerKm.toFixed(1)}`, position: 'top', fontSize: 10 }}
                  />
                )}
                <Bar dataKey='kesPerKm' name='KES/km' radius={[0, 3, 3, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={efficiencyColor(entry.kesPerKm, data?.fleetAvgKesPerKm ?? null)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Data table */}
          <div className='overflow-auto'>
            <table className='w-full text-sm'>
              <thead className='bg-slate-50 text-slate-600'>
                <tr>
                  <th className='px-3 py-2 text-left font-semibold'>#</th>
                  <th className='px-3 py-2 text-left font-semibold'>Truck</th>
                  <th className='px-3 py-2 text-right font-semibold'>Fuel (KES)</th>
                  <th className='px-3 py-2 text-right font-semibold'>Distance</th>
                  <th className='px-3 py-2 text-right font-semibold'>KES/km</th>
                  <th className='px-3 py-2 text-center font-semibold'>Rating</th>
                </tr>
              </thead>
              <tbody>
                {(data?.trucks || []).map((row, i) => (
                  <tr key={row.truckId} className='border-t border-slate-100'>
                    <td className='px-3 py-2 text-slate-400'>{i + 1}</td>
                    <td className='whitespace-nowrap px-3 py-2 font-semibold text-slate-900'>
                      {row.plate}
                    </td>
                    <td className='px-3 py-2 text-right text-slate-700'>
                      {row.totalFuelKes.toLocaleString()}
                    </td>
                    <td className='px-3 py-2 text-right text-slate-700'>
                      {row.totalKm > 0 ? `${row.totalKm.toLocaleString()} km` : '—'}
                    </td>
                    <td className='px-3 py-2 text-right font-semibold text-slate-900'>
                      {row.kesPerKm !== null ? row.kesPerKm.toFixed(1) : '—'}
                    </td>
                    <td className='px-3 py-2 text-center'>
                      <span
                        className='inline-block rounded-full px-2 py-0.5 text-xs font-semibold text-white'
                        style={{ backgroundColor: efficiencyColor(row.kesPerKm, data?.fleetAvgKesPerKm ?? null) }}
                      >
                        {ratingLabel(row.kesPerKm, data?.fleetAvgKesPerKm ?? null)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasData && (
        <div className='mt-3 flex flex-wrap gap-3 text-[10px] text-slate-400'>
          <span className='flex items-center gap-1'>
            <span className='inline-block h-2.5 w-2.5 rounded-full' style={{ backgroundColor: '#ef4444' }} />
            High (&gt;25% above avg)
          </span>
          <span className='flex items-center gap-1'>
            <span className='inline-block h-2.5 w-2.5 rounded-full' style={{ backgroundColor: '#f97316' }} />
            Watch (10&ndash;25% above)
          </span>
          <span className='flex items-center gap-1'>
            <span className='inline-block h-2.5 w-2.5 rounded-full' style={{ backgroundColor: '#eab308' }} />
            Normal (within 10%)
          </span>
          <span className='flex items-center gap-1'>
            <span className='inline-block h-2.5 w-2.5 rounded-full' style={{ backgroundColor: '#22c55e' }} />
            Efficient (&gt;10% below avg)
          </span>
        </div>
      )}
    </div>
  );
}
