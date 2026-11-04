'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const proxyaddr = require('proxy-addr');
const { createAppHarness, member } = require('./test-support/app-harness');
const { paginateEqualizedPool } = require('./feed-pagination');
const { SCHEMA: DEVICE_SCHEMA } = require('./suspicious-devices');

const edgeHeaders = country => ({ 'x-forwarded-for': '203.0.113.45, 173.245.48.20', 'cf-ipcountry': country });
function locationRequest(mode = 'feed', headers = {}, query = {}) {
  return { query: { mode, ...query }, headers, socket: { remoteAddress: '127.0.0.1' },
    app: { get: () => proxyaddr.compile(['loopback']) } };
}
async function fixture(t, overrides = {}) {
  const app = await createAppHarness({ env: { TRUST_PROXY: 'loopback' }, ...overrides });
  t.after(() => app.close());
  app.seedUser(member('alice'));
  app.seedUser(member('bob'));
  return app;
}
const location = (country, city = null) => ({ available: true, country, city, region: null,
  countryName: ({ CA: 'Canada', FR: 'France', US: 'United States', JP: 'Japan' })[country],
  declared: [country, ({ CA: 'Canada', FR: 'France', US: 'United States', JP: 'Japan' })[country], city].filter(Boolean) });

test('member feeds use automatic location despite legacy preferences and never inherit travel destinations', async t => {
  const app = await fixture(t);
  const alice = app.users.find(user => user.id === 'alice');
  alice.roleSettings = {
    feedLocation: { country: 'Japan', city: 'Tokyo' },
    feedRegionalLocation: { mode: 'manual', country: 'France', city: 'Paris' },
  };
  const bob = app.users.find(user => user.id === 'bob');
  for (const mode of ['feed', 'following', 'videos', 'music']) {
    const req = locationRequest(mode, edgeHeaders('CA'), { country: 'US', city: 'Chicago' });
    const result = app.getFeedLocationContext(req, alice);
    assert.equal(result.country, 'CA', `automatic location wins in ${mode}`);
    assert.equal(result.city, null);
    assert.equal(result.mode, 'auto');
    assert.equal(app.getFeedLocationContext(req, bob).country, 'CA', 'one member never inherits another member’s preference');
  }
  alice.roleSettings.feedRegionalLocation = { mode: 'auto' };
  assert.equal(app.getFeedLocationContext(locationRequest('feed', edgeHeaders('CA')), alice).country, 'CA');
  const noNetwork = app.getFeedLocationContext(locationRequest(), alice);
  assert.notEqual(noNetwork.country, 'JP', 'legacy travel is never a regional fallback');
  assert.notEqual(noNetwork.city, 'Tokyo');
  alice.roleSettings.feedRegionalLocation = { mode: 'off', country: 'France', city: 'Paris' };
  assert.equal(app.getFeedLocationContext(locationRequest('feed', edgeHeaders('CA')), alice).available, true);
  assert.equal(app.getFeedLocationContext(locationRequest('countries', edgeHeaders('CA')), alice).country, 'JP', 'turning regional ranking off does not erase travel settings');
});

