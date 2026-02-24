import React, { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Truck, Menu, X, AlertTriangle, LogOut } from 'lucide-react';
import { api } from '../api';

export default function AppLayout() {
  const nav = useNavigate();
  const location = useLocation();
  const role = localStorage.getItem('role');
  const userName = localStorage.getItem('userName') || '';
  const userLabel = userName ? userName.split(' ')[0] : (role === 'ADMIN' ? 'Admin' : role === 'OPS' ? 'Ops' : '');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [banner, setBanner] = useState<{ missing: string[]; deadline?: string | null } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const links = [
    { key: 'home',     to: '/',         label: 'Home',       show: true },
    { key: 'articles', to: '/articles', label: 'Articles',   show: true },
    { key: 'order',    to: '/order',    label: 'Order',      show: true },
    { key: 'customer', to: '/customer', label: 'My Orders',  show: role === 'CUSTOMER' },
    { key: 'admin',    to: '/ops',      label: 'Admin',      show: role === 'ADMIN' },
    { key: 'ops',      to: '/ops',      label: 'Operations', show: role === 'OPS' },
    { key: 'driver',   to: '/driver',   label: 'Driver',     show: role === 'DRIVER' || role === 'ADMIN' },
    { key: 'fuel',     to: '/fuel',     label: 'Fuel',       show: role === 'FUEL' || role === 'ADMIN' || role === 'OPS' },
    { key: 'profile',  to: '/profile',  label: 'Personal',   show: Boolean(role) },
  ];

  const visibleLinks = links.filter((l) => l.show);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    let active = true;
    (async () => {
      try {
        const res = await api.get('/api/profile/employment-form/status');
        if (!active) return;
        const summary = res.data?.completionSummary;
        if (summary && !summary.isComplete) {
          setBanner({ missing: (summary.missingFields || []).slice(0, 3), deadline: res.data?.deadlineAt || null });
        }
      } catch { /* ignore */ }
    })();
    return () => { active = false; };
  }, []);

  function logout() {
    setMobileOpen(false);
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('driverId');
    localStorage.removeItem('userName');
    localStorage.removeItem('userEmail');
    nav('/');
  }

  function isActive(to: string) {
    return to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
  }

  return (
    <div className='min-h-screen bg-white text-slate-800'>
      {/* ── Top header ── */}
      <header className='sticky top-0 z-40 border-b border-slate-200 bg-white'>
        <div className='mx-auto flex max-w-7xl items-center justify-between px-4 h-14'>
          {/* Logo */}
          <Link to='/' className='flex items-center gap-2.5 shrink-0' onClick={() => setMobileOpen(false)}>
            <div className='flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900'>
              <Truck className='h-4 w-4 text-white' />
            </div>
            <span className='text-sm font-semibold text-slate-900 hidden sm:block'>Arise &amp; Shine</span>
          </Link>

          {/* Desktop nav */}
          <nav className='hidden md:flex items-center gap-1'>
            {visibleLinks.map((link) => (
              <Link
                key={link.key}
                to={link.to}
                className={[
                  'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  isActive(link.to)
                    ? 'bg-slate-100 text-slate-900'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50',
                ].join(' ')}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Desktop right actions */}
          <div className='hidden md:flex items-center gap-2'>
            {role && userLabel && (
              <span className='text-xs font-medium text-slate-500'>Hi, {userLabel}</span>
            )}
            {role ? (
              <button
                onClick={logout}
                className='inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors'
              >
                <LogOut className='h-3.5 w-3.5' />
                Logout
              </button>
            ) : (
              <Link
                to='/login'
                className='rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 transition-colors'
              >
                Login
              </Link>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            type='button'
            onClick={() => setMobileOpen((o) => !o)}
            className='md:hidden rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50'
            aria-label='Toggle menu'
          >
            {mobileOpen ? <X className='h-5 w-5' /> : <Menu className='h-5 w-5' />}
          </button>
        </div>
      </header>

      {/* ── Mobile drawer ── */}
      {mobileOpen && (
        <div className='md:hidden fixed inset-0 top-14 z-30 bg-white border-t border-slate-200'>
          <div className='flex flex-col p-4 gap-1'>
            {visibleLinks.map((link) => (
              <Link
                key={link.key}
                to={link.to}
                onClick={() => setMobileOpen(false)}
                className={[
                  'px-4 py-3 rounded-xl text-sm font-medium transition-colors',
                  isActive(link.to) ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50',
                ].join(' ')}
              >
                {link.label}
              </Link>
            ))}
            <div className='mt-3 pt-3 border-t border-slate-100 flex items-center justify-between'>
              {role && userLabel && (
                <span className='text-xs text-slate-500'>Hi, {userLabel}</span>
              )}
              {role ? (
                <button
                  onClick={logout}
                  className='inline-flex items-center gap-1.5 text-sm font-medium text-slate-600'
                >
                  <LogOut className='h-4 w-4' />
                  Logout
                </button>
              ) : (
                <Link
                  to='/login'
                  onClick={() => setMobileOpen(false)}
                  className='text-sm font-semibold text-slate-900'
                >
                  Login
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Employment form banner ── */}
      {banner && !dismissed && (
        <div className='bg-amber-50 border-b border-amber-200'>
          <div className='mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5 text-sm'>
            <div className='flex items-center gap-2 text-amber-800'>
              <AlertTriangle className='h-4 w-4 shrink-0 text-amber-600' />
              <span>
                <strong>Complete your employment details. </strong>
                {banner.missing.length ? `Pending: ${banner.missing.join(', ')}` : 'Some sections need attention.'}
                {banner.deadline && ` Due ${new Date(banner.deadline).toLocaleDateString()}.`}
              </span>
            </div>
            <div className='flex items-center gap-3 shrink-0'>
              <Link to='/profile' onClick={() => setDismissed(true)} className='text-xs font-semibold text-amber-900 underline'>
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
