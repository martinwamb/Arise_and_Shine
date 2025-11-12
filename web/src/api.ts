import axios from 'axios';
import { createApiClient, createBrowserTokenStorage, normaliseBaseUrl } from '@shared/api-client';

const fallbackBase = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000';
const envBase = (import.meta.env?.VITE_API_BASE as string | undefined) || undefined;
const tokenStorage = createBrowserTokenStorage(typeof window !== 'undefined' ? window.localStorage : null);
const sharedClient = createApiClient(normaliseBaseUrl(envBase, fallbackBase), tokenStorage, axios.create);

export const { API_BASE, api, setToken, requestPasswordReset, confirmPasswordReset } = sharedClient;
