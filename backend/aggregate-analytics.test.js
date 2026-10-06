'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PGlite } = require('@electric-sql/pglite');
const analytics = require('./aggregate-analytics');
const { createAppHarness } = require('./test-support/app-harness');

function response() {
  return { statusCode: 200, set() { return this; }, status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; }, end() { return this; } };
}

test('real analytics endpoints aggregate fixed categories without accepting or persisting identities', async t => {
  const pg = new PGlite(); await pg.exec(analytics.ANALYTICS_SCHEMA); t.after(() => pg.close());
  const app = await createAppHarness({ connected: true, env: { OFFICE_TOKEN: 'analytics-test' }, query(sql, params) {
    if (sql.includes('analytics_daily_counts')) return pg.query(sql, params);
    return { rows: [], rowCount: 0 };
  } }); t.after(() => app.close());
  const sensitive = { authorization: 'Bearer synthetic-secret', cookie: 'account=secret', referer: 'https://uficonnect.org/messages/private-id?email=private@example.invalid' };
  for (let i = 0; i < 3; i++) assert.equal((await app.request('/analytics/pageview', {
    method: 'POST', body: { category: 'messages' }, headers: sensitive,
  })).status, 204);
  assert.equal((await app.request('/analytics/performance', { method: 'POST', body: {
    category: 'app_privacy', kind: 'client_error', code: 'render_error',
  } })).status, 204);
  for (const body of [
    { category: 'messages', userId: 'secret' }, { category: '/messages/private-id' },
    { category: 'messages', referrer: 'secret' }, { category: 'messages', visitorId: 'secret' },
    { category: ['messages'] }, { path: '/settings', referrer: 'private' },
  ]) assert.equal((await app.request('/analytics/pageview', { method: 'POST', body })).status, 400);
  assert.equal((await app.request('/analytics/performance', { method: 'POST', body: {
    category: 'messages', kind: 'client_error', code: 'secret exception text',
  } })).status, 400);
  assert.equal((await app.request('/analytics/pageview?userId=private', { method: 'POST', body: { category: 'home' } })).status, 400);
  assert.equal((await app.request('/analytics/pageview', { method: 'POST', body: { category: 'home', padding: 'x'.repeat(600) } })).status, 413);
  assert.equal((await app.request('/office/analytics/pageviews')).status, 401);
  await app.request('/synthetic-private-path?email=private@example.invalid');
  const report = await app.request('/office/analytics/pageviews', { headers: { 'x-office-token': 'analytics-test' } });
  assert.equal(report.status, 200);
  assert.equal(report.data.mode, 'aggregate');
  assert.equal(report.data.today, 3);
  assert.equal(report.data.performance.last30, 1);
  assert.equal(report.data.service.total, 1);
  assert.equal(report.data.service.responses[0].statusClass, '4xx');
  assert.equal('todayVisitors' in report.data, false);
  const rows = (await pg.query('SELECT * FROM analytics_daily_counts ORDER BY kind')).rows;
  assert.equal(rows.length, 2);
  assert.equal(Number(rows.find(row => row.kind === 'page_view').event_count), 3);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['category', 'code', 'day', 'event_count', 'kind']);
  assert.doesNotMatch(JSON.stringify(rows) + JSON.stringify(report.data), /private-id|private@example|synthetic-secret|account=secret|synthetic-private-path/);
  assert.equal(app.queries.some(query => /INSERT INTO (page_views|user_sign_in_events|client_error_reports|negative_usage_signals)/.test(query.sql)), false);
  for (const path of ['/analytics/sign-in', '/client-error', '/negative-signal']) {
    assert.equal((await app.request(path, { method: 'POST', body: { userId: 'secret', message: 'private text' }, headers: sensitive })).status, 204);
  }
  assert.equal(app.queries.some(query => /INSERT INTO (page_views|user_sign_in_events|client_error_reports|negative_usage_signals)/.test(query.sql)), false);
});

