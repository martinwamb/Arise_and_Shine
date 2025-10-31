import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from 'recharts';
import FleetLocationPanel from '../components/FleetLocationPanel';
import AdminTrucksPanel from '../components/AdminTrucksPanel';
import AdminDriversPanel from '../components/AdminDriversPanel';
import AdminUsersPanel from '../components/AdminUsersPanel';
import AdminStockPanel from '../components/AdminStockPanel';
import AdminCostsPanel from '../components/AdminCostsPanel';
import AdminAuditConsole from '../components/AdminAuditConsole';
import AdminNotificationSettings from '../components/AdminNotificationSettings';

type CostPayload = {
  truckId: string;
  type: string;
  amount: number;
  description: string;
};

type DuplicateCostPrompt = {
  message: string;
  existing: any | null;
  payload: CostPayload;
};

export default function Ops(){
  const role = localStorage.getItem('role') || 'ADMIN';
  const userName = localStorage.getItem('userName') || '';
  const isAdmin = role === 'ADMIN';
  const isOps = role === 'OPS';
  const allowedTabs = isAdmin
    ? ['overview','orders','trucks','drivers','users','stock','costs','finance','audit','fleet','ai']
    : isOps
    ? ['orders','stock','costs','fleet']
    : ['fleet'];
  const [tab,setTab]=useState<string>(allowedTabs[0]);
  const title = isAdmin ? (userName ? `${userName.split(' ')[0]}'s admin workspace` : 'Admin workspace') : 'Operations workspace';
  return (
    <main className='mx-auto max-w-7xl px-4 py-16'>
      <div className='mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
        <h1 className='text-2xl font-bold text-slate-900'>{title}</h1>
        <div className='-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0'>
          {allowedTabs.map((t) => {
            const label =
              t === 'ai'
                ? 'AI'
                : t === 'fleet'
                ? 'Fleet'
                : t === 'audit'
                ? 'Audit'
                : t.charAt(0).toUpperCase() + t.slice(1);
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm capitalize ${
                  tab === t ? 'bg-slate-900 text-white' : 'bg-white/80 text-slate-700 hover:border-slate-300'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
      {tab==='overview' && isAdmin && <OverviewTab/>}
      {tab==='orders' && (isAdmin || isOps) && <OrdersTab/>}
      {tab==='trucks' && isAdmin && <AdminTrucksPanel />}
      {tab==='drivers' && isAdmin && <AdminDriversPanel />}
      {tab==='users' && isAdmin && <AdminUsersPanel />}
      {tab==='stock' && (isAdmin ? <AdminStockPanel /> : <StockTab />)}
      {tab==='costs' && (isAdmin ? <AdminCostsPanel /> : <CostsTab />)}
      {tab==='finance' && isAdmin && <FinanceTab/>}
      {tab==='audit' && isAdmin && <AdminAuditConsole />}
      {tab==='fleet' && <FleetTab allowReassign={role === 'ADMIN' || role === 'OPS'} />}
      {tab==='ai' && isAdmin && <AITab/>}
    </main>
  );
}

function OverviewTab(){
  const [data,setData]=useState<any|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

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

  if(loading) return <div className='rounded-xl border bg-white p-6 text-sm text-slate-600'>Loading dashboard…</div>;
  if(error) return (
    <div className='rounded-xl border bg-white p-6 text-sm text-rose-600'>
      {error}
      <button onClick={load} className='ml-3 rounded border px-2 py-1 text-xs text-slate-600 hover:border-slate-300'>Retry</button>
    </div>
  );
  if(!data) return null;
  const weeklyMargin = data.weekly?.revenue ? ((data.weekly.profit || 0) / data.weekly.revenue) * 100 : 0;
  const expensesChart = (data.expensesPerTruck || []).map((x:any)=>({ label: x.plate || x.truckId, amount: Number(x.amount||0) }));
  return (
    <div className='space-y-6'>
      <div className='grid grid-cols-1 gap-4 md:grid-cols-4'>
        <OverviewCard title='Stock (tonnes)' value={`${Number(data.stock?.tonnes||0).toLocaleString()} t`} detail={data.stock?.yard_name || 'Main yard'} />
        <OverviewCard title='Pending orders' value={Number(data.pendingOrders||0)} detail={`Active loads ${Number(data.activeAssignments||0)}`} />
        <OverviewCard title='Today revenue' value={`KES ${Number(data.daily?.revenue||0).toLocaleString()}`} detail={`Profit KES ${Number(data.daily?.profit||0).toLocaleString()}`} />
        <OverviewCard title='7d gross profit' value={`KES ${Number(data.weekly?.profit||0).toLocaleString()}`} detail={`Margin ${weeklyMargin.toFixed(1)}%`} />
      </div>
      <div className='grid gap-6 lg:grid-cols-2'>
        <div className='rounded-xl border bg-white p-5'>
          <div className='flex items-center justify-between text-sm'>
            <h3 className='font-semibold text-slate-900'>Expense per truck (today)</h3>
            <button onClick={()=>load()} className='rounded border px-2 py-1 text-xs text-slate-600 hover:border-slate-300'>Refresh</button>
          </div>
          <div className='mt-3 h-64'>
            {expensesChart.length ? (
              <ResponsiveContainer width='100%' height='100%'>
                <BarChart data={expensesChart}>
                  <CartesianGrid strokeDasharray='3 3' />
                  <XAxis dataKey='label' />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey='amount' fill='#0f766e' />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className='flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-500'>
                No expenses captured today.
              </div>
            )}
          </div>
        </div>
        <div className='rounded-xl border bg-white p-5'>
          <h3 className='text-sm font-semibold text-slate-900'>Top drivers (last 7 days)</h3>
          <ul className='mt-3 space-y-3 text-sm'>
            {(data.topDrivers||[]).slice(0,5).map((d:any, idx:number)=>(
              <li key={d.driverId || idx} className='flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2'>
                <div>
                  <div className='font-medium text-slate-900'>{idx+1}. {d.name || d.driverId}</div>
                  <div className='text-xs text-slate-500'>{Number(d.tonnes||0).toLocaleString()} t delivered</div>
                </div>
                <div className='text-sm font-semibold text-teal-700'>KES {Number(d.revenue||0).toLocaleString()}</div>
              </li>
            ))}
            {(!data.topDrivers || data.topDrivers.length===0) && (
              <li className='rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500'>
                Assign trips to drivers to populate the leaderboard.
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function OverviewCard({ title, value, detail }:{ title:string, value:React.ReactNode, detail?:React.ReactNode }){
  return (
    <div className='rounded-xl border bg-white p-4 shadow-sm'>
      <div className='text-xs font-semibold uppercase tracking-wide text-slate-500'>{title}</div>
      <div className='mt-2 text-xl font-bold text-slate-900'>{value}</div>
      {detail && <div className='mt-1 text-xs text-slate-500'>{detail}</div>}
    </div>
  );
}

function OrdersTab(){
  const [orders,setOrders]=useState<any[]>([]);
  const [drivers,setDrivers]=useState<any[]>([]);
  const [trucks,setTrucks]=useState<any[]>([]);
  const [filter,setFilter]=useState<'all'|'assigned'|'pending'>('all');
  const [createOpen,setCreateOpen]=useState(false);
  const [newOrder,setNewOrder]=useState({ name:'', email:'', phone:'', site:'', sandType:'coarse', trucks:1, distanceKm:'', dateNeeded:'', customerId:'' });
  const [perTruckOverride,setPerTruckOverride]=useState('');
  const [quote,setQuote]=useState<{ perTruck:number; total:number; distanceKm:number }|null>(null);
  const [quoteError,setQuoteError]=useState<string|null>(null);
  const [createStatus,setCreateStatus]=useState<{ kind:'idle'|'error'|'success'; message:string }>({ kind:'idle', message:'' });

  async function load(){
    const assigned = filter==='all'? undefined : (filter==='assigned'? 'true':'false');
    const r = await api.get('/api/admin/orders',{ params:{ assigned } }); setOrders(r.data);
    const d = await api.get('/api/admin/drivers'); setDrivers(d.data);
    const t = await api.get('/api/admin/trucks'); setTrucks(t.data);
  }
  useEffect(()=>{ load(); },[filter]);
  useEffect(()=>{
    if(!newOrder.site.trim()){
      setQuote(null);
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
    try{
      await api.post('/api/admin/orders', {
        ...newOrder,
        trucks: newOrder.trucks,
        distanceKm: newOrder.distanceKm ? Number(newOrder.distanceKm) : undefined,
        perTruckOverride: perTruckOverride ? Number(perTruckOverride) : undefined,
      });
      setCreateStatus({ kind:'success', message:'Order recorded. Awaiting payment confirmation.' });
      setCreateOpen(false);
      setNewOrder({ name:'', email:'', phone:'', site:'', sandType:'coarse', trucks:1, distanceKm:'', dateNeeded:'', customerId:'' });
      setPerTruckOverride('');
      setQuote(null);
      await load();
    }catch(err:any){
      setCreateStatus({ kind:'error', message: err?.response?.data?.error || 'Failed to create order.' });
    }
  }
  async function assign(orderId:string, truckId:string, driverId:string, tonnes?:number){ await api.post(`/api/admin/orders/${orderId}/assignments`, { truckId, driverId, tonnes }); await load(); }

  return (<div className='grid grid-cols-1 gap-6 lg:grid-cols-3'>
    <div className='lg:col-span-2 overflow-hidden rounded-xl border bg-white'>
      <table className='w-full text-sm'><thead className='bg-amber-50 text-slate-600'><tr><th className='px-3 py-2'>When</th><th className='px-3 py-2'>Customer</th><th className='px-3 py-2'>Site</th><th className='px-3 py-2'>Sand</th><th className='px-3 py-2'>Trucks</th><th className='px-3 py-2'>Total</th><th className='px-3 py-2'>Payment</th><th className='px-3 py-2'>Status</th><th className='px-3 py-2'>Assignments</th><th className='px-3 py-2'>Add</th></tr></thead><tbody>
        {orders.map(o=> <tr key={o.id} className='border-t'>
          <td className='px-3 py-2'>{new Date(o.created_at).toLocaleString()}</td>
          <td className='px-3 py-2'>{o.name||o.email}</td>
          <td className='px-3 py-2'>{o.site}</td>
          <td className='px-3 py-2 uppercase'>{o.sand_type||'-'}</td>
          <td className='px-3 py-2'>{o.trucks}</td>
          <td className='px-3 py-2'>KES {o.total?.toLocaleString()}</td>
          <td className='px-3 py-2'>{o.payment_status || 'PENDING'}</td>
          <td className='px-3 py-2'>{o.status}</td>
          <td className='px-3 py-2'>
            <OrderAssignments orderId={o.id}/>
          </td>
          <td className='px-3 py-2'>
            <AssignInline trucks={trucks} drivers={drivers} onSave={(tid,did,tn)=>assign(o.id,tid,did,tn)} />
          </td>
        </tr>)}
      </tbody></table>
    </div>
    <div className='space-y-4'>
      <div className='rounded-xl border bg-white p-4'>
        <div className='mb-2 flex items-center justify-between'><h2 className='text-sm font-semibold text-slate-900'>New Order</h2><button onClick={()=>{ setCreateOpen(!createOpen); setCreateStatus({ kind:'idle', message:'' }); }} className='rounded border px-2 text-xs font-semibold'>{createOpen?'−':'+'}</button></div>
        {createOpen && (
          <div className='space-y-3 text-sm'>
            {[
              { key:'name', label:'Customer name' },
              { key:'email', label:'Email' },
              { key:'phone', label:'Phone' },
              { key:'site', label:'Site location' },
            ].map(({ key, label })=> (
              <label key={key} className='block'>
                {label}
                <input className='mt-1 w-full rounded border p-1' value={(newOrder as any)[key]} onChange={e=>setNewOrder({...newOrder,[key]:e.target.value})}/>
              </label>
            ))}
            <label className='block'>Sand type
              <select className='mt-1 w-full rounded border p-1' value={newOrder.sandType} onChange={e=>setNewOrder({...newOrder, sandType:e.target.value})}>
                <option value='coarse'>Coarse</option>
                <option value='smooth'>Smooth</option>
              </select>
            </label>
            <label className='block'>Trucks
              <input type='number' min={1} className='mt-1 w-full rounded border p-1' value={newOrder.trucks} onChange={e=>setNewOrder({...newOrder, trucks:parseInt(e.target.value||'1')})}/>
            </label>
            <label className='block'>Distance estimate (km)
              <input className='mt-1 w-full rounded border p-1' value={newOrder.distanceKm} onChange={e=>setNewOrder({...newOrder, distanceKm:e.target.value})} placeholder='Optional'/>
            </label>
            <label className='block'>Date needed
              <input type='date' className='mt-1 w-full rounded border p-1' value={newOrder.dateNeeded} onChange={e=>setNewOrder({...newOrder, dateNeeded:e.target.value})}/>
            </label>
            <label className='block'>Customer ID (optional)
              <input className='mt-1 w-full rounded border p-1' value={newOrder.customerId} onChange={e=>setNewOrder({...newOrder, customerId:e.target.value})}/>
            </label>
            <label className='block'>Per truck override (KES, optional)
              <input className='mt-1 w-full rounded border p-1' value={perTruckOverride} onChange={e=>setPerTruckOverride(e.target.value)} placeholder='Default uses distance-based pricing'/>
            </label>
            {quote && (
              <div className='rounded-2xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900'>
                Quote: <strong>KES {quote.perTruck.toLocaleString()}</strong> per truck (total KES {quote.total.toLocaleString()} @ ~{Math.round(quote.distanceKm)} km)
              </div>
            )}
            {quoteError && <div className='rounded-2xl bg-rose-50 px-3 py-2 text-xs text-rose-600'>{quoteError}</div>}
            {createStatus.kind !== 'idle' && (
              <div className={`rounded-2xl px-3 py-2 text-xs ${createStatus.kind==='success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                {createStatus.message}
              </div>
            )}
            <button onClick={create} className='rounded bg-slate-900 px-3 py-1.5 text-white'>Create</button>
          </div>
        )}
      </div>
      <div className='rounded-xl border bg-white p-4'>
        <div className='mb-2 flex items-center justify-between'><h2 className='text-sm font-semibold text-slate-900'>Filter</h2>
          <select className='rounded border px-2 text-sm' value={filter} onChange={e=>setFilter(e.target.value as any)}><option value='all'>All</option><option value='pending'>Pending</option><option value='assigned'>Assigned</option></select>
        </div>
      </div>
    </div>
  </div>);
}

function OrderAssignments({ orderId }:{ orderId:string }){
  const [rows,setRows]=useState<any[]>([]);
  useEffect(()=>{ (async()=>{ const r=await api.get(`/api/admin/orders/${orderId}/assignments`); setRows(r.data); })(); },[orderId]);
  return (<div className='space-y-1'>
    {rows.map(r=> <div key={r.id} className='rounded border px-2 py-1 text-xs'>#{r.id.slice(-6)} • Truck {r.truck_id} • {r.tonnes}t • {r.status}</div>)}
    {rows.length===0 && <div className='text-xs text-slate-500'>No assignments yet</div>}
  </div>);
}

function AssignInline({ trucks, drivers, onSave }:{ trucks:any[], drivers:any[], onSave:(tid:string,did:string,tn?:number)=>void }){
  const [tid,setTid]=useState(''); const [did,setDid]=useState(''); const [tn,setTn]=useState('');
  return (
    <div className='flex items-center gap-1 text-xs'>
      <select className='rounded border px-1' value={tid} onChange={e=>setTid(e.target.value)}><option value=''>Truck…</option>{trucks.map(t=> <option key={t.id} value={t.id}>{t.id} • {t.plate}</option>)}</select>
      <select className='rounded border px-1' value={did} onChange={e=>setDid(e.target.value)}><option value=''>Driver…</option>{drivers.map(d=> <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      <input placeholder='t' className='w-14 rounded border px-1' value={tn} onChange={e=>setTn(e.target.value)} />
      <button onClick={()=> tid && onSave(tid,did||'', tn?parseFloat(tn):undefined)} className='rounded bg-slate-900 px-2 py-1 text-white'>Add</button>
    </div>
  );
}

function StockTab(){
  const [stock,setStock]=useState<any>({yard_name:'Main Yard', tonnes:0, trucks_coarse:0, trucks_smooth:0, unit_tonnes:20});
  const [tx,setTx]=useState<any[]>([]);
  const [availableTrucks,setAvailableTrucks]=useState<any[]>([]);
  const [truckId,setTruckId]=useState('');
  const [category,setCategory]=useState<'coarse'|'smooth'>('coarse');
  const [trucksIn,setTrucksIn]=useState('');
  const [cpt,setCpt]=useState('');
  const [loading,setLoading]=useState(true);
  const [status,setStatus]=useState<{ kind:'idle'|'success'|'error'; message:string }>({ kind:'idle', message:'' });

  async function load(){
    try{
      setLoading(true);
      const [stockRes, txRes, trucksRes] = await Promise.all([
        api.get('/api/admin/stock'),
        api.get('/api/admin/stock/tx'),
        api.get('/api/admin/trucks'),
      ]);
      setStock(stockRes.data);
      setTx(Array.isArray(txRes.data)?txRes.data:[]);
      setAvailableTrucks(Array.isArray(trucksRes.data)?trucksRes.data:[]);
    }catch(err:any){
      setStatus({ kind:'error', message: err?.response?.data?.error || err?.message || 'Failed to load stock data.' });
    }finally{
      setLoading(false);
    }
  }
  useEffect(()=>{ load(); },[]);

  async function receipt(){
    const trucksValue = parseFloat(trucksIn || '0');
    const costValue = parseFloat(cpt || '0');
    if(!truckId){
      setStatus({ kind:'error', message:'Select the truck receiving stock.' });
      return;
    }
    if(!Number.isFinite(trucksValue) || trucksValue <= 0){
      setStatus({ kind:'error', message:'Enter the number of trucks received (must be greater than zero).' });
      return;
    }
    if(!Number.isFinite(costValue) || costValue <= 0){
      setStatus({ kind:'error', message:'Provide cost per tonne (KES) for this receipt.' });
      return;
    }
    try{
      await api.post('/api/admin/stock/receipt',{ truckId, trucks: trucksValue, category, costPerTonne: costValue });
      setStatus({ kind:'success', message:'Stock receipt recorded.' });
      setTruckId(''); setTrucksIn(''); setCpt('');
      await load();
    }catch(err:any){
      setStatus({ kind:'error', message: err?.response?.data?.error || err?.message || 'Failed to record receipt.' });
    }
  }

  return (<div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
    <div className='rounded-xl border bg-white p-4'>
      <h2 className='text-sm font-semibold text-slate-900'>Current stock</h2>
      <div className='mt-3 grid gap-3 text-xs md:grid-cols-3'>
        <StockBadge title='Coarse trucks' value={stock.trucks_coarse} detail={`${(stock.trucks_coarse * (stock.unit_tonnes||20)).toLocaleString()} t`} />
        <StockBadge title='Smooth trucks' value={stock.trucks_smooth} detail={`${(stock.trucks_smooth * (stock.unit_tonnes||20)).toLocaleString()} t`} />
        <StockBadge title='Total trucks' value={(stock.trucks_total ?? (stock.trucks_coarse + stock.trucks_smooth))} detail={`${Number(stock.tonnes||0).toLocaleString()} t`} />
      </div>
      <div className='mt-4 text-sm font-semibold text-slate-900'>Add receipt (trucks)</div>
      <div className='mt-2 flex flex-wrap items-center gap-2 text-sm'>
        <select className='rounded border px-2 py-1' value={category} onChange={e=>setCategory(e.target.value as 'coarse'|'smooth')}>
          <option value='coarse'>Coarse</option>
          <option value='smooth'>Smooth</option>
        </select>
        <input type='number' min={0.01} step='0.01' placeholder='Trucks' className='w-24 rounded border px-2 py-1' value={trucksIn} onChange={e=>setTrucksIn(e.target.value)} />
        <select className='w-40 rounded border px-2 py-1' value={truckId} onChange={e=>setTruckId(e.target.value)}>
          <option value=''>Select truck...</option>
          {availableTrucks.map((truck:any)=>(
            <option key={truck.id} value={truck.id}>{truck.plate || truck.id}</option>
          ))}
        </select>
        <input type='number' min={0.01} step='0.01' placeholder='KES/t' className='w-32 rounded border px-2 py-1' value={cpt} onChange={e=>setCpt(e.target.value)} />
        <button onClick={receipt} className='rounded bg-slate-900 px-3 py-1.5 text-white'>Add</button>
      </div>
      {status.kind !== 'idle' && (
        <div className={`mt-3 rounded-xl px-3 py-2 text-xs ${status.kind==='success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
          {status.message}
        </div>
      )}
      {loading && <div className='mt-3 text-xs text-slate-500'>Refreshing stock data...</div>}
    </div>
    <div className='rounded-xl border bg-white p-4'>
      <h2 className='text-sm font-semibold text-slate-900'>Recent stock transactions</h2>
      <div className='mt-2 max-h-80 overflow-auto text-xs'>
        {tx.map(x=> <div key={x.id} className='border-b py-1'>{new Date(x.created_at).toLocaleString()} • {x.kind} {Number(x.trucks||0).toFixed(2)} trucks ({x.category||'n/a'}) • {x.reason}</div>)}
      </div>
    </div>
  </div>);
}

function StockBadge({ title, value, detail }:{ title:string; value:number; detail:string }){
  return (
    <div className='rounded-2xl border border-amber-50 bg-amber-50/60 p-3'>
      <div className='text-xs uppercase tracking-wide text-slate-500'>{title}</div>
      <div className='mt-1 text-xl font-bold text-slate-900'>{value.toLocaleString()}</div>
      <div className='text-[11px] text-slate-500'>{detail}</div>
    </div>
  );
}

function CostsTab(){
  const [rows,setRows]=useState<any[]>([]);
  const [trucks,setTrucks]=useState<any[]>([]);
  const [form,setForm]=useState<any>({ type:'FUEL', amount:'', truckId:'', description:'' });
  const [status,setStatus]=useState<{ kind:'idle'|'success'|'error'; message:string }>({ kind:'idle', message:'' });
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicateCostPrompt | null>(null);
  const [confirmingDuplicate, setConfirmingDuplicate] = useState(false);

  const resetForm = () => setForm({ type:'FUEL', amount:'', truckId:'', description:'' });

  async function load(){
    try{
      const [costsRes, trucksRes] = await Promise.all([api.get('/api/admin/costs'), api.get('/api/admin/trucks')]);
      setRows(Array.isArray(costsRes.data)?costsRes.data:[]);
      setTrucks(Array.isArray(trucksRes.data)?trucksRes.data:[]);
      setDuplicatePrompt(null);
    }catch(err:any){
      setStatus({ kind:'error', message: err?.response?.data?.error || err?.message || 'Failed to load costs data.' });
    }
  }
  useEffect(()=>{ load(); },[]);

  async function add(){
    const amountValue = parseFloat(form.amount || '0');
    if(!form.type){
      setStatus({ kind:'error', message:'Select a cost type.' });
      return;
    }
    if(!form.truckId){
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
        <label className='block'>Type<select className='mt-1 w-full rounded border p-1' value={form.type} onChange={e=>setForm({...form, type:e.target.value})}><option>FUEL</option><option>SALARY</option><option>REPAIR</option><option>MAINTENANCE</option><option>LOADING</option><option>OFFLOADING</option><option>STOCK_PURCHASE</option><option>OTHER</option></select></label>
        <label className='block'>Truck
          <select className='mt-1 w-full rounded border p-1' value={form.truckId} onChange={e=>setForm({...form, truckId:e.target.value})}>
            <option value=''>Select truck...</option>
            {trucks.map((truck:any)=>(
              <option key={truck.id} value={truck.id}>{truck.plate || truck.id}</option>
            ))}
          </select>
        </label>
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

function FinanceTab(){
  const [from,setFrom]=useState(''); const [to,setTo]=useState('');
  const [summary,setSummary]=useState<any>(null);
  const [series,setSeries]=useState<any[]>([]);
  const [perTruck,setPerTruck]=useState<any[]>([]);

  async function load(){
    const s=await api.get('/api/admin/finance/summary',{ params:{ from:from||undefined, to:to||undefined } }); setSummary(s.data);
    const ts=await api.get('/api/admin/finance/timeseries',{ params:{ from:from||undefined, to:to||undefined } }); setSeries(ts.data);
    const tb=await api.get('/api/admin/finance/truck-breakdown',{ params:{ from:from||undefined, to:to||undefined } }); setPerTruck(tb.data);
  }
  useEffect(()=>{ load(); },[]);

  return (<div className='space-y-6'>
    <div className='rounded-xl border bg-white p-4'>
      <div className='mb-3 flex gap-2 text-sm'><input type='date' className='rounded border px-2' value={from} onChange={e=>setFrom(e.target.value)} /><input type='date' className='rounded border px-2' value={to} onChange={e=>setTo(e.target.value)} /><button onClick={load} className='rounded bg-slate-900 px-3 py-1.5 text-white'>Refresh</button></div>
      {summary && (<div className='grid grid-cols-1 gap-4 md:grid-cols-4'>
        <Card title='Revenue (KES)' value={summary.revenue?.toLocaleString()} />
        <Card title='Orders' value={summary.orders} />
        <Card title='Costs (KES)' value={Number(summary.costTotal).toLocaleString()} />
        <Card title='Gross Profit (KES)' value={Number(summary.gross).toLocaleString()} />
      </div>)}
    </div>

    <div className='grid grid-cols-1 gap-6 lg:grid-cols-2'>
      <div className='rounded-xl border bg-white p-4'>
        <h3 className='text-sm font-semibold text-slate-900'>Revenue vs Costs (daily)</h3>
        <div className='mt-2 h-72'>
          <ResponsiveContainer width='100%' height='100%'>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray='3 3' />
              <XAxis dataKey='date' />
              <YAxis />
              <Tooltip />
              <Line type='monotone' dataKey='revenue' />
              <Line type='monotone' dataKey='cost' />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className='rounded-xl border bg-white p-4'>
        <h3 className='text-sm font-semibold text-slate-900'>Per-truck Gross Profit</h3>
        <div className='mt-2 h-72'>
          <ResponsiveContainer width='100%' height='100%'>
            <BarChart data={perTruck.map(x=> ({...x, label: x.plate? x.plate : x.truckId }))}>
              <CartesianGrid strokeDasharray='3 3' />
              <XAxis dataKey='label' />
              <YAxis />
              <Tooltip />
              <Bar dataKey='gross' />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>

    <div className='rounded-xl border bg-white p-4'>
      <h3 className='text-sm font-semibold text-slate-900'>Per-truck Breakdown</h3>
      <div className='mt-2 overflow-auto'>
        <table className='w-full text-sm'>
          <thead className='bg-amber-50 text-slate-600'><tr><th className='px-3 py-2'>Truck</th><th className='px-3 py-2'>Loads</th><th className='px-3 py-2'>Revenue</th><th className='px-3 py-2'>Costs</th><th className='px-3 py-2'>Gross</th><th className='px-3 py-2'>Margin</th></tr></thead>
          <tbody>
            {perTruck.map((r:any)=>(
              <tr key={r.truckId} className='border-t'>
                <td className='px-3 py-2'>{r.plate || r.truckId}</td>
                <td className='px-3 py-2'>{r.loads}</td>
                <td className='px-3 py-2'>KES {Number(r.revenue).toLocaleString()}</td>
                <td className='px-3 py-2'>KES {Number(r.cost).toLocaleString()}</td>
                <td className='px-3 py-2'>KES {Number(r.gross).toLocaleString()}</td>
                <td className='px-3 py-2'>{r.margin.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
      <AdminNotificationSettings />
    </div>
  );
}
function Card({title,value}:{title:string,value:any}){ return <div className='rounded-xl border bg-white p-4'><div className='text-xs text-slate-500'>{title}</div><div className='mt-1 text-2xl font-bold'>{value}</div></div>; }

function FleetTab({ allowReassign }: { allowReassign: boolean }) {
  return <FleetLocationPanel allowReassign={allowReassign} />;
}

function AITab(){
    const [insights,setInsights]=useState('');
    const [alerts,setAlerts]=useState<string[]>([]);
    const [loading,setLoading]=useState(true);
    const [error,setError]=useState<string|null>(null);

    const load = useCallback(async ()=>{
      try{
        setLoading(true);
        const r=await api.get('/api/admin/ai/insights');
        setInsights(r.data?.insights || 'No insights yet.');
        setAlerts(Array.isArray(r.data?.alerts)? r.data.alerts : []);
        setError(null);
      } catch(e:any){
        setError(e?.response?.data?.error || e.message);
      } finally{
        setLoading(false);
      }
    },[]);

    useEffect(()=>{ load(); },[load]);

    return (
      <div className='space-y-3 rounded-xl border bg-white p-4'>
        <div className='flex items-center justify-between'>
          <h2 className='text-sm font-semibold text-slate-900'>AI Insights</h2>
          <button onClick={load} className='rounded border px-2 py-1 text-xs text-slate-600 hover:border-slate-300'>Refresh</button>
        </div>
        {loading && <div className='rounded-lg bg-slate-50 p-3 text-xs text-slate-600'>Crunching the latest data…</div>}
        {error && !loading && <div className='rounded-lg bg-rose-50 p-3 text-xs text-rose-600'>AI error: {error}</div>}
        {!loading && !error && (
          <>
            {alerts.length>0 && (
              <div className='rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800'>
                <div className='mb-2 font-semibold uppercase tracking-wide text-xs'>Alerts to review</div>
                <ul className='space-y-1'>
                  {alerts.map((a,idx)=>(
                    <li key={idx} className='flex items-start gap-2'>
                      <span className='mt-1 h-1.5 w-1.5 rounded-full bg-amber-500'></span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <pre className='whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700'>{insights}</pre>
          </>
        )}
      </div>
    );
  }
