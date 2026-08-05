import axios from 'axios';
import { createApiClient, createBrowserTokenStorage, normaliseBaseUrl } from '@shared/api-client';

const fallbackBase = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000';
const envBase = (import.meta.env?.VITE_API_BASE as string | undefined) || undefined;
const tokenStorage = createBrowserTokenStorage(typeof window !== 'undefined' ? window.localStorage : null);

// Tokens expire, and the route guard only checks that a token *string* exists —
// so an expired session used to leave the user inside the workspace with every
// panel silently empty. Clear the session and send them to sign in, saying why.
function handleSessionExpired() {
  if (typeof window === 'undefined') return;
  ['token', 'role', 'driverId', 'userName', 'userEmail'].forEach((key) => window.localStorage.removeItem(key));
  const { pathname, search } = window.location;
  if (pathname === '/login') return;
  const next = encodeURIComponent(`${pathname}${search}`);
  window.location.assign(`/login?expired=1&next=${next}`);
}

const sharedClient = createApiClient(normaliseBaseUrl(envBase, fallbackBase), tokenStorage, axios.create, {
  onUnauthorized: handleSessionExpired,
});

export const { API_BASE, api, setToken, requestPasswordReset, confirmPasswordReset } = sharedClient;
