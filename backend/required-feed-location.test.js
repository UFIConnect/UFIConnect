'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');
const routes = ['/feed', '/office/feed', '/feed/videos', '/office/feed/videos',
  '/office/feed/music', '/feed/videos/following', '/office/feed/videos/following'];
const edge = { 'x-forwarded-for': '203.0.113.45, 173.245.48.20', 'cf-ipcountry': 'DE',
  'cf-ipcity': 'Berlin', 'cf-region': 'Berlin', 'cf-iplatitude': '52.52', 'cf-iplongitude': '13.405' };
const device = () => ({ 'x-ufi-device-location': JSON.stringify([34.052, -118.244, 100, Date.now()]) });

test('every member feed pauses without automatic location; destinations and forged headers cannot bypass it', async t => {
  const app = await createAppHarness({ automaticLocation: false, env: { TRUST_PROXY: 'loopback', CF_VISITOR_LOCATION_HEADERS: 'true' } });
  t.after(() => app.close());
  app.seedUser(member('alice', { location: 'US', roleSettings: {
    feedRegionalLocation: { mode: 'off' }, feedLocations: { countries: { country: 'JP', city: 'Tokyo' } },
  } }));
  for (const route of [...routes, '/office/feed?mode=countries&city=Tokyo&country=JP', '/office/feed?source=youtube', '/office/feed?sources=youtube,reddit',
    '/office/feed/videos?mode=restaurants&venueSearch=1', '/feed?mode=bars&venueSearch=1']) {
    const result = await app.request(route, { userId: 'alice' });
    assert.equal(result.status, 428, route);
    assert.equal(result.data.code, 'feed_location_required');
    assert.match(result.headers.get('cache-control'), /private.*no-store/);
    assert.equal('posts' in result.data, false);
  }
  for (const headers of [{ 'cf-ipcountry': 'DE', 'cf-ipcity': 'Berlin' },
    { 'x-ufi-device-location': JSON.stringify([34, -118, 100, Date.now() - 16 * 60000]) }]) {
    assert.equal((await app.request('/feed', { userId: 'alice', headers })).status, 428);
  }
  const metadata = await app.request('/feed/location', { userId: 'alice' });
  assert.equal(metadata.status, 200);
  assert.equal(metadata.data.locationRequired, true);
  assert.equal(metadata.data.automaticLocationAvailable, false, 'profile country does not establish automatic location');
  assert.equal((await app.request('/profile', { userId: 'alice' })).status, 200);
  assert.equal((await app.request('/feed/guest')).status, 200);
  assert.equal((await app.request('/feed')).status, 401);
});

test('fresh device location and trusted IP fallback both open all feed variants', async t => {
  const app = await createAppHarness({ automaticLocation: false, env: { TRUST_PROXY: 'loopback', CF_VISITOR_LOCATION_HEADERS: 'true' } });
  t.after(() => app.close()); app.seedUser(member('alice'));
  for (const headers of [device(), edge]) {
    for (const route of routes) {
      const result = await app.request(route, { userId: 'alice', headers });
      assert.equal(result.status, 200, JSON.stringify({ route, result, errors: app.errors }));
    }
    const result = await app.request('/feed/location', { userId: 'alice', headers });
    assert.equal(result.data.automaticLocationAvailable, true);
    assert.equal('point' in result.data.locationContext, false);
  }
});

test('removed prototype endpoints cannot forward payloads or disclose shared state', async t => {
  const app = await createAppHarness(); t.after(() => app.close());
  for (const [path, method] of [['activate', 'POST'], ['deactivate', 'POST'], ['status', 'GET'], ['respond', 'POST']]) {
    assert.equal((await app.request(`/holomine/${path}`, { method, ...(method === 'POST' ? { body: { prompt: 'probe' } } : {}) })).status, 404);
  }
});
