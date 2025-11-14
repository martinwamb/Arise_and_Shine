
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
;(window as any).React = React
;(window as any).ReactDOM = ReactDOM

// Deployment marker (2024-10-29): ensures the latest frontend build is delivered.

function Protected({children, roles}:{children:React.ReactNode, roles:('ADMIN'|'OPS'|'CUSTOMER'|'DRIVER'|'FUEL')[]}){
  const tok = localStorage.getItem('token');
  const role = localStorage.getItem('role') as any;
  if(!tok) return <Navigate to='/login' replace />
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
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
