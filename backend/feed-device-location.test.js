'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const proxyaddr = require('proxy-addr');
const { RADIUS_KM, distanceKm, nearestFeedCity, feedCityByName, deviceFeedPoint } = require('./feed-city-location');
const { trustedFeedNetworkLocation, memberFeedSnapshotKey } = require('./feed-location');
const { createAppHarness, member } = require('./test-support/app-harness');
const edge = { 'x-forwarded-for': '203.0.113.45, 173.245.48.20', 'cf-ipcountry': 'DE', 'cf-ipcity': 'Berlin', 'cf-region': 'Berlin', 'cf-iplatitude': '52.52', 'cf-iplongitude': '13.405' };
const gps = (lat = 34.052, lon = -118.244, age = 0, accuracy = 100) => JSON.stringify([lat, lon, accuracy, Date.now() - age]);
const request = (headers = {}, id = 'alice', mode = 'feed') => ({ user: id ? { id } : null, query: { mode }, headers,
  socket: { remoteAddress: '127.0.0.1' }, app: { get: () => proxyaddr.compile(['loopback']) } });

test('offline city lookup handles real cities, ambiguous names, the dateline and empty ocean', () => {
  const la = nearestFeedCity({ lat: 34.052, lon: -118.244 });
  assert.equal(la.city, 'Los Angeles'); assert.equal(la.country, 'US');
  assert.equal(la.region, 'California');
  assert.equal(feedCityByName('Los Angeles', 'US').city, 'Los Angeles');
  assert.equal(feedCityByName('Springfield', 'US'), null, 'ambiguous cities cannot establish a radius');
  assert.equal(nearestFeedCity({ lat: 0, lon: 0 }), null);
  assert.equal(nearestFeedCity({ lat: 90, lon: 180 }), null);
  assert.ok(distanceKm({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 }) < 23, 'longitude wraps at the dateline');
  assert.deepEqual(nearestFeedCity({ lat: -16.8, lon: -180 }), nearestFeedCity({ lat: -16.8, lon: 180 }), 'equivalent dateline coordinates resolve consistently');
});

test('device headers require authentication, fresh valid coordinates and bounded accuracy', () => {
  assert.deepEqual(deviceFeedPoint(request({ 'x-ufi-device-location': gps() })), { lat: 34.052, lon: -118.244, accuracy: 100 });
  assert.equal(deviceFeedPoint(request({ 'x-ufi-device-location': gps() }, null)), null);
  for (const value of [gps(91), gps(0, 181), gps(0, 0, 16 * 60000), gps(0, 0, -120000), gps(0, 0, 0, 10001),
    JSON.stringify(['34', -118, 10, Date.now()]), '{}', '[0,0]', 'invalid', 'x'.repeat(201)]) {
    assert.equal(deviceFeedPoint(request({ 'x-ufi-device-location': value })), null, value);
  }
  assert.deepEqual(deviceFeedPoint(request({ 'x-ufi-device-location': gps(0, 0, 0, 0) })), { lat: 0, lon: 0, accuracy: 0 });
});

test('city-level IP coordinates require a trusted edge and enabled transform; zeros stay valid', () => {
  assert.equal(trustedFeedNetworkLocation(request(edge)).point, undefined);
  assert.deepEqual(trustedFeedNetworkLocation(request(edge), { visitorLocationHeaders: true }).point, { lat: 52.52, lon: 13.405, accuracy: 0 });
  const zero = { ...edge, 'cf-iplatitude': '0', 'cf-iplongitude': '0' };
  assert.deepEqual(trustedFeedNetworkLocation(request(zero), { visitorLocationHeaders: true }).point, { lat: 0, lon: 0, accuracy: 0 });
  for (const value of ['', 'NaN', '91', '52.5,34']) {
    assert.equal(trustedFeedNetworkLocation(request({ ...edge, 'cf-iplatitude': value }), { visitorLocationHeaders: true }).point, undefined);
  }
  const forged = request(edge); forged.socket.remoteAddress = '203.0.113.9';
  assert.deepEqual(trustedFeedNetworkLocation(forged, { visitorLocationHeaders: true }), {});
});

