'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { analyticsGeography, CITY_LIMIT } = require('./analytics-geography');
const { createAggregateAnalytics, ANALYTICS_SCHEMA } = require('./aggregate-analytics');

const req = (country = 'US', city = 'Portland', region = 'Oregon') => ({
  socket: { remoteAddress: '173.245.48.20' },
  headers: { 'cf-ipcountry': country, 'cf-ipcity': city, 'cf-region': region,
    'cf-iplatitude': '45.5', 'cf-iplongitude': '-122.6', cookie: 'private-cookie', authorization: 'Bearer private-token' },
  body: { category: 'home' },
});
const response = () => ({ statusCode: 200, set() {}, status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }, end() { return this; } });

test('analytics accepts only verified coarse country/city, ignores device coordinates and rejects client-spoofed headers', () => {
  assert.deepEqual(analyticsGeography(req(), {}), { country: 'US', city: '', region: '' });
  assert.deepEqual(analyticsGeography(req('us', 'New+York', 'New+York'), { CF_VISITOR_LOCATION_HEADERS: 'true' }),
    { country: 'US', city: 'New York', region: 'New York' });
  const forged = req(); forged.socket.remoteAddress = '203.0.113.20';
  assert.deepEqual(analyticsGeography(forged, { CF_VISITOR_LOCATION_HEADERS: 'true' }), { country: '', city: '', region: '' });
  assert.deepEqual(analyticsGeography(req('XX'), { CF_VISITOR_LOCATION_HEADERS: 'true' }), { country: '', city: '', region: '' });
  assert.equal(analyticsGeography(req('US', 'private@example.invalid'), { CF_VISITOR_LOCATION_HEADERS: 'true' }).city, '');
  assert.equal(analyticsGeography(req('FR', 'Saint-%C3%89tienne', 'Auvergne-Rh%C3%B4ne-Alpes'), { CF_VISITOR_LOCATION_HEADERS: 'true' }).city, 'Saint-Étienne');
  assert.equal(analyticsGeography(req('US', 'ﬃ'.repeat(40)), { CF_VISITOR_LOCATION_HEADERS: 'true' }).city, '', 'Normalization expansion cannot violate the storage bound');
});

async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close()); await pg.exec(ANALYTICS_SCHEMA);
  const options = { db: { isConnected: () => true, query: (...args) => pg.query(...args) },
    now: () => Date.parse('2026-10-13T12:00:00Z'), schedule() {}, env: { CF_VISITOR_LOCATION_HEADERS: 'true' } };
  return { pg, options, metrics: createAggregateAnalytics(options) };
}

test('batched cities reconcile with main counts, preserve same-named regions and never retain identities', async t => {
  const { pg, options, metrics } = await fixture(t);
  const requests = [req(), req(), req('US', 'Portland', 'Maine'), req('GB', 'London', 'England'), req('CA', '', '')];
  const unknown = req(); unknown.socket.remoteAddress = '203.0.113.20'; requests.push(unknown);
  const diagnostic = req(); diagnostic.body = { category: 'home', kind: 'client_error', code: 'request_failed' };
  await Promise.all(requests.map(async request => {
    const res = response(); await metrics.pageview(request, res); assert.equal(res.statusCode, 204);
  }));
  await metrics.performance(diagnostic, response());
  const saved = (await pg.query('SELECT * FROM analytics_geography_daily_counts')).rows;
  assert.equal(saved.length, 4);
  assert.equal(saved.reduce((sum, row) => sum + Number(row.event_count), 0), 5);
  assert.deepEqual(Object.keys(saved[0]).sort(), ['category', 'city', 'country', 'day', 'event_count', 'region']);
  assert.doesNotMatch(JSON.stringify(saved), /173\.245|203\.0|45\.5|122\.6|private-|authorization|cookie/);
  const res = response(); await createAggregateAnalytics(options).report({}, res);
  assert.equal(res.body.today, 6);
  assert.equal(res.body.performance.today, 1);
  assert.equal('geography' in res.body, false, 'The general report never serializes raw geographic history');
  const geo = response(); await metrics.geography({}, geo);
  assert.equal(geo.body.countries.length, 3);
  assert.equal(geo.body.cities.length, 3);
  assert.equal(geo.body.firstRecordedDay, '2026-10-13');
  assert.equal(geo.body.countries.find(row => row.country === 'GB').label, 'United Kingdom');
  assert.equal(geo.body.cities.find(row => row.region === 'Oregon').views, 2);
  assert.equal(geo.body.total, 6); assert.equal(geo.body.unknownCountry, 1); assert.equal(geo.body.unknownCity, 2);
});

