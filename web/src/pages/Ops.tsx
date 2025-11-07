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
import AiWorkspaceTab from '../components/AiWorkspaceTab';

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
      {tab==='ai' && isAdmin && <AiWorkspaceTab/>}
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
        <OverviewCard
          title='Stock (trucks)'
          value={`${Number(data.stock?.trucks_total||0).toLocaleString()} trucks`}
          detail={`${data.stock?.yard_name || 'Main yard'} • ${Number(data.stock?.tonnes||0).toLocaleString()} t`}
        />
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
  const role = localStorage.getItem('role') || 'ADMIN';
  const isAdmin = role === 'ADMIN';
  const PAYMENT_STATUS_OPTIONS = ['PENDING','REPORTED','CONFIRMED','DECLINED'];
  const ORDER_STATUS_OPTIONS = ['Awaiting Payment','Awaiting Payment Review','Received','In Transit','Delivered','Lead','Cancelled'];
  const [orders,setOrders]=useState<any[]>([]);
  const [drivers,setDrivers]=useState<any[]>([]);
  const [trucks,setTrucks]=useState<any[]>([]);
  const [filter,setFilter]=useState<'all'|'assigned'|'pending'>('all');
  const [createOpen,setCreateOpen]=useState(false);
  const [newOrder,setNewOrder]=useState({ name:'', email:'', phone:'', site:'', sandType:'', trucks:1, distanceKm:'', dateNeeded:'', customerId:'' });
  const [perTruckOverride,setPerTruckOverride]=useState('');
  const [quote,setQuote]=useState<{ perTruck:number; total:number; distanceKm:number }|null>(null);
  const [quoteError,setQuoteError]=useState<string|null>(null);
  const [createStatus,setCreateStatus]=useState<{ kind:'idle'|'error'|'success'; message:string }>({ kind:'idle', message:'' });
  const [createLoading,setCreateLoading]=useState(false);
  const [editingOrder,setEditingOrder]=useState<any|null>(null);
  const [editMode,setEditMode]=useState<'edit'|'delete'>('edit');
  const [editDraft,setEditDraft]=useState({ paymentStatus:'', status:'', paymentMethod:'', paymentReference:'', paymentMessage:'', dateNeeded:'', cancelReason:'' });
  const [editStatus,setEditStatus]=useState<{ kind:'idle'|'error'|'success'; message:string }>({ kind:'idle', message:'' });
  const [editLoading,setEditLoading]=useState(false);
  const [deleteLoading,setDeleteLoading]=useState(false);
  const [deleteReason,setDeleteReason]=useState('');

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
          status: refreshed.status || 'Awaiting Payment',
          paymentMethod: refreshed.payment_method || '',
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
    if(!newOrder.sandType){
      setCreateStatus({ kind:'error', message:'Select the sand type before creating the order.' });
      return;
    }
    if(createLoading) return;
    try{
      setCreateLoading(true);
      await api.post('/api/admin/orders', {
        ...newOrder,
        trucks: newOrder.trucks,
        distanceKm: newOrder.distanceKm ? Number(newOrder.distanceKm) : undefined,
        perTruckOverride: perTruckOverride ? Number(perTruckOverride) : undefined,
      });
      setCreateStatus({ kind:'success', message:'Order recorded. Awaiting payment confirmation.' });
      setCreateOpen(false);
      setNewOrder({ name:'', email:'', phone:'', site:'', sandType:'', trucks:1, distanceKm:'', dateNeeded:'', customerId:'' });
      setPerTruckOverride('');
      setQuote(null);
      await load();
    }catch(err:any){
      setCreateStatus({ kind:'error', message: err?.response?.data?.error || 'Failed to create order.' });
    }finally{
      setCreateLoading(false);
    }
  }
  function startEdit(order:any, mode:'edit'|'delete'='edit'){
    setEditingOrder(order);
    setEditMode(mode);
    setEditDraft({
      paymentStatus: (order.payment_status || 'PENDING').toString().toUpperCase(),
      status: order.status || 'Awaiting Payment',
      paymentMethod: order.payment_method || '',
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
  }
  async function saveEdit(){
    if(!editingOrder) return;
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
    }catch(err:any){
      setEditStatus({ kind:'error', message: err?.response?.data?.error || 'Failed to delete order.' });
    }finally{
      setDeleteLoading(false);
    }
  }
  async function assign(orderId:string, truckId:string, driverId:string){
    await api.post(`/api/admin/orders/${orderId}/assignments`, { truckId, driverId });
    await load();
  }

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
                {orders.map(o=>(
                  <tr key={o.id} className='border-t align-top'>
                    <td className='px-3 py-2 text-xs text-slate-600'>{new Date(o.created_at).toLocaleString()}</td>
                    <td className='px-3 py-2 text-sm font-semibold text-slate-900'>{o.name||o.email||'Customer'}</td>
                    <td className='px-3 py-2 text-sm text-slate-700'>{o.site}</td>
                    <td className='px-3 py-2 text-xs uppercase text-slate-600'>{o.sand_type||'-'}</td>
                    <td className='px-3 py-2 text-right text-sm font-medium text-slate-900'>{o.trucks}</td>
                    <td className='px-3 py-2 text-right text-sm font-semibold text-slate-900'>KES {Number(o.total||0).toLocaleString()}</td>
                    <td className='px-3 py-2 text-xs font-semibold text-slate-700'>{(o.payment_status||'PENDING').toString().toUpperCase()}</td>
                    <td className='px-3 py-2 text-xs text-slate-700'>
                      <div className='font-semibold'>{o.status}{(o.status||'').toLowerCase()==='cancelled' ? ' (Closed)' : ''}</div>
                      {o.cancel_reason && (
                        <div className='mt-1 text-[11px] text-slate-500'>Reason: {o.cancel_reason}</div>
                      )}
                    </td>
                    <td className='px-3 py-2'>
                      {(o.status||'').toLowerCase()==='cancelled' ? (
                        <div className='rounded border border-dashed border-slate-200 px-2 py-1 text-xs text-slate-500'>Order closed</div>
                      ) : (
                        <AssignInline trucks={trucks} drivers={drivers} onSave={(tid,did)=>assign(o.id,tid,did)} />
                      )}
                    </td>
                    <td className='px-3 py-2'>
                      <div className='flex flex-col gap-2 text-xs'>
                        <button onClick={()=>startEdit(o,'edit')} className='rounded border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50'>Edit</button>
                        {isAdmin && (
                          <button onClick={()=>startEdit(o,'delete')} className='rounded border border-rose-200 px-2 py-1 font-semibold text-rose-600 hover:border-rose-300 hover:bg-rose-50'>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
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
      {orders.map(o=>(
        <div key={o.id} className='rounded-xl border bg-white p-4 text-sm shadow-sm'>
          <div className='flex flex-wrap items-start justify-between gap-2'>
            <div>
              <div className='text-sm font-semibold text-slate-900'>{o.name||o.email||'Customer'}</div>
                  <div className='text-xs text-slate-500'>{new Date(o.created_at).toLocaleString()}</div>
                </div>
                <div className='flex flex-col items-end gap-1'>
                  <span className='rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold uppercase text-amber-800'>{o.sand_type||'-'}</span>
                  <span className='rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600'>KES {Number(o.total||0).toLocaleString()}</span>
                </div>
              </div>
              <div className='mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-600'>
                <span className='font-medium text-slate-700'>Site</span>
                <span>{o.site}</span>
                <span className='font-medium text-slate-700'>Trucks</span>
                <span>{o.trucks}</span>
            <span className='font-medium text-slate-700'>Payment</span>
            <span>{(o.payment_status||'PENDING').toString().toUpperCase()}</span>
            <span className='font-medium text-slate-700'>Status</span>
            <span>
              {o.status}{(o.status||'').toLowerCase()==='cancelled' ? ' (Closed)' : ''}
              {o.cancel_reason && <span className='mt-1 block text-[11px] text-slate-500'>Reason: {o.cancel_reason}</span>}
            </span>
          </div>
          <div className='mt-3 rounded border border-slate-200 p-2 text-xs'>
            <div className='mb-1 font-semibold text-slate-700'>Dispatch</div>
            {(o.status||'').toLowerCase()==='cancelled' ? (
              <div className='rounded border border-dashed border-slate-200 px-2 py-1 text-slate-500'>Order closed</div>
            ) : (
              <AssignInline trucks={trucks} drivers={drivers} onSave={(tid,did)=>assign(o.id,tid,did)} />
            )}
          </div>
          <div className='mt-3 flex flex-wrap gap-2 text-xs'>
            <button onClick={()=>startEdit(o,'edit')} className='flex-1 rounded border border-slate-200 px-3 py-1 font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50'>Edit</button>
            {isAdmin && (
              <button onClick={()=>startEdit(o,'delete')} className='flex-1 rounded border border-rose-200 px-3 py-1 font-semibold text-rose-600 hover:border-rose-300 hover:bg-rose-50'>Delete</button>
            )}
              </div>
            </div>
          ))}
          {orders.length===0 && (
            <div className='rounded-xl border border-dashed bg-white p-6 text-center text-sm text-slate-500'>
              No orders yet.
            </div>
          )}
        </div>
      </div>
      <div className='space-y-4'>
        {editingOrder && (
          <div className='rounded-xl border bg-white p-4'>
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
              <label className='block text-xs font-semibold uppercase tracking-wide text-slate-600'>Payment status
                <select className='mt-1 w-full rounded border px-2 py-1 text-sm' value={editDraft.paymentStatus} onChange={e=>setEditDraft({...editDraft, paymentStatus:e.target.value.toUpperCase()})}>
                  {PAYMENT_STATUS_OPTIONS.map(opt=> <option key={opt} value={opt}>{opt}</option>)}
                  {!PAYMENT_STATUS_OPTIONS.includes(editDraft.paymentStatus) && <option value={editDraft.paymentStatus}>{editDraft.paymentStatus}</option>}
                </select>
              </label>
              <label className='block text-xs font-semibold uppercase tracking-wide text-slate-600'>Order status
                <select className='mt-1 w-full rounded border px-2 py-1 text-sm' value={editDraft.status} onChange={e=>setEditDraft({...editDraft, status:e.target.value})}>
                  {ORDER_STATUS_OPTIONS.map(opt=> <option key={opt} value={opt}>{opt}</option>)}
                  {!ORDER_STATUS_OPTIONS.includes(editDraft.status) && <option value={editDraft.status}>{editDraft.status}</option>}
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
                <input className='mt-1 w-full rounded border px-2 py-1 text-sm' value={editDraft.paymentMethod} onChange={e=>setEditDraft({...editDraft, paymentMethod:e.target.value})}/>
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
              <div className='flex flex-wrap gap-2 pt-2'>
                <button onClick={saveEdit} disabled={editLoading} className='rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60'>{editLoading ? 'Saving…' : 'Save changes'}</button>
                <button onClick={cancelEdit} className='rounded border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300'>Cancel</button>
              </div>
            </div>
            {isAdmin && (
              <div className='mt-5 border-t pt-4'>
                <h3 className='text-xs font-semibold uppercase tracking-wide text-rose-600'>Delete order</h3>
                <p className='mt-2 text-xs text-slate-500'>Removing an order cancels any pending assignments. Provide a short note so the team understands why it was removed.</p>
                <textarea className='mt-2 w-full rounded border px-2 py-1 text-sm' rows={3} placeholder='Reason for deleting this order' value={deleteReason} onChange={e=>setDeleteReason(e.target.value)} />
                <div className='mt-3 flex flex-wrap gap-2'>
                  <button onClick={deleteOrder} disabled={deleteLoading || deleteReason.trim().length < 5} className='rounded bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50'>{deleteLoading ? 'Deleting…' : 'Delete order'}</button>
                  <button onClick={()=>{ setDeleteReason(''); setEditMode('edit'); }} className='rounded border px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-300'>Clear reason</button>
                </div>
              </div>
            )}
          </div>
        )}
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
                  <option value=''>Select sand type…</option>
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

function AssignInline({ trucks, drivers, onSave }:{ trucks:any[], drivers:any[], onSave:(tid:string,did:string)=>void }){
  const [tid,setTid]=useState('');
  const [did,setDid]=useState('');
  return (
    <div className='flex flex-wrap items-center gap-2 text-xs'>
      <select className='w-full rounded border px-2 py-1 sm:w-auto' value={tid} onChange={e=>setTid(e.target.value)}>
        <option value=''>Truck…</option>
        {trucks.map(t=> <option key={t.id} value={t.id}>{t.id} • {t.plate}</option>)}
      </select>
      <select className='w-full rounded border px-2 py-1 sm:w-auto' value={did} onChange={e=>setDid(e.target.value)}>
        <option value=''>Driver…</option>
        {drivers.map(d=> <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <button
        onClick={()=> tid && onSave(tid,did||'')}
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


