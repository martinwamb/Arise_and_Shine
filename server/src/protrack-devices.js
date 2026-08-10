import { ensureProtrackToken, getCachedProtrackToken } from './protrack-token.js';
import { normalisePlateKey, normalisePlateDisplay } from './plates.js';

// Protrack names a device after the vehicle it is fitted to, as "<PLATE>: <simcard>".
// Spacing around the colon is inconsistent in practice, and the tail is sometimes a
// placeholder rather than a SIM number: real values on the account include
// "KDS 577P :0741129502", "KDT 677J: 0748559792", "KDV 572U: IOT" and "KDX 931G:0300002327981".
export function plateFromDeviceName(deviceName){
  const raw = String(deviceName ?? '').trim();
  if(!raw) return '';
  const [head] = raw.split(':');
  return String(head ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

// The gate that decides whether a device may auto-create a truck. Kenyan truck plates are
// three letters, three digits, one letter. Trailers never match: Protrack trailer units are
// named ZH8631/ZH8632 (two letters, four digits) and Cartrack registers its trailers as
// KDP177T-SVR / KDQ277MS1. Anything that fails this is logged for review, never created.
export function isTruckPlate(value){
  const key = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}\d{3}[A-Z]$/.test(key);
}

function resolveDeviceListUrl(token){
  const base =
    process.env.PROTRACK_BASE_URL ||
    process.env.PROTRACK_API_URL ||
    'https://api.protrack365.com';
  const path = process.env.PROTRACK_DEVICE_LIST_PATH || '/api/device/list';
  const url = new URL(path, base);
  const tokenParam = process.env.PROTRACK_ACCESS_TOKEN_PARAM || 'access_token';
  url.searchParams.set(tokenParam, token);
  return url.toString();
}

async function resolveAccessToken(force){
  const staticToken = process.env.PROTRACK_API_TOKEN;
  if(staticToken) return String(staticToken).replace(/^bearer\s+/i, '').trim();
  try{
    const info = await ensureProtrackToken(force);
    if(info?.access) return info.access;
  }catch(err){
    console.error('Protrack token refresh failed (device list)', err);
  }
  return getCachedProtrackToken()?.access || null;
}

// Returns the raw device records for the account: { imei, devicename, activatedtime, onlinetime, ... }
export async function listProtrackDevices({ force=false } = {}){
  const token = await resolveAccessToken(force);
  if(!token) throw new Error('Protrack access token unavailable');

  const timeoutMs = Number(process.env.PROTRACK_TIMEOUT_MS || 15000) || 15000;
  const response = await fetch(resolveDeviceListUrl(token), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if(!response.ok){
    throw new Error(`Protrack device list failed with status ${response.status}`);
  }
  const payload = await response.json();
  // Protrack answers 200 with an in-body error code; 0 means success.
  if(payload?.code !== undefined && Number(payload.code) !== 0){
    throw new Error(`Protrack device list returned code ${payload.code}: ${payload?.message || 'unknown error'}`);
  }
  const record = payload?.record ?? payload?.data ?? payload;
  return Array.isArray(record) ? record : [];
}

// Splits the account's devices into ones that may auto-create a truck and ones to skip.
export function classifyProtrackDevices(devices=[]){
  const trucks = [];
  const skipped = [];
  for(const device of Array.isArray(devices) ? devices : []){
    const imei = device?.imei ? String(device.imei).trim() : '';
    const deviceName = device?.devicename ?? device?.deviceName ?? '';
    const plate = plateFromDeviceName(deviceName);
    if(!imei){
      skipped.push({ device, plate, deviceName, reason: 'missing imei' });
      continue;
    }
    if(!isTruckPlate(plate)){
      skipped.push({ device, plate, deviceName, imei, reason: 'device name is not a truck plate' });
      continue;
    }
    trucks.push({ device, plate, deviceName, imei });
  }
  return { trucks, skipped };
}

// Decides what the sync should do, without touching the database, so the same decisions can
// be previewed by scripts/sync-protrack-devices.js --dry-run before they are ever applied.
// `trucks` are rows shaped like mapTruckRow output (id, plate, protrackImei).
export function planProtrackTruckSync(trucks=[], candidates=[]){
  const byImei = new Map();
  const byId = new Map();
  const byPlateKey = new Map();
  for(const truck of Array.isArray(trucks) ? trucks : []){
    if(!truck) continue;
    byId.set(String(truck.id), truck);
    const imei = truck.protrackImei ? String(truck.protrackImei).trim() : '';
    if(imei) byImei.set(imei, truck);
    const plateKey = normalisePlateKey(truck.plate);
    if(plateKey) byPlateKey.set(plateKey, truck);
  }

  const created = [];
  const backfilled = [];
  const unchanged = [];

  for(const { plate, imei } of Array.isArray(candidates) ? candidates : []){
    const displayPlate = normalisePlateDisplay(plate);
    const plateKey = normalisePlateKey(displayPlate);
    const truckId = plateKey;

    // IMEI first so a truck whose plate was corrected still resolves; then the id/plate the
    // device name implies, which is how a manually added truck (KDH 155L) gets its tracker.
    const truck = byImei.get(imei) || byId.get(truckId) || (plateKey ? byPlateKey.get(plateKey) : null);

    if(truck){
      const currentImei = truck.protrackImei ? String(truck.protrackImei).trim() : '';
      if(currentImei === imei){
        unchanged.push({ truckId: truck.id, plate: truck.plate, imei });
        continue;
      }
      backfilled.push({ truckId: truck.id, plate: truck.plate, imei, previousImei: currentImei || null });
      byImei.set(imei, truck);
      continue;
    }

    const plan = { truckId, plate: displayPlate, imei };
    created.push(plan);
    // Register the planned truck so a second device with the same plate does not double-create.
    const placeholder = { id: truckId, plate: displayPlate, protrackImei: imei };
    byId.set(truckId, placeholder);
    byImei.set(imei, placeholder);
    if(plateKey) byPlateKey.set(plateKey, placeholder);
  }

  return { created, backfilled, unchanged };
}
