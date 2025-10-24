
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const SECRET = process.env.JWT_SECRET || 'dev';
export function sign(u){
  return jwt.sign(
    {
      id: u.id,
      role: u.role,
      name: u.name,
      email: u.email,
      driverId: u.driver_id || null,
    },
    SECRET,
    { expiresIn: '7d' }
  );
}
export function authRequired(req,res,next){
  const hdr = req.headers.authorization||'';
  const tok = hdr.startsWith('Bearer ')? hdr.slice(7): null;
  if(!tok) return res.status(401).json({ error:'Missing token' });
  try{ req.user = jwt.verify(tok, SECRET); next(); } catch{ return res.status(401).json({ error:'Invalid token' }); }
}
export function roleRequired(...roles){ return (req,res,next)=>{ if(!req.user) return res.status(401).json({error:'Unauthorized'}); if(!roles.includes(req.user.role)) return res.status(403).json({error:'Forbidden'}); next(); }; }
export function hash(p){ return bcrypt.hashSync(p,10); }
export function check(p,h){ return bcrypt.compareSync(p,h); }
export async function findByEmail(email){ return await new Promise((resolve,reject)=> db.get('SELECT * FROM users WHERE email=?',[email],(e,row)=> e?reject(e):resolve(row))); }
