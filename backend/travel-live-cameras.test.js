const test = require('node:test');
const assert = require('node:assert/strict');
const { completeTravelCameraCatalog, travelCameraSearchUrl, queueCameraDiscoveries, nextCameraDiscovery } = require('./travel-live-cameras');

test('new guide cities join camera discovery without inventing playable URLs', () => {
  const paris = { id: 'paris', city: 'Paris', countryCode: 'FR', sourceUrl: 'known-camera' };
  const catalog = completeTravelCameraCatalog([paris], [
    { slug: 'Paris', city: 'Paris', country: 'France', countryCode: 'FR' },
    { slug: 'Banff', city: 'Banff', country: 'Canada', countryCode: 'CA' },
    { slug: 'Paris_(Texas)', city: 'Paris', country: 'United States', countryCode: 'US' },
  ]);
  assert.equal(catalog.length, 3);
  assert.equal(catalog[0], paris);
  assert.equal(catalog[1].city, 'Banff');
  assert.equal(catalog[1].sourceUrl, null);
  assert.equal(catalog[1].discoveryOnly, true);
  assert.equal(catalog[2].countryCode, 'US');
  assert.equal(new Set(catalog.map(camera => camera.id)).size, 3);
});

test('camera search always includes the selected country and encodes city text', () => {
  const url = new URL(travelCameraSearchUrl({ city: 'London & surroundings', country: 'Canada' }));
  assert.equal(url.origin, 'https://www.youtube.com');
  assert.equal(url.searchParams.get('search_query'), 'London & surroundings Canada live webcam');
  assert.equal(url.searchParams.get('sp'), 'EgJAAQ==');
});

test('a city selected during another discovery run goes ahead of rotation', () => {
  const queue = new Map();
  const rotating = { id: 'rotation' };
  const london = { id: 'london' };
  const banff = { id: 'banff' };
  queueCameraDiscoveries(queue, [rotating, london]);
  assert.equal(nextCameraDiscovery(queue, 24, 8), rotating);
  queueCameraDiscoveries(queue, [banff], true);
  assert.equal(nextCameraDiscovery(queue, 23, 8), banff);
  assert.equal(nextCameraDiscovery(queue, 22, 8), london);
});

test('rotation cannot consume reserved city slots or demote an existing city request', () => {
  const queue = new Map();
  const selected = { id: 'selected' };
  queueCameraDiscoveries(queue, [selected], true);
  queueCameraDiscoveries(queue, [selected, { id: 'rotation' }]);
  assert.equal(queue.size, 2);
  assert.equal(nextCameraDiscovery(queue, 8, 8), selected);
  assert.equal(nextCameraDiscovery(queue, 7, 8), null);
  queueCameraDiscoveries(queue, [selected], true);
  assert.equal(nextCameraDiscovery(queue, 0, 8), null);
  assert.equal(queue.size, 2);
});
