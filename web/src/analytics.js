import { resolveApiBaseUrl } from './api/apiOrigin';
import { canonicalPage } from './analytics/googleAnalytics.mjs';
import { setTelemetryRoute, subscribeTelemetryPrivacy, telemetrySuppressed } from './analytics/telemetryPrivacy.mjs';

let previousVisit;
const pending = new Set();
subscribeTelemetryPrivacy(suppressed => {
  if (!suppressed) return;
  pending.forEach(controller => controller.abort());
  pending.clear();
  previousVisit = undefined;
});

// Core aggregate page counts contain a fixed page category only. The service
// totals counts without associating these requests with an account or visitor.
export function trackPageview(path, navigationKey = path) {
  setTelemetryRoute(path);
  if (import.meta.env.VITE_VAULT_LOCAL_PREVIEW === 'true' || telemetrySuppressed(path)) return;
  if (previousVisit?.path === path && previousVisit?.key === navigationKey) return;
  previousVisit = { path, key: navigationKey };
  const category = canonicalPage(path).category;
  const controller = new AbortController();
  pending.add(controller);
  void resolveApiBaseUrl().then(apiBase => {
    if (controller.signal.aborted || telemetrySuppressed(path)) return;
    return fetch(apiBase + '/analytics/pageview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category }),
      referrerPolicy: 'no-referrer', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
    });
  }).catch(() => {}).finally(() => pending.delete(controller));
}
