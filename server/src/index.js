
import 'dotenv/config';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const fsp = fs.promises;
const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

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

const app = express();
init();
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
const ARTICLE_IMAGE_FALLBACK =
  process.env.ARTICLE_IMAGE_FALLBACK || 'https://source.unsplash.com/featured/1200x720?construction,building';
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
const GEOCODER_EMAIL = process.env.GEOCODER_EMAIL || process.env.CONTACT_EMAIL || 'support@arise.local';
const GEOCODER_USER_AGENT =
  process.env.GEOCODER_USER_AGENT || `arise-shine-logistics/1.0 (${GEOCODER_EMAIL})`;
const geocodeCache = new Map();
const telemetryCache = { data: [], fetchedAt: 0 };

function q(sql, params=[]) { return new Promise((resolve, reject)=> db.all(sql, params, (e, rows)=> e?reject(e):resolve(rows))); }
function g(sql, params=[]) { return new Promise((resolve, reject)=> db.get(sql, params, (e, row)=> e?reject(e):resolve(row))); }
function run(sql, params=[]) { return new Promise((resolve, reject)=> db.run(sql, params, function(e){ e?reject(e):resolve(this); })); }
function id(prefix='ID'){ return prefix+'-'+Math.random().toString(16).slice(2)+Math.random().toString(16).slice(2); }
function isoNow(){ return new Date().toISOString(); }
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
    await run('INSERT INTO notifications (id,user_id,email,subject,body,status,created_at) VALUES (?,?,?,?,?,?,?)',[
      id('NTF'),
      userId,
      email,
      subject,
      body,
      status,
      isoNow(),
    ]);
    if(process.env.DEBUG_NOTIFICATIONS !== '0'){
      console.log(`[notify] queued email to ${email}: ${subject}`);
    }
  }catch(err){
    console.error('Failed to queue notification', err);
  }
}
async function queueNotificationForRole(role, subject, body){
  const recipients = await q('SELECT id,email FROM users WHERE role=?',[role]);
  for(const user of recipients){
    await queueEmailNotification({ userId:user.id, email:user.email, subject, body });
  }
}

// ===== AUTH =====
app.post('/api/auth/login', async (req,res)=>{
  const { email, password } = req.body;
  const u = await findByEmail(email);
  if(!u || !check(password, u.password_hash)) return res.status(401).json({ error:'Invalid credentials' });
  res.json({ token: sign(u), user: { id:u.id, email:u.email, name:u.name, role:u.role, driverId: u.driver_id || null } });
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
  const u = await g('SELECT id,email,name,phone,role,driver_id FROM users WHERE id=?',[req.user.id]);
  res.json({ user: { id:u?.id||req.user.id, email:u?.email||req.user.email, name:u?.name||req.user.name, phone:u?.phone||'', role:u?.role||req.user.role, driverId: u?.driver_id||req.user.driverId||null } });
});

