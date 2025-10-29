const state = {
  token: null,
  expiresAt: 0,
  pending: null,
};

function getAuthConfig() {
  const {
    PROTRACK_AUTH_URL: url,
    PROTRACK_ACCOUNT: account,
    PROTRACK_PASSWORD: password,
  } = process.env;
  if (!url || !account || !password) return null;
  return { url, account, password };
}

function buildRequestConfig({ url, account, password }) {
  const method = (process.env.PROTRACK_AUTH_METHOD || 'POST').toUpperCase();
  const format = (process.env.PROTRACK_AUTH_FORMAT || 'json').toLowerCase();
  let target = url;
  let body;
  const headers = {};

  let extraHeaders = {};
  if (process.env.PROTRACK_AUTH_HEADERS) {
    try {
      extraHeaders = JSON.parse(process.env.PROTRACK_AUTH_HEADERS);
    } catch (err) {
      console.warn('Failed to parse PROTRACK_AUTH_HEADERS, ignoring value');
    }
  }

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
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else {
    body = JSON.stringify({ account, password });
    headers['Content-Type'] = 'application/json';
  }

  return {
    method,
    url: target,
    body: method === 'GET' ? undefined : body,
    headers: { ...headers, ...extraHeaders },
  };
}

async function refreshToken() {
  const config = getAuthConfig();
  if (!config) throw new Error('Protrack auth environment variables are missing');

  const { method, url, body, headers } = buildRequestConfig(config);
  const response = await fetch(url, {
    method,
    headers,
    body,
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

  state.token = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  state.expiresAt = computedExpiry;
  return state.token;
}

export async function ensureProtrackToken(force = false) {
  const config = getAuthConfig();
  if (!config) return null;

  if (!force && state.token && Date.now() < state.expiresAt) {
    return state.token;
  }
  if (state.pending) {
    return state.pending;
  }

  state.pending = refreshToken()
    .catch((err) => {
      state.token = null;
      state.expiresAt = 0;
      throw err;
    })
    .finally(() => {
      state.pending = null;
    });
  return state.pending;
}

export function clearProtrackTokenCache() {
  state.token = null;
  state.expiresAt = 0;
}

