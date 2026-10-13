import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAnalytics, filterDiagnostics, reportDays } from './analytics-model.mjs';
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
