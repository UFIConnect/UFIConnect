import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAnalytics, filterDiagnostics, reportDays, normalizeAnalyticsOverview, filterAnalyticsOverview } from './analytics-model.mjs';
const report = {
  daily: [{ day: '2026-10-07' }, { day: '2026-10-08' }],
  categories: [
    { category: 'home', label: 'Home', platform: 'web', viewType: 'page', daily: [{ day: '2026-10-07', views: 8, errors: 1 }, { day: '2026-10-08', views: 2, errors: 0 }] },
    { category: 'command_center_accounts', label: 'Connected accounts tab', platform: 'web', viewType: 'tab', daily: [{ day: '2026-10-08', views: 3, errors: 0 }] },
    { category: 'app_feed', label: 'App feed', platform: 'mobile', viewType: 'screen', daily: [{ day: '2026-10-08', views: 4, errors: 2 }] },
    { category: 'maps', label: 'Maps', platform: 'web', viewType: 'page', daily: [] },
  ],
};
test('zero-filled category rows stay visible and page totals are separate from tab opens', () => {
  const data = filterAnalytics(report);
  assert.equal(data.views, 14); assert.equal(data.tabs, 3); assert.equal(data.errors, 3);
  assert.equal(data.rows.length, 4); assert.equal(data.activeCategories, 3);
  assert.equal(data.rows.find(row => row.category === 'maps').selectedViews, 0);
  assert.equal(data.daily.length, 2);
  assert.equal(reportDays(report, 0).at(-1), '2026-10-08', 'Dates use the report, not the client clock');
});

test('server May range survives local filtering, fills missing dates and uses recorded historical counts', () => {
  const history = { ...report, range: { from: '2026-05-01', to: '2026-10-08' },
    categories: [...report.categories, { category: 'old_home', label: 'Historical Home', platform: 'web', viewType: 'page', daily: [{ day: '2026-05-01', views: 7 }] }] };
  const days = reportDays(history, 0);
  assert.equal(days.length, 161); assert.equal(days[0], '2026-05-01'); assert.equal(days.at(-1), '2026-10-08');
  const data = filterAnalytics(history, { start: '2026-05-01', end: '2026-05-31' });
  assert.equal(data.views, 7); assert.equal(data.daily.length, 31);
  assert.equal(data.daily.at(-1).views, 0);
  assert.equal(data.rows.find(row => row.category === 'home').selectedViews, 0);
  assert.equal(reportDays({ range: { from: '2026-99-99', to: '2026-10-08' } }, 0).length, 30);
});
test('date, platform, category and view-type filters affect both table and chart', () => {
  let data = filterAnalytics(report, { start: '2026-10-08', end: '2026-10-08', platform: 'web' });
  assert.equal(data.views, 2); assert.equal(data.tabs, 3); assert.equal(data.errors, 0); assert.equal(data.daily.length, 1);
  data = filterAnalytics(report, { platform: 'mobile' });
  assert.equal(data.views, 4); assert.equal(data.rows.length, 1); assert.equal(data.errors, 2);
  data = filterAnalytics(report, { category: 'home', end: '2026-10-07' });
  assert.equal(data.views, 8); assert.equal(data.errors, 1);
  data = filterAnalytics(report, { viewType: 'tab' });
  assert.equal(data.views, 0); assert.equal(data.tabs, 3); assert.equal(data.rows.length, 1);
});

test('dates before the earliest retained event are unavailable rather than zero recorded views', () => {
  const history = { ...report, range:{ from:'2026-05-01',to:'2026-10-08' },history:{ firstRecordedDay:'2026-08-11' } };
  const result = filterAnalytics(history);
  assert.deepEqual(result.daily[0], { day:'2026-05-01',available:false,views:null,tabs:null,errors:null });
  assert.deepEqual(result.daily.find(row => row.day === '2026-08-11'), { day:'2026-08-11',available:true,views:0,tabs:0,errors:0 });
  assert.equal(result.views,14);
  const may = filterAnalytics(history, { start: '2026-05-01', end: '2026-05-31' });
  assert.equal(may.availableDays, 0); assert.equal(may.unavailableDays, 31);
});

const diagnosticReport = { ...report, performance: { details: [
  { day: '2026-10-07', category: 'home', code: 'request_failed', count: 1 },
  { day: '2026-10-08', category: 'app_feed', code: 'render_error', count: 2 },
] } };