test('geography storage failure rolls back all counts and retry commits exactly once', async t => {
  const { pg, metrics } = await fixture(t);
  await pg.exec("ALTER TABLE analytics_geography_daily_counts ADD CONSTRAINT simulated_storage_failure CHECK (country <> 'US')");
  const res = response(); await metrics.pageview(req(), res);
  assert.equal(res.statusCode, 503);
  assert.equal((await pg.query('SELECT count(*)::int AS total FROM analytics_daily_counts')).rows[0].total, 0);
  assert.equal((await pg.query('SELECT count(*)::int AS total FROM analytics_geography_daily_counts')).rows[0].total, 0);
  await pg.exec('ALTER TABLE analytics_geography_daily_counts DROP CONSTRAINT simulated_storage_failure');
  assert.equal(await metrics.flush(), true);
  assert.equal(await metrics.flush(), true);
  assert.equal(Number((await pg.query('SELECT event_count FROM analytics_daily_counts')).rows[0].event_count), 1);
  assert.equal(Number((await pg.query('SELECT event_count FROM analytics_geography_daily_counts')).rows[0].event_count), 1);
});

test('missing and historical geography remains unknown and explicit client location is rejected', async t => {
  const { pg, metrics } = await fixture(t);
  await pg.exec("INSERT INTO analytics_daily_counts VALUES ('2026-05-01','home','page_view','',7)");
  const request = req(); request.body.country = 'US';
  const rejected = response(); await metrics.pageview(request, rejected); assert.equal(rejected.statusCode, 400);
  const res = response(); await metrics.report({}, res);
  assert.equal(res.body.categories.find(row => row.category === 'home').daily[0].views, 7);
  const geo = response(); await metrics.geography({}, geo);
  assert.deepEqual(geo.body.countries, []);
  assert.equal(geo.body.firstRecordedDay, null);
  assert.equal(geo.body.unknownCountry, 7); assert.equal(geo.body.unknownCity, 7);
});

test('geography applies dates/platform/category/type in SQL and rejects invalid filters without querying storage', async t => {
  const { pg, metrics, options } = await fixture(t);
  await pg.exec(`INSERT INTO analytics_daily_counts VALUES
    ('2026-10-12','home','page_view','',5), ('2026-10-13','app_feed','page_view','',4),
    ('2026-10-13','command_center_accounts','page_view','',3);
    INSERT INTO analytics_geography_daily_counts VALUES
    ('2026-10-12','home','US','Portland','Oregon',2), ('2026-10-12','home','US','portland','oregon',3),
    ('2026-10-13','app_feed','GB','London','England',4), ('2026-10-13','command_center_accounts','CA','','',3);`);
  for (const [query, expected] of [
    [{ platform: 'mobile' }, [4, 'GB', 1]],
    [{ category: 'home', to: '2026-10-12' }, [5, 'US', 1]],
    [{ platform: 'web', viewType: 'tab', from: '2026-10-13' }, [3, 'CA', 0]],
  ]) {
    const res = response(); await metrics.geography({ query }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.total, expected[0]);
    assert.equal(res.body.countries[0].country, expected[1]); assert.equal(res.body.cities.length, expected[2]);
    assert.equal(res.body.unknownCountry, 0);
  }
  const forbiddenDb = createAggregateAnalytics({ ...options, db: { isConnected: () => true, query: () => { throw new Error('Must not reach DB'); } } });
  for (const query of [{ from: '2026-02-30' }, { from: '2026-01-01' }, { to: '2099-01-01' }, { from: '2026-10-13', to: '2026-10-12' },
    { platform: 'private' }, { category: "home' OR 1=1 --" }, { category: '__proto__' }, { viewType: 'private' }, { from: ['2026-05-01'] }]) {
    const res = response(); await forbiddenDb.geography({ query }, res); assert.equal(res.statusCode, 400);
  }
});

test('city report stays bounded with exact country, omitted-city and unknown counts', async t => {
  const { pg, metrics } = await fixture(t), cityCount = CITY_LIMIT + 7;
  await pg.query(`INSERT INTO analytics_geography_daily_counts
    SELECT '2026-10-13'::date,'home','US','Town ' || n::text,'Region',10 FROM generate_series(1,$1::integer) n`, [cityCount]);
  await pg.query("INSERT INTO analytics_daily_counts VALUES ('2026-10-13','home','page_view','',$1)", [cityCount * 10 + 9]);
  const res = response(); await metrics.geography({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.countries[0].views, cityCount * 10);
  assert.equal(res.body.cities.length, CITY_LIMIT); assert.equal(res.body.cityCount, cityCount);
  assert.equal(res.body.otherCityViews, 70); assert.equal(res.body.unknownCountry, 9); assert.equal(res.body.unknownCity, 9);
  assert.equal(res.body.cities.reduce((sum, row) => sum + row.views, 0) + res.body.otherCityViews + res.body.unknownCity, res.body.total);
  assert.ok(JSON.stringify(res.body).length < 250000, 'Payload is bounded independently of history size');
});
