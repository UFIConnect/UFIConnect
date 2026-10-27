import React from 'react';
import { createRoot } from 'react-dom/client';
import AnalyticsDashboard from '../src/AnalyticsDashboard.jsx';

const state = window.analyticsFixture = { reads: 0, active: 0, maxActive: 0, home: 33, other: 12, tabs: 99, mode: 'ok', verification: 'verified', pending: [], aborted: 0 };
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state.hidden ? 'hidden' : 'visible' });
function report() {
  const row = (category, label, viewType, views) => ({ category, label, group: 'Example', platform: 'web', viewType,
    today: views, last7: views, last30: views, errors: { today: 0, last7: 0, last30: 0 },
    daily: [{ day: '2026-10-26', views: 0, errors: 0 }, { day: '2026-10-27', views, errors: 0 }] });
  return { available: true, mode: 'aggregate', generatedAt: new Date().toISOString(), range: { from: '2026-10-26', to: '2026-10-27' },
    history: { firstRecordedDay: '2026-10-26', restoredViews: 0 },
    verification: { agent: 'analytics_verification', status: state.verification, checkedAt: new Date().toISOString(), lastVerifiedAt: new Date().toISOString(), intervalSeconds: 60 },
    categories: [row('home', 'Home', 'page', state.home), row('settings', 'Settings', 'page', state.other), row('home_feed', 'Home feed tab', 'tab', state.tabs)],
    daily: [{ day: '2026-10-26', views: 0, errors: 0 }, { day: '2026-10-27', views: state.home + state.other + state.tabs, errors: 0 }],
    performance: { details: [] }, service: { responses: [] } };
}
function request(url, options = {}) {
  if (url.includes('/geography')) return Promise.resolve(Response.json({ available: true, countries: [], cities: [], total: 0, knownCity: 0, knownCountry: 0, unknownCity: 0, unknownCountry: 0 }));
  state.reads++; state.active++; state.maxActive = Math.max(state.maxActive, state.active);
  const payload = report(), mode = state.mode;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = fn => { if (!finished) { finished = true; state.active--; fn(); } };
    const release = () => finish(() => resolve(Response.json(payload)));
    options.signal?.addEventListener('abort', () => { state.aborted++; if (mode !== 'ignoreAbort') finish(() => reject(new DOMException('Aborted', 'AbortError'))); }, { once: true });
    if (mode === 'hold' || mode === 'ignoreAbort') state.pending.push(release);
    else if (mode === 'failure') finish(() => resolve(Response.json({ available: false, error: 'Fixture storage unavailable.' }, { status: 503 })));
    else if (mode === 'unauthorized') finish(() => resolve(Response.json({}, { status: 401 })));
    else release();
  });
}
const root = createRoot(document.getElementById('root'));
root.render(<AnalyticsDashboard apiBase="/fixture-api" request={request} />);
window.unmountAnalyticsFixture = () => root.unmount();