test('diagnostic breakdowns respect the same date, platform, category and view filters', () => {
  assert.deepEqual(filterDiagnostics(diagnosticReport, { platform: 'web', end: '2026-10-07' }).map(row => [row.category, row.count]), [['home', 1]]);
  assert.equal(filterDiagnostics(diagnosticReport, { viewType: 'tab' }).length, 0);
  assert.equal(filterDiagnostics(diagnosticReport, { category: 'app_feed' })[0].count, 2);
  assert.equal(filterDiagnostics(diagnosticReport, { start: '2026-10-09' }).length, 0);
  assert.equal(filterDiagnostics(report), null);
});

const overview = { available: true, mode: 'overview', range: { from: '2026-05-01', to: '2026-10-08' }, generatedAt: '2026-10-08T12:00:00Z',
  activity: { ...report, available: true, mode: 'aggregate', range: { from: '2026-05-01', to: '2026-10-08' }, history: { firstRecordedDay: '2026-10-07' }, verification: { status: 'verified' } },
  traffic: { available: true, status: 'cached', coverage: { firstRecordedDay: '2026-05-25' }, daily: [
    { day: '2026-05-25', pageViews: 20000, requests: 50000 }, { day: '2026-05-26', pageViews: 0, requests: 0 },
    { day: '2026-10-08', pageViews: 15000, requests: 40000 },
  ] } };

test('unified overview applies the same UTC range to traffic and tracked metrics without summing distinct sources', () => {
  const normalized = normalizeAnalyticsOverview(overview), all = filterAnalyticsOverview(normalized);
  assert.equal(all.metrics.htmlViews.total, 35000); assert.equal(all.metrics.edgeRequests.total, 90000);
  assert.equal(all.metrics.webOpens.total, 10); assert.equal(all.metrics.screenOpens.total, 4); assert.equal(all.metrics.tabs.total, 3);
  assert.equal(all.metrics.htmlViews.observedDays, 3); assert.equal(all.selectedDays, 161);
  const may = filterAnalyticsOverview(normalized, { start: '2026-05-01', end: '2026-05-31' });
  assert.equal(may.metrics.htmlViews.total, 20000); assert.equal(may.metrics.webOpens.total, null);
  const today = filterAnalyticsOverview(normalized, { start: '2026-10-08', end: '2026-10-08' });
  assert.equal(today.metrics.htmlViews.total, 15000); assert.equal(today.metrics.webOpens.total, 2);
  assert.equal(today.metrics.screenOpens.total, 4); assert.equal(today.metrics.tabs.total, 3);
});

test('missing traffic dates stay unknown while an explicitly recorded zero stays zero', () => {
  const normalized = normalizeAnalyticsOverview(overview);
  const zero = filterAnalyticsOverview(normalized, { start: '2026-05-26', end: '2026-05-26' });
  assert.equal(zero.metrics.htmlViews.total, 0); assert.equal(zero.metrics.htmlViews.observedDays, 1);
  const absent = filterAnalyticsOverview(normalized, { start: '2026-05-27', end: '2026-05-27' });
  assert.equal(absent.metrics.htmlViews.total, null); assert.equal(absent.metrics.htmlViews.observedDays, 0);
  assert.equal(absent.daily[0].htmlViews, null);
});

test('traffic-only partial success has no invented activity counts or database verification', () => {
  const normalized = normalizeAnalyticsOverview({ ...overview, activity: { available: false, error: 'Activity unavailable.' } });
  assert.equal(normalized.activityAvailable, false); assert.equal(normalized.verification, undefined);
  const totals = filterAnalyticsOverview(normalized).metrics;
  assert.equal(totals.htmlViews.total, 35000);
  for (const key of ['webOpens', 'screenOpens', 'tabs', 'diagnostics']) assert.equal(totals[key].total, null);
});

test('activity-only partial success preserves tracked counts and never substitutes them for provider traffic', () => {
  const normalized = normalizeAnalyticsOverview({ ...overview, traffic: { available: false, error: 'Traffic unavailable.' } });
  const totals = filterAnalyticsOverview(normalized).metrics;
  assert.equal(totals.htmlViews.total, null); assert.equal(totals.edgeRequests.total, null); assert.equal(totals.webOpens.total, 10);
  assert.equal(normalized.verification.status, 'verified');
  assert.throws(() => normalizeAnalyticsOverview({ ...overview, activity: { available: false }, traffic: { available: false } }));
});

test('a never-recorded mobile metric stays unavailable and category totals receive none of the traffic history', () => {
  const activity = { ...overview.activity, categories: overview.activity.categories.filter(row => row.viewType !== 'screen') };
  const normalized = normalizeAnalyticsOverview({ ...overview, activity });
  assert.equal(filterAnalyticsOverview(normalized).metrics.screenOpens.total, null);
  assert.equal(filterAnalytics(normalized, { category: 'home' }).views, 10);
  assert.equal(filterAnalytics(normalized, { start: '2026-05-01', end: '2026-05-31' }).views, 0);
});
