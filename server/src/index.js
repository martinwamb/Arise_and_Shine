
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
const fsp = fs.promises;
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
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

const DEFAULT_AI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || process.env.OPENAI_INSIGHTS_MODEL || 'gpt-4o-mini';
const DEFAULT_AI_AUDIT_MODEL = process.env.OPENAI_AUDIT_MODEL || DEFAULT_AI_CHAT_MODEL;
const MAX_AUDIT_FLAGS = Number.isFinite(Number(process.env.AI_AUDIT_MAX_FLAGS))
  ? Math.max(10, Number(process.env.AI_AUDIT_MAX_FLAGS))
  : 200;

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

const ARTICLE_TOPICS = [
  'Managing a construction project',
  'Avoiding scams in construction supply',
  'Global infrastructure projects to watch',
  'Budgeting for sand and aggregates',
  'Sustainable building trends',
  'Logistics best practices for construction',
  'Safety management on building sites',
  'Emerging technology in construction',
];
const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD || 50);
const TELEMETRY_IDLE_THRESHOLD_MIN = Number(process.env.TELEMETRY_IDLE_THRESHOLD_MIN || 120);
const DRIVER_ALERT_THRESHOLD = Number(process.env.DRIVER_ALERT_THRESHOLD || 0.25);
const ARTICLE_MIN_WORDS = Number(process.env.ARTICLE_MIN_WORDS || 400);
const ARTICLE_MAX_WORDS = Number(process.env.ARTICLE_MAX_WORDS || 420);
const TELEMETRY_CACHE_MS = Number(process.env.TELEMETRY_CACHE_MS || 60_000);
const TRUCK_UNIT_TONNES = Number(process.env.TRUCK_UNIT_TONNES || 20);
const BASE_PRICE_PER_TRUCK = Number(process.env.BASE_PRICE_PER_TRUCK || 32000);
const BASE_DISTANCE_KM = Number(process.env.BASE_DISTANCE_KM || 15);
const PRICE_INCREMENT_KM = Number(process.env.PRICE_INCREMENT_KM || 5);
const PRICE_INCREMENT_AMOUNT = Number(process.env.PRICE_INCREMENT_AMOUNT || 1000);
const TELEMETRY_AI_ANALYSIS_INTERVAL_MS = Number(process.env.TELEMETRY_AI_ANALYSIS_INTERVAL_MS || 300_000);
const TELEMETRY_AI_LOOKBACK_MINUTES = Number(process.env.TELEMETRY_AI_LOOKBACK_MINUTES || 240);
const TELEMETRY_AI_MIN_POINTS = Number(process.env.TELEMETRY_AI_MIN_POINTS || 6);
const TELEMETRY_AI_MAX_POINTS = Number(process.env.TELEMETRY_AI_MAX_POINTS || 60);
const TELEMETRY_AI_MIN_ANOMALY_CONFIDENCE = Number(process.env.TELEMETRY_AI_MIN_ANOMALY_CONFIDENCE || 0.55);
const TELEMETRY_AI_MODEL = process.env.TELEMETRY_AI_MODEL || process.env.OPENAI_INSIGHTS_MODEL || 'gpt-4o-mini';
const TELEMETRY_MOVING_SPEED_KPH = Number(process.env.TELEMETRY_MOVING_SPEED_KPH || 3);
const TELEMETRY_IDLE_SPEED_KPH = Number(process.env.TELEMETRY_IDLE_SPEED_KPH || 1);
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
function calcAssignmentRevenue(perTruck, tonnes, capacity){
  if(!perTruck) return 0;
  if(capacity && capacity>0){ return Number(perTruck) * (Number(tonnes||0) / Number(capacity)); }
  return Number(perTruck);
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
function pickTopic(topic){
  if(topic) return topic;
  return ARTICLE_TOPICS[Math.floor(Math.random()*ARTICLE_TOPICS.length)];
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
  const primary =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.suburb ||
    data.name ||
    '';
  const secondary = address.county || address.district || address.state_district || '';
  const tertiary = address.state || address.region || '';
  const country = address.country || '';
  const seen = new Set();
  const parts = [];
  for(const value of [primary, secondary, tertiary, country]){
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
  if(reverseGeocodeCache.has(key)){
    const cached = reverseGeocodeCache.get(key);
    return cached && typeof cached.then === 'function' ? await cached : cached;
  }
  const request = (async()=>{
    try{
      const url = new URL(GEOCODER_REVERSE_ENDPOINT);
      if(!url.searchParams.has('format')) url.searchParams.set('format','jsonv2');
      url.searchParams.set('lat', String(lat));
      url.searchParams.set('lon', String(lon));
      url.searchParams.set('zoom', '12');
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
      console.warn('Reverse geocode failed', err);
      return null;
    }
  })().then((result)=>{
    reverseGeocodeCache.set(key, result);
    return result;
  }).catch((err)=>{
    console.warn('Reverse geocode cache error', err);
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
async function queueEmailNotification({ userId=null, email, subject, body, status='QUEUED' }){
  if(!email) return;
  try{
    await run('INSERT INTO notifications (id,user_id,email,subject,body,status,attempts,created_at) VALUES (?,?,?,?,?,?,?,?)',[
      id('NTF'),
      userId,
      email,
      subject,
      body,
      status,
      0,
      isoNow(),
    ]);
    if(process.env.DEBUG_NOTIFICATIONS !== '0'){
      console.log(`[notify] queued email to ${email}: ${subject}`);
    }
  }catch(err){
    console.error('Failed to queue notification', err);
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
      await sendTelegramMessage(user.telegram_chat_id, subject, body);
    }
  }
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
      const body = `${greeting}\n\nWe received a request to reset your Arise & Shine password.\n\n${resetInstruction}\n\nIf you did not request this, you can safely ignore the email.\n\n— Arise & Shine`;
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
      const model = process.env.OPENAI_CHATBOT_MODEL || 'gpt-4o-mini';
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

app.get('/api/admin/dashboard', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const [stock, revenueToday, costToday, pending, activeAssignments, expensesPerTruck, revenue7, cost7, leaderboard] = await Promise.all([
    getStock(),
    g(`SELECT COALESCE(SUM(total),0) as total FROM orders WHERE date(created_at)=date('now') AND deleted_at IS NULL`),
    g(`SELECT COALESCE(SUM(amount),0) as total FROM costs WHERE date(incurred_at)=date('now')`),
    g(`SELECT COUNT(*) as c FROM orders WHERE status IN ('Received','Lead') AND deleted_at IS NULL`),
    g(`SELECT COUNT(*) as c FROM assignments WHERE status IN ('Scheduled','In Transit')`),
    q(`SELECT c.truck_id as truckId, t.plate as plate, SUM(c.amount) as total
       FROM costs c LEFT JOIN trucks t ON t.id=c.truck_id
       WHERE date(c.incurred_at)=date('now') GROUP BY c.truck_id`),
    g(`SELECT COALESCE(SUM(total),0) as total FROM orders WHERE date(created_at) >= date('now','-7 day') AND deleted_at IS NULL`),
    g(`SELECT COALESCE(SUM(amount),0) as total FROM costs WHERE date(incurred_at) >= date('now','-7 day')`),
    buildDriverLeaderboard(7),
  ]);
  const revenueNum = Number(revenueToday?.total||0);
  const costNum = Number(costToday?.total||0);
  const weeklyRevenue = Number(revenue7?.total||0);
  const weeklyCosts = Number(cost7?.total||0);
  res.json({
    stock,
    daily: {
      revenue: revenueNum,
      costs: costNum,
      profit: revenueNum - costNum,
    },
    weekly: {
      revenue: weeklyRevenue,
      costs: weeklyCosts,
      profit: weeklyRevenue - weeklyCosts,
    },
    pendingOrders: Number(pending?.c||0),
    activeAssignments: Number(activeAssignments?.c||0),
    expensesPerTruck: expensesPerTruck.map(e=>({ truckId:e.truckId, plate:e.plate||e.truckId, amount:Number(e.total||0) })),
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
  const rows = await q('SELECT * FROM costs ORDER BY incurred_at DESC LIMIT 500');
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
  res.json({
    driverId: targetDriver,
    driverName: driverRow?.name || req.user.name,
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
    const context = await buildAiContext();
    const alerts = deriveAlerts(context);
    let insights = fallbackInsights(context, alerts);
    if(openaiClient){
      try{
        const payload = buildAiPayload(context, alerts);
        const model = process.env.OPENAI_INSIGHTS_MODEL || 'gpt-4o-mini';
        const completion = await openaiClient.chat.completions.create({
          model,
          temperature: 0.2,
          messages: [
            { role:'system', content:'You are an operations analyst for a sand and aggregates logistics company. Respond with 3-5 bullet points highlighting risks, opportunities, and next actions. Reference the provided metrics succinctly.' },
            { role:'user', content: JSON.stringify(payload) },
          ],
        });
        const aiText = completion?.choices?.[0]?.message?.content?.trim();
        if(aiText) insights = aiText;
      }catch(err){
        console.warn('OpenAI insight generation failed, using fallback', err);
      }
    }
    res.json({ insights, alerts, telemetry: context.telemetry, metrics: context.metrics, auditFlags: context.auditFlags });
  }catch(e){ res.status(500).json({ error:'AI failed', detail: String(e) }); }
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
    const context = await buildAiContext();
    const alerts = deriveAlerts(context);
    const payload = buildAiChatPayload(context, alerts);
    let answer = '';
    let followUp = '';
    if(openaiClient){
      try{
        const model = DEFAULT_AI_CHAT_MODEL;
        const messages = [
          {
            role:'system',
            content:'You are an operations analyst for a sand logistics company. Use the provided context JSON strictly to answer questions. Provide concise, factual answers with figures when available. After the main answer, add a single follow-up suggestion that begins with "Follow-up:" and invite the admin to explore a related metric. If information is unavailable, say so explicitly.',
          },
          ...history.map((item)=> ({ role:item.role, content:item.content })),
          {
            role:'user',
            content:`Question: ${prompt}\nContext: ${JSON.stringify(payload)}`,
          },
        ];
        const completion = await openaiClient.chat.completions.create({ model, temperature:0.2, messages });
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
        console.warn('AI chat generation failed, using fallback', err);
      }
    }
    if(!answer){
      const fallback = fallbackChatAnswer(prompt, context);
      answer = fallback.answer;
      followUp = fallback.followUp;
    }
    if(!followUp){
      followUp = generateFollowUpFallback(prompt);
    }
    res.json({ answer, followUp });
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

async function fetchCartrackTelemetry(existingTrucks=[], { now } = {}){
  const baseTrucks = Array.isArray(existingTrucks) ? [...existingTrucks] : [];
  let statuses;
  try{
    statuses = await getFleetVehicleStatuses({ odometer_in_km: 'true' });
  }catch(err){
    throw Object.assign(new Error(`Cartrack telemetry request failed: ${err?.message || err}`), { cause: err });
  }
  if(!Array.isArray(statuses) || statuses.length === 0){
    const fallback = baseTrucks.length ? synthesiseTelemetry(baseTrucks) : [];
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
    const fallback = baseTrucks.length ? synthesiseTelemetry(baseTrucks) : [];
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

async function enrichTelemetryAddresses(list){
  if(!Array.isArray(list) || !list.length) return Array.isArray(list) ? list : [];
  const enriched = await Promise.all(list.map(async(item)=>{
    if(!item) return item;
    if(item.address && String(item.address).trim().length) return item;
    if(item.source && !['protrack','cartrack'].includes(String(item.source).toLowerCase())) return item;
    const latNum = Number(item.lat);
    const lonNum = Number(item.lng);
    if(!Number.isFinite(latNum) || !Number.isFinite(lonNum)) return item;
    const label = await reverseGeocode(latNum, lonNum);
    if(label){
      return { ...item, address: label };
    }
    return item;
  }));
  return enriched;
}

function fillTelemetryCoordinates(list, trucksList){
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

  const syntheticFallback = synthesiseTelemetry(trucks);
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
    try{
      const last = await g(
        `SELECT lat,lng,speed,status,captured_at,address FROM telemetry_snapshots
         WHERE truck_id=?
         ORDER BY captured_at DESC
         LIMIT 1`,
        [truckId]
      );
      const sameCoords =
        last &&
        lat !== null &&
        lng !== null &&
        Number.isFinite(Number(last.lat)) &&
        Number.isFinite(Number(last.lng)) &&
        Math.abs(Number(last.lat) - lat) < 0.0001 &&
        Math.abs(Number(last.lng) - lng) < 0.0001;
      const sameSpeed =
        last &&
        speed !== null &&
        Number.isFinite(Number(last.speed)) &&
        Math.abs(Number(last.speed) - speed) < 0.5;
      const sameStatus = last && (last.status || '') === (item?.status || '');
      const sameCapture = last && last.captured_at === capturedAt;
      if(sameCoords && sameSpeed && sameStatus && sameCapture){
        continue;
      }
      if(lat === null && lng === null && !last && item?.status === 'Unavailable'){
        continue;
      }
    }catch(err){
      console.warn('Telemetry history lookup failed', err);
    }
    const payload = {
      source: item?.source || null,
      status: item?.status || null,
      speed,
      heading,
      idleMinutes,
      address: item?.address || null,
    };
    try{
      await run(
        `INSERT INTO telemetry_snapshots (
          id, truck_id, lat, lng, speed, status, heading, source, address, idle_minutes, plate,
          captured_at, raw, created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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

async function fetchProtrackTelemetry(trucks=[], { force=false } = {}){
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
    return synthesiseTelemetry(trucksList);
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
      return synthesiseTelemetry(trucksList);
    }
    const mapped = items
      .map((item)=> mapTelemetryItem(item, trucksMap, imeiToTruck, imeiToPlate))
      .filter(Boolean);
    return mapped.length ? mapped : synthesiseTelemetry(trucksList);
  }catch(err){
    console.error('Telemetry fetch failed', err);
    return synthesiseTelemetry(trucksList);
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
  const cartrackConfigured = isFleetApiConfigured();
  let cartrackTelemetry = [];
  if(cartrackConfigured){
    try{
      const { telemetry: fleetTelemetry, trucks: mergedTrucks } = await fetchCartrackTelemetry(trucks, { now });
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
    protrackTelemetry = await fetchProtrackTelemetry(trucks, { force });
  }

  let combinedTelemetry;
  if(cartrackTelemetry.length){
    combinedTelemetry = protrackTelemetry.length ? mergeTelemetryLists(cartrackTelemetry, protrackTelemetry) : cartrackTelemetry;
  }else if(protrackTelemetry.length){
    combinedTelemetry = protrackTelemetry;
  }else if(trucks.length){
    combinedTelemetry = synthesiseTelemetry(trucks);
  }else{
    combinedTelemetry = [];
  }

  const withCoordinates = fillTelemetryCoordinates(combinedTelemetry, trucks);
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

function synthesiseTelemetry(trucks){
  const baseLat = Number(process.env.TELEMETRY_BASE_LAT || '-1.286389');
  const baseLng = Number(process.env.TELEMETRY_BASE_LNG || '36.817223');
  const now = Date.now();
  return trucks.map((truck, idx)=> ({
    truckId: truck.id,
    plate: truck.plate,
    driverId: truck.primaryDriverId || null,
    driverName: truck.driverName || null,
    driverPhone: truck.driverPhone || null,
    driverEmail: truck.driverEmail || null,
    driverAssignedAt: truck.primaryDriverAssignedAt || null,
    capacityT: truck.capacityT ?? null,
    lat: baseLat + idx * 0.01,
    lng: baseLng + idx * 0.01,
    ...(()=>{
      const phase = idx % 3;
      const speed = phase === 1 ? TELEMETRY_MOVING_SPEED_KPH + 10 : 0;
      const engineOn = phase !== 2;
      const status = engineOn
        ? (speed > TELEMETRY_MOVING_SPEED_KPH ? 'In transit' : 'Idle')
        : 'Off';
      const idleMinutes = status === 'Idle'
        ? Math.max(0, Math.round((now - (now - idx * 5 * 60000)) / 60000))
        : 0;
      return { speed, status, idleMinutes, engineOn };
    })(),
    address: 'Simulated location',
    lastUpdated: new Date(now - idx * 5 * 60000).toISOString(),
    source: 'simulated',
  }));
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

function hashString(value){
  let hash = 0;
  const str = value || '';
  for(let i=0; i<str.length; i++){
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
function buildFallbackImageUrl(topic){
  const pool = ARTICLE_IMAGE_POOL.length ? ARTICLE_IMAGE_POOL : [ARTICLE_IMAGE_FALLBACK];
  if(!pool.length) return ARTICLE_IMAGE_FALLBACK;
  const key = (topic || 'logistics operations').toLowerCase();
  const index = Math.abs(hashString(key)) % pool.length;
  return pool[index] || ARTICLE_IMAGE_FALLBACK;
}
async function fetchUnsplashImage(topic){
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  const fallbackUrl = buildFallbackImageUrl(topic);
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
        const fallbackUrl = buildFallbackImageUrl(topicCandidate || defaultTopic);
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
  const focus = topic.toLowerCase();
  const sentences = [
    `Construction leaders who focus on ${focus} right now manage risk in a market defined by price spikes, unpredictable weather, and unforgiving project timelines.`,
    `Demand for aggregates across East Africa keeps growing while haulage capacity is uneven, which means every dispatched truck must carry full value for the client.`,
    `Customers expect transparency on sourcing, safety, and sustainability without paying a premium, so operators that standardise their processes gain trust faster.`,
    `A good ${focus} strategy starts with clean data: capture order intake, stock movements, fuel spend, and driver performance in one workspace that everyone can see.`,
    `Teams can then run a daily stand-up around those numbers, highlighting which sites need priority, which routes are congested, and who requires coaching.`,
    `Shared dashboards reduce the excuses culture; when drivers see their leaderboard move, they naturally compete on safe punctual deliveries rather than shortcuts.`,
    `Suppliers who communicate upcoming bottlenecks 48 hours in advance help contractors re-plan pours and reduce expensive idle labour on site.`,
    `Finance teams should tag every shilling of variable cost to a truck or order, allowing quick margin checks before authorising another tender.`,
    `Fuel monitoring is often ignored, yet a photographed odometer and pump reading can save thousands by exposing pilferage or poorly tuned engines.`,
    `When data shows a truck idling beyond normal time on a certain estate, dispatch can message the client or re-route relief vehicles before frustrations mount.`,
    `Global projects from Dubai to Kigali prove that pairing telemetry with incentive schemes keeps utilisation high without burning out drivers.`,
    `Admins must dedicate time each Friday to review lessons learned, celebrate safe behaviour, and confirm that suppliers were paid promptly to keep materials flowing.`,
    `With that rhythm in place, the company can expand the ${focus} playbook to new towns, confident that quality and profitability travel with every convoy.`,
  ];
  const paragraphs = [];
  let buffer = [];
  for(const sentence of sentences){
    buffer.push(sentence);
    if(buffer.length===3){
      const paragraph = buffer.join(' ');
      paragraphs.push(paragraph);
      buffer = [];
    }
  }
  if(buffer.length){
    paragraphs.push(buffer.join(' '));
  }
  let body = paragraphs.join('\n\n');
  while(wordCount(body) < ARTICLE_MIN_WORDS){
    const extra = `Use live telemetry and expense data to coach teams weekly so no truck stays idle longer than expected and customers feel informed.`;
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
  const topic = pickTopic(topicOverride);
  let article = buildFallbackArticle(topic);
  if(openaiClient){
    try{
      const model = process.env.OPENAI_ARTICLE_MODEL || 'gpt-4o-mini';
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
  const imageUrl = await fetchUnsplashImage(topic);
  const createdAt = isoNow();
  const artId = id('ART');
  await run(`INSERT INTO articles (id,title,summary,body,image_url,topic,word_count,created_at) VALUES (?,?,?,?,?,?,?,?)`,
    [artId, article.title, article.summary, article.body, imageUrl, topic, article.wordCount, createdAt]);
  return { id: artId, title: article.title, summary: article.summary, body: article.body, imageUrl, topic, wordCount: article.wordCount, createdAt };
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

async function buildAiContext(){
  const [orders30, costs30, stock, stockTx, driverWeekRaw, driverPrevWeekRaw, costs14Raw, costsPrev14Raw, telemetryRaw, truckStatsRaw, customerStatsRaw, auditFlagsRaw] = await Promise.all([
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
    q(`SELECT COALESCE(u.name, o.email, o.phone, 'Customer') as name,
             COALESCE(u.email, o.email) as email,
             COUNT(o.id) as orders,
             SUM(o.total) as totalValue
        FROM orders o
        LEFT JOIN users u ON u.id=o.customer_id
       WHERE o.deleted_at IS NULL
       GROUP BY o.customer_id, name, email
       ORDER BY totalValue DESC
       LIMIT 50`),
    q(`SELECT id, entity_type, entity_id, message, severity, context, created_at FROM ai_audit_flags WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 100`),
  ]);
  const revenue30 = orders30.reduce((sum,o)=> sum + Number(o.total||0), 0);
  const cost30 = costs30.reduce((sum,c)=> sum + Number(c.amount||0), 0);
  const telemetry = telemetryRaw.map(t=> ({ ...t, idleMinutes: idleMinutesForTelemetry(t) }));
  return {
    orders30,
    costs30,
    stock,
    stockTx,
    telemetry,
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
      name: row.name || 'Customer',
      email: row.email || null,
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
    metrics: {
      revenue30,
      cost30,
      grossProfit30: revenue30 - cost30,
      marginPct: revenue30 ? ((revenue30 - cost30)/revenue30)*100 : 0,
      ordersCount30: orders30.length,
      stockTonnes: Number(stock?.tonnes||0),
      lowStockThreshold: LOW_STOCK_THRESHOLD,
    },
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
    const idle = idleMinutesForTelemetry(tele);
    if(idle !== null){
      if(idle >= TELEMETRY_IDLE_THRESHOLD_MIN){
        alerts.push(`${tele.plate || tele.truckId} idle ${idle} minutes; investigate offloading or diversion.`);
      } else if(tele.speed!==null && tele.speed<5 && idle >= TELEMETRY_IDLE_THRESHOLD_MIN/2){
        alerts.push(`${tele.plate || tele.truckId} slow for ${idle} minutes; route may be congested.`);
      }
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
  };
}

function buildAiChatPayload(context, alerts){
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

function fallbackChatAnswer(prompt, context){
  const lc = (prompt || '').toLowerCase();
  const sections = [];
  if(context.truckStats?.length && (lc.includes('trip') || lc.includes('delivery') || lc.includes('assignment'))){
    const top = [...context.truckStats].sort((a,b)=> b.trips - a.trips).slice(0,5);
    if(top.length){
      sections.push(`Top trucks by trips: ${top.map(t=> `${t.plate || t.truckId}: ${t.trips} trips (${t.deliveredTrips} delivered)`).join('; ')}.`);
    }
  }
  if(context.telemetry?.length){
    if(lc.includes('speed')){
      const fastest = context.telemetry.filter(t=> Number.isFinite(Number(t.speed))).sort((a,b)=> Number(b.speed||0) - Number(a.speed||0)).slice(0,3);
      if(fastest.length){
        sections.push(`Highest recent speeds: ${fastest.map(t=> `${t.plate || t.truckId} at ${Number(t.speed||0).toFixed(1)} km/h`).join('; ')}.`);
      }
    }
    if(lc.includes('idle')){
      const idle = context.telemetry.map(t=> ({ ...t, idleMinutes: idleMinutesForTelemetry(t) || 0 })).filter(t=> t.idleMinutes>0).sort((a,b)=> b.idleMinutes - a.idleMinutes).slice(0,3);
      if(idle.length){
        sections.push(`Most idle trucks: ${idle.map(t=> `${t.plate || t.truckId} idle ${Math.round(t.idleMinutes)} min`).join('; ')}.`);
      }
    }
  }
  if(context.customerStats?.length && lc.includes('customer')){
    const topCustomers = [...context.customerStats].sort((a,b)=> b.totalValue - a.totalValue).slice(0,5);
    sections.push(`Top customers by spend: ${topCustomers.map(c=> `${c.name}: ${formatCurrency(c.totalValue)} (${c.orders} orders)`).join('; ')}.`);
  }
  if(context.auditFlags?.length){
    sections.push(`There are ${context.auditFlags.length} document discrepancies awaiting review.`);
  }
  if(!sections.length){
    sections.push('I can help analyse trips, speeds, idle time, customer demand, and document discrepancies. Try asking “Which trucks delivered the most loads this month?” or “Show discrepancies in fuel receipts.”');
  }
  return {
    answer: sections.join('\n'),
    followUp: generateFollowUpFallback(prompt),
  };
}

function generateFollowUpFallback(prompt){
  const lc = (prompt || '').toLowerCase();
  if(lc.includes('trip')) return 'Would you also like to compare trips by driver this week?';
  if(lc.includes('speed')) return 'Would you also like to review speeding alerts for each truck?';
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

function fallbackChatAnswer(prompt, context){
  const lc = prompt.toLowerCase();
  const sections = [];
  if(context.truckStats?.length){
    if(lc.includes('trip') || lc.includes('assignment') || lc.includes('delivery')){
      const top = [...context.truckStats].sort((a,b)=> b.trips - a.trips).slice(0,5);
      sections.push(`Top trucks by trips (lifetime data): ${top.map(t=> `${t.plate || t.truckId}: ${t.trips} trips (${t.deliveredTrips} delivered)`).join('; ')}.`);
    }
  }
  if(context.telemetry?.length){
    if(lc.includes('speed')){
      const fastest = context.telemetry.filter(t=> Number.isFinite(Number(t.speed))).sort((a,b)=> Number(b.speed||0) - Number(a.speed||0)).slice(0,3);
      if(fastest.length){
        sections.push(`Highest recent speeds: ${fastest.map(t=> `${t.plate || t.truckId} at ${Number(t.speed||0).toFixed(1)} km/h`).join('; ')}.`);
      }
    }
    if(lc.includes('idle') || lc.includes('idling')){
      const idleSorted = context.telemetry.map(t=> ({ ...t, idle: idleMinutesForTelemetry(t) })).filter(t=> t.idle).sort((a,b)=> (b.idle||0) - (a.idle||0)).slice(0,3);
      if(idleSorted.length){
        sections.push(`Most idle trucks: ${idleSorted.map(t=> `${t.plate || t.truckId} idle ${Math.round(t.idle||0)} min`).join('; ')}.`);
      }
    }
  }
  if(context.customerStats?.length && (lc.includes('customer') || lc.includes('order'))){
    const topCustomers = [...context.customerStats].sort((a,b)=> b.totalValue - a.totalValue).slice(0,5);
    sections.push(`Top customers by spend: ${topCustomers.map(c=> `${c.name}: ${formatCurrency(c.totalValue)} (${c.orders} orders)`).join('; ')}.`);
  }
  if(!sections.length){
    sections.push('I can help with order volumes, driver/truck utilisation, speeds and idle time, and customer demand trends. Try asking “Which trucks moved the most loads this month?” or “Who is our top customer by spend?”.');
  }
  const answer = sections.join('\n');
  return {
    answer,
    followUp: generateFollowUpFallback(prompt),
  };
}

function generateFollowUpFallback(prompt){
  const lc = (prompt || '').toLowerCase();
  if(lc.includes('trip')) return 'Would you also like to see trips by driver this week?';
  if(lc.includes('speed')) return 'Would you also like to review trucks flagged for speeding incidents last week?';
  if(lc.includes('idle')) return 'Would you also like to see idle time versus assignments for each truck?';
  if(lc.includes('customer')) return 'Would you also like to see repeat order trends for top customers?';
  if(lc.includes('cost')) return 'Would you also like to break down operating costs by category?';
  return 'Would you also like to review driver performance or stock levels?';
}

if(process.env.DISABLE_AUTO_ARTICLES !== '1'){
  maybeGenerateDailyArticle('startup');
  scheduleDailyArticleGeneration();
}

// Health
app.get('/health', (req,res)=> res.json({ ok:true }));

const PORT = process.env.PORT||4000; app.listen(PORT, ()=> console.log('API on :'+PORT));