// ===== ARTICLES =====
app.get('/api/articles', async (req,res)=>{
  const limit = Math.min(50, Math.max(1, Number(req.query.limit)||10));
  const rows = await q(`SELECT id,title,summary,body,image_url,topic,word_count,created_at FROM articles ORDER BY created_at DESC LIMIT ?`, [limit]);
  res.json(rows.map(r=>({
    id: r.id,
    title: r.title,
    summary: r.summary,
    body: r.body,
    imageUrl: r.image_url,
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
    imageUrl: art.image_url,
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
  const orders = await q('SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC',[req.user.id]);
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
  const order = await g('SELECT * FROM orders WHERE id=?',[req.params.id]);
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

app.get('/api/admin/notifications', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const rows = await q('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 200');
  res.json(rows);
});
app.patch('/api/admin/notifications/:id', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const { status } = req.body || {};
  const newStatus = status || 'SENT';
  await run('UPDATE notifications SET status=?, sent_at=? WHERE id=?', [newStatus, isoNow(), req.params.id]);
  res.json({ ok:true });
});

// Admin/Ops orders & manual create
app.get('/api/admin/orders', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const { assigned } = req.query;
  let sql = `SELECT o.*, (SELECT COUNT(*) FROM assignments a WHERE a.order_id=o.id) as assigns FROM orders o ORDER BY created_at DESC`;
  const rows = await q(sql);
  let r = rows;
  if(assigned==='true') r = rows.filter(x=>x.assigns>0);
  if(assigned==='false') r = rows.filter(x=>x.assigns===0);
  res.json(r);
});
app.post('/api/admin/orders', authRequired, roleRequired('ADMIN'), async (req,res)=>{
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

app.get('/api/admin/dashboard', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const [stock, revenueToday, costToday, pending, activeAssignments, expensesPerTruck, revenue7, cost7, leaderboard] = await Promise.all([
    getStock(),
    g(`SELECT COALESCE(SUM(total),0) as total FROM orders WHERE date(created_at)=date('now')`),
    g(`SELECT COALESCE(SUM(amount),0) as total FROM costs WHERE date(incurred_at)=date('now')`),
    g(`SELECT COUNT(*) as c FROM orders WHERE status IN ('Received','Lead')`),
    g(`SELECT COUNT(*) as c FROM assignments WHERE status IN ('Scheduled','In Transit')`),
    q(`SELECT c.truck_id as truckId, t.plate as plate, SUM(c.amount) as total
       FROM costs c LEFT JOIN trucks t ON t.id=c.truck_id
       WHERE date(c.incurred_at)=date('now') GROUP BY c.truck_id`),
    g(`SELECT COALESCE(SUM(total),0) as total FROM orders WHERE date(created_at) >= date('now','-7 day')`),
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
app.get('/api/admin/orders/:id/assignments', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const rows = await q('SELECT * FROM assignments WHERE order_id=?',[req.params.id]);
  res.json(rows);
});
app.post('/api/admin/orders/:id/assignments', authRequired, roleRequired('ADMIN'), async (req,res)=>{
  const { truckId, driverId, tonnes } = req.body;
  const t = await g('SELECT * FROM trucks WHERE id=?',[truckId]);
  if(!t) return res.status(400).json({ error:'Truck not found' });
  const order = await g('SELECT sand_type FROM orders WHERE id=?',[req.params.id]);
  const category = (order?.sand_type || 'coarse').toLowerCase();
  const tn = Number(tonnes) || Number(t.capacity_t);
  const aid = id('ASN');
  await run('INSERT INTO assignments (id,order_id,truck_id,driver_id,status,scheduled_at,tonnes) VALUES (?,?,?,?,?,?,?)',[aid, req.params.id, truckId, driverId||null, 'Scheduled', new Date().toISOString(), tn]);
  const truckUnits = tn > 0 ? (tn / TRUCK_UNIT_TONNES) : 1;
  await adjustStock('OUT', truckUnits, category, `Assignment ${aid}`, req.params.id, truckId);
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
app.patch('/api/admin/assignments/:aid', authRequired, roleRequired('ADMIN'), async (req,res)=>{
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
async function adjustStock(kind, trucks, category='coarse', reason, order_id=null, truck_id=null){
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
  await run(
    'INSERT INTO stock_tx (id,kind,tonnes,trucks,category,reason,order_id,truck_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [id('STX'), kind, units * TRUCK_UNIT_TONNES, units, (category || 'coarse').toLowerCase(), reason || '', order_id, truck_id, isoNow()]
  );
  return updated;
}

app.get('/api/admin/stock', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=> res.json(await getStock()));
app.get('/api/admin/stock/tx', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=> res.json(await q('SELECT * FROM stock_tx ORDER BY created_at DESC LIMIT 200')));
app.post('/api/admin/stock/receipt', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const { truckId, tonnes, trucks, category, costPerTonne, description } = req.body;
  const truckCode = typeof truckId === 'string' ? truckId.trim() : String(truckId || '').trim();
  if(!truckCode){
    return res.status(400).json({ error:'Truck selection is required.' });
  }
  const costValue = Number(costPerTonne);
  if(!Number.isFinite(costValue) || costValue <= 0){
    return res.status(400).json({ error:'Cost per tonne must be greater than zero.' });
  }
  const categoryValue = (category || 'coarse').toLowerCase();
  let units = Number(trucks);
  if(!Number.isFinite(units) || units <= 0){
    const tonnesValue = Number(tonnes);
    if(!Number.isFinite(tonnesValue) || tonnesValue <= 0){
      return res.status(400).json({ error:'Provide trucks (counts) greater than zero.' });
    }
    units = tonnesValue / TRUCK_UNIT_TONNES;
  }
  const next = await adjustStock('IN', units, categoryValue, description||'Yard receipt', null, truckCode);
  const costAmount = costValue * (units * TRUCK_UNIT_TONNES);
  await insertCostRecord({
    id: id('CST'),
    truckId: truckCode,
    driverId: null,
    orderId: null,
    type: 'STOCK_PURCHASE',
    amount: costAmount,
    description: `Stock purchase @ ${costValue}/t`,
    incurredAtIso: isoNow(),
    createdBy: req.user.id,
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
  const truckCode = typeof truckId === 'string' ? truckId.trim() : String(truckId || '').trim();
  if(!truckCode){
    return res.status(400).json({ error:'Select the truck this cost relates to.' });
  }
  if(!type || typeof type !== 'string'){
    return res.status(400).json({ error:'Cost type is required.' });
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
    driverId: driverId || null,
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
  const { truckId, type, amount, description, incurredAt } = req.body || {};
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
  const rev = await g(`SELECT COALESCE(SUM(total),0) as revenue, COUNT(*) as orders FROM orders WHERE 1=1 ${where}`, params);
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
  const rev = await q(`SELECT date(created_at) d, SUM(total) revenue FROM orders WHERE 1=1 ${wr} GROUP BY date(created_at) ORDER BY d`, paramsR);
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
    FROM orders WHERE date(created_at) >= date(?) AND date(created_at) < date(?)
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
    JOIN orders o ON o.id=a.order_id
    LEFT JOIN trucks t ON t.id=a.truck_id
    WHERE 1=1 ${wa}
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

// ===== TRUCKS & DRIVERS =====
app.get('/api/admin/trucks', authRequired, roleRequired('ADMIN','OPS','FUEL'), async (req,res)=>{
  const rows = await q(`
    SELECT
      t.id,
      t.plate,
      t.capacity_t AS capacityT,
      t.primary_driver_id AS primaryDriverId,
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
  await run('INSERT INTO trucks (id,plate,capacity_t,primary_driver_id,created_at,updated_at) VALUES (?,?,?,?,?,?)',[
    idv,
    plate,
    Number(capacityT)||0,
    primaryDriverId || null,
    isoNow(),
    isoNow(),
  ]);
  res.json({ ok:true });
});
app.patch('/api/admin/trucks/:id', authRequired, roleRequired('ADMIN','OPS'), async (req,res)=>{
  const { plate, capacityT, primaryDriverId } = req.body || {};
  const isAdmin = req.user.role === 'ADMIN';
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
    updates.push('primary_driver_id=?');
    params.push(primaryDriverId || null);
  }
  if(updates.length === 0){
    return res.json({ ok:true });
  }
  updates.push('updated_at=?');
  params.push(isoNow());
  params.push(req.params.id);
  await run(`UPDATE trucks SET ${updates.join(', ')} WHERE id=?`, params);
  telemetryCache.fetchedAt = 0;
  const updatedRow = await g(`
    SELECT
      t.id,
      t.plate,
      t.capacity_t AS capacityT,
      t.primary_driver_id AS primaryDriverId,
      d.name AS driverName,
      d.phone AS driverPhone,
      d.email AS driverEmail,
      t.created_at AS createdAt,
      t.updated_at AS updatedAt
    FROM trucks t
    LEFT JOIN drivers d ON d.id=t.primary_driver_id
    WHERE t.id=?
  `, [req.params.id]);
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
    FROM users u LEFT JOIN orders o ON o.customer_id=u.id WHERE u.role='CUSTOMER' GROUP BY u.id ORDER BY totalSpend DESC`);
  res.json(rows);
});

// ===== DRIVER DASHBOARD =====
app.get('/api/driver/dashboard', authRequired, roleRequired('DRIVER','ADMIN','OPS'), async (req,res)=>{
  const targetDriver = req.user.role==='DRIVER' ? req.user.driverId : (req.query.driverId || req.user.driverId);
  if(!targetDriver) return res.status(400).json({ error:'Driver not linked to account' });
  const [assignments, driverRow, leaderboard, prevWindow] = await Promise.all([
    q(`SELECT a.*, o.site, o.band_id, o.per_truck, o.total, o.date_needed, t.plate, t.capacity_t
        FROM assignments a
        JOIN orders o ON o.id=a.order_id
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
    res.json({ insights, alerts, telemetry: context.telemetry, metrics: context.metrics });
  }catch(e){ res.status(500).json({ error:'AI failed', detail: String(e) }); }
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
    JOIN orders o ON o.id=a.order_id
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
    JOIN orders o ON o.id=a.order_id
    LEFT JOIN trucks t ON t.id=a.truck_id
    LEFT JOIN drivers d ON d.id=a.driver_id
    WHERE a.driver_id IS NOT NULL
      AND date(a.scheduled_at) >= date('now', ?)
      AND date(a.scheduled_at) < date('now', ?)
      AND a.status IN ('Delivered','Completed')
    GROUP BY a.driver_id
  `, [fromOffset, toOffsetExclusive]);
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
      d.name AS driverName,
      d.phone AS driverPhone,
      d.email AS driverEmail
    FROM trucks t
    LEFT JOIN drivers d ON d.id = t.primary_driver_id
    ORDER BY t.id
  `);
  const trucks = trucksRaw.map(mapTruckRow);
  if(trucks.length===0){
    telemetryCache.data = [];
    telemetryCache.fetchedAt = now;
    return [];
  }
  const trucksMap = new Map(trucks.map(t=> [String(t.id), t]));
  const baseUrl = process.env.PROTRACK_API_URL;
  const token = process.env.PROTRACK_API_TOKEN;
  const tenant = process.env.PROTRACK_TENANT_ID;
  if(!baseUrl || !token){
    const fallback = synthesiseTelemetry(trucks);
    telemetryCache.data = fallback;
    telemetryCache.fetchedAt = now;
    return fallback;
  }
  try{
    const normalized = baseUrl.endsWith('/') ? `${baseUrl}devices/positions` : `${baseUrl}/devices/positions`;
    const response = await fetch(normalized, {
      headers: {
        Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(tenant ? { 'X-Tenant': tenant } : {}),
      },
    });
    if(!response.ok) throw new Error(`Protrack responded ${response.status}`);
    const data = await response.json();
    const items = Array.isArray(data) ? data : data?.items || data?.data || [];
    if(!Array.isArray(items) || items.length===0){
      const fallback = synthesiseTelemetry(trucks);
      telemetryCache.data = fallback;
      telemetryCache.fetchedAt = now;
      return fallback;
    }
    const mapped = items.map(item=> mapTelemetryItem(item, trucksMap));
    telemetryCache.data = mapped;
    telemetryCache.fetchedAt = now;
    return mapped;
  }catch(err){
    console.error('Telemetry fetch failed', err);
    const fallback = synthesiseTelemetry(trucks);
    telemetryCache.data = fallback;
    telemetryCache.fetchedAt = now;
    return fallback;
  }
}

function mapTelemetryItem(item, trucksMap){
  const rawId = item?.truckId ?? item?.deviceId ?? item?.id ?? item?.deviceID ?? item?.vehicleId ?? item?.vehicleID ?? (item?.device && item.device.id);
  const truckKey = rawId ? String(rawId) : null;
  const truck = truckKey ? trucksMap.get(truckKey) : null;
  const plate = item?.plate || item?.vehicleNo || item?.vehicleNumber || item?.name || truck?.plate || truckKey || 'Unknown';
  const latValue = item?.lat ?? item?.latitude ?? item?.location?.lat ?? item?.location?.latitude ?? item?.position?.lat ?? item?.position?.latitude;
  const lngValue = item?.lng ?? item?.longitude ?? item?.location?.lng ?? item?.location?.longitude ?? item?.position?.lng ?? item?.position?.longitude;
  const speedValue = item?.speed ?? item?.velocity ?? item?.mph ?? item?.kph ?? item?.metrics?.speed;
  const lat = Number(latValue);
  const lng = Number(lngValue);
  const speed = Number(speedValue);
  const status = item?.status || (Number.isFinite(speed) && speed > 3 ? 'In transit' : 'Idle');
  const timeRaw = item?.gpsTime || item?.time || item?.lastSeen || item?.updatedAt || item?.timestamp || item?.fixTime;
  const lastUpdated = timeRaw ? new Date(timeRaw).toISOString() : isoNow();
  const idleMinutes = idleMinutesForTelemetry(lastUpdated);
  const driverId = truck?.primaryDriverId ?? null;
  const driverName = truck?.driverName ?? null;
  const driverPhone = truck?.driverPhone ?? null;
  const driverEmail = truck?.driverEmail ?? null;
  return {
    truckId: truckKey || truck?.id || plate,
    plate,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    speed: Number.isFinite(speed) ? Number(speed) : null,
    status,
    address: item?.address || item?.location?.address || item?.position?.address || '',
    lastUpdated,
    idleMinutes,
    source: 'protrack',
    driverId,
    driverName,
    driverPhone,
    driverEmail,
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
    capacityT: truck.capacityT ?? null,
    lat: baseLat + idx * 0.01,
    lng: baseLng + idx * 0.01,
    speed: (idx % 3) * 12,
    status: (idx % 3) * 12 > 5 ? 'En route' : 'Idle',
    address: 'Simulated location',
    lastUpdated: new Date(now - idx * 5 * 60000).toISOString(),
    source: 'simulated',
    idleMinutes: Math.round((now - (now - idx * 5 * 60000)) / 60000),
  }));
}

function idleMinutesForTelemetry(entry){
  const ts = typeof entry === 'string' ? entry : entry?.lastUpdated;
  if(!ts) return null;
  const ms = new Date(ts).getTime();
  if(!Number.isFinite(ms)) return null;
  return Math.round((Date.now() - ms)/60000);
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
    driverName: row.driverName ?? row.driver_name ?? null,
    driverPhone: row.driverPhone ?? row.driver_phone ?? null,
    driverEmail: row.driverEmail ?? row.driver_email ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
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
  if(name !== undefined){
    const trimmed = String(name).trim();
    if(trimmed){
      updates.push('name=?');
      params.push(trimmed);
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
    }
  }
  if(photoData){
    const photoPath = await saveImageFromDataUrl(photoData);
    if(photoPath){
      updates.push('photo_path=?');
      params.push(photoPath);
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

function buildFallbackImageUrl(topic){
  if(!topic) return ARTICLE_IMAGE_FALLBACK;
  const tag = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if(!tag) return ARTICLE_IMAGE_FALLBACK;
  if(ARTICLE_IMAGE_FALLBACK.includes('?')){
    return `${ARTICLE_IMAGE_FALLBACK},${tag}`;
  }
  return `${ARTICLE_IMAGE_FALLBACK}?${tag}`;
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
  db.all(`SELECT id, image_url FROM articles WHERE image_url LIKE '%&topic=%'`, (err, rows=[]) => {
    if(err){
      console.warn('Failed to inspect article images', err);
      return;
    }
    rows.forEach((row)=>{
      const raw = row.image_url || '';
      const parts = raw.split('&topic=');
      if(parts.length !== 2) return;
      try{
        const base = parts[0];
        const topicPart = decodeURIComponent(parts[1]);
        const slug = topicPart
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '');
        if(!slug) return;
        const updated = `${base}${base.includes('?') ? ',' : '?'}${slug}`;
        db.run(`UPDATE articles SET image_url=? WHERE id=?`, [updated, row.id], (updateErr)=>{
          if(updateErr) console.warn(`Failed to normalise image for article ${row.id}`, updateErr);
        });
      }catch(normaliseErr){
        console.warn(`Failed to normalise article image for ${row.id}`, normaliseErr);
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
        try{
          const parsed = JSON.parse(content);
          if(parsed.body){
            parsed.body = clampArticleBody(parsed.body);
          }
          article = {
            title: parsed.title || article.title,
            summary: parsed.summary || article.summary,
            body: parsed.body || article.body,
            wordCount: parsed.body ? wordCount(parsed.body) : article.wordCount,
          };
        }catch(parseErr){
          console.warn('Failed to parse article JSON, using fallback body', parseErr);
          const body = clampArticleBody(content);
          article = {
            title: article.title,
            summary: article.summary,
            body,
            wordCount: wordCount(body),
          };
        }
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
  const [orders30, costs30, stock, stockTx, driverWeekRaw, driverPrevWeekRaw, costs14Raw, costsPrev14Raw, telemetryRaw] = await Promise.all([
    q(`SELECT id,total,status,created_at,site FROM orders WHERE date(created_at) >= date('now','-30 day') ORDER BY created_at DESC`),
    q(`SELECT type, amount, incurred_at FROM costs WHERE date(incurred_at) >= date('now','-30 day')`),
    getStock(),
    q(`SELECT * FROM stock_tx WHERE date(created_at) >= date('now','-30 day') ORDER BY created_at DESC LIMIT 200`),
    driverEarningsWindow('-7 day','+1 day'),
    driverEarningsWindow('-14 day','-7 day'),
    q(`SELECT type, SUM(amount) as total FROM costs WHERE date(incurred_at) >= date('now','-14 day') GROUP BY type`),
    q(`SELECT type, SUM(amount) as total FROM costs WHERE date(incurred_at) >= date('now','-28 day') AND date(incurred_at) < date('now','-14 day') GROUP BY type`),
    fetchTelemetryData(),
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

if(process.env.DISABLE_AUTO_ARTICLES !== '1'){
  maybeGenerateDailyArticle('startup');
  scheduleDailyArticleGeneration();
}

// Health
app.get('/health', (req,res)=> res.json({ ok:true }));

const PORT = process.env.PORT||4000; app.listen(PORT, ()=> console.log('API on :'+PORT));
