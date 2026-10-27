'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyAnalyticsReport, createAnalyticsVerification } = require('./analytics-verification');
const { createAppHarness } = require('./test-support/app-harness');
const aggregateAnalytics = require('./aggregate-analytics');
const { sanitizeSnapshot } = require('./office-agent-chat');

const today = '2026-10-27';
const yesterday = '2026-10-26';
const period = (current, previous = 0) => ({ today: current, last7: current + previous, last30: current + previous });
function fixture() {
  const categoryDays = [
    { day: yesterday, category: 'home', views: 3, errors: 1 },
    { day: today, category: 'home', views: 40, errors: 2 },
    { day: today, category: 'app_feed', views: 5, errors: 0 },
    { day: today, category: 'command_center_media', views: 99, errors: 0 },
  ];
  const categories = [
    { category: 'home', platform: 'web', viewType: 'page', ...period(40, 3), errors: period(2, 1) },
    { category: 'app_feed', platform: 'mobile', viewType: 'screen', ...period(5), errors: period(0) },
    { category: 'command_center_media', platform: 'web', viewType: 'tab', ...period(99), errors: period(0) },
  ].map(category => ({ ...category, daily: [yesterday, today].map(day => ({ day,
    views: categoryDays.find(row => row.day === day && row.category === category.category)?.views || 0,
    errors: categoryDays.find(row => row.day === day && row.category === category.category)?.errors || 0 })) }));
  const sources = [{ source: 'anonymous-daily-counts', views: 144 }, { source: 'legacy_page_views_primary', views: 3 }];
  const report = { available: true, range: { from: '2026-05-01', to: today }, ...period(144, 3),
    daily: [{ day: yesterday, views: 3, errors: 1, web: 3, mobile: 0 }, { day: today, views: 144, errors: 2, web: 139, mobile: 5 }],
    categories, performance: period(2, 1), history: { sources, restoredViews: 3 },
    platforms: { web: period(139, 3), mobile: period(5) },
    viewTypes: { page: period(40, 3), screen: period(5), tab: period(99) } };
  const expected = { rowCount: 1718, anonymousRows: 1148, historyRows: 570, invalidRows: 0,
    totals: { views: 147, errors: 3, ...period(144, 3), errorsToday: 2, errorsLast7: 3, errorsLast30: 3, restoredViews: 3 },
    categoryDays, sources: structuredClone(sources),
    platforms: [{ key: 'web', ...period(139, 3) }, { key: 'mobile', ...period(5) }],
    viewTypes: [{ key: 'page', ...period(40, 3) }, { key: 'screen', ...period(5) }, { key: 'tab', ...period(99) }] };
  return { report, expected };
}

test('verification keeps aggregate row counts separate from page, screen and tab events', () => {
  const { report, expected } = fixture();
  const result = verifyAnalyticsReport(report, expected);
  assert.equal(result.mismatchCount, 0);
  assert.ok(result.checks.length >= 15);
  assert.ok(result.checks.every(check => check.status === 'pass'));
  assert.deepEqual(result.metrics, { bucketRows: 1718, liveBucketRows: 1148, historyBucketRows: 570, viewsToday: 144, allViews: 147,
    pageViewsToday: 40, screenViewsToday: 5, tabViewsToday: 99, restoredViews: 3, invalidRows: 0 });
});

test('verification detects category/day swaps even when every overall total remains equal', () => {
  const { report, expected } = fixture();
  report.categories[0].daily[1].views -= 1;
  report.categories[2].daily[1].views += 1;
  const result = verifyAnalyticsReport(report, expected);
  assert.ok(result.mismatchCount > 0);
  assert.equal(result.checks.find(check => check.name === 'category-day-views').status, 'mismatch');
  assert.equal(result.checks.find(check => check.name === 'views-today').status, 'pass');
});

test('verification detects swapped page/screen and tab totals without conflating their equal grand total', () => {
  const { report, expected } = fixture();
  report.viewTypes.page.today += 10;
  report.viewTypes.tab.today -= 10;
  const result = verifyAnalyticsReport(report, expected);
  assert.equal(result.checks.find(check => check.name === 'viewTypes').status, 'mismatch');
});

test('verification checks the category table Today, 7-day and 30-day values independently', () => {
  for (const field of ['today', 'last7', 'last30']) {
    for (const errors of [false, true]) {
      const { report, expected } = fixture();
      const target = errors ? report.categories[0].errors : report.categories[0];
      target[field] += 1;
      assert.ok(verifyAnalyticsReport(report, expected).mismatchCount > 0, `${errors ? 'errors' : 'views'} ${field}`);
    }
  }
});

