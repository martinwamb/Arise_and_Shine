import nodemailer from 'nodemailer';

let cachedTransporter = null;
let lastConfigSignature = null;

function buildConfigSignature() {
  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_SERVICE,
    SMTP_URL,
    SMTP_SECURE,
    SMTP_IGNORE_TLS,
  } = process.env;
  return JSON.stringify({
    host: SMTP_HOST || null,
    port: SMTP_PORT || null,
    user: SMTP_USER || null,
    service: SMTP_SERVICE || null,
    url: SMTP_URL || null,
    secure: SMTP_SECURE || null,
    ignoreTls: SMTP_IGNORE_TLS || null,
  });
}

export function isEmailConfigured() {
  return Boolean(
    (process.env.SMTP_URL && process.env.SMTP_URL.trim()) ||
      (process.env.SMTP_HOST && process.env.SMTP_HOST.trim()) ||
      (process.env.SMTP_SERVICE && process.env.SMTP_SERVICE.trim())
  );
}

function resolveFromAddress() {
  if (process.env.SMTP_FROM && process.env.SMTP_FROM.trim()) {
    return process.env.SMTP_FROM.trim();
  }
  if (process.env.CONTACT_EMAIL && process.env.CONTACT_EMAIL.trim()) {
    return process.env.CONTACT_EMAIL.trim();
  }
  if (process.env.GEOCODER_EMAIL && process.env.GEOCODER_EMAIL.trim()) {
    return process.env.GEOCODER_EMAIL.trim();
  }
  return 'no-reply@arise.local';
}

async function createTransporter() {
  if (!isEmailConfigured()) {
    return null;
  }

  const signature = buildConfigSignature();
  if (cachedTransporter && signature === lastConfigSignature) {
    return cachedTransporter;
  }

  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    SMTP_PASS,
    SMTP_SERVICE,
    SMTP_URL,
    SMTP_SECURE,
    SMTP_IGNORE_TLS,
  } = process.env;

  try {
    let transporter;
    if (SMTP_URL && SMTP_URL.trim()) {
      transporter = nodemailer.createTransport(SMTP_URL.trim());
    } else if (SMTP_SERVICE && SMTP_SERVICE.trim()) {
      transporter = nodemailer.createTransport({
        service: SMTP_SERVICE.trim(),
        auth:
          SMTP_USER || SMTP_PASS
            ? {
                user: SMTP_USER,
                pass: SMTP_PASS,
              }
            : undefined,
      });
    } else {
      transporter = nodemailer.createTransport({
        host: SMTP_HOST?.trim(),
        port: Number(SMTP_PORT || 587),
        secure: ['1', 'true', 'yes'].includes(String(SMTP_SECURE || '').toLowerCase()),
        auth:
          SMTP_USER || SMTP_PASS
            ? {
                user: SMTP_USER,
                pass: SMTP_PASS,
              }
            : undefined,
        tls: ['1', 'true', 'yes'].includes(String(SMTP_IGNORE_TLS || '').toLowerCase())
          ? { rejectUnauthorized: false }
          : undefined,
      });
    }

    if (!transporter) {
      return null;
    }

    await transporter.verify().catch((err) => {
      // Some transports (like Mailtrap) reject verify; we still keep the transporter but log the issue.
      console.warn('Email transport verification warning:', err?.message || err);
    });

    cachedTransporter = transporter;
    lastConfigSignature = signature;
    return transporter;
  } catch (err) {
    console.error('Failed to initialise email transport', err);
    cachedTransporter = null;
    lastConfigSignature = null;
    return null;
  }
}

export async function sendEmail({ to, subject, text, html }) {
  if (!to || !subject) {
    throw new Error('Email recipient and subject are required');
  }
  const transporter = await createTransporter();
  if (!transporter) {
    throw new Error('Email transport not configured');
  }

  const payload = {
    from: resolveFromAddress(),
    to,
    subject,
    text: text || '',
  };

  if (html && html.trim()) {
    payload.html = html;
  } else if (payload.text) {
    payload.html = payload.text.replace(/\n/g, '<br>');
  }

  return transporter.sendMail(payload);
}

export function getEmailConfigSummary() {
  const summary = {
    configured: isEmailConfigured(),
    host: process.env.SMTP_HOST?.trim() || null,
    service: process.env.SMTP_SERVICE?.trim() || null,
    from: resolveFromAddress(),
  };
  if (process.env.SMTP_URL && process.env.SMTP_URL.trim()) {
    summary.host = process.env.SMTP_URL.trim();
  }
  return summary;
}
