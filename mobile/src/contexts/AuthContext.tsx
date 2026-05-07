import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Constants from 'expo-constants';
import { createApiClient, normaliseBaseUrl } from '../../../shared/api-client';
import type { ApiClient } from '../../../shared/api-client';
import { createSecureTokenStorage, readStoredToken } from '../storage/tokenStorage';
import type { AuthUser } from '../types';
import { usePushNotifications } from '../hooks/usePushNotifications';

type AuthContextValue = {
  booting: boolean;
  user: AuthUser | null;
  token: string | null;
  apiClient: ApiClient;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<any>;
  applySession: (token: string | null, nextUser: AuthUser | null) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const fallbackBase = __DEV__ ? 'http://localhost:4000' : 'https://www.ariseandshinetransporters.com';
const configApiBase = (Constants.expoConfig?.extra as { apiBase?: string } | undefined)?.apiBase;
const apiBase = normaliseBaseUrl(configApiBase, fallbackBase);
const secureTokenStorage = createSecureTokenStorage();
const client = createApiClient(apiBase, secureTokenStorage, axios.create);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const applySession = useCallback((nextToken: string | null, nextUser: AuthUser | null) => {
    client.setToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const hydrate = useCallback(async () => {
    try {
      const stored = await readStoredToken();
      if (stored) {
        applySession(stored, null);
        const me = await client.api.get('/api/me');
        setUser(me.data?.user || null);
      }
    } catch {
      applySession(null, null);
    } finally {
      setBooting(false);
    }
  }, [applySession]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  usePushNotifications(client.api, user?.id);

  const login = useCallback(async (email: string, password: string) => {
    const res = await client.api.post('/api/auth/login', { email, password });
    applySession(res.data?.token || null, res.data?.user || null);
  }, [applySession]);

  const logout = useCallback(() => {
    applySession(null, null);
  }, [applySession]);

  const refreshUser = useCallback(async () => {
    try {
      const me = await client.api.get('/api/me');
      setUser(me.data?.user || null);
    } catch {
      logout();
    }
  }, [logout]);

  const value = useMemo<AuthContextValue>(
    () => ({
      booting,
      user,
      token,
      apiClient: client,
      login,
      logout,
      refreshUser,
      requestPasswordReset: client.requestPasswordReset,
      applySession,
    }),
    [applySession, booting, login, logout, refreshUser, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
