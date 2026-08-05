
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './index.css';
import AppLayout from './pages/AppLayout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import Order from './pages/Order';
import Customer from './pages/Customer';
import Ops from './pages/Ops';
import Driver from './pages/Driver';
import Fuel from './pages/Fuel';
import Articles from './pages/Articles';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Profile from './pages/Profile';
import PrivacyPolicy from './pages/PrivacyPolicy';
import DataDeletion from './pages/DataDeletion';
;(window as any).React = React
;(window as any).ReactDOM = ReactDOM

// Deployment marker (2024-10-29): ensures the latest frontend build is delivered.

// Scrolling over a focused number field silently changes its value, which has cost
// people entered amounts. Blur instead, so the page scrolls and the figure stands.
document.addEventListener(
  'wheel',
  (e) => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement && el.type === 'number' && el === e.target) el.blur();
  },
  { passive: true, capture: true }
);

// The guard used to accept any non-empty token string, so an expired one still
// rendered the full workspace while every request behind it 401'd. Read the JWT
// expiry and treat a lapsed token as no token. This is a UX check only — the
// server remains the authority on whether a token is valid.
function isExpired(token: string){
  try{
    const [, payload] = token.split('.');
    if(!payload) return false;
    const { exp } = JSON.parse(atob(payload.replace(/-/g,'+').replace(/_/g,'/')));
    return typeof exp === 'number' && exp * 1000 <= Date.now();
  }catch{
    return false; // Unreadable token: let the server reject it and say why.
  }
}

function Protected({children, roles}:{children:React.ReactNode, roles:('ADMIN'|'OPS'|'CUSTOMER'|'DRIVER'|'FUEL')[]}){
  const tok = localStorage.getItem('token');
  const role = localStorage.getItem('role') as any;
  const location = useLocation();
  if(!tok) return <Navigate to='/login' replace />
  if(isExpired(tok)){
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?expired=1&next=${next}`} replace />
  }
  if(roles && role && !roles.includes(role)) return <Navigate to='/' replace />
  return <>{children}</>
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<AppLayout/>}>
          <Route index element={<Landing/>} />
          <Route path='articles' element={<Articles />} />
          <Route path='order' element={<Protected roles={['CUSTOMER']}><Order/></Protected>} />
          <Route path='login' element={<Login/>} />
          <Route path='forgot-password' element={<ForgotPassword/>} />
          <Route path='reset-password' element={<ResetPassword/>} />
          <Route path='register' element={<Register/>} />
          <Route path='customer' element={<Protected roles={['CUSTOMER']}><Customer/></Protected>} />
          <Route path='profile' element={<Protected roles={['ADMIN','OPS','CUSTOMER','DRIVER','FUEL']}><Profile/></Protected>} />
          <Route path='ops' element={<Protected roles={['ADMIN','OPS']}><Ops/></Protected>} />
          <Route path='driver' element={<Protected roles={['DRIVER','ADMIN']}><Driver/></Protected>} />
          <Route path='fuel' element={<Protected roles={['FUEL','ADMIN','OPS']}><Fuel/></Protected>} />
          <Route path='privacy' element={<PrivacyPolicy/>} />
          <Route path='data-deletion' element={<DataDeletion/>} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