test('aggregate batching retries safely, bounds counts, and expires only new aggregates after 30 UTC days', async t => {
  const pg = new PGlite(); await pg.exec(analytics.ANALYTICS_SCHEMA); t.after(() => pg.close());
  let fail = true; let inserts = 0; let clock = Date.parse('2026-09-20T10:00:00Z'); let timer;
  const db = { isConnected: () => true, async query(sql, params) {
    if (sql.startsWith('INSERT')) { inserts++; if (fail) throw new Error('private connection information'); }
    return pg.query(sql, params);
  } };
  const metrics = analytics.createAggregateAnalytics({ db, now: () => clock, schedule(fn) { timer = fn; } });
  for (let i = 0; i < 100; i++) {
    const res = response(); metrics.pageview({ body: { category: 'home' } }, res); assert.equal(res.statusCode, 204);
  }
  assert.equal(inserts, 0);
  assert.equal(await metrics.flush(), false);
  fail = false; assert.equal(await metrics.flush(), true);
  assert.equal(Number((await pg.query('SELECT event_count FROM analytics_daily_counts')).rows[0].event_count), 100);
  assert.equal(inserts, 2);
  await pg.exec("CREATE TABLE page_views (path TEXT); INSERT INTO page_views VALUES ('legacy-private-history');");
  clock += 30 * 86400_000;
  metrics.pageview({ body: { category: 'home' } }, response());
  await metrics.flush();
  const rows = (await pg.query('SELECT day::text, event_count FROM analytics_daily_counts')).rows;
  assert.deepEqual(rows.map(row => ({ day: row.day, count: Number(row.event_count) })), [{ day: '2026-10-20', count: 1 }]);
  assert.equal((await pg.query('SELECT path FROM page_views')).rows[0].path, 'legacy-private-history');
  assert.equal(typeof timer, 'function');
  for (let i = 0; i < 5999; i++) metrics.pageview({ body: { category: 'home' } }, response());
  const limited = response(); metrics.pageview({ body: { category: 'home' } }, limited); assert.equal(limited.statusCode, 429);
  await metrics.flush();
  clock += 30 * 86400_000;
  await metrics.flush(); // No new events: scheduled cleanup still expires rows.
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM analytics_daily_counts')).rows[0].count, 0);
  await assert.rejects(pg.query("INSERT INTO analytics_daily_counts VALUES (CURRENT_DATE,'private-id','page_view','',1)"));
});

test('service metrics contain bounded status/duration categories and ignore metrics, health and VPN traffic', () => {
  let clock = 0;
  const metrics = analytics.createAggregateAnalytics({ db: { isConnected: () => false }, now: () => clock, schedule() {} });
  for (const path of ['/analytics/pageview', '/analytics/performance', '/office/analytics/pageviews', '/health', '/readyz', '/vpn', '/vpn/config', '/vpn/devices', '/vpn/devices/private-device-id', '/vpn/gateways/private-gateway/desired']) {
    const res = new EventEmitter(); res.statusCode = 200;
    metrics.serviceMiddleware({ path }, res, () => {}); res.emit('finish');
  }
  const res = new EventEmitter(); res.statusCode = 500;
  metrics.serviceMiddleware({ path: '/messages/private' }, res, () => {}); clock = 999999; res.emit('finish');
  const result = response(); metrics.report({}, result);
  assert.equal(result.body.service.total, 1);
  assert.deepEqual(result.body.service.responses, [{ statusClass: '5xx', durationBucket: 'over_10s', count: 1 }]);
  assert.doesNotMatch(JSON.stringify(result.body), /messages|private/);
  const unavailable = response(); metrics.pageview({ body: { category: 'home' } }, unavailable);
  assert.equal(unavailable.statusCode, 503);
});

test('authenticated VPN requests do not update shared app activity', async t => {
  const app = await createAppHarness({ connected: true }); t.after(() => app.close());
  app.seedUser(require('./test-support/app-harness').member('vpn-metrics-test'));
  const before = app.queries.length;
  assert.equal((await app.request('/vpn/config', { userId: 'vpn-metrics-test' })).status, 200);
  assert.equal(app.queries.slice(before).some(query => query.sql.includes('site_activity_heartbeat')), false);
  // The exclusion must not disable the existing activity signal elsewhere.
  await app.request('/profile', { userId: 'vpn-metrics-test' });
  assert.equal(app.queries.slice(before).some(query => query.sql.includes('site_activity_heartbeat')), true);
});

test('network abuse limit rejects excess analytics requests without authentication', async t => {
  const app = await createAppHarness({ connected: true }); t.after(() => app.close());
  for (let i = 0; i < 60; i++) assert.equal((await app.request('/analytics/pageview', {
    method: 'POST', body: { category: 'home' },
  })).status, 204);
  assert.equal((await app.request('/analytics/pageview', { method: 'POST', body: { category: 'home' } })).status, 429);
});
