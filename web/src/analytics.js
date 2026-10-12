import { resolveApiBaseUrl } from './api/apiOrigin';
import { isNativeRuntime, nativeFetch } from './nativeRuntime.mjs';
import { canonicalPage, PAGE_CATEGORIES } from './analytics/googleAnalytics.mjs';
import { setTelemetryRoute, subscribeTelemetryPrivacy, telemetrySuppressed } from './analytics/telemetryPrivacy.mjs';

const previousVisits = new Map();
const pending = new Set();
subscribeTelemetryPrivacy(suppressed => {
  if (!suppressed) return;
  pending.forEach(controller => controller.abort());
  pending.clear();
  previousVisits.clear();
});

// Core aggregate page counts contain a fixed page category only. The service
// totals counts without associating these requests with an account or visitor.
export function trackPageview(path, navigationKey = path) {
  setTelemetryRoute(path);
  if (import.meta.env.VITE_VAULT_LOCAL_PREVIEW === 'true' || telemetrySuppressed(path)) return;
  const category = canonicalPage(path).category;
  if (previousVisits.get('page') !== `${category}:${navigationKey || ''}`) previousVisits.clear();
  trackCategoryview(category, navigationKey, 'page');
}

// Internal tabs use the same anonymous counter. Only registered category
// constants leave the browser; the navigation key stays in memory.
export function trackCategoryview(category, navigationKey, scope = 'tab') {
  if (!Object.hasOwn(PAGE_CATEGORIES, category) || import.meta.env.VITE_VAULT_LOCAL_PREVIEW === 'true' || telemetrySuppressed()) return;
  const visit = `${category}:${navigationKey || ''}`;
  if (previousVisits.get(scope) === visit) return;
  previousVisits.set(scope, visit);
  const controller = new AbortController();
  pending.add(controller);
  void resolveApiBaseUrl().then(apiBase => {
    if (controller.signal.aborted || telemetrySuppressed()) return;
    return (isNativeRuntime() ? nativeFetch : fetch)(apiBase + '/analytics/pageview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category }),
      referrerPolicy: 'no-referrer', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal,
    });
  }).catch(() => {}).finally(() => pending.delete(controller));
}
