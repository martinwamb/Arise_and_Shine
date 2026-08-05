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

export type ApiClientOptions = {
  /**
   * Called when the server rejects a request with 401 while a token was being
   * sent — i.e. the session expired or was revoked. The token has already been
   * cleared by the time this runs. Fires at most once per session so a screen
   * firing six parallel requests does not trigger six sign-outs.
   */
  onUnauthorized?: () => void;
};

type HttpClientFactory<TClient> = (config: { baseURL: string }) => TClient;

// Every /api/auth/* route is unauthenticated (login, register, both password-reset
// steps). A 401 there means "wrong credentials", not "your session died", so it
// must never clear the token or bounce the user to the login screen.
const PUBLIC_AUTH_PREFIX = '/api/auth/';

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
  options: ApiClientOptions = {},
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

  // Without this, an expired token failed silently: the request interceptor kept
  // attaching it, every call 401'd, and each screen swallowed the error into an
  // empty list — so an OPS user sat on a fully-rendered workspace reading "No
  // trucks found" instead of being told to sign in again.
  let signallingUnauthorized = false;
  if (interceptors?.response?.use) {
    interceptors.response.use(
      (response: any) => response,
      (error: any) => {
        const status = error?.response?.status;
        const url: string = error?.config?.url || '';
        const sentToken = Boolean(error?.config?.headers?.Authorization);
        if (status === 401 && sentToken && !url.startsWith(PUBLIC_AUTH_PREFIX) && !signallingUnauthorized) {
          signallingUnauthorized = true;
          tokenStorage.setToken(null);
          try {
            options.onUnauthorized?.();
          } finally {
            // Release on the next tick so the parallel 401s from the same page
            // load collapse into one sign-out, but a later session can still
            // report its own expiry.
            setTimeout(() => {
              signallingUnauthorized = false;
            }, 0);
          }
        }
        return Promise.reject(error);
      },
    );
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
