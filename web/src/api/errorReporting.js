import { resolveApiBaseUrl } from './apiOrigin';
import { canonicalPage } from '../analytics/googleAnalytics.mjs';
import { getDataPreferences, subscribeDataPreferences } from '../preferences/dataPreferences';

const allowedCodes = new Set(['script_error', 'unhandled_rejection', 'render_error', 'request_failed']);
const reported = new Set();
const pending = new Set();

subscribeDataPreferences(() => {
  if (getDataPreferences().performanceInsights) return;
  pending.forEach(controller => controller.abort());
  pending.clear();
  reported.clear();
});

// Optional diagnostics send broad, allowlisted error categories only. Message
// text, stack traces, component names, source URLs and account IDs are excluded.
export function reportClientError({ code = 'render_error', urlPath } = {}) {
  if (!getDataPreferences().performanceInsights || !allowedCodes.has(code)) return;
  const category = canonicalPage(urlPath || (typeof location !== 'undefined' ? location.pathname : '/')).category;
  const signature = `${category}:${code}`;
  if (reported.has(signature)) return;
  reported.add(signature);
  const controller = new AbortController();
  pending.add(controller);
  void resolveApiBaseUrl().then(apiBase => {
    if (controller.signal.aborted || !getDataPreferences().performanceInsights) return;
    return fetch(apiBase + '/analytics/performance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, kind: 'client_error', code }),
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', signal: controller.signal,
    });
  }).catch(() => {}).finally(() => pending.delete(controller));
}

export function reportNegativeSignal({ signalType } = {}) {
  if (signalType === 'video_load_fail') reportClientError({ code: 'request_failed' });
}
