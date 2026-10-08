import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAnalytics, reportDays } from './analytics-model.mjs';
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
  assert.equal(data.daily.length, 30);
  assert.equal(reportDays(report, 0).at(-1), '2026-10-08', 'Dates use the report, not the client clock');
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
