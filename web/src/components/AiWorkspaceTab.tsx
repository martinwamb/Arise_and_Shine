import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type AuditFlag = { id:string; entityType:string; entityId:string; message:string; severity:string; createdAt:string; context?:any };
type TelemetryAlert = { id:string; truckId:string; plate?:string|null; alertType:string; severity:string; summary:string; createdAt:string };
type SpeedStat = { truckId:string; plate?:string|null; maxSpeed:number|null; lastCapturedAt:string|null };

export default function AiWorkspaceTab(){
  const [insights,setInsights]=useState('');
  const [alerts,setAlerts]=useState<string[]>([]);
  const [telemetryAlerts,setTelemetryAlerts]=useState<TelemetryAlert[]>([]);
  const [telemetryStats,setTelemetryStats]=useState<SpeedStat[]>([]);
  const [auditFlags,setAuditFlags]=useState<AuditFlag[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

  const parsedInsights = useMemo(()=>{
    if(!insights) return { intro:[] as string[], sections:[] as { title:string; items:string[] }[] };
    const lines = insights.split(/\r?\n/);
    const clean = (value:string)=>value.replace(/\*\*(.+?)\*\*/g,'$1').trim();
    const intro:string[]=[];
    const sections:{ title:string; items:string[] }[]=[];
    let current:{ title:string; items:string[] }|null=null;
    for(const rawLine of lines){
      const line = rawLine.trim();
      if(!line) continue;
      const headingMatch = line.match(/^[*-]\s*\*\*(.+?)\*\*:?$/i);
      if(headingMatch){
        const title = clean(headingMatch[1]).replace(/:$/, '');
        current={ title, items:[] };
        sections.push(current);
        continue;
      }
      const bulletMatch = line.match(/^[*-]\s*(.+)$/);
      if(current){
        if(bulletMatch){
          current.items.push(clean(bulletMatch[1]));
        }else if(current.items.length){
          const lastIdx=current.items.length-1;
          current.items[lastIdx]=clean(`${current.items[lastIdx]} ${line}`);
        }else{
          current.items.push(clean(line));
        }
      }else{
        if(bulletMatch){
          intro.push(clean(bulletMatch[1]));
        }else{
          intro.push(clean(line));
        }
      }
    }
    return {
      intro:intro.filter(Boolean),
      sections:sections.filter(section=>section.title || section.items.length),
    };
  },[insights]);

  const speedLeaders = useMemo(()=>{
    return telemetryStats
      .filter((item)=> Number.isFinite(Number(item.maxSpeed)))
      .sort((a,b)=> Number(b.maxSpeed||0) - Number(a.maxSpeed||0))
      .slice(0,4);
  },[telemetryStats]);

  const load = useCallback(async ()=>{
    try{
      setLoading(true);
      const r=await api.get('/api/admin/ai/insights');
      setInsights(r.data?.insights || 'No insights yet.');
      setAlerts(Array.isArray(r.data?.alerts)? r.data.alerts : []);
      setTelemetryAlerts(Array.isArray(r.data?.telemetryAlerts)? r.data.telemetryAlerts : []);
      setTelemetryStats(Array.isArray(r.data?.telemetryHistoryStats)? r.data.telemetryHistoryStats : []);
      const flags = Array.isArray(r.data?.auditFlags)
        ? r.data.auditFlags.map((flag:any)=>({
            id: flag.id || String(flag.id || ''),
            entityType: flag.entityType || flag.entity_type || 'record',
            entityId: flag.entityId || flag.entity_id || '',
            message: flag.message || 'Potential discrepancy',
            severity: flag.severity || 'warning',
            createdAt: flag.createdAt || flag.created_at || new Date().toISOString(),
            context: flag.context,
          }))
        : [];
      setAuditFlags(flags);
      setError(null);
    } catch(e:any){
      setError(e?.response?.data?.error || e.message);
    } finally{
      setLoading(false);
    }
  },[]);

  useEffect(()=>{ load(); },[load]);

  if(loading){
    return <div className='rounded-2xl border border-slate-200 bg-white/90 p-6 text-sm text-slate-600 shadow-sm'>Crunching the latest telemetry…</div>;
  }
  if(error){
    return (
      <div className='rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-600 shadow-sm'>
        {error}
        <button onClick={load} className='ml-3 rounded border border-rose-200 bg-white px-2 py-1 text-xs text-rose-600 hover:border-rose-300'>Retry</button>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <section className='rounded-3xl border border-slate-100 bg-white/90 p-6 shadow-sm'>
        <div className='mb-4 flex items-center justify-between'>
          <div>
            <h3 className='text-base font-semibold text-slate-900'>AI Insights</h3>
            <p className='text-xs text-slate-500'>Summaries generated from live telemetry, orders, and costs.</p>
          </div>
          <button onClick={load} className='rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 hover:border-slate-300'>Refresh</button>
        </div>
        {parsedInsights.intro.length > 0 ? (
          <ul className='space-y-2 text-sm text-slate-700'>
            {parsedInsights.intro.map((item,idx)=>(
              <li key={idx} className='flex items-start gap-2'>
                <span className='mt-2 h-1.5 w-1.5 rounded-full bg-slate-400'></span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-sm text-slate-500'>No narrative insight yet.</p>
        )}
        {parsedInsights.sections.length > 0 && (
          <div className='mt-4 grid gap-4 sm:grid-cols-2'>
            {parsedInsights.sections.map(section=>(
              <div key={section.title} className='rounded-2xl border border-slate-100 bg-slate-50/70 p-4 text-sm text-slate-700'>
                <h4 className='text-xs font-semibold uppercase tracking-wide text-slate-500'>{section.title}</h4>
                <ul className='mt-2 space-y-1.5'>
                  {section.items.map((item,idx)=>(
                    <li key={idx} className='flex items-start gap-2'>
                      <span className='mt-2 h-1 w-1 rounded-full bg-slate-400'></span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className='grid gap-4 lg:grid-cols-2'>
        <div className='rounded-3xl border border-amber-100 bg-gradient-to-br from-amber-50 via-white to-white p-5 shadow-sm'>
          <h4 className='text-sm font-semibold text-amber-900'>Operational alerts</h4>
          <p className='text-xs text-amber-700'>Flagged by the AI from telemetry, stock, and orders.</p>
          <ul className='mt-3 space-y-2 text-sm text-amber-900'>
            {alerts.length ? alerts.map((text,idx)=>(
              <li key={idx} className='rounded-2xl bg-white/80 px-3 py-2 shadow-inner'>{text}</li>
            )) : <li className='rounded-2xl bg-white/60 px-3 py-2 text-xs text-amber-700'>No open alerts.</li>}
          </ul>
        </div>

        <div className='space-y-4 rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm'>
          <div>
            <h4 className='text-sm font-semibold text-slate-900'>Speed & idle highlights</h4>
            {speedLeaders.length ? (
              <ul className='mt-2 space-y-2 text-sm text-slate-700'>
                {speedLeaders.map(item=>(
                  <li key={item.truckId} className='rounded-2xl border border-slate-100 px-3 py-2'>
                    <div className='flex items-center justify-between'>
                      <span className='font-semibold'>{item.plate || item.truckId}</span>
                      <span className='text-slate-500'>{Number(item.maxSpeed||0).toFixed(1)} km/h</span>
                    </div>
                    <p className='text-[11px] text-slate-400'>Last seen {item.lastCapturedAt ? new Date(item.lastCapturedAt).toLocaleString() : 'recently'}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='text-xs text-slate-500'>No recent speed readings.</p>
            )}
          </div>
          <div>
            <h4 className='text-sm font-semibold text-slate-900'>Telemetry alerts</h4>
            <ul className='mt-2 space-y-2 text-sm text-slate-700'>
              {telemetryAlerts.slice(0,5).map(alert=>(
                <li key={alert.id} className='rounded-2xl border border-slate-100 px-3 py-2'>
                  <div className='flex items-center justify-between text-xs uppercase tracking-wide text-slate-400'>
                    <span>{alert.alertType}</span>
                    <span>{new Date(alert.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className='mt-1 text-sm font-semibold text-slate-900'>{alert.plate || alert.truckId}</p>
                  <p className='text-sm text-slate-600'>{alert.summary}</p>
                </li>
              ))}
              {!telemetryAlerts.length && <li className='rounded-2xl border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500'>No telemetry alerts recorded.</li>}
            </ul>
          </div>
        </div>
      </section>

      {auditFlags.length > 0 && (
        <section className='rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm'>
          <h4 className='text-sm font-semibold text-slate-900'>Audit reminders</h4>
          <ul className='mt-3 space-y-2 text-sm text-slate-700'>
            {auditFlags.slice(0,5).map(flag=>(
              <li key={flag.id} className='rounded-2xl border border-slate-100 px-3 py-2'>
                <p className='font-semibold text-slate-900'>{flag.message}</p>
                <p className='text-[11px] text-slate-400'>Ref {flag.entityType} · {new Date(flag.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
