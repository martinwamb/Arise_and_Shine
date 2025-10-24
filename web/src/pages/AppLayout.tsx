
import React from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Truck } from 'lucide-react';

export default function AppLayout(){
  const nav = useNavigate();
  const role = localStorage.getItem('role');
  const userName = localStorage.getItem('userName') || '';
  const userLabel = userName ? userName.split(' ')[0] : (role === 'ADMIN' ? 'Admin' : role === 'OPS' ? 'Ops' : '');
  function logout(){
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('driverId');
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
    nav('/');
  }
  return (
    <div className='min-h-screen bg-amber-50 text-slate-800'>
      <header className='sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur'>
        <div className='mx-auto flex max-w-7xl items-center justify-between px-4 py-3'>
          <Link to='/' className='flex items-center gap-2'>
            <div className='flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-teal-600 text-white shadow'>
              <Truck className='h-5 w-5' />
            </div>
            <span className='font-semibold tracking-tight text-slate-900'>Arise & Shine</span>
          </Link>
          <nav className='flex items-center gap-4 text-sm'>
            <Link to='/'>Home</Link>
            <Link to='/articles' className='inline'>Articles</Link>
            <Link to='/order'>Order</Link>
            {role==='CUSTOMER' && <Link to='/customer'>My Orders</Link>}
            {role==='ADMIN' && <Link to='/ops'>Admin</Link>}
            {role==='OPS' && <Link to='/ops'>Operations</Link>}
            {(role==='DRIVER' || role==='ADMIN') && <Link to='/driver'>Driver</Link>}
            {(role==='FUEL' || role==='ADMIN' || role==='OPS') && <Link to='/fuel'>Fuel</Link>}
            {role && userLabel && <span className='hidden rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 sm:inline'>Hi {userLabel}</span>}
            {role? <button onClick={logout} className='rounded-lg border px-3 py-1'>Logout</button>: <Link to='/login'>Login</Link>}
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