test('profile PATCH merges destination scopes, explicit empty scope resets only that destination, and other accounts stay independent', async t => {
  const app = await fixture(t);
  const alice = app.users.find(user => user.id === 'alice');
  alice.roleSettings = { feedLocation: { country: 'Japan', city: 'Tokyo' }, feedLanguages: ['en'],
    feedLocations: { countries: { country: 'France', city: 'Paris' }, restaurants: { country: 'US', city: 'San Diego' } } };
  const patch = await app.request('/profile', { userId: 'alice', method: 'PATCH', body: { roleSettings: {
    feedLocations: { bars: { country: 'Canada', city: 'Vancouver' } },
    feedRegionalLocation: { mode: 'manual', country: 'Germany', city: 'Berlin' },
  } } });
  assert.equal(patch.status, 200);
  const profile = (await app.request('/profile', { userId: 'alice' })).data;
  assert.equal(profile.roleSettings.feedLocations.countries.city, 'Paris');
  assert.equal(profile.roleSettings.feedLocations.restaurants.city, 'San Diego');
  assert.equal(profile.roleSettings.feedLocations.bars.city, 'Vancouver');
  assert.deepEqual(profile.roleSettings.feedLanguages, ['en']);
  assert.deepEqual(profile.roleSettings.feedRegionalLocation, { mode: 'auto', country: '', city: '' });
  const saved = app.users.find(user => user.id === 'alice');
  for (const [mode, country, city] of [['countries', 'FR', 'Paris'], ['restaurants', 'US', 'San Diego'], ['bars', 'CA', 'Vancouver'], ['local', 'JP', 'Tokyo']]) {
    const result = app.getFeedLocationContext(locationRequest(mode, edgeHeaders('GB')), saved);
    assert.equal(result.country, country, `${mode} resolves only its own destination`);
    assert.equal(result.city, city);
  }
  assert.equal((await app.request('/profile', { userId: 'alice', method: 'PATCH', body: { roleSettings: { feedLocations: { restaurants: {} } } } })).status, 200);
  const reset = app.getFeedLocationContext(locationRequest('restaurants', edgeHeaders('CA')), app.users.find(user => user.id === 'alice'));
  assert.equal(reset.country, 'CA', 'an explicitly cleared scope uses current network location');
  assert.notEqual(reset.city, 'Tokyo', 'clearing a scope never resurrects legacy travel');
  assert.equal(app.getFeedLocationContext(locationRequest('countries'), app.users.find(user => user.id === 'alice')).city, 'Paris');
  assert.deepEqual((await app.request('/profile', { userId: 'bob' })).data.roleSettings, {});
});

test('invalid location settings reject the complete profile update without partial changes', async t => {
  const app = await fixture(t);
  const alice = app.users.find(user => user.id === 'alice');
  alice.roleSettings = { feedLanguages: ['en'], feedLocations: { countries: { country: 'JP', city: 'Tokyo' } } };
  const before = JSON.stringify(alice);
  for (const settings of [
    { feedRegionalLocation: { mode: 'automatic', country: 'CA' } },
    { feedRegionalLocation: { mode: 'manual', country: 'ZZ', city: 'Unknown' } },
    { feedLocations: { restaurants: { country: '', city: 'Paris' } } },
    { feedLocations: { countries: { country: 'Not a country', city: 'Nowhere' } } },
    { feedLocations: { music: { country: 'FR', city: 'Paris' } } },
  ]) {
    const response = await app.request('/profile', { method: 'PATCH', userId: 'alice', body: {
      name: 'Must not replace the saved name', title: 'Must not replace the saved title', roleSettings: settings,
    } });
    assert.equal(response.status, 400, JSON.stringify(settings));
    assert.equal(JSON.stringify(app.users.find(user => user.id === 'alice')), before);
  }
  assert.deepEqual((await app.request('/profile', { userId: 'bob' })).data.roleSettings, {});
});

