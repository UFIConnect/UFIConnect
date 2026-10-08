import axios from 'axios';
import { clearSession, getAccessToken } from '../auth/session';
import { deviceFeedRequestHeader } from '../utils/deviceFeedLocation.mjs';
import { isRelativeApiRequest } from './apiEndpointPolicy';
import {
  getCanonicalApiBaseUrl,
  isConfiguredApiBaseUrl,
  markApiOriginFailure,
  markApiOriginHealthy,
  resolveApiBaseUrl,
} from './apiOrigin';

// In dev: Vite proxy rewrites /api/* → http://localhost:3000/*
// In production: VITE_API_URL points directly to the backend (no /api prefix needed)
// The origin is selected in the request interceptor below. A public API
// hostname can briefly fail in one resolver region, so every safe read gets
// a second route before a user sees a timeout.
const client = axios.create({ timeout: 15000, adapter: 'fetch', withCredentials: true });

const SAFE_FAILOVER_METHODS = new Set(['get', 'head', 'options']);
const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);

function canRetry(config) {
  return SAFE_FAILOVER_METHODS.has(String(config.method || 'get').toLowerCase());
}

function canFailover(config) {
  return !config._ufiCanonicalOAuth && canRetry(config);
}

// OAuth providers validate a single, pre-registered callback host. Pinning the
// start request to the public origin ensures a temporary Render failover cannot
// create an authorization URL with the wrong redirect_uri.
export function publicOAuthRequestConfig(config = {}) {
  const origin = getCanonicalApiBaseUrl();
  return {
    ...config,
    baseURL: origin,
    _ufiApiOrigin: origin,
    _ufiCanonicalOAuth: true,
  };
}

function pause(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Keep credentials in memory and attach them only to our relative API paths.
client.interceptors.request.use(async (config) => {
  if (!isRelativeApiRequest(config.url)) throw new Error('API requests must use a relative path.');
  const token = config.headers.Authorization ? null : getAccessToken();
  const origin = config._ufiApiOrigin || await resolveApiBaseUrl();
  if (!isConfiguredApiBaseUrl(origin)) throw new Error('API endpoint is not configured.');
  config.baseURL = origin;
  config._ufiApiOrigin = origin;
  config.adapter = 'fetch';
  // The API's HttpOnly, SameSite session cookie restores a member on the
  // same saved browser. JavaScript never reads or persists that credential.
  config.withCredentials = true;
  config.fetchOptions = { ...config.fetchOptions, redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' };
  if (token && token === getAccessToken()) config.headers.Authorization = `Bearer ${token}`;
  // Send location only to authenticated feed reads. OAuth, billing, public
  // pages and source providers never receive this header.
  const location = deviceFeedRequestHeader(config, getAccessToken());
  if (location) config.headers['X-UFI-Device-Location'] = location;
  else config.headers.delete('X-UFI-Device-Location');
  return config;
});

// Render briefly returns 502/503/504 during a deploy cutover or a cold
// start — genuinely transient, not a real failure — but with nothing
// retrying it, a user who happens to load a page in that exact window sees
// a broken screen instead of what would have resolved itself half a second
// later. Retried once, GET-only (safe to repeat — no side effects), after a
// short delay to actually let the blip clear instead of hammering it
// immediately.
client.interceptors.response.use(
  (res) => {
    markApiOriginHealthy(res.config?._ufiApiOrigin);
    return res;
  },
  async (error) => {
    const { config, response } = error;
    if (response?.status === 401 && !config?._ufiReauthentication && config?.headers?.Authorization === `Bearer ${getAccessToken()}`) {
      clearSession();
    }
    if (!config || !canRetry(config) || config._ufiManagedRetry || config.signal?.aborted) return Promise.reject(error);

    const transient = !response || TRANSIENT_STATUS_CODES.has(response.status);
    if (!transient) return Promise.reject(error);

    if (canFailover(config) && !config._ufiFailoverAttempt) {
      const fallback = markApiOriginFailure(config._ufiApiOrigin);
      if (fallback) {
        config._ufiFailoverAttempt = true;
        config.baseURL = fallback;
        config._ufiApiOrigin = fallback;
        await pause(250);
        return client(config);
      }
    }

    if (!config._ufiTransientRetry) {
      config._ufiTransientRetry = true;
      await pause(800);
      return client(config);
    }
    return Promise.reject(error);
  }
);

export default client;
