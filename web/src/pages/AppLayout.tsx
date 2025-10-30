
import React, { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Truck, Menu, X } from 'lucide-react';

export default function AppLayout(){
  const nav = useNavigate();
  const role = localStorage.getItem('role');
  const userName = localStorage.getItem('userName') || '';
  const userLabel = userName ? userName.split(' ')[0] : (role === 'ADMIN' ? 'Admin' : role === 'OPS' ? 'Ops' : '');
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = [
    { key: 'home', to: '/', label: 'Home', show: true },
    { key: 'articles', to: '/articles', label: 'Articles', show: true },
    { key: 'order', to: '/order', label: 'Order', show: true },
    { key: 'customer', to: '/customer', label: 'My Orders', show: role === 'CUSTOMER' },
    { key: 'admin', to: '/ops', label: 'Admin', show: role === 'ADMIN' },
    { key: 'ops', to: '/ops', label: 'Operations', show: role === 'OPS' },
    { key: 'driver', to: '/driver', label: 'Driver', show: role === 'DRIVER' || role === 'ADMIN' },
    { key: 'fuel', to: '/fuel', label: 'Fuel', show: role === 'FUEL' || role === 'ADMIN' || role === 'OPS' },
  ];

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
    <div className='min-h-screen bg-amber-50 text-slate-800'>
      <header className='sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur'>
        <div className='mx-auto flex max-w-7xl items-center justify-between px-4 py-3'>
          <Link to='/' className='flex items-center gap-2'>
            <div className='flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-teal-600 text-white shadow'>
              <Truck className='h-5 w-5' />
            </div>
            <span className='font-semibold tracking-tight text-slate-900'>Arise & Shine</span>
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
      <Outlet />
    </div>
  );
}
