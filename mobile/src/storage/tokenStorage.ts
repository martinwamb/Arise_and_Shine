import * as SecureStore from 'expo-secure-store';
import { TokenStorage, createInMemoryTokenStorage } from '../../../shared/api-client';

const TOKEN_KEY = 'arise.auth.token';

export function createSecureTokenStorage(initial: string | null = null): TokenStorage {
  const memory = createInMemoryTokenStorage(initial);
  return {
    getToken: () => memory.getToken(),
    setToken: (token) => {
      memory.setToken(token);
      if (!token) {
        SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
      } else {
        SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => undefined);
      }
    },
  };
}

export async function readStoredToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}
