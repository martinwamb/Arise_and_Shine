
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data.db');
if (!fs.existsSync(path.dirname(DB_FILE))) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

export const db = new sqlite3.Database(DB_FILE);

const USERS_COLUMNS_SQL = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK(role IN ('ADMIN','OPS','DRIVER','CUSTOMER','FUEL')),
  password_hash TEXT NOT NULL,
  driver_id TEXT,
  created_at TEXT NOT NULL
`;

export function init() {
  db.serialize(() => {
    db.run('PRAGMA foreign_keys = ON');
    db.run('PRAGMA journal_mode = WAL');

    ensureUsersTable();

    db.run(`CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      national_id_path TEXT,
      photo_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS driver_onboarding_forms (
      driver_id TEXT PRIMARY KEY,
      form_data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      submitted_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      submitted_by INTEGER,
      FOREIGN KEY(driver_id) REFERENCES drivers(id),
      FOREIGN KEY(submitted_by) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS trucks (
      id TEXT PRIMARY KEY,
      plate TEXT NOT NULL,
      capacity_t REAL NOT NULL,
      primary_driver_id TEXT,
      primary_driver_assigned_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(primary_driver_id) REFERENCES drivers(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_id INTEGER,
      name TEXT,
      phone TEXT,
      email TEXT,
      site TEXT,
      sand_type TEXT DEFAULT 'coarse',
      band_id TEXT,
      per_truck INTEGER,
      trucks INTEGER,
      distance_km REAL,
      distance_source TEXT,
      total INTEGER,
      date_needed TEXT,
      status TEXT NOT NULL DEFAULT 'Received',
      payment_status TEXT DEFAULT 'PENDING',
      payment_method TEXT,
      payment_reference TEXT,
      payment_message TEXT,
      payment_recorded_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      deleted_at TEXT,
      deleted_reason TEXT,
      deleted_by INTEGER,
      cancel_reason TEXT,
      FOREIGN KEY(customer_id) REFERENCES users(id),
      FOREIGN KEY(deleted_by) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      truck_id TEXT NOT NULL,
      driver_id TEXT,
      status TEXT NOT NULL DEFAULT 'Scheduled',
      scheduled_at TEXT,
      delivered_at TEXT,
      tonnes REAL NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS stock (
      id INTEGER PRIMARY KEY CHECK(id=1),
      yard_name TEXT NOT NULL,
      tonnes REAL NOT NULL,
      trucks_coarse INTEGER NOT NULL DEFAULT 0,
      trucks_smooth INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS stock_tx (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('IN','OUT')),
      tonnes REAL NOT NULL,
      trucks REAL NOT NULL DEFAULT 0,
      category TEXT DEFAULT 'coarse',
      reason TEXT,
      order_id TEXT,
      truck_id TEXT,
      weight_tonnes REAL,
      cost_per_tonne REAL,
      photo_path TEXT,
      created_at TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS costs (
      id TEXT PRIMARY KEY,
      truck_id TEXT,
      driver_id TEXT,
      order_id TEXT,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      incurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by INTEGER,
      is_duplicate INTEGER NOT NULL DEFAULT 0,
      duplicate_of TEXT,
      confirmed_by INTEGER,
      confirmed_at TEXT,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_note TEXT,
      voided_by INTEGER,
      voided_at TEXT,
      void_reason TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT,
      body TEXT NOT NULL,
      image_url TEXT,
      topic TEXT,
      word_count INTEGER,
      created_at TEXT NOT NULL
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS fuel_logs (
      id TEXT PRIMARY KEY,
      truck_id TEXT,
      driver_id TEXT,
      litres REAL,
      odometer REAL,
      mileage REAL,
      cost REAL,
      photo_path TEXT,
      note TEXT,
      captured_at TEXT NOT NULL,
      created_by INTEGER,
      created_at TEXT NOT NULL,
      is_duplicate INTEGER NOT NULL DEFAULT 0,
      duplicate_of TEXT,
      confirmed_by INTEGER,
      confirmed_at TEXT,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_note TEXT,
      voided_by INTEGER,
      voided_at TEXT,
      void_reason TEXT,
      FOREIGN KEY(truck_id) REFERENCES trucks(id),
      FOREIGN KEY(driver_id) REFERENCES drivers(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS telemetry_snapshots (
      id TEXT PRIMARY KEY,
      truck_id TEXT NOT NULL,
      lat REAL,
      lng REAL,
      speed REAL,
      status TEXT,
      heading REAL,
      source TEXT,
      address TEXT,
      idle_minutes REAL,
      plate TEXT,
      captured_at TEXT NOT NULL,
      raw TEXT,
      created_at TEXT NOT NULL
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_telemetry_snapshots_truck_time ON telemetry_snapshots(truck_id, captured_at)`);

    db.run(`CREATE TABLE IF NOT EXISTS telemetry_ai_alerts (
      id TEXT PRIMARY KEY,
      truck_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      confidence REAL,
      summary TEXT NOT NULL,
      window_start TEXT,
      window_end TEXT,
      model TEXT,
      raw TEXT,
      created_at TEXT NOT NULL
    )`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_telemetry_ai_alerts_truck ON telemetry_ai_alerts(truck_id, created_at)`);

    db.run(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      created_at TEXT NOT NULL,
      sent_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      email TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS ai_audit_flags (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'warning',
      context TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL
    )`);

    db.run(`CREATE INDEX IF NOT EXISTS idx_assignments_driver ON assignments(driver_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_costs_incurred_at ON costs(incurred_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_fuel_logs_truck ON fuel_logs(truck_id, captured_at)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at)`);
  });
    ensureAdditionalColumns();
}

function ensureAdditionalColumns() {
  ensureColumn('drivers', 'email', 'TEXT');
  ensureColumn('drivers', 'phone', 'TEXT');
  ensureColumn('drivers', 'national_id_path', 'TEXT');
  ensureColumn('drivers', 'photo_path', 'TEXT');
  ensureColumn('drivers', 'created_at', "TEXT DEFAULT (datetime('now'))");
  ensureColumn('drivers', 'updated_at', "TEXT DEFAULT (datetime('now'))");

  ensureColumn('trucks', 'primary_driver_id', 'TEXT');
  ensureColumn('trucks', 'primary_driver_assigned_at', 'TEXT');
  ensureColumn('trucks', 'created_at', "TEXT DEFAULT (datetime('now'))");
  ensureColumn('trucks', 'updated_at', "TEXT DEFAULT (datetime('now'))");
  ensureColumn('trucks', 'cartrack_vehicle_id', 'TEXT');
  ensureColumn('trucks', 'cartrack_registration', 'TEXT');
  ensureColumn('trucks', 'cartrack_last_status_at', 'TEXT');
  ensureColumn('trucks', 'cartrack_last_lat', 'REAL');
  ensureColumn('trucks', 'cartrack_last_lng', 'REAL');
  ensureColumn('trucks', 'cartrack_last_speed', 'REAL');
  ensureColumn('trucks', 'cartrack_last_heading', 'REAL');
  ensureColumn('trucks', 'cartrack_last_ignition', 'INTEGER');

  ensureColumn('notifications', 'attempts', 'INTEGER NOT NULL DEFAULT 0', 0);
  ensureColumn('notifications', 'last_error', 'TEXT');
  ensureColumn('notifications', 'last_attempt_at', 'TEXT');
  ensureColumn('notifications', 'next_attempt_at', 'TEXT');
  ensureColumn('password_resets', 'email', 'TEXT NOT NULL', "''");
  ensureColumn('password_resets', 'requested_at', 'TEXT NOT NULL', "datetime('now')");
  ensureColumn('password_resets', 'expires_at', 'TEXT NOT NULL', "datetime('now')");
  ensureColumn('password_resets', 'used_at', 'TEXT');

  ensureColumn('orders', 'sand_type', "TEXT DEFAULT 'coarse'");
  ensureColumn('orders', 'distance_km', 'REAL');
  ensureColumn('orders', 'distance_source', 'TEXT');
  ensureColumn('orders', 'payment_status', "TEXT DEFAULT 'PENDING'");
  ensureColumn('orders', 'payment_method', 'TEXT');
  ensureColumn('orders', 'payment_reference', 'TEXT');
  ensureColumn('orders', 'payment_message', 'TEXT');
  ensureColumn('orders', 'payment_recorded_at', 'TEXT');
  ensureColumn('orders', 'updated_at', 'TEXT');
  ensureColumn('orders', 'deleted_at', 'TEXT');
  ensureColumn('orders', 'deleted_reason', 'TEXT');
  ensureColumn('orders', 'deleted_by', 'INTEGER');
  ensureColumn('orders', 'cancel_reason', 'TEXT');
  ensureColumn('users', 'telegram_chat_id', 'TEXT');

  ensureColumn('stock', 'trucks_coarse', 'INTEGER NOT NULL DEFAULT 0', 0);
  ensureColumn('stock', 'trucks_smooth', 'INTEGER NOT NULL DEFAULT 0', 0);
  ensureColumn('stock', 'updated_at', "TEXT DEFAULT (datetime('now'))");

  ensureColumn('stock_tx', 'trucks', 'REAL NOT NULL DEFAULT 0', 0);
  ensureColumn('stock_tx', 'category', "TEXT DEFAULT 'coarse'");
  ensureColumn('stock_tx', 'weight_tonnes', 'REAL');
  ensureColumn('stock_tx', 'cost_per_tonne', 'REAL');
  ensureColumn('stock_tx', 'photo_path', 'TEXT');

  ensureColumn('costs', 'created_by', 'INTEGER');
  ensureColumn('costs', 'is_duplicate', 'INTEGER NOT NULL DEFAULT 0', 0);
  ensureColumn('costs', 'duplicate_of', 'TEXT');
  ensureColumn('costs', 'confirmed_by', 'INTEGER');
  ensureColumn('costs', 'confirmed_at', 'TEXT');
  ensureColumn('costs', 'reviewed_by', 'INTEGER');
  ensureColumn('costs', 'reviewed_at', 'TEXT');
  ensureColumn('costs', 'review_note', 'TEXT');
  ensureColumn('costs', 'voided_by', 'INTEGER');
  ensureColumn('costs', 'voided_at', 'TEXT');
  ensureColumn('costs', 'void_reason', 'TEXT');

  ensureColumn('fuel_logs', 'driver_id', 'TEXT');
  ensureColumn('fuel_logs', 'cost', 'REAL');
  ensureColumn('fuel_logs', 'is_duplicate', 'INTEGER NOT NULL DEFAULT 0', 0);
  ensureColumn('fuel_logs', 'duplicate_of', 'TEXT');
  ensureColumn('fuel_logs', 'confirmed_by', 'INTEGER');
  ensureColumn('fuel_logs', 'confirmed_at', 'TEXT');
  ensureColumn('fuel_logs', 'reviewed_by', 'INTEGER');
  ensureColumn('fuel_logs', 'reviewed_at', 'TEXT');
  ensureColumn('fuel_logs', 'review_note', 'TEXT');
  ensureColumn('fuel_logs', 'voided_by', 'INTEGER');
  ensureColumn('fuel_logs', 'voided_at', 'TEXT');
  ensureColumn('fuel_logs', 'void_reason', 'TEXT');

  ensureColumn('telemetry_snapshots', 'heading', 'REAL');
  ensureColumn('telemetry_snapshots', 'source', 'TEXT');
  ensureColumn('telemetry_snapshots', 'address', 'TEXT');
  ensureColumn('telemetry_snapshots', 'idle_minutes', 'REAL');
  ensureColumn('telemetry_snapshots', 'plate', 'TEXT');
  ensureColumn('telemetry_ai_alerts', 'model', 'TEXT');
  ensureColumn('driver_onboarding_forms', 'submitted_by', 'INTEGER');
  ensureColumn('driver_onboarding_forms', 'submitted_at', 'TEXT');
  ensureColumn('driver_onboarding_forms', 'status', "TEXT NOT NULL DEFAULT 'draft'", 'draft');
}

function ensureColumn(table, column, definition, defaultValue) {
  db.all(`PRAGMA table_info(${table})`, (err, rows) => {
    if (err) {
      console.error(`Failed to inspect ${table} columns`, err);
      return;
    }
    const exists = rows.some((r) => r.name === column);
    if (exists) return;
    const trimmedDefinition = definition.trim();
    const fallbackDefinition = trimmedDefinition.replace(/DEFAULT\s*\(.*\)/i, '').trim();
    const wantsTimestampDefault = /datetime\s*\(/i.test(trimmedDefinition);

    const applyDefaults = () => {
      if (defaultValue !== undefined) {
        db.run(`UPDATE ${table} SET ${column} = COALESCE(${column}, ?)`, [defaultValue]);
      } else if (wantsTimestampDefault) {
        db.run(`UPDATE ${table} SET ${column} = COALESCE(${column}, datetime('now'))`);
      }
    };

    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${trimmedDefinition}`, (alterErr) => {
      if (!alterErr) {
        applyDefaults();
        return;
      }
      if (!/non-constant default/i.test(String(alterErr?.message || '')) || !fallbackDefinition) {
        console.error(`Failed to add column ${column} to ${table}`, alterErr);
        return;
      }
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${fallbackDefinition}`, (fallbackErr) => {
        if (fallbackErr) {
          console.error(`Failed to add column ${column} to ${table}`, fallbackErr);
          return;
        }
        applyDefaults();
      });
    });
  });
}

function ensureUsersTable() {
  db.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`, (err, row) => {
    if (err) {
      console.error('Failed to inspect users table', err);
      return;
    }
    const hasFuelRole = row?.sql?.includes("'FUEL'");
    if (!row) {
      db.run(`CREATE TABLE IF NOT EXISTS users (${USERS_COLUMNS_SQL})`);
      return;
    }
    if (!hasFuelRole) {
      db.serialize(() => {
        db.run('ALTER TABLE users RENAME TO users_old', (renameErr) => {
          if (renameErr) {
            console.error('Failed to rename users table', renameErr);
            return;
          }
          db.run(`CREATE TABLE users (${USERS_COLUMNS_SQL})`, (createErr) => {
            if (createErr) {
              console.error('Failed to recreate users table', createErr);
              return;
            }
            const cols = 'id, email, name, phone, role, password_hash, driver_id, created_at';
            db.run(
              `INSERT INTO users (${cols}) SELECT ${cols} FROM users_old`,
              (copyErr) => {
                if (copyErr) {
                  console.error('Failed to copy users data', copyErr);
                  return;
                }
                db.run('DROP TABLE users_old', (dropErr) => {
                  if (dropErr) {
                    console.error('Failed to drop temporary users table', dropErr);
                  }
                });
              }
            );
          });
        });
      });
    }
  });
}
