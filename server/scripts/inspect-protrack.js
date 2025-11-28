import '../src/load-env.js';
import { ensureProtrackToken, getCachedProtrackToken } from '../src/protrack-token.js';

function safeParseObject(value) {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function buildImeiList() {
  return (process.env.PROTRACK_TRACK_IMEIS || process.env.PROTRACK_IMEIS || '')
    .split(',')
    .map((val) => val.trim())
    .filter(Boolean);
}

async function resolveToken(force) {
  if (process.env.PROTRACK_API_TOKEN) {
    const bearer = `Bearer ${process.env.PROTRACK_API_TOKEN.trim()}`;
    return { access: process.env.PROTRACK_API_TOKEN.trim(), bearer, mode: (process.env.PROTRACK_TRACK_MODE || 'header').toLowerCase() };
  }
  try {
    const token = await ensureProtrackToken(force);
    if (token) return token;
  } catch (err) {
    console.error('ensureProtrackToken failed:', err?.message || err);
  }
  return getCachedProtrackToken();
}

function buildTrackUrl(imeis, tokenInfo) {
  const trackModeEnv = (process.env.PROTRACK_TRACK_MODE || '').toLowerCase();
  let useQueryMode = trackModeEnv === 'query';
  if (!useQueryMode && trackModeEnv !== 'header' && tokenInfo?.mode === 'signature') {
    useQueryMode = true;
  }

  const trackBaseOverride = process.env.PROTRACK_TRACK_URL;
  const baseCandidate =
    process.env.PROTRACK_BASE_URL ||
    process.env.PROTRACK_API_URL ||
    'https://api.protrack365.com';
  const defaultPath = process.env.PROTRACK_TRACK_PATH || '/api/track';
  let targetUrl;
  if (trackBaseOverride) {
    targetUrl = trackBaseOverride;
  } else if (useQueryMode) {
    targetUrl = new URL(defaultPath, baseCandidate).toString();
  } else if (process.env.PROTRACK_API_URL) {
    const legacyBase = process.env.PROTRACK_API_URL;
    targetUrl = legacyBase.endsWith('/') ? `${legacyBase}devices/positions` : `${legacyBase}/devices/positions`;
  } else {
    targetUrl = new URL(defaultPath, baseCandidate).toString();
    useQueryMode = true;
  }

  const accessParam = (process.env.PROTRACK_ACCESS_TOKEN_PARAM || 'access_token').trim() || 'access_token';
  const extraQuery = safeParseObject(process.env.PROTRACK_TRACK_QUERY);
  const urlObj = new URL(targetUrl);
  if (useQueryMode) {
    urlObj.searchParams.set(accessParam, tokenInfo.access);
    if (imeis.length) {
      urlObj.searchParams.set('imeis', imeis.join(','));
    }
    for (const [key, value] of Object.entries(extraQuery)) {
      if (value === undefined || value === null) continue;
      urlObj.searchParams.set(key, String(value));
    }
  }
  return { url: urlObj.toString(), useQueryMode };
}

function summariseItem(item) {
  const candidates = [
    item?.truckId,
    item?.deviceId,
    item?.id,
    item?.deviceID,
    item?.imei,
    item?.IMEI,
    item?.imeiNo,
  ];
  const id = candidates.find((val) => val !== undefined && val !== null && String(val).trim()) ?? '';
  const lat =
    item?.lat ??
    item?.latitude ??
    item?.location?.lat ??
    item?.position?.lat ??
    null;
  const lng =
    item?.lng ??
    item?.lon ??
    item?.longitude ??
    item?.location?.lng ??
    item?.position?.lng ??
    null;
  return {
    id: String(id).trim(),
    plate: item?.plate || item?.vehicleNo || item?.name || '',
    imei: item?.imei || item?.IMEI || item?.imeiNo || '',
    lat,
    lng,
    speed: item?.speed ?? item?.kph ?? item?.kmh ?? item?.mph ?? null,
    rawTime: item?.gpsTime || item?.time || item?.locate_time || item?.lastSeen || item?.timestamp || null,
  };
}

async function main() {
  const imeis = buildImeiList();
  if (!imeis.length) {
    console.error('No IMEIs found in PROTRACK_TRACK_IMEIS / PROTRACK_IMEIS');
    process.exit(1);
  }
  const tokenInfo = await resolveToken(true);
  if (!tokenInfo || (!tokenInfo.access && !tokenInfo.bearer)) {
    console.error('No Protrack token available. Check PROTRACK credentials.');
    process.exit(1);
  }
  const { url, useQueryMode } = buildTrackUrl(imeis, tokenInfo);
  const headers = {};
  if (!useQueryMode && tokenInfo.bearer) {
    headers.Authorization = tokenInfo.bearer;
    headers['Content-Type'] = 'application/json';
  }
  if (process.env.PROTRACK_TENANT_ID) {
    headers['X-Tenant'] = process.env.PROTRACK_TENANT_ID;
  }

  console.log('Requesting Protrack telemetry from:', url);
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) {
    console.error('Protrack error', res.status, text);
    process.exit(1);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error('Non-JSON response:', text.slice(0, 500));
    process.exit(1);
  }
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.items) ? json.items : [];
  console.log(`Items returned: ${list.length}`);
  list.forEach((item, idx) => {
    console.log(idx + 1, summariseItem(item));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
