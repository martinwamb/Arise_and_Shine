import axios from 'axios';

const fallbackBase = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000';
export const API_BASE = (import.meta.env.VITE_API_BASE || fallbackBase).replace(/\/$/, '');
export const api = axios.create({ baseURL: API_BASE });
api.interceptors.request.use(cfg=>{ const t=localStorage.getItem('token'); if(t) cfg.headers.Authorization = `Bearer ${t}`; return cfg; });
export function setToken(t:string|null){ if(t) localStorage.setItem('token', t); else localStorage.removeItem('token'); }
