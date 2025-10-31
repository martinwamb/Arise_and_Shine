import { Buffer } from 'node:buffer';
import {
  clearFleetApiAuthCache,
  getCachedFleetApiAuth,
  getFleetApiAuth,
  getFleetApiBaseUrl,
  isFleetApiConfigured,
} from '../fleetApiAuth.js';
import { describe, expect, test, beforeEach, afterEach } from '@jest/globals';

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  // Remove keys added during a test run
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }
  // Restore original values without replacing the env object reference
  Object.assign(process.env, ORIGINAL_ENV);
}

beforeEach(() => {
  restoreEnv();
  clearFleetApiAuthCache();
});

afterEach(() => {
  clearFleetApiAuthCache();
  restoreEnv();
});

describe('fleetApiAuth', () => {
  test('throws when credentials are missing', async () => {
    delete process.env.CARTRACK_FLEET_API_USERNAME;
    delete process.env.CARTRACK_FLEET_API_PASSWORD;
    delete process.env.CARTRACK_FLEET_API_API_KEY;
    expect(isFleetApiConfigured()).toBe(false);
    await expect(getFleetApiAuth()).rejects.toThrow(
      /Cartrack Fleet API credentials are missing/i,
    );
  });

  test('returns cached basic credentials when username and password exist', async () => {
    process.env.CARTRACK_FLEET_API_USERNAME = 'demo-user';
    process.env.CARTRACK_FLEET_API_PASSWORD = 'demo-secret';
    expect(isFleetApiConfigured()).toBe(true);

    const expectedHeader = `Basic ${Buffer.from('demo-user:demo-secret').toString('base64')}`;

    const first = await getFleetApiAuth();
    expect(first.authorization).toBe(expectedHeader);
    expect(first.tokenType).toBe('basic');
    expect(first.expiresAt).toBe(Number.MAX_SAFE_INTEGER);

    const cached = getCachedFleetApiAuth();
    expect(cached.authorization).toBe(expectedHeader);

    const second = await getFleetApiAuth();
    expect(second.authorization).toBe(expectedHeader);
  });

  test('uses API key when provided', async () => {
    process.env.CARTRACK_FLEET_API_API_KEY = 'api-key-123';
    process.env.CARTRACK_FLEET_API_TOKEN_TTL_SECONDS = '120';

    expect(isFleetApiConfigured()).toBe(true);

    const auth = await getFleetApiAuth();
    expect(auth.authorization).toBe('Bearer api-key-123');
    expect(auth.tokenType).toBe('bearer');
    expect(auth.expiresAt).toBeGreaterThan(Date.now());
  });

  test('reads base url from environment', async () => {
    process.env.CARTRACK_FLEET_API_API_KEY = 'api-key-123';
    process.env.CARTRACK_FLEET_API_BASE_URL = 'https://example.test/rest';
    const baseUrl = getFleetApiBaseUrl();
    expect(baseUrl).toBe('https://example.test/rest');
  });
});