test('device context overrides VPN IP, preserves destinations, and keeps coordinates out of all feed responses', async t => {
  const app = await createAppHarness({ connected: true, env: { TRUST_PROXY: 'loopback', CF_VISITOR_LOCATION_HEADERS: 'true' } });
  t.after(() => app.close());
  app.seedUser(member('alice', { roleSettings: { feedRegionalLocation: { mode: 'off' }, feedLocations: { countries: { country: 'JP', city: 'Tokyo' } } } }));
  app.seedUser(member('bob'));
  const headers = { ...edge, 'x-ufi-device-location': gps() };
  const alice = app.users[0];
  const context = app.getFeedLocationContext(request(headers), alice);
  assert.equal(context.source, 'device'); assert.equal(context.city, 'Los Angeles');
  assert.equal(context.country, 'US'); assert.equal(context.radiusMiles, 100);
  assert.equal(context.mode, 'auto'); assert.equal(context.approximate, false);
  const travel = app.getFeedLocationContext(request(headers, 'alice', 'countries'), alice);
  assert.equal(travel.city, 'Tokyo'); assert.equal(travel.source, 'member'); assert.equal(travel.point, null);
  for (const route of ['/feed/location', '/office/feed?mode=feed&sort=newest&passive=1', '/office/feed?mode=feed&source=github&passive=1',
    '/office/feed?mode=following&passive=1', '/office/feed/videos', '/office/feed/music']) {
    const result = await app.request(route, { userId: 'alice', headers });
    assert.equal(result.status, 200, route);
    assert.equal(result.data.locationContext?.source, 'device', route);
    assert.equal(result.data.locationContext?.radiusMiles, 100, route);
    assert.match(result.headers.get('cache-control'), /private.*no-store/);
    assert.equal('point' in result.data.locationContext, false);
    const serialized = JSON.stringify(result.data);
    assert.equal(serialized.includes('-118.244'), false); assert.equal(serialized.includes('203.0.113.45'), false);
  }
  const bob = await app.request('/feed/location', { userId: 'bob', headers: edge });
  assert.equal(bob.data.locationContext.city, 'Berlin'); assert.equal(bob.data.locationContext.source, 'network');
  assert.equal(bob.data.locationContext.approximate, true);
  const guest = await app.request('/feed/guest', { headers });
  assert.equal(guest.data.locationContext.source, 'network', 'guest endpoint ignores device headers');
  const expired = await app.request('/feed/location', { userId: 'alice', headers: { ...headers, 'x-ufi-device-location': gps(34, -118, 16 * 60000) } });
  assert.equal(expired.data.locationContext.city, 'Berlin');
  assert.ok([...app.mainFeedSnapshots.values()].every(snapshot => !JSON.stringify(snapshot).includes('-118.244')));
});

test('nearby ranking respects 100 miles and uncertainty without calling whole regions or unknown locations nearby', async t => {
  const app = await createAppHarness(); t.after(() => app.close());
  app.seedUser(member('alice'));
  const context = app.getFeedLocationContext(request({ 'x-ufi-device-location': gps(0, 0, 0, 100) }), app.users[0]);
  // Along the equator the great-circle distance has a simple independent reference.
  const longitude = miles => miles * 1.609344 / 6371.0088 * 180 / Math.PI;
  const match = miles => app.feedPostLocationMatch({ latitude: 0, longitude: longitude(miles), country: 'US' }, context);
  assert.equal(match(99).type, 'nearby');
  assert.equal(match(101).score, 0);
  assert.equal(match(99.99).score, 0, 'reported accuracy excludes uncertain boundary posts');
  assert.ok(Math.abs(distanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: longitude(100) }) - RADIUS_KM) < 0.001);
  const la = app.getFeedLocationContext(request({ 'x-ufi-device-location': gps() }), app.users[0]);
  assert.equal(app.feedPostLocationMatch({ city: 'Anaheim', country: 'US', region: 'California' }, la).type, 'nearby');
  assert.equal(app.feedPostLocationMatch({ city: 'San Francisco', country: 'US', region: 'California' }, la).score, 0);
  assert.equal(app.feedPostLocationMatch({ location: 'California, United States' }, la).type, 'region');
  assert.equal(app.feedPostLocationMatch({ country: 'US' }, la).type, 'country');
  assert.equal(app.feedPostLocationMatch({ title: 'Science research', source: 'github' }, la).score, 0);
  const ranked = app.rankFeedPostsForLocation([{ id: 'far', city: 'San Francisco', country: 'US', region: 'California' },
    { id: 'unknown', title: 'Science research' }, { id: 'near', city: 'Anaheim', country: 'US', region: 'California' }], la);
  assert.equal(ranked[0].id, 'near'); assert.equal(ranked.length, 3, 'location does not hide other useful content');
});

test('snapshot scopes distinguish members and meaningful movement without embedding coordinates', () => {
  const context = { source: 'device', country: 'US', city: 'Los Angeles', point: { lat: 34.052, lon: -118.244 } };
  const key = memberFeedSnapshotKey('alice', 'ranked', '', context);
  assert.equal(key.includes('-118.244'), false);
  assert.equal(key, memberFeedSnapshotKey('alice', 'ranked', '', { ...context, point: { lat: 34.053, lon: -118.243 } }));
  assert.notEqual(key, memberFeedSnapshotKey('alice', 'ranked', '', { ...context, point: { lat: 34.08, lon: -118.2 } }));
  assert.notEqual(key, memberFeedSnapshotKey('bob', 'ranked', '', context));
});