test('real Postgres JSONB update preserves a concurrent change to another destination and returns the durable merged settings', async t => {
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite();
  t.after(() => pg.close());
  const id = 'a0000000-0000-4000-8000-000000000091';
  await pg.exec(`CREATE TABLE users (id UUID PRIMARY KEY, name TEXT, email TEXT, phone TEXT,
    title TEXT, bio TEXT, skills TEXT[], organization TEXT, links JSONB, role_settings JSONB,
    profile_hidden BOOLEAN, avatar_url TEXT, cover_url TEXT, auth_version INTEGER DEFAULT 0, auth_provider TEXT DEFAULT 'local')`);
  for (const sql of DEVICE_SCHEMA) await pg.exec(sql);
  await pg.query('INSERT INTO users(id,name,email,role_settings) VALUES($1,$2,$3,$4)', [id, 'Database member', 'database@example.invalid', JSON.stringify({
    feedLanguages: ['en'], feedLocations: { countries: { country: 'JP', city: 'Tokyo' }, restaurants: { country: 'US', city: 'San Diego' } },
  })]);
  let concurrentSave = false;
  const app = await fixture(t, { connected: true, query: async (sql, params) => {
    if (sql.startsWith('SELECT id FROM auth_sessions')) return { rows: [{ id: 'synthetic-active-session' }] };
    if (sql.startsWith('SELECT id,phone,auth_provider FROM users WHERE id=')) {
      // Another server saves Travel after the cached member is read and
      // before this transaction acquires the row lock for its own save.
      await pg.query("UPDATE users SET role_settings=jsonb_set(role_settings, '{feedLocations,countries}', $1::jsonb) WHERE id=$2", [JSON.stringify({ country: 'FR', city: 'Paris' }), id]);
      concurrentSave = true;
      return pg.query(sql, params);
    }
    if (sql.startsWith('UPDATE users SET name=')) {
      assert.deepEqual(JSON.parse(params[6]), { feedLocations: { bars: { country: 'CA', city: 'Vancouver' } } }, 'only submitted scopes belong in the SQL patch');
      return pg.query(sql, params);
    }
    if (sql.startsWith('SELECT * FROM users WHERE id') || /office_security_device|pg_advisory_xact_lock/.test(sql) || /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return pg.query(sql, params);
    return { rows: [], rowCount: 0 };
  } });
  app.seedUser(member(id));
  const response = await app.request('/profile', { method: 'PATCH', userId: id, body: { roleSettings: { feedLocations: { bars: { country: 'Canada', city: 'Vancouver' } } } } });
  assert.equal(response.status, 200, JSON.stringify({ data: response.data, errors: app.errors }));
  assert.equal(concurrentSave, true);
  const stored = (await pg.query('SELECT role_settings FROM users WHERE id=$1', [id])).rows[0].role_settings;
  assert.deepEqual(stored, { feedLanguages: ['en'], feedLocations: {
    countries: { country: 'FR', city: 'Paris' }, restaurants: { country: 'US', city: 'San Diego' }, bars: { country: 'CA', city: 'Vancouver' },
  } });
  assert.deepEqual(JSON.parse(JSON.stringify(app.users.find(user => user.id === id).roleSettings)), stored, 'member memory adopts the returned durable settings');
});

test('location endpoint returns current member preferences with no cacheable or identifying network data', async t => {
  const app = await fixture(t);
  const anonymous = await app.request('/feed/location?mode=feed');
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get('cache-control'), /private.*no-store/);
  const guest = await app.request('/feed/guest?limit=4');
  assert.equal(guest.status, 200);
  assert.match(guest.headers.get('cache-control'), /private.*no-store/);
  app.users.find(user => user.id === 'alice').roleSettings = { feedRegionalLocation: { mode: 'manual', country: 'Japan', city: 'Tokyo' } };
  const alice = await app.request('/feed/location?mode=feed', { userId: 'alice', headers: edgeHeaders('CA') });
  const bob = await app.request('/feed/location?mode=feed', { userId: 'bob', headers: edgeHeaders('CA') });
  for (const response of [alice, bob]) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
    assert.ok(response.data.locationContext);
    assert.ok(!JSON.stringify(response.data).includes('203.0.113.45'), 'IP address is not serialized');
  }
  assert.equal(alice.data.locationContext.country, 'CA');
  assert.equal(bob.data.locationContext.country, 'CA');
  const forged = await app.request('/feed/location?mode=feed', { userId: 'bob', headers: { 'cf-ipcountry': 'JP', 'cf-ipcity': 'Tokyo' } });
  assert.equal(forged.status, 200);
  assert.notEqual(forged.data.locationContext.country, 'JP', 'unverified headers cannot set the displayed country');
  assert.notEqual(forged.data.locationContext.city, 'Tokyo');
});

test('feed, source, video and music responses use automatic location even with legacy manual preferences', async t => {
  const app = await fixture(t, { connected: true });
  app.users.find(user => user.id === 'alice').roleSettings = {
    feedRegionalLocation: { mode: 'manual', country: 'France', city: 'Paris' },
    feedLocation: { country: 'Japan', city: 'Tokyo' },
  };
  for (const route of ['/office/feed?mode=feed&sort=newest&passive=1', '/office/feed?mode=feed&source=github&sort=newest&passive=1',
    '/office/feed?mode=following&passive=1', '/office/feed/videos?sort=balanced', '/office/feed/music']) {
    const response = await app.request(route, { userId: 'alice', headers: edgeHeaders('CA') });
    assert.equal(response.status, 200, route);
    assert.equal(response.data.locationContext?.country, 'CA', `${route} uses current automatic location`);
    assert.equal(response.data.locationContext?.city, null, route);
    assert.match(response.headers.get('cache-control'), /private.*no-store/, route);
  }
  const guest = await app.request('/feed/guest', { headers: edgeHeaders('CA') });
  assert.equal(guest.status, 200);
  assert.equal(guest.data.locationContext?.country, 'CA', 'guest response has its own context, not the last member’s preference');
});

