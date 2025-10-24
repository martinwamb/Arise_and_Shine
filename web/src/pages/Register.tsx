
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
export default function Register(){
  const [name,setName]=useState(''); const [email,setEmail]=useState(''); const [phone,setPhone]=useState(''); const [password,setPassword]=useState(''); const nav=useNavigate();
  async function submit(e:React.FormEvent){ e.preventDefault(); const r=await api.post('/api/auth/register',{name,email,phone,password}); localStorage.setItem('token',r.data.token); localStorage.setItem('role',r.data.user.role); localStorage.setItem('userName', r.data.user.name || ''); localStorage.setItem('userEmail', r.data.user.email || ''); localStorage.removeItem('driverId'); nav('/order'); }
  return (<main className='mx-auto max-w-md px-4 py-16'><h1 className='text-2xl font-bold text-slate-900'>Create customer account</h1><form onSubmit={submit} className='mt-4 space-y-3'><label className='block text-sm'>Name<input className='mt-1 w-full rounded-lg border p-2' value={name} onChange={e=>setName(e.target.value)}/></label><label className='block text-sm'>Email<input className='mt-1 w-full rounded-lg border p-2' value={email} onChange={e=>setEmail(e.target.value)}/></label><label className='block text-sm'>Phone<input className='mt-1 w-full rounded-lg border p-2' value={phone} onChange={e=>setPhone(e.target.value)}/></label><label className='block text-sm'>Password<input type='password' className='mt-1 w-full rounded-lg border p-2' value={password} onChange={e=>setPassword(e.target.value)}/></label><button className='rounded-lg bg-slate-900 px-4 py-2 text-white'>Register</button></form></main>);
}
