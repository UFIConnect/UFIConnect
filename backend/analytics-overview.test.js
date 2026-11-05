'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createAnalyticsOverview } = require('./analytics-overview');
const { createAggregateAnalytics, ANALYTICS_SCHEMA, ANALYTICS_VERIFICATION_QUERY } = require('./aggregate-analytics');
const { createTrafficAnalytics, TRAFFIC_ANALYTICS_SCHEMA } = require('./traffic-analytics');
const { createAppHarness } = require('./test-support/app-harness');
const start = Date.parse('2026-11-05T04:00:00Z');
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const res = () => ({ statusCode: 200, set() { return this; }, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; }, end() { return this; } });
const traffic = () => ({ available: true, source: 'cloudflare-zone-http', status: 'cached',
  generatedAt: '2026-11-05T03:59:00Z', checkedAt: '2026-11-05T04:00:00Z',
  range: { from: '2026-05-01', to: '2026-11-05', timezone: 'UTC' }, daily: [{ day: '2026-05-25', requests: 100000, pageViews: 30000 }],
  totals: { requests: 100000, pageViews: 30000, uniqueVisitors: null }, coverage: { firstRecordedDay: '2026-05-25', missingDays: ['2026-05-01'] }, cache: { ttlMs: 300000 } });

test('one overview preserves separate source totals and shares provider and verified database snapshots with legacy readers', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(ANALYTICS_SCHEMA); await pg.exec(TRAFFIC_ANALYTICS_SCHEMA);
  await pg.exec(`INSERT INTO analytics_daily_counts VALUES ('2026-11-05','home','page_view','',5),
    ('2026-11-05','app_feed','page_view','',7),('2026-11-05','command_center_media','page_view','',3);
    INSERT INTO analytics_history_daily_counts(source,day,category,event_count) VALUES ('legacy_page_views_backup','2026-08-11','home',9000);`);
  let canonicalReads = 0, providerReads = 0;
  const db = { isConnected: () => true, query: (sql, args) => { if (sql === ANALYTICS_VERIFICATION_QUERY) canonicalReads++; return pg.query(sql, args); } };
  const activity = createAggregateAnalytics({ db, now: () => start, schedule() {}, rollingEnabled: false });
  const edge = createTrafficAnalytics({ db, now: () => start, env: { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'private-provider-token-never-returned' },
    fetcher: async url => {
      if (!url.endsWith('/graphql')) return response({ success: true, result: [{ id: 'b'.repeat(32), name: 'uficonnect.org', account: { id: 'a'.repeat(32) } }] });
      providerReads++;
      return response({ data: { viewer: { zones: [{ httpRequests1dGroups: [{ dimensions: { date: '2026-05-25' }, sum: { requests: 100000, pageViews: 30000, threats: 4 }, uniq: { uniques: 7000 } }] }] } } });
    } });
  const overview = createAnalyticsOverview({ aggregateAnalytics: activity, trafficAnalytics: edge, now: () => start });
  const legacyActivity = res(), legacyTraffic = res();
  const values = await Promise.all([...Array.from({ length: 12 }, () => overview.snapshot()),
    activity.report({ query: { detail: 'compact' } }, legacyActivity), edge.report({ query: {} }, legacyTraffic)]);
  const report = values[0];
  assert.equal(report.mode, 'overview'); assert.equal(report.status, 'ready');
  assert.deepEqual(report.range, { from: '2026-05-01', to: '2026-11-05', timezone: 'UTC' });
  assert.equal(report.traffic.totals.requests, 100000); assert.equal(report.traffic.totals.pageViews, 30000);
  assert.equal(report.activity.history.recordedViews, 9015); assert.equal(report.activity.history.pageScreenViews, 9012); assert.equal(report.activity.history.tabOpens, 3);
  assert.equal(report.activity.verification.status, 'verified'); assert.equal(report.activity.categoryDailyEncoding, 'sparse');
  assert.equal(report.sources.activity.firstRecordedDay, '2026-08-11'); assert.equal(report.sources.traffic.firstRecordedDay, '2026-05-25');
  assert.ok(report.traffic.coverage.missingDays.includes('2026-05-01')); assert.equal(report.traffic.totals.uniqueVisitors, null);
  assert.equal(canonicalReads, 1); assert.equal(providerReads, 1);
  assert.equal(legacyActivity.body.history.recordedViews, report.activity.history.recordedViews);
  assert.equal(legacyTraffic.body.totals.requests, report.traffic.totals.requests);
  assert.ok(JSON.stringify(report).length < 300000, 'the envelope keeps the compact activity projection');
  assert.doesNotMatch(JSON.stringify(report), /private-provider-token/);
  const accepted = res(); await activity.pageview({ body: { category: 'home' } }, accepted);
  assert.equal(accepted.statusCode, 204);
  const updated = await overview.snapshot();
  assert.equal(updated.activity.history.recordedViews, 9016, 'new durable opens invalidate their source without waiting for an envelope TTL');
  assert.equal(providerReads, 1, 'an activity refresh does not refetch provider traffic');
});