test('country evidence stays country-level and a city name cannot override a conflicting explicit country', async t => {
  const app = await fixture(t);
  const countryMatch = app.feedPostLocationMatch({ id: 'toronto', location: 'Toronto, Canada', source: 'reddit' }, location('CA'));
  assert.equal(countryMatch.type, 'country', 'declared country names must not become precise-city terms');
  const sameCity = app.feedPostLocationMatch({ id: 'paris-us', location: 'Paris, Texas, United States', country: 'US', city: 'Paris', title: 'Paris community news' }, location('FR', 'Paris'));
  assert.notEqual(sameCity.type, 'local', 'same-named foreign city is never labelled nearby');
  const homeCity = app.feedPostLocationMatch({ id: 'paris-fr', location: 'Paris, France', country: 'FR', city: 'Paris' }, location('FR', 'Paris'));
  assert.equal(homeCity.type, 'local');
  const california = app.feedPostLocationMatch({ id: 'san-diego', location: 'San Diego, CA' }, location('US', 'San Diego'));
  assert.equal(california.type, 'local', 'US state abbreviation CA must not become the country Canada');
  assert.equal(app.feedPostLocationMatch({ id: 'san-diego', location: 'San Diego, CA' }, location('CA')).score, 0);
});

test('restricted remote jobs are not available worldwide and unrestricted listings do not pretend to be local', async t => {
  const app = await fixture(t);
  assert.equal(app.jobMatchesUserLocation('Remote (US only)', 'CA'), false);
  assert.equal(app.jobMatchesUserLocation('Remote (US only)', 'US'), true);
  const restricted = app.feedPostLocationMatch({ id: 'us-only', source: 'remoteok', location: 'Remote (US only)' }, location('CA'));
  assert.equal(restricted.score, 0, 'remote work does not override country eligibility');
  const worldwide = app.feedPostLocationMatch({ id: 'worldwide', source: 'remoteok', location: 'Worldwide / anywhere' }, location('CA', 'Toronto'));
  assert.equal(worldwide.type, 'global');
  assert.notEqual(worldwide.label, 'Near you');
  const notEvidence = app.feedPostLocationMatch({ id: 'headline', source: 'reddit', title: 'The international remote control market' }, location('CA'));
  assert.equal(notEvidence.score, 0, 'ordinary prose is not global location evidence');
  for (const restrictedLocation of ['Worldwide, excluding Canada', 'Remote, not available in Canada']) {
    assert.equal(app.jobMatchesUserLocation(restrictedLocation, 'CA'), false, 'a named country exclusion does not become eligibility');
    assert.equal(app.feedPostLocationMatch({ id: 'excluded', source: 'remoteok', location: restrictedLocation }, location('CA')).score, 0);
  }
  assert.equal(app.feedPostLocationMatch({ id: 'no-location', source: 'usajobs', title: 'Research position' }, location('US')).score, 0, 'a US job board alone is not evidence of a US job location');
});

test('reused public posts are reranked without retaining another member’s location badges or mutating cache entries', async t => {
  const app = await fixture(t);
  const original = [{ id: 'canada', source: 'reddit', title: 'Research news', location: 'Canada', createdAt: new Date().toISOString() }];
  const serialized = JSON.stringify(original);
  const canadian = app.rankFeedPostsForLocation(original, location('CA'));
  assert.equal(canadian[0].matchedByLocation, true);
  assert.equal(JSON.stringify(original), serialized, 'public cache objects stay free of per-request annotations');
  const french = app.rankFeedPostsForLocation(canadian, location('FR'));
  assert.equal(Boolean(french[0].matchedByLocation), false);
  assert.equal(Boolean(french[0].locationMatchLabel), false);
  const off = app.rankFeedPostsForLocation(canadian, { available: false, mode: 'off' });
  assert.equal(Boolean(off[0].matchedByLocation), false);
  assert.equal(Boolean(off[0].locationMatch), false);
  assert.equal(Boolean(off[0].locationMatchLabel), false);
  assert.equal(canadian[0].matchedByLocation, true, 'reranking one response does not mutate a different response');
});

