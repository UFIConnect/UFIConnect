'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const directory = require('./local-account-directory.json');
const { locationAccounts } = require('./account-location');
const { createAppHarness, member } = require('./test-support/app-harness');

const platforms = Object.fromEntries(['youtube', 'instagram', 'facebook', 'reddit', 'spotify', 'airbnb', 'booking',
  'indeed', 'linkedin', 'glassdoor', 'usajobs', 'ziprecruiter', 'reed', 'seek', 'naukri'].map(id => [id,
  { name: id, configured: false, category: ['indeed', 'glassdoor', 'usajobs', 'ziprecruiter', 'reed', 'seek', 'naukri'].includes(id) ? 'career' : 'social' }]));
const location = (city, country = 'US', region = 'California') => ({ city, country, region, available: true, mode: 'auto' });
const select = (context, extra = {}) => locationAccounts({ platforms, location: context, ...extra });
const localIds = report => report.localSources.map(source => source.id);

test('local sources have unique safe official destinations and cannot claim account or feed support', () => {
  const seen = new Set();
  for (const area of directory.areas) {
    assert.match(area.country, /^[A-Z]{2}$/);
    assert.ok(area.label && area.regions.length);
    const report = select(location(area.cities[0] || 'Unlisted city', area.country, area.regions[0]));
    for (const source of area.sources) {
      assert.match(source.id, /^local_[a-z0-9_]+$/);
      assert.equal(seen.has(source.id), false, source.id); seen.add(source.id);
      const url = new URL(source.siteUrl);
      assert.equal(url.protocol, 'https:');
      assert.equal(url.username + url.password + url.search + url.hash, '');
      assert.ok(source.name && source.description && source.icon);
      assert.match(source.color, /^#[a-f0-9]{6}$/i);
      const result = report.localSources.find(item => item.id === source.id);
      assert.ok(result, `${source.id} appears only when its geography matches`);
      assert.equal(result.connectionMode, 'external');
      assert.equal(result.configured, false); assert.equal(result.connected, false);
      assert.equal(result.authorizationSupported, false); assert.equal(result.loginUrl, null);
      assert.deepEqual(result.feed, { home: false, following: null });
      assert.deepEqual(result.crossPost, { supported: false });
      assert.deepEqual(result.ownContent, { supported: false });
      assert.deepEqual(result.localArea, { label: area.label, scope: area.scope, country: area.country });
    }
  }
  assert.ok(seen.size >= 28);
});

test('city-native sources and regional coverage match aliases without crossing country or region boundaries', () => {
  const cases = [
    [location('Los Angeles'), 'local_latimes'], [location('Hollywood'), 'local_laist'],
    [location('San Francisco'), 'local_sfstandard'], [location('San Diego'), 'local_voice_sd'],
    [location('Sacramento'), 'local_sacbee'], [location('San José'), 'local_sjspotlight'],
    [location('Irvine'), 'local_voice_oc'], [location('Chicago', 'US', 'Illinois'), 'local_wbez'],
    [location('Toronto', 'CA', 'Ontario'), 'local_citynews_toronto'],
    [location('London', 'GB', 'England'), 'local_londonstandard'],
  ];
  for (const [context, expected] of cases) assert.ok(localIds(select(context)).includes(expected), expected);
  for (const city of ['NYC', 'New York City', 'Manhattan', 'Brooklyn', 'Queens', 'The Bronx', 'Staten Island']) {
    assert.ok(localIds(select(location(city, 'US', 'NY'))).includes('local_thecity'), city);
  }
  for (const city of ['Oakland', 'Berkeley', 'San Jose', 'Daly City']) {
    const regional = select(location(city)).localSources.find(source => source.id === 'local_sfgate');
    assert.equal(regional.localArea.label, 'San Francisco Bay Area');
    assert.equal(regional.localArea.scope, 'region');
    assert.equal(localIds(select(location(city))).includes('local_sfstandard'), false, 'SF-specific source is not relabeled as another city');
  }
  assert.deepEqual(localIds(select(location('London', 'CA', 'Ontario'))), []);
  assert.deepEqual(localIds(select(location('San Jose', 'CR', 'San Jose'))), []);
  assert.deepEqual(localIds(select(location('Los Angeles', 'US', 'Texas'))), []);
  assert.ok(localIds(select(location('Westminster', 'US', 'California'))).includes('local_voice_oc'));
  assert.ok(localIds(select(location('Westminster', 'GB', 'England'))).includes('local_londonist'));
});

test('unknown cities get only explicitly matching regional sources and never unrelated city fallbacks', () => {
  const report = select(location('Stockton'));
  assert.deepEqual(localIds(report), ['local_calmatters', 'local_calcareers']);
  assert.ok(report.localSources.every(source => source.localArea.scope === 'region' && source.localArea.label === 'California'));
  assert.equal(report.basis, 'local_sources_and_platforms');
  assert.equal('activityCounts' in report, false, 'No invented city usage or post popularity');
  assert.deepEqual(localIds(select(location('Unknown city', 'US', 'Unknown region'))), []);
  assert.deepEqual(localIds(select(location(null, 'US', null))), []);
  for (const context of [{}, { ...location('Los Angeles'), available: false }, { ...location('Los Angeles'), mode: 'off' }]) {
    assert.deepEqual(localIds(select(context)), []); assert.deepEqual(select(context).platformIds, []);
  }
});

test('popular platforms use reviewed markets and existing catalog permissions; Business stays local and career-only', () => {
  const snapshot = JSON.stringify(platforms);
  assert.ok(select(location('Los Angeles')).platformIds.includes('youtube'));
  assert.deepEqual(select(location('Beijing', 'CN', 'Beijing')).platformIds, []);
  assert.deepEqual(select(location('Unknown', 'ZZ', '')).platformIds, []);
  assert.equal(select(location('Mumbai', 'IN', 'Maharashtra')).platformIds.includes('tiktok'), false);
  assert.deepEqual(select(location('Los Angeles'), { platforms: { youtube: platforms.youtube } }).platformIds, ['youtube']);
  const business = select(location('Los Angeles'), { careerOnly: true });
  assert.ok(localIds(business).includes('local_city_la_jobs'));
  assert.ok(localIds(business).includes('local_calcareers'));
  assert.ok(business.localSources.every(source => source.category === 'career'));
  assert.equal(business.platformIds.includes('youtube'), false);
  assert.equal(business.platformIds.includes('usajobs'), true);
  assert.equal(select(location('Toronto', 'CA', 'Ontario'), { careerOnly: true }).platformIds.includes('usajobs'), false);
  assert.equal(select(location('London', 'GB', 'England'), { careerOnly: true }).platformIds.includes('reed'), true);
  assert.equal(JSON.stringify(platforms), snapshot, 'Local discovery cannot overwrite provider credentials or capabilities');
});

const gps = (lat, lon, age = 0) => JSON.stringify([lat, lon, 100, Date.now() - age]);
const edge = (city, country, region) => ({ 'x-forwarded-for': '203.0.113.45, 173.245.48.20',
  'cf-ipcountry': country, 'cf-ipcity': city, 'cf-region': region });

test('authenticated route follows actual current area, ignores travel/query overrides, and keeps location private', async t => {
  const app = await createAppHarness({ automaticLocation: false, env: { TRUST_PROXY: 'loopback', CF_VISITOR_LOCATION_HEADERS: 'true' } });
  t.after(() => app.close());
  app.seedUser(member('alice', { socialTokens: { github: 'private-account-token' },
    roleSettings: { feedLocations: { countries: { country: 'JP', city: 'Tokyo' } } } }));
  app.seedUser(member('bob'));
  const query = '/social/platforms/location?mode=countries&country=JP&city=Tokyo';
  const la = await app.request(query, { userId: 'alice', headers: { 'x-ufi-device-location': gps(34.052, -118.244) } });
  assert.equal(la.status, 200); assert.match(la.headers.get('cache-control'), /private.*no-store/);
  assert.equal(la.data.locationContext.city, 'Los Angeles'); assert.equal(la.data.locationContext.feedMode, 'feed');
  assert.ok(localIds(la.data).includes('local_latimes'));
  for (const value of ['private-account-token', '-118.244', '34.052']) assert.equal(JSON.stringify(la.data).includes(value), false);
  assert.equal('point' in la.data.locationContext, false);
  const torontoHeaders = edge('Toronto', 'CA', 'Ontario');
  const network = await app.request('/social/platforms/location', { userId: 'bob', headers: torontoHeaders });
  assert.equal(network.data.locationContext.country, 'CA');
  assert.equal(network.data.locationContext.city, null);
  assert.deepEqual(network.data.localSources, [], 'A VPN exit city does not select local sources');
  const toronto = await app.request('/social/platforms/location', { userId: 'bob', headers: {
    ...torontoHeaders, 'x-ufi-device-location': gps(43.70643, -79.39864),
  } });
  assert.ok(localIds(toronto.data).includes('local_citynews_toronto'));
  assert.equal(localIds(toronto.data).includes('local_latimes'), false);
  const unknown = await app.request(query, { userId: 'alice' });
  assert.equal(unknown.data.locationContext.available, false);
  assert.deepEqual(unknown.data.localSources, []); assert.deepEqual(unknown.data.platformIds, []);
  const stale = await app.request('/social/platforms/location', { userId: 'alice', headers: { 'x-ufi-device-location': gps(34.052, -118.244, 16 * 60000) } });
  assert.deepEqual(stale.data.localSources, []);
  const unauthenticated = await app.request('/social/platforms/location', { headers: { 'x-ufi-device-location': gps(34.052, -118.244) } });
  assert.equal(unauthenticated.status, 401); assert.match(unauthenticated.headers.get('cache-control'), /private.*no-store/);
  assert.deepEqual(app.errors, []);
});

test('new local source links never create OAuth, feed, or publishing integrations and Business retains scope', async t => {
  const app = await createAppHarness({ automaticLocation: false, env: { TRUST_PROXY: 'loopback', CF_VISITOR_LOCATION_HEADERS: 'true' } });
  t.after(() => app.close());
  app.seedUser(member('member')); app.seedUser(member('business', { plan: 'business' }));
  const headers = { ...edge('Los Angeles', 'US', 'California'), 'x-ufi-device-location': gps(34.052, -118.244) };
  const local = await app.request('/social/platforms/location', { userId: 'member', headers });
  const catalog = await app.request('/social/platforms', { userId: 'member' });
  for (const source of local.data.localSources) {
    assert.equal(source.configured, false); assert.equal(source.connectionMode, 'external');
    assert.equal(catalog.data.platforms[source.id], undefined);
    const auth = await app.request(`/auth/social/${source.id}/start`, { userId: 'member' });
    assert.equal(auth.status, 404); assert.equal(auth.headers.get('location'), null);
  }
  assert.ok(local.data.platformIds.every(id => Object.hasOwn(catalog.data.platforms, id)));
  const business = await app.request('/social/platforms/location', { userId: 'business', headers });
  const businessCatalog = await app.request('/social/platforms', { userId: 'business' });
  assert.equal(business.data.careerOnly, true);
  assert.ok(business.data.localSources.every(source => source.category === 'career'));
  assert.ok(business.data.platformIds.every(id => Object.hasOwn(businessCatalog.data.platforms, id)));
  assert.equal(localIds(business.data).includes('local_latimes'), false);
  assert.ok(localIds(business.data).includes('local_city_la_jobs'));
});
