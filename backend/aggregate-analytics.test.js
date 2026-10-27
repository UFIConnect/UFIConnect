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

test('browser and backend catalogs match and list every fixed tab with no private pages', () => {
  const shared = require('../shared/analytics-categories.cjs');
  assert.deepEqual(shared.PAGE_CATEGORIES, analytics.CATEGORY_CATALOG);
  assert.deepEqual(shared.EXCLUDED_CATEGORIES, analytics.EXCLUDED_CATEGORIES);
  assert.deepEqual(shared.CATEGORY_IDS, analytics.PAGE_CATEGORIES);
  assert.ok(analytics.PAGE_CATEGORIES.length > 100);
  for (const [id, page] of Object.entries(analytics.CATEGORY_CATALOG)) {
    assert.match(id, /^[a-z][a-z0-9_]*$/);
    assert.equal(page.category, id);
    assert.equal(page.platform, id.startsWith('app_') ? 'mobile' : 'web');
    assert.ok(['page', 'screen', 'tab'].includes(page.viewType));
    assert.ok(page.title && page.label && page.group);
  }
  for (const excluded of analytics.EXCLUDED_CATEGORIES) assert.equal(analytics.PAGE_CATEGORIES.includes(excluded.category), false);
  for (const category of ['creator_analytics','how_it_works','vault_device_overview','command_center_media','settings_data','resume_outreach','app_profile_skills']) {
    assert.ok(analytics.PAGE_CATEGORIES.includes(category), category);
  }
});

