import axios from 'axios';
import {
  clearFleetApiAuthCache,
  getFleetApiAuth,
  getFleetApiBaseUrl,
} from './fleetApiAuth.js';

function resolveTimeout() {
  const value =
    process.env.CARTRACK_FLEET_API_TIMEOUT_MS ||
    process.env.FLEET_API_TIMEOUT_MS ||
    '15000';
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15000;
}

const fleetApiClient = axios.create({
  baseURL: getFleetApiBaseUrl(),
  timeout: resolveTimeout(),
});

fleetApiClient.interceptors.request.use(
  async (config) => {
    const baseUrl = getFleetApiBaseUrl();
    if (baseUrl && config.baseURL !== baseUrl) {
      config.baseURL = baseUrl;
    }
    const auth = await getFleetApiAuth();
    const headers = config.headers ? { ...config.headers } : {};
    headers.Authorization = auth.authorization;
    if (!headers.Accept) {
      headers.Accept = 'application/json';
    }
    return {
      ...config,
      headers,
    };
  },
  (error) => Promise.reject(error),
);

fleetApiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { response, config } = error;
    if (
      response?.status === 401 &&
      config &&
      !config.__isFleetAuthRetry
    ) {
      config.__isFleetAuthRetry = true;
      clearFleetApiAuthCache();
      const auth = await getFleetApiAuth({ forceRefresh: true });
      config.headers = {
        ...(config.headers || {}),
        Authorization: auth.authorization,
      };
      return fleetApiClient(config);
    }
    return Promise.reject(error);
  },
);

export async function getVehicles(params = {}) {
  // Fetch vehicle status list; adjust the path or params to suit your use case.
  const response = await fleetApiClient.get('/vehicles/status', { params });
  const payload = response.data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

export { fleetApiClient };
