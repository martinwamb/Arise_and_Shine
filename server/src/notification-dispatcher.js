import { db } from './db.js';
import { sendEmail, isEmailConfigured } from './mailer.js';

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function g(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function isoNow() {
  return new Date().toISOString();
}

function computeRetryDelayMinutes(attempt) {
  if (attempt <= 1) return 5;
  const backoff = 5 * Math.pow(2, attempt - 1);
  return Math.min(backoff, 60);
}

const MAX_ATTEMPTS = Number(process.env.NOTIFICATION_MAX_ATTEMPTS || 5);
const DEFAULT_BATCH_SIZE = Number(process.env.NOTIFICATION_DISPATCH_BATCH || 10);
const DISPATCH_INTERVAL_MS = Number(process.env.NOTIFICATION_DISPATCH_INTERVAL_MS || 30000);

let isProcessing = false;
let intervalRef = null;

export function startNotificationDispatcher() {
  if (DISPATCH_INTERVAL_MS <= 0) {
    console.log('[notify] email dispatcher disabled (interval <= 0)');
    return;
  }
  const tick = () => {
    dispatchPendingNotifications().catch((err) => {
      console.error('[notify] dispatch cycle failed', err);
    });
  };
  intervalRef = setInterval(tick, DISPATCH_INTERVAL_MS);
  // Kick off immediately on startup.
  tick();
}

export async function dispatchPendingNotifications({ limit = DEFAULT_BATCH_SIZE, force = false } = {}) {
  if (isProcessing && !force) {
    return { processed: 0, sent: 0, failures: 0, skipped: true, reason: 'busy' };
  }
  if (!isEmailConfigured()) {
    return { processed: 0, sent: 0, failures: 0, skipped: true, reason: 'email-not-configured' };
  }

  isProcessing = true;
  try {
    const nowIso = isoNow();
    const pending = await q(
      `SELECT id,email,subject,body,attempts FROM notifications
       WHERE status IN ('QUEUED','RETRY')
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY created_at ASC
       LIMIT ?`,
      [nowIso, Math.max(1, Number(limit) || DEFAULT_BATCH_SIZE)]
    );

    if (!pending.length) {
      const remaining = await g(
        `SELECT COUNT(*) AS cnt FROM notifications WHERE status IN ('QUEUED','RETRY')`
      );
      return { processed: 0, sent: 0, failures: 0, remaining: Number(remaining?.cnt || 0), skipped: false };
    }

    let sent = 0;
    let failures = 0;
    for (const item of pending) {
      const attempt = Number(item.attempts || 0) + 1;
      const attemptAt = isoNow();

      await run(
        `UPDATE notifications
         SET status='SENDING', attempts=?, last_attempt_at=?, last_error=NULL
         WHERE id=?`,
        [attempt, attemptAt, item.id]
      );

      try {
        await sendEmail({
          to: item.email,
          subject: item.subject,
          text: item.body,
        });
        await run(
          `UPDATE notifications
           SET status='SENT', sent_at=?, last_error=NULL, next_attempt_at=NULL
           WHERE id=?`,
          [isoNow(), item.id]
        );
        sent += 1;
      } catch (err) {
        failures += 1;
        const message = (err?.message || String(err || 'unknown error')).slice(0, 500);
        const shouldFail = attempt >= MAX_ATTEMPTS;
        const retryDelayMinutes = computeRetryDelayMinutes(attempt);
        const nextAttempt = shouldFail ? null : new Date(Date.now() + retryDelayMinutes * 60000).toISOString();
        await run(
          `UPDATE notifications
           SET status=?, last_error=?, next_attempt_at=?, last_attempt_at=?
           WHERE id=?`,
          [shouldFail ? 'FAILED' : 'RETRY', message, nextAttempt, attemptAt, item.id]
        );
      }
    }

    const remaining = await g(
      `SELECT COUNT(*) AS cnt FROM notifications WHERE status IN ('QUEUED','RETRY')`
    );

    return {
      processed: pending.length,
      sent,
      failures,
      remaining: Number(remaining?.cnt || 0),
      skipped: false,
    };
  } finally {
    isProcessing = false;
  }
}

export function stopNotificationDispatcher() {
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = null;
  }
}
