'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { ANALYTICS_SCHEMA, createAggregateAnalytics } = require('./aggregate-analytics');
const { createAppHarness } = require('./test-support/app-harness');

function response() {
  return { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }, end() { return this; } };
}
const windows = asOf => ({
  past24h: { from: new Date(Date.parse(asOf) - 86400_000).toISOString(), to: asOf },
  today: { from: '2026-11-04T08:00:00.000Z', to: asOf },
  week: { from: '2026-11-02T08:00:00.000Z', to: asOf },
});

test('minute analytics measures web/app windows through the completed minute without inventing older daily history', async t => {
  const pg = new PGlite(); t.after(() => pg.close()); await pg.exec(ANALYTICS_SCHEMA);
  let clock = Date.parse('2026-11-04T09:14:20Z');
  const db = { isConnected: () => true, query: (...args) => pg.query(...args) };
  const metrics = createAggregateAnalytics({ db, now: () => clock, schedule() {} });
  await pg.exec("INSERT INTO analytics_daily_counts VALUES('2026-11-03','home','page_view','',500)");
  await metrics.pageview({ body: { category: 'home' } }, response()); // First partial minute is excluded.
  clock = Date.parse('2026-11-04T09:15:03Z');
  await metrics.pageview({ body: { category: 'home' } }, response());
  await metrics.pageview({ body: { category: 'app_feed' } }, response());
  await metrics.performance({ body: { kind: 'client_error', category: 'app_feed', code: 'render_error' } }, response());
  clock = Date.parse('2026-11-04T09:16:10Z');
  await metrics.pageview({ body: { category: 'home' } }, response()); // Current incomplete minute excluded.
  const asOf = '2026-11-04T09:16:00.000Z';
  const result = await metrics.welcomeSnapshot({ windows: windows(asOf), asOf });
  assert.equal(result.available, true);
  assert.equal(result.availableFrom, '2026-11-04T09:15:00.000Z');
  assert.deepEqual(result.windows.past24h.web, { views: 1, clientErrors: 0 });
  assert.deepEqual(result.windows.past24h.mobile, { views: 1, clientErrors: 1 });
  assert.equal(result.windows.past24h.complete, false);
  assert.equal(result.windows.past24h.views, 2);
  assert.equal(result.windows.past24h.clientErrors, 1);
  assert.equal(result.windows.week.views, 2);
  assert.equal(result.windows.today.views, 2);
  const persisted = (await pg.query('SELECT * FROM analytics_minute_counts ORDER BY minute,platform,kind')).rows;
  assert.deepEqual(Object.keys(persisted[0]).sort(), ['event_count', 'kind', 'minute', 'platform']);
  assert.equal(persisted.length, 5);
  const restarted = createAggregateAnalytics({ db, now: () => clock + 1000, schedule() {} });
  assert.equal((await restarted.welcomeSnapshot({ windows: windows(asOf), asOf })).availableFrom, result.availableFrom);
  // Availability becomes complete once the measured window lies inside coverage.
  const covered = await restarted.welcomeSnapshot({ windows: { today: { from: result.availableFrom, to: asOf } }, asOf });
  assert.equal(covered.windows.today.complete, true);
});

test('minute projection rolls back with daily failure, retries once and preserves a shared coverage start', async t => {
  const pg = new PGlite(); t.after(() => pg.close()); await pg.exec(ANALYTICS_SCHEMA);
  let clock = Date.parse('2026-11-04T09:14:00Z');
  const db = { isConnected: () => true, query: (...args) => pg.query(...args) };
  const metrics = createAggregateAnalytics({ db, now: () => clock, schedule() {} });
  await pg.exec("ALTER TABLE analytics_daily_counts ADD CONSTRAINT reject_fixture CHECK(event_count < 1)");
  const res = response(); await metrics.pageview({ body: { category: 'home' } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM analytics_minute_counts')).rows[0].count, 0);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM analytics_minute_coverage')).rows[0].count, 0);
  await pg.exec('ALTER TABLE analytics_daily_counts DROP CONSTRAINT reject_fixture');
  assert.equal(await metrics.flush(), true);
  assert.equal(Number((await pg.query('SELECT SUM(event_count) AS count FROM analytics_minute_counts')).rows[0].count), 1);
  assert.equal(Number((await pg.query('SELECT SUM(event_count) AS count FROM analytics_daily_counts')).rows[0].count), 1);
  clock += 60_000;
  const asOf = new Date(clock).toISOString();
  const result = await metrics.welcomeSnapshot({ windows: { past24h: { from: '2026-11-04T09:14:00.000Z', to: asOf } }, asOf });
  assert.equal(result.available, true);
  assert.equal(result.windows.past24h.views, 1);
  assert.equal(result.windows.past24h.complete, true);
});