test('verification rejects missing, null, boolean and empty numeric measurements', () => {
  for (const invalid of [undefined, null, false, '', -1, Number.MAX_SAFE_INTEGER + 1]) {
    const { report, expected } = fixture();
    report.viewTypes.screen.today = invalid;
    assert.ok(verifyAnalyticsReport(report, expected).mismatchCount > 0, `Invalid positive measurement: ${String(invalid)}`);
    const zero = fixture();
    zero.report.categories[1].daily[1].errors = invalid;
    assert.ok(verifyAnalyticsReport(zero.report, zero.expected).mismatchCount > 0, `Invalid zero measurement: ${String(invalid)}`);
  }
});

test('invalid database rows fail verification and raw category strings never enter checks', () => {
  const { report, expected } = fixture();
  expected.invalidRows = 1;
  report.categories[0].category = 'PRIVATE_IDENTITY_SENTINEL';
  const result = verifyAnalyticsReport(report, expected);
  assert.equal(result.checks.find(check => check.name === 'valid-storage-rows').status, 'mismatch');
  assert.ok(result.mismatchCount > 0);
  assert.equal(JSON.stringify(result).includes('PRIVATE_IDENTITY_SENTINEL'), false);
});

test('automatic verification schedules real work and coalesces concurrent dashboard/manual runs', async () => {
  let time = Date.parse(today + 'T12:00:00Z'), calls = 0, release, timer, unrefs = 0;
  const blocked = new Promise(resolve => { release = resolve; });
  const agent = createAnalyticsVerification({ now: () => time,
    readReport: async () => { calls++; await blocked; return fixture(); },
    schedule(callback, delay) { timer = { callback, delay }; return { unref() { unrefs++; } }; } });
  assert.equal(agent.snapshot().status, 'pending');
  assert.equal(agent.snapshot().totalRuns, 0);
  assert.equal(timer.delay, 60_000);
  assert.equal(unrefs, 1);
  timer.callback();
  const manual = agent.run(), dashboard = agent.read();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(agent.snapshot().running, true);
  time += 20; release();
  const [checked, report] = await Promise.all([manual, dashboard]);
  assert.equal(checked.status, 'verified');
  assert.equal(checked.totalRuns, 1);
  assert.equal(report.verification.status, 'verified');
  assert.equal(checked.lastDurationMs, 20);
  assert.equal(agent.snapshot().running, false);
  time += 120_001;
  assert.equal(agent.snapshot().status, 'stale');
  assert.equal(agent.snapshot().lastVerifiedAt, checked.lastVerifiedAt);
});

test('database errors and mismatches retain last verified time without claiming current success', async () => {
  let time = Date.parse(today + 'T12:00:00Z'), mode = 'success';
  const agent = createAnalyticsVerification({ now: () => time, schedule() {}, readReport: async () => {
    if (mode === 'failure') throw Error('PRIVATE_DATABASE_ERROR_SENTINEL');
    const value = fixture(); if (mode === 'mismatch') value.report.today++;
    return value;
  } });
  const verified = await agent.run();
  mode = 'mismatch'; time += 1000;
  const mismatch = await agent.run();
  assert.equal(mismatch.status, 'mismatch');
  assert.equal(mismatch.lastVerifiedAt, verified.lastVerifiedAt);
  mode = 'failure'; time += 1000;
  const failed = await agent.run();
  assert.equal(failed.status, 'error');
  assert.equal(failed.lastVerifiedAt, verified.lastVerifiedAt);
  assert.equal(JSON.stringify(failed).includes('PRIVATE_DATABASE_ERROR_SENTINEL'), false);
  await assert.rejects(agent.read(), /Metrics storage unavailable/);
});

test('timeout keeps one database read in flight until it settles', async () => {
  let calls = 0, release;
  const work = new Promise(resolve => { release = resolve; });
  const agent = createAnalyticsVerification({ timeoutMs: 10, schedule() {}, readReport: async () => { calls++; return work; } });
  assert.equal((await agent.run()).status, 'error');
  assert.equal(agent.snapshot().running, true);
  assert.equal((await agent.run()).status, 'error');
  assert.equal(calls, 1);
  release(fixture()); await new Promise(resolve => setImmediate(resolve));
  assert.equal(agent.snapshot().running, false);
  assert.equal(agent.snapshot().status, 'error', 'A late read cannot turn a timed-out check into success');
});

