import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, ReferenceLine, Cell } from 'recharts';
import FleetLocationPanel from '../components/FleetLocationPanel';
import AdminTrucksPanel from '../components/AdminTrucksPanel';
import AdminDriversPanel from '../components/AdminDriversPanel';
import AdminUsersPanel from '../components/AdminUsersPanel';
import AdminStockPanel from '../components/AdminStockPanel';
import AdminCostsPanel, { COST_TYPE_LABELS } from '../components/AdminCostsPanel';
import AdminAuditConsole from '../components/AdminAuditConsole';
import AdminNotificationSettings from '../components/AdminNotificationSettings';
import AiWorkspaceTab from '../components/AiWorkspaceTab';
import AssistantChatWidget from '../components/AssistantChatWidget';
import AdminReportsPanel from '../components/AdminReportsPanel';
import AdminEmailPanel from '../components/AdminEmailPanel';

type CostPayload = {
  truckId: string;
  type: string;
  amount: number;
  description: string;
  driverId?: string;
};

type DuplicateCostPrompt = {
  message: string;
  existing: any | null;
  payload: CostPayload;
};

const TAB_LABELS: Record<string, string> = {
  overview: 'Overview', orders: 'Orders', trucks: 'Trucks', drivers: 'Drivers',
  users: 'Users', stock: 'Stock', costs: 'Costs',
  reports: 'Reports', audit: 'Audit', fleet: 'Fleet', ai: 'AI', email: 'Email',
};

const TAB_GROUPS = [
  { heading: 'Operations', items: ['overview','orders','fleet'] },
  { heading: 'People & Assets', items: ['trucks','drivers','users'] },
  { heading: 'Finance', items: ['stock','costs','reports'] },
  { heading: 'Tools', items: ['audit','ai','email'] },
];

