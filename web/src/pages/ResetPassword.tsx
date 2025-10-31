import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { confirmPasswordReset } from '../api';

export default function ResetPassword(){
  const [params] = useSearchParams();
  const initialToken = useMemo(()=>params.get('token') || '', [params]);
  const [token,setToken] = useState(initialToken);
  const [password,setPassword] = useState('');
  const [confirm,setConfirm] = useState('');
  const [error,setError] = useState<string|null>(null);
  const [message,setMessage] = useState<string|null>(null);
  const [submitting,setSubmitting] = useState(false);
  const nav = useNavigate();

  async function submit(e:React.FormEvent){
    e.preventDefault();
    setError(null);
    setMessage(null);
    if(!token.trim()){
      setError('Reset token missing. Use the link from your email or paste the code here.');
      return;
    }
    if(password.length < 8){
      setError('Password must be at least 8 characters long.');
      return;
    }
    if(password !== confirm){
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try{
      await confirmPasswordReset(token.trim(), password);
      setMessage('Your password has been updated. You can sign in with the new password.');
      setTimeout(()=> nav('/login'), 1500);
    }catch(err:any){
      setError(err?.response?.data?.error || 'Unable to reset password right now.');
    }finally{
      setSubmitting(false);
    }
  }

  return (
    <main className='mx-auto max-w-md px-4 py-16'>
      <h1 className='text-2xl font-bold text-slate-900'>Reset password</h1>
      <p className='mt-2 text-sm text-slate-600'>Choose a new password for your Arise &amp; Shine account.</p>
      <form onSubmit={submit} className='mt-4 space-y-3'>
        <label className='block text-sm'>
          Reset token
          <input className='mt-1 w-full rounded-lg border px-3 py-2' value={token} onChange={e=>setToken(e.target.value)} placeholder='Paste token or use emailed link' />
        </label>
        <label className='block text-sm'>
          New password
          <input className='mt-1 w-full rounded-lg border px-3 py-2' type='password' value={password} onChange={e=>setPassword(e.target.value)} />
        </label>
        <label className='block text-sm'>
          Confirm password
          <input className='mt-1 w-full rounded-lg border px-3 py-2' type='password' value={confirm} onChange={e=>setConfirm(e.target.value)} />
        </label>
        {error && <div className='rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600'>{error}</div>}
        {message && <div className='rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700'>{message}</div>}
        <button type='submit' disabled={submitting} className='w-full rounded-lg bg-slate-900 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60'>
          {submitting ? 'Updating…' : 'Update password'}
        </button>
      </form>
      <div className='mt-4 text-sm text-slate-600'>
        <Link className='text-teal-700' to='/login'>Back to login</Link>
      </div>
    </main>
  );
}
