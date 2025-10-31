import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '../api';

export default function ForgotPassword(){
  const [email,setEmail] = useState('');
  const [message,setMessage] = useState<string|null>(null);
  const [error,setError] = useState<string|null>(null);
  const [submitting,setSubmitting] = useState(false);

  async function submit(e:React.FormEvent){
    e.preventDefault();
    setMessage(null);
    setError(null);
    if(!email.trim()){
      setError('Enter an email address to continue.');
      return;
    }
    setSubmitting(true);
    try{
      await requestPasswordReset(email.trim());
      setMessage('If an account exists for that email, we have sent a reset link. Check your inbox for the next steps.');
    }catch(err:any){
      setError(err?.response?.data?.error || 'Unable to request a reset right now.');
    }finally{
      setSubmitting(false);
    }
  }

  return (
    <main className='mx-auto max-w-md px-4 py-16'>
      <h1 className='text-2xl font-bold text-slate-900'>Forgot password</h1>
      <p className='mt-2 text-sm text-slate-600'>Enter your email address and we&apos;ll send you a reset link.</p>
      <form onSubmit={submit} className='mt-4 space-y-3'>
        <label className='block text-sm'>
          Email
          <input className='mt-1 w-full rounded-lg border px-3 py-2' type='email' value={email} onChange={e=>setEmail(e.target.value)} />
        </label>
        {error && <div className='rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600'>{error}</div>}
        {message && <div className='rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700'>{message}</div>}
        <button type='submit' disabled={submitting} className='w-full rounded-lg bg-slate-900 px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60'>
          {submitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <div className='mt-4 text-sm text-slate-600'>
        Remembered it? <Link className='text-teal-700' to='/login'>Back to login</Link>
      </div>
    </main>
  );
}
