import axios from 'axios';
import { engagementLedger, mergeConfirmedComments } from './postEngagement.mjs';
import { isNativeRuntime, NATIVE_API_ORIGIN } from '../nativeRuntime.mjs';
import { nativeAxiosAdapter } from './nativeAdapter.mjs';
import { clearSession, getAccessToken } from '../auth/session.js';
import { deviceFeedRequestHeader } from '../utils/deviceFeedLocation.mjs';
import { allowFeedLocation, requireFeedLocation } from '../utils/requiredFeedLocation.mjs';
import { isRelativeApiRequest } from './apiEndpointPolicy.js';
import {
  getCanonicalApiBaseUrl,
  isConfiguredApiBaseUrl,
  markApiOriginFailure,
  markApiOriginHealthy,
  resolveApiBaseUrl,
} from './apiOrigin.js';

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
  return !config._ufiNative && !config._ufiCanonicalOAuth && canRetry(config);
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

let sessionCheck;
function verifyActiveSession(token) {
  if (sessionCheck?.token === token) return sessionCheck.promise;
  const check = { token };
  check.promise = client.get('/auth/session', publicOAuthRequestConfig({
    _ufiReauthentication: true, headers: { Authorization: `Bearer ${token}` },
  })).then(({ data }) => data?.token === token)
    .catch(error => {
      if (error?.response?.status === 401 && getAccessToken() === token) void clearSession();
      return false;
    }).finally(() => { if (sessionCheck === check) sessionCheck = null; });
  sessionCheck = check;
  return check.promise;
}

function pause(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

// Keep credentials in memory and attach them only to our relative API paths.
client.interceptors.request.use(async (config) => {
  config._ufiEngagementRevision ??= engagementLedger.revision();
  if (!isRelativeApiRequest(config.url)) throw new Error('API requests must use a relative path.');
  const token = config.headers.Authorization ? null : getAccessToken();
  const native = isNativeRuntime();
  const origin = native ? NATIVE_API_ORIGIN : config._ufiApiOrigin || await resolveApiBaseUrl();
  if (!isConfiguredApiBaseUrl(origin)) throw new Error('API endpoint is not configured.');
  config.baseURL = origin;
  config._ufiApiOrigin = origin;
  config.adapter = native ? nativeAxiosAdapter : 'fetch';
  config._ufiNative = native;
  // The API's HttpOnly, SameSite session cookie restores a member on the
  // same saved browser. JavaScript never reads or persists that credential.
  config.withCredentials = !native;
  config.fetchOptions = { ...config.fetchOptions, redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer' };
  if (token && token === getAccessToken()) config.headers.Authorization = `Bearer ${token}`;
  // Send location only to authenticated feeds and local account discovery.
  // OAuth, billing, public pages and source providers never receive this header.
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
    if (String(res.config?.method || 'get').toLowerCase() === 'get') {
      const revision = res.config?._ufiEngagementRevision ?? engagementLedger.revision();
      if (Array.isArray(res.data?.posts)) res.data.posts = res.data.posts.map(post => engagementLedger.apply(post, revision));
      if (res.data?.post) res.data.post = engagementLedger.apply(res.data.post, revision);
      const match = /^\/(?:feed|posts|snaps)\/([^/]+)\/comments$/.exec(String(res.config?.url || '').split('?')[0]);
      if (match && res.data && typeof res.data === 'object') {
        const patch = engagementLedger.apply({ id: decodeURIComponent(match[1]), commentsCount: res.data.commentsCount }, revision);
        if (patch.commentsCount !== undefined) res.data.commentsCount = patch.commentsCount;
      }
      if (match && !Number(res.config?.params?.offset) && !res.data?.unavailable && Array.isArray(res.data?.comments)) {
        res.data.commentsReceived = res.data.comments.length;
        res.data.comments = mergeConfirmedComments(decodeURIComponent(match[1]), res.data.comments, Date.now(), res.config.url.startsWith('/feed/'));
      }
    }
    markApiOriginHealthy(res.config?._ufiApiOrigin);
    const token = getAccessToken();
    const path = String(res.config?.url || '').split('?')[0];
    if (token && res.config?.headers?.Authorization === `Bearer ${token}`
      && /^\/(?:office\/)?feed(?:\/(?:location|music|videos(?:\/following)?))?$/.test(path)
      && (!res.data?.locationContext?.venueArea || res.data.locationContext.venueArea === 'device')
      && (path !== '/feed/location' || res.data?.automaticLocationAvailable)) allowFeedLocation(token);
    return res;
  },
  async (error) => {
    const { config, response } = error;
    const token = getAccessToken();
    if (token && response?.status === 428 && response.data?.code === 'feed_location_required'
      && config?.headers?.Authorization === `Bearer ${token}`) requireFeedLocation(token);
    if (token && response?.status === 401 && response.data?.reconnectRequired !== true && !config?._ufiReauthentication
        && config?.headers?.Authorization === `Bearer ${token}`) {
      // A source endpoint or a transport fallback can reject an otherwise
      // valid member. Only the canonical session check can sign them out.
      const check = verifyActiveSession(token);
      const canonical = getCanonicalApiBaseUrl();
      if (config._ufiApiOrigin !== canonical && canRetry(config) && !config.signal?.aborted
          && await check && getAccessToken() === token && !config.signal?.aborted) {
        return client(publicOAuthRequestConfig(config));
      }
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