test('verified empty windows return zero while failed storage and invalid windows never become zero totals', async t => {
  const pg = new PGlite(); t.after(() => pg.close()); await pg.exec(ANALYTICS_SCHEMA);
  let connected = true, failed = false;
  const now = () => Date.parse('2026-11-04T09:16:00Z');
  const metrics = createAggregateAnalytics({ db: { isConnected: () => connected, query(...args) {
    if (failed) throw new Error('private storage credential');
    return pg.query(...args);
  } }, now, schedule() {} });
  const asOf = new Date(now()).toISOString();
  const input = { windows: { today: { from: asOf, to: asOf } }, asOf };
  const empty = await metrics.welcomeSnapshot(input);
  assert.equal(empty.available, true);
  assert.equal(empty.windows.today.complete, true);
  assert.equal(empty.windows.today.views, 0);
  failed = true;
  const outage = await metrics.welcomeSnapshot(input);
  assert.equal(outage.available, false);
  assert.deepEqual(outage.windows, {});
  assert.doesNotMatch(JSON.stringify(outage), /private storage credential/);
  connected = false;
  assert.equal((await metrics.welcomeSnapshot(input)).available, false);
  connected = true; failed = false;
  for (const invalid of [
    { ...input, asOf: '2026-11-04T09:16:30.000Z' },
    { ...input, asOf: '2026-11-04T09:17:00.000Z' },
    { ...input, windows: { today: { from: 'broken', to: asOf } } },
    { ...input, windows: { today: { from: '2026-11-04T09:17:00.000Z', to: asOf } } },
  ]) assert.equal((await metrics.welcomeSnapshot(invalid)).available, false);
});

test('minute retention bounds storage while daily history survives and expired windows disclose partial coverage', async t => {
  const pg = new PGlite(); t.after(() => pg.close()); await pg.exec(ANALYTICS_SCHEMA);
  let clock = Date.parse('2026-10-20T09:00:00Z');
  const metrics = createAggregateAnalytics({ db: { isConnected: () => true, query: (...args) => pg.query(...args) }, now: () => clock, schedule() {} });
  await metrics.pageview({ body: { category: 'home' } }, response());
  clock = Date.parse('2026-11-04T09:16:00Z');
  await metrics.pageview({ body: { category: 'app_feed' } }, response());
  assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM analytics_minute_counts')).rows[0].count, 1);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM analytics_daily_counts')).rows[0].count, 2);
  const asOf = new Date(clock).toISOString();
  const result = await metrics.welcomeSnapshot({ windows: { week: { from: '2026-10-20T00:00:00.000Z', to: asOf } }, asOf });
  assert.equal(result.available, true);
  assert.equal(result.availableFrom, '2026-10-25T09:16:00.000Z');
  assert.equal(result.windows.week.complete, false);
  assert.equal(result.windows.week.views, 0);
});

test('rolling and local windows include the lower bound and exclude the as-of minute', async t => {
  const pg = new PGlite(); t.after(() => pg.close()); await pg.exec(ANALYTICS_SCHEMA);
  await pg.exec(`INSERT INTO analytics_minute_coverage VALUES(1,'2026-11-01T00:00:00Z');
    INSERT INTO analytics_minute_counts VALUES
      ('2026-11-03T09:15:00Z','web','page_view',1000),
      ('2026-11-03T09:16:00Z','web','page_view',3),
      ('2026-11-04T07:59:00Z','mobile','page_view',5),
      ('2026-11-04T08:00:00Z','web','client_error',2),
      ('2026-11-04T09:15:00Z','web','page_view',7),
      ('2026-11-04T09:16:00Z','web','page_view',500);`);
  const metrics = createAggregateAnalytics({ db: { isConnected: () => true, query: (...args) => pg.query(...args) },
    now: () => Date.parse('2026-11-04T09:16:10Z'), schedule() {} });
  const asOf = '2026-11-04T09:16:00.000Z';
  const result = await metrics.welcomeSnapshot({ windows: windows(asOf), asOf });
  assert.equal(result.available, true);
  assert.deepEqual(Object.values(result.windows).map(value => value.complete), [true, true, true]);
  assert.equal(result.windows.past24h.views, 15);
  assert.equal(result.windows.today.views, 7);
  assert.equal(result.windows.week.views, 1015);
  for (const value of Object.values(result.windows)) assert.equal(value.clientErrors, 2);
});