test('ranked source feed can favor a nearby older post while explicit newest keeps chronological order', async t => {
  const now = Date.now();
  const inventory = [['us-newer', 'United States', 60000], ['ca-older', 'Canada', 120000]].map(([id, country, age]) => ({
    id: `github_regional_${id}`, source: 'github', topic: 'Science', title: 'Open science research project update',
    content: `Researchers in ${country} share project methods and discuss new science findings with the community.`,
    location: country, source_url: `https://github.com/example/${id}`, author_name: 'Research project',
    post_created_at: new Date(now - age).toISOString(), media_type: null,
  }));
  const app = await fixture(t, { connected: true, query: async (sql, params) => {
    if (!sql.includes('FROM feed_posts_cache')) return { rows: [], rowCount: 0 };
    let rows = inventory;
    const sources = sql.match(/source = (?:ANY\(\$(\d+)::text\[\]\)|\$(\d+))/);
    if (sources) {
      const selected = params[Number(sources[1] || sources[2]) - 1];
      rows = rows.filter(row => (Array.isArray(selected) ? selected : [selected]).includes(row.source));
    }
    return { rows, rowCount: rows.length };
  } });
  assert.equal(app.addAndBroadcast(inventory.map(app.dbRowToFeedPost)), inventory.length);
  app.users.find(user => user.id === 'alice').roleSettings = { feedRegionalLocation: { mode: 'manual', country: 'Canada', city: '' } };
  const base = '/office/feed?mode=feed&source=github&passive=1&limit=10';
  const ranked = await app.request(base + '&sort=ranked', { userId: 'alice', headers: edgeHeaders('CA') });
  assert.equal(ranked.status, 200);
  assert.equal(ranked.data.posts.length, 2, 'both distinct-timestamp candidates are visible');
  assert.equal(ranked.data.posts[0].id, 'github_regional_ca-older', 'regional ranking survives final source/topic equalization');
  const newest = await app.request(base + '&sort=newest', { userId: 'alice', headers: edgeHeaders('CA') });
  assert.equal(newest.status, 200);
  assert.equal(newest.data.posts[0].id, 'github_regional_us-newer', 'explicit newest still respects publication time');
  app.users.find(user => user.id === 'alice').roleSettings.feedRegionalLocation = { mode: 'off' };
  const off = await app.request(base + '&sort=ranked', { userId: 'alice', headers: edgeHeaders('US') });
  assert.equal(off.status, 200);
  assert.equal(off.data.posts[0].id, 'github_regional_us-newer', 'legacy off still follows current automatic location');
  assert.ok(off.data.posts.filter(post => post.matchedByLocation).every(post => post.location === 'United States'), 'network changes remove previous country badges');
});

test('destination cursors continue within their member/location scope and restart when that scope changes', () => {
  const posts = Array.from({ length: 6 }, (_, index) => ({ id: `story-${index}`, source: 'travelnews' }));
  const initial = paginateEqualizedPool(posts, { mode: 'countries', scope: 'alice:JP:Tokyo', limit: 2 });
  assert.deepEqual(initial.posts.map(post => post.id), ['story-0', 'story-1']);
  const next = paginateEqualizedPool(posts, { mode: 'countries', scope: 'alice:JP:Tokyo', cursorMap: initial.cursorMap, page: 2, limit: 2 });
  assert.deepEqual(next.posts.map(post => post.id), ['story-2', 'story-3']);
  for (const scope of ['alice:FR:Paris', 'bob:JP:Tokyo']) {
    const changed = paginateEqualizedPool(posts, { mode: 'countries', scope, cursorMap: initial.cursorMap, page: 2, limit: 2 });
    assert.deepEqual(changed.posts.map(post => post.id), ['story-0', 'story-1'], 'old cursor and page number cannot skip the beginning of a new scope');
  }
});