export default function Ops(){
  const role = localStorage.getItem('role') || 'ADMIN';
  const userName = localStorage.getItem('userName') || '';
  const isAdmin = role === 'ADMIN';
  const isOps = role === 'OPS';
  const allowedTabs = isAdmin
    ? ['overview','orders','trucks','drivers','users','stock','costs','reports','audit','fleet','ai','email']
    : isOps
    ? ['orders','stock','costs','fleet']
    : ['fleet'];
  const [tab, setTab] = useState<string>(allowedTabs[0]);
  const title = isAdmin
    ? (userName ? `${userName.split(' ')[0]}'s Workspace` : 'Admin Workspace')
    : 'Operations';

  const tabContent = (
    <>
      {tab==='overview' && isAdmin && <OverviewTab/>}
      {tab==='orders' && (isAdmin || isOps) && <OrdersTab/>}
      {tab==='trucks' && isAdmin && <AdminTrucksPanel />}
      {tab==='drivers' && isAdmin && <AdminDriversPanel />}
      {tab==='users' && isAdmin && <AdminUsersPanel />}
      {tab==='stock' && (isAdmin ? <AdminStockPanel /> : <StockTab />)}
      {tab==='costs' && (isAdmin ? <AdminCostsPanel /> : <CostsTab />)}
      {tab==='reports' && isAdmin && <AdminReportsPanel />}
      {tab==='audit' && isAdmin && <AdminAuditConsole />}
      {tab==='fleet' && <FleetTab allowReassign={role === 'ADMIN' || role === 'OPS'} />}
      {tab==='ai' && isAdmin && <AiWorkspaceTab/>}
      {tab==='email' && isAdmin && (<div className='space-y-5'><AdminNotificationSettings /><AdminEmailPanel /></div>)}
    </>
  );

  return (
    <>
      {/* ── Mobile: horizontal scrolling tab bar ── */}
      <div className='md:hidden border-b border-slate-200 bg-white sticky top-14 z-20'>
        <div className='flex gap-1 overflow-x-auto px-4 py-2'>
          {allowedTabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'flex-shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                tab === t ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
              ].join(' ')}
            >
              {TAB_LABELS[t] || t}
            </button>
          ))}
        </div>
      </div>

      {/* ── Desktop: sidebar + content ── */}
      <div className='mx-auto max-w-7xl md:flex'>
        {/* Sidebar */}
        <aside className='hidden md:flex md:w-52 md:shrink-0 md:flex-col md:border-r md:border-slate-200 md:bg-white md:min-h-[calc(100vh-3.5rem)]'>
          <div className='px-4 pt-6 pb-3'>
            <p className='text-xs font-bold text-slate-900'>{title}</p>
          </div>
          <nav className='flex-1 px-2 pb-6 space-y-5'>
            {TAB_GROUPS.map((group) => {
              const groupTabs = group.items.filter((t) => allowedTabs.includes(t));
              if (!groupTabs.length) return null;
              return (
                <div key={group.heading}>
                  <p className='px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400'>
                    {group.heading}
                  </p>
                  {groupTabs.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={[
                        'w-full text-left rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        tab === t
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                      ].join(' ')}
                    >
                      {TAB_LABELS[t] || t}
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Main content */}
        <main className='flex-1 px-4 py-6 md:px-8'>
          {tabContent}
        </main>
      </div>

      {isAdmin && <AssistantChatWidget />}
    </>
  );
}

function FleetPulseSection(){
  const [data,setData]=useState<any|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [tripTruck,setTripTruck]=useState<string>('__summary__');
  const [tripMode,setTripMode]=useState<'today'|'yesterday'|'last7'|'custom'>('today');
  const [tripCustomFrom,setTripCustomFrom]=useState('');
  const [tripCustomTo,setTripCustomTo]=useState('');
  const [tripRangeStats,setTripRangeStats]=useState<any[]|null>(null);
  const [tripRangeLoading,setTripRangeLoading]=useState(false);
  const [tripRangeError,setTripRangeError]=useState<string|null>(null);

  const load = useCallback(async()=>{
    try{
      setLoading(true);
      const res = await api.get('/api/admin/dashboard');
      setData(res.data);
      setError(null);
    }catch(err:any){
      setError(err?.response?.data?.error || err?.message || 'Failed to load dashboard overview');
    }finally{
      setLoading(false);
    }
  },[]);

  useEffect(()=>{ load(); },[load]);

  function nairobiDate(offsetDays=0){
    return new Date(Date.now()+3*3600000+offsetDays*86400000).toISOString().slice(0,10);
  }

  async function fetchTripRange(from:string,to:string){
    if(!from) return;
    setTripRangeLoading(true);
    setTripRangeError(null);
    try{
      const res=await api.get('/api/admin/trips',{params:{from,to:to||from}});
      setTripRangeStats(res.data.tripStats||[]);
    }catch(err:any){
      setTripRangeError(err?.response?.data?.error||'Failed to load trips');
      setTripRangeStats([]);
    }finally{
      setTripRangeLoading(false);
    }
  }

  async function handleTripMode(mode:'today'|'yesterday'|'last7'|'custom'){
    setTripMode(mode);
    setTripTruck('__summary__');
    if(mode==='today'){
      setTripRangeStats(null);
      setTripRangeError(null);
    }else if(mode==='yesterday'){
      const yest=nairobiDate(-1);
      await fetchTripRange(yest,yest);
    }else if(mode==='last7'){
      await fetchTripRange(nairobiDate(-6),nairobiDate(0));
    }
    // 'custom' handled by Load button
  }

  if(loading) return <div className='rounded-xl border bg-white p-6 text-sm text-slate-600'>Loading dashboard…</div>;
  if(error) return (
    <div className='rounded-xl border bg-white p-6 text-sm text-rose-600'>
      {error}
      <button onClick={load} className='ml-3 rounded border px-2 py-1 text-xs text-slate-600 hover:border-slate-300'>Retry</button>
    </div>
  );
  if(!data) return null;

  const fl = data.fleetLive || { moving: 0, idle: 0, stopped: 0, total: 0 };
  const tripStats: any[] = data.tripStats || [];
  const idleStats: any[] = data.idleStats || [];
  const idleSummary = data.idleSummary || { totalIdleHours: 0, totalEstimatedCost: 0, kesPerLitre: 185, burnRateLPerHr: 2 };
  const driverProfile: any[] = data.driverSpeedingProfile || [];

  // Speed chart — gradient color per bar
  const speedChart = (data.truckSpeedStats || []).map((x:any) => ({ label: x.plate || x.truckId, maxSpeed: Number(x.maxSpeed||0), address: x.maxSpeedAddress || '', lat: x.maxSpeedLat ?? null, lng: x.maxSpeedLng ?? null, maxSpeedTime: x.maxSpeedTime ?? null }));
  const maxS = Math.max(...speedChart.map((x:any) => x.maxSpeed), 1);
  function speedColor(speed: number) {
    const ratio = Math.min(speed / maxS, 1);
    return `hsl(38, ${Math.round(15 + 65 * ratio)}%, ${Math.round(62 - 22 * ratio)}%)`;
  }

  // Trip table
  const effectiveTripStats: any[] = tripMode==='today' ? tripStats : (tripRangeStats||[]);
  const activeTruck = effectiveTripStats.find(t => t.truckId === tripTruck) ? tripTruck : '__summary__';
  const selectedTruck = effectiveTripStats.find(t => t.truckId === activeTruck);
  function fmtDur(min: number) {
    if(!min) return '—';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  return (
    <div className='space-y-5'>

      {/* Fleet status strip */}
      <div className='flex flex-wrap items-center gap-5 rounded-xl border border-slate-100 bg-slate-50 px-5 py-3 text-sm'>
        <span className='text-xs font-medium uppercase tracking-widest text-slate-400'>Live fleet</span>
        <span className='flex items-center gap-1.5 text-slate-700'>
          <span className='inline-block h-2 w-2 rounded-full bg-emerald-500'/>
          {fl.moving} moving
        </span>
        <span className='flex items-center gap-1.5 text-slate-700'>
          <span className='inline-block h-2 w-2 rounded-full bg-amber-400'/>
          {fl.idle} idle
        </span>
        <span className='flex items-center gap-1.5 text-slate-700'>
          <span className='inline-block h-2 w-2 rounded-full bg-slate-300'/>
          {fl.stopped} stopped
        </span>
        <button onClick={()=>load()} className='ml-auto rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-slate-300 hover:bg-white'>Refresh</button>
      </div>

      {/* Top speed by truck — full width */}
      <div className='rounded-xl border bg-white p-5'>
        <div className='flex items-center justify-between'>
          <h3 className='text-sm font-semibold text-slate-900'>Top speed by truck (24h)</h3>
          <span className='text-xs text-slate-400'>km/h · desaturated = slower, vivid = faster relative to fleet</span>
        </div>
        <div className='mt-3 h-52'>
          {speedChart.length ? (
            <ResponsiveContainer width='100%' height='100%'>
              <BarChart data={speedChart}>
                <CartesianGrid strokeDasharray='3 3' vertical={false} />
                <XAxis dataKey='label' tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={32} domain={[0, 'auto']} />
                <Tooltip
                  content={({ active, payload }:any) => {
                    if(!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className='rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md text-xs'>
                        <p className='font-semibold text-slate-800 mb-1'>{d.label}</p>
                        <p className='text-slate-700'>maxSpeed : {d.maxSpeed} km/h</p>
                        {d.address && <p className='text-slate-500 mt-0.5 max-w-[220px] leading-snug'>{d.address}</p>}
                        {!d.address && d.lat != null && d.lng != null && (
                          <p className='text-slate-400 mt-0.5'>{Number(d.lat).toFixed(5)}, {Number(d.lng).toFixed(5)}</p>
                        )}
                        {d.maxSpeedTime && (
                          <p className='text-slate-400 mt-0.5'>{new Date(d.maxSpeedTime).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</p>
                        )}
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={80} stroke='#ef4444' strokeDasharray='4 4' label={{ value:'80 km/h', position:'insideTopRight', fontSize:10, fill:'#ef4444' }} />
                <Bar dataKey='maxSpeed' radius={[3,3,0,0]}>
                  {speedChart.map((_:any, i:number) => (
                    <Cell key={i} fill={speedColor(speedChart[i].maxSpeed)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className='flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-500'>
              No speed data recorded in the last 24h.
            </div>
          )}
        </div>
      </div>

      {/* Trips — date range tabbed table */}
      <div className='rounded-xl border bg-white p-5'>
        {/* Header: title + period presets */}
        <div className='flex flex-wrap items-center justify-between gap-3 mb-3'>
          <h3 className='text-sm font-semibold text-slate-900'>
            {tripMode==='today' ? 'Trips today'
             : tripMode==='yesterday' ? 'Trips — yesterday'
             : tripMode==='last7' ? 'Trips — last 7 days'
             : 'Trips — custom range'}
          </h3>
          <div className='flex items-center gap-1 flex-wrap'>
            {(['today','yesterday','last7','custom'] as const).map(m=>(
              <button
                key={m}
                onClick={()=>handleTripMode(m)}
                className={[
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  tripMode===m ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
                ].join(' ')}
              >
                {m==='today'?'Today':m==='yesterday'?'Yesterday':m==='last7'?'Last 7 days':'Custom'}
              </button>
            ))}
          </div>
        </div>

        {/* Custom date inputs */}
        {tripMode==='custom' && (
          <div className='mb-3 flex flex-wrap items-center gap-2'>
            <input
              type='date'
              value={tripCustomFrom}
              onChange={e=>setTripCustomFrom(e.target.value)}
              className='rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400'
            />
            <span className='text-xs text-slate-400'>to</span>
            <input
              type='date'
              value={tripCustomTo}
              onChange={e=>setTripCustomTo(e.target.value)}
              className='rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400'
            />
            <button
              onClick={()=>fetchTripRange(tripCustomFrom,tripCustomTo||tripCustomFrom)}
              disabled={!tripCustomFrom||tripRangeLoading}
              className='rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-40'
            >
              {tripRangeLoading?'Loading…':'Load'}
            </button>
          </div>
        )}

        {/* Loading / error states for range fetch */}
        {tripMode!=='today' && tripRangeLoading && (
          <div className='py-8 text-center text-xs text-slate-400'>Loading trips…</div>
        )}
        {tripMode!=='today' && tripRangeError && (
          <div className='py-4 text-center text-xs text-rose-500'>{tripRangeError}</div>
        )}

        {/* Trip content */}
        {!(tripMode!=='today' && (tripRangeLoading||tripRangeError)) && (
          effectiveTripStats.length===0 ? (
            <div className='rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-500'>
              {tripMode==='custom'&&!tripCustomFrom ? 'Select a date range and click Load.' : 'No trips detected for this period.'}
            </div>
          ) : (
            <>
              {/* Truck tab bar */}
              <div className='flex gap-1 overflow-x-auto border-b border-slate-100 pb-3'>
                <button
                  onClick={()=>setTripTruck('__summary__')}
                  className={[
                    'flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    activeTruck==='__summary__' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
                  ].join(' ')}
                >
                  Summary
                </button>
                {effectiveTripStats.map((t:any)=>(
                  <button
                    key={t.truckId}
                    onClick={()=>setTripTruck(t.truckId)}
                    className={[
                      'flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                      activeTruck===t.truckId ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100',
                    ].join(' ')}
                  >
                    {t.plate}
                  </button>
                ))}
              </div>

              {/* Summary tab */}
              {activeTruck==='__summary__' && (
                <div className='mt-3 overflow-x-auto'>
                  <table className='min-w-full text-xs'>
                    <thead>
                      <tr className='text-left text-[10px] font-semibold uppercase tracking-widest text-slate-400'>
                        <th className='pb-2 pr-8'>Truck</th>
                        <th className='pb-2 pr-8'>Trips</th>
                        <th className='pb-2 pr-8'>Distance</th>
                        <th className='pb-2 pr-8'>Drive time</th>
                        <th className='pb-2'>Trailer</th>
                      </tr>
                    </thead>
                    <tbody className='divide-y divide-slate-50'>
                      {effectiveTripStats.map((t:any)=>(
                        <tr key={t.truckId}>
                          <td className='py-2.5 pr-8 font-semibold text-slate-900'>{t.plate}</td>
                          <td className='py-2.5 pr-8 text-slate-700'>{t.tripCount}</td>
                          <td className='py-2.5 pr-8 text-slate-700'>{t.totalKm} km</td>
                          <td className='py-2.5 pr-8 text-slate-500'>{fmtDur(t.totalDurationMin)}</td>
                          <td className='py-2.5'>
                            {t.trailerPlates?.length > 0
                              ? t.trailerPlates.map((p:string)=>(
                                  <span key={p} className='inline-block rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700 mr-1'>
                                    {p}
                                  </span>
                                ))
                              : <span className='text-slate-300'>—</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Per-truck detail tab */}
              {selectedTruck && (
                <div className='mt-3 overflow-x-auto'>
                  <table className='min-w-full text-xs'>
                    <thead>
                      <tr className='text-left text-[10px] font-semibold uppercase tracking-widest text-slate-400'>
                        <th className='pb-2 pr-6'>Departure</th>
                        <th className='pb-2 pr-6'>Arrival</th>
                        <th className='pb-2 pr-6'>From</th>
                        <th className='pb-2 pr-6'>To</th>
                        <th className='pb-2 pr-6'>Distance</th>
                        <th className='pb-2 pr-6'>Duration</th>
                        <th className='pb-2'>Trailer</th>
                      </tr>
                    </thead>
                    <tbody className='divide-y divide-slate-50'>
                      {selectedTruck.trips.map((trip:any,i:number)=>(
                        <tr key={i}>
                          <td className='py-2.5 pr-6 text-slate-700 whitespace-nowrap'>{trip.startTime}</td>
                          <td className='py-2.5 pr-6 text-slate-400 whitespace-nowrap'>{trip.endTime}</td>
                          <td className='py-2.5 pr-6 text-slate-700 max-w-[180px] truncate' title={trip.from}>{trip.from||'—'}</td>
                          <td className='py-2.5 pr-6 text-slate-700 max-w-[180px] truncate' title={trip.to}>{trip.to||'—'}</td>
                          <td className='py-2.5 pr-6 text-slate-700 whitespace-nowrap'>{trip.distanceKm} km</td>
                          <td className='py-2.5 pr-6 text-slate-500 whitespace-nowrap'>{fmtDur(trip.durationMin)}</td>
                          <td className='py-2.5 whitespace-nowrap'>
                            {trip.trailerPlate
                              ? <span className='inline-block rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700'>
                                  {trip.trailerPlate}
                                </span>
                              : <span className='text-slate-300'>—</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )
        )}
      </div>

      {/* Insight row: idle cost + driver speeding profile */}
      <div className='grid gap-6 lg:grid-cols-2'>

        {/* Idle cost today */}
        <div className='rounded-xl border bg-white p-5'>
          <div className='flex items-center justify-between'>
            <h3 className='text-sm font-semibold text-slate-900'>Idle cost today</h3>
            <span className='text-xs text-slate-400'>
              ~{idleSummary.burnRateLPerHr}L/hr · KES {idleSummary.kesPerLitre}/L
              {idleSummary.kesFromLogs ? ' · from fuel logs' : ' · no fuel logs yet'}
            </span>
          </div>
          {idleStats.length ? (
            <div className='mt-3 overflow-x-auto'>
              <table className='min-w-full text-xs'>
                <thead>
                  <tr className='text-left text-[10px] font-semibold uppercase tracking-widest text-slate-400'>
                    <th className='pb-2 pr-6'>Truck</th>
                    <th className='pb-2 pr-6'>Idle hrs</th>
                    <th className='pb-2 pr-6'>Est. litres</th>
                    <th className='pb-2 text-right'>Est. cost</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-slate-50'>
                  {idleStats.map((r:any) => (
                    <tr key={r.truckId}>
                      <td className='py-2 pr-6 font-semibold text-slate-900'>{r.plate}</td>
                      <td className='py-2 pr-6 text-slate-700'>{r.idleHours}h</td>
                      <td className='py-2 pr-6 text-slate-500'>{r.estimatedLitres}L</td>
                      <td className='py-2 text-right font-medium text-amber-700'>KES {r.estimatedCost.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className='border-t border-slate-200'>
                    <td colSpan={3} className='pt-2.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400'>Fleet total</td>
                    <td className='pt-2.5 text-right text-sm font-bold text-slate-900'>KES {idleSummary.totalEstimatedCost.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className='mt-3 rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500'>
              No significant idle time recorded today.
            </div>
          )}
        </div>

        {/* Driver speeding profile */}
        <div className='rounded-xl border bg-white p-5'>
          <div className='flex items-center justify-between'>
            <h3 className='text-sm font-semibold text-slate-900'>Driver speeding profile</h3>
            <span className='text-xs text-slate-400'>last 30 days</span>
          </div>
          {driverProfile.length ? (
            <div className='mt-3 overflow-x-auto'>
              <table className='min-w-full text-xs'>
                <thead>
                  <tr className='text-left text-[10px] font-semibold uppercase tracking-widest text-slate-400'>
                    <th className='pb-2 pr-6'>Driver</th>
                    <th className='pb-2 pr-6'>Truck</th>
                    <th className='pb-2 pr-6'>Events</th>
                    <th className='pb-2'>Top speed</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-slate-50'>
                  {driverProfile.map((r:any) => (
                    <tr key={r.driverId}>
                      <td className='py-2 pr-6 font-semibold text-slate-900'>{r.driverName}</td>
                      <td className='py-2 pr-6 text-slate-500'>{r.plate}</td>
                      <td className='py-2 pr-6'>
                        <span className={[
                          'font-semibold',
                          r.speedingCount >= 5 ? 'text-rose-600' : r.speedingCount >= 2 ? 'text-amber-600' : 'text-slate-600',
                        ].join(' ')}>
                          {r.speedingCount}
                        </span>
                      </td>
                      <td className={`py-2 font-medium ${r.maxSpeedKph >= 80 ? 'text-rose-600' : 'text-slate-600'}`}>
                        {r.maxSpeedKph} km/h
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className='mt-3 rounded-lg border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500'>
              No speeding events linked to drivers in the last 30 days.
              <p className='mt-1 text-slate-400'>Assign a primary driver to each truck to enable this.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function OrdersTab(){
  const role = localStorage.getItem('role') || 'ADMIN';
  const isAdmin = role === 'ADMIN';
  const PAYMENT_STATUS_OPTIONS = ['PENDING','PAID','DECLINED'];
  const ORDER_STATUS_OPTIONS = ['Received','In Transit','Delivered','Cancelled'];
  const PAYMENT_METHOD_OPTIONS = ['MPESA','BANK','CASH'];
  const PAYMENT_METHOD_LABELS: Record<string, string> = {
    MPESA: 'M-Pesa',
    BANK: 'Bank',
    CASH: 'Cash',
  };
  const formatStatusLabel = (value: string) => {
    if(!value) return '';
    return value
      .toString()
      .split(/[\s_]+/)
      .filter(Boolean)
      .map(part => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' ');
  };
  const getPaymentMethodLabel = (value: string) => {
    if(!value) return '';
    const upper = value.toString().toUpperCase();
    return PAYMENT_METHOD_LABELS[upper] || formatStatusLabel(value.toString());
  };
  const normalizePaymentMethod = (value?: string | null) => {
    if(!value) return 'MPESA';
    const trimmed = value.toString().trim();
    if(!trimmed) return 'MPESA';
    const upper = trimmed.toUpperCase();
    const collapsed = upper.replace(/[^A-Z]/g,'');
    if(PAYMENT_METHOD_OPTIONS.includes(upper)){
      return upper;
    }
    if(collapsed === 'MPESA'){
      return 'MPESA';
    }
    return trimmed;
  };
  const [orders,setOrders]=useState<any[]>([]);
  const [drivers,setDrivers]=useState<any[]>([]);
  const [trucks,setTrucks]=useState<any[]>([]);
  const [filter,setFilter]=useState<'all'|'assigned'|'pending'>('all');
  const [createOpen,setCreateOpen]=useState(false);
  const [moreOpen,setMoreOpen]=useState(false);
  const [newOrder,setNewOrder]=useState({ name:'', email:'', phone:'', site:'', sandType:'', trucks:1, distanceKm:'', dateNeeded:'', customerId:'', truckId:'', weightT:'', paymentStatus:'PENDING' });
  const [perTruckOverride,setPerTruckOverride]=useState('');
  const [quote,setQuote]=useState<{ perTruck:number; total:number; distanceKm:number }|null>(null);
  const [quoteError,setQuoteError]=useState<string|null>(null);
  const [createStatus,setCreateStatus]=useState<{ kind:'idle'|'error'|'success'; message:string }>({ kind:'idle', message:'' });
  const [createLoading,setCreateLoading]=useState(false);
  const [quickStatusLoadingId,setQuickStatusLoadingId]=useState<string|null>(null);
  const [editingOrder,setEditingOrder]=useState<any|null>(null);
  const [editMode,setEditMode]=useState<'edit'|'delete'>('edit');
  const [editDraft,setEditDraft]=useState({ paymentStatus:'', status:'', paymentMethod:'', paymentReference:'', paymentMessage:'', dateNeeded:'', cancelReason:'' });
  const [editStatus,setEditStatus]=useState<{ kind:'idle'|'error'|'success'; message:string }>({ kind:'idle', message:'' });
  const [editLoading,setEditLoading]=useState(false);
  const [deleteLoading,setDeleteLoading]=useState(false);
  const [deleteReason,setDeleteReason]=useState('');
  const [mobileEditOrderId,setMobileEditOrderId]=useState<string|null>(null);

  async function load(){
    const assigned = filter==='all'? undefined : (filter==='assigned'? 'true':'false');
    const [ordersRes, driversRes, trucksRes] = await Promise.all([
      api.get('/api/admin/orders',{ params:{ assigned } }),
      api.get('/api/admin/drivers'),
      api.get('/api/admin/trucks'),
    ]);
    const list = Array.isArray(ordersRes.data) ? ordersRes.data : [];
    setOrders(list);
    setDrivers(Array.isArray(driversRes.data) ? driversRes.data : []);
    setTrucks(Array.isArray(trucksRes.data) ? trucksRes.data : []);
    if(editingOrder){
      const refreshed = list.find((item:any)=> item.id===editingOrder.id);
      if(refreshed){
        setEditingOrder(refreshed);
        setEditDraft({
          paymentStatus: (refreshed.payment_status || 'PENDING').toString().toUpperCase(),
          status: refreshed.status || 'Received',
          paymentMethod: normalizePaymentMethod(refreshed.payment_method),
          paymentReference: refreshed.payment_reference || '',
          paymentMessage: refreshed.payment_message || '',
          dateNeeded: refreshed.date_needed || '',
          cancelReason: refreshed.cancel_reason || '',
        });
      }else{
        setEditingOrder(null);
        setEditMode('edit');
      }
    }
  }
  useEffect(()=>{ load(); },[filter]);
  useEffect(()=>{
    if(!newOrder.site.trim() || !newOrder.sandType){
      setQuote(null);
      setQuoteError(null);
      return;
    }
    let cancelled=false;
    const timer=setTimeout(async()=>{
      try{
        const res=await api.post('/api/pricing/quote',{
          site:newOrder.site,
          trucks:newOrder.trucks,
          sandType:newOrder.sandType,
          distanceKm:newOrder.distanceKm?Number(newOrder.distanceKm):undefined,
        });
        if(!cancelled){
          setQuote(res.data);
          setQuoteError(null);
        }
      }catch(err:any){
        if(!cancelled){
          setQuote(null);
          setQuoteError(err?.response?.data?.error || 'Unable to refresh quote');
        }
      }
    },250);
    return ()=>{ cancelled=true; clearTimeout(timer); };
  },[newOrder.site, newOrder.trucks, newOrder.sandType, newOrder.distanceKm]);

  async function create(){
    if(!newOrder.name.trim() || !newOrder.phone.trim()){
      setCreateStatus({ kind:'error', message:'Add the customer name and phone number.' });
      return;
    }
    if(!newOrder.sandType){
      setCreateStatus({ kind:'error', message:'Select the sand type before creating the order.' });
      return;
    }
    if(createLoading) return;
    try{
      setCreateLoading(true);
      const res = await api.post('/api/admin/orders', {
        ...newOrder,
        trucks: newOrder.trucks,
        distanceKm: newOrder.distanceKm ? Number(newOrder.distanceKm) : undefined,
        perTruckOverride: perTruckOverride ? Number(perTruckOverride) : undefined,
        paymentStatus: newOrder.paymentStatus,
      });
      const orderId = res?.data?.id;
      if(orderId && newOrder.truckId){
        const selectedTruck = trucks.find(t=> t.id===newOrder.truckId);
        await api.post(`/api/admin/orders/${orderId}/assignments`, {
          truckId: newOrder.truckId,
          driverId: selectedTruck?.primaryDriverId || '',
          tonnes: newOrder.weightT ? Number(newOrder.weightT) : undefined,
          withTrailer: false,
        });
      }
      setCreateStatus({ kind:'success', message:'Order recorded.' });
      setCreateOpen(false);
      setMoreOpen(false);
      setNewOrder({ name:'', email:'', phone:'', site:'', sandType:'', trucks:1, distanceKm:'', dateNeeded:'', customerId:'', truckId:'', weightT:'', paymentStatus:'PENDING' });
      setPerTruckOverride('');
      setQuote(null);
      await load();
    }catch(err:any){
      setCreateStatus({ kind:'error', message: err?.response?.data?.error || 'Failed to create order.' });
    }finally{
      setCreateLoading(false);
    }
  }
  async function quickUpdateOrder(orderId:string, patch:Record<string,any>){
    setQuickStatusLoadingId(orderId);
    try{
      await api.patch(`/api/admin/orders/${orderId}`, patch);
      await load();
    }catch(err:any){
      setCreateStatus({ kind:'error', message: err?.response?.data?.error || 'Failed to update order.' });
    }finally{
      setQuickStatusLoadingId(null);
    }
  }
  function startEdit(order:any, mode:'edit'|'delete'='edit'){
    setMobileEditOrderId(null);
    setEditingOrder(order);
    setEditMode(mode);
    setEditDraft({
      paymentStatus: (order.payment_status || 'PENDING').toString().toUpperCase(),
      status: order.status || 'Received',
      paymentMethod: normalizePaymentMethod(order.payment_method),
      paymentReference: order.payment_reference || '',
      paymentMessage: order.payment_message || '',
      dateNeeded: order.date_needed || '',
      cancelReason: order.cancel_reason || '',
    });
    setEditStatus({ kind:'idle', message:'' });
    setDeleteReason('');
    setCreateOpen(false);
  }
  function cancelEdit(){
    setEditingOrder(null);
    setEditStatus({ kind:'idle', message:'' });
    setDeleteReason('');
    setEditMode('edit');
    setMobileEditOrderId(null);
  }
  async function saveEdit(){
    if(!editingOrder) return;
    if(!editDraft.paymentStatus){
      setEditStatus({ kind:'error', message:'Select a payment status before saving.' });
      return;
    }
    if(!editDraft.status){
      setEditStatus({ kind:'error', message:'Select an order status before saving.' });
      return;
    }
    if(!editDraft.paymentMethod){
      setEditStatus({ kind:'error', message:'Choose a payment method before saving.' });
      return;
    }
    if((editDraft.status || '').toLowerCase()==='cancelled' && !editDraft.cancelReason.trim()){
      setEditStatus({ kind:'error', message:'Add a short reason explaining the cancellation.' });
      return;
    }
    try{
      setEditLoading(true);
      await api.patch(`/api/admin/orders/${editingOrder.id}`, {
        paymentStatus: editDraft.paymentStatus,
        status: editDraft.status,
        paymentMethod: editDraft.paymentMethod,
        paymentReference: editDraft.paymentReference,
        paymentMessage: editDraft.paymentMessage,
        dateNeeded: editDraft.dateNeeded,
        cancelReason: editDraft.cancelReason,
      });
      setEditStatus({ kind:'success', message:'Order updated.' });
      await load();
    }catch(err:any){
      setEditStatus({ kind:'error', message: err?.response?.data?.error || 'Failed to update order.' });
    }finally{
      setEditLoading(false);
    }
  }
  async function deleteOrder(){
    if(!editingOrder) return;
    const reason = deleteReason.trim();
    if(reason.length < 5){
      setEditStatus({ kind:'error', message:'Please provide at least 5 characters to explain the deletion.' });
      return;
    }
    try{
      setDeleteLoading(true);
      await api.delete(`/api/admin/orders/${editingOrder.id}`, { data:{ reason } });
      setEditStatus({ kind:'success', message:'Order deleted.' });
      await load();
      setEditingOrder(null);
      setDeleteReason('');
      setEditMode('edit');
      setMobileEditOrderId(null);
    }catch(err:any){
      setEditStatus({ kind:'error', message: err?.response?.data?.error || 'Failed to delete order.' });
    }finally{
      setDeleteLoading(false);
    }
  }
  function handleMobileEdit(order:any, mode:'edit'|'delete'='edit'){
    const sameCard = mobileEditOrderId === order.id && editingOrder?.id === order.id && editMode === mode;
    if(sameCard){
      cancelEdit();
      return;
    }
    startEdit(order, mode);
    setMobileEditOrderId(order.id);
  }
  async function assign(orderId:string, truckId:string, driverId:string, tonnes:string, withTrailer:boolean){
    await api.post(`/api/admin/orders/${orderId}/assignments`, { truckId, driverId, tonnes: tonnes ? Number(tonnes) : undefined, withTrailer });
    await load();
  }
  const renderEditFields = () => {
    const normalizedMethodValue = (editDraft.paymentMethod || '').toString().toUpperCase();
    return (
      <>
        <label className='block text-xs font-semibold uppercase tracking-wide text-slate-600'>Payment status
          <select className='mt-1 w-full rounded border px-2 py-1 text-sm' value={editDraft.paymentStatus} onChange={e=>setEditDraft({...editDraft, paymentStatus:e.target.value.toUpperCase()})}>
            {PAYMENT_STATUS_OPTIONS.map(opt=> <option key={opt} value={opt}>{formatStatusLabel(opt)}</option>)}
            {!PAYMENT_STATUS_OPTIONS.includes(editDraft.paymentStatus) && editDraft.paymentStatus && (
              <option value={editDraft.paymentStatus}>{formatStatusLabel(editDraft.paymentStatus)}</option>
            )}
          </select>
        </label>
        <label className='block text-xs font-semibold uppercase tracking-wide text-slate-600'>Order status
          <select className='mt-1 w-full rounded border px-2 py-1 text-sm' value={editDraft.status} onChange={e=>setEditDraft({...editDraft, status:e.target.value})}>
            {ORDER_STATUS_OPTIONS.map(opt=> <option key={opt} value={opt}>{opt}</option>)}
            {!!editDraft.status && !ORDER_STATUS_OPTIONS.includes(editDraft.status) && (
              <option value={editDraft.status}>{editDraft.status}</option>
            )}
          </select>
        </label>
        {(editDraft.status || '').toLowerCase()==='cancelled' && (
          <label className='block text-xs font-semibold uppercase tracking-wide text-rose-600'>Cancellation reason
            <textarea
              className='mt-1 w-full rounded border px-2 py-1 text-sm'
              rows={3}
              placeholder='Why is this order cancelled?'
              value={editDraft.cancelReason}
              onChange={e=>setEditDraft({...editDraft, cancelReason:e.target.value})}
            />
          </label>
        )}
        <label className='block text-xs font-semibold uppercase tracking-wide text-slate-600'>Payment method
          <select className='mt-1 w-full rounded border px-2 py-1 text-sm' value={editDraft.paymentMethod} onChange={e=>setEditDraft({...editDraft, paymentMethod:e.target.value})}>
            {PAYMENT_METHOD_OPTIONS.map(opt=> <option key={opt} value={opt}>{getPaymentMethodLabel(opt)}</option>)}
            {!!editDraft.paymentMethod && !PAYMENT_METHOD_OPTIONS.includes(normalizedMethodValue) && (
              <option value={editDraft.paymentMethod}>{getPaymentMethodLabel(editDraft.paymentMethod)}</option>
            )}
          </select>
        </label>
        <label className='block text-xs font-semibold uppercase tracking-wide text-slate-600'>Payment reference
          <input className='mt-1 w-full rounded border px-2 py-1 text-sm' value={editDraft.paymentReference} onChange={e=>setEditDraft({...editDraft, paymentReference:e.target.value})}/>
        </label>
        <label className='block text-xs font-semibold uppercase tracking-wide text-slate-600'>Payment note
          <textarea className='mt-1 w-full rounded border px-2 py-1 text-sm' rows={2} value={editDraft.paymentMessage} onChange={e=>setEditDraft({...editDraft, paymentMessage:e.target.value})}/>
        </label>
        <label className='block text-xs font-semibold uppercase tracking-wide text-slate-600'>Date needed
          <input type='date' className='mt-1 w-full rounded border px-2 py-1 text-sm' value={editDraft.dateNeeded || ''} onChange={e=>setEditDraft({...editDraft, dateNeeded:e.target.value})}/>
        </label>
      </>
    );
  };
  const renderDeleteSection = (variant:'desktop'|'mobile'='desktop') => (
    <>
      <p className={`mt-2 text-xs ${variant==='mobile' ? 'text-slate-600' : 'text-slate-500'}`}>Removing an order cancels any pending assignments. Provide a short note so the team understands why it was removed.</p>
      <textarea className='mt-2 w-full rounded border px-2 py-1 text-sm' rows={3} placeholder='Reason for deleting this order' value={deleteReason} onChange={e=>setDeleteReason(e.target.value)} />
      <div className='mt-3 flex flex-wrap gap-2'>
        <button onClick={deleteOrder} disabled={deleteLoading || deleteReason.trim().length < 5} className='rounded bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50'>{deleteLoading ? 'Deleting...' : 'Delete order'}</button>
        <button onClick={()=>{ setDeleteReason(''); setEditMode('edit'); }} className='rounded border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300'>Clear reason</button>
      </div>
    </>
  );

  return (
    <div className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
      <div className='lg:col-span-2 space-y-4'>
        <div className='hidden lg:block overflow-hidden rounded-xl border bg-white'>
          <div className='overflow-x-auto'>
            <table className='min-w-full text-sm'>
              <thead className='bg-amber-50 text-slate-600'>
                <tr>
                  <th className='px-3 py-2 text-left'>When</th>
                  <th className='px-3 py-2 text-left'>Customer</th>
                  <th className='px-3 py-2 text-left'>Site</th>
                  <th className='px-3 py-2 text-left'>Sand</th>
                  <th className='px-3 py-2 text-right'>Trucks</th>
                  <th className='px-3 py-2 text-right'>Total</th>
                  <th className='px-3 py-2 text-left'>Payment</th>
                  <th className='px-3 py-2 text-left'>Status</th>
                  <th className='px-3 py-2 text-left'>Dispatch</th>
                  <th className='px-3 py-2 text-left'>Manage</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o=>{
                  const isCancelled = (o.status||'').toLowerCase()==='cancelled';
                  const isPaid = (o.payment_status||'').toString().toUpperCase()==='PAID';
                  const isBusy = quickStatusLoadingId===o.id;
                  return (
                    <tr key={o.id} className='border-t align-top'>
                      <td className='px-3 py-2 text-xs text-slate-600'>{new Date(o.created_at).toLocaleString()}</td>
                      <td className='px-3 py-2 text-sm font-semibold text-slate-900'>{o.name||o.email||'Customer'}</td>
                      <td className='px-3 py-2 text-sm text-slate-700'>{o.site}</td>
                      <td className='px-3 py-2 text-xs uppercase text-slate-600'>{o.sand_type||'-'}</td>
                      <td className='px-3 py-2 text-right text-sm font-medium text-slate-900'>{o.trucks}</td>
                      <td className='px-3 py-2 text-right text-sm font-semibold text-slate-900'>KES {Number(o.total||0).toLocaleString()}</td>
                      <td className='px-3 py-2'>
                        <button
                          disabled={isBusy}
                          onClick={()=>quickUpdateOrder(o.id, { paymentStatus: isPaid ? 'PENDING' : 'PAID' })}
                          className={`rounded-full px-2 py-1 text-xs font-semibold disabled:opacity-50 ${isPaid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
                        >
                          {isPaid ? 'Paid' : 'Mark paid'}
                        </button>
                      </td>
                      <td className='px-3 py-2 text-xs text-slate-700'>
                        {isCancelled ? (
                          <div className='font-semibold'>Cancelled</div>
                        ) : (
                          <select
                            disabled={isBusy}
                            value={o.status || 'Received'}
                            onChange={e=>quickUpdateOrder(o.id, { status:e.target.value })}
                            className='rounded border px-1.5 py-1 text-xs'
                          >
                            {ORDER_STATUS_OPTIONS.filter(s=>s!=='Cancelled').map(s=> <option key={s} value={s}>{s}</option>)}
                            {o.status && !ORDER_STATUS_OPTIONS.includes(o.status) && (
                              <option value={o.status}>{formatStatusLabel(o.status)}</option>
                            )}
                          </select>
                        )}
                        {o.cancel_reason && (
                          <div className='mt-1 text-[11px] text-slate-500'>Reason: {o.cancel_reason}</div>
                        )}
                      </td>
                      <td className='px-3 py-2'>
                        {isCancelled ? (
                          <div className='rounded border border-dashed border-slate-200 px-2 py-1 text-xs text-slate-500'>Order closed</div>
                        ) : (
                          <AssignInline trucks={trucks} drivers={drivers} onSave={(tid,did,tn,wt)=>assign(o.id,tid,did,tn,wt)} />
                        )}
                      </td>
                      <td className='px-3 py-2'>
                        <div className='flex gap-2 text-xs'>
                          <button onClick={()=>startEdit(o,'edit')} className='rounded border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50'>More</button>
                          {isAdmin && (
                            <button onClick={()=>startEdit(o,'delete')} className='rounded border border-rose-200 px-2 py-1 font-semibold text-rose-600 hover:border-rose-300 hover:bg-rose-50'>Delete</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {orders.length===0 && (
                  <tr>
                    <td colSpan={10} className='px-3 py-6 text-center text-sm text-slate-500'>No orders yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className='space-y-3 lg:hidden'>
          {orders.map(o=>{
            const paymentDisplay = formatStatusLabel((o.payment_status||'PENDING').toString());
            const isCancelled = (o.status||'').toLowerCase()==='cancelled';
            const statusDisplay = formatStatusLabel(o.status || 'Received');
            const isEditingMobile = editingOrder?.id === o.id && mobileEditOrderId === o.id;
            return (
              <div key={o.id} className='rounded-xl border bg-white p-4 text-sm shadow-sm'>
                <div className='flex items-start justify-between gap-3'>
                  <div>
                    <div className='text-sm font-semibold text-slate-900'>{o.name||o.email||'Customer'}</div>
                    <div className='text-xs text-slate-600'>{o.site}</div>
                    <div className='text-[11px] text-slate-400'>{new Date(o.created_at).toLocaleString()}</div>
                  </div>
                  <div className='text-right'>
                    <div className='text-xs font-semibold uppercase text-slate-500'>{paymentDisplay}</div>
                    <div className='text-base font-semibold text-slate-900'>KES {Number(o.total||0).toLocaleString()}</div>
                    <div className='text-[11px] text-slate-500'>{getPaymentMethodLabel(o.payment_method || '')}</div>
                  </div>
                </div>
                <div className='mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-600'>
                  <span className='rounded-full bg-slate-100 px-2 py-0.5'>Trucks {o.trucks}</span>
                  <span className='rounded-full bg-amber-50 px-2 py-0.5 text-amber-800'>{(o.sand_type||'-').toString().toUpperCase()}</span>
                  <span className={`rounded-full px-2 py-0.5 ${isCancelled ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{statusDisplay}</span>
                </div>
                {o.cancel_reason && <div className='mt-2 text-[11px] text-rose-600'>Reason: {o.cancel_reason}</div>}
                <details className='mt-3 rounded border border-slate-200 px-3 py-2 text-xs text-slate-600'>
                  <summary className='cursor-pointer font-semibold text-slate-700'>Dispatch & assignments</summary>
                  <div className='mt-2'>
                    {isCancelled ? (
                      <div className='rounded border border-dashed border-slate-200 px-2 py-1 text-slate-500'>Order closed</div>
                    ) : (
                      <AssignInline trucks={trucks} drivers={drivers} onSave={(tid,did,tn,wt)=>assign(o.id,tid,did,tn,wt)} />
                    )}
                  </div>
                </details>
                <div className='mt-3 flex flex-wrap gap-2 text-xs'>
                  <button
                    onClick={()=>handleMobileEdit(o,'edit')}
                    className='flex-1 rounded border border-slate-200 px-3 py-1 font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  >
                    {isEditingMobile && editMode==='edit' ? 'Close edit' : 'Edit order'}
                  </button>
                  {isAdmin && (
                    <button
                      onClick={()=>handleMobileEdit(o,'delete')}
                      className='flex-1 rounded border border-rose-200 px-3 py-1 font-semibold text-rose-600 hover:border-rose-300 hover:bg-rose-50'
                    >
                      {isEditingMobile && editMode==='delete' ? 'Close' : 'Delete'}
                    </button>
                  )}
                </div>
                {isEditingMobile && (
                  <div className='mt-3 space-y-3 text-xs'>
                    {editStatus.kind !== 'idle' && (
                      <div className={`rounded px-3 py-2 text-xs ${editStatus.kind==='success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                        {editStatus.message}
                      </div>
                    )}
                    <details open={editMode!=='delete'} className='rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600'>
                      <summary className='cursor-pointer text-xs font-semibold text-slate-700'>Update order</summary>
                      <div className='mt-3 space-y-3 text-sm'>
                        {renderEditFields()}
                        <div className='flex flex-wrap gap-2 pt-2 text-xs'>
                          <button onClick={saveEdit} disabled={editLoading} className='rounded bg-slate-900 px-3 py-1.5 font-semibold text-white disabled:opacity-60'>
                            {editLoading ? 'Saving...' : 'Save changes'}
                          </button>
                          <button onClick={cancelEdit} className='rounded border px-3 py-1.5 font-semibold text-slate-600 hover:border-slate-300'>Cancel</button>
                        </div>
                      </div>
                    </details>
                    {isAdmin && (
                      <details open={editMode==='delete'} className='rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-rose-700'>
                        <summary className='cursor-pointer text-xs font-semibold text-rose-700'>Danger zone</summary>
                        <div className='mt-3 space-y-2 text-slate-600'>
                          {renderDeleteSection('mobile')}
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {orders.length===0 && (
            <div className='rounded-xl border border-dashed bg-white p-6 text-center text-sm text-slate-500'>
              No orders yet.
            </div>
          )}
        </div>
      </div>
      <div className='space-y-4'>
        {editingOrder && (
          <div className='hidden rounded-xl border bg-white p-4 lg:block'>
            <div className='flex items-start justify-between gap-3'>
              <div>
                <h2 className='text-sm font-semibold text-slate-900'>{editMode==='delete' ? 'Delete order' : 'Edit order'}</h2>
                <div className='text-xs text-slate-500'>Order {editingOrder.id}</div>
              </div>
              <button onClick={cancelEdit} className='rounded border px-2 text-xs font-semibold text-slate-500 hover:border-slate-300'>Close</button>
            </div>
            {editStatus.kind !== 'idle' && (
              <div className={`mt-3 rounded px-3 py-2 text-xs ${editStatus.kind==='success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                {editStatus.message}
              </div>
            )}
            <div className='mt-4 space-y-3 text-sm'>
              {renderEditFields()}
              <div className='flex flex-wrap gap-2 pt-2'>
                <button onClick={saveEdit} disabled={editLoading} className='rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60'>{editLoading ? 'Saving...' : 'Save changes'}</button>
                <button onClick={cancelEdit} className='rounded border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300'>Cancel</button>
              </div>
            </div>
            {isAdmin && (
              <div className='mt-5 border-t pt-4'>
                <h3 className='text-xs font-semibold uppercase tracking-wide text-rose-600'>Delete order</h3>
                {renderDeleteSection('desktop')}
              </div>
            )}

          </div>
        )}
        <div className='rounded-xl border bg-white p-4'>
          <div className='mb-2 flex items-center justify-between'><h2 className='text-sm font-semibold text-slate-900'>New Order</h2><button onClick={()=>{ setCreateOpen(!createOpen); setCreateStatus({ kind:'idle', message:'' }); }} className='rounded border px-2 text-xs font-semibold'>{createOpen?'−':'+'}</button></div>
          {createOpen && (
            <div className='space-y-3 text-sm'>
              <label className='block'>Customer name
                <input className='mt-1 w-full rounded border p-1' value={newOrder.name} onChange={e=>setNewOrder({...newOrder, name:e.target.value})}/>
              </label>
              <label className='block'>Phone
                <input className='mt-1 w-full rounded border p-1' value={newOrder.phone} onChange={e=>setNewOrder({...newOrder, phone:e.target.value})}/>
              </label>
              <label className='block'>Truck
                <select className='mt-1 w-full rounded border p-1' value={newOrder.truckId} onChange={e=>{
                  const tid=e.target.value;
                  const t=trucks.find((x:any)=>x.id===tid);
                  setNewOrder({...newOrder, truckId:tid, weightT: newOrder.weightT || (t?.capacityT ? String(t.capacityT) : newOrder.weightT) });
                }}>
                  <option value=''>Assign later…</option>
                  {trucks.map((t:any)=> <option key={t.id} value={t.id}>{t.id} • {t.plate}</option>)}
                </select>
              </label>
              <div className='grid grid-cols-2 gap-3'>
                <label className='block'>Sand type
                  <select className='mt-1 w-full rounded border p-1' value={newOrder.sandType} onChange={e=>setNewOrder({...newOrder, sandType:e.target.value})}>
                    <option value=''>Select…</option>
                    <option value='coarse'>Coarse</option>
                    <option value='smooth'>Smooth</option>
                  </select>
                </label>
                <label className='block'>Weight (t)
                  <input type='number' min={0} step='0.1' className='mt-1 w-full rounded border p-1' value={newOrder.weightT} onChange={e=>setNewOrder({...newOrder, weightT:e.target.value})} placeholder='Optional'/>
                </label>
              </div>
              <label className='block'>Amount (KES)
                <input type='number' min={0} className='mt-1 w-full rounded border p-1' value={perTruckOverride} onChange={e=>setPerTruckOverride(e.target.value)} placeholder={quote ? `Suggested KES ${quote.perTruck.toLocaleString()}` : 'e.g. 33000'}/>
                {newOrder.trucks>1 && perTruckOverride && (
                  <span className='mt-1 block text-[11px] text-slate-500'>× {newOrder.trucks} trucks = KES {(Number(perTruckOverride)*newOrder.trucks).toLocaleString()}</span>
                )}
              </label>
              <div className='block'>Payment
                <div className='mt-1 flex gap-2'>
                  <button type='button' onClick={()=>setNewOrder({...newOrder, paymentStatus:'PENDING'})} className={`flex-1 rounded border px-3 py-1.5 text-xs font-semibold ${newOrder.paymentStatus==='PENDING' ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-500'}`}>Unpaid</button>
                  <button type='button' onClick={()=>setNewOrder({...newOrder, paymentStatus:'PAID'})} className={`flex-1 rounded border px-3 py-1.5 text-xs font-semibold ${newOrder.paymentStatus==='PAID' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-500'}`}>Paid</button>
                </div>
              </div>

              <button type='button' onClick={()=>setMoreOpen(!moreOpen)} className='text-xs font-semibold text-slate-500 hover:text-slate-700'>{moreOpen ? '− Fewer details' : '+ More details (email, site, distance, multiple trucks)'}</button>
              {moreOpen && (
                <div className='space-y-3 rounded-lg border border-dashed border-slate-200 p-3'>
                  <label className='block'>Email
                    <input className='mt-1 w-full rounded border p-1' value={newOrder.email} onChange={e=>setNewOrder({...newOrder, email:e.target.value})}/>
                  </label>
                  <label className='block'>Site location
                    <input className='mt-1 w-full rounded border p-1' value={newOrder.site} onChange={e=>setNewOrder({...newOrder, site:e.target.value})}/>
                  </label>
                  <label className='block'>Distance estimate (km)
                    <input className='mt-1 w-full rounded border p-1' value={newOrder.distanceKm} onChange={e=>setNewOrder({...newOrder, distanceKm:e.target.value})} placeholder='Optional'/>
                  </label>
                  <label className='block'>Trucks
                    <input type='number' min={1} className='mt-1 w-full rounded border p-1' value={newOrder.trucks} onChange={e=>setNewOrder({...newOrder, trucks:parseInt(e.target.value||'1')})}/>
                  </label>
                  <label className='block'>Date needed
                    <input type='date' className='mt-1 w-full rounded border p-1' value={newOrder.dateNeeded} onChange={e=>setNewOrder({...newOrder, dateNeeded:e.target.value})}/>
                  </label>
                </div>
              )}

              {quoteError && <div className='rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-600'>{quoteError}</div>}
              {createStatus.kind !== 'idle' && (
                <div className={`rounded-2xl px-3 py-2 text-xs ${createStatus.kind==='success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                  {createStatus.message}
                </div>
              )}
              <button onClick={create} disabled={createLoading} className='w-full rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-60'>{createLoading ? 'Creating…' : 'Create'}</button>
            </div>
          )}
        </div>
        <div className='rounded-xl border bg-white p-4'>
          <div className='mb-2 flex items-center justify-between'><h2 className='text-sm font-semibold text-slate-900'>Filter</h2>
            <select className='rounded border px-2 text-sm' value={filter} onChange={e=>setFilter(e.target.value as any)}><option value='all'>All</option><option value='pending'>Pending</option><option value='assigned'>Assigned</option></select>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssignInline({ trucks, drivers, onSave }:{ trucks:any[], drivers:any[], onSave:(tid:string,did:string,tonnes:string,withTrailer:boolean)=>void }){
  const [tid,setTid]=useState('');
  const [did,setDid]=useState('');
  const [tonnes,setTonnes]=useState('');
  const [withTrailer,setWithTrailer]=useState(false);
  return (
    <div className='flex flex-wrap items-center gap-2 text-xs'>
      <select className='w-full rounded border px-2 py-1 sm:w-auto' value={tid} onChange={e=>{
        const nextId=e.target.value;
        setTid(nextId);
        const t=trucks.find((x:any)=>x.id===nextId);
        if(t?.capacityT && !tonnes) setTonnes(String(t.capacityT));
      }}>
        <option value=''>Truck…</option>
        {trucks.map(t=> <option key={t.id} value={t.id}>{t.id} • {t.plate}</option>)}
      </select>
      <select className='w-full rounded border px-2 py-1 sm:w-auto' value={did} onChange={e=>setDid(e.target.value)}>
        <option value=''>Driver…</option>
        {drivers.map(d=> <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <input type='number' min={0} step='0.1' placeholder='Weight (t)' className='w-full rounded border px-2 py-1 sm:w-24' value={tonnes} onChange={e=>setTonnes(e.target.value)} />
      <label className='flex cursor-pointer items-center gap-1.5 rounded border border-orange-200 bg-orange-50 px-2 py-1 text-orange-700'>
        <input type='checkbox' checked={withTrailer} onChange={e=>setWithTrailer(e.target.checked)} className='accent-orange-500' />
        With trailer
      </label>
      <button
        onClick={()=> tid && onSave(tid,did||'',tonnes,withTrailer)}
        className='w-full rounded bg-slate-900 px-3 py-1.5 text-white sm:w-auto'
      >
        Assign
      </button>
    </div>
  );
}

function StockTab(){
  return <AdminStockPanel/>;
}

function CostsTab(){
  const [rows,setRows]=useState<any[]>([]);
  const [trucks,setTrucks]=useState<any[]>([]);
  const [drivers,setDrivers]=useState<any[]>([]);
  const [form,setForm]=useState<any>({ type:'FUEL', amount:'', truckId:'', driverId:'', description:'' });
  const [status,setStatus]=useState<{ kind:'idle'|'success'|'error'; message:string }>({ kind:'idle', message:'' });
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicateCostPrompt | null>(null);
  const [confirmingDuplicate, setConfirmingDuplicate] = useState(false);

  const resetForm = () => setForm({ type:'FUEL', amount:'', truckId:'', driverId:'', description:'' });

  async function load(){
    try{
      const [costsRes, trucksRes, driversRes] = await Promise.all([
        api.get('/api/admin/costs'),
        api.get('/api/admin/trucks'),
        api.get('/api/admin/drivers'),
      ]);
      setRows(Array.isArray(costsRes.data)?costsRes.data:[]);
      setTrucks(Array.isArray(trucksRes.data)?trucksRes.data:[]);
      setDrivers(Array.isArray(driversRes.data)?driversRes.data:[]);
      setDuplicatePrompt(null);
    }catch(err:any){
      setStatus({ kind:'error', message: err?.response?.data?.error || err?.message || 'Failed to load costs data.' });
    }
  }
  useEffect(()=>{ load(); },[]);

  const truckById = useMemo(()=>{
    const map = new Map<string, any>();
    trucks.forEach((truck:any)=>{
      if(truck?.id){
        map.set(truck.id, truck);
      }
    });
    return map;
  },[trucks]);

  const driverById = useMemo(()=>{
    const map = new Map<string, any>();
    drivers.forEach((driver:any)=>{
      if(driver?.id){
        map.set(driver.id, driver);
      }
    });
    return map;
  },[drivers]);
  const selectedDriver = form.driverId ? driverById.get(form.driverId) || null : null;
  const selectedDriverTruckId = selectedDriver?.assignedTruckId || '';
  const selectedDriverTruckLabel = selectedDriverTruckId
    ? truckById.get(selectedDriverTruckId)?.plate || selectedDriver.assignedTruckPlate || selectedDriverTruckId
    : '';
  const formTruckLabel = form.truckId ? truckById.get(form.truckId)?.plate || form.truckId : '';
  const showTruckLabel = formTruckLabel || selectedDriverTruckLabel;
  const driverTruckMismatch = Boolean(
    formTruckLabel && selectedDriverTruckLabel && formTruckLabel !== selectedDriverTruckLabel
  );

  async function add(){
    const amountValue = parseFloat(form.amount || '0');
    if(!form.type){
      setStatus({ kind:'error', message:'Select a cost type.' });
      return;
    }
    if(form.type === 'SALARY'){
      if(!form.driverId){
        setStatus({ kind:'error', message:'Select the driver receiving this salary.' });
        return;
      }
      if(!form.truckId){
        setStatus({ kind:'error', message:'Link the driver to a truck before recording their salary.' });
        return;
      }
    }else if(!form.truckId){
      setStatus({ kind:'error', message:'Select a truck for this cost.' });
      return;
    }
    if(!Number.isFinite(amountValue) || amountValue <= 0){
      setStatus({ kind:'error', message:'Enter an amount greater than zero.' });
      return;
    }
    if(!form.description?.trim()){
      setStatus({ kind:'error', message:'Provide a short description for this cost.' });
      return;
    }
    const payload: CostPayload = {
      truckId: form.truckId,
      type: form.type,
      amount: amountValue,
      description: form.description.trim(),
    };
    if(form.driverId){
      payload.driverId = form.driverId;
    }
    setDuplicatePrompt(null);
    try{
      await api.post('/api/admin/costs', payload);
      setStatus({ kind:'success', message:'Cost recorded successfully.' });
      resetForm();
      await load();
    }catch(err:any){
      if(err?.response?.status === 409 && err?.response?.data?.duplicate){
        setDuplicatePrompt({
          message: err?.response?.data?.message || 'Potential duplicate cost detected.',
          existing: err?.response?.data?.existing || null,
          payload,
        });
        setStatus({ kind:'error', message:'Duplicate detected. Review below before confirming.' });
        return;
      }
      setStatus({ kind:'error', message: err?.response?.data?.error || err?.message || 'Failed to record cost.' });
    }
  }

  async function confirmDuplicate(){
    if(!duplicatePrompt) return;
    const duplicateOf = duplicatePrompt.existing?.duplicate_of || duplicatePrompt.existing?.id || null;
    try{
      setConfirmingDuplicate(true);
      await api.post('/api/admin/costs',{
        ...duplicatePrompt.payload,
        overrideDuplicate:true,
        duplicateOf: duplicateOf || undefined,
      });
      setStatus({ kind:'success', message:'Duplicate cost recorded and flagged for audit.' });
      resetForm();
      setDuplicatePrompt(null);
      await load();
    }catch(err:any){
      setStatus({ kind:'error', message: err?.response?.data?.error || err?.message || 'Failed to confirm duplicate.' });
    }finally{
      setConfirmingDuplicate(false);
    }
  }

  function dismissDuplicatePrompt(){
    setDuplicatePrompt(null);
  }

  return (<div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
    <div className='rounded-xl border bg-white p-4'>
      <h2 className='text-sm font-semibold text-slate-900'>Add cost</h2>
      {duplicatePrompt && (
        <div className='mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900'>
          <div className='text-sm font-semibold text-amber-700'>Possible duplicate detected</div>
          <p className='mt-1 text-xs text-amber-800'>
            {duplicatePrompt.message || 'An existing cost entry matches this submission. Confirm if it is intentional.'}
          </p>
          <div className='mt-2 grid gap-2 sm:grid-cols-2'>
            <div>
              <div className='text-[11px] font-semibold uppercase tracking-wide text-amber-700'>Existing entry</div>
              <ul className='mt-1 space-y-1'>
                <li>Truck: {duplicatePrompt.existing?.truck_id || 'n/a'}</li>
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
                <li>Amount: {Number(duplicatePrompt.payload.amount).toLocaleString()}</li>
                <li>Description: {duplicatePrompt.payload.description}</li>
              </ul>
            </div>
          </div>
          <div className='mt-3 flex flex-wrap gap-2 text-xs'>
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
      <div className='mt-2 grid grid-cols-2 gap-2 text-sm'>
        <label className='block'>Type
          <select
            className='mt-1 w-full rounded border p-1'
            value={form.type}
            onChange={e=>{
              const nextType = e.target.value;
              setForm((prev:any)=>{
                if(nextType === 'SALARY'){
                  return { ...prev, type: nextType, driverId:'', truckId:'' };
                }
                return { ...prev, type: nextType, driverId:'' };
              });
              if(status.kind !== 'idle'){
                setStatus({ kind:'idle', message:'' });
              }
            }}
          >
            <option value='FUEL'>FUEL</option>
            <option value='SALARY'>SALARY</option>
            <option value='REPAIR'>REPAIR</option>
            <option value='MAINTENANCE'>MAINTENANCE</option>
            <option value='LOADING'>LOADING</option>
            <option value='OFFLOADING'>OFFLOADING</option>
            <option value='STOCK_PURCHASE'>STOCK_PURCHASE</option>
            <option value='OTHER'>OTHER</option>
          </select>
        </label>
        {form.type === 'SALARY' ? (
          <label className='block'>Driver
            <select
              className='mt-1 w-full rounded border p-1'
              value={form.driverId}
              onChange={e=>{
                const value = e.target.value;
                const driver = value ? driverById.get(value) || null : null;
                setForm((prev:any)=>({
                  ...prev,
                  driverId: value,
                  truckId: driver?.assignedTruckId || '',
                }));
                if(status.kind !== 'idle'){
                  setStatus({ kind:'idle', message:'' });
                }
              }}
            >
              <option value=''>Select driver...</option>
              {drivers.map((driver:any)=>(
                <option key={driver.id} value={driver.id}>
                  {driver.name || driver.id}
                  {driver.assignedTruckPlate || driver.assignedTruckId ? ` · ${driver.assignedTruckPlate || driver.assignedTruckId}` : ''}
                </option>
              ))}
            </select>
            {form.driverId ? (
              showTruckLabel ? (
                <>
                  <div className='mt-1 text-[11px] text-slate-500'>Linked truck: {showTruckLabel}</div>
                  {driverTruckMismatch && selectedDriverTruckLabel && (
                    <div className='mt-1 text-[11px] font-semibold text-amber-600'>
                      Driver&apos;s default truck is {selectedDriverTruckLabel}.
                    </div>
                  )}
                </>
              ) : (
                <div className='mt-1 text-[11px] font-semibold text-amber-600'>No truck linked to this driver yet.</div>
              )
            ) : (
              <div className='mt-1 text-[11px] text-slate-400'>Select a driver to auto-fill their truck.</div>
            )}
          </label>
        ) : (
          <label className='block'>Truck
            <select className='mt-1 w-full rounded border p-1' value={form.truckId} onChange={e=>setForm({...form, truckId:e.target.value})}>
              <option value=''>Select truck...</option>
              {trucks.map((truck:any)=>(
                <option key={truck.id} value={truck.id}>{truck.plate || truck.id}</option>
              ))}
            </select>
          </label>
        )}
        <label className='block col-span-2'>Amount (KES)<input type='number' min={0.01} step='0.01' className='mt-1 w-full rounded border p-1' value={form.amount} onChange={e=>setForm({...form, amount:e.target.value})}/></label>
        <label className='block col-span-2'>Description<input className='mt-1 w-full rounded border p-1' value={form.description} onChange={e=>setForm({...form, description:e.target.value})}/></label>
        <button onClick={add} className='col-span-2 rounded bg-slate-900 px-3 py-1.5 text-white'>Add</button>
      </div>
      {status.kind !== 'idle' && (
        <div className={`mt-3 rounded-xl px-3 py-2 text-xs ${status.kind==='success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
          {status.message}
        </div>
      )}
    </div>
    <div className='rounded-xl border bg-white p-4'>
      <h2 className='text-sm font-semibold text-slate-900'>Recent costs</h2>
      <div className='mt-2 max-h-80 overflow-auto text-xs'>
        {rows.map(x=>{
          const flagged = Boolean(x.is_duplicate);
          const className = flagged
            ? 'mb-1 rounded-lg border border-amber-300 bg-amber-50/70 px-2 py-1'
            : 'border-b py-1';
          return (
            <div key={x.id} className={className}>
              {new Date(x.incurred_at).toLocaleDateString()} • {x.type} • KES {Number(x.amount).toLocaleString()} • Truck {x.truck_id||'-'} • {x.description}
              {flagged && (
                <div className='text-[11px] font-semibold text-amber-700'>
                  Marked duplicate{ x.confirmed_at ? ` · ${new Date(x.confirmed_at).toLocaleString()}` : ''}{ x.duplicate_of ? ` · Ref ${x.duplicate_of}` : '' }
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  </div>);
}

function StatTile({ label, value, sub, tone }:{ label:string; value:string; sub?:string; tone?:'default'|'positive'|'negative' }){
  const toneClass = tone==='positive' ? 'text-emerald-700' : tone==='negative' ? 'text-rose-700' : 'text-slate-900';
  return (
    <div className='rounded-xl border bg-white p-4'>
      <div className='text-xs text-slate-500'>{label}</div>
      <div className={`mt-1 text-xl font-bold sm:text-2xl ${toneClass}`}>{value}</div>
      {sub && <div className='mt-0.5 text-[11px] text-slate-400'>{sub}</div>}
    </div>
  );
}

function TruckProfitRow({ row }:{ row:any }){
  const [open,setOpen]=useState(false);
  const gross = Number(row.gross||0);
  return (
    <>
      <tr className='cursor-pointer border-t hover:bg-slate-50' onClick={()=>setOpen(!open)}>
        <td className='px-3 py-2 font-semibold text-slate-900'>
          <span className='mr-1 inline-block w-3 text-slate-400'>{open ? '▾' : '▸'}</span>
          {row.plate || row.truckId}
        </td>
        <td className='px-3 py-2'>{row.loads}</td>
        <td className='px-3 py-2'>KES {Number(row.revenue).toLocaleString()}</td>
        <td className='px-3 py-2'>KES {Number(row.cost).toLocaleString()}</td>
        <td className={`px-3 py-2 font-semibold ${gross>=0 ? 'text-emerald-700' : 'text-rose-700'}`}>KES {gross.toLocaleString()}</td>
        <td className='px-3 py-2'>{Number(row.margin||0).toFixed(1)}%</td>
      </tr>
      {open && (
        <tr className='border-t bg-slate-50/60'>
          <td colSpan={6} className='px-3 py-3'>
            {row.costByType?.length ? (
              <div className='flex flex-wrap gap-2 text-xs'>
                {row.costByType.map((c:any)=>(
                  <span key={c.type} className='rounded-full border bg-white px-2 py-1 text-slate-600'>
                    {COST_TYPE_LABELS[c.type] || c.type}: KES {Number(c.amount).toLocaleString()}
                  </span>
                ))}
              </div>
            ) : (
              <div className='text-xs text-slate-400'>No costs logged for this truck in this range yet.</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function OverviewTab(){
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [summary,setSummary]=useState<any>(null);
  const [series,setSeries]=useState<any[]>([]);
  const [perTruck,setPerTruck]=useState<any[]>([]);
  const [pnl,setPnl]=useState<any>(null);
  const [stock,setStock]=useState<any>(null);
  const [recentTrips,setRecentTrips]=useState<any[]>([]);

  const load = useCallback(async()=>{
    try{
      setLoading(true);
      const params = { from: from||undefined, to: to||undefined };
      const [s, ts, tb, p, st, tx] = await Promise.all([
        api.get('/api/admin/finance/summary', { params }),
        api.get('/api/admin/finance/timeseries', { params }),
        api.get('/api/admin/finance/truck-breakdown', { params }),
        api.get('/api/admin/finance/pnl'),
        api.get('/api/admin/stock'),
        api.get('/api/admin/stock/tx'),
      ]);
      setSummary(s.data);
      setSeries(Array.isArray(ts.data) ? ts.data : []);
      setPerTruck(Array.isArray(tb.data) ? tb.data : []);
      setPnl(p.data);
      setStock(st.data);
      const txRows = Array.isArray(tx.data) ? tx.data : [];
      setRecentTrips(txRows.filter((t:any)=>t.kind==='IN').slice(0,5));
      setError(null);
    }catch(err:any){
      setError(err?.response?.data?.error || err?.message || 'Failed to load overview');
    }finally{
      setLoading(false);
    }
  },[from,to]);

  useEffect(()=>{ load(); },[load]);

  if(loading && !summary) return <div className='rounded-xl border bg-white p-6 text-sm text-slate-600'>Loading overview…</div>;
  if(error) return (
    <div className='rounded-xl border bg-white p-6 text-sm text-rose-600'>
      {error}
      <button onClick={()=>load()} className='ml-3 rounded border px-2 py-1 text-xs text-slate-600 hover:border-slate-300'>Retry</button>
    </div>
  );

  const gross = Number(summary?.gross||0);
  const margin = Number(summary?.margin||0);
  const stockTonnes = Number(stock?.tonnes||0);
  const costBreakdown = (pnl?.costBreakdown||[]).map((c:any)=>({ label: COST_TYPE_LABELS[c.type]||c.type, amount:Number(c.amount||0) })).sort((a:any,b:any)=>b.amount-a.amount);

  return (
    <div className='space-y-5'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs font-medium uppercase tracking-widest text-slate-400'>Range</span>
        <input type='date' className='rounded border border-slate-200 px-2 py-1 text-xs' value={from} onChange={e=>setFrom(e.target.value)} />
        <span className='text-xs text-slate-400'>to</span>
        <input type='date' className='rounded border border-slate-200 px-2 py-1 text-xs' value={to} onChange={e=>setTo(e.target.value)} />
        <button onClick={()=>load()} className='rounded border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:border-slate-300 hover:bg-white'>Refresh</button>
        {(from || to) && (
          <button onClick={()=>{ setFrom(''); setTo(''); }} className='text-xs text-slate-400 hover:text-slate-600'>Clear range</button>
        )}
      </div>

      <div className='grid grid-cols-2 gap-3 md:grid-cols-5'>
        <StatTile label='Revenue' value={`KES ${Number(summary?.revenue||0).toLocaleString()}`} sub={`${summary?.orders||0} orders`} />
        <StatTile label='Costs' value={`KES ${Number(summary?.costTotal||0).toLocaleString()}`} />
        <StatTile label='Gross profit' value={`KES ${gross.toLocaleString()}`} tone={gross>=0 ? 'positive':'negative'} />
        <StatTile label='Margin' value={`${margin.toFixed(1)}%`} tone={margin>=0 ? 'positive':'negative'} />
        <StatTile label='Stock on hand' value={`${stockTonnes.toLocaleString()} t`} sub={`${stock?.trucks_coarse||0} coarse · ${stock?.trucks_smooth||0} smooth`} />
      </div>

      <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
        <div className='rounded-xl border bg-white p-4'>
          <h3 className='text-sm font-semibold text-slate-900'>Revenue vs costs</h3>
          <div className='mt-2 h-64'>
            {series.length ? (
              <ResponsiveContainer width='100%' height='100%'>
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray='3 3' vertical={false} />
                  <XAxis dataKey='date' tick={{ fontSize:11 }} />
                  <YAxis tick={{ fontSize:11 }} width={44} />
                  <Tooltip formatter={(v:any)=>`KES ${Number(v).toLocaleString()}`} />
                  <Legend wrapperStyle={{ fontSize:11 }} />
                  <Line type='monotone' dataKey='revenue' name='Revenue' stroke='#059669' strokeWidth={2} dot={false} />
                  <Line type='monotone' dataKey='cost' name='Cost' stroke='#d97706' strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className='flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-500'>No revenue or cost data in this range yet.</div>
            )}
          </div>
        </div>

        <div className='rounded-xl border bg-white p-4'>
          <h3 className='text-sm font-semibold text-slate-900'>Costs by category — this month</h3>
          <div className='mt-2 h-64'>
            {costBreakdown.length ? (
              <ResponsiveContainer width='100%' height='100%'>
                <BarChart data={costBreakdown} layout='vertical' margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray='3 3' horizontal={false} />
                  <XAxis type='number' tick={{ fontSize:11 }} />
                  <YAxis type='category' dataKey='label' tick={{ fontSize:11 }} width={92} />
                  <Tooltip formatter={(v:any)=>`KES ${Number(v).toLocaleString()}`} />
                  <Bar dataKey='amount' fill='#d97706' radius={[0,3,3,0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className='flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-500'>No costs recorded this month yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className='rounded-xl border bg-white p-4'>
        <div className='flex items-baseline justify-between'>
          <h3 className='text-sm font-semibold text-slate-900'>Profit per truck</h3>
          <span className='text-xs text-slate-400'>Click a truck for its cost breakdown</span>
        </div>
        <div className='mt-2 overflow-auto'>
          <table className='w-full text-sm'>
            <thead className='bg-amber-50 text-slate-600'>
              <tr>
                <th className='px-3 py-2 text-left'>Truck</th>
                <th className='px-3 py-2 text-left'>Loads</th>
                <th className='px-3 py-2 text-left'>Revenue</th>
                <th className='px-3 py-2 text-left'>Costs</th>
                <th className='px-3 py-2 text-left'>Gross</th>
                <th className='px-3 py-2 text-left'>Margin</th>
              </tr>
            </thead>
            <tbody>
              {perTruck.map((r:any)=> <TruckProfitRow key={r.truckId} row={r} />)}
              {!perTruck.length && (
                <tr><td colSpan={6} className='px-3 py-6 text-center text-sm text-slate-500'>No deliveries in this range yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className='rounded-xl border bg-white p-4'>
        <h3 className='text-sm font-semibold text-slate-900'>Recent Mwingi trips (stock in)</h3>
        <div className='mt-2 space-y-2 text-xs'>
          {recentTrips.map((t:any)=>(
            <div key={t.id} className='flex items-center justify-between border-b border-slate-100 pb-2'>
              <div>
                <span className='font-semibold text-slate-800'>{t.truck_id || '—'}</span>
                <span className='ml-2 text-slate-500'>{(t.category||'coarse').toUpperCase()} · {Number(t.weight_tonnes ?? t.tonnes ?? 0).toFixed(1)} t</span>
              </div>
              <span className='text-slate-400'>{t.created_at ? new Date(t.created_at).toLocaleString() : ''}</span>
            </div>
          ))}
          {!recentTrips.length && <div className='text-slate-400'>No Mwingi trips recorded yet.</div>}
        </div>
      </div>
    </div>
  );
}

function FleetTab({ allowReassign }: { allowReassign: boolean }) {
  return (
    <div className='space-y-5'>
      <FleetLocationPanel allowReassign={allowReassign} />
      <FleetPulseSection/>
    </div>
  );
}


