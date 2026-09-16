// First-party page counts only. Authentication pages and URL query strings
// are excluded, and referrers contain only an origin.
import { resolveApiBaseUrl } from './api/apiOrigin';
import { getAccessToken, privateSessionStorage } from './auth/session';
import { telemetryPath } from './api/telemetryPrivacy';

export function getVisitorId() {
  let id = privateSessionStorage.getItem('ufi_visitor_id');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
    privateSessionStorage.setItem('ufi_visitor_id', id);
  }
  return id;
}

export function trackPageview(path) {
  const safePath = telemetryPath(path);
  if (!safePath) return;
  let referrer = null;
  try { if (document.referrer) referrer = new URL(document.referrer).origin; } catch {}
  const token = getAccessToken();
  void resolveApiBaseUrl().then((apiBase) => fetch(apiBase + '/analytics/pageview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token && token === getAccessToken() ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify({ path: safePath, referrer, visitorId: getVisitorId() }),
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
    redirect: 'error',
    keepalive: true,
  })).catch(() => {});
}