test('disabled runtime does not schedule automatic verification', () => {
  let schedules = 0;
  const agent = createAnalyticsVerification({ enabled: false, readReport: async () => fixture(), schedule() { schedules++; } });
  assert.equal(schedules, 0);
  assert.equal(agent.snapshot().enabled, false);
});

test('agent chat allows only verified aggregate measurements and never raw report data', () => {
  const safe = sanitizeSnapshot({ agentId: 'analytics_verification', serviceRole: 'api', executionRole: 'api',
    diagnosticCapability: 'runtime-metrics', status: 'healthy', cadence: '1min', metrics: {
      bucketRows: 1148, pageViewsToday: 40, screenViewsToday: 5, tabViewsToday: 99, verified: true,
      rawError: 'PRIVATE_DATABASE_ERROR_SENTINEL', email: 'fixture@example.invalid', categories: ['private'] } });
  assert.equal(safe.metrics.bucketRows, 1148);
  assert.equal(safe.metrics.pageViewsToday + safe.metrics.screenViewsToday, 45);
  assert.equal(safe.metrics.tabViewsToday, 99);
  assert.equal(safe.metrics.verified, true);
  assert.equal(JSON.stringify(safe).includes('PRIVATE_DATABASE_ERROR_SENTINEL'), false);
  assert.equal(JSON.stringify(safe).includes('fixture@example.invalid'), false);
  assert.match(safe.purpose, /stored aggregate rows are distinct/);
});

test('real Office registry and trigger routes report actual verifier state and API ownership', async t => {
  for (const role of ['api', 'pipeline']) {
    let runs = 0, enabled;
    const verification = { status: 'pending', totalRuns: 0, checkedAt: null, lastVerifiedAt: null, enabled: role === 'api', running: false,
      metrics: null, mismatchCount: 0 };
    const app = await createAppHarness({ env: { OFFICE_TOKEN: 'analytics-agent-test', SERVICE_ROLE: role }, modules: {
      './aggregate-analytics': { ...aggregateAnalytics, createAggregateAnalytics(options) {
        enabled = options.verificationEnabled;
        return { ...aggregateAnalytics.createAggregateAnalytics({ ...options, verificationEnabled: false }), verification: {
          snapshot: () => verification,
          run: async () => { runs++; const { report, expected } = fixture(); Object.assign(verification, { status: 'verified', totalRuns: runs,
            checkedAt: today + 'T12:00:00.000Z', lastVerifiedAt: today + 'T12:00:00.000Z', metrics: verifyAnalyticsReport(report, expected).metrics });
            return verification; },
        } };
      } },
    } });
    t.after(() => app.close());
    assert.equal(enabled, role === 'api');
    const headers = { 'x-office-token': 'analytics-agent-test' };
    assert.equal((await app.request('/office/agents')).status, 401);
    for (const route of ['/office/agents/analytics_verification/trigger', '/hq/trigger/analytics_verification']) {
      assert.equal((await app.request(route, { method: 'POST', body: {} })).status, 401);
    }
    const initial = await app.request('/office/agents', { headers });
    assert.equal(initial.headers.get('cache-control'), 'no-store');
    const observed = initial.data.agents.analytics_verification;
    assert.equal(observed.executionRole, 'api');
    assert.equal(observed.health.status, role === 'api' ? 'idle' : 'unavailable');
    assert.equal(observed.triggerable, role === 'api');
    for (const route of ['/office/agents/analytics_verification/trigger', '/hq/trigger/analytics_verification']) {
      const triggered = await app.request(route, { method: 'POST', headers, body: {} });
      assert.equal(triggered.status, role === 'api' ? 200 : 409);
      if (role === 'api') assert.equal(triggered.data.verification.status, 'verified');
    }
    assert.equal(runs, role === 'api' ? 2 : 0);
    if (role === 'api') {
      for (const status of ['mismatch', 'error', 'stale']) {
        verification.status = status;
        for (const running of [false, true]) {
          verification.running = running;
          const response = await app.request('/office/agents', { headers });
          assert.equal(response.data.agents.analytics_verification.health.status, 'degraded', `${status} stays visible while running=${running}`);
          assert.equal(response.data.agents.analytics_verification.health.verified, false);
        }
      }
      verification.status = 'verified';
      verification.running = true;
      assert.equal((await app.request('/office/agents', { headers })).data.agents.analytics_verification.health.status, 'running');
    }
  }
});
