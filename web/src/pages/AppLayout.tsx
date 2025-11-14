
import React, { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Truck, Menu, X, AlertTriangle } from 'lucide-react';
import { api } from '../api';

export default function AppLayout(){
  const nav = useNavigate();
  const role = localStorage.getItem('role');
  const userName = localStorage.getItem('userName') || '';
  const userLabel = userName ? userName.split(' ')[0] : (role === 'ADMIN' ? 'Admin' : role === 'OPS' ? 'Ops' : '');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [banner, setBanner] = useState<{ missing: string[]; deadline?: string | null } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const links = [
    { key: 'home', to: '/', label: 'Home', show: true },
    { key: 'articles', to: '/articles', label: 'Articles', show: true },
    { key: 'order', to: '/order', label: 'Order', show: true },
    { key: 'customer', to: '/customer', label: 'My Orders', show: role === 'CUSTOMER' },
    { key: 'admin', to: '/ops', label: 'Admin', show: role === 'ADMIN' },
    { key: 'ops', to: '/ops', label: 'Operations', show: role === 'OPS' },
    { key: 'driver', to: '/driver', label: 'Driver', show: role === 'DRIVER' || role === 'ADMIN' },
    { key: 'fuel', to: '/fuel', label: 'Fuel', show: role === 'FUEL' || role === 'ADMIN' || role === 'OPS' },
    { key: 'profile', to: '/profile', label: 'Personal', show: Boolean(role) },
  ];

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    if(!token) return;
    let active = true;
    (async () => {
      try{
        const res = await api.get('/api/profile/employment-form/status');
        if(!active) return;
        const summary = res.data?.completionSummary;
        if(summary && !summary.isComplete){
          setBanner({
            missing: (summary.missingFields || []).slice(0, 3),
            deadline: res.data?.deadlineAt || null,
          });
        }
      }catch{
        // ignore fetch errors
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function logout(){
    setMobileOpen(false);
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('driverId');
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
    nav('/');
  }

  function handleLinkClick(){
    setMobileOpen(false);
  }

  return (
    <div className='min-h-screen bg-gradient-to-b from-white via-amber-50/60 to-white text-slate-800'>
      <header className='sticky top-0 z-40 border-b border-slate-200 bg-white/85 shadow-sm backdrop-blur'>
        <div className='mx-auto flex max-w-7xl items-center justify-between px-4 py-3'>
          <Link to='/' className='flex items-center gap-2'>
            <div className='flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-slate-800 text-white shadow'>
              <Truck className='h-5 w-5' />
            </div>
            <span className='font-semibold tracking-tight text-slate-900'>Arise &amp; Shine Transporters</span>
          </Link>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => setMobileOpen((open) => !open)}
              className='rounded-lg border border-slate-200 p-2 text-slate-600 transition hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500 md:hidden'
              aria-label='Toggle navigation menu'
            >
              {mobileOpen ? <X className='h-5 w-5' /> : <Menu className='h-5 w-5' />}
            </button>
            <nav className='hidden items-center gap-4 text-sm md:flex'>
              {links.filter((link) => link.show).map((link) => (
                <Link key={link.key} to={link.to} onClick={handleLinkClick} className='transition hover:text-amber-600'>
                  {link.label}
                </Link>
              ))}
              {role && userLabel && (
                <span className='hidden rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 lg:inline'>
                  Hi {userLabel}
                </span>
              )}
              {role ? (
                <button onClick={logout} className='rounded-lg border px-3 py-1 transition hover:bg-amber-50'>
                  Logout
                </button>
              ) : (
                <Link to='/login' className='rounded-lg border border-transparent px-3 py-1 transition hover:text-amber-600'>
                  Login
                </Link>
              )}
            </nav>
          </div>
        </div>
        {mobileOpen && (
          <div className='border-t border-slate-200 bg-white/95 shadow-sm backdrop-blur md:hidden'>
            <div className='mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 text-sm'>
              {links.filter((link) => link.show).map((link) => (
                <Link
                  key={link.key}
                  to={link.to}
                  onClick={handleLinkClick}
                  className='rounded-md px-2 py-2 font-medium text-slate-700 transition hover:bg-amber-50'
                >
                  {link.label}
                </Link>
              ))}
              {role && userLabel && (
                <span className='inline-flex items-center justify-start rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700'>
                  Hi {userLabel}
                </span>
              )}
              {role ? (
                <button
                  onClick={logout}
                  className='rounded-lg border border-slate-200 px-3 py-2 text-left font-medium text-slate-700 transition hover:bg-amber-50'
                >
                  Logout
                </button>
              ) : (
                <Link
                  to='/login'
                  onClick={handleLinkClick}
                  className='rounded-lg border border-slate-200 px-3 py-2 font-medium text-slate-700 transition hover:bg-amber-50'
                >
                  Login
                </Link>
              )}
            </div>
          </div>
        )}
      </header>
      {banner && !dismissed && (
        <div className='border-b border-amber-200 bg-amber-50/90'>
          <div className='mx-auto flex max-w-7xl flex-col gap-2 px-4 py-3 text-sm text-amber-900 md:flex-row md:items-center md:justify-between'>
            <div className='flex items-start gap-2'>
              <AlertTriangle className='mt-0.5 h-4 w-4 text-amber-600' />
              <div>
                <p className='font-semibold'>Complete your employment details</p>
                <p className='text-xs'>
                  {banner.missing.length ? `Pending: ${banner.missing.join(', ')}` : 'Some sections still require your attention.'}
                  {banner.deadline && ` • Update before ${new Date(banner.deadline).toLocaleDateString()}.`}
                </p>
              </div>
            </div>
            <div className='flex items-center gap-3'>
              <Link to='/profile' className='text-xs font-semibold text-amber-800 underline'>
                Open form
              </Link>
              <button type='button' onClick={() => setDismissed(true)} className='text-xs text-amber-700'>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
      <Outlet />
    </div>
  );
}