test('traffic-only and activity-only overviews remain usable without changing unknown metrics into zero', async () => {
  const activity = { available: true, mode: 'aggregate', daily: [], categories: [], history: { firstRecordedDay: null }, verification: { status: 'verified' } };
  for (const healthy of ['activity', 'traffic']) {
    const overview = createAnalyticsOverview({ now: () => start,
      aggregateAnalytics: { snapshot: async () => { if (healthy !== 'activity') throw Error('private-database-host'); return activity; } },
      trafficAnalytics: { snapshot: async () => { if (healthy !== 'traffic') throw Error('private-provider-secret'); return traffic(); } },
    });
    const target = res(); await overview.report({ query: {} }, target);
    assert.equal(target.statusCode, 200); assert.equal(target.body.status, 'partial');
    assert.equal(target.body.sources[healthy].available, true);
    const missing = healthy === 'activity' ? 'traffic' : 'activity';
    assert.equal(target.body.sources[missing].available, false); assert.equal(target.body[missing].totals, undefined);
    assert.doesNotMatch(JSON.stringify(target.body), /private-database-host|private-provider-secret/);
  }
});

test('overview uses typed snapshots, isolates unavailable sources, validates inputs and changes its UTC envelope at midnight', async () => {
  let clock = Date.parse('2026-11-04T23:59:59Z'), reads = 0;
  const broken = { snapshot: async () => { reads++; return { available: false }; }, report() { throw Error('HTTP adapters must not be called internally'); } };
  const overview = createAnalyticsOverview({ aggregateAnalytics: broken, trafficAnalytics: broken, now: () => clock });
  const first = res(); await overview.report({ query: {} }, first);
  assert.equal(first.statusCode, 503); assert.equal(first.body.available, false); assert.equal(first.body.range.to, '2026-11-04');
  clock += 2000;
  assert.equal((await overview.snapshot()).range.to, '2026-11-05');
  const count = reads, invalid = res(); await overview.report({ query: { url: 'https://unrelated.example' } }, invalid);
  assert.equal(invalid.statusCode, 400); assert.equal(reads, count);
});

test('the overview route requires Office access and returns the shared source envelope', async t => {
  const app = await createAppHarness({ env: { OFFICE_TOKEN: 'overview-route-test' }, modules: {
    './analytics-overview': { createAnalyticsOverview: dependencies => createAnalyticsOverview({ ...dependencies,
      trafficAnalytics: { snapshot: async () => traffic() }, now: () => start }) },
  } });
  t.after(() => app.close());
  assert.equal((await app.request('/office/analytics/overview')).status, 401);
  assert.equal((await app.request('/office/analytics/overview', { headers: { 'x-office-token': 'wrong' } })).status, 401);
  const authorized = await app.request('/office/analytics/overview', { headers: { 'x-office-token': 'overview-route-test' } });
  assert.equal(authorized.status, 200); assert.equal(authorized.data.mode, 'overview');
  assert.equal(authorized.data.traffic.totals.requests, 100000); assert.equal(authorized.data.activity.available, false);
  assert.equal(authorized.headers.get('cache-control'), 'private, no-store');
});
