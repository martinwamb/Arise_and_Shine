export type TokenStorage = {
  getToken: () => string | null;
  setToken: (token: string | null) => void;
};

export type ApiClient<TClient = any> = {
  API_BASE: string;
  api: TClient;
  setToken: (token: string | null) => void;
  requestPasswordReset: (email: string) => Promise<any>;
  confirmPasswordReset: (token: string, password: string) => Promise<any>;
};

type HttpClientFactory<TClient> = (config: { baseURL: string }) => TClient;

export function normaliseBaseUrl(value: string | undefined | null, fallback = 'http://localhost:4000') {
  const raw = (value && value.trim()) || fallback;
  return raw.replace(/\/$/, '');
}

export function createInMemoryTokenStorage(initial: string | null = null): TokenStorage {
  let current = initial;
  return {
    getToken: () => current,
    setToken: (token) => {
      current = token;
    },
  };
}

export function createBrowserTokenStorage(storage: Storage | null = typeof window !== 'undefined' ? window.localStorage : null): TokenStorage {
  if (!storage) {
    return createInMemoryTokenStorage();
  }
  return {
    getToken: () => storage.getItem('token'),
    setToken: (token) => {
      if (!token) {
        storage.removeItem('token');
      } else {
        storage.setItem('token', token);
      }
    },
  };
}

export function createApiClient<TClient extends { interceptors?: any; post: (...args: any[]) => Promise<any> }>(
  baseURL: string,
  tokenStorage: TokenStorage = createInMemoryTokenStorage(),
  clientFactory?: HttpClientFactory<TClient>,
): ApiClient<TClient> {
  const API_BASE = normaliseBaseUrl(baseURL);
  if (!clientFactory) {
    throw new Error('An HTTP client factory must be provided to createApiClient');
  }
  const api = clientFactory({ baseURL: API_BASE });
  const interceptors = (api as any)?.interceptors;
  if (interceptors?.request?.use) {
    interceptors.request.use((config: any) => {
      const token = tokenStorage.getToken();
      if (token) {
        if (!config.headers) config.headers = {};
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
  }

  const setToken = (token: string | null) => {
    tokenStorage.setToken(token);
  };

  const requestPasswordReset = (email: string) => api.post('/api/auth/password-reset/request', { email });
  const confirmPasswordReset = (token: string, password: string) =>
    api.post('/api/auth/password-reset/confirm', { token, password });

  return {
    API_BASE,
    api,
    setToken,
    requestPasswordReset,
    confirmPasswordReset,
  };
}