test('an idle collector persists its coverage before restart without fabricating old views', async t => {
  const pg = new PGlite(); t.after(() => pg.close()); await pg.exec(ANALYTICS_SCHEMA);
  let clock = Date.parse('2026-11-04T09:14:20Z');
  const db = { isConnected: () => true, query: (...args) => pg.query(...args) };
  const first = createAggregateAnalytics({ db, now: () => clock, schedule() {} });
  assert.equal(await first.flush(), true);
  clock = Date.parse('2026-11-04T09:16:00Z');
  const restarted = createAggregateAnalytics({ db, now: () => clock, schedule() {} });
  const asOf = new Date(clock).toISOString();
  const result = await restarted.welcomeSnapshot({ windows: { today: { from: '2026-11-04T09:15:00.000Z', to: asOf } }, asOf });
  assert.equal(result.available, true);
  assert.equal(result.availableFrom, '2026-11-04T09:15:00.000Z');
  assert.equal(result.windows.today.complete, true);
  assert.equal(result.windows.today.views, 0);
});

test('disabled Pipeline collection preserves daily/geography totals without starting or extending API minute history', async t => {
  const pg = new PGlite(); t.after(() => pg.close()); await pg.exec(ANALYTICS_SCHEMA);
  let clock = Date.parse('2026-11-04T09:00:20Z');
  const db = { isConnected: () => true, query: (...args) => pg.query(...args) };
  const pipeline = createAggregateAnalytics({ db, now: () => clock, schedule() {}, rollingEnabled: false,
    env: { CF_VISITOR_LOCATION_HEADERS: 'true' } });
  assert.equal(await pipeline.flush(), true); // Idle startup must not claim API coverage.
  const request = { body: { category: 'home' }, socket: { remoteAddress: '173.245.48.20' },
    headers: { 'cf-ipcountry': 'US', 'cf-ipcity': 'Portland', 'cf-region': 'Oregon' } };
  const res = response(); await pipeline.pageview(request, res);
  assert.equal(res.statusCode, 204);
  assert.equal(Number((await pg.query('SELECT SUM(event_count) AS count FROM analytics_daily_counts')).rows[0].count), 1);
  assert.equal(Number((await pg.query('SELECT SUM(event_count) AS count FROM analytics_geography_daily_counts')).rows[0].count), 1);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM analytics_minute_counts')).rows[0].count, 0);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM analytics_minute_coverage')).rows[0].count, 0);
  clock = Date.parse('2026-11-04T09:16:20Z');
  const asOf = '2026-11-04T09:16:00.000Z';
  const unavailable = await pipeline.welcomeSnapshot({ windows: windows(asOf), asOf });
  assert.equal(unavailable.available, false);
  assert.deepEqual(unavailable.windows, {});
  assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM analytics_minute_coverage')).rows[0].count, 0);
  const api = createAggregateAnalytics({ db, now: () => clock, schedule() {} });
  assert.equal(await api.flush(), true);
  const marker = (await pg.query('SELECT available_from FROM analytics_minute_coverage')).rows[0].available_from;
  assert.equal(new Date(marker).toISOString(), '2026-11-04T09:17:00.000Z');
  clock += 2 * 60_000;
  await pipeline.pageview(request, response());
  assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM analytics_minute_counts')).rows[0].count, 0);
  assert.equal(new Date((await pg.query('SELECT available_from FROM analytics_minute_coverage')).rows[0].available_from).toISOString(), '2026-11-04T09:17:00.000Z');
  await api.pageview({ body: { category: 'app_feed' } }, response());
  assert.equal(Number((await pg.query('SELECT SUM(event_count) AS count FROM analytics_minute_counts')).rows[0].count), 1);
  assert.equal(Number((await pg.query('SELECT SUM(event_count) AS count FROM analytics_daily_counts')).rows[0].count), 3);
});

test('service runtime enables minute instrumentation only on API', async t => {
  for (const role of ['api', 'pipeline']) {
    let enabled;
    const app = await createAppHarness({ env: { SERVICE_ROLE: role }, modules: {
      './aggregate-analytics': { ...require('./aggregate-analytics'), createAggregateAnalytics(options) {
        enabled = options.rollingEnabled;
        return createAggregateAnalytics(options);
      } },
    } });
    t.after(() => app.close());
    assert.equal(enabled, role === 'api', role);
  }
});
