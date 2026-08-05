
import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
export default function Login(){
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState<string|null>(null);
  const [submitting,setSubmitting]=useState(false);
  const nav=useNavigate();
  const [params]=useSearchParams();
  // Set by the api client when a request 401s on an expired session, so the user
  // learns their session lapsed instead of assuming their data went missing.
  const expired = params.get('expired') === '1';
  // Only ever an in-app path (the api client encodes location.pathname), but
  // reject anything protocol- or host-shaped so the query cannot bounce a user
  // off-site after login.
  const rawNext = params.get('next') || '';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '';

  async function submit(e:React.FormEvent){
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try{
      const r=await api.post('/api/auth/login',{email,password});
      localStorage.setItem('token',r.data.token);
      localStorage.setItem('role',r.data.user.role);
      localStorage.setItem('userName', r.data.user.name || '');
      localStorage.setItem('userEmail', r.data.user.email || '');
      if(r.data.user.driverId) localStorage.setItem('driverId', r.data.user.driverId);
      else localStorage.removeItem('driverId');
      if(next){ nav(next); return; }
      switch(r.data.user.role){
        case 'CUSTOMER':
          nav('/customer');
          break;
        case 'DRIVER':
          nav('/driver');
          break;
        case 'FUEL':
          nav('/fuel');
          break;
        case 'OPS':
        case 'ADMIN':
        default:
          nav('/ops');
          break;
      }
    }catch(err:any){
      setError(err?.response?.data?.error || 'Invalid email or password.');
    }finally{
      setSubmitting(false);
    }
  }

  return (
    <main className='mx-auto max-w-md px-4 py-16'>
      <h1 className='text-2xl font-bold text-slate-900'>Sign in</h1>
      {expired && (
        <div className='mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800'>
          Your session expired, so the page could not load your data. Sign in again to continue.
        </div>
      )}
      <form onSubmit={submit} className='mt-4 space-y-3'>
        <label className='block text-sm'>
          Email
          <input className='mt-1 w-full rounded-lg border px-3 py-2' value={email} onChange={e=>setEmail(e.target.value)} />
        </label>
        <label className='block text-sm'>
          Password
          <input type='password' className='mt-1 w-full rounded-lg border px-3 py-2' value={password} onChange={e=>setPassword(e.target.value)} />
        </label>
        <div className='text-xs text-slate-600'>
          <Link className='text-teal-700' to='/forgot-password'>Forgot password?</Link>
        </div>
        {error && <div className='rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600'>{error}</div>}
        <button disabled={submitting} className='w-full rounded-lg bg-slate-900 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60'>
          {submitting ? 'Signing in…' : 'Login'}
        </button>
      </form>
      <div className='mt-2 text-sm'>
        No account? <a className='text-teal-700' href='/register'>Register</a> (customers)
      </div>
    </main>
  );
}
