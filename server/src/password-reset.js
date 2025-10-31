import crypto from 'crypto';
import { db } from './db.js';

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function g(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function isoNow() {
  return new Date().toISOString();
}

function normaliseEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export const PASSWORD_RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 60);

export async function createPasswordResetRequest(email) {
  const value = normaliseEmail(email);
  if (!value) return { token: null, user: null, expiresAt: null };

  const user = await g(
    `SELECT id,email,name,role FROM users WHERE LOWER(email)=? LIMIT 1`,
    [value]
  );
  if (!user) {
    return { token: null, user: null, expiresAt: null };
  }

  const rawToken = crypto.randomBytes(48).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const now = isoNow();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60000).toISOString();

  await run(`DELETE FROM password_resets WHERE user_id=?`, [user.id]);
  await run(
    `INSERT INTO password_resets (token_hash,user_id,email,requested_at,expires_at,used_at)
     VALUES (?,?,?,?,?,NULL)`,
    [tokenHash, user.id, user.email, now, expiresAt]
  );

  return { token: rawToken, user, expiresAt };
}

export async function validatePasswordResetToken(token) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) return null;
  const tokenHash = hashToken(raw);
  const row = await g(
    `SELECT pr.token_hash, pr.user_id, pr.email, pr.requested_at, pr.expires_at, pr.used_at,
            u.email AS user_email, u.name AS user_name, u.role AS user_role
     FROM password_resets pr
     JOIN users u ON u.id = pr.user_id
     WHERE pr.token_hash=?
     LIMIT 1`,
    [tokenHash]
  );
  if (!row) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return {
    tokenHash,
    userId: row.user_id,
    email: row.user_email || row.email,
    name: row.user_name || '',
    role: row.user_role || null,
    expiresAt: row.expires_at,
  };
}

export async function consumePasswordResetToken(tokenHash) {
  const now = isoNow();
  await run(
    `UPDATE password_resets SET used_at=? WHERE token_hash=?`,
    [now, tokenHash]
  );
}

export async function cleanupExpiredPasswordResets() {
  const now = isoNow();
  await run(
    `DELETE FROM password_resets WHERE (expires_at <= ?) OR (used_at IS NOT NULL AND used_at <= ?)`,
    [now, now]
  );
}
