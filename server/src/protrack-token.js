import crypto from 'crypto';

const state = {
  bearerToken: null,
  rawToken: null,
  expiresAt: 0,
  pending: null,
  mode: null,
};

function parseJson(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch (err) {
    console.warn('Failed to parse PROTRACK_AUTH_HEADERS, ignoring value');
    return {};
  }
}

function resolveAuthConfig() {
  const account = process.env.PROTRACK_ACCOUNT;
  const password = process.env.PROTRACK_PASSWORD;
  if (!account || !password) return null;

  if (process.env.PROTRACK_AUTH_URL) {
    return {
      mode: 'legacy',
      url: process.env.PROTRACK_AUTH_URL,
      account,
      password,
      method: (process.env.PROTRACK_AUTH_METHOD || 'POST').toUpperCase(),
      format: (process.env.PROTRACK_AUTH_FORMAT || 'json').toLowerCase(),
      headers: parseJson(process.env.PROTRACK_AUTH_HEADERS),
    };
  }

  const baseUrl =
    process.env.PROTRACK_BASE_URL ||
    process.env.PROTRACK_API_URL ||
    'https://api.protrack365.com';
  const authPath = process.env.PROTRACK_AUTH_PATH || '/api/authorization';
  const authUrl = new URL(
    authPath.startsWith('http')
      ? authPath
      : `${baseUrl.replace(/\/$/, '')}${authPath.startsWith('/') ? authPath : `/${authPath}`}`,
  );
  return {
    mode: 'signature',
    url: authUrl.toString(),
    account,
    password,
    headers: parseJson(process.env.PROTRACK_AUTH_HEADERS),
  };
}

function buildLegacyRequest({ url, account, password, method, format, headers }) {
  let target = url;
  let body;
  const computedHeaders = { ...headers };

  if (method === 'GET') {
    const urlObj = new URL(url);
    urlObj.searchParams.set('account', account);
    urlObj.searchParams.set('password', password);
    target = urlObj.toString();
  } else if (format === 'form') {
    const params = new URLSearchParams();
    params.set('account', account);
    params.set('password', password);
    body = params.toString();
    computedHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
  } else {
    body = JSON.stringify({ account, password });
    computedHeaders['Content-Type'] = 'application/json';
  }

  return { method, url: target, body: method === 'GET' ? undefined : body, headers: computedHeaders };
}

function buildSignatureRequest({ url, account, password, headers }) {
  const seconds = Math.floor(Date.now() / 1000).toString();
  const firstHash = crypto.createHash('md5').update(password).digest('hex');
  const signature = crypto.createHash('md5').update(firstHash + seconds).digest('hex');
  const urlObj = new URL(url);
  urlObj.searchParams.set('time', seconds);
  urlObj.searchParams.set('account', account);
  urlObj.searchParams.set('signature', signature);
  return { method: 'GET', url: urlObj.toString(), headers };
}

function deriveTokenPair(tokenValue) {
  if (!tokenValue || typeof tokenValue !== 'string') {
    return { bearer: null, access: null };
  }
  const trimmed = tokenValue.trim();
  if (!trimmed) return { bearer: null, access: null };
  if (/^bearer\s+/i.test(trimmed)) {
    return { bearer: trimmed, access: trimmed.replace(/^bearer\s+/i, '').trim() };
  }
  return { bearer: `Bearer ${trimmed}`, access: trimmed };
}

async function refreshToken() {
  const config = resolveAuthConfig();
  if (!config) throw new Error('Protrack auth environment variables are missing');

  const request =
    config.mode === 'legacy'
      ? buildLegacyRequest(config)
      : buildSignatureRequest(config);

  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
  if (!response.ok) {
    throw new Error(`Protrack auth failed with status ${response.status}`);
  }
  const data = await response.json();
  const token =
    data?.record?.access_token ||
    data?.access_token ||
    data?.token ||
    data?.data?.access_token;
  if (!token) {
    throw new Error('Protrack auth response missing access token');
  }
  const expiresInSeconds = Number(
    data?.record?.expires_in ?? data?.expires_in ?? data?.data?.expires_in ?? 0,
  );
  const now = Date.now();
  const refreshBufferMs = 60_000;
  const computedExpiry =
    expiresInSeconds && Number.isFinite(expiresInSeconds)
      ? Math.max(now + expiresInSeconds * 1000 - refreshBufferMs, now + 5_000)
      : now + 3_600_000;

  const { bearer, access } = deriveTokenPair(token);
  state.bearerToken = bearer;
  state.rawToken = access;
  state.expiresAt = computedExpiry;
  state.mode = config.mode;
  return {
    bearer,
    access,
    expiresAt: computedExpiry,
    mode: config.mode,
  };
}

export async function ensureProtrackToken(force = false) {
  const config = resolveAuthConfig();
  if (!config) return null;

  if (!force && state.rawToken && Date.now() < state.expiresAt) {
    return {
      bearer: state.bearerToken,
      access: state.rawToken,
      expiresAt: state.expiresAt,
      mode: state.mode || config.mode,
    };
  }
  if (state.pending) {
    return state.pending;
  }

  state.pending = refreshToken()
    .catch((err) => {
      state.bearerToken = null;
      state.rawToken = null;
      state.expiresAt = 0;
      state.mode = null;
      throw err;
    })
    .finally(() => {
      state.pending = null;
    });
  return state.pending;
}

export function clearProtrackTokenCache() {
  state.bearerToken = null;
  state.rawToken = null;
  state.expiresAt = 0;
  state.mode = null;
}

export function getCachedProtrackToken() {
  if (!state.rawToken) return null;
  return {
    bearer: state.bearerToken,
    access: state.rawToken,
    expiresAt: state.expiresAt,
    mode: state.mode,
  };
}
