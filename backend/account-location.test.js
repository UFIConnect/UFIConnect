'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { rankLocationAccounts, MAX_ACTIVITY_POSTS } = require('./account-location');
const { createAppHarness, member } = require('./test-support/app-harness');

const now = Date.now();
const location = { city: 'Los Angeles', country: 'US', available: true, mode: 'auto' };
const platforms = { nextdoor: { name: 'Nextdoor' }, reddit: { name: 'Reddit' },
  github: { name: 'GitHub' }, tripadvisor: { name: 'Tripadvisor' },
  indeed: { name: 'Indeed', category: 'career' }, linkedin: { name: 'LinkedIn' } };
const post = (id, source = 'github', extra = {}) => ({ id, source, createdAt: new Date(now - 60000).toISOString(), ...extra });
const rank = options => rankLocationAccounts({ platforms, location, now,
  matchPost: item => ({ type: item.match || 'local' }), isPublicPost: () => true, ...options });

test('local activity uses unique recent public city matches, never private or unrelated counts', () => {
  const real = post('real');
  const excluded = [
    post('unknown', 'not-in-catalog'), post('country', 'reddit', { match: 'country' }),
    post('topic', 'reddit', { match: 'topic' }), post('global', 'reddit', { match: 'global' }),
    post('region', 'reddit', { match: 'region' }), post('old', 'reddit', { createdAt: new Date(now - 8 * 86400000).toISOString() }),
    post('future', 'reddit', { createdAt: new Date(now + 1).toISOString() }), post('undated', 'reddit', { createdAt: undefined }),
    ...[{ isPrivate: true }, { visibility: 'private' }, { groupId: 'native-private' }, { userId: 'alice' },
      { viewerId: 'alice' }, { memberId: 'alice' }, { memberScoped: true }, { isFollowing: true },
      { following: true }, { scope: 'following' }].map((extra, index) => post(`scoped-${index}`, 'reddit', extra)),
  ];
  const result = rank({ publicPosts: [real, real, post('nearby', 'github', { match: 'nearby', groupId: 'ext_github' }), ...excluded] });
  assert.deepEqual(result.activityCounts, { github: 2 });
  assert.deepEqual(result.platformIds, ['github', 'nextdoor', 'tripadvisor', 'reddit']);
  assert.equal(result.basis, 'recent_local_activity');
  assert.equal(result.windowDays, 7);
  assert.equal(rank({ publicPosts: [real], isPublicPost: () => false }).basis, 'local_relevance');
});

test('bounded scan and deterministic ties do not mutate inputs or invent unknown-city popularity', () => {
  const entries = [post('r', 'reddit'), post('g', 'github')];
  const snapshot = JSON.stringify(entries);
  assert.deepEqual(rank({ publicPosts: entries }).platformIds, rank({ publicPosts: [...entries].reverse() }).platformIds);
  assert.equal(JSON.stringify(entries), snapshot);
  let scans = 0;
  const capped = rank({ publicPosts: Array.from({ length: MAX_ACTIVITY_POSTS + 10 }, (_, index) => post(`p-${index}`)),
    matchPost: () => { scans++; return { type: 'local' }; } });
  assert.equal(scans, MAX_ACTIVITY_POSTS);
  assert.equal(capped.activityCounts.github, MAX_ACTIVITY_POSTS);
  for (const context of [{}, { ...location, city: null }, { ...location, country: null }, { ...location, mode: 'off' }]) {
    const result = rank({ location: context, publicPosts: entries });
    assert.equal(result.basis, 'local_relevance');
    assert.deepEqual(result.activityCounts, {});
    assert.equal(result.platformIds[0], 'nextdoor');
  }
  assert.deepEqual(rank({ platforms: {}, publicPosts: entries }).platformIds, []);
});

test('Business recommendations remain career-only even if an unrelated source reaches the input', () => {
  const result = rank({ careerOnly: true, publicPosts: [post('social', 'reddit'), post('job', 'indeed')] });
  assert.deepEqual(result.platformIds, ['indeed', 'linkedin']);
  assert.deepEqual(result.activityCounts, { indeed: 1 });
  assert.equal(result.careerOnly, true);
  assert.deepEqual(rank({ careerOnly: true }).platformIds, ['indeed', 'linkedin']);
});

const gps = (lat, lon, age = 0) => JSON.stringify([lat, lon, 100, Date.now() - age]);
const publicPost = (id, source, city, country) => post(id, source, { city, country,
  title: 'Public science project update', content: 'Scientists share their research and public project progress.',
  authorName: 'Public research group', sourceUrl: `https://example.org/${id}` });

