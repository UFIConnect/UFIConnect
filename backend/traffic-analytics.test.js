'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrafficAnalytics, TRAFFIC_ANALYTICS_SCHEMA } = require('./traffic-analytics');
const { PGlite } = require('@electric-sql/pglite');

const accountId = 'a'.repeat(32), zoneId = 'b'.repeat(32), token = 'private-test-credential-never-returned';
const start = Date.parse('2026-11-05T04:00:00Z');
const env = () => ({ CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: token });
const row = (date, requests, pageViews, uniques) => ({ dimensions: { date }, sum: { requests, pageViews, threats: 1 }, uniq: { uniques } });
const data = rows => ({ data: { viewer: { zones: [{ httpRequests1dGroups: rows }] } } });
const zone = overrides => ({ success: true, result: [{ id: zoneId, name: 'uficonnect.org', account: { id: accountId }, ...overrides }] });
const response = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
async function read(service, query = {}) {
  const res = { statusCode: 200, headers: {}, set(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await service.report({ query }, res); return res;
}

test('launch traffic preserves missing dates and keeps daily IPs separate from people and first-party opens', async () => {
  const calls = [];
  const service = createTrafficAnalytics({ env: env(), now: () => start, fetcher: async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    return response(url.endsWith('/graphql') ? data([row('2026-05-25', 30, 10, 7), row('2026-11-04', 50, 12, 7)]) : zone());
  } });
  const result = await read(service);
  assert.equal(result.statusCode, 200); assert.equal(result.body.status, 'fresh');
  assert.deepEqual(result.body.totals, { requests: 80, pageViews: 22, threats: 2, uniqueVisitors: null });
  assert.equal(result.body.monthly.length, 2); assert.equal(result.body.monthly[0].uniqueVisitors, null);
  assert.equal(result.body.daily[0].uniqueIPs, 7); assert.equal(result.body.daily[1].uniqueIPs, 7);
  assert.equal(result.body.coverage.firstRecordedDay, '2026-05-25');
  assert.ok(result.body.coverage.missingDays.includes('2026-05-01'));
  assert.equal(result.body.coverage.complete, false); assert.equal(result.body.coverage.observedDays, 2);
  assert.match(result.body.definitions.comparison, /must not be added/);
  const graphql = JSON.parse(calls[1].options.body);
  assert.deepEqual(graphql.variables, { zone: zoneId, from: '2026-05-01', to: '2026-11-05' });
  assert.doesNotMatch(JSON.stringify(result.body), new RegExp(token));
  assert.equal(result.headers['Cache-Control'], 'no-store');
});

test('concurrent readers share a fetch, fresh results cache for five minutes, and failed refresh returns timestamped stale data', async () => {
  let clock = start, calls = 0, fail = false, refreshes = 0;
  const service = createTrafficAnalytics({ env: env(), now: () => clock, refreshConnections: async () => { refreshes++; },
    fetcher: async url => { calls++; await Promise.resolve(); if (fail) return new Response('provider secret body', { status: 503 });
      return response(url.endsWith('/graphql') ? data([row('2026-11-04', 10, 5, 2)]) : zone()); } });
  const results = await Promise.all(Array.from({ length: 8 }, () => read(service)));
  assert.equal(calls, 2); assert.equal(refreshes, 8);
  assert.ok(results.every(result => result.body.totals.requests === 10));
  const saved = results[0].body.generatedAt;
  clock += 299999; assert.equal((await read(service)).body.status, 'cached'); assert.equal(calls, 2);
  clock += 2; fail = true;
  const stale = await read(service);
  assert.equal(stale.body.status, 'stale'); assert.equal(stale.body.generatedAt, saved);
  assert.equal(stale.body.cache.ageMs, 300001); assert.equal(stale.body.reason, 'source_unavailable');
  assert.doesNotMatch(JSON.stringify(stale.body), /provider secret body/);
  await read(service); assert.equal(calls, 3, 'Failed provider refresh is also throttled.');
});

test('wrong zone or account never reaches GraphQL and arbitrary requested hosts are rejected', async () => {
  for (const overrides of [{ name: 'unrelated.example' }, { account: { id: 'c'.repeat(32) } }, { id: 'not-a-zone-id' }]) {
    let calls = 0;
    const service = createTrafficAnalytics({ env: env(), now: () => start, fetcher: async () => { calls++; return response(zone(overrides)); } });
    const result = await read(service);
    assert.equal(result.statusCode, 503); assert.equal(result.body.reason, 'zone_unavailable'); assert.equal(calls, 1);
    const injected = await read(service, { zone: 'unrelated.example' }); assert.equal(injected.statusCode, 400); assert.equal(calls, 1);
  }
});

test('disconnect or credential rotation cannot reuse another connection cached data', async () => {
  const config = env(); let clock = start, calls = 0;
  const service = createTrafficAnalytics({ env: config, now: () => clock, fetcher: async (url, options) => {
    calls++; if (options.headers.Authorization !== `Bearer ${token}`) return new Response('', { status: 403 });
    return response(url.endsWith('/graphql') ? data([row('2026-11-04', 10, 5, 2)]) : zone());
  } });
  await read(service); assert.equal(calls, 2);
  config.CLOUDFLARE_API_TOKEN = '';
  assert.equal((await read(service)).body.reason, 'configuration_missing'); assert.equal(calls, 2);
  config.CLOUDFLARE_API_TOKEN = 'different-private-credential'; clock += 1;
  const rotated = await read(service);
  assert.equal(rotated.body.available, false); assert.equal(rotated.body.reason, 'permissions_required');
  assert.equal(rotated.body.totals, undefined); assert.equal(calls, 3);
});

test('disconnecting while a provider request is in flight cannot publish its result into the cache', async () => {
  const config = env(); let release, entered;
  const waiting = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const service = createTrafficAnalytics({ env: config, now: () => start, fetcher: async url => {
    if (!url.endsWith('/graphql')) return response(zone());
    entered(); await waiting; return response(data([row('2026-11-04', 10, 5, 2)]));
  } });
  const request = read(service); await started;
  config.CLOUDFLARE_API_TOKEN = ''; release();
  const result = await request;
  assert.equal(result.body.available, false); assert.equal(result.body.reason, 'connection_changed');
  assert.equal(result.body.totals, undefined);
  assert.equal((await read(service)).body.reason, 'configuration_missing');
});

test('GraphQL failures and malformed or duplicate daily rows never become valid traffic', async () => {
  for (const invalid of [
    { errors: [{ message: `private response ${token}` }], ...data([]) },
    data([row('2026-11-04', -1, 1, 1)]),
    data([row('2026-02-30', 1, 1, 1)]),
    data([row('2026-11-06', 1, 1, 1)]),
    data([row('2026-11-04', 1, 1, 1), row('2026-11-04', 1, 1, 1)]),
    data([row('2026-11-04', Number.MAX_SAFE_INTEGER + 1, 1, 1)]),
  ]) {
    const service = createTrafficAnalytics({ env: env(), now: () => start,
      fetcher: async url => response(url.endsWith('/graphql') ? invalid : zone()) });
    const result = await read(service);
    assert.equal(result.statusCode, 503); assert.equal(result.body.available, false);
    assert.equal(result.body.totals, undefined); assert.doesNotMatch(JSON.stringify(result.body), new RegExp(token));
  }
});

test('provider response size and date range stay bounded as launch history grows', async () => {
  let requests = [];
  const oversized = createTrafficAnalytics({ env: env(), now: () => start,
    fetcher: async () => new Response('x'.repeat(512 * 1024 + 1), { status: 200 }) });
  assert.equal((await read(oversized)).body.reason, 'response_too_large');
  const service = createTrafficAnalytics({ env: env(), now: () => Date.parse('2029-01-01T00:00:00Z'), fetcher: async (url, options) => {
    requests.push({ url, options }); return response(url.endsWith('/graphql') ? data([]) : zone());
  } });
  const result = await read(service);
  assert.equal((Date.parse(result.body.providerRange.to) - Date.parse(result.body.providerRange.from)) / 86400000 + 1, 400);
  assert.equal(result.body.coverage.requestedDays, 977); assert.equal(result.body.coverage.rangeLimited, false);
  assert.equal(result.body.coverage.requestedFrom, '2026-05-01'); assert.equal(result.body.totals.uniqueVisitors, null);
  assert.match(JSON.parse(requests[1].options.body).query, /limit: 400/);
});

test('durable exact-day upserts retain launch history when provider retention shrinks and retries never double count', async t => {
  const pg = new PGlite(); await pg.exec(TRAFFIC_ANALYTICS_SCHEMA); t.after(() => pg.close());
  let clock = start, recentOnly = false;
  const db = { isConnected: () => true, query: (...args) => pg.query(...args) };
  const fetcher = async url => response(url.endsWith('/graphql') ? data(recentOnly
    ? [row('2026-11-04', 40, 20, 9)]
    : [row('2026-05-25', 30, 10, 7), row('2026-11-04', 50, 12, 7)]) : zone());
  const service = createTrafficAnalytics({ db, env: env(), now: () => clock, fetcher });
  const initial = await read(service);
  assert.equal(initial.body.persistence.status, 'ready'); assert.equal(initial.body.persistence.durable, true);
  assert.equal(initial.body.persistence.storedDays, 2); assert.equal(initial.body.totals.requests, 80);
  clock += 300001; recentOnly = true;
  const retained = await read(service);
  assert.equal(retained.body.totals.requests, 70, 'Fresh exact day replaces 50 with 40; old 30 remains.');
  assert.equal(retained.body.coverage.firstRecordedDay, '2026-05-25');
  assert.equal(retained.body.coverage.providerObservedDays, 1); assert.equal(retained.body.coverage.recoveredDays, 1);
  assert.equal(retained.body.daily.find(day => day.day === '2026-11-04').uniqueIPs, 9);
  clock += 300001;
  assert.equal((await read(service)).body.totals.requests, 70, 'Same provider window is idempotent.');
  const stored = (await pg.query('SELECT COUNT(*)::int AS days,SUM(requests)::int AS requests FROM traffic_analytics_daily_counts')).rows[0];
  assert.deepEqual(stored, { days: 2, requests: 70 });
  await assert.rejects(pg.query("INSERT INTO traffic_analytics_daily_counts VALUES('cloudflare-zone-http','unrelated.example','2026-11-04',1,1,1,1,NOW())"));
});

test('a restarted process can show timestamped durable history during a provider outage without pretending it was refreshed', async t => {
  const pg = new PGlite(); await pg.exec(TRAFFIC_ANALYTICS_SCHEMA); t.after(() => pg.close());
  const db = { isConnected: () => true, query: (...args) => pg.query(...args) };
  await pg.query("INSERT INTO traffic_analytics_daily_counts VALUES('cloudflare-zone-http','uficonnect.org','2026-05-25',30,10,1,7,$1)", [new Date(start - 600000).toISOString()]);
  let calls = 0;
  const service = createTrafficAnalytics({ db, env: env(), now: () => start, fetcher: async () => { calls++; throw Error('private provider error'); } });
  const result = await read(service);
  assert.equal(result.body.available, true); assert.equal(result.body.status, 'stale');
  assert.equal(result.body.generatedAt, new Date(start - 600000).toISOString());
  assert.equal(result.body.coverage.providerObservedDays, 0); assert.equal(result.body.coverage.recoveredDays, 1);
  assert.equal(result.body.totals.requests, 30); assert.equal(result.body.totals.uniqueVisitors, null);
  assert.equal((await read(service)).body.status, 'stale'); assert.equal(calls, 1);
});

test('persistence failure preserves prior days and marks fresh provider values as not durably stored', async t => {
  const pg = new PGlite(); await pg.exec(TRAFFIC_ANALYTICS_SCHEMA); t.after(() => pg.close());
  await pg.query("INSERT INTO traffic_analytics_daily_counts VALUES('cloudflare-zone-http','uficonnect.org','2026-05-25',30,10,1,7,$1)", [new Date(start - 600000).toISOString()]);
  const db = { isConnected: () => true, query: (sql, params) => {
    if (sql.startsWith('INSERT')) throw Error('database secret connection error');
    return pg.query(sql, params);
  } };
  const service = createTrafficAnalytics({ db, env: env(), now: () => start,
    fetcher: async url => response(url.endsWith('/graphql') ? data([row('2026-11-04', 40, 20, 9)]) : zone()) });
  const result = await read(service);
  assert.equal(result.body.available, true); assert.equal(result.body.status, 'fresh');
  assert.equal(result.body.persistence.status, 'write_failed'); assert.equal(result.body.persistence.durable, false);
  assert.equal(result.body.totals.requests, 70); assert.equal(result.body.coverage.recoveredDays, 1);
  assert.doesNotMatch(JSON.stringify(result.body), /database secret/);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM traffic_analytics_daily_counts')).rows[0].count, 1);
  const disconnected = createTrafficAnalytics({ db: { isConnected: () => false, query: () => { throw Error('must not query disconnected DB'); } },
    env: env(), now: () => start, fetcher: async url => response(url.endsWith('/graphql') ? data([row('2026-11-04', 40, 20, 9)]) : zone()) });
  const withoutStorage = await read(disconnected);
  assert.equal(withoutStorage.body.totals.requests, 40); assert.equal(withoutStorage.body.persistence.status, 'unavailable');
});
