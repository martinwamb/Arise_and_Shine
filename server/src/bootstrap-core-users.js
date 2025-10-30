import { db } from './db.js';
import { hash } from './auth.js';

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

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readEnv(prefix, suffix) {
  const key = `${prefix}_${suffix}`;
  const provided = Object.prototype.hasOwnProperty.call(process.env, key);
  return {
    key,
    provided,
    value: provided ? trimmed(process.env[key]) : '',
  };
}

function isoNow() {
  return new Date().toISOString();
}

const CORE_USERS = [
  { role: 'ADMIN', prefix: 'ADMIN', defaultName: 'Admin' },
  { role: 'OPS', prefix: 'OPS', defaultName: 'Operations Lead' },
  { role: 'FUEL', prefix: 'FUEL', defaultName: 'Fuel Monitor' },
  { role: 'DRIVER', prefix: 'DRIVER', defaultName: 'Lead Driver', needsDriver: true },
];

async function ensureDriverProfile({ driverId, name, email, phone }) {
  if (!driverId) return;
  const existing = await g('SELECT id FROM drivers WHERE id=?', [driverId]);
  const payload = {
    name: name || `Driver ${driverId}`,
    email: email || null,
    phone: phone || null,
    now: isoNow(),
  };
  if (!existing) {
    await run(
      `INSERT INTO drivers (id,name,email,phone,created_at,updated_at) VALUES (?,?,?,?,?,?)`,
      [driverId, payload.name, payload.email, payload.phone, payload.now, payload.now]
    );
    console.log(`[bootstrap] created driver profile ${driverId}`);
  } else {
    const updates = [];
    const params = [];
    if (payload.name) {
      updates.push('name=?');
      params.push(payload.name);
    }
    if (email !== undefined) {
      updates.push('email=?');
      params.push(payload.email);
    }
    if (phone !== undefined) {
      updates.push('phone=?');
      params.push(payload.phone);
    }
    if (updates.length) {
      updates.push('updated_at=?');
      params.push(payload.now);
      params.push(driverId);
      await run(`UPDATE drivers SET ${updates.join(', ')} WHERE id=?`, params);
      console.log(`[bootstrap] updated driver profile ${driverId}`);
    }
  }
}

async function ensureCoreUser(config) {
  const emailEnv = readEnv(config.prefix, 'EMAIL');
  const passwordEnv = readEnv(config.prefix, 'PASSWORD');
  const nameEnv = readEnv(config.prefix, 'NAME');
  const phoneEnv = readEnv(config.prefix, 'PHONE');
  const driverEnv = readEnv(config.prefix, 'DRIVER_ID');
  const driverNameEnv = readEnv(config.prefix, 'DRIVER_NAME');
  const driverPhoneEnv = readEnv(config.prefix, 'DRIVER_PHONE');
  const driverEmailEnv = readEnv(config.prefix, 'DRIVER_EMAIL');

  const hasUpdates =
    emailEnv.provided ||
    passwordEnv.provided ||
    nameEnv.provided ||
    phoneEnv.provided ||
    (config.needsDriver &&
      (driverEnv.provided || driverNameEnv.provided || driverPhoneEnv.provided || driverEmailEnv.provided));

  if (!hasUpdates) return;

  const email = emailEnv.value;
  const password = passwordEnv.value;
  const name = nameEnv.value;
  const phone = phoneEnv.provided ? phoneEnv.value : null;
  const driverIdValue = driverEnv.value;
  const driverName = driverNameEnv.value;
  const driverPhone = driverPhoneEnv.provided ? driverPhoneEnv.value : null;
  const driverEmail = driverEmailEnv.provided ? driverEmailEnv.value : null;

  const existingByRole = await g('SELECT * FROM users WHERE role=? ORDER BY id LIMIT 1', [config.role]);
  const existingByEmail = email ? await g('SELECT * FROM users WHERE email=?', [email]) : null;
  const existing = existingByEmail || existingByRole;

  const effectiveName = name || existing?.name || config.defaultName;
  const effectivePhone = phone !== null ? phone : existing?.phone || '';
  const effectiveDriverId =
    config.needsDriver && (driverEnv.provided ? driverIdValue || null : existing?.driver_id || null);

  if (!existing) {
    if (!email || !password) {
      console.warn(
        `[bootstrap] skipped creating ${config.role} account: email and password required (set ${config.prefix}_EMAIL and ${config.prefix}_PASSWORD)`
      );
      return;
    }
    await run(
      `INSERT INTO users (email,name,phone,role,password_hash,driver_id,created_at) VALUES (?,?,?,?,?,?,?)`,
      [
        email,
        effectiveName,
        effectivePhone,
        config.role,
        hash(password),
        config.needsDriver ? effectiveDriverId : null,
        isoNow(),
      ]
    );
    console.log(`[bootstrap] created ${config.role} account for ${email}`);
  } else {
    const updates = [];
    const params = [];
    let roleChanged = false;
    if (existing.role !== config.role) {
      updates.push('role=?');
      params.push(config.role);
      roleChanged = true;
    }
    if (emailEnv.provided && email && email !== existing.email) {
      updates.push('email=?');
      params.push(email);
    }
    if (nameEnv.provided && name && name !== existing.name) {
      updates.push('name=?');
      params.push(name);
    }
    if (phoneEnv.provided) {
      updates.push('phone=?');
      params.push(phone || '');
    }
    if (config.needsDriver && driverEnv.provided && effectiveDriverId !== existing.driver_id) {
      updates.push('driver_id=?');
      params.push(effectiveDriverId);
    }
    if (updates.length) {
      updates.push('created_at=COALESCE(created_at, ?)');
      params.push(existing.created_at || isoNow());
      params.push(existing.id);
      await run(`UPDATE users SET ${updates.join(', ')} WHERE id=?`, params);
      console.log(
        `[bootstrap] updated ${config.role} account (${existing.id})${
          roleChanged ? ' and ensured role assignment' : ''
        }`
      );
    }
    if (passwordEnv.provided && password) {
      await run(`UPDATE users SET password_hash=? WHERE id=?`, [hash(password), existing.id]);
      console.log(`[bootstrap] refreshed ${config.role} password`);
    }
  }

  if (config.needsDriver && effectiveDriverId) {
    await ensureDriverProfile({
      driverId: effectiveDriverId,
      name: driverName || effectiveName,
      email: driverEmailEnv.provided ? driverEmail : email || existing?.email || null,
      phone: driverPhoneEnv.provided ? driverPhone : effectivePhone,
    });
  }
}

export async function bootstrapCoreUsers() {
  for (const cfg of CORE_USERS) {
    try {
      await ensureCoreUser(cfg);
    } catch (err) {
      console.error(`[bootstrap] failed to ensure ${cfg.role} account`, err);
    }
  }
}
