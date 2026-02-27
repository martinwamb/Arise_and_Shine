
import './load-env.js';
import 'openai/shims/node';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, init } from './db.js';
import { authRequired, roleRequired, sign, check, hash, findByEmail } from './auth.js';
import OpenAI from 'openai';
import { bootstrapCoreUsers } from './bootstrap-core-users.js';
import { getEmailConfigSummary, isEmailConfigured } from './mailer.js';
import { startNotificationDispatcher, dispatchPendingNotifications } from './notification-dispatcher.js';
import { ensureProtrackToken, getCachedProtrackToken } from './protrack-token.js';
import { getVehicles as getFleetVehicleStatuses } from './fleetApiClient.js';
import { isFleetApiConfigured } from './fleetApiAuth.js';
import { summariseTripExpectedSales, buildTripExpectedTelegram, buildTripExpectedEmailBody } from './trip-expected-sales-formatter.js';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { createEmptyDriverOnboardingForm, summarizeDriverOnboardingGaps } from '../../shared/driver-onboarding/index.js';
import { getReportDefinition, REPORT_DEFINITIONS, REPORT_FORMATS } from '../../shared/reports/index.js';
import {
  createPasswordResetRequest,
  validatePasswordResetToken,
  consumePasswordResetToken,
  cleanupExpiredPasswordResets,
  PASSWORD_RESET_TTL_MINUTES,
} from './password-reset.js';

// Deployment marker (2024-10-29): touchpoint to trigger full backend redeploy.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const DEFAULT_FRONTEND_DIST_DIR = path.resolve(__dirname, '..', '..', 'web', 'dist');
const FRONTEND_DIST_DIR = path.resolve(process.env.WEB_DIST_DIR || process.env.FRONTEND_DIST_DIR || DEFAULT_FRONTEND_DIST_DIR);
const FRONTEND_INDEX_FILE = path.join(FRONTEND_DIST_DIR, 'index.html');
const HAS_FRONTEND_BUNDLE = fs.existsSync(FRONTEND_INDEX_FILE);
const AI_BASE_URL = (process.env.AI_BASE_URL || process.env.LOCAL_AI_BASE_URL || process.env.OPENAI_BASE_URL || '').trim();
const AI_API_KEY = (process.env.OPENAI_API_KEY || process.env.AI_API_KEY || process.env.LOCAL_AI_API_KEY || '').trim();
const fsp = fs.promises;
const openaiClient = (AI_API_KEY || AI_BASE_URL)
  ? new OpenAI({ apiKey: AI_API_KEY || 'local-ai', baseURL: AI_BASE_URL || undefined })
  : null;
const AI_PROVIDER = openaiClient
  ? (AI_BASE_URL && !process.env.OPENAI_API_KEY ? 'local' : 'openai')
  : 'disabled';
if(!openaiClient){
  console.warn('AI disabled: set OPENAI_API_KEY or AI_BASE_URL/LOCAL_AI_BASE_URL to enable AI features.');
}else{
  console.log(`AI provider: ${AI_PROVIDER === 'local' ? 'Local (OpenAI-compatible)' : 'OpenAI'} ${AI_BASE_URL ? `(base ${AI_BASE_URL})` : ''}`);
}
const APP_BASE_URL_RAW = (process.env.APP_BASE_URL || process.env.FRONTEND_BASE_URL || process.env.WEB_APP_BASE_URL || process.env.PORTAL_BASE_URL || '').trim();
const PASSWORD_RESET_CLEANUP_INTERVAL_MS = Number(process.env.PASSWORD_RESET_CLEANUP_INTERVAL_MS || 60 * 60 * 1000);

function buildCorsOrigin(configValue){
  if(!configValue || configValue.trim() === '' || configValue.trim() === '*'){
    return () => true;
  }
  const entries = configValue.split(',').map((item)=>item.trim()).filter(Boolean);
  const escapeRegex = (value)=> value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matchers = entries.map((item)=>{
    if(item === '*') return () => true;
    if(item === 'null') return (origin)=> origin === null || origin === 'null';
    if(item.includes('*')){
      const parts = item.split('*').map(escapeRegex);
      const pattern = new RegExp(`^${parts.join('.*')}$`);
      return (origin)=> typeof origin === 'string' && pattern.test(origin);
    }
    return (origin)=> origin === item;
  });
  return (origin)=>{
    if(!origin) return true;
    return matchers.some((fn)=> fn(origin));
  };
}

const isOriginAllowed = buildCorsOrigin(process.env.ALLOW_ORIGIN || '');
function resolvePasswordResetBaseUrl(){
  if(APP_BASE_URL_RAW) return APP_BASE_URL_RAW.replace(/\/$/, '');
  const origins = (process.env.ALLOW_ORIGIN || '')
    .split(',')
    .map((item)=> item.trim())
    .filter(Boolean)
    .filter((item)=> item !== '*' && item !== 'null');
  const fallback = origins.find((item)=> item.startsWith('http://') || item.startsWith('https://'));
  return fallback ? fallback.replace(/\/$/, '') : null;
}
const PASSWORD_RESET_BASE_URL_RESOLVED = resolvePasswordResetBaseUrl();
const PASSWORD_RESET_BASE_URL = (PASSWORD_RESET_BASE_URL_RESOLVED || 'http://localhost:5173').replace(/\/$/, '');
const PASSWORD_RESET_HAS_EXPLICIT_BASE = Boolean(PASSWORD_RESET_BASE_URL_RESOLVED);
function buildPasswordResetLink(token){
  if(!token) return null;
  if(!PASSWORD_RESET_BASE_URL) return null;
  return `${PASSWORD_RESET_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
}

const ALLOWED_PAYMENT_STATUSES = new Set(['PENDING','REPORTED','CONFIRMED','DECLINED']);
const ALLOWED_ORDER_STATUSES = new Set([
  'Awaiting Payment',
  'Awaiting Payment Review',
  'Received',
  'In Transit',
  'Delivered',
  'Lead',
  'Cancelled',
]);

const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD || 50);
const DEFAULT_AI_CHAT_MODEL = process.env.AI_CHAT_MODEL || process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_INSIGHTS_MODEL || 'llama3:8b';
const DEFAULT_AI_AUDIT_MODEL = process.env.OPENAI_AUDIT_MODEL || process.env.AI_AUDIT_MODEL || DEFAULT_AI_CHAT_MODEL;
const MAX_AUDIT_FLAGS = Number.isFinite(Number(process.env.AI_AUDIT_MAX_FLAGS))
  ? Math.max(10, Number(process.env.AI_AUDIT_MAX_FLAGS))
  : 200;
const AI_CONTEXT_CACHE_MS = Math.max(0, Number(process.env.AI_CONTEXT_CACHE_MS || 45_000));
const AI_CONTEXT_TIMEOUT_MS = Math.max(2_000, Number(process.env.AI_CONTEXT_TIMEOUT_MS || 8_000));
const AI_REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || process.env.AI_REQUEST_TIMEOUT_MS || 12_000);
const AI_INSIGHTS_TIMEOUT_MS = Number(process.env.AI_INSIGHTS_TIMEOUT_MS || AI_REQUEST_TIMEOUT_MS);
const AI_CHAT_TIMEOUT_MS = Number(process.env.AI_CHAT_TIMEOUT_MS || AI_REQUEST_TIMEOUT_MS);
const EMPTY_AI_CONTEXT = {
  metrics: { revenue30:0, cost30:0, grossProfit30:0, marginPct:0, ordersCount30:0, stockTonnes:0, lowStockThreshold: LOW_STOCK_THRESHOLD },
  telemetry: [],
  telemetryAlerts: [],
  telemetryHistory: [],
  telemetryHistoryStats: [],
  truckStats: [],
  customerStats: [],
  driverWeek: [],
  driverPrevWeek: [],
  costs14: [],
  costsPrev14: [],
  stock: null,
  stockTx: [],
  orders30: [],
  auditFlags: [],
  truckLabels: {},
};

function resolveUploadPath(imagePath){
  if(!imagePath) return null;
  if(imagePath.startsWith('data:')) return null;
  if(imagePath.startsWith('/uploads/')){
    return path.join(uploadsDir, imagePath.replace(/^\/uploads\//, ''));
  }
  if(imagePath.startsWith('uploads/')){
    return path.join(uploadsDir, imagePath.replace(/^uploads\//, ''));
  }
  if(path.isAbsolute(imagePath)) return imagePath;
  return path.join(uploadsDir, imagePath);
}

async function pruneAuditFlags(){
  try{
    const row = await g('SELECT COUNT(*) as c FROM ai_audit_flags');
    const count = Number(row?.c||0);
    if(!Number.isFinite(count) || count <= MAX_AUDIT_FLAGS) return;
    const toRemove = count - MAX_AUDIT_FLAGS;
    await run('DELETE FROM ai_audit_flags WHERE id IN (SELECT id FROM ai_audit_flags ORDER BY created_at ASC LIMIT ?)', [toRemove]);
  }catch(err){
    console.error('Failed to prune ai_audit_flags', err);
  }
}

async function addAuditFlag({ entityType, entityId, message, severity='warning', context=null }){
  if(!entityType || !entityId || !message) return;
  await run('DELETE FROM ai_audit_flags WHERE entity_type=? AND entity_id=? AND resolved_at IS NULL', [entityType, entityId]);
  await run(
    'INSERT INTO ai_audit_flags (id, entity_type, entity_id, message, severity, context, resolved_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [id('AUD'), entityType, entityId, message.slice(0,500), severity, context ? JSON.stringify(context).slice(0,2000) : null, null, isoNow()]
  );
  await pruneAuditFlags();
}

async function resolveAuditFlags(entityType, entityId){
  await run('UPDATE ai_audit_flags SET resolved_at=? WHERE entity_type=? AND entity_id=? AND resolved_at IS NULL', [isoNow(), entityType, entityId]);
}

function queueImageAudit(args){
  if(!args) return;
  setTimeout(()=>{
    auditImageAgainstExpected(args).catch((err)=> console.error('Image audit failed', args?.entityType, args?.entityId, err));
  }, 25);
}

const app = express();
init();
bootstrapCoreUsers().catch((err)=> console.error('Failed to bootstrap core users', err));
startNotificationDispatcher();
cleanupExpiredPasswordResets().catch((err)=> console.error('Failed to cleanup password reset records', err));
if(PASSWORD_RESET_CLEANUP_INTERVAL_MS > 0){
  setInterval(()=>{
    cleanupExpiredPasswordResets().catch((err)=> console.error('Failed to cleanup password reset records', err));
  }, PASSWORD_RESET_CLEANUP_INTERVAL_MS);
}
if(!PASSWORD_RESET_HAS_EXPLICIT_BASE){
  console.warn('PASSWORD RESET WARNING: Falling back to http://localhost:5173 for reset links. Set APP_BASE_URL for production.');
}
normaliseStoredArticles();
normaliseStoredArticleImages();
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  }),
);
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));
app.use(cors({
  origin(origin, callback){
    try{
      if(isOriginAllowed(origin)){
        callback(null, true);
      }else{
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    }catch(err){
      callback(err);
    }
  },
  credentials: true,
}));
app.use(morgan('dev'));
app.use('/uploads', express.static(uploadsDir));

// Simple fixed-window rate limiter (no external dependency needed)
function createRateLimiter({ windowMs, max, message = 'Too many requests, please try again later.' }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const key = req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const count = (hits.get(key) || 0) + 1;
    hits.set(key, count);
    if (count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}
// Auth endpoints: 20 attempts per 15 minutes per IP
const authRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
app.use('/api/auth', authRateLimiter);
// Public chatbot: 10 requests per minute per IP
const chatbotRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10 });
app.use('/api/chatbot', chatbotRateLimiter);

const ARTICLE_TOPICS = [
  'Managing a construction project',
  'Avoiding scams in construction supply',
  'Global infrastructure projects to watch',
  'Budgeting for sand and aggregates',
  'Sustainable building trends',
  'Logistics best practices for construction',
  'Safety management on building sites',
  'Emerging technology in construction',
  'Cross-border haulage and permits',
  'Fuel efficiency for mixed fleets',
  'Preventing fuel theft with telematics',
  'Driver coaching and retention',
  'Customer billing and proof of delivery',
  'Site readiness and compliance checks',
  'Working capital and vendor payments',
];
const TELEMETRY_IDLE_THRESHOLD_MIN = Number(process.env.TELEMETRY_IDLE_THRESHOLD_MIN || 120);
const DRIVER_ALERT_THRESHOLD = Number(process.env.DRIVER_ALERT_THRESHOLD || 0.25);
const ARTICLE_MIN_WORDS = Number(process.env.ARTICLE_MIN_WORDS || 400);
const ARTICLE_MAX_WORDS = Number(process.env.ARTICLE_MAX_WORDS || 420);
const TELEMETRY_CACHE_MS = Number(process.env.TELEMETRY_CACHE_MS || 60_000);
const TRUCK_UNIT_TONNES = Number(process.env.TRUCK_UNIT_TONNES || 20);
const TELEMETRY_HISTORY_RETENTION_DAYS = Math.max(1, Number(process.env.TELEMETRY_HISTORY_RETENTION_DAYS || 90));
const TELEMETRY_HISTORY_CLEANUP_INTERVAL_MS = Number(process.env.TELEMETRY_HISTORY_CLEANUP_INTERVAL_MS || 6 * 60 * 60 * 1000);
const TELEMETRY_HISTORY_MAX_RECORDS = Math.max(100, Number(process.env.TELEMETRY_HISTORY_MAX_RECORDS || 2000));
const TELEMETRY_HISTORY_ALERT_LIMIT = Math.max(200, Number(process.env.TELEMETRY_HISTORY_ALERT_LIMIT || 2000));
const SPEED_KEYWORDS = ['speed','km/h','kmh','kph','over-speed','overspeed','over speed','fastest'];
const BASE_PRICE_PER_TRUCK = Number(process.env.BASE_PRICE_PER_TRUCK || 32000);
const BASE_DISTANCE_KM = Number(process.env.BASE_DISTANCE_KM || 15);
const PRICE_INCREMENT_KM = Number(process.env.PRICE_INCREMENT_KM || 5);
const PRICE_INCREMENT_AMOUNT = Number(process.env.PRICE_INCREMENT_AMOUNT || 1000);
const TELEMETRY_AI_ANALYSIS_INTERVAL_MS = Number(process.env.TELEMETRY_AI_ANALYSIS_INTERVAL_MS || 300_000);
const TELEMETRY_AI_LOOKBACK_MINUTES = Number(process.env.TELEMETRY_AI_LOOKBACK_MINUTES || 240);
const TELEMETRY_AI_MIN_POINTS = Number(process.env.TELEMETRY_AI_MIN_POINTS || 6);
const TELEMETRY_AI_MAX_POINTS = Number(process.env.TELEMETRY_AI_MAX_POINTS || 60);
const TELEMETRY_AI_MIN_ANOMALY_CONFIDENCE = Number(process.env.TELEMETRY_AI_MIN_ANOMALY_CONFIDENCE || 0.55);
const TELEMETRY_AI_MODEL = process.env.TELEMETRY_AI_MODEL || process.env.AI_MODEL || process.env.OPENAI_INSIGHTS_MODEL || 'llama3:8b';
const REPORT_SCHEDULER_INTERVAL_MS = Number(process.env.REPORT_SCHEDULER_INTERVAL_MS || 60_000);
pruneTelemetryHistory().catch((err)=> console.error('Initial telemetry history prune failed', err));
if(TELEMETRY_HISTORY_CLEANUP_INTERVAL_MS > 0){
  setInterval(()=>{
    pruneTelemetryHistory().catch((err)=> console.error('Scheduled telemetry history prune failed', err));
  }, TELEMETRY_HISTORY_CLEANUP_INTERVAL_MS);
}
const TELEMETRY_MOVING_SPEED_KPH = Number(process.env.TELEMETRY_MOVING_SPEED_KPH || 3);
const TELEMETRY_IDLE_SPEED_KPH = Number(process.env.TELEMETRY_IDLE_SPEED_KPH || 1);
const TELEMETRY_SPEED_ALERT_KPH = Number(process.env.TELEMETRY_SPEED_ALERT_KPH || 65);
const TELEMETRY_SPEED_ALERT_COOLDOWN_MIN = Number(process.env.TELEMETRY_SPEED_ALERT_COOLDOWN_MIN || 10);
const TELEMETRY_POLL_INTERVAL_MS = Number(process.env.TELEMETRY_POLL_INTERVAL_MS || 60_000);
startTelemetryPolling();
startReportScheduler();
const ADMIN_ASSIGNABLE_ROLES = ['ADMIN','OPS','FUEL','DRIVER'];
const TEAM_VISIBLE_ROLES = ['ADMIN','OPS','FUEL','DRIVER'];
const TEMP_PASSWORD_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@$!?';
const ARTICLE_IMAGE_POOL_RAW = (process.env.ARTICLE_IMAGE_POOL || '')
  .split(',')
  .map((item)=> item.trim())
  .filter(Boolean);
const DEFAULT_ARTICLE_IMAGE_POOL = [
  'https://images.pexels.com/photos/960622/pexels-photo-960622.jpeg?auto=compress&cs=tinysrgb&w=1200&h=720&dpr=1',
  'https://images.pexels.com/photos/3856252/pexels-photo-3856252.jpeg?auto=compress&cs=tinysrgb&w=1200&h=720&dpr=1',
  'https://images.pexels.com/photos/256381/pexels-photo-256381.jpeg?auto=compress&cs=tinysrgb&w=1200&h=720&dpr=1',
  'https://images.pexels.com/photos/585419/pexels-photo-585419.jpeg?auto=compress&cs=tinysrgb&w=1200&h=720&dpr=1',
  'https://images.pexels.com/photos/936722/pexels-photo-936722.jpeg?auto=compress&cs=tinysrgb&w=1200&h=720&dpr=1',
  'https://images.pexels.com/photos/632470/pexels-photo-632470.jpeg?auto=compress&cs=tinysrgb&w=1200&h=720&dpr=1',
  'https://images.pexels.com/photos/4483610/pexels-photo-4483610.jpeg?auto=compress&cs=tinysrgb&w=1200&h=720&dpr=1',
  'https://images.pexels.com/photos/3829174/pexels-photo-3829174.jpeg?auto=compress&cs=tinysrgb&w=1200&h=720&dpr=1',
  'https://images.pexels.com/photos/2881245/pexels-photo-2881245.jpeg?auto=compress&cs=tinysrgb&w=1200&h=720&dpr=1',
  'https://images.pexels.com/photos/176342/pexels-photo-176342.jpeg?auto=compress&cs=tinysrgb&w=1200&h=720&dpr=1',
  'https://images.pexels.com/photos/3840441/pexels-photo-3840441.jpeg?auto=compress&cs=tinysrgb&w=1200&h=720&dpr=1',
  'https://images.pexels.com/photos/6149118/pexels-photo-6149118.jpeg?auto=compress&cs=tinysrgb&w=1200&h=720&dpr=1',
];
const ARTICLE_IMAGE_POOL = ARTICLE_IMAGE_POOL_RAW.length ? ARTICLE_IMAGE_POOL_RAW : DEFAULT_ARTICLE_IMAGE_POOL;
const ARTICLE_IMAGE_FALLBACK =
  (process.env.ARTICLE_IMAGE_FALLBACK && process.env.ARTICLE_IMAGE_FALLBACK.trim() !== '')
    ? process.env.ARTICLE_IMAGE_FALLBACK.trim()
    : ARTICLE_IMAGE_POOL[0];
const LOCATION_DISTANCE_HINTS = [
  { regex: /thika/i, km: 5 },
  { regex: /juja/i, km: 12 },
  { regex: /ruiru/i, km: 22 },
  { regex: /githurai|kahawa|kasarani/i, km: 28 },
  { regex: /nairobi|westlands|upper\s*hill|industrial\s*area/i, km: 45 },
  { regex: /syokimau|kitengela|mlolongo/i, km: 55 },
  { regex: /machakos/i, km: 65 },
  { regex: /naivasha/i, km: 120 },
  { regex: /nakuru/i, km: 160 },
];
const COUNTRY_HINTS = [
  { regex: /\bkenya\b|\bke\b/, code: 'ke', label: 'Kenya' },
  { regex: /\btanzania\b|\btz\b/, code: 'tz', label: 'Tanzania' },
  { regex: /\buganda\b|\bug\b/, code: 'ug', label: 'Uganda' },
  { regex: /\brwanda\b|\brw\b/, code: 'rw', label: 'Rwanda' },
  { regex: /\bburundi\b|\bbi\b/, code: 'bi', label: 'Burundi' },
  { regex: /\bethiopia\b|\bet\b/, code: 'et', label: 'Ethiopia' },
  { regex: /\bsomalia\b|\bso\b/, code: 'so', label: 'Somalia' },
  { regex: /\bsouth\s*sudan\b|\bss\b/, code: 'ss', label: 'South Sudan' },
  { regex: /\bsudan\b|\bsd\b/, code: 'sd', label: 'Sudan' },
  { regex: /\bdr\s*(?:c|democratic republic of )?congo\b|\bdrc\b/, code: 'cd', label: 'Congo' },
  { regex: /\bzambia\b|\bzm\b/, code: 'zm', label: 'Zambia' },
  { regex: /\bmalawi\b|\bmw\b/, code: 'mw', label: 'Malawi' },
  { regex: /\bmozambique\b|\bmz\b/, code: 'mz', label: 'Mozambique' },
  { regex: /\bghana\b|\bgh\b/, code: 'gh', label: 'Ghana' },
  { regex: /\bnigeria\b|\bng\b/, code: 'ng', label: 'Nigeria' },
];
const DUPLICATE_WINDOW_SECONDS = Number(process.env.DUPLICATE_WINDOW_SECONDS || 900); // 15 minutes
const DUPLICATE_COST_TOLERANCE = Number(process.env.DUPLICATE_COST_TOLERANCE || 1); // KES
const DUPLICATE_LITRES_TOLERANCE = Number(process.env.DUPLICATE_LITRES_TOLERANCE || 5); // Litres
const THIKA_COORDS = {
  lat: Number(process.env.THIKA_LAT || -1.0456),
  lon: Number(process.env.THIKA_LON || 37.0824),
};
const THIKA_VICINITY_KM = Number(process.env.THIKA_VICINITY_KM || 5); // Yard proximity to treat as "in Thika"
const GEOCODER_ENDPOINT = process.env.GEOCODER_ENDPOINT || 'https://nominatim.openstreetmap.org/search';
const GEOCODER_REVERSE_ENDPOINT =
  process.env.GEOCODER_REVERSE_ENDPOINT || 'https://nominatim.openstreetmap.org/reverse';
const GEOCODER_EMAIL = process.env.GEOCODER_EMAIL || process.env.CONTACT_EMAIL || 'support@arise.local';
const GEOCODER_USER_AGENT =
  process.env.GEOCODER_USER_AGENT || `arise-shine-logistics/1.0 (${GEOCODER_EMAIL})`;
const geocodeCache = new Map();
const reverseGeocodeCache = new Map();
const telemetryCache = { data: [], fetchedAt: 0 };
const telemetryAnalysisState = { lastRun: 0, pending: false };
const REPORT_BUILDERS = {
  stocks: buildStockReport,
  'driver-earnings': buildDriverEarningsReport,
  'truck-performance': buildTruckPerformanceReport,
  'truck-sales-expenses': buildTruckSalesExpensesReport,
  'trip-log': buildTripLogReport,
  'trip-expected-sales': buildTripExpectedSalesReport,
  'ai-insights': buildAiInsightsReport,
  'speeding-alerts': buildSpeedingAlertReport,
  'vehicle-trip-timeline': buildVehicleTripTimelineReport,
};
const REPORT_FORMAT_SET = new Set(REPORT_FORMATS);

function q(sql, params=[]) { return new Promise((resolve, reject)=> db.all(sql, params, (e, rows)=> e?reject(e):resolve(rows))); }
function g(sql, params=[]) { return new Promise((resolve, reject)=> db.get(sql, params, (e, row)=> e?reject(e):resolve(row))); }
function run(sql, params=[]) { return new Promise((resolve, reject)=> db.run(sql, params, function(e){ e?reject(e):resolve(this); })); }
function id(prefix='ID'){ return prefix+'-'+Math.random().toString(16).slice(2)+Math.random().toString(16).slice(2); }
function isoNow(){ return new Date().toISOString(); }
function generateTemporaryPassword(length=12){
  let out = '';
  for(let i=0;i<length;i++){
    const idx = Math.floor(Math.random()*TEMP_PASSWORD_CHARSET.length);
    out += TEMP_PASSWORD_CHARSET.charAt(idx);
  }
  return out;
}
function mapUserRow(row){
  if(!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || '',
    role: row.role,
    driverId: row.driver_id || null,
    createdAt: row.created_at || null,
  };
}
function toISODate(date=new Date()){ return new Date(date).toISOString().slice(0,10); }
function parseDateOnly(value){
  if(!value) return null;
  const trimmed = String(value).trim().slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}
function deriveDateRange(filters={}, defaultRangeDays=7){
  const toCandidate = parseDateOnly(filters.toDate) || toISODate();
  let fromCandidate = parseDateOnly(filters.fromDate);
  const spanDays = Number(filters.rangeDays) || defaultRangeDays || 7;
  if(!fromCandidate){
    const base = new Date(`${toCandidate}T12:00:00Z`);
    base.setDate(base.getDate() - Math.max(1, spanDays));
    fromCandidate = toISODate(base);
  }
  if(fromCandidate > toCandidate){
    return { fromDate: toCandidate, toDate: fromCandidate };
  }
  return { fromDate: fromCandidate, toDate: toCandidate };
}
function calcAssignmentRevenue(perTruck, tonnes, capacity){
  if(!perTruck) return 0;
  if(capacity && capacity>0){ return Number(perTruck) * (Number(tonnes||0) / Number(capacity)); }
  return Number(perTruck);
}

function registerTruckLabel(map, truckId, plate){
  if(!truckId) return;
  const trimmed = typeof plate === 'string' ? plate.trim() : '';
  if(trimmed && !map.has(truckId)){
    map.set(truckId, trimmed);
  }
}

function resolveTruckLabel(context, truckId, fallbackPlate){
  if(typeof fallbackPlate === 'string' && fallbackPlate.trim()){
    return fallbackPlate.trim();
  }
  if(truckId && context?.truckLabels && context.truckLabels[truckId]){
    return context.truckLabels[truckId];
  }
  return truckId || 'Truck';
}
function containsSpeedKeyword(text){
  if(!text) return false;
  const value = text.toLowerCase();
  return SPEED_KEYWORDS.some(keyword=> value.includes(keyword));
}
function wordCount(text){ return text ? text.trim().split(/\s+/).length : 0; }
function clampArticleBody(text){
  if(!text) return '';
  const words = text.trim().split(/\s+/);
  if(words.length <= ARTICLE_MAX_WORDS) return text.trim();
  return words.slice(0, ARTICLE_MAX_WORDS).join(' ');
}
function stripCodeFences(text){
  if(!text) return '';
  let cleaned = String(text);
  cleaned = cleaned.replace(/```(?:json|javascript|js)?/gi, '');
  cleaned = cleaned.replace(/```/g, '');
  cleaned = cleaned.trim();
  if(cleaned.toLowerCase().startsWith('json ')){
    cleaned = cleaned.slice(4).trim();
  }
  return cleaned;
}
function safeParseArticlePayload(content){
  if(!content) return null;
  const text = String(content).trim();
  const blockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const payload = blockMatch ? blockMatch[1].trim() : text;
  try{
    const parsed = JSON.parse(payload);
    if(parsed && typeof parsed === 'object'){
      return parsed;
    }
  }catch{
    return null;
  }
  return null;
}
function coerceArticleResponse(rawContent, fallback){
  const fallbackWordCount = Number.isFinite(Number(fallback?.wordCount))
    ? Number(fallback.wordCount)
    : wordCount(fallback?.body || '');
  const base = {
    title: fallback?.title || '',
    summary: fallback?.summary || '',
    body: fallback?.body || '',
    wordCount: fallbackWordCount,
    topic: fallback?.topic || null,
  };
  const mergeUpdates = (candidate)=>{
    const cleanTitle = candidate?.title ? String(candidate.title).trim() : '';
    const cleanSummary = stripCodeFences(candidate?.summary || '');
    const cleanBody = clampArticleBody(stripCodeFences(candidate?.body || ''));
    return {
      ...base,
      title: cleanTitle || base.title,
      summary: cleanSummary || base.summary,
      body: cleanBody || base.body,
      wordCount: wordCount(cleanBody || base.body),
    };
  };
  const parsedDirect = safeParseArticlePayload(rawContent);
  if(parsedDirect){
    return mergeUpdates(parsedDirect);
  }
  const cleanedRaw = stripCodeFences(rawContent);
  const parsedFromCleaned = safeParseArticlePayload(cleanedRaw);
  if(parsedFromCleaned){
    return mergeUpdates(parsedFromCleaned);
  }
  const cleanedBody = clampArticleBody(cleanedRaw);
  if(cleanedBody && cleanedBody !== base.body){
    return {
      ...base,
      body: cleanedBody,
      wordCount: wordCount(cleanedBody),
    };
  }
  return base;
}
async function pickTopic(topic){
  if(topic) return topic;
  const recent = await q(`SELECT topic FROM articles WHERE topic IS NOT NULL AND topic!='' ORDER BY created_at DESC LIMIT 6`);
  const recentTopics = new Set(recent.map((row)=> row.topic));
  const pool = ARTICLE_TOPICS.filter((item)=> !recentTopics.has(item));
  const candidates = pool.length ? pool : ARTICLE_TOPICS;
  return candidates[Math.floor(Math.random()*candidates.length)];
}
function toNumber(value, fallback=0){
  const n = Number(value);
  return Number.isFinite(n)? n : fallback;
}
function formatCurrency(value){
  const n = toNumber(value);
  return `KES ${n.toLocaleString(undefined,{ maximumFractionDigits:0 })}`;
}
function normaliseIsoDate(value, fallback=isoNow()){
  if(!value) return fallback;
  try{
    const date = new Date(value);
    if(Number.isNaN(date.getTime())) return fallback;
    return date.toISOString();
  }catch{
    return fallback;
  }
}
async function findPotentialDuplicateCost({ truckId, type, amount, incurredAtIso }){
  if(!truckId || !type || !Number.isFinite(amount)) return null;
  const iso = incurredAtIso || isoNow();
  return await g(
    `SELECT id, truck_id, type, amount, description, incurred_at, created_at, created_by,
            is_duplicate, duplicate_of, confirmed_by, confirmed_at,
            reviewed_by, reviewed_at, review_note, voided_by, voided_at, void_reason
     FROM costs
     WHERE truck_id=?
       AND type=?
       AND ABS(amount - ?) <= ?
       AND ABS(strftime('%s', incurred_at) - strftime('%s', ?)) <= ?
     ORDER BY incurred_at DESC
     LIMIT 1`,
    [truckId, type, amount, DUPLICATE_COST_TOLERANCE, iso, DUPLICATE_WINDOW_SECONDS]
  );
}
async function findPotentialDuplicateFuel({ truckId, litres, cost, capturedAtIso }){
  if(!truckId) return null;
  const iso = capturedAtIso || isoNow();
  const params = [truckId, iso, DUPLICATE_WINDOW_SECONDS];
  let query = `
    SELECT id, truck_id, litres, cost, note, captured_at, created_at, created_by,
           is_duplicate, duplicate_of, confirmed_by, confirmed_at,
           reviewed_by, reviewed_at, review_note, voided_by, voided_at, void_reason
    FROM fuel_logs
    WHERE truck_id=?
      AND ABS(strftime('%s', captured_at) - strftime('%s', ?)) <= ?`;
  if(Number.isFinite(cost)){
    query += ' AND cost IS NOT NULL AND ABS(cost - ?) <= ?';
    params.push(cost, DUPLICATE_COST_TOLERANCE);
  }
  if(Number.isFinite(litres)){
    query += ' AND litres IS NOT NULL AND ABS(litres - ?) <= ?';
    params.push(litres, DUPLICATE_LITRES_TOLERANCE);
  }
  query += ' ORDER BY captured_at DESC LIMIT 1';
  return await g(query, params);
}
async function insertCostRecord({
  id,
  truckId,
  driverId=null,
  orderId=null,
  type,
  amount,
  description='',
  incurredAtIso,
  createdBy=null,
  isDuplicate=false,
  duplicateOf=null,
  confirmedBy=null,
  reviewNote=null,
  reviewedBy=null,
  reviewedAt=null,
  voidedBy=null,
  voidReason=null,
  voidedAt=null,
}){
  const confirmedAt = isDuplicate ? isoNow() : null;
  await run(
    `INSERT INTO costs (
       id,truck_id,driver_id,order_id,type,amount,description,incurred_at,created_at,created_by,
       is_duplicate,duplicate_of,confirmed_by,confirmed_at,reviewed_by,reviewed_at,review_note,
       voided_by,voided_at,void_reason
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      truckId,
      driverId,
      orderId,
      type,
      amount,
      description,
      incurredAtIso,
      isoNow(),
      createdBy,
      isDuplicate ? 1 : 0,
      isDuplicate ? duplicateOf || null : null,
      isDuplicate ? confirmedBy || null : null,
      confirmedAt,
      reviewedBy || null,
      reviewedAt || null,
      reviewNote || null,
      voidedBy || null,
      voidedAt || null,
      voidReason || null,
    ]
  );
}

const AUDIT_COST_BASE = `
  SELECT c.*,
         t.plate AS truck_plate,
         d.name AS driver_name,
         cu.name AS created_by_name,
         cu.email AS created_by_email,
         cb.name AS confirmed_by_name,
         rb.name AS reviewed_by_name,
         vb.name AS voided_by_name
  FROM costs c
  LEFT JOIN trucks t ON t.id=c.truck_id
  LEFT JOIN drivers d ON d.id=c.driver_id
  LEFT JOIN users cu ON cu.id=c.created_by
  LEFT JOIN users cb ON cb.id=c.confirmed_by
  LEFT JOIN users rb ON rb.id=c.reviewed_by
  LEFT JOIN users vb ON vb.id=c.voided_by
`;

const AUDIT_FUEL_BASE = `
  SELECT f.*,
         t.plate AS truck_plate,
         d.name AS driver_name,
         cu.name AS created_by_name,
         cu.email AS created_by_email,
         cb.name AS confirmed_by_name,
         rb.name AS reviewed_by_name,
         vb.name AS voided_by_name,
         (SELECT id FROM costs WHERE description LIKE 'Fuel log ' || f.id || '%' ORDER BY created_at DESC LIMIT 1) AS linked_cost_id
  FROM fuel_logs f
  LEFT JOIN trucks t ON t.id=f.truck_id
  LEFT JOIN drivers d ON d.id=f.driver_id
  LEFT JOIN users cu ON cu.id=f.created_by
  LEFT JOIN users cb ON cb.id=f.confirmed_by
  LEFT JOIN users rb ON rb.id=f.reviewed_by
  LEFT JOIN users vb ON vb.id=f.voided_by
`;

function computeAuditStatus(row){
  if(row?.voided_at) return 'voided';
  if(row?.reviewed_at) return 'reviewed';
  return 'pending';
}

function mapAuditCostRow(row){
  if(!row) return null;
  const amount = row.amount !== null && row.amount !== undefined ? Number(row.amount) : null;
  const eventAt = row.incurred_at || row.created_at || null;
  return {
    entity: 'COST',
    id: row.id,
    truckId: row.truck_id || null,
    truckPlate: row.truck_plate || null,
    driverId: row.driver_id || null,
    driverName: row.driver_name || null,
    type: row.type,
    amount,
    description: row.description || '',
    incurredAt: row.incurred_at || null,
    createdAt: row.created_at || null,
    eventAt,
    createdBy: row.created_by || null,
    createdByName: row.created_by_name || null,
    createdByEmail: row.created_by_email || null,
    duplicateOf: row.duplicate_of || null,
    confirmedBy: row.confirmed_by || null,
    confirmedByName: row.confirmed_by_name || null,
    confirmedAt: row.confirmed_at || null,
    reviewedBy: row.reviewed_by || null,
    reviewedByName: row.reviewed_by_name || null,
    reviewedAt: row.reviewed_at || null,
    reviewNote: row.review_note || null,
    voidedBy: row.voided_by || null,
    voidedByName: row.voided_by_name || null,
    voidedAt: row.voided_at || null,
    voidReason: row.void_reason || null,
    status: computeAuditStatus(row),
    isDuplicate: Boolean(row.is_duplicate),
  };
}

function mapAuditFuelRow(row){
  if(!row) return null;
  const eventAt = row.captured_at || row.created_at || null;
  return {
    entity: 'FUEL',
    id: row.id,
    truckId: row.truck_id || null,
    truckPlate: row.truck_plate || null,
    driverId: row.driver_id || null,
    driverName: row.driver_name || null,
    litres: row.litres !== null && row.litres !== undefined ? Number(row.litres) : null,
    odometer: row.odometer !== null && row.odometer !== undefined ? Number(row.odometer) : null,
    mileage: row.mileage !== null && row.mileage !== undefined ? Number(row.mileage) : null,
    cost: row.cost !== null && row.cost !== undefined ? Number(row.cost) : null,
    note: row.note || '',
    capturedAt: row.captured_at || null,
    createdAt: row.created_at || null,
    eventAt,
    createdBy: row.created_by || null,
    createdByName: row.created_by_name || null,
    createdByEmail: row.created_by_email || null,
    duplicateOf: row.duplicate_of || null,
    confirmedBy: row.confirmed_by || null,
    confirmedByName: row.confirmed_by_name || null,
    confirmedAt: row.confirmed_at || null,
    reviewedBy: row.reviewed_by || null,
    reviewedByName: row.reviewed_by_name || null,
    reviewedAt: row.reviewed_at || null,
    reviewNote: row.review_note || null,
    voidedBy: row.voided_by || null,
    voidedByName: row.voided_by_name || null,
    voidedAt: row.voided_at || null,
    voidReason: row.void_reason || null,
    status: computeAuditStatus(row),
    linkedCostId: row.linked_cost_id || null,
    isDuplicate: Boolean(row.is_duplicate),
  };
}

function normaliseAuditEntity(value){
  const input = String(value || '').toLowerCase();
  if(input === 'cost' || input === 'costs') return 'cost';
  if(input === 'fuel' || input === 'fuels' || input === 'fuel_logs') return 'fuel';
  return 'all';
}

function isoOrNull(value){
  return normaliseIsoDate(value, null);
}

async function fetchAuditRecord(entity, id){
  if(entity === 'cost'){
    const row = await g(`${AUDIT_COST_BASE} WHERE c.id=?`, [id]);
    if(!row || (!row.is_duplicate && !row.duplicate_of)) return null;
    return mapAuditCostRow(row);
  }
  if(entity === 'fuel'){
    const row = await g(`${AUDIT_FUEL_BASE} WHERE f.id=?`, [id]);
    if(!row || (!row.is_duplicate && !row.duplicate_of)) return null;
    return mapAuditFuelRow(row);
  }
  return null;
}

async function fetchDuplicateSource(entity, id){
  if(entity === 'cost'){
    const row = await g('SELECT * FROM costs WHERE id=?', [id]);
    if(!row || (!row.is_duplicate && !row.duplicate_of)) return null;
    return row;
  }
  if(entity === 'fuel'){
    const row = await g('SELECT * FROM fuel_logs WHERE id=?', [id]);
    if(!row || (!row.is_duplicate && !row.duplicate_of)) return null;
    return row;
  }
  return null;
}
function getMonthRange(month){
  const ref = month && /^\d{4}-\d{2}$/.test(month) ? month : toISODate().slice(0,7);
  const [y,m] = ref.split('-').map(Number);
  const start = new Date(Date.UTC(y, m-1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { month: ref, start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10) };
}
function haversineDistanceKm(lat1, lon1, lat2, lon2){
  const toRad = (deg)=> (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}
async function geocodeSite(site){
  if(!site || typeof site !== 'string' || site.trim().length < 3) return null;
  const key = site.trim().toLowerCase();
  if(geocodeCache.has(key)) return geocodeCache.get(key);
  try{
    const trimmed = site.trim();
    const lower = trimmed.toLowerCase();
    const countryHint = COUNTRY_HINTS.find((hint)=> hint.regex.test(lower));
    const url = new URL(GEOCODER_ENDPOINT);
    if(!url.searchParams.has('format')) url.searchParams.set('format','jsonv2');
    url.searchParams.set('limit','1');
    let query = trimmed;
    let countryCode = countryHint?.code || null;
    if(countryHint){
      const labelLower = countryHint.label?.toLowerCase();
      if(labelLower && !lower.includes(labelLower)){
        query = `${trimmed}, ${countryHint.label}`;
      }
    }else{
      countryCode = 'ke';
      if(!/kenya/i.test(trimmed)){
        query = trimmed.includes(',') ? `${trimmed}, Kenya` : `${trimmed}, Kenya`;
      }
    }
    url.searchParams.set('q', query);
    if(countryCode){
      url.searchParams.set('countrycodes', countryCode);
    }else{
      url.searchParams.delete('countrycodes');
    }
    const resp = await fetch(url.toString(), {
      headers: {
        'User-Agent': GEOCODER_USER_AGENT,
        Accept: 'application/json',
      },
    });
    if(!resp.ok) throw new Error(`Geocoder status ${resp.status}`);
    const data = await resp.json();
    if(Array.isArray(data) && data.length){
      const hit = data[0];
      const lat = Number(hit.lat);
      const lon = Number(hit.lon);
      if(Number.isFinite(lat) && Number.isFinite(lon)){
        const distance = haversineDistanceKm(THIKA_COORDS.lat, THIKA_COORDS.lon, lat, lon);
        const result = {
          distanceKm: distance,
          lat,
          lon,
          label: hit.display_name || site,
          provider: 'nominatim',
        };
        geocodeCache.set(key, result);
        return result;
      }
    }
  }catch(err){
    console.warn('Geocode failed', err);
  }
  geocodeCache.set(key, null);
  return null;
}

function summariseReverseGeocode(data){
  if(!data) return null;
  const address = data.address || {};
  // With zoom=16 we get street-level fields; prefer specific → general
  const road        = address.road || address.street || address.pedestrian || address.footway || address.path || '';
  const area        = address.neighbourhood || address.suburb || address.quarter || address.residential || '';
  const city        = address.city || address.town || address.village || address.municipality || data.name || '';
  const district    = address.county || address.district || address.state_district || '';
  const seen = new Set();
  const parts = [];
  // Prefer neighbourhood/suburb over road name — road is a fallback for rural areas with no area name
  for(const value of [area, city, road, district]){
    if(!value) continue;
    const trimmed = String(value).trim();
    if(!trimmed) continue;
    const normalised = trimmed.toLowerCase();
    if(seen.has(normalised)) continue;
    seen.add(normalised);
    parts.push(trimmed);
    if(parts.length >= 3) break;
  }
  if(parts.length) return parts.join(', ');
  if(typeof data.display_name === 'string'){
    const segments = data.display_name
      .split(',')
      .map((segment)=> segment.trim())
      .filter(Boolean);
    const unique = [];
    for(const segment of segments){
      const lowered = segment.toLowerCase();
      if(unique.some((entry)=> entry.toLowerCase() === lowered)) continue;
      unique.push(segment);
      if(unique.length >= 3) break;
    }
    if(unique.length) return unique.join(', ');
  }
  return null;
}

async function reverseGeocode(lat, lon){
  if(!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  // 1. In-memory cache (fastest)
  if(reverseGeocodeCache.has(key)){
    const cached = reverseGeocodeCache.get(key);
    return cached && typeof cached.then === 'function' ? await cached : cached;
  }
  // 2. DB-backed persistent cache (survives restarts)
  try{
    const dbRow = await g('SELECT address FROM geocode_cache WHERE lat_key=?', [key]);
    if(dbRow !== undefined){
      const stored = dbRow ? dbRow.address : null;
      reverseGeocodeCache.set(key, stored);
      return stored;
    }
  }catch(err){
    console.warn('geocode_cache read failed', err?.message);
  }
  // 3. Live Nominatim call (deduplicated via promise)
  const request = (async()=>{
    try{
      const url = new URL(GEOCODER_REVERSE_ENDPOINT);
      if(!url.searchParams.has('format')) url.searchParams.set('format','jsonv2');
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lon));
      url.searchParams.set('zoom', '16');
      url.searchParams.set('addressdetails', '1');
      const resp = await fetch(url.toString(), {
        headers: {
          'User-Agent': GEOCODER_USER_AGENT,
          Accept: 'application/json',
        },
      });
      if(!resp.ok) throw new Error(`Reverse geocoder status ${resp.status}`);
      const data = await resp.json();
      const label = summariseReverseGeocode(data);
      return label || null;
    }catch(err){
      console.warn('Reverse geocode failed', err?.message);
      return null;
    }
  })().then(async(result)=>{
    reverseGeocodeCache.set(key, result);
    try{
      await run(
        `INSERT OR REPLACE INTO geocode_cache (lat_key, address, created_at) VALUES (?,?,datetime('now'))`,
        [key, result]
      );
    }catch(err){
      console.warn('geocode_cache write failed', err?.message);
    }
    return result;
  }).catch((err)=>{
    console.warn('Reverse geocode cache error', err?.message);
    reverseGeocodeCache.set(key, null);
    return null;
  });
  reverseGeocodeCache.set(key, request);
  return request;
}

async function resolveDistanceKmAsync(site, explicit){
  const manual = Number(explicit);
  if(Number.isFinite(manual) && manual > 0){
    return { distanceKm: manual, source:'manual' };
  }
  const geo = await geocodeSite(site);
  if(geo){
    return { distanceKm: geo.distanceKm, source:'geocoded', geocode: geo };
  }
  const inferred = extractDistanceFromSite(site);
  if(Number.isFinite(inferred)){
    return { distanceKm: inferred, source:'heuristic' };
  }
  return { distanceKm: BASE_DISTANCE_KM + PRICE_INCREMENT_KM, source:'default' };
}
function normaliseSandType(value){
  if(!value) return 'coarse';
  const lower = String(value).toLowerCase();
  if(lower.includes('smooth') || lower.includes('fine')) return 'smooth';
  return 'coarse';
}
function extractDistanceFromSite(site){
  if(!site) return null;
  const kmMatch = /(\d+(?:\.\d+)?)\s*km/i.exec(site);
  if(kmMatch) return Number(kmMatch[1]);
  for(const hint of LOCATION_DISTANCE_HINTS){
    if(hint.regex.test(site)) return hint.km;
  }
  return null;
}
function resolveDistanceKm(site, explicit){
  const explicitNum = Number(explicit);
  if(Number.isFinite(explicitNum) && explicitNum > 0) return explicitNum;
  const inferred = extractDistanceFromSite(site);
  if(Number.isFinite(inferred)) return inferred;
  return BASE_DISTANCE_KM + PRICE_INCREMENT_KM;
}
function pricePerTruck(distanceKm){
  const km = Number(distanceKm);
  if(!Number.isFinite(km) || km <= BASE_DISTANCE_KM) return BASE_PRICE_PER_TRUCK;
  const extraKm = Math.max(0, km - BASE_DISTANCE_KM);
  const increments = Math.ceil(extraKm / PRICE_INCREMENT_KM);
  return BASE_PRICE_PER_TRUCK + (increments * PRICE_INCREMENT_AMOUNT);
}
async function computeOrderPricing({ site, trucks, sandType, distanceKm }){
  const resolved = await resolveDistanceKmAsync(site, distanceKm);
  const kmRaw = resolved.distanceKm;
  const km = Number.isFinite(kmRaw) ? Number(kmRaw.toFixed(2)) : kmRaw;
  const perTruck = pricePerTruck(km);
  const truckCount = Math.max(1, Number(trucks) || 1);
  const sand = normaliseSandType(sandType);
  const total = perTruck * truckCount;
  return {
    perTruck,
    truckCount,
    total,
    distanceKm: km,
    distanceSource: resolved.source,
    sandType: sand,
  };
}
function fallbackChatbotAnswer(history){
  const lastUser = [...history].reverse().find((m)=> m.role === 'user')?.content?.toLowerCase() || '';
  if(lastUser.includes('price') || lastUser.includes('cost')){
    return 'Our base price is KES 32,000 per 20-tonne truck within 15 km of Thika. Every additional 5 km adds KES 1,000. Confirm your site in the quote form for a precise figure.';
  }
  if(lastUser.includes('payment') || lastUser.includes('paybill') || lastUser.includes('bank')){
    return 'After submitting an order you will see the available MPESA paybills (ABSA, Equity, KCB, NCBA, Cooperative). Share the MPESA or RTGS reference in the portal so ops can confirm and dispatch trucks.';
  }
  if(lastUser.includes('article') || lastUser.includes('brief')){
    return 'The articles page lists the latest AI-generated briefings. Each morning we publish supply and logistics insights without requiring a login.';
  }
  if(lastUser.includes('truck') || lastUser.includes('telemetry') || lastUser.includes('location')){
    return 'Telemtry updates every 60 seconds. Once a truck is assigned to your order you can see its speed, idle minutes, and map position from the dashboard.';
  }
  if(lastUser.includes('stock') || lastUser.includes('sand')){
    return 'Stock is managed in 20-tonne truck units split between coarse and smooth sand. Receipts add units, assignments deduct them automatically, and low stock alerts trigger when the threshold is breached.';
  }
  return 'I can help with pricing, order status, payment steps, telemetry, or stock questions. Try asking about one of those topics for more detail.';
}
async function queueEmailNotification({ userId=null, email, subject, body, payload=null, status='QUEUED' }){
  if(!email) return;
  try{
    await run(
      `INSERT INTO notifications (id,user_id,email,channel,subject,body,payload,status,attempts,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        id('NTF'),
        userId,
        email,
        'EMAIL',
        subject,
        body,
        payload ? JSON.stringify(payload) : null,
        status,
        0,
        isoNow(),
      ]
    );
    if(process.env.DEBUG_NOTIFICATIONS !== '0'){
      console.log(`[notify] queued email to ${email}: ${subject}`);
    }
  }catch(err){
    console.error('Failed to queue notification', err);
  }
}
async function queueTelegramNotification({ chatId, subject, body, status='QUEUED', botToken=null }){
  if(!chatId) return;
  const recipient = String(chatId).trim();
  if(!recipient) return;
  const message = body ? `${subject || ''}\n\n${body}`.trim() : (subject || '').trim();
  if(!message) return;
  const payload = botToken ? JSON.stringify({ telegramBotToken: botToken }) : null;
  try{
    await run(
      `INSERT INTO notifications (id,email,channel,subject,body,status,attempts,created_at,payload)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        id('NTF'),
        recipient, // stored in email column for legacy compatibility
        'TELEGRAM',
        subject || '',
        message,
        status,
        0,
        isoNow(),
        payload,
      ]
    );
    if(process.env.DEBUG_NOTIFICATIONS !== '0'){
      console.log(`[notify] queued telegram to ${recipient}: ${subject || message.substring(0,80)}`);
    }
  }catch(err){
    console.error('Failed to queue telegram notification', err);
  }
}
async function sendTelegramMessage(chatId, subject, body){
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if(!token || !chatId) return;
  const message = body ? `${subject}\n\n${body}` : subject;
  const payload = {
    chat_id: chatId,
    text: message.slice(0, 3900),
    disable_web_page_preview: true,
  };
  try{
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
    });
    if(!res.ok){
      const errText = await res.text();
      console.error('Telegram send failed', res.status, errText);
    }
  }catch(err){
    console.error('Failed to send Telegram message', err);
  }
}
async function queueNotificationForRole(role, subject, body){
  const recipients = await q('SELECT id,email,telegram_chat_id FROM users WHERE role=?',[role]);
  for(const user of recipients){
    await queueEmailNotification({ userId:user.id, email:user.email, subject, body });
    if(user.telegram_chat_id){
      await queueTelegramNotification({ chatId:user.telegram_chat_id, subject, body });
    }
  }
}

async function pruneTelemetryHistory(){
  if(!Number.isFinite(TELEMETRY_HISTORY_RETENTION_DAYS) || TELEMETRY_HISTORY_RETENTION_DAYS <= 0) return;
  const offset = `-${Math.round(TELEMETRY_HISTORY_RETENTION_DAYS)} day`;
  try{
    const snapshotResult = await run(
      `DELETE FROM telemetry_snapshots WHERE datetime(captured_at) < datetime('now', ?)`,
      [offset]
    ).catch((err)=>{ throw Object.assign(err, { context:'snapshots' }); });
    const alertResult = await run(
      `DELETE FROM telemetry_ai_alerts WHERE datetime(created_at) < datetime('now', ?)`,
      [offset]
    ).catch((err)=>{ throw Object.assign(err, { context:'alerts' }); });
    const removedSnapshots = snapshotResult?.changes ?? 0;
    const removedAlerts = alertResult?.changes ?? 0;
    if(removedSnapshots || removedAlerts){
      console.log(`[telemetry] pruned ${removedSnapshots} snapshots and ${removedAlerts} alerts older than ${TELEMETRY_HISTORY_RETENTION_DAYS} days`);
    }
  }catch(err){
    console.error('Failed to prune telemetry history', err);
  }
}

function describeTelemetryDriver(item){
  if(!item) return 'Unassigned';
  const name = item.driverName ? String(item.driverName).trim() : '';
  const phone = item.driverPhone ? String(item.driverPhone).trim() : '';
  if(name && phone) return `${name} (${phone})`;
  if(name) return name;
  if(phone) return phone;
  return 'Unassigned';
}

function describeTelemetryLocation(item){
  if(item?.address && String(item.address).trim()){
    return String(item.address).trim();
  }
  const lat = Number(item?.lat);
  const lng = Number(item?.lng);
  if(Number.isFinite(lat) && Number.isFinite(lng)){
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
  return 'Unknown location';
}

async function maybeQueueSpeedingAlert({ telemetryItem, speed, capturedAt }){
  const limit = TELEMETRY_SPEED_ALERT_KPH;
  if(!Number.isFinite(limit) || limit <= 0) return;
  if(!telemetryItem?.truckId) return;
  const numericSpeed = Number(speed);
  if(!Number.isFinite(numericSpeed) || numericSpeed <= limit) return;
  const cooldownMs = Math.max(0, TELEMETRY_SPEED_ALERT_COOLDOWN_MIN) * 60_000;
  let lastAlertAt = null;
  try{
    const recent = await g(
      `SELECT created_at FROM telemetry_ai_alerts
       WHERE truck_id=? AND alert_type=?
       ORDER BY datetime(created_at) DESC
       LIMIT 1`,
      [telemetryItem.truckId, 'SPEEDING']
    );
    if(recent?.created_at){
      const ts = Date.parse(recent.created_at);
      if(Number.isFinite(ts)){
        lastAlertAt = ts;
      }
    }
  }catch(err){
    console.warn('Failed to inspect recent speed alert', err);
  }
  const capturedTs = Date.parse(capturedAt) || Date.now();
  if(lastAlertAt && cooldownMs > 0 && capturedTs - lastAlertAt < cooldownMs){
    return;
  }

  const locationLabel = describeTelemetryLocation(telemetryItem);
  const plate = telemetryItem.plate || telemetryItem.truckId;
  const driverLabel = describeTelemetryDriver(telemetryItem);
  const summary = `${plate} hit ${numericSpeed.toFixed(1)} km/h (limit ${limit} km/h) near ${locationLabel}.`;

  try{
    await run(
      `INSERT INTO telemetry_ai_alerts (
        id, truck_id, alert_type, severity, confidence, summary,
        window_start, window_end, model, raw, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id('TAL'),
        telemetryItem.truckId,
        'SPEEDING',
        'HIGH',
        null,
        summary.slice(0, 400),
        capturedAt,
        capturedAt,
        'speed-monitor',
        JSON.stringify({
          speedKph: numericSpeed,
          limitKph: limit,
          location: locationLabel,
          lat: Number.isFinite(Number(telemetryItem.lat)) ? Number(telemetryItem.lat) : null,
          lng: Number.isFinite(Number(telemetryItem.lng)) ? Number(telemetryItem.lng) : null,
          driverName: telemetryItem.driverName || null,
          driverPhone: telemetryItem.driverPhone || null,
          plate,
        }),
        isoNow(),
      ]
    );
  }catch(err){
    console.error('Failed to record speeding alert', err);
  }

  const bodyLines = [
    `Truck: ${plate} (${telemetryItem.truckId})`,
    `Driver: ${driverLabel}`,
    `Speed: ${numericSpeed.toFixed(1)} km/h (limit ${limit} km/h)`,
    `Location: ${locationLabel}`,
    `Captured: ${capturedAt}`,
  ];
  const subject = `Speeding alert: ${plate}`;
  const message = bodyLines.join('\n');
  await queueNotificationForRole('ADMIN', subject, message);
  await queueNotificationForRole('OPS', subject, message);
}

// ===== AUTH =====
app.post('/api/auth/login', async (req,res)=>{
  const { email, password } = req.body;
  const u = await findByEmail(email);
  if(!u || !check(password, u.password_hash)) return res.status(401).json({ error:'Invalid credentials' });
  res.json({ token: sign(u), user: { id:u.id, email:u.email, name:u.name, role:u.role, driverId: u.driver_id || null } });
});
app.post('/api/auth/password-reset/request', async (req,res)=>{
  const email = String(req.body?.email || '').trim();
  const emailConfigured = isEmailConfigured();
  try{
    const { token, user } = await createPasswordResetRequest(email);
    const emailQueued = Boolean(token && user && emailConfigured);
    if(token && user){
      const resetLink = buildPasswordResetLink(token);
      const subject = 'Reset your Arise & Shine password';
      const greeting = user.name ? `Hi ${user.name},` : 'Hi there,';
      const resetInstruction = resetLink
        ? `Use the link below to choose a new password. It expires in ${PASSWORD_RESET_TTL_MINUTES} minutes.\n\n${resetLink}`
        : `Use the link below to choose a new password within the next ${PASSWORD_RESET_TTL_MINUTES} minutes.\n\n${PASSWORD_RESET_BASE_URL}/reset-password?token=${encodeURIComponent(token)}`;
      const body = `${greeting}\n\nWe received a request to reset your Arise & Shine password.\n\n${resetInstruction}\n\nIf you did not request this, you can safely ignore the email.\n\nâ€” Arise & Shine`;
      if(emailConfigured){
        await queueEmailNotification({
          userId: user.id,
          email: user.email,
          subject,
          body,
        });
      }else{
        console.warn(`[auth] Password reset requested for ${user.email}, but SMTP is not configured. Provide the reset link manually: ${resetLink}`);
      }
    }
    res.json({ ok:true, emailQueued });
  }catch(err){
    console.error('Failed to queue password reset email', err);
    res.status(500).json({ error:'Unable to process password reset right now' });
  }
});
app.post('/api/auth/password-reset/confirm', async (req,res)=>{
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '').trim();
  if(!token || !password) return res.status(400).json({ error:'Token and new password are required' });
  if(password.length < 8) return res.status(400).json({ error:'Password must be at least 8 characters long' });
  try{
    const result = await validatePasswordResetToken(token);
    if(!result) return res.status(400).json({ error:'Invalid or expired reset token' });
    await run('UPDATE users SET password_hash=? WHERE id=?', [hash(password), result.userId]);
    await consumePasswordResetToken(result.tokenHash);
    res.json({ ok:true });
  }catch(err){
    console.error('Failed to reset password via token', err);
    res.status(500).json({ error:'Unable to reset password right now' });
  }
});
app.post('/api/auth/register', async (req,res)=>{
  const { name, email, phone, password } = req.body;
  try{
    const r = await run('INSERT INTO users (email,name,phone,role,password_hash,created_at) VALUES (?,?,?,?,?,?)',[email,name,phone||'', 'CUSTOMER', hash(password), new Date().toISOString()]);
    const u = await g('SELECT * FROM users WHERE id=?',[r.lastID]);
    await run('UPDATE orders SET customer_id=? WHERE email=? AND customer_id IS NULL', [u.id, email]);
    res.json({ token: sign(u), user: { id:u.id, email:u.email, name:u.name, role:u.role, driverId: u.driver_id || null } });
  }catch{ res.status(400).json({ error:'Email already used' }); }
});
app.get('/api/me', authRequired, async (req,res)=>{
  const u = await g('SELECT id,email,name,phone,role,driver_id,telegram_chat_id FROM users WHERE id=?',[req.user.id]);
  res.json({ user: { id:u?.id||req.user.id, email:u?.email||req.user.email, name:u?.name||req.user.name, phone:u?.phone||'', role:u?.role||req.user.role, driverId: u?.driver_id||req.user.driverId||null, telegramChatId: u?.telegram_chat_id || null } });
});

// ===== ARTICLES =====
app.get('/api/articles', async (req,res)=>{
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  const rows = await q(
    `SELECT id,title,summary,body,image_url,topic,word_count,created_at
     FROM articles
     ORDER BY datetime(created_at) DESC
     LIMIT ? OFFSET ?`,
    [limit, offset],
  );
  res.json(rows.map(r=>({
    id: r.id,
    title: r.title,
    summary: r.summary,
    body: r.body,
    imageUrl: r.image_url || null,
    topic: r.topic,
    wordCount: r.word_count,
    createdAt: r.created_at,
  })));
});
app.get('/api/articles/:id', async (req,res)=>{
  const art = await g(`SELECT id,title,summary,body,image_url,topic,word_count,created_at FROM articles WHERE id=?`, [req.params.id]);
  if(!art) return res.status(404).json({ error:'Not found' });
  res.json({
    id: art.id,
    title: art.title,
    summary: art.summary,
    body: art.body,
    imageUrl: art.image_url || null,
    topic: art.topic,
    wordCount: art.word_count,
    createdAt: art.created_at,
  });
});
app.post('/api/admin/articles/generate', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  try{
    const article = await generateArticle(req.body?.topic);
    res.status(201).json(article);
  }catch(err){
    console.error('Article generation failed', err);
    res.status(500).json({ error:'Failed to generate article', detail: String(err) });
  }
});

// ===== PUBLIC PRICING =====
app.get('/api/pricing', (req,res)=>{
  res.json({
    basePrice: BASE_PRICE_PER_TRUCK,
    baseDistanceKm: BASE_DISTANCE_KM,
    incrementKm: PRICE_INCREMENT_KM,
    incrementAmount: PRICE_INCREMENT_AMOUNT,
    hints: LOCATION_DISTANCE_HINTS.map(h=>({ km:h.km, sample:h.regex.toString() })),
  });
});
app.post('/api/pricing/quote', async (req,res)=>{
  const { site, trucks, sandType, distanceKm } = req.body || {};
  const pricing = await computeOrderPricing({ site, trucks, sandType, distanceKm });
  res.json(pricing);
});
app.post('/api/chatbot', async (req,res)=>{
  const historyInput = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const history = historyInput
    .map((item)=>({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: typeof item?.content === 'string' ? item.content.trim().slice(0,400) : '',
    }))
    .filter((item)=> item.content);
  const contextText = typeof req.body?.context === 'string' ? req.body.context.trim() : '';
  const contextMessage = contextText ? { role:'system', content: contextText.slice(0,800) } : null;
  const systemPrompt = {
    role:'system',
    content:'You are a helpful logistics assistant for Arise & Shine. Be concise and reference distance-based pricing (KES 32,000 base, +KES 1,000 every 5 km), payment confirmation via the listed banks, sand stock categories (coarse/smooth, 20 t per truck), and telemetry/fuel monitoring features.',
  };
  const convo = [systemPrompt];
  if(contextMessage) convo.push(contextMessage);
  convo.push(...history.slice(-8));
  if(openaiClient){
    try{
      const model = process.env.OPENAI_CHATBOT_MODEL || 'llama3:8b';
      const completion = await openaiClient.chat.completions.create({
        model,
        temperature: 0.3,
        messages: convo,
      });
      const answer = completion?.choices?.[0]?.message?.content?.trim();
      if(answer){
        return res.json({ answer });
      }
    }catch(err){
      console.warn('Chatbot OpenAI call failed', err);
    }
  }
  res.json({ answer: fallbackChatbotAnswer(history) });
});

// ===== ORDERS =====
app.post('/api/orders/guest', async (req,res)=>{
  const { name, email, phone, site, sandType, trucks, distanceKm, dateNeeded, account } = req.body;
  if(!name || !phone || !site) return res.status(400).json({ error:'Name, phone, and site are required' });
  let customerId = null;
  let accountResponse = null;
  if(account && typeof account.password === 'string' && account.password.trim()){
    if(!email) return res.status(400).json({ error:'Email is required to create a portal login.' });
    if(account.password.trim().length < 8){
      return res.status(400).json({ error:'Password must be at least 8 characters long.' });
    }
    const existing = await findByEmail(email);
    if(existing){
      return res.status(400).json({ error:'An account already exists with this email. Please sign in on the portal to place your order.' });
    }
    const passwordHash = hash(account.password.trim());
    const now = isoNow();
    const userInsert = await run(
      'INSERT INTO users (email,name,phone,role,password_hash,created_at) VALUES (?,?,?,?,?,?)',
      [email, name, phone||'', 'CUSTOMER', passwordHash, now]
    );
    const registered = await g('SELECT * FROM users WHERE id=?',[userInsert.lastID]);
    customerId = registered.id;
    accountResponse = {
      token: sign(registered),
      user: {
        id: registered.id,
        email: registered.email,
        name: registered.name,
        role: registered.role,
        driverId: registered.driver_id || null,
      },
      created: true,
    };
  }
  const pricing = await computeOrderPricing({ site, trucks, sandType, distanceKm });
  const idv = id('ORD');
  await run(`INSERT INTO orders (id, customer_id, name, phone, email, site, sand_type, band_id, per_truck, trucks, distance_km, distance_source, total, date_needed, status, payment_status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      idv,
      customerId,
      name,
      phone||'',
      email||'',
      site,
      pricing.sandType,
      'dynamic',
      pricing.perTruck,
      pricing.truckCount,
      pricing.distanceKm,
      pricing.distanceSource,
      pricing.total,
      dateNeeded||null,
      'Awaiting Payment',
      'PENDING',
      isoNow(),
      isoNow(),
    ]);
  const summaryLine = `Order ${idv} for ${pricing.truckCount} truck(s) of ${pricing.sandType} sand at ${formatCurrency(pricing.perTruck)} per truck (site: ${site}, ~${Math.round(pricing.distanceKm)} km, ${pricing.distanceSource}).`;
  const paymentNote = 'Please use the shared MPESA paybill options (ABSA, Equity, KCB, NCBA, Cooperative) and send the confirmation in your portal so dispatch can schedule trucks.';
  if(email){
    await queueEmailNotification({
      email,
      subject: `Payment instructions for order ${idv}`,
      body: `Hi ${name},\n\n${summaryLine}\n${paymentNote}\n\nArise & Shine Logistics`,
    });
  }
  await queueNotificationForRole('ADMIN', `Customer order ${idv} awaiting payment`, `${name} (${phone}) placed an order.\n${summaryLine}`);
  await queueNotificationForRole('OPS', `Order ${idv} awaiting payment`, `${name} (${phone}) placed an order.\n${summaryLine}`);
  res.json({
    id: idv,
    status: 'Awaiting Payment',
    perTruck: pricing.perTruck,
    total: pricing.total,
    distanceKm: pricing.distanceKm,
    distanceSource: pricing.distanceSource,
    truckCount: pricing.truckCount,
    sandType: pricing.sandType,
    account: accountResponse,
  });
});
app.post('/api/orders', authRequired, roleRequired('CUSTOMER'), async (req,res)=>{
  const { site, sandType, trucks, distanceKm, dateNeeded } = req.body;
  const pricing = await computeOrderPricing({ site, trucks, sandType, distanceKm });
  const idv = id('ORD');
  await run(`INSERT INTO orders (id, customer_id, name, phone, email, site, sand_type, band_id, per_truck, trucks, distance_km, distance_source, total, date_needed, status, payment_status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      idv,
      req.user.id,
      req.user.name,
      '',
      req.user.email,
      site,
      pricing.sandType,
      'dynamic',
      pricing.perTruck,
      pricing.truckCount,
      pricing.distanceKm,
      pricing.distanceSource,
      pricing.total,
      dateNeeded,
      'Awaiting Payment',
      'PENDING',
      isoNow(),
      isoNow(),
    ]);
  const summaryLine = `Order ${idv} for ${pricing.truckCount} truck(s) of ${pricing.sandType} sand at ${formatCurrency(pricing.perTruck)} per truck (site: ${site}, ~${Math.round(pricing.distanceKm)} km, ${pricing.distanceSource}).`;
  await queueEmailNotification({
    userId: req.user.id,
    email: req.user.email,
    subject: `Payment instructions for order ${idv}`,
    body: `Hi ${req.user.name},\n\n${summaryLine}\nPlease submit your payment confirmation on the portal so dispatch can schedule trucks.\n\nArise & Shine Logistics`,
  });
  await queueNotificationForRole('ADMIN', `Customer order ${idv} awaiting payment`, `${req.user.name} placed order ${idv}.\n${summaryLine}`);
  await queueNotificationForRole('OPS', `Customer order ${idv} awaiting payment`, `${req.user.name} placed order ${idv}.\n${summaryLine}`);
  res.json({ id:idv, status:'Awaiting Payment', perTruck: pricing.perTruck, total: pricing.total, distanceKm: pricing.distanceKm, distanceSource: pricing.distanceSource });
});
app.get('/api/orders/my', authRequired, roleRequired('CUSTOMER'), async (req,res)=>{
  const orders = await q('SELECT * FROM orders WHERE customer_id=? AND (deleted_at IS NULL) ORDER BY created_at DESC',[req.user.id]);
  if(!orders.length){
    return res.json([]);
  }
  const ids = orders.map(o=>o.id);
  const placeholders = ids.map(()=>'?').join(',');
  const assignments = await q(`
    SELECT a.*, t.plate
    FROM assignments a
    LEFT JOIN trucks t ON t.id=a.truck_id
    WHERE a.order_id IN (${placeholders})
    ORDER BY a.scheduled_at DESC
  `, ids);
  const assignmentMap = new Map();
  for(const a of assignments){
    if(!assignmentMap.has(a.order_id)) assignmentMap.set(a.order_id, []);
    assignmentMap.get(a.order_id).push({
      id: a.id,
      truckId: a.truck_id,
      plate: a.plate,
      driverId: a.driver_id,
      status: a.status,
      scheduledAt: a.scheduled_at,
      deliveredAt: a.delivered_at,
      tonnes: Number(a.tonnes||0),
    });
  }
  res.json(orders.map(o=>({
    ...o,
    assignments: assignmentMap.get(o.id) || [],
  })));
});
app.post('/api/orders/:id/payment', authRequired, roleRequired('CUSTOMER','ADMIN','OPS'), async (req,res)=>{
  const order = await g('SELECT * FROM orders WHERE id=? AND (deleted_at IS NULL)',[req.params.id]);
  if(!order) return res.status(404).json({ error:'Order not found' });
  const isAdmin = req.user.role === 'ADMIN' || req.user.role === 'OPS';
  if(!isAdmin && order.customer_id !== req.user.id){
    return res.status(403).json({ error:'You cannot update this order' });
  }
  const { method, reference, message, status } = req.body || {};
  const paymentStatus = isAdmin && status ? status : 'REPORTED';
  let nextOrderStatus = order.status || 'Awaiting Payment';
  if(isAdmin){
    if(status === 'CONFIRMED'){
      nextOrderStatus = 'Received';
    }else if(status){
      nextOrderStatus = status;
    }
  } else {
    if(order.status === 'Awaiting Payment'){
      nextOrderStatus = 'Awaiting Payment Review';
    }
  }
  await run(`UPDATE orders
    SET payment_status=?, payment_method=?, payment_reference=?, payment_message=?, payment_recorded_at=?, status=?, updated_at=?
    WHERE id=?`, [
    paymentStatus,
    method || null,
    reference || null,
    message || null,
    isoNow(),
    nextOrderStatus,
    isoNow(),
    req.params.id,
  ]);
  const summaryLine = `Order ${order.id} (${order.site || 'site TBC'}) - ${order.trucks || 0} truck(s) at ${order.per_truck ? formatCurrency(order.per_truck) : 'rate TBC'} per truck.`;
  if(!isAdmin){
    const reporter = req.user.name || 'Customer';
    const details = `${reporter} reported a payment.\n${summaryLine}\nReference: ${reference || 'n/a'}.`;
    await queueNotificationForRole('ADMIN', `Payment reported for ${order.id}`, details);
    await queueNotificationForRole('OPS', `Payment reported for ${order.id}`, details);
  }else if(paymentStatus === 'CONFIRMED'){
    if(order.email){
      await queueEmailNotification({
        email: order.email,
        subject: `Payment confirmed for order ${order.id}`,
        body: `Hi ${order.name || 'customer'},\n\nWe have confirmed your payment${reference ? ` (reference ${reference})` : ''}.\n${summaryLine}\nDispatch will now schedule trucks.\n\nArise & Shine Logistics`,
      });
    }
  }else if(isAdmin && status && order.email){
    await queueEmailNotification({
      email: order.email,
      subject: `Payment status update for order ${order.id}`,
      body: `Hi ${order.name || 'customer'},\n\nYour payment has been marked as ${status}.\n${summaryLine}\nMessage: ${message || 'n/a'}\n\nArise & Shine Logistics`,
    });
  }
  res.json({ ok:true, paymentStatus, status: nextOrderStatus });
});

app.get('/api/admin/notification-targets', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  let recipients = [];
  if(req.user.role === 'ADMIN'){
    recipients = await q(`SELECT id,name,email,role,telegram_chat_id FROM users WHERE role IN ('ADMIN','OPS') ORDER BY role,name`);
  }else{
    const me = await g('SELECT id,name,email,role,telegram_chat_id FROM users WHERE id=?',[req.user.id]);
    if(me) recipients = [me];
  }
  res.json({
    botConfigured: Boolean((process.env.TELEGRAM_BOT_TOKEN || '').trim()),
    emailConfigured: isEmailConfigured(),
    email: getEmailConfigSummary(),
    recipients: recipients.map((r)=>({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      telegramChatId: r.telegram_chat_id || '',
    })),
  });
});
app.put('/api/admin/notification-targets/:id', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const targetId = Number(req.params.id);
  if(Number.isNaN(targetId)) return res.status(400).json({ error:'Invalid recipient id' });
  const target = await g('SELECT id,name,email,role,telegram_chat_id FROM users WHERE id=?',[targetId]);
  if(!target) return res.status(404).json({ error:'Recipient not found' });
  if(req.user.role !== 'ADMIN' && req.user.id !== targetId){
    return res.status(403).json({ error:'You can only update your own notification settings' });
  }
  const { telegramChatId } = req.body || {};
  const cleaned = typeof telegramChatId === 'string' ? telegramChatId.trim() : '';
  if(cleaned && !/^(-?\d+)$/.test(cleaned)){
    return res.status(400).json({ error:'Telegram chat ID should be numeric (use the number returned by @userinfobot or the -100... group id).' });
  }
  await run('UPDATE users SET telegram_chat_id=? WHERE id=?',[cleaned || null, targetId]);
  const updated = await g('SELECT id,name,email,role,telegram_chat_id FROM users WHERE id=?',[targetId]);
  res.json({
    recipient: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      telegramChatId: updated.telegram_chat_id || '',
    },
  });
});

app.get('/api/admin/notifications', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const limit = Math.min(200, Math.max(1, Number(req.query.limit)||50));
  const statusRaw = typeof req.query.status === 'string' ? req.query.status : '';
  const statuses = statusRaw
    .split(',')
    .map((value)=> value.trim().toUpperCase())
    .filter((value)=> value);
  let sql = 'SELECT * FROM notifications';
  const params = [];
  if(statuses.length){
    sql += ` WHERE status IN (${statuses.map(()=> '?').join(',')})`;
    params.push(...statuses);
  }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  const rows = await q(sql, params);
  res.json(rows);
});
app.patch('/api/admin/notifications/:id', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const { status } = req.body || {};
  const newStatus = status || 'SENT';
  await run('UPDATE notifications SET status=?, sent_at=? WHERE id=?', [newStatus, isoNow(), req.params.id]);
  res.json({ ok:true });
});
app.post('/api/admin/notifications/dispatch', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const limit = Number(req.body?.limit);
  const result = await dispatchPendingNotifications({ limit: Number.isFinite(limit) && limit > 0 ? limit : undefined, force: true });
  res.json({
    ...result,
    emailConfigured: isEmailConfigured(),
    email: getEmailConfigSummary(),
  });
});

// ===== ADMIN USERS =====
app.get('/api/admin/users', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  try{
    const rows = await q('SELECT id,name,email,phone,role,driver_id,created_at FROM users ORDER BY datetime(created_at) DESC');
    const filtered = rows.filter((row)=> TEAM_VISIBLE_ROLES.includes(row.role));
    res.json(filtered.map(mapUserRow));
  }catch(err){
    console.error('Failed to list admin users', err);
    res.status(500).json({ error:'Failed to load user directory' });
  }
});
app.post('/api/admin/users', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const nameRaw = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const emailRaw = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  const phoneRaw = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
  const roleRaw = typeof req.body?.role === 'string' ? req.body.role.trim().toUpperCase() : '';
  const driverIdRaw = req.body?.driverId != null ? String(req.body.driverId).trim() : '';
  if(!nameRaw) return res.status(400).json({ error:'Name is required' });
  if(!emailRaw || !emailRaw.includes('@')) return res.status(400).json({ error:'A valid email is required' });
  if(!TEAM_VISIBLE_ROLES.includes(roleRaw)) return res.status(400).json({ error:'Role must be Admin, Ops, Fuel, or Driver' });
  if(roleRaw === 'DRIVER' && !driverIdRaw) return res.status(400).json({ error:'Driver ID is required for driver accounts' });
  try{
    const email = emailRaw.toLowerCase();
    const existing = await findByEmail(email);
    if(existing) return res.status(409).json({ error:'An account already exists for this email' });
    if(roleRaw === 'DRIVER'){
      const driver = await g('SELECT id FROM drivers WHERE id=?',[driverIdRaw]);
      if(!driver) return res.status(400).json({ error:'Driver record not found' });
      const assigned = await g('SELECT id FROM users WHERE driver_id=?',[driverIdRaw]);
      if(assigned) return res.status(400).json({ error:'Another user is already linked to this driver' });
    }
    const plainPassword = generateTemporaryPassword();
    const now = isoNow();
    const insert = await run(
      'INSERT INTO users (email,name,phone,role,password_hash,driver_id,created_at) VALUES (?,?,?,?,?,?,?)',
      [email, nameRaw, phoneRaw, roleRaw, hash(plainPassword), roleRaw === 'DRIVER' ? driverIdRaw : null, now]
    );
    const created = await g('SELECT id,name,email,phone,role,driver_id,created_at FROM users WHERE id=?',[insert.lastID]);
    res.status(201).json({ user: mapUserRow(created), temporaryPassword: plainPassword });
  }catch(err){
    if(err?.code === 'SQLITE_CONSTRAINT'){
      return res.status(409).json({ error:'An account already exists for this email' });
    }
    console.error('Failed to create admin user', err);
    res.status(500).json({ error:'Failed to create user' });
  }
});
app.patch('/api/admin/users/:id', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const userId = Number.parseInt(req.params.id, 10);
  if(!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error:'Invalid user ID' });
  const roleRaw = typeof req.body?.role === 'string' ? req.body.role.trim().toUpperCase() : undefined;
  const driverIdProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'driverId');
  let driverIdRaw = undefined;
  if(driverIdProvided){
    driverIdRaw = req.body?.driverId === null ? null : String(req.body?.driverId || '').trim();
  }
  if(roleRaw && !ADMIN_ASSIGNABLE_ROLES.includes(roleRaw)) return res.status(400).json({ error:'Unsupported role' });
  try{
    const current = await g('SELECT id,name,email,phone,role,driver_id,created_at FROM users WHERE id=?',[userId]);
    if(!current) return res.status(404).json({ error:'User not found' });
    const targetRole = roleRaw || current.role;
    if(!TEAM_VISIBLE_ROLES.includes(targetRole)){
      return res.status(400).json({ error:'Role must be Admin, Ops, Fuel, or Driver' });
    }
    let nextDriverId = current.driver_id || null;
    if(targetRole === 'DRIVER'){
      const driverId = driverIdProvided ? (driverIdRaw === null ? '' : (driverIdRaw || '')) : (current.driver_id || '');
      if(!driverId) return res.status(400).json({ error:'Driver ID is required for driver accounts' });
      const driver = await g('SELECT id FROM drivers WHERE id=?',[driverId]);
      if(!driver) return res.status(400).json({ error:'Driver record not found' });
      const assigned = await g('SELECT id FROM users WHERE driver_id=? AND id<>?',[driverId, userId]);
      if(assigned) return res.status(400).json({ error:'Another user is already linked to this driver' });
      nextDriverId = driverId;
    }else{
      nextDriverId = null;
    }
    const updates = [];
    const params = [];
    if(roleRaw && targetRole !== current.role){
      updates.push('role=?');
      params.push(targetRole);
    }
    if(nextDriverId !== (current.driver_id || null)){
      updates.push('driver_id=?');
      params.push(nextDriverId);
    }
    if(!updates.length){
      return res.json({ user: mapUserRow(current), unchanged: true });
    }
    await run(`UPDATE users SET ${updates.join(', ')} WHERE id=?`, [...params, userId]);
    const updated = await g('SELECT id,name,email,phone,role,driver_id,created_at FROM users WHERE id=?',[userId]);
    res.json({ user: mapUserRow(updated) });
  }catch(err){
    console.error('Failed to update admin user', err);
    res.status(500).json({ error:'Failed to update user' });
  }
});
app.post('/api/admin/users/:id/reset-password', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const userId = Number.parseInt(req.params.id, 10);
  if(!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error:'Invalid user ID' });
  try{
    const target = await g('SELECT id,email FROM users WHERE id=?',[userId]);
    if(!target) return res.status(404).json({ error:'User not found' });
    const provided = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    const plainPassword = provided && provided.length >= 8 ? provided : generateTemporaryPassword();
    await run('UPDATE users SET password_hash=? WHERE id=?',[hash(plainPassword), userId]);
    res.json({ ok:true, temporaryPassword: plainPassword });
  }catch(err){
    console.error('Failed to reset user password', err);
    res.status(500).json({ error:'Failed to reset password' });
  }
});

// Admin/Ops orders & manual create
app.get('/api/admin/orders', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const { assigned } = req.query;
  let sql = `SELECT o.*, (SELECT COUNT(*) FROM assignments a WHERE a.order_id=o.id) as assigns FROM orders o WHERE o.deleted_at IS NULL ORDER BY o.created_at DESC`;
  const rows = await q(sql);
  let r = rows;
  if(assigned==='true') r = rows.filter(x=>x.assigns>0);
  if(assigned==='false') r = rows.filter(x=>x.assigns===0);
  res.json(r);
});
app.post('/api/admin/orders', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const { name, phone, email, site, sandType, trucks, distanceKm, dateNeeded, customerId, perTruckOverride } = req.body;
  const pricing = await computeOrderPricing({ site, trucks, sandType, distanceKm });
  const perTruck = perTruckOverride ? Number(perTruckOverride) : pricing.perTruck;
  const truckCount = Math.max(1, Number(trucks) || pricing.truckCount || 1);
  const total = perTruck * truckCount;
  const idv = id('ORD');
  await run(`INSERT INTO orders (id, customer_id, name, phone, email, site, sand_type, band_id, per_truck, trucks, distance_km, distance_source, total, date_needed, status, payment_status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      idv,
      customerId||null,
      name||'',
      phone||'',
      email||'',
      site,
      pricing.sandType,
      'dynamic',
      perTruck,
      truckCount,
      pricing.distanceKm,
      pricing.distanceSource,
      total,
      dateNeeded,
      'Awaiting Payment',
      'PENDING',
      isoNow(),
      isoNow(),
    ]);
  const summaryLine = `Order ${idv} for ${truckCount} truck(s) of ${pricing.sandType} sand at ${formatCurrency(perTruck)} per truck (site: ${site}, ~${Math.round(pricing.distanceKm)} km, ${pricing.distanceSource}).`;
  if(email){
    await queueEmailNotification({
      email,
      subject: `Arise & Shine order ${idv} created`,
      body: `Hi ${name || 'customer'},\n\n${summaryLine}\nPlease share payment confirmation so dispatch can mobilise trucks.\n\nArise & Shine Logistics`,
    });
  }
  if(customerId){
    const customerUser = await g('SELECT id,email,name FROM users WHERE id=?',[customerId]);
    if(customerUser?.email){
      await queueEmailNotification({
        userId: customerUser.id,
        email: customerUser.email,
        subject: `Order ${idv} placed on your account`,
        body: `Hi ${customerUser.name || 'customer'},\n\n${summaryLine}\nPayment status is Awaiting Payment. Please confirm once settled.\n\nArise & Shine Logistics`,
      });
    }
  }
  await queueNotificationForRole('OPS', `Order ${idv} awaiting payment`, `${name || 'Customer'} (${phone || 'n/a'}) created order ${idv}.\n${summaryLine}`);
  res.json({ id:idv, perTruck, total, distanceKm: pricing.distanceKm, distanceSource: pricing.distanceSource });
});

app.patch('/api/admin/orders/:id', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const orderId = req.params.id;
  const order = await g('SELECT * FROM orders WHERE id=? AND deleted_at IS NULL',[orderId]);
  if(!order) return res.status(404).json({ error:'Order not found' });
  const { paymentStatus, status, paymentMethod, paymentReference, paymentMessage, dateNeeded, cancelReason } = req.body || {};
  const updates = [];
  const params = [];
  let nextStatus = order.status;
  let isCancelling = false;
  if(typeof paymentStatus === 'string'){
    const value = paymentStatus.trim().toUpperCase();
    if(!value) return res.status(400).json({ error:'Payment status cannot be empty.' });
    if(value.length > 32) return res.status(400).json({ error:'Payment status is too long.' });
    updates.push('payment_status=?');
    params.push(value);
  }
  if(typeof status === 'string'){
    const value = status.trim();
    if(!value) return res.status(400).json({ error:'Order status cannot be empty.' });
    if(value.length > 64) return res.status(400).json({ error:'Order status is too long.' });
    updates.push('status=?');
    params.push(value);
    nextStatus = value;
    isCancelling = value.toLowerCase() === 'cancelled';
  }else if((order.status || '').toLowerCase() === 'cancelled'){
    nextStatus = order.status;
    isCancelling = true;
  }
  if(typeof paymentMethod === 'string'){
    updates.push('payment_method=?');
    params.push(paymentMethod.trim() || null);
  }
  if(typeof paymentReference === 'string'){
    updates.push('payment_reference=?');
    params.push(paymentReference.trim() || null);
  }
  if(typeof paymentMessage === 'string'){
    updates.push('payment_message=?');
    params.push(paymentMessage.trim() || null);
  }
  if(typeof dateNeeded === 'string'){
    const trimmed = dateNeeded.trim();
    updates.push('date_needed=?');
    params.push(trimmed || null);
  }
  if(isCancelling){
    const reasonValue = typeof cancelReason === 'string' ? cancelReason.trim() : (order.cancel_reason || '').trim();
    if(!reasonValue){
      return res.status(400).json({ error:'Provide a reason for cancelling this order.' });
    }
    updates.push('cancel_reason=?');
    params.push(reasonValue);
    updates.push('payment_status=?');
    params.push('CANCELLED');
    updates.push('per_truck=?');
    params.push(0);
    updates.push('total=?');
    params.push(0);
  }else if(typeof cancelReason === 'string'){
    updates.push('cancel_reason=?');
    params.push(cancelReason.trim() || null);
  }
  if(!updates.length){
    return res.status(400).json({ error:'No updates provided.' });
  }
  updates.push('updated_at=?');
  params.push(isoNow());
  params.push(orderId);
  await run(`UPDATE orders SET ${updates.join(', ')} WHERE id=?`, params);
  if(isCancelling){
    await run('UPDATE assignments SET status=? WHERE order_id=? AND status!=?',[ 'Cancelled', orderId, 'Cancelled' ]);
  }
  const updated = await g('SELECT * FROM orders WHERE id=?',[orderId]);
  res.json({ ok:true, order: updated });
});

app.delete('/api/admin/orders/:id', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const orderId = req.params.id;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if(reason.length < 5){
    return res.status(400).json({ error:'Provide a brief reason (at least 5 characters) for deleting the order.' });
  }
  const existing = await g('SELECT id FROM orders WHERE id=? AND deleted_at IS NULL',[orderId]);
  if(!existing) return res.status(404).json({ error:'Order not found' });
  const now = isoNow();
  await run(`UPDATE orders SET deleted_at=?, deleted_reason=?, deleted_by=?, status=?, updated_at=? WHERE id=?`, [now, reason, req.user.id, 'Cancelled', now, orderId]);
  await run(`UPDATE assignments SET status='Cancelled' WHERE order_id=? AND status!='Cancelled'`, [orderId]);
  res.json({ ok:true });
});

async function buildDashboardTripStats(dateStr){
  const MIN_IDLE_MINUTES = 10;
  const MIN_DISTANCE_KM = 2;
  const rowsRaw = await q(
    `SELECT truck_id as truckId, plate, lat, lng, speed, captured_at as capturedAt, address
     FROM telemetry_snapshots
     WHERE date(captured_at) = date(?)
     ORDER BY truck_id, captured_at`,
    [dateStr]
  );
  const grouped = new Map();
  rowsRaw.forEach((row) => {
    if(!row.truckId) return;
    if(!grouped.has(row.truckId)) grouped.set(row.truckId, []);
    grouped.get(row.truckId).push(row);
  });
  const result = [];
  for(const [truckId, list] of grouped.entries()){
    const sorted = [...list].sort((a,b) => new Date(a.capturedAt) - new Date(b.capturedAt));
    const plate = sorted.find((p) => p.plate)?.plate || truckId;
    const idleWindows = [];
    let idleStart = null;
    let idleCoords = [];
    let lastTs = null;
    for(const row of sorted){
      const ts = Date.parse(row.capturedAt);
      const isStationary = Number(row.speed||0) <= TELEMETRY_IDLE_SPEED_KPH;
      if(isStationary){
        if(idleStart === null) idleStart = ts;
        idleCoords.push(row);
      } else if(idleStart !== null){
        const durationMin = (ts - idleStart) / 60000;
        if(durationMin >= MIN_IDLE_MINUTES){
          idleWindows.push({
            endAt: new Date(ts).toISOString(),
            startAt: new Date(idleStart).toISOString(),
            lat: idleCoords.reduce((s,p) => s + Number(p.lat||0), 0) / idleCoords.length,
            lng: idleCoords.reduce((s,p) => s + Number(p.lng||0), 0) / idleCoords.length,
            address: idleCoords.find((p) => p.address)?.address || null,
          });
        }
        idleStart = null;
        idleCoords = [];
      }
      lastTs = ts;
    }
    if(idleStart !== null && lastTs){
      const durationMin = (lastTs - idleStart) / 60000;
      if(durationMin >= MIN_IDLE_MINUTES){
        idleWindows.push({
          endAt: new Date(lastTs).toISOString(),
          startAt: new Date(idleStart).toISOString(),
          lat: idleCoords.reduce((s,p) => s + Number(p.lat||0), 0) / idleCoords.length,
          lng: idleCoords.reduce((s,p) => s + Number(p.lng||0), 0) / idleCoords.length,
          address: idleCoords.find((p) => p.address)?.address || null,
        });
      }
    }
    const trips = [];
    let totalKm = 0;
    let totalDurationMin = 0;
    for(let i = 0; i < idleWindows.length - 1; i++){
      const from = idleWindows[i];
      const to   = idleWindows[i+1];
      if(!Number.isFinite(from.lat) || !Number.isFinite(from.lng) || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) continue;
      const distanceKm = haversineDistanceKm(from.lat, from.lng, to.lat, to.lng);
      if(!Number.isFinite(distanceKm) || distanceKm < MIN_DISTANCE_KM) continue;
      const startTs = new Date(from.endAt).getTime();
      const endTs   = new Date(to.startAt).getTime();
      const durationMin = Math.round(Math.max(0, (endTs - startTs) / 60000));
      const fromLabel = describeCoordinateLocation({ lat: from.lat, lng: from.lng, address: from.address });
      const toLabel   = describeCoordinateLocation({ lat: to.lat,   lng: to.lng,   address: to.address });
      trips.push({
        startTime:   formatShortDateTime(from.endAt),
        endTime:     formatShortDateTime(to.startAt),
        durationMin,
        distanceKm:  Number(distanceKm.toFixed(1)),
        route:       buildRouteLabel(fromLabel, toLabel),
      });
      totalKm += distanceKm;
      totalDurationMin += durationMin;
    }
    if(trips.length > 0){
      result.push({
        truckId,
        plate,
        tripCount: trips.length,
        totalKm: Number(totalKm.toFixed(1)),
        totalDurationMin,
        trips,
      });
    }
  }
  result.sort((a,b) => b.tripCount - a.tripCount);
  return result;
}

app.get('/api/admin/dashboard', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const today = new Date().toISOString().slice(0,10);
  const [truckSpeedStats, speedingAlertsRaw, leaderboard] = await Promise.all([
    q(`SELECT truck_id as truckId, MAX(plate) as plate,
              MAX(speed) as maxSpeed,
              MAX(captured_at) as lastCapturedAt
       FROM telemetry_snapshots
       WHERE datetime(captured_at) >= datetime('now', '-24 hours')
         AND speed IS NOT NULL AND speed > 0
       GROUP BY truck_id
       ORDER BY maxSpeed DESC`),
    q(`SELECT truck_id as truckId, alert_type as alertType, severity, summary, raw, created_at as createdAt
       FROM telemetry_ai_alerts
       WHERE datetime(created_at) >= datetime('now', '-24 hours')
         AND alert_type = 'SPEEDING'
       ORDER BY datetime(created_at) DESC
       LIMIT 15`),
    buildDriverLeaderboard(7),
  ]);
  const [tripStats, fleetTelemetry] = await Promise.all([
    buildDashboardTripStats(today),
    fetchTelemetryData().catch(() => []),
  ]);
  const sn = (s='') => s.toLowerCase();
  const fleetLive = {
    moving:  fleetTelemetry.filter(t => sn(t.status).includes('moving') || sn(t.status).includes('transit')).length,
    idle:    fleetTelemetry.filter(t => sn(t.status).includes('idle')).length,
    stopped: fleetTelemetry.filter(t => sn(t.status).includes('stop') || sn(t.status).includes('offline') || sn(t.status).includes('parked')).length,
    total:   fleetTelemetry.length,
  };
  const speedingAlerts = speedingAlertsRaw.map(row => {
    const raw = safeParseJSON(row.raw) || {};
    return {
      truckId: row.truckId,
      plate: raw.plate || raw.truckPlate || raw.vehiclePlate || row.truckId,
      speed: extractSpeedFromAlert({ raw }),
      limit: Number(raw.limitKph ?? TELEMETRY_SPEED_ALERT_KPH),
      location: extractLocationLabel(raw, row.summary || ''),
      driver: formatDriverLabel(raw),
      createdAt: row.createdAt,
      summary: row.summary || '',
    };
  });
  res.json({
    tripStats,
    truckSpeedStats: truckSpeedStats.map(r=>({ truckId:r.truckId, plate:r.plate||r.truckId, maxSpeed:Number(r.maxSpeed||0), lastCapturedAt:r.lastCapturedAt||null })),
    speedingAlerts,
    fleetLive,
    topDrivers: leaderboard.slice(0,3),
  });
});

// ===== ASSIGNMENTS (auto stock OUT) =====
app.get('/api/admin/orders/:id/assignments', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const rows = await q('SELECT * FROM assignments WHERE order_id=?',[req.params.id]);
  res.json(rows);
});
app.post('/api/admin/orders/:id/assignments', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const { truckId, driverId, tonnes } = req.body;
  const t = await g('SELECT * FROM trucks WHERE id=?',[truckId]);
  if(!t) return res.status(400).json({ error:'Truck not found' });
  const order = await g('SELECT sand_type,status FROM orders WHERE id=? AND (deleted_at IS NULL)',[req.params.id]);
  if(!order) return res.status(404).json({ error:'Order not found' });
  if((order.status || '').toLowerCase() === 'cancelled'){
    return res.status(400).json({ error:'Cannot assign a cancelled order.' });
  }
  const category = (order?.sand_type || 'coarse').toLowerCase();
  const tn = Number(tonnes) || Number(t.capacity_t);
  const aid = id('ASN');
  await run('INSERT INTO assignments (id,order_id,truck_id,driver_id,status,scheduled_at,tonnes) VALUES (?,?,?,?,?,?,?)',[aid, req.params.id, truckId, driverId||null, 'Scheduled', new Date().toISOString(), tn]);
  const truckUnits = tn > 0 ? (tn / TRUCK_UNIT_TONNES) : 1;
  const weightForOut = Number(tonnes);
  const adjustmentExtras = Number.isFinite(weightForOut) && weightForOut > 0 ? { weightTonnes: weightForOut } : undefined;
  await adjustStock('OUT', truckUnits, category, `Assignment ${aid}`, req.params.id, truckId, adjustmentExtras);
  if(driverId){
    const driver = await g('SELECT id,name,email FROM drivers WHERE id=?',[driverId]);
    if(driver?.email){
      await queueEmailNotification({
        email: driver.email,
        subject: `New load assignment ${aid}`,
        body: `Hi ${driver.name || 'driver'},\n\nYou have been assigned order ${req.params.id} using truck ${truckId}.\nTonnes: ${tn}. Please log into the driver portal for details.\n\nArise & Shine Logistics`,
      });
    }
  }
  res.json({ id:aid });
});
app.patch('/api/admin/assignments/:aid', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const { status } = req.body;
  await run('UPDATE assignments SET status=?, delivered_at=? WHERE id=?',[status||'Scheduled', status==='Delivered'? new Date().toISOString(): null, req.params.aid]);
  res.json({ ok:true });
});

// ===== STOCK & TX =====
async function getStock() {
  const row = await g('SELECT id, yard_name, tonnes, trucks_coarse, trucks_smooth, updated_at FROM stock WHERE id=1');
  const coarse = Number(row?.trucks_coarse ?? 0);
  const smooth = Number(row?.trucks_smooth ?? 0);
  const totalTrucks = coarse + smooth;
  const totalTonnes = totalTrucks * TRUCK_UNIT_TONNES;
  return {
    id: row?.id || 1,
    yard_name: row?.yard_name || 'Main Yard',
    tonnes: totalTonnes,
    trucks_coarse: coarse,
    trucks_smooth: smooth,
    trucks_total: totalTrucks,
    tonnes_coarse: coarse * TRUCK_UNIT_TONNES,
    tonnes_smooth: smooth * TRUCK_UNIT_TONNES,
    unit_tonnes: TRUCK_UNIT_TONNES,
    updated_at: row?.updated_at || null,
  };
}
async function upsertStockCounts(coarse, smooth) {
  const safeCoarse = Math.max(0, Number(coarse) || 0);
  const safeSmooth = Math.max(0, Number(smooth) || 0);
  const totalTonnes = (safeCoarse + safeSmooth) * TRUCK_UNIT_TONNES;
  await run(
    `INSERT INTO stock (id, yard_name, tonnes, trucks_coarse, trucks_smooth, updated_at)
     VALUES (1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       yard_name=excluded.yard_name,
       tonnes=excluded.tonnes,
       trucks_coarse=excluded.trucks_coarse,
       trucks_smooth=excluded.trucks_smooth,
       updated_at=excluded.updated_at`,
    ['Main Yard', totalTonnes, safeCoarse, safeSmooth, isoNow()]
  );
  return getStock();
}
async function adjustStock(kind, trucks, category='coarse', reason, order_id=null, truck_id=null, extras={}){
  const units = Number(trucks);
  if(!Number.isFinite(units)) throw new Error('Invalid truck units');
  const current = await getStock();
  let coarse = Number(current.trucks_coarse || 0);
  let smooth = Number(current.trucks_smooth || 0);
  const delta = kind === 'IN' ? units : -units;
  if((category || '').toLowerCase() === 'smooth'){
    smooth += delta;
  } else {
    coarse += delta;
  }
  const updated = await upsertStockCounts(coarse, smooth);
  const weightCandidate = Number(extras?.weightTonnes);
  const weightTonnes = Number.isFinite(weightCandidate) && weightCandidate > 0 ? weightCandidate : units * TRUCK_UNIT_TONNES;
  const costCandidate = Number(extras?.costPerTonne);
  const costPerTonne = Number.isFinite(costCandidate) && costCandidate > 0 ? costCandidate : null;
  const photoPath = typeof extras?.photoPath === 'string' && extras.photoPath.trim() ? extras.photoPath.trim() : null;
  const txId = id('STX');
  await run(
    'INSERT INTO stock_tx (id,kind,tonnes,trucks,category,reason,order_id,truck_id,weight_tonnes,cost_per_tonne,photo_path,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      txId,
      kind,
      weightTonnes,
      units,
      (category || 'coarse').toLowerCase(),
      reason || '',
      order_id,
      truck_id,
      weightTonnes,
      costPerTonne,
      photoPath,
      isoNow(),
    ]
  );
  return { stock: updated, stockTxId: txId };
}

app.get('/api/admin/stock', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=> res.json(await getStock()));
app.get('/api/admin/stock/tx', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=> res.json(await q('SELECT * FROM stock_tx ORDER BY created_at DESC LIMIT 200')));
app.post('/api/admin/stock/receipt', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const { truckId, tonnes, trucks, category, costPerTonne, description, weightTonnes, photoData } = req.body;
  const truckCode = typeof truckId === 'string' ? truckId.trim() : String(truckId || '').trim();
  if(!truckCode){
    return res.status(400).json({ error:'Truck selection is required.' });
  }
  const categoryRaw = typeof category === 'string' ? category.trim().toLowerCase() : '';
  if(!categoryRaw){
    return res.status(400).json({ error:'Select the sand category delivered.' });
  }
  if(!['coarse','smooth'].includes(categoryRaw)){
    return res.status(400).json({ error:'Sand category must be coarse or smooth.' });
  }
  const costValue = Number(costPerTonne);
  if(!Number.isFinite(costValue) || costValue <= 0){
    return res.status(400).json({ error:'KES per tonne must be greater than zero.' });
  }
  let units = Number(trucks);
  if(!Number.isFinite(units) || units <= 0){
    const tonnesValue = Number(tonnes);
    if(!Number.isFinite(tonnesValue) || tonnesValue <= 0){
      return res.status(400).json({ error:'Provide the number of trucks delivering stock.' });
    }
    units = tonnesValue / TRUCK_UNIT_TONNES;
  }
  const weightValue = Number(weightTonnes);
  if(!Number.isFinite(weightValue) || weightValue <= 0){
    return res.status(400).json({ error:'Captured weight (tonnes) is required.' });
  }
  const photoRaw = typeof photoData === 'string' ? photoData.trim() : '';
  if(!photoRaw){
    return res.status(400).json({ error:'Upload the weighbridge photo.' });
  }
  const photoPath = await saveImageFromDataUrl(photoRaw);
  if(!photoPath){
    return res.status(400).json({ error:'Weighbridge photo could not be saved. Try a smaller image.' });
  }
  const reasonText = typeof description === 'string' && description.trim()
    ? description.trim()
    : `Truck ${truckCode} stock receipt`;
  const { stock: next, stockTxId } = await adjustStock('IN', units, categoryRaw, reasonText, null, truckCode, {
    weightTonnes: weightValue,
    costPerTonne: costValue,
    photoPath,
  });
  const totalTonnes = weightValue;
  const costAmount = costValue * totalTonnes;
  await insertCostRecord({
    id: id('CST'),
    truckId: truckCode,
    driverId: null,
    orderId: null,
    type: 'STOCK_PURCHASE',
    amount: costAmount,
    description: `Stock purchase @ ${formatCurrency(costValue)} per tonne (${totalTonnes.toFixed(2)} t)`,
    incurredAtIso: isoNow(),
    createdBy: req.user.id,
  });
  queueImageAudit({
    entityType: 'stock_receipt',
    entityId: stockTxId,
    imagePath: photoPath,
    expected: {
      truckId: truckCode,
      weightTonnes: weightValue,
      trucksReported: units,
      costPerTonne: costValue,
    },
    description: 'Weighbridge ticket should reflect tonnage and truck details.',
  });
  res.json({ ok:true, stock: next });
});
app.patch('/api/admin/stock/tx/:id', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const tx = await g('SELECT * FROM stock_tx WHERE id=?',[req.params.id]);
  if(!tx) return res.status(404).json({ error:'Stock transaction not found' });
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if(!reason){
    return res.status(400).json({ error:'Reason is required' });
  }
  await run('UPDATE stock_tx SET reason=? WHERE id=?',[reason, tx.id]);
  const updated = await g('SELECT * FROM stock_tx WHERE id=?',[tx.id]);
  res.json({ ok:true, tx: updated });
});

// ===== COSTS =====
app.get('/api/admin/costs', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const params = [];
  const filters = [];
  const { type, truckId, driverId, q: query } = req.query || {};
  if(type){
    filters.push('type=?');
    params.push(String(type).trim());
  }
  if(truckId){
    filters.push('truck_id=?');
    params.push(String(truckId).trim());
  }
  if(driverId){
    filters.push('driver_id=?');
    params.push(String(driverId).trim());
  }
  if(query){
    filters.push('(description LIKE ? OR id LIKE ?)');
    params.push(`%${query}%`, `%${query}%`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = await q(`SELECT * FROM costs ${where} ORDER BY incurred_at DESC LIMIT 500`, params);
  res.json(rows);
});
app.post('/api/admin/costs', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const { truckId, driverId, orderId, type, amount, description, incurredAt } = req.body;
  const driverCode = typeof driverId === 'string' ? driverId.trim() : String(driverId || '').trim();
  let truckCode = typeof truckId === 'string' ? truckId.trim() : String(truckId || '').trim();
  if(!type || typeof type !== 'string'){
    return res.status(400).json({ error:'Cost type is required.' });
  }
  if(!truckCode && driverCode){
    const linkedTruck = await g('SELECT id FROM trucks WHERE primary_driver_id=? LIMIT 1',[driverCode]);
    if(linkedTruck?.id){
      truckCode = linkedTruck.id;
    }
  }
  if(!truckCode){
    return res.status(400).json({ error:'Select the truck this cost relates to.' });
  }
  const amountValue = Number(amount);
  if(!Number.isFinite(amountValue) || amountValue <= 0){
    return res.status(400).json({ error:'Amount must be greater than zero.' });
  }
  const descriptionValue = typeof description === 'string' ? description.trim() : '';
  if(!descriptionValue){
    return res.status(400).json({ error:'Description is required.' });
  }
  const incurred = normaliseIsoDate(incurredAt);
  const overrideDuplicate = req.body?.overrideDuplicate === true;
  const duplicateOfInput = typeof req.body?.duplicateOf === 'string' ? req.body.duplicateOf.trim() : null;
  const existingDuplicate = await findPotentialDuplicateCost({
    truckId: truckCode,
    type,
    amount: amountValue,
    incurredAtIso: incurred,
  });
  if(existingDuplicate && !overrideDuplicate){
    return res.status(409).json({ duplicate:true, existing: existingDuplicate, message:'Potential duplicate cost detected.' });
  }
  const duplicateTarget = overrideDuplicate
    ? duplicateOfInput || existingDuplicate?.duplicate_of || existingDuplicate?.id || null
    : null;
  const costId = id('CST');
  await insertCostRecord({
    id: costId,
    truckId: truckCode,
    driverId: driverCode || null,
    orderId: orderId || null,
    type,
    amount: amountValue,
    description: descriptionValue,
    incurredAtIso: incurred,
    createdBy: req.user.id,
    isDuplicate: Boolean(duplicateTarget),
    duplicateOf: duplicateTarget,
    confirmedBy: duplicateTarget ? req.user.id : null,
  });
  res.status(201).json({ ok:true, id: costId, duplicate: Boolean(duplicateTarget) });
});
app.patch('/api/admin/costs/:id', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const cost = await g('SELECT * FROM costs WHERE id=?',[req.params.id]);
  if(!cost) return res.status(404).json({ error:'Cost record not found' });
  const { truckId, driverId, type, amount, description, incurredAt } = req.body || {};
  const updates = [];
  const params = [];
  if(truckId !== undefined){
    const truckCode = typeof truckId === 'string' ? truckId.trim() : String(truckId || '').trim();
    if(!truckCode){
      return res.status(400).json({ error:'Select the truck this cost relates to.' });
    }
    updates.push('truck_id=?');
    params.push(truckCode);
  }
  if(type !== undefined){
    if(!type || typeof type !== 'string'){
      return res.status(400).json({ error:'Cost type is required.' });
    }
    updates.push('type=?');
    params.push(type);
  }
  if(amount !== undefined){
    const amountValue = Number(amount);
    if(!Number.isFinite(amountValue) || amountValue <= 0){
      return res.status(400).json({ error:'Amount must be greater than zero.' });
    }
    updates.push('amount=?');
    params.push(amountValue);
  }
  if(description !== undefined){
    const descriptionValue = typeof description === 'string' ? description.trim() : '';
    if(!descriptionValue){
      return res.status(400).json({ error:'Description is required.' });
    }
    updates.push('description=?');
    params.push(descriptionValue);
  }
  if(incurredAt !== undefined){
    const incurred = incurredAt ? new Date(incurredAt).toISOString() : new Date().toISOString();
    updates.push('incurred_at=?');
    params.push(incurred);
  }
  if(driverId !== undefined){
    const driverCode = typeof driverId === 'string' ? driverId.trim() : String(driverId || '').trim();
    updates.push('driver_id=?');
    params.push(driverCode || null);
    if(driverCode){
      const nextTypeRaw = type !== undefined ? type : cost.type;
      const isSalary = typeof nextTypeRaw === 'string' && nextTypeRaw.toUpperCase() === 'SALARY';
      if(isSalary && truckId === undefined && !updates.some((col)=> col === 'truck_id=?')){
        const linkedTruck = await g('SELECT id FROM trucks WHERE primary_driver_id=? LIMIT 1',[driverCode]);
        if(linkedTruck?.id){
          updates.push('truck_id=?');
          params.push(linkedTruck.id);
        }
      }
    }
  }
  if(!updates.length){
    return res.json({ ok:true });
  }
  params.push(req.params.id);
  await run(`UPDATE costs SET ${updates.join(', ')} WHERE id=?`, params);
  const updated = await g('SELECT * FROM costs WHERE id=?',[req.params.id]);
  res.json({ ok:true, cost: updated });
});

app.get('/api/admin/audit/duplicates', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const entity = normaliseAuditEntity(req.query.entity || 'all');
  const truckFilter = typeof req.query.truckId === 'string' && req.query.truckId.trim() ? req.query.truckId.trim() : null;
  const typeFilterRaw = typeof req.query.type === 'string' && req.query.type.trim() ? req.query.type.trim() : null;
  const typeFilter = typeFilterRaw ? typeFilterRaw.toUpperCase() : null;
  const statusRaw = typeof req.query.status === 'string' && req.query.status.trim() ? req.query.status.trim().toLowerCase() : null;
  const validStatuses = new Set(['pending','reviewed','voided']);
  const statusFilter = statusRaw && validStatuses.has(statusRaw) ? statusRaw : null;
  const fromIso = isoOrNull(req.query.from);
  const toIso = isoOrNull(req.query.to);
  const limitNum = Math.min(500, Math.max(1, Number(req.query.limit) || 200));

  const results = [];

  if(entity === 'all' || entity === 'cost'){
    const filters = ['(c.is_duplicate=1 OR c.duplicate_of IS NOT NULL)'];
    const params = [];
    if(truckFilter){
      filters.push('c.truck_id = ?');
      params.push(truckFilter);
    }
    if(typeFilter){
      filters.push('UPPER(c.type) = ?');
      params.push(typeFilter);
    }
    if(fromIso){
      filters.push('datetime(c.incurred_at) >= datetime(?)');
      params.push(fromIso);
    }
    if(toIso){
      filters.push('datetime(c.incurred_at) <= datetime(?)');
      params.push(toIso);
    }
    if(statusFilter === 'pending'){
      filters.push('c.voided_at IS NULL');
      filters.push('c.reviewed_at IS NULL');
    }else if(statusFilter === 'reviewed'){
      filters.push('c.reviewed_at IS NOT NULL');
      filters.push('c.voided_at IS NULL');
    }else if(statusFilter === 'voided'){
      filters.push('c.voided_at IS NOT NULL');
    }
    const sql = `${AUDIT_COST_BASE} WHERE ${filters.join(' AND ')} ORDER BY datetime(c.incurred_at) DESC, datetime(c.created_at) DESC LIMIT ?`;
    const costRows = await q(sql, [...params, limitNum]);
    results.push(...costRows.map(mapAuditCostRow).filter(Boolean));
  }

  if(entity === 'all' || entity === 'fuel'){
    const allowFuel = !typeFilter || typeFilter === 'FUEL' || typeFilter === 'FUEL_LOG';
    if(allowFuel){
      const filters = ['(f.is_duplicate=1 OR f.duplicate_of IS NOT NULL)'];
      const params = [];
      if(truckFilter){
        filters.push('f.truck_id = ?');
        params.push(truckFilter);
      }
      if(fromIso){
        filters.push('datetime(f.captured_at) >= datetime(?)');
        params.push(fromIso);
      }
      if(toIso){
        filters.push('datetime(f.captured_at) <= datetime(?)');
        params.push(toIso);
      }
      if(statusFilter === 'pending'){
        filters.push('f.voided_at IS NULL');
        filters.push('f.reviewed_at IS NULL');
      }else if(statusFilter === 'reviewed'){
        filters.push('f.reviewed_at IS NOT NULL');
        filters.push('f.voided_at IS NULL');
      }else if(statusFilter === 'voided'){
        filters.push('f.voided_at IS NOT NULL');
      }
      const sql = `${AUDIT_FUEL_BASE} WHERE ${filters.join(' AND ')} ORDER BY datetime(f.captured_at) DESC, datetime(f.created_at) DESC LIMIT ?`;
      const fuelRows = await q(sql, [...params, limitNum]);
      results.push(...fuelRows.map(mapAuditFuelRow).filter(Boolean));
    }
  }

  const sorted = results.sort((a,b)=>{
    const aTime = a?.eventAt ? new Date(a.eventAt).getTime() : 0;
    const bTime = b?.eventAt ? new Date(b.eventAt).getTime() : 0;
    return bTime - aTime;
  });
  res.json(sorted.slice(0, limitNum));
});

app.post('/api/admin/audit/duplicates/:entity/:id/review', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const entity = normaliseAuditEntity(req.params.entity);
  if(entity === 'all') return res.status(400).json({ error:'Specify either cost or fuel entity.' });
  const targetId = req.params.id;
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  const record = await fetchDuplicateSource(entity, targetId);
  if(!record) return res.status(404).json({ error:'Duplicate record not found.' });
  if(record.voided_at){
    return res.status(400).json({ error:'Record already voided; cannot mark as reviewed.' });
  }
  const now = isoNow();
  if(entity === 'cost'){
    await run('UPDATE costs SET reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?',[req.user.id, now, note || null, targetId]);
  }else if(entity === 'fuel'){
    await run('UPDATE fuel_logs SET reviewed_by=?, reviewed_at=?, review_note=? WHERE id=?',[req.user.id, now, note || null, targetId]);
  }
  const refreshed = await fetchAuditRecord(entity, targetId);
  res.json({ ok:true, record: refreshed });
});

app.post('/api/admin/audit/duplicates/:entity/:id/void', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const entity = normaliseAuditEntity(req.params.entity);
  if(entity === 'all') return res.status(400).json({ error:'Specify either cost or fuel entity.' });
  const targetId = req.params.id;
  const reasonRaw = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if(!reasonRaw){
    return res.status(400).json({ error:'Void reason is required.' });
  }
  const cascadeCost = req.body?.cascadeCost === true;
  const record = await fetchDuplicateSource(entity, targetId);
  if(!record) return res.status(404).json({ error:'Duplicate record not found.' });
  if(record.voided_at){
    return res.status(400).json({ error:'Record already voided.' });
  }
  const now = isoNow();
  if(entity === 'cost'){
    await run('UPDATE costs SET voided_by=?, voided_at=?, void_reason=?, reviewed_by=COALESCE(reviewed_by, ?), reviewed_at=COALESCE(reviewed_at, ?) WHERE id=?',[req.user.id, now, reasonRaw, req.user.id, now, targetId]);
  }else if(entity === 'fuel'){
    await run('UPDATE fuel_logs SET voided_by=?, voided_at=?, void_reason=?, reviewed_by=COALESCE(reviewed_by, ?), reviewed_at=COALESCE(reviewed_at, ?) WHERE id=?',[req.user.id, now, reasonRaw, req.user.id, now, targetId]);
    if(cascadeCost){
      const cascadeReason = `Fuel log ${targetId} voided${reasonRaw ? `: ${reasonRaw}` : ''}`;
      const linkedCosts = await q('SELECT id FROM costs WHERE description LIKE ? AND voided_at IS NULL',[`Fuel log ${targetId}%`]);
      for(const costRow of linkedCosts){
        await run('UPDATE costs SET voided_by=?, voided_at=?, void_reason=?, reviewed_by=COALESCE(reviewed_by, ?), reviewed_at=COALESCE(reviewed_at, ?) WHERE id=?',[req.user.id, now, cascadeReason, req.user.id, now, costRow.id]);
      }
    }
  }
  const refreshed = await fetchAuditRecord(entity, targetId);
  res.json({ ok:true, record: refreshed });
});

// ===== FINANCE SUMMARY =====
app.get('/api/admin/finance/summary', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const { from, to } = req.query;
  let where = '';
  const params = [];
  if(from){ where += ' AND date(created_at) >= date(?)'; params.push(from); }
  if(to){ where += ' AND date(created_at) <= date(?)'; params.push(to); }
  const rev = await g(`SELECT COALESCE(SUM(total),0) as revenue, COUNT(*) as orders FROM orders WHERE deleted_at IS NULL ${where}`, params);
  const costs = await q(`SELECT type, COALESCE(SUM(amount),0) as total FROM costs WHERE 1=1 ${where.replace('created_at','incurred_at')} GROUP BY type`, params);
  const costTotal = costs.reduce((s,c)=> s + Number(c.total||0), 0);
  const gross = Number(rev.revenue||0) - costTotal;
  res.json({ revenue: Number(rev.revenue||0), orders: rev.orders, costs, costTotal, gross, margin: rev.revenue? (gross/Number(rev.revenue))*100 : 0 });
});

// ===== FINANCE TIMESERIES (for charts) =====
app.get('/api/admin/finance/timeseries', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const { from, to } = req.query;
  const paramsR=[]; const paramsC=[];
  let wr=''; let wc='';
  if(from){ wr += ' AND date(created_at) >= date(?)'; paramsR.push(from); wc += ' AND date(incurred_at) >= date(?)'; paramsC.push(from); }
  if(to){ wr += ' AND date(created_at) <= date(?)'; paramsR.push(to); wc += ' AND date(incurred_at) <= date(?)'; paramsC.push(to); }
  const rev = await q(`SELECT date(created_at) d, SUM(total) revenue FROM orders WHERE deleted_at IS NULL ${wr} GROUP BY date(created_at) ORDER BY d`, paramsR);
  const cost = await q(`SELECT date(incurred_at) d, SUM(amount) cost FROM costs WHERE 1=1 ${wc} GROUP BY date(incurred_at) ORDER BY d`, paramsC);
  const map = new Map();
  for(const r of rev){ map.set(r.d, { date:r.d, revenue: Number(r.revenue||0), cost:0 }); }
  for(const c of cost){ if(map.has(c.d)) map.get(c.d).cost = Number(c.cost||0); else map.set(c.d, { date:c.d, revenue:0, cost: Number(c.cost||0) }); }
  const rows = Array.from(map.values()).sort((a,b)=> a.date.localeCompare(b.date));
  res.json(rows);
});

app.get('/api/admin/finance/pnl', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const { month: monthQuery } = req.query;
  const { month, start, end } = getMonthRange(typeof monthQuery === 'string' ? monthQuery : undefined);
  const revenueByDay = await q(`SELECT date(created_at) as date, SUM(total) as revenue
    FROM orders WHERE date(created_at) >= date(?) AND date(created_at) < date(?) AND deleted_at IS NULL
    GROUP BY date(created_at) ORDER BY date(created_at)`, [start, end]);
  const costByType = await q(`SELECT type, SUM(amount) as total
    FROM costs WHERE date(incurred_at) >= date(?) AND date(incurred_at) < date(?)
    GROUP BY type`, [start, end]);
  const costByDay = await q(`SELECT date(incurred_at) as date, SUM(amount) as cost
    FROM costs WHERE date(incurred_at) >= date(?) AND date(incurred_at) < date(?)
    GROUP BY date(incurred_at) ORDER BY date(incurred_at)`, [start, end]);
  const revenueTotal = revenueByDay.reduce((sum,row)=> sum + Number(row.revenue||0), 0);
  const costTotal = costByType.reduce((sum,row)=> sum + Number(row.total||0), 0);
  res.json({
    month,
    start,
    end,
    revenue: revenueTotal,
    costs: costTotal,
    profit: revenueTotal - costTotal,
    revenueByDay: revenueByDay.map(r=>({ date:r.date, revenue:Number(r.revenue||0) })),
    costByDay: costByDay.map(r=>({ date:r.date, cost:Number(r.cost||0) })),
    costBreakdown: costByType.map(r=>({ type:r.type, amount:Number(r.total||0) })),
  });
});

// ===== FINANCE PER-TRUCK BREAKDOWN =====
app.get('/api/admin/finance/truck-breakdown', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const { from, to } = req.query;
  let wa=''; const pa=[];
  if(from){ wa += ' AND date(a.scheduled_at) >= date(?)'; pa.push(from); }
  if(to){ wa += ' AND date(a.scheduled_at) <= date(?)'; pa.push(to); }
  // Revenue allocation per assignment: proportion of tonnes vs truck capacity times order.per_truck
  const rows = await q(`
    SELECT a.truck_id as truckId, t.plate as plate, COUNT(a.id) as loads,
           SUM( CASE WHEN t.capacity_t>0 THEN o.per_truck * (a.tonnes / t.capacity_t) ELSE o.per_truck END ) as revenue
    FROM assignments a
    JOIN orders o ON o.id=a.order_id AND o.deleted_at IS NULL
    LEFT JOIN trucks t ON t.id=a.truck_id
    WHERE o.deleted_at IS NULL ${wa}
    GROUP BY a.truck_id
    ORDER BY revenue DESC
  `, pa);
  let wc=''; const pc=[];
  if(from){ wc += ' AND date(incurred_at) >= date(?)'; pc.push(from); }
  if(to){ wc += ' AND date(incurred_at) <= date(?)'; pc.push(to); }
  const costs = await q(`SELECT truck_id as truckId, SUM(amount) as cost FROM costs WHERE truck_id IS NOT NULL ${wc} GROUP BY truck_id`, pc);
  const costMap = new Map(costs.map(c=> [c.truckId, Number(c.cost||0)] ));
  const out = rows.map(r=> ({ truckId:r.truckId, plate:r.plate, loads:r.loads, revenue:Number(r.revenue||0), cost: costMap.get(r.truckId)||0 }))
                  .map(x=> ({ ...x, gross: x.revenue - x.cost, margin: x.revenue? (x.revenue - x.cost)/x.revenue*100 : 0 }));
  res.json(out);
});

app.get('/api/telemetry/trucks', authRequired, roleRequired('ADMIN','OPS','DRIVER','FUEL'), async (req,res)=>{
  const telemetry = await fetchTelemetryData();
  if(req.user.role === 'DRIVER' && req.user.driverId){
    const recent = await q(`SELECT DISTINCT truck_id FROM assignments WHERE driver_id=? ORDER BY scheduled_at DESC LIMIT 5`, [req.user.driverId]);
    const allowed = new Set(recent.map(r=>r.truck_id));
    return res.json(telemetry.filter(t=> !allowed.size || allowed.has(t.truckId)));
  }
  res.json(telemetry);
});

app.get('/api/telemetry/alerts', authRequired, roleRequired('ADMIN','OPS','FUEL','DRIVER'), async (req,res)=>{
  const truckIdFilter = typeof req.query.truckId === 'string' && req.query.truckId.trim() ? req.query.truckId.trim() : null;
  const limitRaw = Number.parseInt(String(req.query.limit ?? ''), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 30;
  const includeRaw = String(req.query.includeRaw || '').toLowerCase() === '1';
  const params = [];
  let where = '';
  if(truckIdFilter){
    where += ' AND truck_id=?';
    params.push(truckIdFilter);
  }
  if(req.query.since){
    where += ' AND created_at >= ?';
    params.push(String(req.query.since));
  }
  if(req.user.role === 'DRIVER' && req.user.driverId){
    if(truckIdFilter){
      const permitted = await q(`SELECT DISTINCT truck_id FROM assignments WHERE driver_id=?`, [req.user.driverId]);
      const allowed = new Set(permitted.map(r=> r.truck_id));
      if(!allowed.has(truckIdFilter)){
        return res.status(403).json({ error:'Not authorised for this truck' });
      }
    }
  }
  const rows = await q(
    `SELECT id, truck_id, alert_type, severity, confidence, summary, window_start, window_end, model, raw, created_at
     FROM telemetry_ai_alerts
     WHERE 1=1 ${where}
     ORDER BY datetime(created_at) DESC
     LIMIT ?`,
    [...params, limit]
  );
  res.json(rows.map(row=>({
    id: row.id,
    truckId: row.truck_id,
    alertType: row.alert_type,
    severity: row.severity,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    summary: row.summary,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    model: row.model,
    raw: includeRaw ? safeParseJSON(row.raw) || null : undefined,
    createdAt: row.created_at,
  })));
});

app.get('/api/telemetry/trucks/:truckId/history', authRequired, roleRequired('ADMIN','OPS','FUEL','DRIVER'), async (req,res)=>{
  const truckId = String(req.params.truckId || '').trim();
  if(!truckId) return res.status(400).json({ error:'Truck id required' });
  if(req.user.role === 'DRIVER' && req.user.driverId){
    const permitted = await q(`SELECT DISTINCT truck_id FROM assignments WHERE driver_id=?`, [req.user.driverId]);
    const allowed = new Set(permitted.map(r=> r.truck_id));
    if(!allowed.has(truckId)){
      return res.status(403).json({ error:'Not authorised for this truck' });
    }
  }
  const limitRaw = Number.parseInt(String(req.query.limit ?? ''), 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(300, Math.max(10, limitRaw)) : 120;
  const rows = await q(
    `SELECT id, truck_id, lat, lng, speed, status, heading, source, address, idle_minutes, plate, captured_at, created_at
     FROM telemetry_snapshots
     WHERE truck_id=?
     ORDER BY datetime(captured_at) DESC
     LIMIT ?`,
    [truckId, limit]
  );
  res.json(rows.map(row=>({
    id: row.id,
    truckId: row.truck_id,
    plate: row.plate,
    lat: row.lat === null || row.lat === undefined ? null : Number(row.lat),
    lng: row.lng === null || row.lng === undefined ? null : Number(row.lng),
    speed: row.speed === null || row.speed === undefined ? null : Number(row.speed),
    status: row.status,
    heading: row.heading === null || row.heading === undefined ? null : Number(row.heading),
    source: row.source,
    address: row.address,
    idleMinutes: row.idle_minutes === null || row.idle_minutes === undefined ? null : Number(row.idle_minutes),
    capturedAt: row.captured_at,
    recordedAt: row.created_at,
  })));
});

// ===== TRUCKS & DRIVERS =====
app.get('/api/admin/trucks', authRequired, roleRequired('ADMIN','OPS','FUEL'), async (req,res)=>{
  const rows = await q(`
    SELECT
      t.id,
      t.plate,
      t.capacity_t AS capacityT,
      t.primary_driver_id AS primaryDriverId,
      t.primary_driver_assigned_at AS primaryDriverAssignedAt,
      d.name AS driverName,
      d.phone AS driverPhone,
      d.email AS driverEmail,
      t.created_at AS createdAt,
      t.updated_at AS updatedAt
    FROM trucks t
    LEFT JOIN drivers d ON d.id=t.primary_driver_id
    ORDER BY t.id
  `);
  res.json(rows.map(mapTruckRow));
});
app.post('/api/admin/trucks', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const { id: idv, plate, capacityT, primaryDriverId } = req.body;
  if(!idv || !plate) return res.status(400).json({ error:'Truck id and plate are required' });
  const now = isoNow();
  const assignedDriverId = primaryDriverId || null;
  const assignedAt = assignedDriverId ? now : null;
  await run('INSERT INTO trucks (id,plate,capacity_t,primary_driver_id,primary_driver_assigned_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',[
    idv,
    plate,
    Number(capacityT)||0,
    assignedDriverId,
    assignedAt,
    now,
    now,
  ]);
  res.json({ ok:true });
});
app.patch('/api/admin/trucks/:id', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const { plate, capacityT, primaryDriverId } = req.body || {};
  const isAdmin = req.user.role === 'ADMIN';
  const truckId = req.params.id;
  const currentTruck = await g('SELECT id, primary_driver_id FROM trucks WHERE id=?',[truckId]);
  if(!currentTruck) return res.status(404).json({ error:'Truck not found' });
  if(!isAdmin){
    if(plate !== undefined || capacityT !== undefined){
      return res.status(403).json({ error:'Only admins can update plate or capacity' });
    }
  }
  const updates = [];
  const params = [];
  if(isAdmin && plate){
    updates.push('plate=?');
    params.push(String(plate).trim());
  }
  if(isAdmin && capacityT !== undefined){
    updates.push('capacity_t=?');
    params.push(Number(capacityT));
  }
  if(primaryDriverId !== undefined){
    const rawDriverId = typeof primaryDriverId === 'string'
      ? primaryDriverId.trim()
      : String(primaryDriverId || '').trim();
    const nextDriverId = rawDriverId || null;
    const existingDriverId = currentTruck.primary_driver_id || null;
    if(nextDriverId !== existingDriverId){
      updates.push('primary_driver_id=?');
      params.push(nextDriverId);
      updates.push('primary_driver_assigned_at=?');
      params.push(nextDriverId ? isoNow() : null);
    }
  }
  if(updates.length === 0){
    const row = await g(`
      SELECT
        t.id,
        t.plate,
        t.capacity_t AS capacityT,
        t.primary_driver_id AS primaryDriverId,
        t.primary_driver_assigned_at AS primaryDriverAssignedAt,
        d.name AS driverName,
        d.phone AS driverPhone,
        d.email AS driverEmail,
        t.created_at AS createdAt,
        t.updated_at AS updatedAt
      FROM trucks t
      LEFT JOIN drivers d ON d.id=t.primary_driver_id
      WHERE t.id=?
    `, [truckId]);
    return res.json({ ok:true, truck: mapTruckRow(row) });
  }
  updates.push('updated_at=?');
  params.push(isoNow());
  params.push(truckId);
  await run(`UPDATE trucks SET ${updates.join(', ')} WHERE id=?`, params);
  telemetryCache.fetchedAt = 0;
  const updatedRow = await g(`
    SELECT
      t.id,
      t.plate,
      t.capacity_t AS capacityT,
      t.primary_driver_id AS primaryDriverId,
      t.primary_driver_assigned_at AS primaryDriverAssignedAt,
      d.name AS driverName,
      d.phone AS driverPhone,
      d.email AS driverEmail,
      t.created_at AS createdAt,
      t.updated_at AS updatedAt
    FROM trucks t
    LEFT JOIN drivers d ON d.id=t.primary_driver_id
    WHERE t.id=?
  `, [truckId]);
  res.json({ ok:true, truck: mapTruckRow(updatedRow) });
});
app.get('/api/admin/drivers', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const rows = await q('SELECT * FROM drivers ORDER BY name');
  res.json(rows.map(mapDriverRow));
});
app.post('/api/admin/drivers', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const { id: idv, name, email, phone } = req.body;
  if(!idv || !name) return res.status(400).json({ error:'Driver id and name are required' });
  await run('INSERT INTO drivers (id,name,email,phone,created_at,updated_at) VALUES (?,?,?,?,?,?)',[ idv, name, email||null, phone||null, isoNow(), isoNow() ]);
  res.json({ ok:true });
});
app.patch('/api/admin/drivers/:id', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  try{
    const driver = await updateDriverRecord(req.params.id, req.body || {});
    res.json({ ok:true, driver });
  }catch(err){
    if(err?.status === 404){
      return res.status(404).json({ error:'Driver not found' });
    }
    if(err?.status === 400){
      return res.status(400).json({ error: err.message || 'Invalid driver payload' });
    }
    console.error('Failed to update driver profile', err);
    res.status(500).json({ error:'Failed to update driver profile' });
  }
});

app.put('/api/driver/profile', authRequired, roleRequired('DRIVER'), async (req,res)=>{
  const driverId = req.user.driverId;
  if(!driverId) return res.status(400).json({ error:'Driver profile missing' });
  try{
    const driver = await updateDriverRecord(driverId, req.body || {});
    res.json({ ok:true, driver });
  }catch(err){
    if(err?.status === 404){
      return res.status(404).json({ error:'Driver not found' });
    }
    if(err?.status === 400){
      return res.status(400).json({ error: err.message || 'Invalid driver payload' });
    }
    console.error('Failed to update driver profile', err);
    res.status(500).json({ error:'Failed to update driver profile' });
  }
});

app.get('/api/profile/employment-form', authRequired, async (req,res)=>{
  try{
    const form = await ensureDriverOnboardingFormRecord(req.user.driverId || null, { userId: req.user.id });
    res.json(form);
  }catch(err){
    console.error('Failed to fetch employment form', err);
    res.status(err?.status || 500).json({ error: err?.message || 'Failed to load employment form' });
  }
});

app.put('/api/profile/employment-form', authRequired, async (req,res)=>{
  try{
    const payload = (req.body && typeof req.body === 'object' ? (req.body.form || req.body) : {}) || {};
    const form = await persistDriverOnboardingForm(req.user.driverId || null, payload, { actorUserId: req.user.id, allowStatusDowngrade: true, userId: req.user.id });
    res.json(form);
  }catch(err){
    console.error('Failed to save employment form', err);
    res.status(err?.status || 500).json({ error: err?.message || 'Failed to save employment form' });
  }
});

app.get('/api/profile/employment-form/status', authRequired, async (req,res)=>{
  try{
    const form = await ensureDriverOnboardingFormRecord(req.user.driverId || null, { userId: req.user.id });
    const updatedAt = form.updatedAt || form.form?.updatedAt || isoNow();
    const deadline = form.completionSummary?.isComplete
      ? null
      : new Date(new Date(updatedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    res.json({
      status: form.status,
      updatedAt,
      submittedAt: form.submittedAt,
      completionSummary: form.completionSummary,
      deadlineAt: deadline,
    });
  }catch(err){
    console.error('Failed to load employment form status', err);
    res.status(err?.status || 500).json({ error: err?.message || 'Failed to load employment form status' });
  }
});

app.get('/api/profile/employment-form/employees', authRequired, async (req,res)=>{
  const rows = await q('SELECT id,name,email,role,driver_id FROM users ORDER BY name COLLATE NOCASE');
  res.json(rows.map((row)=>({
    id: row.id,
    name: row.name || row.email || row.id,
    email: row.email || '',
    role: row.role || '',
    driverId: row.driver_id || null,
  })));
});

app.post('/api/profile/employment-form/documents/:code', authRequired, async (req,res)=>{
  try{
    const subject = await resolveFormSubject(req.user.driverId || null, { userId: req.user.id });
    const fileData = typeof req.body?.fileData === 'string' ? req.body.fileData : (typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '');
    const form = await handleEmploymentDocumentUpload(subject, req.params.code, fileData, { remarks: req.body?.remarks, actorUserId: req.user.id });
    res.json(form);
  }catch(err){
    console.error('Failed to upload employment document', err);
    res.status(err?.status || 500).json({ error: err?.message || 'Failed to upload employment document' });
  }
});

app.get('/api/driver/onboarding-form', authRequired, roleRequired('DRIVER'), async (req,res)=>{
  const driverId = req.user.driverId;
  if(!driverId) return res.status(400).json({ error:'Driver profile missing' });
  try{
    const form = await ensureDriverOnboardingFormRecord(driverId, { userId: req.user.id });
    res.json(form);
  }catch(err){
    console.error('Failed to fetch driver onboarding form', err);
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || 'Failed to load onboarding form' });
  }
});

app.put('/api/driver/onboarding-form', authRequired, roleRequired('DRIVER'), async (req,res)=>{
  const driverId = req.user.driverId;
  if(!driverId) return res.status(400).json({ error:'Driver profile missing' });
  try{
    const payload = (req.body && typeof req.body === 'object' ? (req.body.form || req.body) : {}) || {};
    const form = await persistDriverOnboardingForm(driverId, payload, { actorUserId: req.user.id, allowStatusDowngrade: true, userId: req.user.id });
    res.json(form);
  }catch(err){
    console.error('Failed to save driver onboarding form', err);
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || 'Failed to save onboarding form' });
  }
});

app.get('/api/admin/driver-forms', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const rows = await q(`
    SELECT
      f.driver_id,
      f.status,
      f.updated_at,
      f.submitted_at,
      d.name AS driver_name,
      d.email AS driver_email,
      d.phone AS driver_phone,
      u.name AS user_name,
      u.email AS user_email,
      u.phone AS user_phone
    FROM driver_onboarding_forms f
    LEFT JOIN drivers d ON d.id=f.driver_id
    LEFT JOIN users u ON ('USR-' || u.id)=f.driver_id
    ORDER BY datetime(f.updated_at) DESC
  `);
  res.json(rows.map((row)=>({
    driverId: row.driver_id,
    status: row.status || 'draft',
    updatedAt: row.updated_at || null,
    submittedAt: row.submitted_at || null,
    driverName: row.driver_name || row.user_name || row.driver_id,
    driverEmail: row.driver_email || row.user_email || '',
    driverPhone: row.driver_phone || row.user_phone || '',
  })));
});

app.get('/api/admin/driver-forms/:driverId', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  try{
    const form = await ensureDriverOnboardingFormRecord(req.params.driverId);
    res.json(form);
  }catch(err){
    console.error('Failed to fetch driver onboarding form (admin)', err);
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || 'Failed to load onboarding form' });
  }
});

app.put('/api/admin/driver-forms/:driverId', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  try{
    const payload = (req.body && typeof req.body === 'object' ? (req.body.form || req.body) : {}) || {};
    const form = await persistDriverOnboardingForm(req.params.driverId, payload, { actorUserId: req.user.id, allowStatusDowngrade: true });
    res.json(form);
  }catch(err){
    console.error('Failed to save driver onboarding form (admin)', err);
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || 'Failed to save onboarding form' });
  }
});

// ===== REPORTS =====
app.get('/api/reports/definitions', authRequired, roleRequired('ADMIN','OPS'), (req,res)=>{
  res.json({ definitions: REPORT_DEFINITIONS, formats: REPORT_FORMATS });
});

app.post('/api/reports/export', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  try{
    const reportKey = typeof req.body?.reportKey === 'string' ? req.body.reportKey.trim() : '';
    const formatRaw = typeof req.body?.format === 'string' ? req.body.format.trim().toLowerCase() : 'excel';
    const definition = reportKey ? getReportDefinition(reportKey) : null;
    if(!definition){
      return res.status(400).json({ error:'Unknown report requested' });
    }
    if(!REPORT_FORMAT_SET.has(formatRaw)){
      return res.status(400).json({ error:'Unsupported export format' });
    }
    const builder = REPORT_BUILDERS[reportKey];
    if(!builder){
      return res.status(400).json({ error:'Report builder unavailable' });
    }
    const filters =
      req.body && typeof req.body === 'object' && req.body.filters && typeof req.body.filters === 'object'
        ? req.body.filters
        : {};
    const { rows, meta, excelSheets } = await builder(filters, definition);
    const fileBase = `${reportKey}-${meta.fromDate || toISODate()}-${meta.toDate || toISODate()}`.replace(/[^a-z0-9-_]+/gi,'-');
    if(formatRaw === 'excel'){
      const buffer = await generateExcelReport(definition, rows, meta, { excelSheets });
      return res.json({
        fileName: `${fileBase}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        data: Buffer.from(buffer).toString('base64'),
        rowCount: rows.length,
        meta,
      });
    }
    const pdfBuffer = await generatePdfReport(definition, rows, meta);
    res.json({
      fileName: `${fileBase}.pdf`,
      mimeType: 'application/pdf',
      data: pdfBuffer.toString('base64'),
      rowCount: rows.length,
      meta,
    });
  }catch(err){
    console.error('Report export failed', err);
    res.status(500).json({ error: err?.message || 'Failed to export report' });
  }
});

app.post('/api/reports/data', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  try{
    const reportKey = typeof req.body?.reportKey === 'string' ? req.body.reportKey.trim() : '';
    const definition = reportKey ? getReportDefinition(reportKey) : null;
    if(!definition) return res.status(400).json({ error:'Unknown report requested' });
    const builder = REPORT_BUILDERS[reportKey];
    if(!builder) return res.status(400).json({ error:'Report builder unavailable' });
    const filters = req.body && typeof req.body.filters === 'object' ? req.body.filters : {};
    const result = await builder(filters, definition);
    res.json({ timeline: result.timeline || null, meta: result.meta, rowCount: result.rows?.length || 0 });
  }catch(err){
    console.error('Report data failed', err);
    res.status(500).json({ error: err?.message || 'Failed to load report data' });
  }
});

app.post('/api/reports/send-telegram', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  try{
    const reportKey = typeof req.body?.reportKey === 'string' ? req.body.reportKey.trim() : '';
    const formatRaw = typeof req.body?.format === 'string' ? req.body.format.trim().toLowerCase() : 'pdf';
    const telegramChatId = typeof req.body?.telegramChatId === 'string' ? req.body.telegramChatId.trim() : '';
    if(!telegramChatId) return res.status(400).json({ error:'telegramChatId is required' });
    const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
    if(!token) return res.status(400).json({ error:'Telegram bot not configured on server' });
    const definition = reportKey ? getReportDefinition(reportKey) : null;
    if(!definition) return res.status(400).json({ error:'Unknown report' });
    const builder = REPORT_BUILDERS[reportKey];
    if(!builder) return res.status(400).json({ error:'Report builder unavailable' });
    const filters =
      req.body && typeof req.body.filters === 'object' ? req.body.filters : {};
    const result = await builder(filters, definition);
    const { rows, meta, excelSheets } = result;
    const fileBase = `${reportKey}-${meta.fromDate || toISODate()}-${meta.toDate || toISODate()}`.replace(/[^a-z0-9-_]+/gi,'-');
    let fileBuffer;
    let fileName;
    let mimeType;
    if(definition.telegramFormat === 'text' && result.telegramLines){
      fileBuffer = Buffer.from(result.telegramLines, 'utf-8');
      fileName = `${fileBase}.txt`;
      mimeType = 'text/plain';
    } else if(formatRaw === 'excel'){
      fileBuffer = await generateExcelReport(definition, rows, meta, { excelSheets });
      fileName = `${fileBase}.xlsx`;
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      fileBuffer = await generatePdfReport(definition, rows, meta);
      fileName = `${fileBase}.pdf`;
      mimeType = 'application/pdf';
    }
    const form = new FormData();
    form.append('chat_id', telegramChatId);
    form.append('caption', `${definition.title}\n${rows.length} rows · ${meta.fromDate || ''} → ${meta.toDate || ''}`);
    form.append('document', new Blob([fileBuffer], { type: mimeType }), fileName);
    const tgRes = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method:'POST', body: form });
    if(!tgRes.ok){
      const errText = await tgRes.text();
      console.error('Telegram sendDocument failed', tgRes.status, errText);
      return res.status(502).json({ error:`Telegram rejected the request: ${tgRes.status}` });
    }
    res.json({ message:`Report sent to Telegram (${rows.length} rows).` });
  }catch(err){
    console.error('send-telegram failed', err);
    res.status(500).json({ error: err?.message || 'Failed to send report to Telegram' });
  }
});

// Re-geocode snapshots with missing or weak addresses using Nominatim at zoom 16.
// Runs in background; responds immediately with the count queued.
app.post('/api/admin/geocode-backfill', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  try{
    const limitRaw = Number(req.body?.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 5000) : 500;
    // Find snapshots with null/empty/weak address that have valid coords
    const badValues = ['unknown','n/a','na','none','null','central','central region','central province','kenya'];
    const placeholders = badValues.map(()=>'?').join(',');
    const rows = await q(
      `SELECT id, lat, lng FROM telemetry_snapshots
        WHERE lat IS NOT NULL AND lng IS NOT NULL
          AND (address IS NULL OR address = ''
               OR (length(address) <= 12 AND instr(address,',') = 0)
               OR lower(trim(address)) IN (${placeholders}))
        ORDER BY captured_at DESC
        LIMIT ?`,
      [...badValues, limit]
    );
    res.json({ queued: rows.length, message: `Backfilling ${rows.length} snapshots in background.` });
    // Run in background — 1 req/s to respect Nominatim policy
    (async()=>{
      let updated = 0;
      for(const row of rows){
        const lat = Number(row.lat);
        const lng = Number(row.lng);
        if(!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        try{
          const label = await reverseGeocode(lat, lng);
          if(label){
            await run(`UPDATE telemetry_snapshots SET address=? WHERE id=?`, [label, row.id]);
            updated++;
          }
        }catch(err){
          console.warn('backfill geocode error', err?.message);
        }
        await new Promise((r)=> setTimeout(r, 1100)); // ~1 req/s
      }
      console.log(`[geocode-backfill] updated ${updated}/${rows.length} snapshots`);
    })().catch((err)=> console.error('[geocode-backfill] failed', err));
  }catch(err){
    res.status(500).json({ error: err?.message || 'Backfill failed' });
  }
});

function parseChannelList(value){
  if(!value) return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return raw
    .map((v)=> String(v||'').trim().toUpperCase())
    .filter((v)=> v==='EMAIL' || v==='TELEGRAM');
}

function cleanRecipientList(list){
  if(Array.isArray(list)){
    return list.map((v)=> String(v||'').trim()).filter(Boolean);
  }
  if(typeof list === 'string'){
    return list.split(',').map((v)=> v.trim()).filter(Boolean);
  }
  return [];
}

function parseTelegramRecipient(entry, defaultToken=null){
  const raw = String(entry ?? '').trim();
  if(!raw) return { chatId:null, botToken: defaultToken };
  const [chatPart, tokenPart] = raw.split('|');
  const chatId = (chatPart || '').trim();
  const botToken = (tokenPart || '').trim() || defaultToken || null;
  return { chatId, botToken };
}

function mapScheduleRow(row){
  const parsedChannels = parseChannelList(row.channels || 'EMAIL');
  const channels = parsedChannels.length ? parsedChannels : ['EMAIL'];
  return {
    id: row.id,
    reportKey: row.report_key,
    format: row.format || 'excel',
    filters: row.filters_json ? safeParseJSON(row.filters_json) || {} : {},
    channels,
    emailRecipients: cleanRecipientList(row.email_recipients || ''),
    telegramRecipients: cleanRecipientList(row.telegram_recipients || ''),
    telegramBotToken: (row.telegram_bot_token || '').trim(),
    timeOfDay: row.time_of_day || '20:00',
    frequencyMinutes: Number(row.frequency_minutes || 1440),
    timezoneOffsetMinutes: Number(row.timezone_offset_minutes || 0),
    enabled: Boolean(row.enabled),
    lastRunAt: row.last_run_at || null,
    nextRunAt: row.next_run_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function persistReportSchedule(idValue, payload, { isUpdate=false } = {}){
  const reportKey = typeof payload.reportKey === 'string' ? payload.reportKey.trim() : '';
  const definition = getReportDefinition(reportKey);
  if(!definition) throw Object.assign(new Error('Unknown report'), { status:400 });
  const timeOfDay = normaliseTimeOfDay(payload.timeOfDay || '20:00');
  if(!timeOfDay) throw Object.assign(new Error('Invalid time of day (HH:mm)'), { status:400 });
  const timezoneOffsetMinutes = Number.isFinite(Number(payload.timezoneOffsetMinutes)) ? Number(payload.timezoneOffsetMinutes) : 180;
  const frequencyMinutes = Math.max(1, Number(payload.frequencyMinutes || payload.repeatMinutes || 1440));
  const channels = parseChannelList(payload.channels ? Array.isArray(payload.channels) ? payload.channels.join(',') : payload.channels : 'email');
  if(!channels.length) channels.push('EMAIL');
  const emailRecipients = cleanRecipientList(payload.emailRecipients || payload.emails || '');
  const telegramRecipients = cleanRecipientList(payload.telegramRecipients || payload.telegram || '');
  const telegramBotToken = typeof payload.telegramBotToken === 'string' ? payload.telegramBotToken.trim() : '';
  const formatRaw = typeof payload.format === 'string' ? payload.format.trim().toLowerCase() : 'excel';
  if(!REPORT_FORMAT_SET.has(formatRaw)) throw Object.assign(new Error('Unsupported format'), { status:400 });
  const filters = payload.filters && typeof payload.filters === 'object' ? payload.filters : {};
  const enabled = payload.enabled === undefined ? true : Boolean(payload.enabled);
  const nextRunAt = computeNextRunAt(timeOfDay, timezoneOffsetMinutes, new Date(), frequencyMinutes, payload.lastRunAt || null);
  const nowIso = isoNow();
  if(isUpdate){
    await run(
      `UPDATE report_schedules
         SET report_key=?, format=?, filters_json=?, channels=?, email_recipients=?, telegram_recipients=?, telegram_bot_token=?,
             time_of_day=?, frequency_minutes=?, timezone_offset_minutes=?, enabled=?, next_run_at=?, updated_at=?
       WHERE id=?`,
      [
        reportKey,
        formatRaw,
        JSON.stringify(filters),
        channels.join(',').toLowerCase(),
        emailRecipients.join(','),
        telegramRecipients.join(','),
        telegramBotToken,
        timeOfDay,
        frequencyMinutes,
        timezoneOffsetMinutes,
        enabled ? 1 : 0,
        nextRunAt,
        nowIso,
        idValue,
      ]
    );
    const saved = await g(`SELECT * FROM report_schedules WHERE id=?`, [idValue]);
    return mapScheduleRow(saved);
  }
  const idv = id('RSC');
  await run(
    `INSERT INTO report_schedules (id, report_key, format, filters_json, channels, email_recipients, telegram_recipients, telegram_bot_token, time_of_day, frequency_minutes, timezone_offset_minutes, enabled, last_run_at, next_run_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      idv,
      reportKey,
      formatRaw,
      JSON.stringify(filters),
      channels.join(',').toLowerCase(),
      emailRecipients.join(','),
      telegramRecipients.join(','),
      telegramBotToken,
      timeOfDay,
      frequencyMinutes,
      timezoneOffsetMinutes,
      enabled ? 1 : 0,
      null,
      nextRunAt,
      nowIso,
      nowIso,
    ]
  );
  const saved = await g(`SELECT * FROM report_schedules WHERE id=?`, [idv]);
  return mapScheduleRow(saved);
}

app.get('/api/admin/report-schedules', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const rows = await q(`SELECT * FROM report_schedules ORDER BY time_of_day`);
  res.json(rows.map(mapScheduleRow));
});

app.post('/api/admin/report-schedules', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  try{
    const schedule = await persistReportSchedule(null, req.body || {}, { isUpdate:false });
    res.status(201).json({ schedule });
  }catch(err){
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || 'Failed to create report schedule' });
  }
});

app.put('/api/admin/report-schedules/:id', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  try{
    const target = await g(`SELECT * FROM report_schedules WHERE id=?`, [req.params.id]);
    if(!target) return res.status(404).json({ error:'Schedule not found' });
    const schedule = await persistReportSchedule(req.params.id, req.body || {}, { isUpdate:true });
    res.json({ schedule });
  }catch(err){
    const status = err?.status || 500;
    res.status(status).json({ error: err?.message || 'Failed to update report schedule' });
  }
});

app.delete('/api/admin/report-schedules/:id', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  await run('DELETE FROM report_schedules WHERE id=?', [req.params.id]);
  res.json({ ok:true });
});

// ===== CUSTOMERS =====
app.get('/api/admin/customers', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const rows = await q(`SELECT u.id, u.name, u.email, u.phone, COUNT(o.id) as ordersCount, COALESCE(SUM(o.total),0) as totalSpend
    FROM users u LEFT JOIN orders o ON o.customer_id=u.id AND o.deleted_at IS NULL WHERE u.role='CUSTOMER' GROUP BY u.id ORDER BY totalSpend DESC`);
  res.json(rows);
});

// ===== DRIVER DASHBOARD =====
app.get('/api/driver/dashboard', authRequired, roleRequired('DRIVER','ADMIN','OPS'), async (req,res)=>{
  const targetDriver = req.user.role==='DRIVER' ? req.user.driverId : (req.query.driverId || req.user.driverId);
  if(!targetDriver) return res.status(400).json({ error:'Driver not linked to account' });
  const [assignments, driverRow, leaderboard, prevWindow] = await Promise.all([
    q(`SELECT a.*, o.site, o.band_id, o.per_truck, o.total, o.date_needed, t.plate, t.capacity_t
        FROM assignments a
        JOIN orders o ON o.id=a.order_id AND o.deleted_at IS NULL
        LEFT JOIN trucks t ON t.id=a.truck_id
        WHERE a.driver_id=?
        ORDER BY COALESCE(a.delivered_at, a.scheduled_at) DESC
        LIMIT 100`, [targetDriver]),
    g('SELECT * FROM drivers WHERE id=?',[targetDriver]),
    buildDriverLeaderboard(7),
    driverEarningsWindow('-14 day','-7 day'),
  ]);
  const delivered = assignments.filter(a=>a.status==='Delivered');
  const loadsDelivered = delivered.length;
  const tonnesDelivered = delivered.reduce((sum,a)=> sum + Number(a.tonnes||0), 0);
  const earningsDelivered = delivered.reduce((sum,a)=> sum + calcAssignmentRevenue(a.per_truck, a.tonnes, a.capacity_t), 0);
  const leaderboardEntry = leaderboard.find(x=>x.driverId===targetDriver);
  const prevMap = new Map(prevWindow.map(x=> [x.driverId, Number(x.revenue||0)]));
  const prevRevenue = prevMap.get(targetDriver)||0;
  const trend = prevRevenue>0 ? (Number(leaderboardEntry?.revenue||0) - prevRevenue)/prevRevenue : null;
  const telemetry = await fetchTelemetryData();
  const relevantTrucks = new Set(assignments.map(a=>a.truck_id).filter(Boolean));
  const telemetrySubset = telemetry.filter(t=> !relevantTrucks.size || relevantTrucks.has(t.truckId));
  const driverProfile = driverRow ? mapDriverRow(driverRow) : null;
  res.json({
    driverId: targetDriver,
    driverName: driverRow?.name || req.user.name,
    profile: driverProfile,
    summary: {
      loadsDelivered,
      tonnesDelivered,
      earningsDelivered,
      averageTonnesPerLoad: loadsDelivered? tonnesDelivered/loadsDelivered : 0,
      weeklyRevenue: Number(leaderboardEntry?.revenue||0),
      previousWeekRevenue: prevRevenue,
      trend,
    },
    assignments: assignments.map(a=>({
      id: a.id,
      orderId: a.order_id,
      truckId: a.truck_id,
      plate: a.plate,
      site: a.site,
      status: a.status,
      scheduledAt: a.scheduled_at,
      deliveredAt: a.delivered_at,
      tonnes: Number(a.tonnes||0),
      perTruck: Number(a.per_truck||0),
      estimatedRevenue: calcAssignmentRevenue(a.per_truck, a.tonnes, a.capacity_t),
    })),
    leaderboard,
    rank: leaderboardEntry ? leaderboard.indexOf(leaderboardEntry)+1 : null,
    telemetry: telemetrySubset,
  });
});

app.get('/api/driver/leaderboard', authRequired, roleRequired('ADMIN','OPS','DRIVER'), async (req,res)=>{
  const days = Math.min(30, Math.max(1, Number(req.query.days)||7));
  const rows = await buildDriverLeaderboard(days);
  res.json(rows);
});

// ===== FUEL LOGS =====
app.get('/api/fuel/logs', authRequired, roleRequired('FUEL','ADMIN','OPS'), async (req,res)=>{
  const { truckId } = req.query;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit)||50));
  const params = [];
  let where = '';
  if(truckId){ where = 'WHERE fl.truck_id=?'; params.push(truckId); }
  params.push(limit);
  const rows = await q(`
    SELECT fl.*, t.plate, u.name as capturedBy, d.name as driverName
    FROM fuel_logs fl
    LEFT JOIN trucks t ON t.id=fl.truck_id
    LEFT JOIN drivers d ON d.id=fl.driver_id
    LEFT JOIN users u ON u.id=fl.created_by
    ${where}
    ORDER BY fl.captured_at DESC
    LIMIT ?
  `, params);
  res.json(rows.map(r=>{
    const litres = r.litres!==null && r.litres!==undefined ? Number(r.litres) : null;
    const odometer = r.odometer!==null && r.odometer!==undefined ? Number(r.odometer) : null;
    const mileage = r.mileage!==null && r.mileage!==undefined ? Number(r.mileage) : null;
    return {
      id: r.id,
      truckId: r.truck_id,
      plate: r.plate,
      litres,
      odometer,
      mileage,
      cost: r.cost!==null && r.cost!==undefined ? Number(r.cost) : null,
      driverId: r.driver_id || null,
      driverName: r.driverName || null,
      photoPath: r.photo_path,
      note: r.note,
      capturedAt: r.captured_at,
      createdBy: r.capturedBy || null,
      isDuplicate: Boolean(r.is_duplicate),
      duplicateOf: r.duplicate_of || null,
      confirmedBy: r.confirmed_by !== null && r.confirmed_by !== undefined ? Number(r.confirmed_by) : null,
      confirmedAt: r.confirmed_at || null,
      reviewedBy: r.reviewed_by !== null && r.reviewed_by !== undefined ? Number(r.reviewed_by) : null,
      reviewedAt: r.reviewed_at || null,
      reviewNote: r.review_note || null,
      voidedBy: r.voided_by !== null && r.voided_by !== undefined ? Number(r.voided_by) : null,
      voidedAt: r.voided_at || null,
      voidReason: r.void_reason || null,
      voided: Boolean(r.voided_at),
    };
  }));
});

app.post('/api/fuel/logs', authRequired, roleRequired('FUEL','ADMIN','OPS'), async (req,res)=>{
  const { truckId, litres, odometer, note, capturedAt, photoData, cost, driverId: driverIdInput } = req.body;
  const fid = id('FUEL');
  let mileage = null;
  if(truckId && odometer){
    const previous = await g(`SELECT odometer FROM fuel_logs WHERE truck_id=? ORDER BY captured_at DESC LIMIT 1`, [truckId]);
    if(previous && previous.odometer!==null && previous.odometer!==undefined){
      const diff = Number(odometer) - Number(previous.odometer);
      mileage = Number.isFinite(diff) ? diff : null;
    }
  }
  let driverId = driverIdInput || null;
  if(!driverId && truckId){
    const truckRow = await g('SELECT primary_driver_id FROM trucks WHERE id=?',[truckId]);
    if(truckRow?.primary_driver_id) driverId = truckRow.primary_driver_id;
  }
  const photoPath = photoData ? await saveImageFromDataUrl(photoData) : null;
  const litresValue = litres!==undefined && litres!==null ? Number(litres) : null;
  const odometerValue = odometer!==undefined && odometer!==null ? Number(odometer) : null;
  const costValue = cost!==undefined && cost!==null ? Number(cost) : null;
  const capturedIso = normaliseIsoDate(capturedAt);
  const overrideDuplicate = req.body?.overrideDuplicate === true;
  const duplicateOfInput = typeof req.body?.duplicateOf === 'string' ? req.body.duplicateOf.trim() : null;
  const potentialDuplicate = await findPotentialDuplicateFuel({
    truckId: truckId || null,
    litres: litresValue,
    cost: costValue,
    capturedAtIso: capturedIso,
  });
  if(potentialDuplicate && !overrideDuplicate){
    return res.status(409).json({ duplicate:true, existing: potentialDuplicate, message:'Potential duplicate fuel entry detected.' });
  }
  const fuelDuplicateTarget = overrideDuplicate
    ? duplicateOfInput || potentialDuplicate?.duplicate_of || potentialDuplicate?.id || null
    : null;
  await run(`INSERT INTO fuel_logs (id,truck_id,driver_id,litres,odometer,mileage,cost,photo_path,note,captured_at,created_by,created_at,is_duplicate,duplicate_of,confirmed_by,confirmed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      fid,
      truckId||null,
      driverId||null,
      litresValue,
      odometerValue,
      mileage,
      costValue,
      photoPath,
      note||'',
      capturedIso,
      req.user.id,
      isoNow(),
      fuelDuplicateTarget ? 1 : 0,
      fuelDuplicateTarget || null,
      fuelDuplicateTarget ? req.user.id : null,
      fuelDuplicateTarget ? isoNow() : null,
    ]);
  if(costValue && costValue > 0){
    const costDuplicate = await findPotentialDuplicateCost({
      truckId: truckId || null,
      type: 'FUEL',
      amount: costValue,
      incurredAtIso: capturedIso,
    });
    const costDuplicateTarget = costDuplicate ? costDuplicate.duplicate_of || costDuplicate.id : null;
    await insertCostRecord({
      id: id('CST'),
      truckId: truckId || null,
      driverId: driverId || null,
      orderId: null,
      type: 'FUEL',
      amount: costValue,
      description: note ? `Fuel log ${fid}: ${note}` : `Fuel log ${fid}`,
      incurredAtIso: capturedIso,
      createdBy: req.user.id,
      isDuplicate: Boolean(costDuplicateTarget),
      duplicateOf: costDuplicateTarget,
      confirmedBy: costDuplicateTarget ? req.user.id : null,
    });
  }
  queueImageAudit({
    entityType: 'fuel_log',
    entityId: fid,
    imagePath: photoPath,
    expected: {
      truckId: truckId || null,
      litres: litresValue,
      cost: costValue,
      odometer: odometerValue,
      capturedAt: capturedIso,
    },
    description: 'Fuel receipt should show litres dispensed and total cost.',
  });
  const created = await g(`SELECT fl.*, t.plate, u.name as capturedBy, d.name as driverName
    FROM fuel_logs fl
    LEFT JOIN trucks t ON t.id=fl.truck_id
    LEFT JOIN drivers d ON d.id=fl.driver_id
    LEFT JOIN users u ON u.id=fl.created_by
    WHERE fl.id=?`, [fid]);
  res.status(201).json({
    id: created.id,
    truckId: created.truck_id,
    plate: created.plate,
    litres: created.litres!==null && created.litres!==undefined ? Number(created.litres) : null,
    odometer: created.odometer!==null && created.odometer!==undefined ? Number(created.odometer) : null,
    mileage: created.mileage!==null && created.mileage!==undefined ? Number(created.mileage) : null,
    cost: created.cost!==null && created.cost!==undefined ? Number(created.cost) : null,
    driverId: created.driver_id || null,
    driverName: created.driverName || null,
    photoPath: created.photo_path,
    note: created.note,
    capturedAt: created.captured_at,
    createdBy: created.capturedBy || null,
    duplicate: Boolean(fuelDuplicateTarget),
    duplicateOf: fuelDuplicateTarget || null,
    reviewedBy: created.reviewed_by !== null && created.reviewed_by !== undefined ? Number(created.reviewed_by) : null,
    reviewedAt: created.reviewed_at || null,
    reviewNote: created.review_note || null,
    voidedBy: created.voided_by !== null && created.voided_by !== undefined ? Number(created.voided_by) : null,
    voidedAt: created.voided_at || null,
    voidReason: created.void_reason || null,
    voided: Boolean(created.voided_at),
  });
});

// ===== AI INSIGHTS =====
app.get('/api/admin/ai/insights', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  try{
    let context = EMPTY_AI_CONTEXT;
    let cached = false;
    let generatedAt = null;
    let notice = null;
    let contextError = null;
    try{
      const ctxResult = await getAiContextSafe(Boolean(req.query?.fresh));
      context = ctxResult.context || context;
      cached = ctxResult.cached;
      generatedAt = ctxResult.generatedAt || null;
      notice = ctxResult.notice || null;
      contextError = ctxResult.error || null;
    }catch(err){
      contextError = err?.message || String(err);
      notice = notice || 'Using minimal context because live data could not be fetched.';
    }
    const alerts = deriveAlerts(context);
    let insights = fallbackInsights(context, alerts);
    if(openaiClient){
      try{
        const payload = buildAiPayload(context, alerts);
        const model = process.env.OPENAI_INSIGHTS_MODEL || 'llama3:8b';
        const completion = await runWithTimeout(
          (signal)=> openaiClient.chat.completions.create({
            model,
            temperature: 0.2,
            timeout: AI_INSIGHTS_TIMEOUT_MS,
            signal,
            messages: [
              { role:'system', content:'You are an operations analyst for a sand and aggregates logistics company. Be warm and concise. Respond with 3-5 bullets: Risks, Opportunities, Next actions. Mention truck plates/IDs for telemetry, speeding, or idle behaviour (use telemetryHistory and telemetryAlerts). Cite key numbers (totals, km/h, KES) succinctly. End with one tactical to-do.' },
              { role:'user', content: JSON.stringify(payload) },
            ],
          }),
          AI_INSIGHTS_TIMEOUT_MS,
          'ai-insights'
        );
        const aiText = completion?.choices?.[0]?.message?.content?.trim();
        if(aiText) insights = aiText;
      }catch(err){
        console.warn('OpenAI insight generation failed, using fallback', err?.message || err);
      }
    }
    const responsePayload = {
      insights,
      alerts,
      telemetry: context.telemetry,
      metrics: context.metrics,
      auditFlags: context.auditFlags,
      telemetryAlerts: context.telemetryAlerts,
      telemetryHistoryStats: context.telemetryHistoryStats,
      cached,
      generatedAt,
      notice: notice || contextError || null,
    };
    lastInsightsCache = { data: responsePayload, ts: Date.now() };
    res.json(responsePayload);
  }catch(e){
    const detail = e?.message || String(e);
    if(lastInsightsCache.data){
      return res.json({ ...lastInsightsCache.data, cached:true, notice:'Served cached insights due to an error.', error: detail });
    }
    res.status(500).json({ error:'AI failed', detail });
  }
});

app.post('/api/admin/ai/chat', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if(!prompt){
    return res.status(400).json({ error:'Enter a question for the assistant.' });
  }
  const rawHistory = Array.isArray(req.body?.history) ? req.body.history : [];
  const history = rawHistory
    .filter((item)=> item && typeof item.content === 'string' && typeof item.role === 'string')
    .slice(-6)
    .map((item)=> ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content.trim() }))
    .filter((item)=> item.content.length > 0 && item.content.length <= 2000);
  try{
    let context = EMPTY_AI_CONTEXT;
    let contextCached = false;
    let generatedAt = null;
    let contextNotice = null;
    try{
      const ctxResult = await getAiContextSafe(Boolean(req.body?.fresh));
      context = ctxResult.context || context;
      contextCached = ctxResult.cached;
      generatedAt = ctxResult.generatedAt || null;
      contextNotice = ctxResult.notice || null;
    }catch(err){
      contextNotice = err?.message || 'Using minimal context because live data could not be fetched.';
    }
    const alerts = deriveAlerts(context);
    const mentionedTrucks = getMentionedTrucks(prompt, context.truckLabels || {});
    const payload = buildAiChatPayload(context, alerts, mentionedTrucks);
    let answer = '';
    let followUp = '';
    let suggestions = [];
    if(openaiClient){
      try{
        const model = DEFAULT_AI_CHAT_MODEL;
        const messages = [
          {
            role:'system',
            content:'You are a friendly, concise operations analyst for a sand logistics company. Use ONLY the provided context JSON. Answer the user question directly. Format: one short sentence, then 2-4 hyphen bullets (\"- \") with specific plates/IDs and key figures/timestamps (km/h, KES, counts) from telemetry/telemetryHistory/telemetryAlerts. If asked about a specific truck/date, give that first. Finish with one line starting "Follow-up:" suggesting a next question. If info is missing, say so plainly.',
          },
          ...history.map((item)=> ({ role:item.role, content:item.content })),
          {
            role:'user',
            content:`Question: ${prompt}\nContext: ${JSON.stringify(payload)}`,
          },
        ];
        const completion = await runWithTimeout(
          (signal)=> openaiClient.chat.completions.create({ model, temperature:0.2, messages, timeout: AI_CHAT_TIMEOUT_MS, signal }),
          AI_CHAT_TIMEOUT_MS,
          'ai-chat'
        );
        const rawText = completion?.choices?.[0]?.message?.content?.trim();
        if(rawText){
          const followMatch = rawText.match(/Follow-up:\s*(.+)$/i);
          if(followMatch){
            followUp = followMatch[1].trim();
            answer = rawText.replace(/Follow-up:\s*(.+)$/i,'').trim();
          }else{
            answer = rawText;
          }
        }
      }catch(err){
        console.warn('AI chat generation failed, using fallback', err?.message || err);
      }
    }
    if(!answer){
      const fallback = buildFallbackChatAnswer(prompt, context);
      answer = fallback.answer;
      followUp = fallback.followUp;
    }
    if(!followUp){
      followUp = generateFollowUpFallback(prompt);
    }
    if(!followUp){
      followUp = generateFollowUpFallback(prompt);
    }
    suggestions = Array.from(new Set([
      followUp,
      generateFollowUpFallback(prompt),
      'Show latest telemetry alerts',
      'Compare today vs yesterday deliveries',
      'List trucks with highest idle time'
    ].filter(Boolean))).slice(0,3);
    res.json({ answer, followUp, suggestions, cachedContext: contextCached, generatedAt, notice: contextNotice || null });
  }catch(err){
    console.error('AI chat failed', err);
    res.status(500).json({ error:'AI chat failed', detail: err?.message || String(err) });
  }
});

async function buildDriverLeaderboard(days=7){
  const rows = await q(`
    SELECT a.driver_id as driverId,
           COALESCE(d.name, a.driver_id) as name,
           SUM(CASE WHEN a.status='Delivered' THEN 1 ELSE 0 END) as deliveredLoads,
           COUNT(a.id) as loadsTotal,
           SUM(a.tonnes) as tonnes,
           SUM(CASE WHEN t.capacity_t>0 THEN o.per_truck * (a.tonnes / t.capacity_t) ELSE o.per_truck END) as revenue
    FROM assignments a
    JOIN orders o ON o.id=a.order_id AND o.deleted_at IS NULL
    LEFT JOIN trucks t ON t.id=a.truck_id
    LEFT JOIN drivers d ON d.id=a.driver_id
    WHERE a.driver_id IS NOT NULL
      AND date(a.scheduled_at) >= date('now', ?)
    GROUP BY a.driver_id
    ORDER BY revenue DESC
  `, [`-${days} day`]);
  return rows.map(r=>({
    driverId: r.driverId,
    name: r.name,
    loads: Number(r.deliveredLoads ?? r.loadsTotal ?? 0),
    tonnes: Number(r.tonnes || 0),
    revenue: Number(r.revenue || 0),
  }));
}

async function driverEarningsWindow(fromOffset, toOffsetExclusive){
  return await q(`
    SELECT a.driver_id as driverId,
           COALESCE(d.name, a.driver_id) as name,
           SUM(CASE WHEN t.capacity_t>0 THEN o.per_truck * (a.tonnes / t.capacity_t) ELSE o.per_truck END) as revenue
    FROM assignments a
    JOIN orders o ON o.id=a.order_id AND o.deleted_at IS NULL
    LEFT JOIN trucks t ON t.id=a.truck_id
    LEFT JOIN drivers d ON d.id=a.driver_id
    WHERE a.driver_id IS NOT NULL
      AND date(a.scheduled_at) >= date('now', ?)
      AND date(a.scheduled_at) < date('now', ?)
      AND a.status IN ('Delivered','Completed')
    GROUP BY a.driver_id
  `, [fromOffset, toOffsetExclusive]);
}

function safeParseObject(value, label){
  if(!value) return {};
  try{
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  }catch(err){
    console.warn(`${label} is not valid JSON and will be ignored`);
    return {};
  }
}

function safeParseJSON(value){
  if(!value) return null;
  try{
    return JSON.parse(value);
  }catch{
    return null;
  }
}

function normaliseTokenPair(tokenValue){
  if(!tokenValue) return { bearer:null, access:null };
  const trimmed = String(tokenValue).trim();
  if(!trimmed) return { bearer:null, access:null };
  if(/^bearer\s+/i.test(trimmed)){
    return { bearer: trimmed, access: trimmed.replace(/^bearer\s+/i,'').trim() };
  }
  return { bearer: `Bearer ${trimmed}`, access: trimmed };
}

function normaliseTelemetryTime(value){
  if(!value && value !== 0) return isoNow();
  if(value instanceof Date){
    return value.toISOString();
  }
  if(typeof value === 'number'){
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  if(typeof value === 'string'){
    const trimmed = value.trim();
    if(!trimmed) return isoNow();
    if(/^\d+$/.test(trimmed)){
      const num = Number(trimmed);
      if(Number.isFinite(num)){
        const ms = trimmed.length >= 13 ? num : num * 1000;
        return new Date(ms).toISOString();
      }
    }
    const parsed = new Date(trimmed);
    if(Number.isFinite(parsed.getTime())){
      return parsed.toISOString();
    }
  }
  return isoNow();
}

function normaliseTelemetryCollection(payload){
  if(Array.isArray(payload)) return payload;
  if(Array.isArray(payload?.record)) return payload.record;
  if(Array.isArray(payload?.records)) return payload.records;
  if(Array.isArray(payload?.data)) return payload.data;
  if(Array.isArray(payload?.items)) return payload.items;
  if(Array.isArray(payload?.rows)) return payload.rows;
  if(Array.isArray(payload?.list)) return payload.list;
  if(Array.isArray(payload?.result)) return payload.result;
  if(payload?.record){
    if(Array.isArray(payload.record.items)) return payload.record.items;
    if(Array.isArray(payload.record.data)) return payload.record.data;
  }
  if(payload?.record && Array.isArray(payload.record?.list)) return payload.record.list;
  return [];
}

function normalisePlateKey(value){
  if(value === null || value === undefined) return '';
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalisePlateDisplay(value){
  const trimmed = String(value ?? '').trim().toUpperCase();
  if(!trimmed) return '';
  if(/\s/.test(trimmed)) return trimmed;
  const match = /^([A-Z]{3})(\d{3})([A-Z]?)(.*)$/.exec(trimmed);
  if(!match) return trimmed;
  const [, prefix, digits, suffix, rest] = match;
  const core = suffix ? `${prefix} ${digits}${suffix}` : `${prefix} ${digits}`;
  return rest ? `${core}${rest}` : core;
}

function numberOrNull(value){
  if(value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toIgnitionFlag(value){
  if(value === null || value === undefined) return null;
  if(typeof value === 'boolean') return value ? 1 : 0;
  if(typeof value === 'number') return value > 0 ? 1 : 0;
  if(typeof value === 'string'){
    const normalised = value.trim().toLowerCase();
    if(['1','true','on','yes','high','active'].includes(normalised)) return 1;
    if(['0','false','off','no','low','inactive'].includes(normalised)) return 0;
  }
  return null;
}

function resolveIgnitionState(...candidates){
  for(const candidate of candidates){
    if(candidate === null || candidate === undefined) continue;
    if(typeof candidate === 'object' && !Array.isArray(candidate)){
      const nestedValues = [
        candidate.value,
        candidate.state,
        candidate.status,
        candidate.ignition,
        candidate.engine,
        candidate.on,
        candidate.isOn,
        candidate.enabled,
      ];
      const nested = resolveIgnitionState(...nestedValues);
      if(nested !== null) return nested;
      continue;
    }
    if(typeof candidate === 'boolean') return candidate;
    const flag = toIgnitionFlag(candidate);
    if(flag === 1) return true;
    if(flag === 0) return false;
    if(typeof candidate === 'string'){
      const normalised = candidate.trim().toLowerCase();
      if(!normalised) continue;
      if(['running','started','ignition on','engine on','power on','active','enabled'].includes(normalised)){
        return true;
      }
      if(['stopped','parked','shutdown','ignition off','engine off','power off','inactive','disabled'].includes(normalised)){
        return false;
      }
    }
  }
  return null;
}

function deriveVehicleStatus({ speed=null, engineOn=null, idleFlag=null, baseStatus='' } = {}){
  const numericSpeed = Number(speed);
  const hasSpeed = Number.isFinite(numericSpeed);
  const stationary = hasSpeed ? Math.abs(numericSpeed) <= TELEMETRY_IDLE_SPEED_KPH : null;
  const moving = hasSpeed ? numericSpeed > TELEMETRY_MOVING_SPEED_KPH : null;
  const idleHint = typeof idleFlag === 'boolean' ? idleFlag : null;
  const base = typeof baseStatus === 'string' ? baseStatus.trim().toLowerCase() : '';

  if(moving === true){
    return 'In transit';
  }

  if(engineOn === false){
    return 'Off';
  }

  if(engineOn === true){
    if(stationary === false){
      return 'In transit';
    }
    return 'Idle';
  }

  if(base){
    if(base.includes('off') || base.includes('shutdown') || base.includes('parked')){
      return 'Off';
    }
    if(base.includes('transit') || base.includes('moving') || base.includes('driving') || base.includes('en route') || base.includes('enroute')){
      return 'In transit';
    }
    if(base.includes('idle') || base.includes('idling')){
      if(stationary === false){
        return 'In transit';
      }
      return 'Idle';
    }
  }

  if(idleHint === true && stationary !== false){
    return 'Idle';
  }

  if(stationary === true){
    return 'Idle';
  }

  if(moving === true){
    return 'In transit';
  }

  if(engineOn === false){
    return 'Off';
  }

  return 'Idle';
}

function generateCartrackTruckId(vehicleId, plateKey){
  const prefix = 'cartrack-';
  if(vehicleId) return `${prefix}${String(vehicleId)}`;
  if(plateKey) return `${prefix}${plateKey}`;
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

function mapCartrackStatusToTelemetry(status, truck, lastUpdatedOverride=null){
  const lat = numberOrNull(status?.location?.latitude);
  const lng = numberOrNull(status?.location?.longitude);
  const speed = numberOrNull(status?.speed);
  const heading = numberOrNull(status?.bearing);
  const ignition = resolveIgnitionState(status?.ignition, truck?.cartrackLastIgnition);
  const idling = status?.idling === null || status?.idling === undefined ? null : Boolean(status?.idling);
  const driver = status?.driver || {};
  const address = status?.location?.position_description || status?.location?.address || '';
  const lastUpdated = lastUpdatedOverride || normaliseTelemetryTime(status?.location?.updated || status?.event_ts);
  const baseStatus = status?.status || status?.vehicle_status || status?.vehicleStatus || status?.movement_status || '';
  const statusLabel = deriveVehicleStatus({ speed, engineOn: ignition, idleFlag: idling, baseStatus });
  const idleMinutes = idleMinutesForTelemetry({
    lastUpdated,
    speed,
    engineOn: ignition,
    idling,
    status: statusLabel,
  });

  return {
    truckId: truck?.id || status?.vehicle_id || status?.registration || null,
    plate: truck?.plate || status?.registration || (truck?.id ?? 'Unknown'),
    driverId: truck?.primaryDriverId || null,
    driverName: truck?.driverName || driver?.name || driver?.driver_name || null,
    driverPhone: truck?.driverPhone || driver?.phone || null,
    driverEmail: truck?.driverEmail || driver?.email || null,
    capacityT: truck?.capacityT ?? null,
    lat,
    lng,
    speed,
    heading,
    status: statusLabel,
    address: typeof address === 'string' ? address : '',
    lastUpdated,
    idleMinutes,
    source: 'cartrack',
    engineOn: ignition,
  };
}

async function fetchCartrackTelemetry(existingTrucks=[], { now, snapshotMap } = {}){
  const baseTrucks = Array.isArray(existingTrucks) ? [...existingTrucks] : [];
  let statuses;
  try{
    statuses = await getFleetVehicleStatuses({ odometer_in_km: 'true' });
  }catch(err){
    throw Object.assign(new Error(`Cartrack telemetry request failed: ${err?.message || err}`), { cause: err });
  }
  if(!Array.isArray(statuses) || statuses.length === 0){
    const fallback = baseTrucks.length ? synthesiseTelemetry(baseTrucks, { snapshotMap, now }) : [];
    return { telemetry: fallback, trucks: baseTrucks };
  }

  const trucksById = new Map(baseTrucks.map((truck)=> [String(truck.id), truck]));
  const trucksByVehicleId = new Map();
  const trucksByPlate = new Map();
  for(const truck of baseTrucks){
    if(truck?.cartrackVehicleId){
      trucksByVehicleId.set(String(truck.cartrackVehicleId), truck);
    }
    const plateKey = normalisePlateKey(truck?.plate || truck?.cartrackRegistration);
    if(plateKey){
      trucksByPlate.set(plateKey, truck);
    }
  }

  const telemetry = [];
  const seenTruckIds = new Set();
  const isoTimestamp = Number.isFinite(now) ? new Date(now).toISOString() : isoNow();
  const defaultCapacity = Number(process.env.CARTRACK_DEFAULT_CAPACITY_T || 20) || 0;

  for(const status of statuses){
    if(!status) continue;
    const vehicleId = status?.vehicle_id ? String(status.vehicle_id) : null;
    const registrationRaw = status?.registration ? String(status.registration).trim() : '';
    const plateKey = normalisePlateKey(registrationRaw);
    let truck = null;
    if(vehicleId && trucksByVehicleId.has(vehicleId)){
      truck = trucksByVehicleId.get(vehicleId);
    }else if(plateKey && trucksByPlate.has(plateKey)){
      truck = trucksByPlate.get(plateKey);
    }

    const lat = numberOrNull(status?.location?.latitude);
    const lng = numberOrNull(status?.location?.longitude);
    const speed = numberOrNull(status?.speed);
    const heading = numberOrNull(status?.bearing);
    const ignitionFlag = toIgnitionFlag(status?.ignition);
    const lastUpdated = normaliseTelemetryTime(status?.location?.updated || status?.event_ts);

    if(!truck){
      let candidateId = generateCartrackTruckId(vehicleId, plateKey);
      while(trucksById.has(candidateId)){
        candidateId = generateCartrackTruckId(vehicleId, `${plateKey}${Math.random().toString(36).slice(2, 6)}`);
      }
      const newPlate = registrationRaw || candidateId.toUpperCase();
      await run(
        `INSERT OR IGNORE INTO trucks (
          id, plate, capacity_t, primary_driver_id,
          cartrack_vehicle_id, cartrack_registration,
          cartrack_last_status_at, cartrack_last_lat, cartrack_last_lng,
          cartrack_last_speed, cartrack_last_heading, cartrack_last_ignition,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          candidateId,
          newPlate,
          defaultCapacity,
          null,
          vehicleId || null,
          registrationRaw || null,
          lastUpdated,
          lat,
          lng,
          speed,
          heading,
          ignitionFlag,
          isoTimestamp,
          isoTimestamp,
        ]
      );
      truck = {
        id: candidateId,
        plate: newPlate,
        capacityT: defaultCapacity,
        primaryDriverId: null,
        driverName: null,
        driverPhone: null,
        driverEmail: null,
        createdAt: isoTimestamp,
        updatedAt: isoTimestamp,
        cartrackVehicleId: vehicleId || null,
        cartrackRegistration: registrationRaw || null,
        cartrackLastStatusAt: lastUpdated,
        cartrackLastLat: lat,
        cartrackLastLng: lng,
        cartrackLastSpeed: speed,
        cartrackLastHeading: heading,
        cartrackLastIgnition: ignitionFlag,
      };
      baseTrucks.push(truck);
      trucksById.set(truck.id, truck);
      if(vehicleId) trucksByVehicleId.set(vehicleId, truck);
      if(plateKey) trucksByPlate.set(plateKey, truck);
    }else{
      const updates = [];
      const params = [];
      const applyUpdate = (column, value, prop)=>{
        const current = truck[prop] ?? null;
        const next = value ?? null;
        if(current === next) return;
        updates.push(`${column}=?`);
        params.push(value);
        truck[prop] = value;
      };
      if(vehicleId){
        applyUpdate('cartrack_vehicle_id', vehicleId, 'cartrackVehicleId');
        trucksByVehicleId.set(vehicleId, truck);
      }
      if(registrationRaw){
        applyUpdate('cartrack_registration', registrationRaw, 'cartrackRegistration');
        if(!truck.plate || normalisePlateKey(truck.plate) !== plateKey){
          applyUpdate('plate', registrationRaw, 'plate');
        }
        trucksByPlate.set(plateKey, truck);
      }
      applyUpdate('cartrack_last_status_at', lastUpdated, 'cartrackLastStatusAt');
      applyUpdate('cartrack_last_lat', lat, 'cartrackLastLat');
      applyUpdate('cartrack_last_lng', lng, 'cartrackLastLng');
      applyUpdate('cartrack_last_speed', speed, 'cartrackLastSpeed');
      applyUpdate('cartrack_last_heading', heading, 'cartrackLastHeading');
      applyUpdate('cartrack_last_ignition', ignitionFlag, 'cartrackLastIgnition');
      if(updates.length){
        updates.push('updated_at=?');
        params.push(isoTimestamp);
        await run(`UPDATE trucks SET ${updates.join(', ')} WHERE id=?`, [...params, truck.id]);
      }
    }

    const telemetryItem = mapCartrackStatusToTelemetry(status, truck, lastUpdated);
    telemetry.push(telemetryItem);
    seenTruckIds.add(truck.id);
  }

  if(!telemetry.length){
    const fallback = baseTrucks.length ? synthesiseTelemetry(baseTrucks, { snapshotMap, now }) : [];
    return { telemetry: fallback, trucks: baseTrucks };
  }

  for(const truck of baseTrucks){
    if(seenTruckIds.has(truck.id)) continue;
    const fallbackStatus = truck.cartrackVehicleId ? 'No recent data' : 'Unavailable';
    const fallbackEngineOn = resolveIgnitionState(truck.cartrackLastIgnition);
    const fallbackSpeed = numberOrNull(truck.cartrackLastSpeed);
    const fallbackIdleMinutes = idleMinutesForTelemetry({
      lastUpdated: truck.cartrackLastStatusAt || null,
      speed: fallbackSpeed,
      engineOn: fallbackEngineOn,
      status: fallbackStatus,
    });
    telemetry.push({
      truckId: truck.id,
      plate: truck.plate,
      driverId: truck.primaryDriverId || null,
      driverName: truck.driverName || null,
      driverPhone: truck.driverPhone || null,
      driverEmail: truck.driverEmail || null,
      capacityT: truck.capacityT ?? null,
      lat: numberOrNull(truck.cartrackLastLat),
      lng: numberOrNull(truck.cartrackLastLng),
      speed: fallbackSpeed,
      heading: numberOrNull(truck.cartrackLastHeading),
      status: fallbackStatus,
      address: '',
      lastUpdated: truck.cartrackLastStatusAt || null,
      idleMinutes: fallbackIdleMinutes,
      source: truck.cartrackVehicleId ? 'cartrack' : 'local',
      engineOn: fallbackEngineOn,
    });
  }

  telemetry.sort((a,b)=>{
    const plateA = a.plate || '';
    const plateB = b.plate || '';
    return plateA.localeCompare(plateB, undefined, { sensitivity: 'base' });
  });
  return { telemetry, trucks: baseTrucks };
}

function isProtrackConfigured(){
  return Boolean(
    (process.env.PROTRACK_TRACK_IMEIS && process.env.PROTRACK_TRACK_IMEIS.trim()) ||
    (process.env.PROTRACK_IMEIS && process.env.PROTRACK_IMEIS.trim()) ||
    (process.env.PROTRACK_API_TOKEN && process.env.PROTRACK_API_TOKEN.trim()) ||
    (process.env.PROTRACK_ACCOUNT && process.env.PROTRACK_ACCOUNT.trim()) ||
    (process.env.PROTRACK_PASSWORD && process.env.PROTRACK_PASSWORD.trim()) ||
    (process.env.PROTRACK_AUTH_URL && process.env.PROTRACK_AUTH_URL.trim()) ||
    (process.env.PROTRACK_TRACK_URL && process.env.PROTRACK_TRACK_URL.trim()) ||
    (process.env.PROTRACK_BASE_URL && process.env.PROTRACK_BASE_URL.trim()) ||
    (process.env.PROTRACK_API_URL && process.env.PROTRACK_API_URL.trim())
  );
}

function buildTelemetryKey(item){
  if(!item) return null;
  const plateKey = normalisePlateKey(item.plate);
  if(plateKey){
    return `plate:${plateKey}`;
  }
  if(item.truckId !== null && item.truckId !== undefined){
    const id = String(item.truckId).trim().toLowerCase();
    if(id){
      return `id:${id}`;
    }
  }
  return null;
}

function mergeTelemetryLists(primary=[], secondary=[]){
  const result = [];
  const indexByKey = new Map();
  const pushItem = (item)=>{
    if(!item) return;
    const key = buildTelemetryKey(item);
    if(key){
      if(indexByKey.has(key)){
        const existingIndex = indexByKey.get(key);
        const current = result[existingIndex];
        if(compareTelemetryPriority(item, current) > 0){
          result[existingIndex] = item;
        }
        return;
      }
      indexByKey.set(key, result.length);
    }else{
      indexByKey.set(`idx:${result.length}`, result.length);
    }
    result.push(item);
  };
  primary.forEach(pushItem);
  secondary.forEach(pushItem);
  result.sort((a,b)=>{
    const plateA = a?.plate || '';
    const plateB = b?.plate || '';
    return plateA.localeCompare(plateB, undefined, { sensitivity: 'base' });
  });
  return result;
}

function telemetryPriorityValue(item){
  if(!item) return 0;
  const source = String(item.source || '').toLowerCase();
  if(source === 'protrack') return 30;
  if(source === 'cartrack') return 20;
  if(source === 'local') return 5;
  return 10;
}

function compareTelemetryPriority(next, current){
  const diff = telemetryPriorityValue(next) - telemetryPriorityValue(current);
  if(diff !== 0) return diff;
  const nextHasCoords = Number.isFinite(next?.lat) && Number.isFinite(next?.lng);
  const currentHasCoords = Number.isFinite(current?.lat) && Number.isFinite(current?.lng);
  if(nextHasCoords !== currentHasCoords){
    return nextHasCoords ? 1 : -1;
  }
  const nextHasSpeed = Number.isFinite(next?.speed);
  const currentHasSpeed = Number.isFinite(current?.speed);
  if(nextHasSpeed !== currentHasSpeed){
    return nextHasSpeed ? 1 : -1;
  }
  return 0;
}

function resolveTelemetryHideCriteria(){
  const plateRaw = `${process.env.TELEMETRY_HIDE_PLATES || ''},${process.env.FLEET_HIDE_PLATES || ''}`;
  const idRaw = `${process.env.TELEMETRY_HIDE_TRUCK_IDS || ''},${process.env.FLEET_HIDE_TRUCK_IDS || ''}`;
  const plateSet = new Set(
    plateRaw
      .split(',')
      .map((value)=> normalisePlateKey(value))
      .filter(Boolean)
  );
  const idSet = new Set(
    idRaw
      .split(',')
      .map((value)=> (value === null || value === undefined ? '' : String(value).trim().toLowerCase()))
      .filter(Boolean)
  );
  return { plateSet, idSet };
}

function filterHiddenTelemetry(list){
  if(!Array.isArray(list) || !list.length) return Array.isArray(list) ? list : [];
  const { plateSet, idSet } = resolveTelemetryHideCriteria();
  if(!plateSet.size && !idSet.size) return list;
  return list.filter((item)=>{
    if(!item) return false;
    const plateKey = normalisePlateKey(item.plate);
    if(plateKey && plateSet.has(plateKey)) return false;
    if(item.truckId !== null && item.truckId !== undefined){
      const idKey = String(item.truckId).trim().toLowerCase();
      if(idKey && idSet.has(idKey)) return false;
    }
    return true;
  });
}

function hasMeaningfulAddress(address){
  if(!address) return false;
  const value = String(address).trim();
  if(!value) return false;
  const lower = value.toLowerCase();
  const genericValues = new Set(['unknown','n/a','na','none','null','central','central region','central province','kenya']);
  if(genericValues.has(lower)) return false;
  // One-word region labels are usually too broad; prefer a reverse geocode instead.
  if(!value.includes(',') && value.split(/\s+/).length === 1 && value.length <= 12){
    return false;
  }
  return true;
}

async function enrichTelemetryAddresses(list){
  if(!Array.isArray(list) || !list.length) return Array.isArray(list) ? list : [];
  const enriched = await Promise.all(list.map(async(item)=>{
    if(!item) return item;
    const existingAddress = typeof item.address === 'string' ? item.address.trim() : '';
    const needsReverseGeocode = !hasMeaningfulAddress(existingAddress);
    if(!needsReverseGeocode) return item;
    if(item.source && !['protrack','cartrack'].includes(String(item.source).toLowerCase())) return item;
    const latNum = Number(item.lat);
    const lonNum = Number(item.lng);
    if(!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return item;
    const label = await reverseGeocode(latNum, lonNum);
    if(label){
      return { ...item, address: label };
    }
    if(existingAddress){
      return { ...item, address: existingAddress };
    }
    return item;
  }));
  return enriched;
}

function fillTelemetryCoordinates(list, trucksList, fallbackList=null){
  if(!Array.isArray(list) || !list.length) return Array.isArray(list) ? list : [];
  const trucks = Array.isArray(trucksList) ? trucksList : [];
  const byId = new Map();
  const byPlate = new Map();
  for(const truck of trucks){
    if(!truck) continue;
    const idKey = truck.id ? String(truck.id).trim().toLowerCase() : null;
    if(idKey && !byId.has(idKey)){
      byId.set(idKey, truck);
    }
    const plateKey = normalisePlateKey(truck.plate);
    if(plateKey && !byPlate.has(plateKey)){
      byPlate.set(plateKey, truck);
    }
    const registrationKey = normalisePlateKey(truck.cartrackRegistration);
    if(registrationKey && !byPlate.has(registrationKey)){
      byPlate.set(registrationKey, truck);
    }
  }

  const syntheticFallback = Array.isArray(fallbackList) && fallbackList.length
    ? fallbackList
    : synthesiseTelemetry(trucks);
  const syntheticById = new Map();
  const syntheticByPlate = new Map();
  for(const item of syntheticFallback){
    if(!item) continue;
    const idKey = item.truckId ? String(item.truckId).trim().toLowerCase() : null;
    if(idKey && !syntheticById.has(idKey)){
      syntheticById.set(idKey, item);
    }
    const plateKey = normalisePlateKey(item.plate || item.truckId || '');
    if(plateKey && !syntheticByPlate.has(plateKey)){
      syntheticByPlate.set(plateKey, item);
    }
  }

  return list.map((item, idx)=>{
    if(!item) return item;
    const latNum = Number(item.lat);
    const lngNum = Number(item.lng);
    if(Number.isFinite(latNum) && Number.isFinite(lngNum)) return item;
    const idKey = item.truckId ? String(item.truckId).trim().toLowerCase() : null;
    let truck = null;
    if(idKey && byId.has(idKey)){
      truck = byId.get(idKey);
    }else{
      const plateKey = normalisePlateKey(item.plate || item.truckId || '');
      if(plateKey && byPlate.has(plateKey)){
        truck = byPlate.get(plateKey);
      }
    }
    if(truck){
      const fallbackLat = numberOrNull(truck.cartrackLastLat);
      const fallbackLng = numberOrNull(truck.cartrackLastLng);
      if(Number.isFinite(fallbackLat) && Number.isFinite(fallbackLng)){
        return { ...item, lat: fallbackLat, lng: fallbackLng };
      }
    }
    const syntheticKey = idKey && syntheticById.has(idKey) ? syntheticById.get(idKey) : null;
    let synthetic = syntheticKey;
    if(!synthetic){
      const plateKey = normalisePlateKey(item.plate || item.truckId || '');
      if(plateKey && syntheticByPlate.has(plateKey)){
        synthetic = syntheticByPlate.get(plateKey);
      }
    }
    if(synthetic && Number.isFinite(synthetic.lat) && Number.isFinite(synthetic.lng)){
      return { ...item, lat: synthetic.lat, lng: synthetic.lng };
    }
    const idxFallback = syntheticFallback[idx];
    if(idxFallback && Number.isFinite(idxFallback.lat) && Number.isFinite(idxFallback.lng)){
      return { ...item, lat: idxFallback.lat, lng: idxFallback.lng };
    }
    return item;
  });
}

async function recordTelemetrySnapshots(list, { now } = {}){
  if(!Array.isArray(list) || !list.length) return;
  const nowIso = Number.isFinite(now) ? new Date(now).toISOString() : isoNow();
  for(const item of list){
    const truckId = item?.truckId ? String(item.truckId).trim() : '';
    if(!truckId) continue;
    const capturedAt = item?.lastUpdated && item.lastUpdated.trim() ? item.lastUpdated : nowIso;
    const lat = Number.isFinite(Number(item?.lat)) ? Number(item.lat) : null;
    const lng = Number.isFinite(Number(item?.lng)) ? Number(item.lng) : null;
    const speed = Number.isFinite(Number(item?.speed)) ? Number(item.speed) : null;
    const heading = Number.isFinite(Number(item?.heading)) ? Number(item.heading) : null;
    const idleMinutes = Number.isFinite(Number(item?.idleMinutes)) ? Number(item.idleMinutes) : null;
    const engineOn = item?.engineOn === true ? 1 : item?.engineOn === false ? 0 : null;
    let lastSnapshot = null;
    try{
      lastSnapshot = await g(
        `SELECT lat,lng,speed,status,captured_at,address,ignition_on FROM telemetry_snapshots
         WHERE truck_id=?
         ORDER BY captured_at DESC
         LIMIT 1`,
        [truckId]
      );
      const sameCoords =
        lastSnapshot &&
        lat !== null &&
        lng !== null &&
        Number.isFinite(Number(lastSnapshot.lat)) &&
        Number.isFinite(Number(lastSnapshot.lng)) &&
        Math.abs(Number(lastSnapshot.lat) - lat) < 0.0001 &&
        Math.abs(Number(lastSnapshot.lng) - lng) < 0.0001;
      const sameSpeed =
        lastSnapshot &&
        speed !== null &&
        Number.isFinite(Number(lastSnapshot.speed)) &&
        Math.abs(Number(lastSnapshot.speed) - speed) < 0.5;
      const sameStatus = lastSnapshot && (lastSnapshot.status || '') === (item?.status || '');
      const sameCapture = lastSnapshot && lastSnapshot.captured_at === capturedAt;
      // Also treat ignition state change as a distinct snapshot worth recording
      const lastIgnition = lastSnapshot?.ignition_on ?? null;
      const sameIgnition = lastIgnition === engineOn;
      if(sameCoords && sameSpeed && sameStatus && sameCapture && sameIgnition){
        continue;
      }
      if(lat === null && lng === null && !lastSnapshot && item?.status === 'Unavailable'){
        continue;
      }
    }catch(err){
      console.warn('Telemetry history lookup failed', err);
    }
    await maybeQueueSpeedingAlert({ telemetryItem:item, speed, capturedAt });
    const payload = {
      source: item?.source || null,
      status: item?.status || null,
      speed,
      heading,
      idleMinutes,
      address: item?.address || null,
      ignitionOn: engineOn,
    };
    try{
      await run(
        `INSERT INTO telemetry_snapshots (
          id, truck_id, lat, lng, speed, status, heading, source, address, idle_minutes, plate,
          captured_at, raw, created_at, ignition_on
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id('TSN'),
          truckId,
          lat,
          lng,
          speed,
          item?.status || null,
          heading,
          item?.source || null,
          item?.address || null,
          idleMinutes,
          item?.plate || null,
          capturedAt,
          JSON.stringify(payload),
          nowIso,
          engineOn,
        ]
      );
    }catch(err){
      console.error('Failed to record telemetry snapshot', err);
    }
  }
}

function triggerTelemetryAnalysis({ now } = {}){
  if(!openaiClient) return;
  const ts = Number.isFinite(now) ? now : Date.now();
  if(telemetryAnalysisState.pending) return;
  if(ts - telemetryAnalysisState.lastRun < TELEMETRY_AI_ANALYSIS_INTERVAL_MS) return;
  telemetryAnalysisState.pending = true;
  setTimeout(async ()=>{
    try{
      await analyzeTelemetrySnapshots({ now: ts });
      telemetryAnalysisState.lastRun = Date.now();
    }catch(err){
      console.error('Telemetry AI analysis failed', err);
    }finally{
      telemetryAnalysisState.pending = false;
    }
  }, 0);
}

async function analyzeTelemetrySnapshots({ now } = {}){
  if(!openaiClient) return;
  const windowMinutes = Math.max(TELEMETRY_AI_LOOKBACK_MINUTES, TELEMETRY_AI_MIN_POINTS);
  const sinceIso = new Date((Number.isFinite(now) ? now : Date.now()) - windowMinutes * 60_000).toISOString();
  let rows = [];
  try{
    rows = await q(
      `SELECT truck_id, lat, lng, speed, status, address, idle_minutes, source, captured_at
       FROM telemetry_snapshots
       WHERE captured_at >= ?
       ORDER BY truck_id, captured_at`,
      [sinceIso]
    );
  }catch(err){
    console.error('Failed to load telemetry history for AI analysis', err);
    return;
  }
  if(!rows.length) return;
  const grouped = new Map();
  for(const row of rows){
    if(!row?.truck_id) continue;
    const key = String(row.truck_id).trim();
    if(!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  for(const [truckId, entriesRaw] of grouped.entries()){
    const entries = entriesRaw.slice(-Math.max(TELEMETRY_AI_MIN_POINTS, TELEMETRY_AI_MAX_POINTS));
    if(entries.length < TELEMETRY_AI_MIN_POINTS) continue;
    const limited = entries.slice(-TELEMETRY_AI_MAX_POINTS);
    const dataPoints = limited.map((entry)=>({
      captured_at: entry.captured_at,
      lat: entry.lat === null || entry.lat === undefined ? null : Number(entry.lat),
      lng: entry.lng === null || entry.lng === undefined ? null : Number(entry.lng),
      speed_kmh: entry.speed === null || entry.speed === undefined ? null : Number(entry.speed),
      status: entry.status || null,
      address: entry.address || null,
      source: entry.source || null,
      idle_minutes: entry.idle_minutes === null || entry.idle_minutes === undefined ? null : Number(entry.idle_minutes),
    }));
    const windowStart = dataPoints[0]?.captured_at || sinceIso;
    const windowEnd = dataPoints[dataPoints.length - 1]?.captured_at || isoNow();
    const aiResult = await requestTelemetryAiInsights(truckId, dataPoints);
    if(!aiResult) continue;
    if(Array.isArray(aiResult.anomalies)){
      for(const anomaly of aiResult.anomalies){
        const summary = typeof anomaly?.summary === 'string' ? anomaly.summary.trim() : '';
        if(!summary) continue;
        const confidence = Number(anomaly?.confidence);
        if(Number.isFinite(confidence) && confidence < TELEMETRY_AI_MIN_ANOMALY_CONFIDENCE) continue;
        const alertType = String(anomaly?.type || 'anomaly').trim().toLowerCase().replace(/\s+/g, '_');
        const severity = String(anomaly?.severity || 'medium').trim().toLowerCase();
        const timestamp = typeof anomaly?.timestamp === 'string' && anomaly.timestamp ? anomaly.timestamp : windowEnd;
        try{
          const duplicate = await g(
            `SELECT id FROM telemetry_ai_alerts
             WHERE truck_id=? AND alert_type=? AND summary=?
               AND datetime(created_at) >= datetime(?, '-6 hours')`,
            [truckId, alertType, summary, timestamp || windowEnd]
          );
          if(duplicate) continue;
        }catch(err){
          console.warn('AI alert duplicate check failed', err);
        }
        try{
          await run(
            `INSERT INTO telemetry_ai_alerts (
              id, truck_id, alert_type, severity, confidence, summary,
              window_start, window_end, model, raw, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [
              id('TIA'),
              truckId,
              alertType || 'anomaly',
              severity || 'medium',
              Number.isFinite(confidence) ? confidence : null,
              summary.slice(0, 480),
              windowStart,
              windowEnd,
              TELEMETRY_AI_MODEL,
              JSON.stringify({ dataPoints, anomaly, all: aiResult }),
              isoNow(),
            ]
          );
        }catch(err){
          console.error('Failed to insert telemetry AI alert', err);
        }
      }
    }
    if(Array.isArray(aiResult.patterns) && aiResult.patterns.length){
      const primaryPattern = aiResult.patterns[0];
      const summary = typeof primaryPattern?.summary === 'string' ? primaryPattern.summary.trim() : '';
      if(summary){
        try{
          await run(
            `INSERT INTO telemetry_ai_alerts (
              id, truck_id, alert_type, severity, confidence, summary,
              window_start, window_end, model, raw, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [
              id('TIP'),
              truckId,
              'pattern',
              'info',
              Number.isFinite(Number(primaryPattern?.confidence)) ? Number(primaryPattern.confidence) : null,
              summary.slice(0, 480),
              windowStart,
              windowEnd,
              TELEMETRY_AI_MODEL,
              JSON.stringify({ dataPoints, pattern: primaryPattern, all: aiResult }),
              isoNow(),
            ]
          );
        }catch(err){
          console.error('Failed to insert telemetry pattern insight', err);
        }
      }
    }
  }
}

async function requestTelemetryAiInsights(truckId, dataPoints){
  if(!openaiClient || !Array.isArray(dataPoints) || !dataPoints.length) return null;
  const systemPrompt = [
    'You are an operations analyst for a logistics fleet.',
    'Identify route patterns and anomalies (route deviation, unexpected stop, speed anomaly, off_hours_activity).',
    'Respond strictly with JSON having keys: patterns (array), anomalies (array), notes (string).',
    'Each pattern object: { "summary": string, "confidence": number }.',
    'Each anomaly object: { "type": string, "summary": string, "severity": "low"|"medium"|"high", "confidence": number, "timestamp": ISO8601 string, "details": string }.',
    'If there are no anomalies, return an empty array for anomalies.',
  ].join(' ');
  const payload = JSON.stringify({
    truckId,
    dataPoints,
  });
  const messages = [
    { role:'system', content: systemPrompt },
    { role:'user', content: `Analyze the following telemetry history JSON and produce patterns/anomalies:\n${payload}` },
  ];
  try{
    const completion = await openaiClient.chat.completions.create({
      model: TELEMETRY_AI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages,
    });
    const content = completion?.choices?.[0]?.message?.content;
    if(!content) return null;
    const parsed = safeParseJSON(content);
    if(parsed && typeof parsed === 'object'){
      return parsed;
    }
  }catch(err){
    console.warn('Telemetry AI OpenAI call failed', err);
  }
  return null;
}

function buildProtrackImeiAssociations(trucksList=[]){
  const overrides = safeParseObject(process.env.PROTRACK_TRUCK_IMEI_MAP, 'PROTRACK_TRUCK_IMEI_MAP');
  const trucksById = new Map();
  const trucksByPlateKey = new Map();
  for(const truck of trucksList){
    if(!truck) continue;
    trucksById.set(String(truck.id), truck);
    const plateKey = normalisePlateKey(truck.plate);
    if(plateKey) trucksByPlateKey.set(plateKey, truck);
    const registrationKey = normalisePlateKey(truck.cartrackRegistration);
    if(registrationKey) trucksByPlateKey.set(registrationKey, truck);
  }
  const imeiToTruck = new Map();
  const imeiToPlate = new Map();
  for(const [rawKey, rawImei] of Object.entries(overrides)){
    const imei = rawImei ? String(rawImei).trim() : '';
    if(!imei) continue;
    const key = String(rawKey ?? '').trim();
    const displayPlate = normalisePlateDisplay(key);
    const normalizedKey = normalisePlateKey(key);
    let truck = null;
    if(key && trucksById.has(key)){
      truck = trucksById.get(key);
    }else if(normalizedKey && trucksByPlateKey.has(normalizedKey)){
      truck = trucksByPlateKey.get(normalizedKey);
    }
    if(truck){
      imeiToTruck.set(imei, truck);
      if(displayPlate){
        imeiToPlate.set(imei, displayPlate);
      }
    }else if(displayPlate){
      imeiToPlate.set(imei, displayPlate);
    }
  }
  return { imeiToTruck, imeiToPlate, overrides };
}

async function ensureProtrackMappedTrucks(trucksList=[], { now } = {}){
  const { overrides } = buildProtrackImeiAssociations(trucksList);
  if(!overrides || !Object.keys(overrides).length){
    return Array.isArray(trucksList) ? trucksList : [];
  }

  const baseTrucks = Array.isArray(trucksList) ? trucksList : [];
  const trucksById = new Map();
  const trucksByPlateKey = new Map();
  for(const truck of baseTrucks){
    if(!truck) continue;
    trucksById.set(String(truck.id), truck);
    const plateKey = normalisePlateKey(truck.plate);
    if(plateKey) trucksByPlateKey.set(plateKey, truck);
  }

  const defaultCapacity =
    Number(process.env.PROTRACK_DEFAULT_CAPACITY_T ||
      process.env.CARTRACK_DEFAULT_CAPACITY_T ||
      process.env.TRUCK_UNIT_TONNES ||
      TRUCK_UNIT_TONNES) || 0;
  const isoTimestamp = Number.isFinite(now) ? new Date(now).toISOString() : isoNow();

  for(const [rawKey] of Object.entries(overrides)){
    const label = String(rawKey ?? '').trim();
    if(!label) continue;
    const displayPlate = normalisePlateDisplay(label);
    const plateKey = normalisePlateKey(displayPlate);
    let truck = trucksById.get(label);
    if(!truck && plateKey && trucksByPlateKey.has(plateKey)){
      truck = trucksByPlateKey.get(plateKey);
    }
    if(!truck){
      const truckId = label;
      await run(
        `INSERT OR IGNORE INTO trucks (
          id, plate, capacity_t, primary_driver_id,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?)`,
        [
          truckId,
          displayPlate || truckId,
          defaultCapacity,
          null,
          isoTimestamp,
          isoTimestamp,
        ]
      );
      truck = {
        id: truckId,
        plate: displayPlate || truckId,
        capacityT: defaultCapacity,
        primaryDriverId: null,
        driverName: null,
        driverPhone: null,
        driverEmail: null,
        createdAt: isoTimestamp,
        updatedAt: isoTimestamp,
        cartrackVehicleId: null,
        cartrackRegistration: null,
        cartrackLastStatusAt: null,
        cartrackLastLat: null,
        cartrackLastLng: null,
        cartrackLastSpeed: null,
        cartrackLastHeading: null,
        cartrackLastIgnition: null,
      };
      baseTrucks.push(truck);
      trucksById.set(truck.id, truck);
      if(plateKey){
        trucksByPlateKey.set(plateKey, truck);
      }
    }else if(displayPlate && truck.plate !== displayPlate){
      truck.plate = displayPlate;
      await run(
        `UPDATE trucks
         SET plate=?, updated_at=?
         WHERE id=?`,
        [displayPlate, isoTimestamp, truck.id]
      );
    }
    if(truck && (truck.capacityT === undefined || truck.capacityT === null)){
      truck.capacityT = defaultCapacity;
    }
  }
  return baseTrucks;
}

function extractImeiFromTelemetry(item){
  const candidates = [
    item?.imei,
    item?.IMEI,
    item?.imeiNo,
    item?.deviceImei,
    item?.deviceID,
    item?.device?.imei,
    item?.device?.IMEI,
    item?.device?.imeiNo,
    item?.terminalImei,
    item?.terminal?.imei,
  ];
  for(const candidate of candidates){
    if(candidate === null || candidate === undefined) continue;
    const str = String(candidate).trim();
    if(str) return str;
  }
  return null;
}

async function fetchProtrackTelemetry(trucks=[], { force=false, snapshotMap=null, now=Date.now() } = {}){
  const trucksList = Array.isArray(trucks) ? trucks : [];
  if(trucksList.length === 0){
    return [];
  }

  const trucksMap = new Map(trucksList.map((t)=> [String(t.id), t]));
  const { imeiToTruck, imeiToPlate } = buildProtrackImeiAssociations(trucksList);

  const tenant = process.env.PROTRACK_TENANT_ID;
  const imeisRaw = process.env.PROTRACK_TRACK_IMEIS || process.env.PROTRACK_IMEIS || '';
  const imeis = imeisRaw
    .split(',')
    .map((val)=> val.trim())
    .filter(Boolean)
    .join(',');

  let tokenInfo = null;
  const staticToken = process.env.PROTRACK_API_TOKEN;
  if(staticToken){
    tokenInfo = { ...normaliseTokenPair(staticToken), mode: (process.env.PROTRACK_TRACK_MODE || 'header').toLowerCase() };
  }else{
    try{
      tokenInfo = await ensureProtrackToken(force);
    }catch(err){
      console.error('Protrack token refresh failed', err);
    }
    if(!tokenInfo){
      tokenInfo = getCachedProtrackToken();
    }
  }

  const trackModeEnv = (process.env.PROTRACK_TRACK_MODE || '').toLowerCase();
  let useQueryMode = trackModeEnv === 'query';
  if(!useQueryMode && trackModeEnv !== 'header' && tokenInfo?.mode === 'signature'){
    useQueryMode = true;
  }

  const trackBaseOverride = process.env.PROTRACK_TRACK_URL;
  const baseCandidate =
    process.env.PROTRACK_BASE_URL ||
    process.env.PROTRACK_API_URL ||
    'https://api.protrack365.com';
  const defaultPath = process.env.PROTRACK_TRACK_PATH || '/api/track';
  let targetUrl;
  if(trackBaseOverride){
    targetUrl = trackBaseOverride;
  }else if(useQueryMode){
    targetUrl = new URL(defaultPath, baseCandidate).toString();
  }else if(process.env.PROTRACK_API_URL){
    const legacyBase = process.env.PROTRACK_API_URL;
    targetUrl = legacyBase.endsWith('/') ? `${legacyBase}devices/positions` : `${legacyBase}/devices/positions`;
  }else{
    targetUrl = new URL(defaultPath, baseCandidate).toString();
    useQueryMode = true;
  }

  if(!tokenInfo || (!useQueryMode && !tokenInfo.bearer) || (useQueryMode && !tokenInfo.access)){
    return synthesiseTelemetry(trucksList, { snapshotMap, now });
  }

  const accessParam = (process.env.PROTRACK_ACCESS_TOKEN_PARAM || 'access_token').trim() || 'access_token';
  const extraQuery = safeParseObject(process.env.PROTRACK_TRACK_QUERY, 'PROTRACK_TRACK_QUERY');

  try{
    let urlToFetch = targetUrl;
    const requestInit = { method: 'GET', headers: {} };
    if(useQueryMode){
      const urlObj = new URL(targetUrl);
      urlObj.searchParams.set(accessParam, tokenInfo.access);
      if(imeis){
        urlObj.searchParams.set('imeis', imeis);
      }
      for(const [key, value] of Object.entries(extraQuery)){
        if(value === undefined || value === null) continue;
        urlObj.searchParams.set(key, String(value));
      }
      urlToFetch = urlObj.toString();
    }else{
      requestInit.headers.Authorization = tokenInfo.bearer;
      requestInit.headers['Content-Type'] = 'application/json';
    }
    if(tenant){
      requestInit.headers['X-Tenant'] = tenant;
    }

    const response = await fetch(urlToFetch, requestInit);
    if(!response.ok){
      const detail = await response.text().catch(()=> '');
      throw new Error(`Protrack responded ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    const data = await response.json().catch(()=> ({}));
    const items = normaliseTelemetryCollection(data);
    if(!Array.isArray(items) || items.length===0){
      return synthesiseTelemetry(trucksList, { snapshotMap, now });
    }
    const mapped = items
      .map((item)=> mapTelemetryItem(item, trucksMap, imeiToTruck, imeiToPlate))
      .filter(Boolean);
    return mapped.length ? mapped : synthesiseTelemetry(trucksList, { snapshotMap, now });
  }catch(err){
    console.error('Telemetry fetch failed', err);
    return synthesiseTelemetry(trucksList, { snapshotMap, now });
  }
}

function coerceNumber(value){
  if(value === null || value === undefined || value === '') return Number.NaN;
  const num = Number(value);
  return Number.isFinite(num) ? num : Number.NaN;
}

async function fetchTelemetryData(force=false){
  const now = Date.now();
  if(!force && telemetryCache.data.length && now - telemetryCache.fetchedAt < TELEMETRY_CACHE_MS){
    return telemetryCache.data;
  }
  const trucksRaw = await q(`
    SELECT
      t.id,
      t.plate,
      t.capacity_t AS capacityT,
      t.primary_driver_id AS primaryDriverId,
      t.primary_driver_assigned_at AS primaryDriverAssignedAt,
      d.name AS driverName,
      d.phone AS driverPhone,
      d.email AS driverEmail,
      t.cartrack_vehicle_id AS cartrackVehicleId,
      t.cartrack_registration AS cartrackRegistration,
      t.cartrack_last_status_at AS cartrackLastStatusAt,
      t.cartrack_last_lat AS cartrackLastLat,
      t.cartrack_last_lng AS cartrackLastLng,
      t.cartrack_last_speed AS cartrackLastSpeed,
      t.cartrack_last_heading AS cartrackLastHeading,
      t.cartrack_last_ignition AS cartrackLastIgnition
    FROM trucks t
    LEFT JOIN drivers d ON d.id = t.primary_driver_id
    ORDER BY t.id
  `);
  let trucks = trucksRaw.map(mapTruckRow);
  trucks = await ensureProtrackMappedTrucks(trucks, { now });
  const snapshotMap = await loadLatestTelemetrySnapshotMap(trucks);
  const lastKnownTelemetry = trucks.length ? synthesiseTelemetry(trucks, { snapshotMap, now }) : [];
  const cartrackConfigured = isFleetApiConfigured();
  let cartrackTelemetry = [];
  if(cartrackConfigured){
    try{
      const { telemetry: fleetTelemetry, trucks: mergedTrucks } = await fetchCartrackTelemetry(trucks, { now, snapshotMap });
      if(Array.isArray(mergedTrucks) && mergedTrucks.length){
        trucks = mergedTrucks;
      }
      if(Array.isArray(fleetTelemetry) && fleetTelemetry.length){
        cartrackTelemetry = fleetTelemetry;
      }
    }catch(err){
      console.error('Cartrack telemetry fetch failed', err);
    }
  }

  let protrackTelemetry = [];
  if(isProtrackConfigured()){
    protrackTelemetry = await fetchProtrackTelemetry(trucks, { force, snapshotMap, now });
  }

  let combinedTelemetry;
  if(cartrackTelemetry.length){
    combinedTelemetry = protrackTelemetry.length ? mergeTelemetryLists(cartrackTelemetry, protrackTelemetry) : cartrackTelemetry;
  }else if(protrackTelemetry.length){
    combinedTelemetry = protrackTelemetry;
  }else if(trucks.length){
    combinedTelemetry = lastKnownTelemetry;
  }else{
    combinedTelemetry = [];
  }

  const withCoordinates = fillTelemetryCoordinates(combinedTelemetry, trucks, lastKnownTelemetry);
  const enrichedTelemetry = await enrichTelemetryAddresses(withCoordinates);
  await recordTelemetrySnapshots(enrichedTelemetry, { now });
  const filteredTelemetry = filterHiddenTelemetry(enrichedTelemetry);
  triggerTelemetryAnalysis({ now });

  telemetryCache.data = filteredTelemetry;
  telemetryCache.fetchedAt = now;
  return filteredTelemetry;
}

function mapTelemetryItem(item, trucksMap, imeiLookup, plateOverrides){
  if(!item) return null;
  const rawCandidates = [
    item?.truckId,
    item?.deviceId,
    item?.id,
    item?.deviceID,
    item?.vehicleId,
    item?.vehicleID,
    item?.device?.id,
    item?.imei,
    item?.IMEI,
    item?.imeiNo,
    item?.deviceImei,
    item?.device?.imei,
  ];
  const rawIdCandidate = rawCandidates.find(val=>{
    if(val === undefined || val === null) return false;
    const str = String(val).trim();
    return str.length > 0;
  }) ?? null;
  const truckKey = rawIdCandidate ? String(rawIdCandidate).trim() : null;
  let truck = truckKey ? trucksMap.get(truckKey) : null;
  if(!truck && truckKey && imeiLookup?.has(truckKey)){
    truck = imeiLookup.get(truckKey);
  }

  const imeiValue = extractImeiFromTelemetry(item);
  if(!truck && imeiValue && imeiLookup?.has(imeiValue)){
    truck = imeiLookup.get(imeiValue);
  }

  const plate =
    item?.plate ||
    item?.vehicleNo ||
    item?.vehicleNumber ||
    item?.numberPlate ||
    item?.carNumber ||
    item?.name ||
    truck?.plate ||
    truckKey ||
    'Unknown';

  let latValue =
    item?.lat ??
    item?.latitude ??
    item?.latDeg ??
    item?.location?.lat ??
    item?.location?.latitude ??
    item?.position?.lat ??
    item?.position?.latitude ??
    null;
  let lngValue =
    item?.lng ??
    item?.lon ??
    item?.longitude ??
    item?.lonDeg ??
    item?.location?.lng ??
    item?.location?.lon ??
    item?.location?.longitude ??
    item?.position?.lng ??
    item?.position?.lon ??
    item?.position?.longitude ??
    null;

  if((latValue === null || latValue === undefined) && typeof item?.latlng === 'string'){
    const [latStr, lngStr] = item.latlng.split(',');
    latValue = latStr;
    lngValue = lngStr;
  }

  const lat = coerceNumber(latValue);
  const lng = coerceNumber(lngValue);
  const speedValue =
    item?.speed ??
    item?.velocity ??
    item?.kph ??
    item?.kmh ??
    item?.mph ??
    item?.metrics?.speed ??
    null;
  const speed = coerceNumber(speedValue);
  const headingValue =
    item?.heading ??
    item?.course ??
    item?.bearing ??
    item?.direction ??
    item?.angle ??
    item?.orientation ??
    item?.device?.heading ??
    truck?.cartrackLastHeading ??
    null;
  const heading = coerceNumber(headingValue);
  const speedNumeric = Number.isFinite(speed) ? Number(speed) : null;
  const engineOn = resolveIgnitionState(
    item?.engineOn,
    item?.engine_on,
    item?.engine,
    item?.engineStatus,
    item?.engine_status,
    item?.ignitionOn,
    item?.ignition_on,
    item?.ignition,
    item?.ignitionStatus,
    item?.ignition_status,
    item?.ignitionState,
    item?.ignition_state,
    item?.ign,
    item?.acc,
    item?.ACC,
    item?.state?.ignition,
    item?.state?.ign,
    item?.status?.ignition,
    item?.device?.ignition,
    truck?.cartrackLastIgnition
  );
  const idleCandidate =
    item?.idling ??
    item?.idle ??
    item?.isIdle ??
    item?.engineIdle ??
    item?.engine_idling ??
    item?.status?.idling ??
    item?.state?.idling ??
    item?.device?.idling ??
    null;
  const idleFlag = idleCandidate === null || idleCandidate === undefined ? null : Boolean(idleCandidate);
  const statusBase =
    item?.status ||
    item?.state ||
    item?.movementStatus ||
    item?.vehicleStatus ||
    item?.device?.status ||
    '';
  const status = deriveVehicleStatus({ speed: speedNumeric, engineOn, idleFlag, baseStatus: statusBase });
  const timeRaw =
    item?.gpsTime ||
    item?.gps_time ||
    item?.time ||
    item?.locate_time ||
    item?.lastSeen ||
    item?.updatedAt ||
    item?.timestamp ||
    item?.fixTime ||
    item?.serverTime;
  const lastUpdated = normaliseTelemetryTime(timeRaw);
  const idleMinutes = idleMinutesForTelemetry({
    lastUpdated,
    speed: speedNumeric,
    engineOn,
    idling: idleFlag,
    status,
  });
  const driverId = truck?.primaryDriverId ?? null;
  const driverName = truck?.driverName ?? null;
  const driverPhone = truck?.driverPhone ?? null;
  const driverEmail = truck?.driverEmail ?? null;
  const addressCandidate =
    item?.address ||
    item?.location?.address ||
    item?.position?.address ||
    item?.location?.name ||
    item?.position?.name ||
    item?.location ||
    item?.position;
  const address = typeof addressCandidate === 'string' ? addressCandidate : '';

  let resolvedPlate = plate;
  if(imeiValue && plateOverrides?.has(imeiValue)){
    resolvedPlate = plateOverrides.get(imeiValue);
  }
  if(truck?.plate){
    resolvedPlate = truck.plate;
  }

  const fallbackId = truck?.id || truckKey || resolvedPlate || plate || imeiValue || 'Unknown';

  return {
    truckId: fallbackId,
    plate: resolvedPlate || fallbackId,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    speed: Number.isFinite(speed) ? Number(speed) : null,
    heading: Number.isFinite(heading) ? Number(heading) : null,
    status,
    address,
    lastUpdated,
    idleMinutes,
    source: 'protrack',
    engineOn,
    driverId,
    driverName,
    driverPhone,
    driverEmail,
    driverAssignedAt: truck?.primaryDriverAssignedAt ?? null,
    capacityT: truck?.capacityT ?? null,
  };
}

async function loadLatestTelemetrySnapshotMap(trucks){
  const ids = (Array.isArray(trucks) ? trucks : [])
    .map((t)=> t?.id)
    .filter(Boolean)
    .map((id)=> String(id));
  if(!ids.length) return new Map();
  const placeholders = ids.map(()=> '?').join(',');
  try{
    const rows = await q(
      `SELECT truck_id, lat, lng, speed, status, heading, address, idle_minutes, captured_at
       FROM telemetry_snapshots
       WHERE truck_id IN (${placeholders})
       ORDER BY datetime(captured_at) DESC`,
      ids
    );
    const map = new Map();
    for(const row of rows){
      const key = row?.truck_id ? String(row.truck_id).trim() : '';
      if(!key || map.has(key)) continue;
      map.set(key, row);
    }
    return map;
  }catch(err){
    console.warn('Failed to load latest telemetry snapshots for fallback', err);
    return new Map();
  }
}

function synthesiseTelemetry(trucks, { snapshotMap=null, now=Date.now() } = {}){
  const list = Array.isArray(trucks) ? trucks : [];
  const map = snapshotMap instanceof Map ? snapshotMap : null;
  const fallbackStatus = (truck)=> truck?.cartrackVehicleId ? 'No recent data' : 'Unavailable';
  return list.map((truck)=> {
    const truckId = truck?.id || null;
    const snapshot = truckId && map?.get(String(truckId)) ? map.get(String(truckId)) : null;
    const snapshotLat = numberOrNull(snapshot?.lat);
    const snapshotLng = numberOrNull(snapshot?.lng);
    const lat = Number.isFinite(snapshotLat) ? snapshotLat : numberOrNull(truck?.cartrackLastLat);
    const lng = Number.isFinite(snapshotLng) ? snapshotLng : numberOrNull(truck?.cartrackLastLng);
    const speed = Number.isFinite(Number(snapshot?.speed)) ? Number(snapshot.speed) : numberOrNull(truck?.cartrackLastSpeed);
    const heading = Number.isFinite(Number(snapshot?.heading)) ? Number(snapshot.heading) : numberOrNull(truck?.cartrackLastHeading);
    const lastUpdated = snapshot?.captured_at || truck?.cartrackLastStatusAt || (Number.isFinite(now) ? new Date(now).toISOString() : isoNow());
    const engineOn = resolveIgnitionState(truck?.cartrackLastIgnition);
    const status = snapshot?.status || fallbackStatus(truck);
    const idleMinutes = Number.isFinite(Number(snapshot?.idle_minutes))
      ? Math.max(0, Math.round(Number(snapshot.idle_minutes)))
      : idleMinutesForTelemetry({
          lastUpdated,
          speed,
          engineOn,
          status,
        });

    return {
      truckId,
      plate: truck?.plate,
      driverId: truck?.primaryDriverId || null,
      driverName: truck?.driverName || null,
      driverPhone: truck?.driverPhone || null,
      driverEmail: truck?.driverEmail || null,
      driverAssignedAt: truck?.primaryDriverAssignedAt || null,
      capacityT: truck?.capacityT ?? null,
      lat,
      lng,
      speed,
      heading,
      status,
      address: typeof snapshot?.address === 'string' ? snapshot.address : '',
      lastUpdated,
      idleMinutes,
      source: 'last-known',
      engineOn,
    };
  });
}

function idleMinutesForTelemetry(entry){
  const computeFromTimestamp = (value)=>{
    if(!value && value !== 0) return null;
    const ms = new Date(value).getTime();
    if(!Number.isFinite(ms)) return null;
    return Math.max(0, Math.round((Date.now() - ms)/60000));
  };

  if(entry === null || entry === undefined) return null;

  if(typeof entry === 'number' && Number.isFinite(entry)){
    return Math.max(0, Math.round(entry));
  }

  if(typeof entry === 'string'){
    // Without engine metadata we cannot tell if this period is idle. Return null to avoid overstating idle time.
    return null;
  }

  if(typeof entry !== 'object') return null;

  if(Number.isFinite(Number(entry.idleMinutes))){
    return Math.max(0, Math.round(Number(entry.idleMinutes)));
  }

  const lastUpdated =
    entry.lastUpdated ||
    entry.capturedAt ||
    entry.captured_at ||
    entry.timestamp ||
    entry.gpsTime ||
    entry.gps_time ||
    null;
  if(!lastUpdated) return null;

  const engineOn = resolveIgnitionState(
    entry.engineOn,
    entry.engine_on,
    entry.ignitionOn,
    entry.ignition_on,
    entry.ignition,
    entry.acc,
    entry.powerStatus,
    entry.power_status,
    entry.cartrackLastIgnition
  );
  if(engineOn !== true) return 0;

  const speedCandidate =
    entry.speed ??
    entry.vehicleSpeed ??
    entry.cartrackLastSpeed ??
    entry.metrics?.speed ??
    null;
  const speed = Number(speedCandidate);
  if(!Number.isFinite(speed)) return 0;
  if(Math.abs(speed) > TELEMETRY_IDLE_SPEED_KPH) return 0;

  return computeFromTimestamp(lastUpdated) ?? 0;
}

async function saveImageFromDataUrl(dataUrl){
  try{
    const match = /^data:(image\/[\w.+-]+);base64,(.+)$/i.exec(dataUrl||'');
    const base64 = match ? match[2] : (dataUrl || '');
    if(!base64) return null;
    const ext = match ? match[1].split('/')[1].replace(/[^a-z0-9]/gi,'') : 'jpg';
    const filename = `${Date.now()}-${Math.random().toString(16).slice(2)}.${ext || 'jpg'}`;
    await fsp.writeFile(path.join(uploadsDir, filename), Buffer.from(base64, 'base64'));
    return `/uploads/${filename}`;
  }catch(err){
    console.error('Failed to save image', err);
    return null;
  }
}

function mapDriverRow(row){
  if(!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    email: row.email || '',
    phone: row.phone || '',
    nationalIdPath: row.national_id_path || row.nationalIdPath || null,
    photoPath: row.photo_path || row.photoPath || null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

function mapTruckRow(row){
  if(!row) return null;
  const capacity = row.capacityT ?? row.capacity_t ?? 0;
  return {
    id: row.id,
    plate: row.plate,
    capacityT: Number(capacity) || 0,
    primaryDriverId: row.primaryDriverId ?? row.primary_driver_id ?? null,
    primaryDriverAssignedAt: row.primaryDriverAssignedAt ?? row.primary_driver_assigned_at ?? null,
    driverName: row.driverName ?? row.driver_name ?? null,
    driverPhone: row.driverPhone ?? row.driver_phone ?? null,
    driverEmail: row.driverEmail ?? row.driver_email ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    cartrackVehicleId: row.cartrackVehicleId ?? row.cartrack_vehicle_id ?? null,
    cartrackRegistration: row.cartrackRegistration ?? row.cartrack_registration ?? null,
    cartrackLastStatusAt: row.cartrackLastStatusAt ?? row.cartrack_last_status_at ?? null,
    cartrackLastLat: row.cartrackLastLat ?? row.cartrack_last_lat ?? null,
    cartrackLastLng: row.cartrackLastLng ?? row.cartrack_last_lng ?? null,
    cartrackLastSpeed: row.cartrackLastSpeed ?? row.cartrack_last_speed ?? null,
    cartrackLastHeading: row.cartrackLastHeading ?? row.cartrack_last_heading ?? null,
    cartrackLastIgnition: row.cartrackLastIgnition ?? row.cartrack_last_ignition ?? null,
  };
}

async function updateDriverRecord(driverId, payload={}){
  if(!driverId) throw Object.assign(new Error('Driver id required'), { status:400 });
  const existing = await g('SELECT * FROM drivers WHERE id=?',[driverId]);
  if(!existing) throw Object.assign(new Error('Driver not found'), { status:404 });
  const {
    name,
    email,
    phone,
    nationalIdData,
    photoData,
  } = payload;
  const updates = [];
  const params = [];
  let driverName = existing.name || '';
  if(name !== undefined){
    const trimmed = String(name).trim();
    if(trimmed){
      updates.push('name=?');
      params.push(trimmed);
      driverName = trimmed;
    }
  }
  if(email !== undefined){
    updates.push('email=?');
    params.push(email ? String(email).trim() : null);
  }
  if(phone !== undefined){
    updates.push('phone=?');
    params.push(phone ? String(phone).trim() : null);
  }
  if(nationalIdData){
    const pathSaved = await saveImageFromDataUrl(nationalIdData);
    if(pathSaved){
      updates.push('national_id_path=?');
      params.push(pathSaved);
      queueImageAudit({
        entityType: 'driver_document',
        entityId: `${driverId}-national-id`,
        imagePath: pathSaved,
        expected: { driverName },
        description: 'Driver identification document should state the driver name.',
      });
    }
  }
  if(photoData){
    const photoPath = await saveImageFromDataUrl(photoData);
    if(photoPath){
      updates.push('photo_path=?');
      params.push(photoPath);
      queueImageAudit({
        entityType: 'driver_photo',
        entityId: `${driverId}-photo`,
        imagePath: photoPath,
        expected: { driverName },
        description: 'Driver profile photo should belong to the named driver. If the image has no text, return matches=true.',
      });
    }
  }
  if(updates.length){
    updates.push('updated_at=?');
    params.push(isoNow());
    params.push(driverId);
    await run(`UPDATE drivers SET ${updates.join(', ')} WHERE id=?`, params);
  }
  const updated = await g(`SELECT id,name,email,phone,national_id_path AS nationalIdPath, photo_path AS photoPath, created_at AS createdAt, updated_at AS updatedAt FROM drivers WHERE id=?`, [driverId]);
  return mapDriverRow(updated);
}

async function resolveFormSubject(driverId, options={}){
  if(options.subject){
    await ensureDriverPlaceholder(options.subject);
    return options.subject;
  }
  if(driverId){
    const driver = await g('SELECT id,name,email,phone FROM drivers WHERE id=?',[driverId]);
    if(!driver) throw Object.assign(new Error('Driver not found'), { status:404 });
    const resolved = {
      formId: driver.id,
      id: driver.id,
      name: driver.name || driver.id,
      email: driver.email || '',
      phone: driver.phone || '',
      type: 'driver',
    };
    await ensureDriverPlaceholder(resolved);
    return resolved;
  }
  const userId = options.userId || options.actorUserId;
  if(!userId) throw Object.assign(new Error('User id required for employment form'), { status:400 });
  const user = await g('SELECT id,name,email,phone FROM users WHERE id=?',[userId]);
  if(!user) throw Object.assign(new Error('User not found'), { status:404 });
  const resolved = {
    formId: `USR-${user.id}`,
    id: user.id,
    name: user.name || user.email || `User ${user.id}`,
    email: user.email || '',
    phone: user.phone || '',
    type: 'user',
  };
  await ensureDriverPlaceholder(resolved);
  return resolved;
}

async function ensureDriverPlaceholder(subject){
  if(!subject?.formId) return;
  const existing = await g('SELECT id FROM drivers WHERE id=?',[subject.formId]).catch(()=>null);
  if(existing) return;
  const name = subject.name || subject.formId;
  await run(
    'INSERT INTO drivers (id,name,email,phone,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    [subject.formId, name, subject.email || null, subject.phone || null, isoNow(), isoNow()]
  );
}

async function ensureDriverOnboardingFormRecord(driverId, options={}){
  const subject = await resolveFormSubject(driverId, options);
  const existing = await g(`
    SELECT
      f.*,
      d.name AS driver_name,
      d.email AS driver_email,
      d.phone AS driver_phone,
      u.name AS user_name,
      u.email AS user_email,
      u.phone AS user_phone
    FROM driver_onboarding_forms f
    LEFT JOIN drivers d ON d.id=f.driver_id
    LEFT JOIN users u ON ('USR-' || u.id)=f.driver_id
    WHERE f.driver_id=?`, [subject.formId]);
  if(existing){
    const response = mapDriverFormRow(existing, subject);
    return await finalizeDriverFormResponse(response, subject);
  }
  const blank = createEmptyDriverOnboardingForm();
  blank.driverId = subject.formId;
  blank.owner = {
    id: subject.formId,
    name: subject.name,
    email: subject.email,
    phone: subject.phone,
    type: subject.type,
  };
  if(subject.name){
    const parts = subject.name.split(' ');
    blank.personalDetails = {
      ...blank.personalDetails,
      surname: parts[0] || subject.name,
      otherNames: parts.slice(1).join(' '),
    };
  }
  blank.updatedAt = isoNow();
  const serialized = JSON.stringify(blank);
  await run('INSERT INTO driver_onboarding_forms (driver_id, form_data, status, updated_at) VALUES (?,?,?,?)',[subject.formId, serialized, blank.status || 'draft', blank.updatedAt]);
  const response = mapDriverFormRow({
    driver_id: subject.formId,
    form_data: serialized,
    status: blank.status || 'draft',
    submitted_at: null,
    updated_at: blank.updatedAt,
    driver_name: subject.type === 'driver' ? subject.name : null,
    driver_email: subject.type === 'driver' ? subject.email : null,
    driver_phone: subject.type === 'driver' ? subject.phone : null,
    user_name: subject.type === 'user' ? subject.name : null,
    user_email: subject.type === 'user' ? subject.email : null,
    user_phone: subject.type === 'user' ? subject.phone : null,
  }, subject);
  return await finalizeDriverFormResponse(response, subject);
}

async function persistDriverOnboardingForm(driverId, payload={}, options={}){
  const subject = await resolveFormSubject(driverId, options);
  const existingRow = await g(`
    SELECT
      f.*,
      d.name AS driver_name,
      d.email AS driver_email,
      d.phone AS driver_phone,
      u.name AS user_name,
      u.email AS user_email,
      u.phone AS user_phone
    FROM driver_onboarding_forms f
    LEFT JOIN drivers d ON d.id=f.driver_id
    LEFT JOIN users u ON ('USR-' || u.id)=f.driver_id
    WHERE f.driver_id=?`, [subject.formId]);
  const baseForm = existingRow ? safeParseJSON(existingRow.form_data) || createEmptyDriverOnboardingForm() : createEmptyDriverOnboardingForm();
  baseForm.driverId = subject.formId;
  baseForm.owner = {
    id: subject.formId,
    name: subject.name,
    email: subject.email,
    phone: subject.phone,
    type: subject.type,
  };
  const updates = payload && typeof payload === 'object' ? payload : {};
  const merged = mergeDriverFormPayload(baseForm, updates, subject.formId);
  const requestedStatusRaw = typeof updates.status === 'string' ? updates.status.trim().toLowerCase() : merged.status || existingRow?.status || 'draft';
  let status = requestedStatusRaw === 'submitted' ? 'submitted' : 'draft';
  if(existingRow?.status === 'submitted' && !options.allowStatusDowngrade && requestedStatusRaw !== 'submitted'){
    status = 'submitted';
  }
  if(requestedStatusRaw === 'draft' && !options.allowStatusDowngrade && existingRow?.status === 'submitted'){
    status = 'submitted';
  }
  if(requestedStatusRaw === 'draft' && options.allowStatusDowngrade){
    status = 'draft';
  }
  const updatedAt = isoNow();
  merged.status = status;
  merged.driverId = subject.formId;
  merged.updatedAt = updatedAt;
  let submittedAt = existingRow?.submitted_at || null;
  let submittedBy = existingRow?.submitted_by || null;
  if(status === 'submitted'){
    if(!submittedAt || requestedStatusRaw === 'submitted'){
      submittedAt = isoNow();
    }
    submittedBy = options.actorUserId || submittedBy || null;
  }else if(options.allowStatusDowngrade){
    submittedAt = null;
    submittedBy = null;
  }
  const serialized = JSON.stringify(merged);
  if(existingRow){
    await run(
      'UPDATE driver_onboarding_forms SET form_data=?, status=?, submitted_at=?, updated_at=?, submitted_by=? WHERE driver_id=?',
      [serialized, status, submittedAt, updatedAt, submittedBy, subject.formId]
    );
  }else{
    await run(
      'INSERT INTO driver_onboarding_forms (driver_id, form_data, status, submitted_at, updated_at, submitted_by) VALUES (?,?,?,?,?,?)',
      [subject.formId, serialized, status, submittedAt, updatedAt, submittedBy]
    );
  }
  const response = mapDriverFormRow({
    driver_id: subject.formId,
    form_data: serialized,
    status,
    submitted_at: submittedAt,
    updated_at: updatedAt,
    driver_name: subject.type === 'driver' ? subject.name : null,
    driver_email: subject.type === 'driver' ? subject.email : null,
    driver_phone: subject.type === 'driver' ? subject.phone : null,
    user_name: subject.type === 'user' ? subject.name : null,
    user_email: subject.type === 'user' ? subject.email : null,
    user_phone: subject.type === 'user' ? subject.phone : null,
  }, subject);
  return await finalizeDriverFormResponse(response, subject);
}

async function finalizeDriverFormResponse(response, subject){
  if(!response) return null;
  const formId = subject?.formId || response.driverId;
  if(response.form){
    response.form.documentsChecklist = await hydrateDocumentFlags(response.form.documentsChecklist || [], formId);
    response.form.completionSummary = summarizeDriverOnboardingGaps(response.form);
    response.owner = response.form.owner || response.owner || null;
    response.completionSummary = response.form.completionSummary;
  }
  response.driver = response.owner || response.driver || null;
  return response;
}

async function hydrateDocumentFlags(documents=[], formId){
  if(!formId || !Array.isArray(documents) || !documents.length){
    return documents;
  }
  const flags = await q(
    'SELECT entity_id, message FROM ai_audit_flags WHERE entity_type=? AND entity_id LIKE ? AND resolved_at IS NULL',
    ['driver_document', `${formId}-%`]
  );
  const flagMap = new Map(
    flags
      .map((row)=>{
        const suffix = row.entity_id.slice(formId.length + 1);
        return [suffix?.toLowerCase(), row.message || 'Document mismatch'];
      })
      .filter(([code])=> Boolean(code))
  );
  return documents.map((doc)=>{
    const code = (doc?.code || '').toLowerCase();
    const issue = flagMap.get(code);
    let validationStatus = doc?.validationStatus || (doc?.attachmentPath ? 'pending' : null);
    if(issue){
      validationStatus = 'flagged';
    }else if(doc?.attachmentPath && (!validationStatus || validationStatus === 'pending')){
      validationStatus = 'verified';
    }
    return { ...doc, validationStatus, flagMessage: issue || null };
  });
}

async function handleEmploymentDocumentUpload(subject, code, dataUrl, options={}){
  if(!subject?.formId) throw Object.assign(new Error('Profile subject missing'), { status:400 });
  const normalizedCode = String(code || '').trim().toLowerCase();
  if(!normalizedCode) throw Object.assign(new Error('Document code required'), { status:400 });
  if(!dataUrl || typeof dataUrl !== 'string') throw Object.assign(new Error('Document image is required'), { status:400 });
  const attachmentPath = await saveImageFromDataUrl(dataUrl);
  if(!attachmentPath) throw Object.assign(new Error('Failed to process document image'), { status:400 });
  const current = await ensureDriverOnboardingFormRecord(subject.formId, { subject });
  const documents = Array.isArray(current?.form?.documentsChecklist)
    ? current.form.documentsChecklist.map((doc)=> ({ ...doc }))
    : [];
  const index = documents.findIndex((doc)=> (doc.code || '').toLowerCase() === normalizedCode);
  if(index === -1) throw Object.assign(new Error('Unknown document requested'), { status:404 });
  documents[index] = {
    ...documents[index],
    attachmentPath,
    provided: true,
    remarks: typeof options.remarks === 'string' ? options.remarks : documents[index].remarks,
    validationStatus: 'pending',
    flagMessage: null,
    lastUploadedAt: isoNow(),
  };
  const next = await persistDriverOnboardingForm(subject.formId, { documentsChecklist: documents }, { actorUserId: options.actorUserId, subject });
  await resolveAuditFlags('driver_document', `${subject.formId}-${normalizedCode}`);
  queueImageAudit({
    entityType: 'driver_document',
    entityId: `${subject.formId}-${normalizedCode}`,
    imagePath: attachmentPath,
    expected: buildDocumentExpectation(normalizedCode, next.form),
    description: `Verify ${documents[index].label} belongs to ${subject.name || subject.formId}`,
  });
  return next;
}

function buildDocumentExpectation(code, form){
  const personal = form?.personalDetails || {};
  const ownerName = form?.owner?.name || `${personal.surname || ''} ${personal.otherNames || ''}`.trim();
  switch(code){
    case 'national_id':
      return { fullName: ownerName, idNumber: personal.idNumber || '' };
    case 'kra_pin':
      return { fullName: ownerName, kraPin: personal.pinNumber || '' };
    case 'nhif':
      return { fullName: ownerName, nhif: personal.nhifNumber || '' };
    case 'nssf':
      return { fullName: ownerName, nssf: personal.nssfNumber || '' };
    case 'driving_licence':
      return { fullName: ownerName, licence: form?.jobDetails?.vehicleNumber || '' };
    default:
      return { fullName: ownerName, document: code };
  }
}

function mergeDriverFormPayload(baseForm, updates, driverId){
  const safeUpdates = updates && typeof updates === 'object' ? updates : {};
  const merged = { ...baseForm };
  merged.driverId = driverId || baseForm.driverId || '';
  merged.owner = baseForm.owner ? { ...baseForm.owner } : null;
  const section = (key)=> mergeSection(baseForm[key], safeUpdates[key]);
  merged.jobDetails = section('jobDetails');
  merged.introduction = section('introduction');
  merged.personalDetails = section('personalDetails');
  merged.spouse = section('spouse');
  merged.relatedEmployeeDisclosure = mergeSection(baseForm.relatedEmployeeDisclosure, safeUpdates.relatedEmployeeDisclosure, true);
  merged.relatedEmployeeDisclosure.hasRelation = safeBoolean(safeUpdates?.relatedEmployeeDisclosure?.hasRelation, baseForm.relatedEmployeeDisclosure?.hasRelation);
  merged.healthDisclosure = mergeSection(baseForm.healthDisclosure, safeUpdates.healthDisclosure, true);
  merged.healthDisclosure.hasTerminalCondition = safeBoolean(safeUpdates?.healthDisclosure?.hasTerminalCondition, baseForm.healthDisclosure?.hasTerminalCondition);
  merged.healthDisclosure.hasDisabilities = safeBoolean(safeUpdates?.healthDisclosure?.hasDisabilities, baseForm.healthDisclosure?.hasDisabilities);
  merged.residentialAddress = section('residentialAddress');
  merged.homeAddress = section('homeAddress');
  merged.children = mergeArraySection(baseForm.children, safeUpdates.children);
  merged.nextOfKin = mergeArraySection(baseForm.nextOfKin, safeUpdates.nextOfKin);
  merged.academicHistory = mergeArraySection(baseForm.academicHistory, safeUpdates.academicHistory);
  merged.employmentHistory = mergeArraySection(baseForm.employmentHistory, safeUpdates.employmentHistory);
  merged.referees = mergeArraySection(baseForm.referees, safeUpdates.referees);
  merged.documentsChecklist = mergeDocumentChecklist(baseForm.documentsChecklist, safeUpdates.documentsChecklist);
  merged.skillsSummary = typeof safeUpdates.skillsSummary === 'string' ? safeUpdates.skillsSummary : (baseForm.skillsSummary || '');
  merged.criminalHistory = {
    hasRecord: safeBoolean(safeUpdates?.criminalHistory?.hasRecord, baseForm.criminalHistory?.hasRecord),
    entries: mergeArraySection(baseForm.criminalHistory?.entries || [], safeUpdates?.criminalHistory?.entries || []),
  };
  merged.misconductHistory = {
    hasRecord: safeBoolean(safeUpdates?.misconductHistory?.hasRecord, baseForm.misconductHistory?.hasRecord),
    entries: mergeArraySection(baseForm.misconductHistory?.entries || [], safeUpdates?.misconductHistory?.entries || []),
  };
  merged.declarations = mergeSection(baseForm.declarations, safeUpdates.declarations, true);
  merged.declarations.statementA = safeBoolean(safeUpdates?.declarations?.statementA, baseForm.declarations?.statementA);
  merged.declarations.statementB = safeBoolean(safeUpdates?.declarations?.statementB, baseForm.declarations?.statementB);
  merged.declarations.statementC = safeBoolean(safeUpdates?.declarations?.statementC, baseForm.declarations?.statementC);
  merged.declarations.statementD = safeBoolean(safeUpdates?.declarations?.statementD, baseForm.declarations?.statementD);
  merged.verification = mergeSection(baseForm.verification, safeUpdates.verification);
  return merged;
}

function mergeSection(baseSection={}, updates={}, allowBooleans=false){
  if(!updates || typeof updates !== 'object'){
    return { ...(baseSection || {}) };
  }
  const next = { ...(baseSection || {}) };
  Object.keys(updates).forEach((key)=>{
    if(updates[key] === undefined) return;
    if(allowBooleans && typeof baseSection[key] === 'boolean'){
      next[key] = safeBoolean(updates[key], baseSection[key]);
    }else{
      next[key] = updates[key];
    }
  });
  return next;
}

function mergeArraySection(baseArray=[], candidate=[]){
  if(!Array.isArray(candidate) || candidate.length === 0){
    return (baseArray || []).map((item)=> ({ ...(item || {}) }));
  }
  return candidate.map((item, index)=>{
    const template = (baseArray && baseArray[index]) || baseArray?.[0] || {};
    if(item && typeof item === 'object'){
      return { ...template, ...item };
    }
    return { ...template };
  });
}

function mergeDocumentChecklist(baseDocs=[], incoming=[]){
  const defaults = (baseDocs || []).map((doc)=> ({ ...doc }));
  if(!Array.isArray(incoming) || !incoming.length){
    return defaults;
  }
  const templateByCode = new Map(defaults.map((doc)=> [doc.code, doc]));
  const merged = incoming.map((doc, index)=>{
    const template = (doc && doc.code && templateByCode.get(doc.code)) || defaults[index] || defaults[0] || {};
    return {
      code: doc?.code || template.code || `doc_${index}`,
      label: doc?.label || template.label || `Document ${index+1}`,
      provided: safeBoolean(doc?.provided, template.provided),
      remarks: typeof doc?.remarks === 'string' ? doc.remarks : template.remarks || '',
      attachmentPath: doc?.attachmentPath || template.attachmentPath || null,
      validationStatus: doc?.validationStatus || template.validationStatus || null,
      flagMessage: doc?.flagMessage || template.flagMessage || null,
      lastUploadedAt: doc?.lastUploadedAt || template.lastUploadedAt || null,
      requiresSpouse: doc?.requiresSpouse !== undefined ? doc.requiresSpouse : template.requiresSpouse || false,
    };
  });
  defaults.forEach((doc)=>{
    if(!merged.some((item)=> item.code === doc.code)){
      merged.push({ ...doc });
    }
  });
  return merged;
}

function safeBoolean(value, fallback=false){
  if(typeof value === 'boolean') return value;
  if(typeof value === 'number') return value !== 0;
  if(typeof value === 'string'){
    const lc = value.trim().toLowerCase();
    if(['true','1','yes','y','on'].includes(lc)) return true;
    if(['false','0','no','off'].includes(lc)) return false;
  }
  return Boolean(fallback);
}

function mapDriverFormRow(row, driverMeta){
  if(!row) return null;
  const parsed = safeParseJSON(row.form_data) || createEmptyDriverOnboardingForm();
  const driverId = row.driver_id || parsed.driverId || '';
  parsed.driverId = driverId;
  parsed.status = row.status || parsed.status || 'draft';
  parsed.updatedAt = row.updated_at || parsed.updatedAt || isoNow();
  const owner = driverMeta
    ? {
        id: driverMeta.formId || driverMeta.id || driverId,
        name: driverMeta.name || driverMeta.driver_name || driverId,
        email: driverMeta.email || driverMeta.driver_email || '',
        phone: driverMeta.phone || driverMeta.driver_phone || '',
        type: driverMeta.type || 'driver',
      }
    : {
        id: driverId,
        name: row.driver_name || row.user_name || driverId,
        email: row.driver_email || row.user_email || '',
        phone: row.driver_phone || row.user_phone || '',
        type: row.driver_name ? 'driver' : 'user',
      };
  parsed.owner = owner;
  const completionSummary = summarizeDriverOnboardingGaps(parsed);
  parsed.completionSummary = completionSummary;
  return {
    driverId,
    status: row.status || 'draft',
    submittedAt: row.submitted_at || null,
    updatedAt: row.updated_at || parsed.updatedAt || null,
    owner,
    driver: owner,
    form: parsed,
    completionSummary,
  };
}

async function buildStockReport(filters={}, definition={}){
  const range = deriveDateRange(filters || {}, definition?.filters?.defaultRangeDays || 14);
  const rowsRaw = await q(
    `SELECT id, kind, category, trucks, weight_tonnes, tonnes, reason, order_id, truck_id, cost_per_tonne, created_at
       FROM stock_tx
      WHERE date(created_at) BETWEEN date(?) AND date(?)
      ORDER BY datetime(created_at) ASC`,
    [range.fromDate, range.toDate]
  );
  const rows = rowsRaw.map((row)=>({
    id: row.id,
    createdAt: row.created_at,
    kind: row.kind,
    category: row.category,
    trucks: Number(row.trucks || 0),
    tonnes: Number(row.weight_tonnes || row.tonnes || 0),
    reason: row.reason || '',
    orderId: row.order_id || '',
    truckId: row.truck_id || '',
    costPerTonne: row.cost_per_tonne != null ? Number(row.cost_per_tonne) : null,
  }));
  const totals = rows.reduce(
    (acc,row)=>{
      if((row.kind || '').toUpperCase() === 'IN'){
        acc.trucksIn += row.trucks || 0;
        acc.tonnesIn += row.tonnes || 0;
      }else if((row.kind || '').toUpperCase() === 'OUT'){
        acc.trucksOut += row.trucks || 0;
        acc.tonnesOut += row.tonnes || 0;
      }
      return acc;
    },
    { trucksIn: 0, trucksOut: 0, tonnesIn: 0, tonnesOut: 0 }
  );
  const currentStock = await getStock();
  return { rows, meta: { ...range, totals, currentStock } };
}

async function buildDriverEarningsReport(filters={}, definition={}){
  const range = deriveDateRange(filters || {}, definition?.filters?.defaultRangeDays || 30);
  const driverId = typeof filters?.driverId === 'string' ? filters.driverId.trim() : '';
  const driverClause = driverId ? ' AND a.driver_id = ?' : '';
  const params = [range.fromDate, range.toDate];
  if(driverId) params.push(driverId);
  const rowsRaw = await q(
    `SELECT a.driver_id as driverId,
            COALESCE(d.name, a.driver_id) as driverName,
            COUNT(*) as loads,
            SUM(CASE WHEN a.status IN ('Delivered','Completed') THEN 1 ELSE 0 END) as deliveredLoads,
            SUM(a.tonnes) as tonnes,
            SUM(CASE WHEN t.capacity_t>0 THEN o.per_truck * (a.tonnes / t.capacity_t) ELSE o.per_truck END) as revenue
       FROM assignments a
       JOIN orders o ON o.id=a.order_id AND o.deleted_at IS NULL
  LEFT JOIN trucks t ON t.id=a.truck_id
  LEFT JOIN drivers d ON d.id=a.driver_id
      WHERE a.driver_id IS NOT NULL
        AND date(a.scheduled_at) BETWEEN date(?) AND date(?)
        ${driverClause}
   GROUP BY a.driver_id
   ORDER BY revenue DESC`,
    params
  );
  const rows = rowsRaw.map((row)=>({
    driverId: row.driverId,
    driverName: row.driverName || row.driverId,
    loads: Number(row.loads || 0),
    deliveredLoads: Number(row.deliveredLoads || 0),
    tonnes: Number(row.tonnes || 0),
    revenue: Number(row.revenue || 0),
  }));
  const totals = rows.reduce(
    (acc,row)=>{
      acc.loads += row.loads || 0;
      acc.deliveredLoads += row.deliveredLoads || 0;
      acc.tonnes += row.tonnes || 0;
      acc.revenue += row.revenue || 0;
      return acc;
    },
    { loads: 0, deliveredLoads: 0, tonnes: 0, revenue: 0 }
  );
  return { rows, meta: { ...range, driverId: driverId || null, totals } };
}

async function buildTruckPerformanceReport(filters={}, definition={}){
  const range = deriveDateRange(filters || {}, definition?.filters?.defaultRangeDays || 14);
  const truckId = typeof filters?.truckId === 'string' ? filters.truckId.trim() : '';
  const truckClause = truckId ? ' AND a.truck_id = ?' : '';
  const params = [range.fromDate, range.toDate];
  if(truckId) params.push(truckId);
  const rowsRaw = await q(
    `SELECT date(a.scheduled_at) as day,
            a.truck_id as truckId,
            COALESCE(t.plate, a.truck_id) as plate,
            COUNT(*) as loads,
            SUM(CASE WHEN a.status IN ('Delivered','Completed') THEN 1 ELSE 0 END) as deliveredLoads,
            SUM(a.tonnes) as tonnes,
            SUM(CASE WHEN t.capacity_t>0 THEN o.per_truck * (a.tonnes / t.capacity_t) ELSE o.per_truck END) as revenue
       FROM assignments a
       JOIN orders o ON o.id=a.order_id AND o.deleted_at IS NULL
  LEFT JOIN trucks t ON t.id=a.truck_id
      WHERE a.truck_id IS NOT NULL
        AND date(a.scheduled_at) BETWEEN date(?) AND date(?)
        ${truckClause}
   GROUP BY date(a.scheduled_at), a.truck_id
   ORDER BY date(a.scheduled_at) DESC, plate ASC`,
    params
  );
  const rows = rowsRaw.map((row)=>({
    day: row.day,
    truckId: row.truckId,
    plate: row.plate || row.truckId,
    loads: Number(row.loads || 0),
    deliveredLoads: Number(row.deliveredLoads || 0),
    tonnes: Number(row.tonnes || 0),
    revenue: Number(row.revenue || 0),
  }));
  const totals = rows.reduce(
    (acc,row)=>{
      acc.loads += row.loads || 0;
      acc.deliveredLoads += row.deliveredLoads || 0;
      acc.tonnes += row.tonnes || 0;
      acc.revenue += row.revenue || 0;
      return acc;
    },
    { loads: 0, deliveredLoads: 0, tonnes: 0, revenue: 0 }
  );
  return { rows, meta: { ...range, truckId: truckId || null, totals } };
}

async function buildTruckSalesExpensesReport(filters={}, definition={}){
  const range = deriveDateRange(filters || {}, definition?.filters?.defaultRangeDays || 30);
  const assignments = await q(
    `SELECT a.truck_id as truckId,
            COALESCE(t.plate, a.truck_id) as plate,
            t.capacity_t as capacityT,
            a.order_id as orderId,
            a.scheduled_at as scheduledAt,
            a.tonnes,
            o.per_truck as perTruck,
            o.site,
            a.status
       FROM assignments a
       JOIN orders o ON o.id=a.order_id AND o.deleted_at IS NULL
  LEFT JOIN trucks t ON t.id=a.truck_id
      WHERE a.truck_id IS NOT NULL
        AND date(a.scheduled_at) BETWEEN date(?) AND date(?)
   ORDER BY COALESCE(t.plate, a.truck_id), datetime(a.scheduled_at)`,
    [range.fromDate, range.toDate]
  );
  const costRows = await q(
    `SELECT c.truck_id as truckId,
            COALESCE(t.plate, c.truck_id) as plate,
            c.order_id as orderId,
            c.type,
            c.description,
            c.amount,
            c.incurred_at as incurredAt
       FROM costs c
  LEFT JOIN trucks t ON t.id=c.truck_id
      WHERE c.truck_id IS NOT NULL
        AND c.amount IS NOT NULL
        AND date(c.incurred_at) BETWEEN date(?) AND date(?)
   ORDER BY COALESCE(t.plate, c.truck_id), datetime(c.incurred_at)`,
    [range.fromDate, range.toDate]
  );

  const buckets = new Map();
  const resolveKey = (truckId, plate) => (plate || truckId || 'UNASSIGNED').toString();
  function ensureBucket(truckId, plate){
    const key = resolveKey(truckId, plate);
    if(!buckets.has(key)){
      buckets.set(key, {
        key,
        truckId: truckId || null,
        plate: plate || truckId || key,
        salesRows: [],
        expenseRows: [],
        salesTotal: 0,
        expenseTotal: 0,
      });
    }
    return buckets.get(key);
  }

  assignments.forEach((row)=>{
    const bucket = ensureBucket(row.truckId, row.plate);
    const revenue = calcAssignmentRevenue(row.perTruck, row.tonnes, row.capacityT);
    bucket.salesRows.push({
      date: row.scheduledAt ? row.scheduledAt.substring(0,10) : '',
      orderId: row.orderId || '',
      site: row.site || '',
      tonnes: Number(row.tonnes || 0),
      revenue: Number(revenue || 0),
      status: row.status || '',
    });
    bucket.salesTotal += Number(revenue || 0);
  });

  costRows.forEach((row)=>{
    const bucket = ensureBucket(row.truckId, row.plate);
    const amount = Number(row.amount || 0);
    bucket.expenseRows.push({
      date: row.incurredAt ? row.incurredAt.substring(0,10) : '',
      orderId: row.orderId || '',
      type: row.type || '',
      description: row.description || '',
      amount,
    });
    bucket.expenseTotal += amount;
  });

  const summaryRows = Array.from(buckets.values())
    .map((bucket)=>({
      plate: bucket.plate,
      truckId: bucket.truckId,
      salesTotal: Number(bucket.salesTotal.toFixed(2)),
      expenseTotal: Number(bucket.expenseTotal.toFixed(2)),
      net: Number((bucket.salesTotal - bucket.expenseTotal).toFixed(2)),
      salesCount: bucket.salesRows.length,
      expenseCount: bucket.expenseRows.length,
    }))
    .sort((a,b)=> (a.plate || '').localeCompare(b.plate || ''));

  const excelSheets = summaryRows.map((summary)=>{
    const bucket = buckets.get(resolveKey(summary.truckId, summary.plate));
    return {
      name: summary.plate || summary.truckId || 'Truck',
      sections: [
        {
          title: 'Sales',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'orderId', label: 'Order ID' },
            { key: 'site', label: 'Site' },
            { key: 'tonnes', label: 'Tonnes' },
            { key: 'revenue', label: 'Revenue' },
          ],
          rows: bucket?.salesRows || [],
        },
        {
          title: 'Expenses',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'orderId', label: 'Order ID' },
            { key: 'type', label: 'Type' },
            { key: 'description', label: 'Description' },
            { key: 'amount', label: 'Amount' },
          ],
          rows: bucket?.expenseRows || [],
        },
        {
          title: 'Summary',
          columns: [
            { key: 'metric', label: 'Metric' },
            { key: 'value', label: 'Value' },
          ],
          rows: [
            { metric: 'Total sales', value: summary.salesTotal },
            { metric: 'Total expenses', value: summary.expenseTotal },
            { metric: 'Net', value: summary.net },
            { metric: 'Sales rows', value: summary.salesCount },
            { metric: 'Expense rows', value: summary.expenseCount },
          ],
        },
      ],
    };
  });

  return {
    rows: summaryRows,
    meta: { ...range, trucks: summaryRows.length },
    excelSheets,
  };
}

function normaliseTimeOfDay(value){
  if(!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if(!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if(h<0 || h>23 || m<0 || m>59) return null;
  return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
}

function computeNextRunAt(timeOfDay, timezoneOffsetMinutes=0, from=new Date(), frequencyMinutes=1440, lastRunAt=null){
  const normalised = normaliseTimeOfDay(timeOfDay);
  const tz = Number.isFinite(Number(timezoneOffsetMinutes)) ? Number(timezoneOffsetMinutes) : 0;
  const freq = Math.max(1, Number(frequencyMinutes) || 1440);
  const now = from instanceof Date ? from : new Date();
  if(lastRunAt){
    const last = new Date(lastRunAt);
    const candidate = new Date(last.getTime() + freq * 60_000);
    if(candidate > now) return candidate.toISOString();
  }
  if(!normalised){
    const candidate = new Date(now.getTime() + freq * 60_000);
    return candidate.toISOString();
  }
  const [h,m] = normalised.split(':').map(Number);
  const base = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    h,
    m,
    0,
    0
  ) - tz * 60000);
  let next = base;
  if(next <= now){
    next = new Date(base.getTime() + freq * 60_000);
  }
  return next.toISOString();
}

function describeCoordinateLocation({ lat, lng, address }){
  if(address) return address;
  if(Number.isFinite(lat) && Number.isFinite(lng)){
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
  return 'Unknown location';
}

function distanceFromThika(lat, lng){
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return haversineDistanceKm(THIKA_COORDS.lat, THIKA_COORDS.lon, lat, lng);
}

function isInThikaVicinity(lat, lng){
  const distance = distanceFromThika(lat, lng);
  return Number.isFinite(distance) && distance <= THIKA_VICINITY_KM;
}

function classifyTripDirection({ startLat, startLng, endLat, endLng }){
  if(!Number.isFinite(endLat) || !Number.isFinite(endLng)) return 'UNKNOWN';
  const endNearThika = isInThikaVicinity(endLat, endLng);
  const startNearThika = Number.isFinite(startLat) && Number.isFinite(startLng) ? isInThikaVicinity(startLat, startLng) : false;
  const lonDeltaStart = Number.isFinite(startLng) ? startLng - THIKA_COORDS.lon : 0;
  const lonDeltaEnd = endLng - THIKA_COORDS.lon;
  const onGarissaCorridor = lonDeltaStart >= 0.05 || lonDeltaEnd >= 0.05;

  if(onGarissaCorridor) return 'COLLECTION_GARISSA'; // Runs to/from Garissa/Mwingi corridor are sand collection legs
  if(endNearThika) return 'RETURN_TO_THIKA'; // Coming back to yard is not a sale leg
  if(lonDeltaEnd <= -0.05) return 'SALES_NAIROBI'; // Thika -> Nairobi/Thika Road corridor for sales
  if(startNearThika && lonDeltaEnd < 0) return 'SALES_NAIROBI';
  return 'UNKNOWN';
}

function formatShortDateTime(value){
  if(!value) return '';
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-KE', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}

function shortenLocationLabel(label){
  if(!label) return 'Unknown';
  // Scan comma-separated parts and skip bare road codes (A3, B2, C40, etc.)
  const ROAD_CODE = /^[A-F]\d{1,3}$/i;
  const parts = String(label).split(',').map((s)=> s.trim()).filter(Boolean);
  const base = parts.find((p)=> !ROAD_CODE.test(p)) || parts[0] || 'Unknown';
  let cleaned = base.replace(/\bkenya\b/ig, '').replace(/\bcounty\b/ig, '').trim();
  if(cleaned.length <= 18 && cleaned) return cleaned;
  const words = cleaned.split(/\s+/).filter(Boolean);
  if(words.length >= 2) return `${words[0]} ${words[1]}`.trim();
  return cleaned.slice(0, 18) || 'Unknown';
}

function buildRouteLabel(fromLabel, toLabel){
  return `${shortenLocationLabel(fromLabel)} > ${shortenLocationLabel(toLabel)}`;
}

async function buildTripExpectedSalesReport(filters={}, definition={}){
  const range = deriveDateRange(filters || {}, definition?.filters?.defaultRangeDays || 1);
  const rowsRaw = await q(
    `SELECT truck_id as truckId, plate, lat, lng, speed, captured_at as capturedAt, address, ignition_on as ignitionOn
       FROM telemetry_snapshots
      WHERE date(captured_at) BETWEEN date(?) AND date(?)
      ORDER BY truck_id, captured_at`,
    [range.fromDate, range.toDate]
  );
  const grouped = new Map();
  rowsRaw.forEach((row)=>{
    if(!row.truckId) return;
    if(!grouped.has(row.truckId)) grouped.set(row.truckId, []);
    grouped.get(row.truckId).push(row);
  });

  const detectedTrips = [];
  const MIN_IDLE_MINUTES = 20;
  const MIN_DISTANCE_KM = 10;

  for(const [truckId, list] of grouped.entries()){
    const sorted = [...list].sort((a,b)=> new Date(a.capturedAt) - new Date(b.capturedAt));
    const idleWindows = [];
    let idleStart = null;
    let idleCoords = [];
    let lastTs = null;
    for(const row of sorted){
      const ts = Date.parse(row.capturedAt);
      const isStationary = Number(row.speed||0) <= TELEMETRY_IDLE_SPEED_KPH;
      if(isStationary){
        if(idleStart === null) idleStart = ts;
        idleCoords.push(row);
      }else if(idleStart !== null){
        const durationMin = (ts - idleStart) / 60000;
        if(durationMin >= MIN_IDLE_MINUTES){
          const lat = avg(idleCoords.map((p)=> Number(p.lat)).filter(Number.isFinite));
          const lng = avg(idleCoords.map((p)=> Number(p.lng)).filter(Number.isFinite));
          const engineOnCount = idleCoords.filter((p)=> p.ignitionOn === 1).length;
          const engineOffCount = idleCoords.filter((p)=> p.ignitionOn === 0).length;
          const windowType = engineOnCount > engineOffCount ? 'IDLE'
            : engineOffCount > 0 ? 'ENGINE_OFF'
            : 'STATIONARY';
          idleWindows.push({
            endAt: new Date(ts).toISOString(),
            startAt: new Date(idleStart).toISOString(),
            durationMin,
            lat,
            lng,
            address: idleCoords.find((p)=> p.address)?.address || null,
            windowType,
          });
        }
        idleStart = null;
        idleCoords = [];
      }
      lastTs = ts;
    }
    // close trailing idle if still running
    if(idleStart !== null && lastTs){
      const durationMin = (lastTs - idleStart) / 60000;
      if(durationMin >= MIN_IDLE_MINUTES){
        const lat = avg(idleCoords.map((p)=> Number(p.lat)).filter(Number.isFinite));
        const lng = avg(idleCoords.map((p)=> Number(p.lng)).filter(Number.isFinite));
        const engineOnCount = idleCoords.filter((p)=> p.ignitionOn === 1).length;
        const engineOffCount = idleCoords.filter((p)=> p.ignitionOn === 0).length;
        const windowType = engineOnCount > engineOffCount ? 'IDLE'
          : engineOffCount > 0 ? 'ENGINE_OFF'
          : 'STATIONARY';
        idleWindows.push({
          endAt: new Date(lastTs).toISOString(),
          startAt: new Date(idleStart).toISOString(),
          durationMin,
          lat,
          lng,
          address: idleCoords.find((p)=> p.address)?.address || null,
          windowType,
        });
      }
    }

    for(let i=0; i<idleWindows.length - 1; i++){
      const from = idleWindows[i];
      const to = idleWindows[i+1];
      if(!Number.isFinite(from.lat) || !Number.isFinite(from.lng) || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)){
        continue;
      }
      const distanceKm = haversineDistanceKm(from.lat, from.lng, to.lat, to.lng);
      if(!Number.isFinite(distanceKm) || distanceKm < MIN_DISTANCE_KM) continue;
      const tripType = classifyTripDirection({ startLat: from.lat, startLng: from.lng, endLat: to.lat, endLng: to.lng });
      const distFromThika = distanceFromThika(to.lat, to.lng);
      const expected = Number.isFinite(distFromThika) ? pricePerTruck(distFromThika) : 0;
      const expectedAmount = tripType === 'COLLECTION_GARISSA'
        ? -expected
        : tripType === 'RETURN_TO_THIKA'
          ? 0
          : expected;
      if(expectedAmount <= 0) continue; // Focus on sales legs only for now
      const originLabel = describeCoordinateLocation({ lat: from.lat, lng: from.lng, address: from.address });
      const destLabel = describeCoordinateLocation({ lat: to.lat, lng: to.lng, address: to.address });
      const routeLabel = buildRouteLabel(originLabel, destLabel);
      const startLabel = formatShortDateTime(from.endAt);
      const endLabel = formatShortDateTime(to.startAt);
      detectedTrips.push({
        truckId,
        plate: sorted.find((p)=> p.plate)?.plate || truckId,
        tripType,
        startTime: startLabel,
        endTime: endLabel,
        distanceKm: Number(distanceKm.toFixed(1)),
        expectedAmount: Number(Math.max(0, expectedAmount).toFixed(2)),
        notes: routeLabel,
        rawStart: from.endAt,
        rawEnd: to.startAt,
        rawFromStart: from.startAt,
        fromWindowType: from.windowType || 'STATIONARY',
        toWindowType: to.windowType || 'STATIONARY',
      });
    }
  }

  const totals = detectedTrips.reduce((acc,row)=>{
    acc.sales += Math.max(0, row.expectedAmount || 0);
    acc.trips += 1;
    return acc;
  }, { sales:0, trips:0 });

  const excelSheets = [];
  const byTruck = detectedTrips.reduce((map,row)=>{
    if(!map.has(row.truckId)) map.set(row.truckId, []);
    map.get(row.truckId).push(row);
    return map;
  }, new Map());
  for(const [truckId, trips] of byTruck.entries()){
    const plate = trips[0]?.plate || truckId;
    excelSheets.push({
      name: plate,
      sections: [
        {
          title: 'Trips',
          columns: [
            { key:'startTime', label:'Start' },
            { key:'endTime', label:'End' },
            { key:'notes', label:'Route' },
            { key:'tripType', label:'Type' },
            { key:'expectedAmount', label:'Expected' },
          ],
          rows: trips,
        },
      ],
    });
  }

  return {
    rows: detectedTrips,
    meta: { ...range, totals, trips: detectedTrips.length },
    excelSheets,
  };
}

async function buildTripLogReport(filters={}, definition={}){
  const range = deriveDateRange(filters || {}, definition?.filters?.defaultRangeDays || 1);
  const truckFilter = typeof filters?.truckId === 'string' ? filters.truckId.trim() : '';
  const params = [range.fromDate, range.toDate];
  if(truckFilter) params.push(truckFilter);
  const rowsRaw = await q(
    `SELECT truck_id as truckId, plate, lat, lng, speed, captured_at as capturedAt, address, ignition_on as ignitionOn
       FROM telemetry_snapshots
      WHERE date(captured_at) BETWEEN date(?) AND date(?)
      ${truckFilter ? 'AND truck_id = ?' : ''}
      ORDER BY truck_id, captured_at`,
    params
  );

  const grouped = new Map();
  rowsRaw.forEach((row)=>{
    if(!row.truckId) return;
    if(!grouped.has(row.truckId)) grouped.set(row.truckId, []);
    grouped.get(row.truckId).push(row);
  });

  const MIN_IDLE_MINUTES = 10;
  const MIN_DISTANCE_KM = 2;
  const allTrips = [];

  for(const [truckId, list] of grouped.entries()){
    const sorted = [...list].sort((a,b)=> new Date(a.capturedAt) - new Date(b.capturedAt));
    const plate = sorted.find((p)=> p.plate)?.plate || truckId;

    // Detect idle/stopped windows
    const idleWindows = [];
    let idleStart = null;
    let idleCoords = [];
    let lastTs = null;

    for(const row of sorted){
      const ts = Date.parse(row.capturedAt);
      const isStationary = Number(row.speed||0) <= TELEMETRY_IDLE_SPEED_KPH;
      if(isStationary){
        if(idleStart === null) idleStart = ts;
        idleCoords.push(row);
      } else if(idleStart !== null){
        const durationMin = (ts - idleStart) / 60000;
        if(durationMin >= MIN_IDLE_MINUTES){
          idleWindows.push({
            endAt: new Date(ts).toISOString(),
            startAt: new Date(idleStart).toISOString(),
            lat: avg(idleCoords.map((p)=> Number(p.lat)).filter(Number.isFinite)),
            lng: avg(idleCoords.map((p)=> Number(p.lng)).filter(Number.isFinite)),
            address: idleCoords.find((p)=> p.address)?.address || null,
          });
        }
        idleStart = null;
        idleCoords = [];
      }
      lastTs = ts;
    }
    if(idleStart !== null && lastTs){
      const durationMin = (lastTs - idleStart) / 60000;
      if(durationMin >= MIN_IDLE_MINUTES){
        idleWindows.push({
          endAt: new Date(lastTs).toISOString(),
          startAt: new Date(idleStart).toISOString(),
          lat: avg(idleCoords.map((p)=> Number(p.lat)).filter(Number.isFinite)),
          lng: avg(idleCoords.map((p)=> Number(p.lng)).filter(Number.isFinite)),
          address: idleCoords.find((p)=> p.address)?.address || null,
        });
      }
    }

    // Build trip legs between consecutive idle windows
    for(let i=0; i<idleWindows.length - 1; i++){
      const from = idleWindows[i];
      const to   = idleWindows[i+1];
      if(!Number.isFinite(from.lat) || !Number.isFinite(from.lng) || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) continue;
      const distanceKm = haversineDistanceKm(from.lat, from.lng, to.lat, to.lng);
      if(!Number.isFinite(distanceKm) || distanceKm < MIN_DISTANCE_KM) continue;
      const startTs = new Date(from.endAt).getTime();
      const endTs   = new Date(to.startAt).getTime();
      const durationMin = Math.round(Math.max(0, (endTs - startTs) / 60000));
      const originLabel = describeCoordinateLocation({ lat: from.lat, lng: from.lng, address: from.address });
      const destLabel   = describeCoordinateLocation({ lat: to.lat,   lng: to.lng,   address: to.address });
      allTrips.push({
        truckId,
        plate,
        startTime:   formatShortDateTime(from.endAt),
        endTime:     formatShortDateTime(to.startAt),
        durationMin,
        distanceKm:  Number(distanceKm.toFixed(1)),
        route:       buildRouteLabel(originLabel, destLabel),
        rawStart:    from.endAt,
      });
    }
  }

  // Sort by plate then start time
  allTrips.sort((a,b)=> a.plate.localeCompare(b.plate) || a.rawStart.localeCompare(b.rawStart));

  const excelSheets = [];
  const byTruck = new Map();
  allTrips.forEach((t)=>{
    if(!byTruck.has(t.truckId)) byTruck.set(t.truckId, []);
    byTruck.get(t.truckId).push(t);
  });
  for(const [, trips] of byTruck.entries()){
    const sheetName = trips[0]?.plate || trips[0]?.truckId || 'Truck';
    excelSheets.push({
      name: sheetName,
      sections:[{
        title: 'Trips',
        columns:[
          { key:'startTime',   label:'Start time' },
          { key:'endTime',     label:'End time' },
          { key:'durationMin', label:'Duration (min)' },
          { key:'distanceKm',  label:'KM' },
          { key:'route',       label:'Route' },
        ],
        rows: trips,
      }],
    });
  }

  const totals = { trips: allTrips.length, totalKm: Number(allTrips.reduce((s,t)=> s+t.distanceKm, 0).toFixed(1)) };
  return { rows: allTrips, meta: { ...range, totals }, excelSheets };
}

// ── Trip Timeline helpers ──

function formatTimeOnly12hr(isoStr){
  if(!isoStr) return '';
  const d = new Date(isoStr);
  if(Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2,'0')}${ampm}`;
}

function formatDateDisplay(isoDateStr){
  if(!isoDateStr) return '';
  const [year, month, day] = isoDateStr.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${day}-${months[month-1]}-${String(year).slice(-2)}`;
}

function formatDuration(minutes){
  if(!Number.isFinite(minutes) || minutes < 0) return '0min';
  if(minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

async function buildVehicleTripTimelineReport(filters={}, definition={}){
  const range = deriveDateRange(filters || {}, definition?.filters?.defaultRangeDays || 1);
  const truckFilter = typeof filters?.truckId === 'string' ? filters.truckId.trim() : '';
  const params = [range.fromDate, range.toDate];
  if(truckFilter) params.push(truckFilter);
  const rowsRaw = await q(
    `SELECT truck_id as truckId, plate, lat, lng, speed, captured_at as capturedAt, address, ignition_on as ignitionOn
       FROM telemetry_snapshots
      WHERE date(captured_at) BETWEEN date(?) AND date(?)
      ${truckFilter ? 'AND truck_id = ?' : ''}
      ORDER BY truck_id, captured_at`,
    params
  );

  const grouped = new Map();
  rowsRaw.forEach((row)=>{
    if(!row.truckId) return;
    if(!grouped.has(row.truckId)) grouped.set(row.truckId, []);
    grouped.get(row.truckId).push(row);
  });

  const MIN_IDLE_MINUTES = 10;
  const MIN_DISTANCE_KM = 2;
  const allRows = [];
  const timelineTrucks = [];
  const telegramParts = [];

  for(const [truckId, list] of grouped.entries()){
    const sorted = [...list].sort((a,b)=> new Date(a.capturedAt) - new Date(b.capturedAt));
    const plate = sorted.find((p)=> p.plate)?.plate || truckId;

    // ── Idle window detection (same algorithm as buildTripLogReport) ──
    const idleWindows = [];
    let idleStart = null;
    let idleCoords = [];
    let lastTs = null;
    let lastRow = null;

    for(const row of sorted){
      const ts = Date.parse(row.capturedAt);
      const isStationary = Number(row.speed||0) <= TELEMETRY_IDLE_SPEED_KPH;
      if(isStationary){
        if(idleStart === null) idleStart = ts;
        idleCoords.push(row);
      } else if(idleStart !== null){
        const durationMin = (ts - idleStart) / 60000;
        if(durationMin >= MIN_IDLE_MINUTES){
          idleWindows.push({
            endAt: new Date(ts).toISOString(),
            startAt: new Date(idleStart).toISOString(),
            lat: avg(idleCoords.map((p)=> Number(p.lat)).filter(Number.isFinite)),
            lng: avg(idleCoords.map((p)=> Number(p.lng)).filter(Number.isFinite)),
            address: idleCoords.find((p)=> p.address)?.address || null,
          });
        }
        idleStart = null;
        idleCoords = [];
      }
      lastTs = ts;
      lastRow = row;
    }
    if(idleStart !== null && lastTs){
      const durationMin = (lastTs - idleStart) / 60000;
      if(durationMin >= MIN_IDLE_MINUTES){
        idleWindows.push({
          endAt: new Date(lastTs).toISOString(),
          startAt: new Date(idleStart).toISOString(),
          lat: avg(idleCoords.map((p)=> Number(p.lat)).filter(Number.isFinite)),
          lng: avg(idleCoords.map((p)=> Number(p.lng)).filter(Number.isFinite)),
          address: idleCoords.find((p)=> p.address)?.address || null,
        });
      }
    }

    if(idleWindows.length === 0) continue;

    // Detect if vehicle is currently moving (last snapshot is not stationary)
    const isOngoing = lastRow && Number(lastRow.speed||0) > TELEMETRY_IDLE_SPEED_KPH;

    // ── Build event sequence ──
    const events = [];

    for(let i=0; i<idleWindows.length; i++){
      const w = idleWindows[i];
      const idleDurationMin = Math.round((new Date(w.endAt) - new Date(w.startAt)) / 60000);
      const locationLabel = shortenLocationLabel(describeCoordinateLocation({ lat: w.lat, lng: w.lng, address: w.address }));
      events.push({
        rawTime: new Date(w.startAt).getTime(),
        type: i === 0 ? 'arrival' : 'stop',
        startIso: w.startAt,
        endIso: w.endAt,
        startDisplay: formatTimeOnly12hr(w.startAt),
        endDisplay: formatTimeOnly12hr(w.endAt),
        location: locationLabel,
        durationMin: idleDurationMin,
        date: toISODate(new Date(w.startAt)),
      });

      // Trip leg from this stop to the next
      if(i < idleWindows.length - 1){
        const next = idleWindows[i+1];
        if(!Number.isFinite(w.lat) || !Number.isFinite(w.lng) || !Number.isFinite(next.lat) || !Number.isFinite(next.lng)) continue;
        const distanceKm = haversineDistanceKm(w.lat, w.lng, next.lat, next.lng);
        if(!Number.isFinite(distanceKm) || distanceKm < MIN_DISTANCE_KM) continue;
        const tripStartTs = new Date(w.endAt).getTime();
        const tripEndTs = new Date(next.startAt).getTime();
        const tripDurationMin = Math.round(Math.max(0, (tripEndTs - tripStartTs) / 60000));
        const destLabel = shortenLocationLabel(describeCoordinateLocation({ lat: next.lat, lng: next.lng, address: next.address }));
        events.push({
          rawTime: tripStartTs,
          type: 'trip',
          startIso: w.endAt,
          endIso: next.startAt,
          startDisplay: formatTimeOnly12hr(w.endAt),
          endDisplay: formatTimeOnly12hr(next.startAt),
          destination: destLabel,
          distanceKm: Number(distanceKm.toFixed(1)),
          durationMin: tripDurationMin,
          date: toISODate(new Date(w.endAt)),
        });
      }
    }

    // Ongoing trip (vehicle currently moving)
    if(isOngoing && idleWindows.length > 0){
      const lastIdle = idleWindows[idleWindows.length-1];
      const destLabel = shortenLocationLabel(describeCoordinateLocation({ lat: Number(lastRow.lat), lng: Number(lastRow.lng), address: lastRow.address }));
      events.push({
        rawTime: new Date(lastIdle.endAt).getTime(),
        type: 'ongoing',
        startIso: lastIdle.endAt,
        endIso: null,
        startDisplay: formatTimeOnly12hr(lastIdle.endAt),
        endDisplay: 'now',
        destination: destLabel,
        durationMin: null,
        date: toISODate(new Date(lastIdle.endAt)),
      });
    }

    events.sort((a,b)=> a.rawTime - b.rawTime);

    // ── Flat rows for Excel/PDF ──
    for(const ev of events){
      const dateDisplay = formatDateDisplay(ev.date);
      if(ev.type === 'arrival' || ev.type === 'stop'){
        allRows.push({ plate, date: dateDisplay, startTime: ev.startDisplay, endTime: ev.endDisplay, eventType: ev.type === 'arrival' ? 'Arrival' : 'Stop', location: ev.location, distanceKm: null, durationMin: ev.durationMin });
      } else if(ev.type === 'trip'){
        allRows.push({ plate, date: dateDisplay, startTime: ev.startDisplay, endTime: ev.endDisplay, eventType: 'Trip', location: ev.destination, distanceKm: ev.distanceKm, durationMin: ev.durationMin });
      } else {
        allRows.push({ plate, date: dateDisplay, startTime: ev.startDisplay, endTime: 'In progress', eventType: 'In Progress', location: ev.destination, distanceKm: null, durationMin: null });
      }
    }

    // ── Group by date for UI timeline ──
    const dayMap = new Map();
    for(const ev of events){
      if(!dayMap.has(ev.date)) dayMap.set(ev.date, []);
      dayMap.get(ev.date).push(ev);
    }
    const days = [...dayMap.entries()]
      .sort(([a],[b])=> a.localeCompare(b))
      .map(([date, dayEvents])=>({
        date,
        dateDisplay: formatDateDisplay(date),
        events: dayEvents.map((ev)=>{
          if(ev.type === 'arrival' || ev.type === 'stop'){
            return { type: ev.type, startDisplay: ev.startDisplay, endDisplay: ev.endDisplay, location: ev.location, durationMin: ev.durationMin };
          }
          if(ev.type === 'trip'){
            return { type: 'trip', startDisplay: ev.startDisplay, endDisplay: ev.endDisplay, destination: ev.destination, distanceKm: ev.distanceKm, durationMin: ev.durationMin };
          }
          return { type: 'ongoing', startDisplay: ev.startDisplay, destination: ev.destination };
        }),
      }));
    timelineTrucks.push({ plate, truckId, days });

    // ── Telegram text ──
    const truckLines = [plate];
    for(const day of days){
      truckLines.push(`  ${day.dateDisplay}`);
      for(const ev of day.events){
        if(ev.type === 'arrival'){
          truckLines.push(`  ${ev.startDisplay}–${ev.endDisplay} > ${ev.location} (arrival, ${formatDuration(ev.durationMin)})`);
        } else if(ev.type === 'stop'){
          truckLines.push(`  ${ev.startDisplay}–${ev.endDisplay} > Stopped at ${ev.location} (${formatDuration(ev.durationMin)})`);
        } else if(ev.type === 'trip'){
          const distStr = ev.distanceKm ? ` ${ev.distanceKm}km` : '';
          truckLines.push(`  ${ev.startDisplay}–${ev.endDisplay} > Drove to ${ev.destination}${distStr} (${formatDuration(ev.durationMin)})`);
        } else {
          truckLines.push(`  ${ev.startDisplay}–now > Driving to ${ev.destination}`);
        }
      }
    }
    telegramParts.push(truckLines.join('\n'));
  }

  // ── Per-truck Excel sheets ──
  const excelSheets = [];
  const byTruck = new Map();
  allRows.forEach((r)=>{
    if(!byTruck.has(r.plate)) byTruck.set(r.plate, []);
    byTruck.get(r.plate).push(r);
  });
  for(const [plate, rows] of byTruck.entries()){
    excelSheets.push({
      name: plate,
      sections:[{
        title: 'Trip Timeline',
        columns:[
          { key:'date',        label:'Date' },
          { key:'startTime',   label:'Start Time' },
          { key:'endTime',     label:'End Time' },
          { key:'eventType',   label:'Event' },
          { key:'location',    label:'Location' },
          { key:'distanceKm',  label:'Distance (km)' },
          { key:'durationMin', label:'Duration (min)' },
        ],
        rows,
      }],
    });
  }

  const totals = {
    trucks: timelineTrucks.length,
    events: allRows.length,
    totalKm: Number(allRows.reduce((s,r)=> s + (Number(r.distanceKm)||0), 0).toFixed(1)),
  };
  return {
    rows: allRows,
    meta: { ...range, totals },
    excelSheets,
    timeline: { trucks: timelineTrucks },
    telegramLines: telegramParts.join('\n---\n'),
  };
}

function extractSpeedFromAlert(alert){
  const raw = alert?.raw || {};
  const speed = Number(raw.speedKph ?? raw.speed ?? raw.maxSpeed);
  return Number.isFinite(speed) ? speed : null;
}

function extractLocationLabel(raw={}, summary=''){
  if(!raw) return summary || '';
  const location = raw.location || raw.address || raw.site || raw.region || '';
  if(location) return location;
  if(summary && summary.includes('near ')){
    const match = summary.match(/near ([^.|]+)/i);
    if(match && match[1]) return match[1].trim();
  }
  return summary || '';
}

function formatDriverLabel(raw={}){
  return raw.driverName || raw.driver || raw.driverId || raw.driverPhone || '';
}

async function buildAiInsightsReport(filters={}, definition={}){
  const range = deriveDateRange(filters || {}, definition?.filters?.defaultRangeDays || 1);
  const truckId = typeof filters?.truckId === 'string' ? filters.truckId.trim() : '';
  const baseParams = [range.fromDate, range.toDate];
  const snapshotParams = truckId ? [...baseParams, truckId] : baseParams;
  const alertsParams = truckId ? [...baseParams, truckId] : baseParams;
  const snapshots = await q(
    `SELECT truck_id as truckId,
            COALESCE(plate, truck_id) as plate,
            speed,
            idle_minutes as idleMinutes,
            status,
            address,
            captured_at as capturedAt
       FROM telemetry_snapshots
      WHERE date(captured_at) BETWEEN date(?) AND date(?)
        ${truckId ? 'AND truck_id=?' : ''}
   ORDER BY datetime(captured_at) DESC`,
    snapshotParams
  );
  const alertsRaw = await q(
    `SELECT truck_id as truckId, alert_type as alertType, summary, raw, created_at as createdAt
       FROM telemetry_ai_alerts
      WHERE date(created_at) BETWEEN date(?) AND date(?)
        ${truckId ? 'AND truck_id=?' : ''}
   ORDER BY datetime(created_at) DESC`,
    alertsParams
  );
  const buckets = new Map();
  const ensureBucket = (truckIdValue, plateValue)=>{
    const key = truckIdValue || plateValue || 'UNKNOWN';
    if(!buckets.has(key)){
      buckets.set(key, {
        truckId: truckIdValue || plateValue || 'UNKNOWN',
        plate: plateValue || truckIdValue || 'Truck',
        snapshots: [],
        alerts: [],
      });
    }
    return buckets.get(key);
  };
  snapshots.forEach((row)=>{
    if(!row?.truckId) return;
    const bucket = ensureBucket(row.truckId, row.plate);
    bucket.snapshots.push(row);
  });
  alertsRaw.forEach((row)=>{
    if(!row?.truckId) return;
    const raw = safeParseJSON(row.raw) || {};
    const plate = raw.plate || raw.truckPlate || raw.vehiclePlate || row.summary || row.truckId;
    const bucket = ensureBucket(row.truckId, plate);
    bucket.alerts.push({ ...row, raw, plate });
  });
  const rows = [];
  const messageBlocks = [];
  for(const bucket of buckets.values()){
    const maxSpeedEntry = bucket.snapshots.reduce(
      (acc, snap)=>{
        const speed = Number(snap.speed);
        if(Number.isFinite(speed) && speed > (acc.speed ?? -Infinity)){
          return { speed, capturedAt: snap.capturedAt, location: snap.address || '' };
        }
        return acc;
      },
      { speed: null, capturedAt: null, location: '' }
    );
    const idleMaxEntry = bucket.snapshots.reduce(
      (acc, snap)=>{
        const idle = Number(snap.idleMinutes);
        if(Number.isFinite(idle) && idle > (acc.idle ?? -Infinity)){
          return { idle, location: snap.address || '', capturedAt: snap.capturedAt };
        }
        return acc;
      },
      { idle: null, location: '', capturedAt: null }
    );
    const alertsCount = bucket.alerts.length;
    const latestAlert = bucket.alerts[0] || null;
    const latestAlertSpeed = latestAlert ? extractSpeedFromAlert(latestAlert) : null;
    const latestAlertLocation = latestAlert ? extractLocationLabel(latestAlert.raw, latestAlert.summary || '') : '';
    const insights = [];
    if(alertsCount){
      const alertLabel = latestAlert?.alertType || 'alert';
      const parts = [
        `${alertsCount} ${alertLabel}${alertsCount === 1 ? '' : 's'}`,
        latestAlertSpeed ? `${latestAlertSpeed.toFixed(1)} km/h` : null,
        latestAlertLocation ? `near ${latestAlertLocation}` : null,
        latestAlert?.createdAt ? `@ ${formatShortDateTime(latestAlert.createdAt)}` : null,
      ].filter(Boolean);
      insights.push(parts.join(' • '));
    }
    if(Number.isFinite(maxSpeedEntry.speed)){
      const suffix = maxSpeedEntry.capturedAt ? ` @ ${formatShortDateTime(maxSpeedEntry.capturedAt)}` : '';
      insights.push(`Top speed ${maxSpeedEntry.speed.toFixed(1)} km/h${suffix}`);
    }
    if(Number.isFinite(idleMaxEntry.idle) && idleMaxEntry.idle >= 10){
      const suffix = idleMaxEntry.location ? ` near ${idleMaxEntry.location}` : '';
      insights.push(`Idle up to ${Math.round(idleMaxEntry.idle)} min${suffix}`);
    }
    if(!insights.length){
      insights.push('No notable alerts; operations steady in this window.');
    }
    const padded = [...insights];
    while(padded.length < 3) padded.push('');
    rows.push({
      truckId: bucket.truckId,
      plate: bucket.plate,
      insight1: padded[0],
      insight2: padded[1],
      insight3: padded[2],
      alertsCount,
      maxSpeed: Number.isFinite(maxSpeedEntry.speed) ? Number(maxSpeedEntry.speed.toFixed(1)) : null,
      idleMaxMinutes: Number.isFinite(idleMaxEntry.idle) ? Math.round(idleMaxEntry.idle) : null,
    });
    const blockLines = [bucket.plate || bucket.truckId];
    padded.filter(Boolean).forEach((line)=> blockLines.push(`- ${line}`));
    messageBlocks.push(blockLines.join('\n'));
  }
  const header = `AI insights (${range.fromDate} to ${range.toDate})`;
  const body = messageBlocks.length ? messageBlocks.join('\n\n') : 'No telemetry or alerts recorded for this window.';
  return {
    rows,
    meta: { ...range, trucks: rows.length, alerts: alertsRaw.length },
    telegramBody: `${header}\n\n${body}`,
    emailBody: `${header}\n\n${body}`,
  };
}

async function buildSpeedingAlertReport(filters={}, definition={}){
  const range = deriveDateRange(filters || {}, definition?.filters?.defaultRangeDays || 7);
  const truckId = typeof filters?.truckId === 'string' ? filters.truckId.trim() : '';
  const params = truckId ? [range.fromDate, range.toDate, truckId] : [range.fromDate, range.toDate];
  const alerts = await q(
    `SELECT truck_id as truckId, alert_type as alertType, summary, raw, created_at as createdAt
       FROM telemetry_ai_alerts
      WHERE alert_type='SPEEDING'
        AND date(created_at) BETWEEN date(?) AND date(?)
        ${truckId ? 'AND truck_id=?' : ''}
   ORDER BY datetime(created_at) DESC`,
    params
  );
  const buckets = new Map();
  const ensureBucket = (truckIdValue, plateValue)=>{
    const key = truckIdValue || plateValue || 'UNKNOWN';
    if(!buckets.has(key)){
      buckets.set(key, {
        truckId: truckIdValue || plateValue || 'UNKNOWN',
        plate: plateValue || truckIdValue || 'Truck',
        alerts: [],
      });
    }
    return buckets.get(key);
  };
  alerts.forEach((row)=>{
    const raw = safeParseJSON(row.raw) || {};
    const plate = raw.plate || raw.truckPlate || raw.vehiclePlate || row.summary || row.truckId;
    const bucket = ensureBucket(row.truckId, plate);
    bucket.alerts.push({
      ...row,
      raw,
      plate,
      speed: extractSpeedFromAlert({ raw }),
      limit: Number(raw.limitKph ?? TELEMETRY_SPEED_ALERT_KPH),
      location: extractLocationLabel(raw, row.summary || ''),
      driver: formatDriverLabel(raw),
    });
  });
  const rows = [];
  const excelSheets = [];
  let totalIncidents = 0;
  let totalGross = 0;
  for(const bucket of buckets.values()){
    if(!bucket.alerts.length) continue;
    const incidentCount = bucket.alerts.length;
    totalIncidents += incidentCount;
    const grossViolations = bucket.alerts.filter((a)=> Number(a.speed || 0) >= 80);
    totalGross += grossViolations.length;
    const latest = bucket.alerts[0];
    const grossDetails = grossViolations
      .slice(0, 5)
      .map((a)=>`${formatShortDateTime(a.createdAt)} • ${Number(a.speed || 0).toFixed(1)} km/h${a.location ? ` @ ${a.location}` : ''}${a.driver ? ` • ${a.driver}` : ''}`)
      .join(' | ');
    rows.push({
      truckId: bucket.truckId,
      plate: bucket.plate,
      incidentCount,
      grossViolations: grossViolations.length,
      latestSpeed: Number.isFinite(Number(latest.speed)) ? Number(Number(latest.speed).toFixed(1)) : null,
      latestLocation: latest.location || '',
      latestDriver: latest.driver || '',
      latestAt: latest.createdAt,
      grossDetails: grossDetails || 'None recorded',
    });
    excelSheets.push({
      name: bucket.plate || bucket.truckId || 'Truck',
      sections: [
        {
          title: 'Incidents',
          columns: [
            { key: 'createdAt', label: 'Time' },
            { key: 'speed', label: 'Speed (kph)' },
            { key: 'limit', label: 'Limit (kph)' },
            { key: 'location', label: 'Location' },
            { key: 'driver', label: 'Driver' },
            { key: 'summary', label: 'Summary' },
          ],
          rows: bucket.alerts.map((a)=>({
            createdAt: a.createdAt,
            speed: Number.isFinite(Number(a.speed)) ? Number(Number(a.speed).toFixed(1)) : a.speed,
            limit: Number.isFinite(Number(a.limit)) ? Number(a.limit) : TELEMETRY_SPEED_ALERT_KPH,
            location: a.location || '',
            driver: a.driver || '',
            summary: a.summary || '',
          })),
        },
      ],
    });
  }
  const header = `Speeding alerts (${range.fromDate} to ${range.toDate})`;
  const body = rows.length
    ? rows
        .map((row)=>{
          const lines = [
            `- Incidents: ${row.incidentCount}`,
            `- Gross (>80kph): ${row.grossViolations}`,
          ];
          if(Number.isFinite(Number(row.latestSpeed))){
            lines.push(
              `- Latest: ${Number(row.latestSpeed).toFixed(1)} km/h at ${row.latestLocation || 'Unknown'} (${formatShortDateTime(row.latestAt)})`
            );
          }
          if(row.latestDriver){
            lines.push(`- Driver: ${row.latestDriver}`);
          }
          return [`${row.plate || row.truckId}`, ...lines].join('\n');
        })
        .join('\n\n')
    : 'No speeding alerts in this window.';
  return {
    rows,
    meta: { ...range, trucks: rows.length, incidents: totalIncidents, grossViolations: totalGross },
    excelSheets,
    telegramBody: `${header}\n\n${body}`,
    emailBody: `${header}\n\n${body}`,
  };
}

function avg(list){
  if(!Array.isArray(list) || !list.length) return NaN;
  const sum = list.reduce((acc,val)=> acc + val, 0);
  return sum / list.length;
}

async function generateExcelReport(definition, rows, meta={}, options={}){
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Arise & Shine Logistics';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Report', { views:[{ state:'frozen', ySplit:1 }] });
  sheet.columns = (definition.columns || []).map((col)=>({
    header: col.label,
    key: col.key,
    width: guessColumnWidth(col),
    style: columnStyle(col),
  }));
  rows.forEach((row)=>{
    const shaped = {};
    (definition.columns || []).forEach((col)=>{
      shaped[col.key] = formatCellForExcel(row[col.key], col.dataType);
    });
    sheet.addRow(shaped);
  });
  autoFitWorksheet(sheet);
  const summary = workbook.addWorksheet('Summary');
  summary.columns = [
    { header:'Field', key:'field', width:24 },
    { header:'Value', key:'value', width:64 },
  ];
  const flatMeta = flattenReportMeta(meta);
  if(Object.keys(flatMeta).length === 0){
    summary.addRow({ field:'Info', value:'No summary data captured for this export.' });
  }else{
    Object.entries(flatMeta).forEach(([field,value])=>{
      summary.addRow({ field, value });
    });
  }
  if(options?.excelSheets?.length){
    const usedNames = new Set(['Report','Summary']);
    options.excelSheets.forEach((cfg, idx)=>{
      if(!cfg.sections || !cfg.sections.length) return;
      const base = (cfg.name || `Truck ${idx+1}` || '').toString().trim() || `Truck ${idx+1}`;
      const sheetName = ensureUniqueSheetName(base, usedNames);
      usedNames.add(sheetName);
      const ws = workbook.addWorksheet(sheetName);
      cfg.sections.forEach((section, sectionIndex)=>{
        const titleRow = ws.addRow([section.title || `Section ${sectionIndex+1}`]);
        titleRow.font = { bold:true };
        ws.addRow([]);
        if(section.columns && section.columns.length){
          const headerRow = ws.addRow(section.columns.map((col)=> col.label));
          headerRow.font = { bold: true };
          section.rows?.forEach((row)=>{
            ws.addRow(section.columns.map((col)=> row[col.key] ?? ''));
          });
        }
        ws.addRow([]);
      });
      autoFitWorksheet(ws);
    });
  }

  return workbook.xlsx.writeBuffer();
}

function columnStyle(column){
  if(!column || !column.dataType) return undefined;
  if(column.dataType === 'currency'){
    return { numFmt: '"KES"#,##0.00' };
  }
  if(column.dataType === 'number'){
    return { numFmt: '#,##0.00' };
  }
  return undefined;
}

function guessColumnWidth(column){
  if(!column) return 18;
  if(column.dataType === 'number' || column.dataType === 'currency') return 14;
  if(column.dataType === 'date' || column.dataType === 'datetime') return 20;
  return Math.max(18, (column.label || '').length + 4);
}

function autoFitWorksheet(ws){
  const colWidths = [];
  ws.eachRow((row)=>{
    row.eachCell({ includeEmpty: false }, (cell, colNumber)=>{
      const len = (cell.value != null ? String(cell.value) : '').length;
      if(!colWidths[colNumber] || len > colWidths[colNumber]) colWidths[colNumber] = len;
    });
  });
  colWidths.forEach((w, colNumber)=>{
    ws.getColumn(colNumber).width = Math.min(Math.max(w + 2, 10), 60);
  });
}

function formatCellForExcel(value, dataType){
  if(value === null || value === undefined) return '';
  if(dataType === 'number' || dataType === 'currency'){
    const num = Number(value);
    return Number.isFinite(num) ? num : value;
  }
  return value;
}

function flattenReportMeta(meta){
  if(!meta || typeof meta !== 'object') return {};
  const flat = {};
  Object.entries(meta).forEach(([key,value])=>{
    if(value === null || value === undefined){
      flat[key] = '';
    }else if(typeof value === 'object'){
      flat[key] = JSON.stringify(value);
    }else{
      flat[key] = value;
    }
  });
  return flat;
}

function ensureUniqueSheetName(baseName, used){
  const sanitized = (baseName || 'Sheet').toString().trim() || 'Sheet';
  const maxLength = 30;
  let candidate = sanitized.slice(0, maxLength);
  let counter = 1;
  while(used.has(candidate)){
    counter += 1;
    const suffix = ` (${counter})`;
    candidate = `${sanitized}`.slice(0, Math.max(1, maxLength - suffix.length)) + suffix;
  }
  return candidate;
}

function generatePdfReport(definition, rows, meta={}){
  return new Promise((resolve, reject)=>{
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const chunks = [];
    doc.on('data', (chunk)=> chunks.push(chunk));
    doc.on('end', ()=> resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(16).text(definition.title || 'Report Export', { align:'center' });
    doc.moveDown();
    doc.fontSize(10);
    const flatMeta = flattenReportMeta(meta);
    const metaEntries = Object.entries(flatMeta);
    if(metaEntries.length){
      metaEntries.forEach(([field,value])=>{
        doc.text(`${field}: ${value}`);
      });
    }else{
      doc.text('No summary context was provided for this export.');
    }
    doc.moveDown();
    if(rows.length === 0){
      doc.fontSize(11).text('No data rows for the selected period.');
      doc.end();
      return;
    }
    doc.fontSize(11).text((definition.columns || []).map((col)=> col.label).join(' | '));
    doc.moveDown(0.5);
    doc.fontSize(9);
    rows.forEach((row)=>{
      const line = (definition.columns || []).map((col)=> formatCellForPdf(row[col.key], col.dataType)).join(' | ');
      doc.text(line);
    });
    doc.end();
  });
}

function formatCellForPdf(value, dataType){
  if(value === null || value === undefined) return '';
  if(dataType === 'currency'){
    return formatCurrency(value);
  }
  if(dataType === 'number'){
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString() : String(value);
  }
  return String(value);
}

function hashString(value){
  let hash = 0;
  const str = value || '';
  for(let i=0; i<str.length; i++){
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
function runWithTimeout(createRequest, timeoutMs, label='ai-request'){
  if(timeoutMs <= 0) return createRequest();
  let timer = null;
  return Promise.race([
    createRequest(),
    new Promise((_, reject)=>{
      timer = setTimeout(()=> reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]).finally(()=>{ if(timer) clearTimeout(timer); });
}
function buildFallbackImageUrl(topic, salt=''){
  const pool = ARTICLE_IMAGE_POOL.length ? ARTICLE_IMAGE_POOL : [ARTICLE_IMAGE_FALLBACK];
  if(!pool.length) return ARTICLE_IMAGE_FALLBACK;
  const key = `${(topic || 'logistics operations').toLowerCase()}|${salt || ''}`;
  const index = Math.abs(hashString(key)) % pool.length;
  return pool[index] || ARTICLE_IMAGE_FALLBACK;
}
async function fetchUnsplashImage(topic, salt=null){
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  const fallbackUrl = buildFallbackImageUrl(topic, salt || '');
  if(!accessKey) return fallbackUrl;
  try{
    const response = await fetch(`https://api.unsplash.com/photos/random?query=${encodeURIComponent(topic)}&orientation=landscape`, {
      headers: { Authorization: `Client-ID ${accessKey}` },
    });
    if(!response.ok) throw new Error(`Unsplash responded ${response.status}`);
    const data = await response.json();
    return data?.urls?.regular || data?.urls?.full || fallbackUrl;
  }catch(err){
    console.warn('Unsplash fetch failed', err);
    return fallbackUrl;
  }
}

function normaliseStoredArticleImages(){
  db.all(`SELECT id, topic, image_url FROM articles`, (err, rows=[]) => {
    if(err){
      console.warn('Failed to inspect article images', err);
      return;
    }
    rows.forEach((row)=>{
      const rawUrl = row.image_url || '';
      const defaultTopic = row.topic || 'logistics operations';
      const applyFallback = (topicCandidate)=>{
        const fallbackUrl = buildFallbackImageUrl(topicCandidate || defaultTopic, row.id);
        if(fallbackUrl === rawUrl) return;
        db.run(`UPDATE articles SET image_url=? WHERE id=?`, [fallbackUrl, row.id], (updateErr)=>{
          if(updateErr){
            console.warn(`Failed to reset image for article ${row.id}`, updateErr);
          }
        });
      };
      if(!rawUrl){
        applyFallback(defaultTopic);
        return;
      }
      const needsReset =
        rawUrl.startsWith('https://source.unsplash.com/') ||
        rawUrl.includes('&topic=') ||
        rawUrl.includes('?topic=');
      if(needsReset){
        applyFallback(defaultTopic);
        return;
      }
      try{
        const parsed = new URL(rawUrl);
        const explicitTopic = parsed.searchParams.get('topic');
        const hasBrokenTopicParam = rawUrl.includes('&topic=');
        const hasCorruptedQueryValue = parsed.hostname.includes('unsplash.com') &&
          Array.from(parsed.searchParams.values()).some((value)=> typeof value === 'string' && value.includes(','));
        if(hasBrokenTopicParam || hasCorruptedQueryValue){
          applyFallback(explicitTopic || defaultTopic);
        }
      }catch(parseErr){
        console.warn(`Article image URL malformed for ${row.id}`, parseErr);
        applyFallback(defaultTopic);
      }
    });
  });
}
function normaliseStoredArticles(){
  db.all(`SELECT id,title,summary,body,topic,word_count,image_url FROM articles`, (err, rows=[]) => {
    if(err){
      console.warn('Failed to inspect stored articles', err);
      return;
    }
    rows.forEach((row)=>{
      const fallback = {
        title: row.title || '',
        summary: row.summary || '',
        body: row.body || '',
        wordCount: Number(row.word_count) || wordCount(row.body || ''),
        topic: row.topic || null,
      };
      const coerced = coerceArticleResponse(row.body || '', fallback);
      const updates = [];
      const params = [];
      if(coerced.title !== row.title){
        updates.push('title=?');
        params.push(coerced.title);
      }
      const coercedSummary = coerced.summary || null;
      const currentSummary = row.summary || null;
      if(coercedSummary !== currentSummary){
        updates.push('summary=?');
        params.push(coercedSummary);
      }
      if(coerced.body !== row.body){
        updates.push('body=?');
        params.push(coerced.body);
      }
      if(Number(coerced.wordCount) !== Number(row.word_count)){
        updates.push('word_count=?');
        params.push(coerced.wordCount);
      }
      const shouldResetImage = !row.image_url || String(row.image_url).startsWith('https://source.unsplash.com/');
      if(shouldResetImage){
        updates.push('image_url=?');
        params.push(buildFallbackImageUrl(row.topic || 'logistics operations'));
      }
      if(updates.length){
        params.push(row.id);
        db.run(`UPDATE articles SET ${updates.join(', ')} WHERE id=?`, params, (updateErr)=>{
          if(updateErr){
            console.warn(`Failed to normalise stored article ${row.id}`, updateErr);
          }
        });
      }
    });
  });
}

function buildFallbackArticle(topic){
  const focus = (topic || 'logistics operations').toLowerCase();
  const baseSeed = `${focus}-${toISODate()}`;
  const choose = (pool, salt)=> pool[Math.abs(hashString(`${baseSeed}|${salt}`)) % pool.length];
  const openers = [
    `Construction leads across East Africa are tightening controls on ${focus} while keeping fleets productive despite price swings.`,
    `${focus} is a daily battle against delays, supplier surprises, and roadblocks that can drain profit on a single job.`,
    `Owners expect smoother ${focus} each quarter even as weather, financing, and border paperwork complicate movement.`,
  ];
  const riskLines = [
    `The fastest way to lose margin is idle time at the site gate or slow approvals on permits.`,
    `Margins vanish when trucks queue without visibility or when stock reservations are not honoured early.`,
    `Scams thrive when quotes, proof of delivery, and bank slips sit in chats instead of a traceable log.`,
  ];
  const guardrails = [
    `Set one source of truth for orders, approvals, and outstanding payments so disputes are settled in minutes, not days.`,
    `Daily 15-minute huddles on exceptions keep the team proactive instead of firefighting.`,
    `Every site lead should know which loads are late, which are rerouted, and what to tell the client before 7am.`,
  ];
  const opsLines = [
    `Lock tomorrow's load plan by 8pm with named drivers, plates, pickup windows, and expected tonnage.`,
    `Pre-assign alternates for trucks with recent breakdowns and publish the roster in a channel everyone reads.`,
    `Reserve scarce tipper capacity for high-margin customers first, then fill the remainder with nearby jobs to cut empty kilometres.`,
  ];
  const commLines = [
    `Share a plain-language ETA board with customers so they see reroutes before calling dispatch.`,
    `Notify procurement 24 hours before a pour if supplier capacity drops to avoid overtime penalties.`,
    `Give clients a simple link to confirm receipt while the driver is still on site, reducing disputes later.`,
  ];
  const techLines = [
    `Telemetry showing speed, idle minutes, and last ping should sit beside every assignment for quick judgement calls.`,
    `Automate receipts: photo odometer, pump volume, and site stamp, then attach to the order for audit.`,
    `Blend GPS, fuel, and order data so planners can spot trucks that are burning diesel without moving payload.`,
  ];
  const auditLines = [
    `Flag anomalies automatically - speeding bursts, fuel spikes, or mileage gaps - and push them to an admin review queue.`,
    `Train drivers to upload images from the cab; AI can reject blurry receipts instantly so the driver retries on-site.`,
    `When a discrepancy is found, mark it against the order and driver so repeat issues trigger coaching, not arguments.`,
  ];
  const financeLines = [
    `Finance should tag every shilling to a truck, driver, and order so gross margin per trip is obvious.`,
    `Front-load vendor payments with partial deposits only after verified delivery photos to reduce scam exposure.`,
    `Cashflow improves when you settle suppliers two days faster than the competition - without paying until proof of delivery is clean.`,
  ];
  const peopleLines = [
    `Weekly leaderboards on safe driving and on-time arrivals keep motivation high without encouraging reckless speed.`,
    `Rotate long-haul assignments to prevent fatigue and pair rookies with trusted copilots for tricky routes.`,
    `Coach underperforming drivers with data: idle minutes, hard braking, and lateness tied to real trips they recognise.`,
  ];
  const ctaLines = [
    `By Friday, circulate a one-page scorecard: late deliveries, idle hotspots, alerts resolved, and cash tied up in disputes.`,
    `Use Monday kick-offs to reset commitments with suppliers and customers based on last week's lessons.`,
    `Pick one focus each week - speeding, proof-of-delivery quality, or idle reduction - and celebrate the best team publicly.`,
  ];
  const closerLines = [
    `This cadence builds trust, protects working capital, and gives the team confidence to open new routes next month.`,
    `With cleaner data and consistent messaging, clients feel guided, not surprised, and fleet utilisation quietly rises.`,
    `Leaders who keep this rhythm outperform rivals who rely on last-minute heroics and undocumented agreements.`,
  ];
  const extraHints = [
    `Use live telemetry and expense data to coach teams weekly so no truck stays idle longer than expected and customers feel informed.`,
    `Insist on matching supplier invoices to agreed tonnage and proof-of-delivery photos before releasing payments.`,
    `Capture why a load was late - weather, gate pass, or breakdown - so patterns can be fixed instead of repeated.`,
    `Keep a minimum stock buffer for fast-moving sites so critical pours never pause while paperwork catches up.`,
  ];
  const paragraphs = [
    `${choose(openers,'p1a')} ${choose(riskLines,'p1b')} ${choose(guardrails,'p1c')}`,
    `${choose(opsLines,'p2a')} ${choose(commLines,'p2b')} ${choose(guardrails,'p2c')}`,
    `${choose(techLines,'p3a')} ${choose(auditLines,'p3b')} ${choose(commLines,'p3c')}`,
    `${choose(financeLines,'p4a')} ${choose(peopleLines,'p4b')} ${choose(riskLines,'p4c')}`,
    `${choose(ctaLines,'p5a')} ${choose(closerLines,'p5b')} ${choose(guardrails,'p5c')}`,
  ].map((paragraph)=> paragraph.replace(/\s+/g,' ').trim());

  let body = paragraphs.join('\n\n');
  while(wordCount(body) < ARTICLE_MIN_WORDS){
    const extra = choose(extraHints, `extra-${paragraphs.length}-${body.length}`);
    paragraphs.push(extra);
    body = paragraphs.join('\n\n');
  }
  body = clampArticleBody(body);
  return {
    title: `${topic}: Daily Playbook for Stronger Projects`,
    summary: `How to strengthen ${focus} while protecting budgets, supply, and trust with project owners.`,
    body,
    wordCount: wordCount(body),
  };
}

async function generateArticle(topicOverride){
  const topic = await pickTopic(topicOverride);
  let article = buildFallbackArticle(topic);
  if(openaiClient){
    try{
      const model = process.env.OPENAI_ARTICLE_MODEL || 'llama3:8b';
      const completion = await openaiClient.chat.completions.create({
        model,
        temperature: 0.4,
        messages: [
          { role:'system', content:'You write daily thought-leadership articles for a construction logistics company. Reply in JSON with keys title, summary, body. Body must have 400-420 words spread over 5 paragraphs. Tone: practical, trustworthy, East African context, with clear next actions.' },
          { role:'user', content:`Topic: ${topic}. Include one paragraph on risk mitigation, one on technology or data usage, and end with a clear call-to-action for site managers.` },
        ],
      });
      const content = completion?.choices?.[0]?.message?.content;
      if(content){
        const updated = coerceArticleResponse(content, article);
        article = {
          ...article,
          title: updated.title,
          summary: updated.summary,
          body: updated.body,
          wordCount: updated.wordCount,
        };
      }
    }catch(err){
      console.warn('OpenAI article generation failed, using fallback', err);
    }
  }
  article.body = clampArticleBody(article.body);
  article.wordCount = wordCount(article.body);
  if(article.wordCount < ARTICLE_MIN_WORDS){
    article = buildFallbackArticle(topic);
  }
  const createdAt = isoNow();
  const artId = id('ART');
  const imageUrl = await fetchUnsplashImage(topic, artId);
  await run(`INSERT INTO articles (id,title,summary,body,image_url,topic,word_count,created_at) VALUES (?,?,?,?,?,?,?,?)`,
    [artId, article.title, article.summary, article.body, imageUrl, topic, article.wordCount, createdAt]);
  return { id: artId, title: article.title, summary: article.summary, body: article.body, imageUrl, topic, wordCount: article.wordCount, createdAt };
}

let aiContextCache = { value:null, ts:0 };
let lastInsightsCache = { data:null, ts:0 };

async function getAiContextSafe(forceFresh=false){
  const now = Date.now();
  if(!forceFresh && aiContextCache.value && (now - aiContextCache.ts) < AI_CONTEXT_CACHE_MS){
    return { context: aiContextCache.value, cached: true, generatedAt: new Date(aiContextCache.ts).toISOString(), notice: null };
  }
  try{
    const context = await runWithTimeout(()=> buildAiContext(), AI_CONTEXT_TIMEOUT_MS, 'ai-context');
    aiContextCache = { value: context, ts: Date.now() };
    return { context, cached: false, generatedAt: new Date(aiContextCache.ts).toISOString(), notice: null };
  }catch(err){
    if(aiContextCache.value){
      return {
        context: aiContextCache.value,
        cached: true,
        generatedAt: new Date(aiContextCache.ts).toISOString(),
        notice: 'Using cached context due to a slow or failed refresh.',
        error: err?.message || String(err),
      };
    }
    throw err;
  }
}
async function getAiContextCached(forceFresh=false){
  const now = Date.now();
  if(!forceFresh && aiContextCache.value && (now - aiContextCache.ts) < AI_CONTEXT_CACHE_MS){
    return { context: aiContextCache.value, fromCache:true, generatedAt: new Date(aiContextCache.ts).toISOString() };
  }
  const context = await buildAiContext();
  aiContextCache = { value: context, ts: Date.now() };
  return { context, fromCache:false, generatedAt: new Date(aiContextCache.ts).toISOString() };
}

async function maybeGenerateDailyArticle(reason='manual'){
  try{
    const today = toISODate();
    const existing = await g(`SELECT id FROM articles WHERE date(created_at)=date(?) LIMIT 1`, [today]);
    if(existing) return existing;
    return await generateArticle();
  }catch(err){
    console.error('Daily article generation failed', err, { reason });
    return null;
  }
}

function scheduleDailyArticleGeneration(){
  if(process.env.DISABLE_AUTO_ARTICLES === '1') return;
  const hour = Number(process.env.ARTICLE_GENERATION_HOUR || 5);
  const minute = Number(process.env.ARTICLE_GENERATION_MINUTE || 20);
  const scheduleNext = ()=>{
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, minute, 0, 0);
    if(next <= now) next.setDate(next.getDate()+1);
    const delay = Math.max(30_000, next.getTime() - now.getTime());
    setTimeout(async ()=>{
      await maybeGenerateDailyArticle('schedule');
      scheduleNext();
    }, delay);
  };
  scheduleNext();
}

function startTelemetryPolling(){
  const interval = Math.max(0, Number(TELEMETRY_POLL_INTERVAL_MS || 0));
  if(!interval) return;
  const tick = async()=>{
    try{
      await fetchTelemetryData(true);
    }catch(err){
      console.error('Telemetry poll failed', err);
    }
  };
  setTimeout(tick, 5000);
  setInterval(tick, interval);
}

async function runReportSchedule(schedule){
  const definition = getReportDefinition(schedule.reportKey);
  const builder = REPORT_BUILDERS[schedule.reportKey];
  if(!definition || !builder){
    console.warn('Report schedule skipped (definition missing)', schedule.reportKey);
    return;
  }
  const filters = schedule.filters || {};
  const format = schedule.format || 'excel';
  const { rows, meta, excelSheets, telegramBody: builderTelegramBody, emailBody: builderEmailBody, summaryLines: builderSummaryLines } = await builder(filters, definition);
  const fileBase = `${schedule.reportKey}-${meta?.fromDate || toISODate()}-${meta?.toDate || toISODate()}`.replace(/[^a-z0-9-_]+/gi,'-');
  const isExcel = format === 'excel';
  const buffer = isExcel
    ? await generateExcelReport(definition, rows, meta, { excelSheets })
    : await generatePdfReport(definition, rows, meta);
  const fileName = `${fileBase}.${isExcel ? 'xlsx' : 'pdf'}`;
  const mimeType = isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf';
  const attachment = {
    filename: fileName,
    mimeType,
    data: Buffer.from(buffer).toString('base64'),
  };
  let summaryLines = Array.isArray(builderSummaryLines) && builderSummaryLines.length
    ? builderSummaryLines
    : [
        `${definition.title} (${format.toUpperCase()})`,
        `Rows: ${rows.length}`,
      ];
  let telegramBody = builderTelegramBody || null;
  let emailBody = builderEmailBody || null;
  if(!builderTelegramBody && !builderSummaryLines && schedule.reportKey === 'trip-expected-sales'){
    const groups = summariseTripExpectedSales(rows);
    const grandTotal = groups.reduce((sum,g)=> sum + (Number(g.totalSales)||0), 0);
    summaryLines = buildTripExpectedEmailBody(groups, grandTotal, meta);
    telegramBody = buildTripExpectedTelegram(groups, grandTotal);
  }else if(meta?.totals && !builderSummaryLines){
    if(meta.totals.sales !== undefined) summaryLines.push(`Sales: KES ${Math.round(meta.totals.sales).toLocaleString()}`);
    if(meta.totals.costs !== undefined) summaryLines.push(`Costs: KES ${Math.round(meta.totals.costs).toLocaleString()}`);
    if(meta.totals.net !== undefined) summaryLines.push(`Net: KES ${Math.round(meta.totals.net).toLocaleString()}`);
  }
  const subject = `${definition.title} report`;
  const body = emailBody || summaryLines.join('\n');
  const payload = { attachments:[attachment] };
  const nowIso = isoNow();
  if(schedule.emailRecipients?.length && schedule.channels.includes('EMAIL')){
    for(const email of schedule.emailRecipients){
      await queueEmailNotification({ email, subject, body, payload });
    }
  }
  if(schedule.telegramRecipients?.length && schedule.channels.includes('TELEGRAM')){
    for(const entry of schedule.telegramRecipients){
      const { chatId, botToken } = parseTelegramRecipient(entry, schedule.telegramBotToken || null);
      if(!chatId) continue;
      await queueTelegramNotification({ chatId, subject, body: telegramBody || body, botToken });
    }
  }
  const nextRunAt = computeNextRunAt(schedule.timeOfDay, schedule.timezoneOffsetMinutes, new Date(nowIso), schedule.frequencyMinutes, schedule.lastRunAt || nowIso);
  await run(`UPDATE report_schedules SET last_run_at=?, next_run_at=?, updated_at=? WHERE id=?`, [nowIso, nextRunAt, isoNow(), schedule.id]);
}

async function runDueReportSchedules(){
  const nowIso = isoNow();
  const due = await q(
    `SELECT * FROM report_schedules
      WHERE enabled=1 AND (next_run_at IS NULL OR datetime(next_run_at) <= datetime(?))
      ORDER BY datetime(COALESCE(next_run_at, ?)) ASC
      LIMIT 5`,
    [nowIso, nowIso]
  );
  for(const row of due){
    const schedule = mapScheduleRow(row);
    try{
      await runReportSchedule(schedule);
    }catch(err){
      console.error('Report schedule run failed', schedule.id, err);
      const nextRunAt = computeNextRunAt(schedule.timeOfDay, schedule.timezoneOffsetMinutes, new Date(), schedule.frequencyMinutes, schedule.lastRunAt || null);
      await run(`UPDATE report_schedules SET last_run_at=?, next_run_at=?, updated_at=? WHERE id=?`, [isoNow(), nextRunAt, isoNow(), schedule.id]);
    }
  }
}

function startReportScheduler(){
  const interval = Math.max(0, Number(REPORT_SCHEDULER_INTERVAL_MS || 0));
  if(!interval) return;
  const tick = ()=>{
    runDueReportSchedules().catch((err)=> console.error('Report scheduler failure', err));
  };
  setTimeout(tick, 10_000);
  setInterval(tick, interval);
}

async function buildAiContext(){
  const historyOffset = `-${Math.round(TELEMETRY_HISTORY_RETENTION_DAYS)} day`;
  const historyLimit = TELEMETRY_HISTORY_MAX_RECORDS;
  const [orders30, costs30, stock, stockTx, driverWeekRaw, driverPrevWeekRaw, costs14Raw, costsPrev14Raw, telemetryRaw, truckStatsRaw, customerStatsRaw, auditFlagsRaw, telemetryAlertsRaw, telemetryHistoryRaw, telemetryHistoryStatsRaw] = await Promise.all([
    q(`SELECT id,total,status,created_at,site FROM orders WHERE date(created_at) >= date('now','-30 day') AND deleted_at IS NULL ORDER BY created_at DESC`),
    q(`SELECT type, amount, incurred_at FROM costs WHERE date(incurred_at) >= date('now','-30 day')`),
    getStock(),
    q(`SELECT * FROM stock_tx WHERE date(created_at) >= date('now','-30 day') ORDER BY created_at DESC LIMIT 200`),
    driverEarningsWindow('-7 day','+1 day'),
    driverEarningsWindow('-14 day','-7 day'),
    q(`SELECT type, SUM(amount) as total FROM costs WHERE date(incurred_at) >= date('now','-14 day') GROUP BY type`),
    q(`SELECT type, SUM(amount) as total FROM costs WHERE date(incurred_at) >= date('now','-28 day') AND date(incurred_at) < date('now','-14 day') GROUP BY type`),
    fetchTelemetryData(),
    q(`SELECT a.truck_id as truckId,
             t.plate as plate,
             COUNT(*) as trips,
             SUM(CASE WHEN a.status='Delivered' THEN 1 ELSE 0 END) as deliveredTrips,
             SUM(CASE WHEN a.status='In Transit' THEN 1 ELSE 0 END) as inTransitTrips,
             SUM(CASE WHEN a.status='Cancelled' THEN 1 ELSE 0 END) as cancelledTrips,
             SUM(a.tonnes) as tonnesMoved
        FROM assignments a
        LEFT JOIN trucks t ON t.id=a.truck_id
      GROUP BY a.truck_id
      ORDER BY trips DESC`),
    q(`SELECT COALESCE(u.name, o.email, o.phone, 'Customer') as customerName,
             COALESCE(u.email, o.email) as customerEmail,
             COUNT(o.id) as orders,
             SUM(o.total) as totalValue
        FROM orders o
        LEFT JOIN users u ON u.id=o.customer_id
       WHERE o.deleted_at IS NULL
       GROUP BY o.customer_id,
                COALESCE(u.name, o.email, o.phone, 'Customer'),
                COALESCE(u.email, o.email)
       ORDER BY totalValue DESC
       LIMIT 50`),
    q(`SELECT id, entity_type, entity_id, message, severity, context, created_at FROM ai_audit_flags WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 100`),
    q(`SELECT id, truck_id, alert_type, severity, confidence, summary, window_start, window_end, model, raw, created_at
        FROM telemetry_ai_alerts
        WHERE datetime(created_at) >= datetime('now', ?)
        ORDER BY datetime(created_at) DESC
        LIMIT ?`, [historyOffset, TELEMETRY_HISTORY_ALERT_LIMIT]),
    q(`SELECT truck_id as truckId,
             plate,
             speed,
             status,
             idle_minutes as idleMinutes,
             address,
             captured_at as capturedAt
        FROM telemetry_snapshots
       WHERE datetime(captured_at) >= datetime('now', ?)
       ORDER BY datetime(captured_at) DESC
       LIMIT ?`, [historyOffset, historyLimit]),
    q(`SELECT truck_id as truckId,
             MAX(plate) as plate,
             COUNT(*) as samples,
             MAX(speed) as maxSpeed,
             MAX(captured_at) as lastCapturedAt
        FROM telemetry_snapshots
       WHERE datetime(captured_at) >= datetime('now', ?)
       GROUP BY truck_id`, [historyOffset]),
  ]);
  const revenue30 = orders30.reduce((sum,o)=> sum + Number(o.total||0), 0);
  const cost30 = costs30.reduce((sum,c)=> sum + Number(c.amount||0), 0);
  const truckLabelMap = new Map();
  const registerLabel = (truckId, plate)=> registerTruckLabel(truckLabelMap, truckId, plate);
  telemetryRaw.forEach(row=> registerLabel(row.truckId, row.plate || row.label));
  truckStatsRaw.forEach(row=> registerLabel(row.truckId, row.plate));
  telemetryHistoryRaw.forEach(row=> registerLabel(row.truckId, row.plate));
  telemetryHistoryStatsRaw.forEach(row=> registerLabel(row.truckId, row.plate));
  telemetryAlertsRaw.forEach(row=>{
    const rawPayload = safeParseJSON(row.raw) || null;
    const derivedPlate =
      rawPayload?.plate ||
      rawPayload?.truckPlate ||
      rawPayload?.truck?.plate ||
      rawPayload?.vehiclePlate ||
      null;
    registerLabel(row.truck_id, derivedPlate);
  });

  const telemetry = telemetryRaw.map(t=> ({ ...t, idleMinutes: idleMinutesForTelemetry(t) }));
  return {
    orders30,
    costs30,
    stock,
    stockTx,
    telemetry: telemetry.map(item=> ({ ...item, plate: item.plate || truckLabelMap.get(item.truckId) || item.truckId })),
    truckStats: truckStatsRaw.map(row=>({
      truckId: row.truckId,
      plate: row.plate || row.truckId,
      trips: Number(row.trips||0),
      deliveredTrips: Number(row.deliveredTrips||0),
      inTransitTrips: Number(row.inTransitTrips||0),
      cancelledTrips: Number(row.cancelledTrips||0),
      tonnesMoved: Number(row.tonnesMoved||0),
    })),
    customerStats: customerStatsRaw.map(row=>({
      name: row.customerName || 'Customer',
      email: row.customerEmail || null,
      orders: Number(row.orders||0),
      totalValue: Number(row.totalValue||0),
    })),
    auditFlags: auditFlagsRaw.map(row=>({
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      message: row.message,
      severity: row.severity || 'warning',
      context: safeParseObject(row.context, 'audit flag context'),
      createdAt: row.created_at,
    })),
    driverWeek: driverWeekRaw.map(d=> ({ ...d, revenue: Number(d.revenue||0) })),
    driverPrevWeek: driverPrevWeekRaw.map(d=> ({ ...d, revenue: Number(d.revenue||0) })),
    costs14: costs14Raw.map(c=> ({ type:c.type, total:Number(c.total||0) })),
    costsPrev14: costsPrev14Raw.map(c=> ({ type:c.type, total:Number(c.total||0) })),
    telemetryAlerts: telemetryAlertsRaw.map(row=>{
      const rawPayload = safeParseJSON(row.raw) || null;
      const derivedPlate =
        rawPayload?.plate ||
        rawPayload?.truckPlate ||
        rawPayload?.truck?.plate ||
        rawPayload?.vehiclePlate ||
        null;
      const label = derivedPlate || truckLabelMap.get(row.truck_id) || row.truck_id;
      const summaryBase = row.summary || `${row.alert_type || 'Alert'} recorded`;
      const summary = label && !summaryBase.includes(label)
        ? `${label}: ${summaryBase}`
        : summaryBase;
      return {
        id: row.id,
        truckId: row.truck_id,
        plate: label,
        alertType: row.alert_type,
        severity: row.severity || 'info',
        confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
        summary,
        windowStart: row.window_start,
        windowEnd: row.window_end,
        model: row.model,
        raw: rawPayload,
        createdAt: row.created_at,
      };
    }),
    telemetryHistory: telemetryHistoryRaw.map(row=>({
      truckId: row.truckId,
      plate: row.plate || truckLabelMap.get(row.truckId) || row.truckId,
      speed: row.speed === null || row.speed === undefined ? null : Number(row.speed),
      status: row.status || null,
      idleMinutes: row.idleMinutes === null || row.idleMinutes === undefined ? null : Number(row.idleMinutes),
      address: row.address || null,
      capturedAt: row.capturedAt,
    })),
    telemetryHistoryStats: telemetryHistoryStatsRaw.map(row=>({
      truckId: row.truckId,
      plate: row.plate || truckLabelMap.get(row.truckId) || row.truckId,
      samples: Number(row.samples || 0),
      maxSpeed: row.maxSpeed === null || row.maxSpeed === undefined ? null : Number(row.maxSpeed),
      lastCapturedAt: row.lastCapturedAt,
    })),
    metrics: {
      revenue30,
      cost30,
      grossProfit30: revenue30 - cost30,
      marginPct: revenue30 ? ((revenue30 - cost30)/revenue30)*100 : 0,
      ordersCount30: orders30.length,
      stockTonnes: Number(stock?.tonnes||0),
      lowStockThreshold: LOW_STOCK_THRESHOLD,
    },
    truckLabels: Object.fromEntries(truckLabelMap),
  };
}

function deriveAlerts(context){
  const alerts = [];
  const stockTonnes = Number(context.metrics.stockTonnes || 0);
  if(stockTonnes < LOW_STOCK_THRESHOLD){
    alerts.push(`Sand stock down to ${stockTonnes.toFixed(1)}t (threshold ${LOW_STOCK_THRESHOLD}t).`);
  }
  const prevDriverMap = new Map(context.driverPrevWeek.map(d=> [d.driverId, Number(d.revenue||0)]));
  for(const driver of context.driverWeek){
    const prev = prevDriverMap.get(driver.driverId) || 0;
    if(prev > 0){
      const drop = (prev - Number(driver.revenue||0)) / prev;
      if(drop >= DRIVER_ALERT_THRESHOLD){
        alerts.push(`${driver.name || driver.driverId} revenue down ${Math.round(drop*100)}% week-on-week.`);
      }
    }
  }
  const prevCostMap = new Map(context.costsPrev14.map(c=> [c.type, Number(c.total||0)]));
  for(const cost of context.costs14){
    const prev = prevCostMap.get(cost.type) || 0;
    const current = Number(cost.total||0);
    if(prev > 0){
      const increase = (current - prev)/prev;
      if(increase >= 0.25){
        alerts.push(`${cost.type} costs up ${Math.round(increase*100)}% vs prior fortnight.`);
      }
    } else if(current > 0){
      alerts.push(`${cost.type} costs introduced at ${formatCurrency(current)} in the last 14 days.`);
    }
  }
  for(const tele of context.telemetry){
    const label = resolveTruckLabel(context, tele.truckId, tele.plate);
    const idle = idleMinutesForTelemetry(tele);
    if(idle !== null){
      if(idle >= TELEMETRY_IDLE_THRESHOLD_MIN){
        alerts.push(`${label} idle ${idle} minutes; investigate offloading or diversion.`);
      } else if(tele.speed!==null && tele.speed<5 && idle >= TELEMETRY_IDLE_THRESHOLD_MIN/2){
        alerts.push(`${label} slow for ${idle} minutes; route may be congested.`);
      }
    }
  }
  for(const alert of context.telemetryAlerts.slice(0,10)){
    const label = alert.plate || alert.truckId || 'Truck';
    if(alert.alertType === 'SPEEDING' && Number.isFinite(Number(alert.raw?.speedKph || alert.raw?.speed || alert.raw?.maxSpeed))){
      const speedValue = Number(alert.raw?.speedKph || alert.raw?.speed || alert.raw?.maxSpeed);
      const limitValue = Number(alert.raw?.limitKph || TELEMETRY_SPEED_ALERT_KPH || 0);
      alerts.push(`${label} hit ${speedValue.toFixed(1)} km/h (limit ${limitValue || 'n/a'} km/h).`);
    }else{
      alerts.push(alert.summary || `${label} triggered ${alert.alertType || 'telemetry'} alert.`);
    }
  }
  return Array.from(new Set(alerts)).slice(0, 12);
}

function buildAiPayload(context, alerts){
  return {
    metrics: context.metrics,
    alerts,
    driverWeek: context.driverWeek,
    driverPrevWeek: context.driverPrevWeek,
    costs14: context.costs14,
    costsPrev14: context.costsPrev14,
    telemetry: context.telemetry.map(t=> ({
      truckId: t.truckId,
      plate: t.plate,
      status: t.status,
      speed: t.speed,
      idleMinutes: idleMinutesForTelemetry(t),
      lastUpdated: t.lastUpdated,
    })),
    recentOrders: context.orders30.slice(0,20),
    telemetryAlerts: context.telemetryAlerts.slice(0,TELEMETRY_HISTORY_ALERT_LIMIT),
    telemetryHistory: context.telemetryHistory,
    telemetryHistoryStats: context.telemetryHistoryStats,
  };
}

function getMentionedTrucks(prompt, truckLabels){
  if(!prompt || !truckLabels) return [];
  const lc = prompt.toLowerCase();
  const matched = [];
  for(const [truckId, plate] of Object.entries(truckLabels)){
    if(plate && lc.includes(plate.toLowerCase())){
      matched.push(truckId);
    }
  }
  return matched;
}

function buildAiChatPayload(context, alerts, mentionedTruckIds=[]){
  const truckLabels = context.truckLabels || {};
  const mentionSet = new Set((mentionedTruckIds||[]).filter(Boolean));
  const telemetryHistoryByTruck = new Map();
  for(const row of context.telemetryHistory || []){
    if(!telemetryHistoryByTruck.has(row.truckId)) telemetryHistoryByTruck.set(row.truckId, []);
    const arr = telemetryHistoryByTruck.get(row.truckId);
    if(arr.length < 10) arr.push(row);
  }
  const alertsByTruck = new Map();
  for(const row of context.telemetryAlerts || []){
    if(!alertsByTruck.has(row.truckId)) alertsByTruck.set(row.truckId, []);
    const arr = alertsByTruck.get(row.truckId);
    if(arr.length < 10) arr.push(row);
  }
  const highlightIds = mentionSet.size
    ? Array.from(mentionSet)
    : (context.telemetryHistoryStats || [])
        .sort((a,b)=> Number(b.maxSpeed||0) - Number(a.maxSpeed||0))
        .slice(0,5)
        .map(x=> x.truckId);
  const highlights = highlightIds.map(id=>{
    const stat = (context.telemetryHistoryStats || []).find(x=> x.truckId===id) || null;
    const lastHistory = (telemetryHistoryByTruck.get(id) || [])[0] || null;
    return {
      truckId: id,
      plate: truckLabels[id] || stat?.plate || id,
      maxSpeed: stat?.maxSpeed ?? null,
      maxSpeedAt: stat?.lastCapturedAt || null,
      lastSpeed: lastHistory?.speed ?? null,
      lastSpeedAt: lastHistory?.capturedAt || null,
    };
  });
  return {
    metrics: context.metrics,
    alerts,
    drivers: context.driverWeek.slice(0,20),
    trucks: context.truckStats.slice(0,50),
    customers: context.customerStats.slice(0,20),
    telemetry: context.telemetry.slice(0,100).map(t=> ({
      truckId: t.truckId,
      plate: t.plate,
      speed: t.speed,
      status: t.status,
      idleMinutes: idleMinutesForTelemetry(t),
      lastUpdated: t.lastUpdated,
    })),
    costs14: context.costs14,
    ordersSample: context.orders30.slice(0,30),
    stock: context.stock,
    auditFlags: context.auditFlags,
    telemetryAlerts: context.telemetryAlerts,
    telemetryHistory: context.telemetryHistory,
    telemetryHistoryStats: context.telemetryHistoryStats,
    truckHighlights: highlights,
    recentTelemetryByTruck: Object.fromEntries(highlightIds.map(id=> [id, telemetryHistoryByTruck.get(id)||[]])),
    recentAlertsByTruck: Object.fromEntries(highlightIds.map(id=> [id, alertsByTruck.get(id)||[]])),
  };
}

function fallbackInsights(context, alerts){
  const { metrics } = context;
  const lines = [
    `- Last 30d revenue ${formatCurrency(metrics.revenue30)} vs costs ${formatCurrency(metrics.cost30)} (margin ${metrics.marginPct.toFixed(1)}%).`,
    `- Stock holding ${metrics.stockTonnes.toFixed(1)}t against threshold ${LOW_STOCK_THRESHOLD}t.`,
  ];
  if(alerts.length){
    lines.push(`- Alerts: ${alerts.slice(0,3).join(' | ')}`);
  } else {
    lines.push('- No critical alerts detected this cycle. Keep executing the current plan.');
  }
  if(context.telemetryHistoryStats?.length){
    const fastest = [...context.telemetryHistoryStats]
      .filter(item=> Number.isFinite(Number(item.maxSpeed)))
      .sort((a,b)=> Number(b.maxSpeed||0) - Number(a.maxSpeed||0))
      .slice(0,3);
    if(fastest.length){
      lines.push(`- Fastest trucks recorded: ${fastest.map(item=> `${item.plate || item.truckId} at ${Number(item.maxSpeed||0).toFixed(1)} km/h (last seen ${new Date(item.lastCapturedAt).toLocaleString()})`).join('; ')}.`);
    }
  }
  if(context.telemetryAlerts?.length){
    const speedAlerts = context.telemetryAlerts.filter(a=> a.alertType === 'SPEEDING').slice(0,2);
    if(speedAlerts.length){
      lines.push(`- Speeding alerts: ${speedAlerts.map(a=> a.summary || `${a.plate || a.truckId} exceeded the limit`).join(' | ')}`);
    }
  }
  return lines.join('\n');
}

async function auditImageAgainstExpected({ entityType, entityId, imagePath, expected, description }){
  try{
    if(!imagePath){
      await addAuditFlag({ entityType, entityId, message:'No supporting image provided.', severity:'warning', context:{ expected } });
      return;
    }
    const resolvedPath = resolveUploadPath(imagePath);
    if(!resolvedPath){
      await addAuditFlag({ entityType, entityId, message:'Unable to resolve image path for audit.', severity:'warning', context:{ expected, imagePath } });
      return;
    }
    const stat = await fsp.stat(resolvedPath).catch(()=>null);
    if(!stat){
      await addAuditFlag({ entityType, entityId, message:'Image file missing on server.', severity:'warning', context:{ expected, imagePath } });
      return;
    }
    if(!openaiClient){
      await addAuditFlag({ entityType, entityId, message:'AI audit unavailable (OpenAI API key missing).', severity:'info', context:{ expected, imagePath } });
      return;
    }
    const buffer = await fsp.readFile(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
      : ext === '.webp' ? 'image/webp'
      : ext === '.heic' || ext === '.heif' ? 'image/heic'
      : 'image/jpeg';
    const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
    const model = DEFAULT_AI_AUDIT_MODEL;
    const promptText = `Expected data:${JSON.stringify(expected)}${description ? `\nContext:${description}` : ''}`;
    const completion = await openaiClient.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        {
          role:'system',
          content:'You are a compliance auditor. Compare the provided structured data to the content of the receipt or document image. Respond ONLY with valid JSON: {"matches": boolean, "discrepancies": [string], "extracted": object, "confidence": number}.',
        },
        {
          role:'user',
          content:[
            { type:'text', text: promptText },
            { type:'image_url', image_url:{ url: dataUrl } },
          ],
        },
      ],
    });
    const raw = completion?.choices?.[0]?.message?.content?.trim();
    const parsed = parseJsonSafe(raw);
    if(parsed && parsed.matches){
      await resolveAuditFlags(entityType, entityId);
      return;
    }
    const discrepancies = parsed?.discrepancies && parsed.discrepancies.length
      ? parsed.discrepancies.join('; ')
      : 'Potential mismatch detected. Please review manually.';
    await addAuditFlag({
      entityType,
      entityId,
      message: discrepancies,
      severity:'warning',
      context:{ expected, extracted: parsed?.extracted || null, confidence: parsed?.confidence ?? null, raw },
    });
  }catch(err){
    await addAuditFlag({
      entityType,
      entityId,
      message:'Image audit failed. Please review manually.',
      severity:'warning',
      context:{ error: err?.message || String(err), expected, imagePath },
    });
  }
}

function buildFallbackChatAnswer(prompt, context){
  const lc = (prompt || '').toLowerCase();
  const bullets = [];
  if(context.truckStats?.length && (lc.includes('trip') || lc.includes('delivery') || lc.includes('assignment'))){
    const top = [...context.truckStats].sort((a,b)=> b.trips - a.trips).slice(0,5);
    if(top.length){
      bullets.push(`Top trucks by trips: ${top.map(t=> `${t.plate || t.truckId}: ${t.trips} trips (${t.deliveredTrips} delivered)`).join('; ')}`);
    }
  }
  if(context.telemetry?.length){
    if(containsSpeedKeyword(lc)){
      const fastest = context.telemetry.filter(t=> Number.isFinite(Number(t.speed))).sort((a,b)=> Number(b.speed||0) - Number(a.speed||0)).slice(0,3);
      if(fastest.length){
        bullets.push(`Highest real-time speeds: ${fastest.map(t=> `${resolveTruckLabel(context, t.truckId, t.plate)} at ${Number(t.speed||0).toFixed(1)} km/h`).join('; ')}`);
      }
    }
    if(lc.includes('idle')){
      const idle = context.telemetry.map(t=> ({ ...t, idleMinutes: idleMinutesForTelemetry(t) || 0 })).filter(t=> t.idleMinutes>0).sort((a,b)=> b.idleMinutes - a.idleMinutes).slice(0,3);
      if(idle.length){
        bullets.push(`Most idle trucks now: ${idle.map(t=> `${resolveTruckLabel(context, t.truckId, t.plate)} idle ${Math.round(t.idleMinutes)} min`).join('; ')}`);
      }
    }
  }
  if(context.telemetryHistoryStats?.length && containsSpeedKeyword(lc)){
    const historicalFastest = [...context.telemetryHistoryStats]
      .filter(item=> Number.isFinite(Number(item.maxSpeed)))
      .sort((a,b)=> Number(b.maxSpeed||0) - Number(a.maxSpeed||0))
      .slice(0,3);
    if(historicalFastest.length){
      bullets.push(`Highest speeds recorded lately: ${historicalFastest.map(item=> `${item.plate || item.truckId} reached ${Number(item.maxSpeed||0).toFixed(1)} km/h (last seen ${new Date(item.lastCapturedAt).toLocaleString()})`).join('; ')}`);
    }
  }
  if(context.telemetryAlerts?.length && containsSpeedKeyword(lc)){
    const speeding = context.telemetryAlerts.filter(a=> a.alertType === 'SPEEDING').slice(0,3);
    if(speeding.length){
      bullets.push(`Recent speeding alerts: ${speeding.map(a=> a.summary || `${a.plate || a.truckId} exceeded the limit`).join('; ')}`);
    }
  }
  if(context.customerStats?.length && lc.includes('customer')){
    const topCustomers = [...context.customerStats].sort((a,b)=> b.totalValue - a.totalValue).slice(0,5);
    bullets.push(`Top customers by spend: ${topCustomers.map(c=> `${c.name}: ${formatCurrency(c.totalValue)} (${c.orders} orders)`).join('; ')}`);
  }
  if(context.auditFlags?.length){
    bullets.push(`There are ${context.auditFlags.length} document discrepancies awaiting review.`);
  }
  if(!bullets.length){
    bullets.push('I can help analyse trips, speeds, idle time, customer demand, and document discrepancies. Try asking "Which trucks delivered the most loads this month?" or "Show discrepancies in fuel receipts."');
  }
  return {
    answer: `Here’s what I found:\n- ${bullets.join('\n- ')}`,
    followUp: generateFollowUpFallback(prompt),
  };
}

function generateFollowUpFallback(prompt){
  const lc = (prompt || '').toLowerCase();
  if(lc.includes('trip')) return 'Would you also like to compare trips by driver this week?';
  if(containsSpeedKeyword(lc)) return 'Would you also like to review speeding alerts for each truck?';
  if(lc.includes('idle')) return 'Would you also like to see idle time versus assignments for these trucks?';
  if(lc.includes('customer')) return 'Would you also like to review recent order trends by region or site?';
  if(lc.includes('cost')) return 'Would you also like a breakdown of operating costs by category?';
  if(lc.includes('receipt') || lc.includes('image') || lc.includes('audit')) return 'Would you also like to list all outstanding document discrepancies?';
  return 'Would you also like to dive into stock levels or driver performance?';
}

function parseJsonSafe(value){
  if(!value) return null;
  const clean = value.replace(/```json/i,'').replace(/```$/,'').trim();
  try{
    return JSON.parse(clean);
  }catch{
    return null;
  }
}

if(process.env.DISABLE_AUTO_ARTICLES !== '1'){
  maybeGenerateDailyArticle('startup');
  scheduleDailyArticleGeneration();
}

// Health
app.get('/health', async (req,res)=>{
  try{
    await g('SELECT 1 AS ok');
    res.json({ ok: true, db: 'ok', uptime: Math.floor(process.uptime()) });
  }catch(err){
    res.status(503).json({ ok: false, db: err?.message || 'unavailable' });
  }
});

if(HAS_FRONTEND_BUNDLE){
  console.log(`Serving frontend bundle from ${FRONTEND_DIST_DIR}`);
  app.use(express.static(FRONTEND_DIST_DIR, { index:false }));
  app.get('*', (req,res,next)=>{
    if(req.method !== 'GET') return next();
    if(req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    if(req.path === '/health') return next();
    res.sendFile(FRONTEND_INDEX_FILE);
  });
}else{
  console.warn(`Frontend bundle not found at ${FRONTEND_INDEX_FILE}. Run "npm run build --prefix web" (or set WEB_DIST_DIR) so the portal UI can be served.`);
}

const PORT = process.env.PORT||4000; app.listen(PORT, ()=> console.log('API on :'+PORT));