test('category CHECK migration preserves existing totals and enables new categories atomically', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE analytics_daily_counts (
    day DATE NOT NULL, category TEXT NOT NULL CHECK (category IN ('home','app_feed','other')),
    kind TEXT NOT NULL CHECK (kind IN ('page_view','client_error')), code TEXT NOT NULL,
    event_count BIGINT NOT NULL CHECK(event_count > 0), PRIMARY KEY(day,category,kind,code));
    INSERT INTO analytics_daily_counts VALUES ('2026-10-08','home','page_view','',19);`);
  await pg.exec(analytics.ANALYTICS_SCHEMA);
  await assert.rejects(pg.query("INSERT INTO analytics_daily_counts VALUES ('2026-10-08','command_center_media','page_view','',1)"));
  for (const statement of analytics.ANALYTICS_MIGRATIONS) await pg.exec(statement);
  for (const category of ['command_center_media', 'job_compose', 'business_industries', 'business_cross_post']) {
    await pg.query("INSERT INTO analytics_daily_counts VALUES ('2026-10-08',$1,'page_view','',1)", [category]);
  }
  for (const statement of analytics.ANALYTICS_MIGRATIONS) await pg.exec(statement); // Restart safe.
  assert.equal(Number((await pg.query("SELECT event_count FROM analytics_daily_counts WHERE category='home'")).rows[0].event_count), 19);
  for (const category of ['/messages/private-id', 'private_account_id', 'vault', 'vault_device', 'app_vpn']) {
    await assert.rejects(pg.query("INSERT INTO analytics_daily_counts VALUES ('2026-10-08',$1,'page_view','',1)", [category]));
  }
});

test('detailed report includes every page, screen and tab, zero-filled days, correct UTC windows and errors', async t => {
  const pg = new PGlite(); await pg.exec(analytics.ANALYTICS_SCHEMA); t.after(() => pg.close());
  await pg.exec(`INSERT INTO analytics_daily_counts VALUES
    ('2026-10-08','home','page_view','',2),
    ('2026-10-08','command_center_media','page_view','',3),
    ('2026-10-02','app_profile_skills','page_view','',4),
    ('2026-10-01','app_feed','page_view','',5),
    ('2026-09-09','creator_analytics','page_view','',6),
    ('2026-09-08','settings_data','page_view','',7),
    ('2026-05-01','home','page_view','',12),
    ('2026-04-30','home','page_view','',100),
    ('2026-10-09','home','page_view','',9),
    ('2026-10-08','command_center_media','client_error','render_error',2),
    ('2026-10-01','app_feed','client_error','request_failed',3);`);
  const metrics = analytics.createAggregateAnalytics({ db: { isConnected: () => true, query: (...args) => pg.query(...args) },
    now: () => Date.parse('2026-10-08T00:01:00Z'), schedule() {} });
  const res = response(); await metrics.report({}, res); const result = res.body;
  assert.equal(res.statusCode, 200);
  assert.deepEqual(result.range, { from: '2026-05-01', to: '2026-10-08' });
  assert.deepEqual([result.today,result.last7,result.last30], [5,9,20]);
  assert.deepEqual(result.platforms, { web: { today:5,last7:5,last30:11 }, mobile:{ today:0,last7:4,last30:9 } });
  assert.deepEqual(result.viewTypes, { page:{ today:2,last7:2,last30:8 },screen:{ today:0,last7:0,last30:5 },tab:{ today:3,last7:7,last30:7 } });
  assert.deepEqual([result.performance.today,result.performance.last7,result.performance.last30], [2,2,5]);
  assert.equal(result.categories.length, analytics.PAGE_CATEGORIES.length);
  assert.equal(result.daily.length, 161);
  assert.equal(result.retentionDays, 161);
  assert.deepEqual(result.daily[0], { day:'2026-05-01',views:12,errors:0,web:12,mobile:0 });
  assert.equal(result.history.firstRecordedDay, '2026-05-01');
  assert.equal(result.history.lastRecordedDay, '2026-10-08');
  assert.equal(result.categories.find(row => row.category === 'settings_data').daily.find(row => row.day === '2026-09-08').views, 7);
  assert.deepEqual(result.daily.at(-1), { day:'2026-10-08',views:5,errors:2,web:5,mobile:0 });
  assert.ok(result.daily.some(day => day.views === 0));
  const row = result.categories.find(row => row.category === 'command_center_media');
  assert.equal(row.last30, 3); assert.equal(row.errors.last30, 2);
  assert.deepEqual(row.daily.at(-1), { day:'2026-10-08',views:3,errors:2 });
  assert.equal(row.firstRecordedDay, '2026-10-08');
  const zero = result.categories.find(row => row.category === 'saved_posts');
  assert.deepEqual([zero.today,zero.last7,zero.last30], [0,0,0]);
  assert.equal(zero.firstRecordedDay, null);
  assert.ok(zero.daily.every(day => day.views === 0 && day.errors === 0));
  assert.equal(result.storage.acknowledgement, 'after-durable-write');
  assert.equal(result.storage.status, 'ready');
  assert.equal(result.verification.status, 'verified');
  assert.equal(result.verification.mismatchCount, 0);
  assert.equal(result.performance.byCode.find(row => row.code === 'request_failed').last7, 0);
  assert.deepEqual(result.performance.details, [
    { day: '2026-10-01', category: 'app_feed', code: 'request_failed', count: 3 },
    { day: '2026-10-08', category: 'command_center_media', code: 'render_error', count: 2 },
  ]);
  assert.equal((await pg.query("SELECT count(*)::int AS count FROM analytics_daily_counts WHERE day='2026-09-08'")).rows[0].count, 1);
  assert.equal((await pg.query("SELECT count(*)::int AS count FROM analytics_daily_counts WHERE day='2026-04-30'")).rows[0].count, 0);
});

test('scheduled verification reads canonical snapshots without mutating events or counting buckets as views', async t => {
  const pg = new PGlite(); await pg.exec(analytics.ANALYTICS_SCHEMA); t.after(() => pg.close());
  await pg.exec(`INSERT INTO analytics_daily_counts VALUES
    ('2026-10-27','home','page_view','',45),
    ('2026-10-27','command_center_media','page_view','',99),
    ('2026-10-27','home','client_error','script_error',3);
    INSERT INTO analytics_history_daily_counts(source,day,category,event_count) VALUES
    ('legacy_page_views_backup','2026-08-12','home',70);
    CREATE TABLE page_views(path TEXT);
    INSERT INTO page_views VALUES ('private historical path already represented by recovered totals');`);
  const queries = [], scheduled = [];
  const service = analytics.createAggregateAnalytics({ db: { isConnected: () => true, query(sql, params) {
    queries.push(sql); return pg.query(sql, params);
  } }, now: () => Date.parse('2026-10-27T12:00:00Z'), schedule(fn, ms) { scheduled.push({ fn, ms }); } });
  assert.ok(scheduled.some(timer => timer.ms === 60_000));
  const status = await service.verification.run();
  assert.equal(status.status, 'verified');
  assert.deepEqual(status.metrics, { bucketRows: 4, liveBucketRows: 3, historyBucketRows: 1,
    viewsToday: 144, allViews: 214, pageViewsToday: 45, screenViewsToday: 0, tabViewsToday: 99,
    restoredViews: 70, invalidRows: 0 });
  assert.equal(queries.length, 1, 'report input and independent SQL totals use one snapshot');
  assert.ok(queries.every(sql => !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/.test(sql)));
  assert.ok(queries.every(sql => !/FROM page_views\b/.test(sql)), 'raw legacy views are not counted a second time');
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM page_views')).rows[0].count, 1);
});

test('verification exposes unknown stored categories as a mismatch without leaking or repairing the row', async t => {
  const pg = new PGlite(); await pg.exec(analytics.ANALYTICS_SCHEMA); t.after(() => pg.close());
  await pg.exec('ALTER TABLE analytics_daily_counts DROP CONSTRAINT analytics_daily_counts_category_check');
  await pg.query("INSERT INTO analytics_daily_counts VALUES ('2026-10-27',$1,'page_view','',7)", ['private-identity-path']);
  const service = analytics.createAggregateAnalytics({ db: { isConnected: () => true, query: (...args) => pg.query(...args) },
    now: () => Date.parse('2026-10-27T12:00:00Z'), schedule() {} });
  const report = await service.verification.read();
  assert.equal(report.verification.status, 'mismatch');
  assert.equal(report.verification.metrics.invalidRows, 1);
  assert.ok(report.verification.mismatchCount > 0);
  assert.doesNotMatch(JSON.stringify(report), /private-identity-path/);
  assert.equal((await pg.query('SELECT event_count FROM analytics_daily_counts')).rows[0].event_count, 7);
});

test('successful collector receipts are durable across restart, including arrivals during retention', async t => {
  const pg = new PGlite(); await pg.exec(analytics.ANALYTICS_SCHEMA); t.after(() => pg.close());
  let releaseRetention; let reachedRetention;
  const retentionStarted = new Promise(resolve => { reachedRetention = resolve; });
  const retentionGate = new Promise(resolve => { releaseRetention = resolve; });
  let inserts = 0;
  const db = { isConnected: () => true, async query(sql, params) {
    if (sql.includes('INSERT INTO analytics_daily_counts')) inserts++;
    if (sql.startsWith('DELETE')) { reachedRetention(); await retentionGate; }
    return pg.query(sql, params);
  } };
  const metrics = analytics.createAggregateAnalytics({ db, now: () => Date.parse('2026-10-08T10:00:00Z'), schedule() {} });
  const first = response(); const firstPending = metrics.pageview({ body:{ category:'home' } }, first);
  await retentionStarted;
  const second = response(); const secondPending = metrics.pageview({ body:{ category:'command_center_crosspost' } }, second);
  assert.equal(first.statusCode, 200); assert.equal(second.statusCode, 200);
  releaseRetention(); await Promise.all([firstPending,secondPending]);
  assert.equal(first.statusCode, 204); assert.equal(second.statusCode, 204); assert.equal(inserts, 2);
  assert.equal((await pg.query('SELECT sum(event_count)::int AS total FROM analytics_daily_counts')).rows[0].total, 2);
  const afterRestart = analytics.createAggregateAnalytics({ db, now: () => Date.parse('2026-10-08T10:00:00Z'), schedule() {} });
  const result = response(); await afterRestart.report({}, result);
  assert.equal(result.body.today, 2);
  assert.equal(result.body.storage.collector.accepted, 0); // Process diagnostics are clearly separate from durable totals.
});

test('every registered category is accepted while identities, free text and excluded categories are rejected', async t => {
  const pg = new PGlite(); await pg.exec(analytics.ANALYTICS_SCHEMA); t.after(() => pg.close());
  const metrics = analytics.createAggregateAnalytics({ db:{ isConnected:() => true,query:(...args) => pg.query(...args) }, schedule() {} });
  await Promise.all(analytics.PAGE_CATEGORIES.map(async category => {
    const res = response(); await metrics.pageview({ body:{ category } }, res); assert.equal(res.statusCode, 204, category);
  }));
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM analytics_daily_counts')).rows[0].count, analytics.PAGE_CATEGORIES.length);
  for (const body of [{ category:'vault' },{ category:'app_vpn' },{ category:'home',platform:'private text' },{ category:'command_center_media',tab:'private-id' }]) {
    const res = response(); await metrics.pageview({ body }, res); assert.equal(res.statusCode, 400);
  }
  const res = response(); await metrics.report({}, res);
  assert.equal(res.body.storage.collector.accepted, analytics.PAGE_CATEGORIES.length);
  assert.equal(res.body.storage.collector.invalid, 4);
});

test('a long storage outage keeps a bounded aggregate buffer and exposes safe collector diagnostics', async () => {
  let clock = Date.parse('2026-10-08T10:00:00Z');
  const metrics = analytics.createAggregateAnalytics({ db:{ isConnected:() => true,
    async query() { throw new Error('private database credentials'); } }, now:() => clock, schedule() {} });
  for (let day = 0; day < 11; day++) {
    await Promise.all(analytics.PAGE_CATEGORIES.map(category => metrics.pageview({ body:{ category } }, response())));
    clock += 86400_000;
  }
  const res = response(); await metrics.report({}, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.available, false);
  assert.equal(res.body.storage.status, 'retrying');
  assert.equal(res.body.storage.pendingKeys, 1000);
  assert.equal(res.body.storage.pendingEvents, 1000);
  assert.equal(res.body.storage.collector.accepted, 0);
  assert.equal(res.body.storage.collector.rateLimited, analytics.PAGE_CATEGORIES.length * 11 - 1000);
  assert.ok(res.body.storage.collector.writeFailures > 0);
  assert.doesNotMatch(JSON.stringify(res.body), /private database credentials/);
});

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
  assert.equal((await app.request('/office/analytics/geography')).status, 401);
  const geography = await app.request('/office/analytics/geography', { headers: { 'x-office-token': 'analytics-test' } });
  assert.equal(geography.status, 200);
  assert.match(geography.headers.get('cache-control'), /private, no-store/);
  assert.equal(geography.data.total, 3); assert.equal(geography.data.unknownCountry, 3);
  assert.equal((await app.request('/office/analytics/geography?category=private-account', { headers: { 'x-office-token': 'analytics-test' } })).status, 400);
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

test('aggregate batching retries safely, bounds counts, and preserves May onward beyond rolling windows', async t => {
  const pg = new PGlite(); await pg.exec(analytics.ANALYTICS_SCHEMA); t.after(() => pg.close());
  let fail = true; let inserts = 0; let clock = Date.parse('2026-09-20T10:00:00Z'); let timer;
  const db = { isConnected: () => true, async query(sql, params) {
    if (sql.includes('INSERT INTO analytics_daily_counts')) { inserts++; if (fail) throw new Error('private connection information'); }
    return pg.query(sql, params);
  } };
  const metrics = analytics.createAggregateAnalytics({ db, now: () => clock, schedule(fn) { timer = fn; } });
  const received = Array.from({ length: 100 }, () => {
    const res = response(); return { res, pending: metrics.pageview({ body: { category: 'home' } }, res) };
  });
  assert.equal(inserts, 0);
  await Promise.all(received.map(value => value.pending));
  assert.ok(received.every(value => value.res.statusCode === 503));
  fail = false; assert.equal(await metrics.flush(), true);
  assert.equal(Number((await pg.query('SELECT event_count FROM analytics_daily_counts')).rows[0].event_count), 100);
  assert.equal(inserts, 2);
  await pg.exec("CREATE TABLE page_views (path TEXT); INSERT INTO page_views VALUES ('legacy-private-history');");
  clock += 30 * 86400_000;
  await metrics.pageview({ body: { category: 'home' } }, response());
  await metrics.flush();
  const rows = (await pg.query('SELECT day::text, event_count FROM analytics_daily_counts')).rows;
  assert.deepEqual(rows.map(row => ({ day: row.day, count: Number(row.event_count) })).sort((a,b) => a.day.localeCompare(b.day)), [{ day: '2026-09-20', count: 100 }, { day: '2026-10-20', count: 1 }]);
  assert.equal((await pg.query('SELECT path FROM page_views')).rows[0].path, 'legacy-private-history');
  assert.equal(typeof timer, 'function');
  await Promise.all(Array.from({ length: 5999 }, () => metrics.pageview({ body: { category: 'home' } }, response())));
  const limited = response(); metrics.pageview({ body: { category: 'home' } }, limited); assert.equal(limited.statusCode, 429);
  await metrics.flush();
  clock += 30 * 86400_000;
  await metrics.flush(); // No new events: historical totals still survive cleanup.
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM analytics_daily_counts')).rows[0].count, 2);
  const history = response(); await metrics.report({}, history);
  assert.equal(history.body.last30, 0);
  assert.equal(history.body.daily.find(row => row.day === '2026-09-20').views, 100);
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
  assert.equal((await app.request('/vpn/config', { userId: 'vpn-metrics-test' })).status, 401);
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
