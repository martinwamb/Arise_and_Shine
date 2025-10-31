import axios from 'axios';
import { Buffer } from 'node:buffer';

const state = {
  authorization: null,
  tokenType: null,
  token: null,
  expiresAt: 0,
  pending: null,
};

function parseNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveConfig() {
  const baseUrl =
    process.env.CARTRACK_FLEET_API_BASE_URL ||
    process.env.FLEET_API_BASE_URL ||
    'https://fleetapi-ke.cartrack.com/rest';
  const username =
    process.env.CARTRACK_FLEET_API_USERNAME || process.env.FLEET_API_USERNAME;
  const password =
    process.env.CARTRACK_FLEET_API_PASSWORD || process.env.FLEET_API_PASSWORD;
  const apiKey =
    process.env.CARTRACK_FLEET_API_API_KEY || process.env.FLEET_API_API_KEY;
  const tokenUrl =
    process.env.CARTRACK_FLEET_API_TOKEN_URL || process.env.FLEET_API_TOKEN_URL;
  const tokenField =
    process.env.CARTRACK_FLEET_API_TOKEN_FIELD ||
    process.env.FLEET_API_TOKEN_FIELD ||
    'access_token';
  const expiresField =
    process.env.CARTRACK_FLEET_API_TOKEN_EXPIRES_FIELD ||
    process.env.FLEET_API_TOKEN_EXPIRES_FIELD ||
    'expires_in';
  const ttlSeconds = parseNumber(
    process.env.CARTRACK_FLEET_API_TOKEN_TTL_SECONDS ||
      process.env.FLEET_API_TOKEN_TTL_SECONDS,
    3600,
  );

  if (apiKey) {
    return {
      mode: 'apiKey',
      baseUrl,
      apiKey,
      ttlSeconds,
    };
  }

  if (tokenUrl) {
    if (!username || !password) {
      throw new Error(
        'Cartrack Fleet API username and password are required when CARTRACK_FLEET_API_TOKEN_URL is set',
      );
    }
    return {
      mode: 'tokenExchange',
      baseUrl,
      username,
      password,
      tokenUrl,
      tokenField,
      expiresField,
      ttlSeconds,
    };
  }

  if (!username || !password) {
    throw new Error(
      'Cartrack Fleet API credentials are missing. Set CARTRACK_FLEET_API_USERNAME and CARTRACK_FLEET_API_PASSWORD',
    );
  }

  return {
    mode: 'basic',
    baseUrl,
    username,
    password,
  };
}

function buildBasicAuth({ username, password }) {
  const encoded = Buffer.from(`${username}:${password}`, 'utf8').toString(
    'base64',
  );
  return {
    authorization: `Basic ${encoded}`,
    tokenType: 'basic',
    token: encoded,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };
}

function buildApiKeyAuth({ apiKey, ttlSeconds }) {
  return {
    authorization: `Bearer ${apiKey}`,
    tokenType: 'bearer',
    token: apiKey,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
}

async function exchangeToken(config) {
  const payload = {
    username: config.username,
    password: config.password,
  };

  const response = await axios.post(
    config.tokenUrl,
    payload,
    {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    },
  );

  const data = response?.data;
  const rawToken =
    data?.[config.tokenField] ??
    data?.access_token ??
    data?.token ??
    data?.data?.[config.tokenField] ??
    data?.data?.access_token ??
    data?.data?.token;

  if (!rawToken || typeof rawToken !== 'string') {
    throw new Error(
      'Cartrack Fleet API token response missing access token field',
    );
  }

  const expiresInSeconds = Number(
    data?.[config.expiresField] ??
      data?.expires_in ??
      data?.expiresIn ??
      data?.data?.[config.expiresField] ??
      data?.data?.expires_in ??
      data?.data?.expiresIn,
  );

  const ttlMs =
    Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
      ? Math.max(expiresInSeconds * 1000, 5_000)
      : config.ttlSeconds * 1000;

  const refreshBufferMs = 60_000;
  const expiresAt = Date.now() + Math.max(ttlMs - refreshBufferMs, 5_000);

  return {
    authorization: rawToken.startsWith('Bearer ')
      ? rawToken
      : `Bearer ${rawToken}`,
    tokenType: rawToken.startsWith('Bearer ') ? 'bearer' : 'bearer',
    token: rawToken.startsWith('Bearer ')
      ? rawToken.replace(/^Bearer\s+/i, '').trim()
      : rawToken,
    expiresAt,
  };
}

async function refreshAuth(force = false) {
  const config = resolveConfig();

  if (!force && state.token && Date.now() < state.expiresAt) {
    return {
      authorization: state.authorization,
      tokenType: state.tokenType,
      token: state.token,
      expiresAt: state.expiresAt,
      baseUrl: config.baseUrl,
    };
  }

  if (state.pending) {
    return state.pending;
  }

  state.pending = (async () => {
    switch (config.mode) {
      case 'basic': {
        const result = buildBasicAuth(config);
        state.authorization = result.authorization;
        state.tokenType = result.tokenType;
        state.token = result.token;
        state.expiresAt = result.expiresAt;
        return { ...result, baseUrl: config.baseUrl };
      }
      case 'apiKey': {
        const result = buildApiKeyAuth(config);
        state.authorization = result.authorization;
        state.tokenType = result.tokenType;
        state.token = result.token;
        state.expiresAt = result.expiresAt;
        return { ...result, baseUrl: config.baseUrl };
      }
      case 'tokenExchange': {
        const result = await exchangeToken(config);
        state.authorization = result.authorization;
        state.tokenType = result.tokenType;
        state.token = result.token;
        state.expiresAt = result.expiresAt;
        return { ...result, baseUrl: config.baseUrl };
      }
      default:
        throw new Error(`Unsupported Cartrack Fleet API auth mode: ${config.mode}`);
    }
  })()
    .catch((error) => {
      state.authorization = null;
      state.tokenType = null;
      state.token = null;
      state.expiresAt = 0;
      throw error;
    })
    .finally(() => {
      state.pending = null;
    });

  return state.pending;
}

export async function getFleetApiAuth({ forceRefresh = false } = {}) {
  return refreshAuth(forceRefresh);
}

export function getCachedFleetApiAuth() {
  if (!state.token || Date.now() >= state.expiresAt) {
    return null;
  }
  return {
    authorization: state.authorization,
    tokenType: state.tokenType,
    token: state.token,
    expiresAt: state.expiresAt,
  };
}

export function clearFleetApiAuthCache() {
  state.authorization = null;
  state.tokenType = null;
  state.token = null;
  state.expiresAt = 0;
  state.pending = null;
}

export function getFleetApiBaseUrl() {
  try {
    const config = resolveConfig();
    return config.baseUrl;
  } catch (error) {
    return (
      process.env.CARTRACK_FLEET_API_BASE_URL ||
      process.env.FLEET_API_BASE_URL ||
      'https://fleetapi-ke.cartrack.com/rest'
    );
  }
}

export function isFleetApiConfigured() {
  try {
    resolveConfig();
    return true;
  } catch (error) {
    return false;
  }
}