test('authenticated location route follows each current city without sending coordinates or reading member caches', async t => {
  const app = await createAppHarness({ automaticLocation: false, env: { TRUST_PROXY: 'loopback', CF_VISITOR_LOCATION_HEADERS: 'true' } });
  t.after(() => app.close());
  app.seedUser(member('alice', { socialTokens: { github: 'private-account-token' },
    roleSettings: { feedLocations: { countries: { country: 'JP', city: 'Tokyo' } } } }));
  app.seedUser(member('bob'));
  const inventory = [publicPost('la1', 'github', 'Los Angeles', 'US'), publicPost('la2', 'github', 'Los Angeles', 'US'),
    publicPost('berlin', 'reddit', 'Berlin', 'DE'), publicPost('country-only', 'reddit', null, 'US'),
    { ...publicPost('conflicting-country', 'reddit', 'Los Angeles', 'DE'), latitude: 34.052, longitude: -118.244 }];
  assert.equal(app.addAndBroadcast(inventory), inventory.length);
  app.followingSourceCache.set('alice::reddit', { posts: [publicPost('private-following', 'reddit', 'Los Angeles', 'US')], fetchedAt: now });
  const query = '/social/platforms/location?mode=countries&country=JP&city=Tokyo';
  const la = await app.request(query, { userId: 'alice', headers: { 'x-ufi-device-location': gps(34.052, -118.244) } });
  assert.equal(la.status, 200);
  assert.match(la.headers.get('cache-control'), /private.*no-store/);
  assert.equal(la.data.locationContext.city, 'Los Angeles');
  assert.equal(la.data.locationContext.feedMode, 'feed');
  assert.equal(la.data.platformIds[0], 'github');
  assert.deepEqual(la.data.activityCounts, { github: 2 });
  assert.equal(la.data.basis, 'recent_local_activity');
  for (const privateValue of ['private-account-token', 'private-following', '-118.244', '34.052']) {
    assert.equal(JSON.stringify(la.data).includes(privateValue), false);
  }
  assert.equal('point' in la.data.locationContext, false);
  const berlin = await app.request('/social/platforms/location', { userId: 'bob', headers: { 'x-ufi-device-location': gps(52.52, 13.405) } });
  assert.equal(berlin.data.locationContext.city, 'Mitte', 'The offline city catalog identifies this point in central Berlin as Mitte');
  assert.deepEqual(berlin.data.activityCounts, { reddit: 1 });
  assert.equal(berlin.data.platformIds[0], 'reddit');
  const unknown = await app.request(query, { userId: 'alice' });
  assert.equal(unknown.data.locationContext.available, false, 'Saved travel destinations do not supply current location');
  assert.equal(unknown.data.basis, 'local_relevance');
  assert.deepEqual(unknown.data.activityCounts, {});
  const stale = await app.request('/social/platforms/location', { userId: 'alice', headers: { 'x-ufi-device-location': gps(34.052, -118.244, 16 * 60000) } });
  assert.equal(stale.data.basis, 'local_relevance');
  assert.equal(stale.data.locationContext.available, false);
  const unauthenticated = await app.request('/social/platforms/location', { headers: { 'x-ufi-device-location': gps(34.052, -118.244) } });
  assert.equal(unauthenticated.status, 401);
  assert.match(unauthenticated.headers.get('cache-control'), /private.*no-store/);
  assert.deepEqual(app.errors, []);
});

test('text city matches require country evidence; fallback suggestions do not unlock OAuth or widen Business scope', async t => {
  const app = await createAppHarness({ automaticLocation: false, env: { TRUST_PROXY: 'loopback', CF_VISITOR_LOCATION_HEADERS: 'true' } });
  t.after(() => app.close());
  app.seedUser(member('member'));
  app.seedUser(member('business', { plan: 'business' }));
  const inventory = [publicPost('paris-fr', 'github', 'Paris', 'FR'), publicPost('paris-us', 'reddit', 'Paris', 'US'),
    publicPost('paris-ambiguous', 'reddit', 'Paris', null), publicPost('paris-topic', 'reddit', null, 'FR')];
  inventory[3].title = 'Paris science project';
  assert.equal(app.addAndBroadcast(inventory), inventory.length);
  const edge = { 'x-forwarded-for': '203.0.113.45, 173.245.48.20', 'cf-ipcountry': 'FR', 'cf-ipcity': 'Paris' };
  const result = await app.request('/social/platforms/location', { userId: 'member', headers: edge });
  assert.deepEqual(result.data.activityCounts, { github: 1 });
  assert.equal(result.data.locationContext.source, 'network');
  const catalog = await app.request('/social/platforms', { userId: 'member' });
  assert.ok(result.data.platformIds.every(key => Object.hasOwn(catalog.data.platforms, key)));
  assert.equal(catalog.data.platforms.nextdoor.configured, false);
  assert.equal(catalog.data.platforms.nextdoor.connectionMode, 'external');
  assert.deepEqual(catalog.data.platforms.nextdoor.feed, { home: false, following: null });
  assert.equal(catalog.data.platforms.nextdoor.crossPost.supported, false);
  const business = await app.request('/social/platforms/location', { userId: 'business', headers: edge });
  const businessCatalog = await app.request('/social/platforms', { userId: 'business' });
  assert.equal(business.data.careerOnly, true);
  assert.equal(business.data.basis, 'local_relevance');
  assert.ok(business.data.platformIds.includes('indeed'));
  assert.ok(business.data.platformIds.includes('linkedin'));
  assert.ok(business.data.platformIds.every(key => Object.hasOwn(businessCatalog.data.platforms, key)));
  assert.equal(business.data.platformIds.includes('github'), false);
});
