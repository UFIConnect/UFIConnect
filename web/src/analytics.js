import { resolveApiBaseUrl } from './api/apiOrigin';
import { canonicalPage } from './analytics/googleAnalytics.mjs';

let previousVisit;

// Core aggregate page counts contain a fixed page category only. The service
// totals counts without associating these requests with an account or visitor.
export function trackPageview(path, navigationKey = path) {
  if (previousVisit?.path === path && previousVisit?.key === navigationKey) return;
  previousVisit = { path, key: navigationKey };
  const category = canonicalPage(path).category;
  void resolveApiBaseUrl().then(apiBase => fetch(apiBase + '/analytics/pageview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category }),
    referrerPolicy: 'no-referrer', credentials: 'omit', redirect: 'error', cache: 'no-store', keepalive: true,
  })).catch(() => {});
}
