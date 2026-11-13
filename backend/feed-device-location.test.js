'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
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
  assert.equal(bob.data.locationContext.country, 'DE'); assert.equal(bob.data.locationContext.source, 'network');
  assert.equal(bob.data.locationContext.city, null);
  assert.equal(bob.data.locationContext.radiusMiles, null);
  assert.equal(bob.data.locationContext.approximate, true);
  const vpnOnly = app.getFeedLocationContext(request(edge, 'bob'), app.users[1]);
  assert.equal(app.feedPostLocationMatch({ city: 'Berlin', country: 'DE', lat: 52.52, lon: 13.405 }, vpnOnly).type, 'country');
  const guest = await app.request('/feed/guest', { headers });
  assert.equal(guest.data.locationContext.source, 'network', 'guest endpoint ignores device headers');
  const expired = await app.request('/feed/location', { userId: 'alice', headers: { ...headers, 'x-ufi-device-location': gps(34, -118, 16 * 60000) } });
  assert.equal(expired.data.locationContext.country, 'DE');
  assert.equal(expired.data.locationContext.city, null);
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

test('web venue search uses each device point to filter shared map data', async t => {
  const providerQueries = [];
  const now = Date.now();
  let providerUnavailable = false;
  const timestamp = new Date().toISOString();
  const makeVenue = (id, lon, name, amenity) => ({ type: 'node', id, lat: 37.803, lon, timestamp,
    tags: { name, amenity, 'addr:city': 'Oakland' } });
  const https = {
    Agent: require('node:https').Agent,
    request(options) {
      assert.equal(options.hostname, 'example.com');
      assert.equal(options.path, '/opening');
      assert.equal(typeof options.lookup, 'function');
      const request = new EventEmitter();
      request.setTimeout = () => request;
      request.end = () => setImmediate(() => request.emit('error', new Error('Optional publisher photo unavailable')));
      return request;
    },
    get(value, _options, callback) {
      const url = new URL(value);
      assert.equal(url.hostname, 'overpass-api.de');
      const query = url.searchParams.get('data');
      providerQueries.push(query);
      const elements = query.includes('nightclub')
        ? [makeVenue(201, -122.243, 'Signal Room', 'nightclub'), makeVenue(202, -122.24, 'Tavern', 'pub')]
        : [makeVenue(103, -122.375, 'Out of range', 'restaurant'),
          makeVenue(102, -122.331, 'West-side kitchen', 'restaurant'),
          makeVenue(101, -122.24, 'Near the device', 'restaurant')];
      const request = new EventEmitter();
      request.setTimeout = () => request;
      setImmediate(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        callback(response);
        response.emit('data', JSON.stringify(providerUnavailable ? { elements: [], remark: 'runtime error: query timed out' } : { elements }));
        response.emit('end');
      });
      return request;
    },
  };
  const travelProviders = {
    ...require('./travel-providers'),
    async fetchTravelResource(value, options) {
      const url = new URL(value);
      assert.equal(url.origin, 'https://news.google.com');
      assert.equal(options.json, false);
      if (providerUnavailable) throw new Error('News provider unavailable');
      const bars = url.searchParams.get('q').includes('"new bar"');
      const title = bars ? 'A cocktail bar opens near the waterfront' : 'A new Italian restaurant opens downtown';
      return `<rss><channel><item><title>${title}</title><link>https://example.com/opening</link><description>The publisher reports on the opening and interviews the owners.</description><pubDate>${new Date(now).toUTCString()}</pubDate><source>City News</source></item></channel></rss>`;
    },
  };
  const dns = { promises: { async lookup(hostname) {
    assert.equal(hostname, 'example.com');
    return [{ address: '93.184.216.34', family: 4 }];
  } } };
  const app = await createAppHarness({ automaticLocation: false, clock: () => now, modules: { dns, https, './travel-providers': travelProviders },
    env: { TRUST_PROXY: 'loopback', CF_VISITOR_LOCATION_HEADERS: 'true' } });
  t.after(() => app.close());
  app.seedUser(member('alice', { roleSettings: { feedLocation: { country: 'FR', city: 'Paris' } } }));
  app.seedUser(member('bob'));
  const restaurants = '/office/feed?mode=restaurants&venueSearch=1';
  const byDevice = (lon, userId = 'alice', url = restaurants) => app.request(url, {
    userId, headers: { ...edge, 'x-ufi-device-location': gps(37.803, lon) },
  });

  const [alice, bob] = await Promise.all([byDevice(-122.243), byDevice(-122.231, 'bob')]);
  for (const result of [alice, bob]) {
    assert.equal(result.status, 200);
    assert.equal(result.data.locationContext.venueArea, 'device');
    assert.equal(result.data.locationContext.city, null);
    assert.equal(result.data.locationContext.radiusMiles, 5);
    assert.match(result.headers.get('cache-control'), /private.*no-store/);
  }
  const restaurantStory = alice.data.posts.find(post => post.id.startsWith('restaurant_opening_'))?.id;
  assert.ok(restaurantStory);
  assert.deepEqual(alice.data.posts.map(post => post.id), ['osm:node:101', 'osm:node:102', restaurantStory]);
  assert.deepEqual(bob.data.posts.map(post => post.id), ['osm:node:101', restaurantStory]);
  assert.equal(providerQueries.length, 1, 'users in one area share the provider request');
  assert.match(providerQueries[0], /around:12000,37\.8,-122\.25/);
  assert.ok(!JSON.stringify(alice.data).includes('-122.243'));
  assert.ok(!JSON.stringify(bob.data).includes('-122.231'));
  assert.equal(alice.data.posts[0].group.externalUrl, 'https://www.openstreetmap.org/node/101');

  const clubs = await byDevice(-122.243, 'alice', '/office/feed?mode=bars&venueSearch=1&q=club');
  assert.deepEqual(clubs.data.posts.map(post => post.id), ['osm:node:201']);
  assert.equal(providerQueries.length, 2);
  for (const [route, storyPrefix, firstPost] of [[restaurants, 'restaurant_opening_', 'osm:node:101'],
    ['/office/feed?mode=bars&venueSearch=1', 'bar_opening_', 'osm:node:201']]) {
    const first = await byDevice(-122.243, 'alice', route + '&limit=1');
    assert.deepEqual(first.data.posts.map(post => post.id), [firstPost]);
    const next = await byDevice(-122.243, 'alice', route + '&limit=1&cursor=' + encodeURIComponent(first.data.cursor));
    assert.equal(next.status, 200);
    assert.ok(next.data.posts.length);
    assert.notEqual(next.data.posts[0].id, firstPost);
    const full = await byDevice(-122.243, 'alice', route);
    const story = full.data.posts.find(post => post.id.startsWith(storyPrefix));
    assert.ok(story);
    assert.equal(Boolean(story.matchedByLocation), false);
    const read = await app.request('/posts/engaged', { userId: 'alice', method: 'POST', body: { postIds: [firstPost, story.id] } });
    assert.equal(read.status, 204);
    const reopened = await byDevice(-122.243, 'alice', route);
    assert.ok(reopened.data.posts.some(post => post.id === firstPost));
    assert.ok(reopened.data.posts.some(post => post.id === story.id));
  }
  for (const headers of [edge, { ...edge, 'x-ufi-device-location': gps(37.803, -122.243, 0, 5000) },
    { ...edge, 'x-ufi-device-location': gps(37.803, -122.243, 16 * 60000) }]) {
    const result = await app.request(restaurants, { userId: 'alice', headers });
    assert.equal(result.status, 200);
    assert.equal(result.data.locationContext.venueArea, 'unconfirmed');
    assert.equal(result.data.locationContext.city, null);
    assert.deepEqual(result.data.posts.map(post => post.id), [restaurantStory]);
    assert.equal(Boolean(result.data.posts[0].matchedByLocation), false);
  }
  assert.equal(providerQueries.length, 2, 'network, stale and imprecise locations never trigger nearby lookups');
  assert.equal((await app.request(restaurants)).status, 401);

  // Production's periodic prune leaves same-area results available during
  // an outage, but incomplete responses cannot overwrite or extend them.
  const cacheKey = 'venues:restaurants:37.8:-122.25';
  app.locationLiveFeedCache.get(cacheKey).expiresAt = now - 1;
  providerUnavailable = true;
  app.pruneExpiredRuntimeCaches();
  const cached = await byDevice(-122.243);
  assert.equal(cached.status, 200, JSON.stringify(cached.data));
  assert.deepEqual(cached.data.posts.map(post => post.id), ['osm:node:101', 'osm:node:102', restaurantStory]);
  assert.equal(cached.data.providerError, null);
  assert.equal(providerQueries.length, 3);
  const uncached = await byDevice(-118.243);
  assert.equal(uncached.status, 200, JSON.stringify(uncached.data));
  assert.deepEqual(uncached.data.posts.map(post => post.id), [restaurantStory]);
  assert.equal(uncached.data.providerError, null);
  const stale = app.locationLiveFeedCache.get(cacheKey);
  assert.ok(stale.staleUntil > now);
  stale.expiresAt = now - 1;
  stale.staleUntil = now - 1;
  app.locationLiveFeedCache.delete('restaurants:worldwide-openings');
  app.pruneExpiredRuntimeCaches();
  const expired = await byDevice(-122.243);
  assert.equal(expired.status, 200, JSON.stringify(expired.data));
  assert.deepEqual(expired.data.posts, []);
  assert.equal(expired.data.providerError, 'Nearby venue data is temporarily unavailable.');
});

test('web venue destinations require a unique city and accept a disambiguating region', async t => {
  const app = await createAppHarness({ automaticLocation: false });
  t.after(() => app.close());
  app.seedUser(member('alice', { roleSettings: { feedLocations: { restaurants: { country: 'FR', city: 'Paris' } } } }));
  const save = city => app.request('/profile?venueSearch=1', { userId: 'alice', method: 'PATCH',
    body: { roleSettings: { feedLocations: { restaurants: { country: 'US', city } } } } });

  const ambiguous = await save('Springfield');
  assert.equal(ambiguous.status, 422);
  assert.equal(ambiguous.data.code, 'venue_city_unconfirmed');
  assert.equal(app.users[0].roleSettings.feedLocations.restaurants.city, 'Paris');
  assert.equal((await save('Springfield, IL')).status, 200);
  const result = await app.request('/office/feed?mode=restaurants&venueSearch=1', { userId: 'alice' });
  assert.equal(result.status, 200, JSON.stringify(app.errors));
  assert.equal(result.data.locationContext.venueArea, 'city');
  assert.equal(result.data.locationContext.city, 'Springfield');
  assert.equal(result.data.locationContext.region, 'Illinois');
  assert.equal(result.data.locationContext.country, 'US');
});
