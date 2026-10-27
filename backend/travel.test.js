const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createAppHarness, member } = require('./test-support/app-harness');
const { ADDITIONAL_TRAVEL_DESTINATIONS } = require('./travel-destinations');
const providers = require('./travel-providers');
const cameraProviders = require('./travel-camera-providers');

async function harness(t, options) {
  const app = await createAppHarness(options);
  t.after(() => app.close());
  return app;
}

const verificationProvider = {
  id: 'camera_provider_gb_london_test', destinationId: 'GB:London', city: 'London',
  country: 'United Kingdom', countryCode: 'GB', title: 'Test city camera', operator: 'Test operator',
  sourceUrl: 'https://www.youtube.com/watch?v=oldCamera01',
  verification: { kind: 'youtube-provider', videoId: 'oldCamera01' },
};

async function cameraVerificationHarness(t, { clock, fetchResource, failVerifier = false, catalog = [verificationProvider] }) {
  let app;
  app = await harness(t, { clock, env: { YOUTUBE_API_KEY: 'test-key' }, modules: {
    './travel-camera-providers.json': catalog,
    './travel-providers': { ...providers, fetchTravelResource: async url => {
      app.setYouTubeCallReady();
      return fetchResource(new URL(url));
    } },
    './travel-camera-providers': { ...cameraProviders, createCameraProviderVerifier(catalog, options) {
      const verifier = cameraProviders.createCameraProviderVerifier(catalog, { ...options, now: clock });
      if (failVerifier) verifier.updateYouTubeStates = () => { throw new Error('Verifier unavailable'); };
      return verifier;
    } },
  } });
  return app;
}

test('failed camera verification backs off across cities until the exact two-minute expiry, then recovers', async t => {
  let now = Date.now();
  let failed = true;
  let calls = 0;
  const app = await cameraVerificationHarness(t, { clock: () => now, fetchResource: async url => {
    assert.equal(url.pathname, '/youtube/v3/videos');
    calls++;
    if (failed) throw new Error('Travel provider returned HTTP 403');
    return { items: [{ id: 'rnXIjl_Rzy4', liveStreamingDetails: { actualStartTime: '2026-09-01' }, status: { privacyStatus: 'public', embeddable: true } }] };
  } });
  for (const location of [
    { city: 'London', country: 'GB', available: true },
    { city: 'London', country: 'GB', available: true },
    { city: 'Paris', country: 'FR', available: true },
    { city: 'Tokyo', country: 'JP', available: true },
    { country: 'Japan', available: true }, null,
  ]) {
    assert.equal((await app.verifiedLiveCameraPosts(location)).length, 0);
    assert.equal(calls, 1, 'A different city cannot bypass the provider-wide failure backoff');
  }
  assert.equal(app.liveCameraVerificationState.status, 'degraded');
  assert.equal(app.liveCameraDiscoveryQueue.size, 0, 'An upstream failure must not spend discovery quota');
  now += 119999;
  await app.verifiedLiveCameraPosts({ city: 'Rome', country: 'IT', available: true });
  assert.equal(calls, 1, 'The failure snapshot remains valid immediately before expiry');
  now++;
  failed = false;
  const recovered = await app.verifiedLiveCameraPosts({ city: 'New York', country: 'US', available: true });
  assert.ok(calls > 1, 'Verification retries at the existing failure TTL, without an extra request delay');
  assert.ok(recovered.some(camera => camera.city === 'New York' && camera.liveVerified));
  assert.equal(app.liveCameraVerificationState.status, 'ready');
  const recoveredCalls = calls;
  await app.verifiedLiveCameraPosts({ city: 'New York', country: 'US', available: true });
  assert.equal(calls, recoveredCalls, 'Successful recovery uses the ordinary fresh proof cache');
});

test('a successful camera snapshot is rechecked when provider proofs expire before its three-minute TTL', async t => {
  let now = Date.now();
  let ended = false;
  let calls = 0;
  const app = await cameraVerificationHarness(t, { clock: () => now, fetchResource: async () => {
    calls++;
    return { items: ended ? [] : [{ id: 'rnXIjl_Rzy4', liveStreamingDetails: { actualStartTime: '2026-09-01' }, status: { privacyStatus: 'public', embeddable: true } }] };
  } });
  app.exhaustCameraDiscoveryBudget();
  assert.ok((await app.verifiedLiveCameraPosts()).some(camera => camera.city === 'New York'));
  const initialCalls = calls;
  now += 119999;
  await app.verifiedLiveCameraPosts();
  assert.equal(calls, initialCalls);
  now++;
  ended = true;
  assert.equal((await app.verifiedLiveCameraPosts()).length, 0, 'Expired provider proofs cannot leave an ended camera live');
  assert.ok(calls > initialCalls, 'Provider freshness still overrides the longer successful snapshot TTL');
  assert.equal(app.liveCameraVerificationState.status, 'ready', 'A successful empty result is not a provider outage');
});

test('successful empty verification still prioritizes each newly selected city', async t => {
  const now = Date.now();
  let calls = 0;
  const app = await cameraVerificationHarness(t, { clock: () => now, fetchResource: async () => {
    calls++;
    return { items: [] };
  } });
  await app.verifiedLiveCameraPosts({ city: 'London', country: 'GB', available: true });
  const initialCalls = calls;
  assert.equal(app.liveCameraVerificationState.status, 'ready');
  assert.ok([...app.liveCameraDiscoveryQueue.values()].some(entry => entry.camera.city === 'London' && entry.requested));
  await app.verifiedLiveCameraPosts({ city: 'Paris', country: 'FR', available: true });
  assert.ok(calls > initialCalls, 'Empty successful results retain selected-city refresh behavior');
  assert.ok([...app.liveCameraDiscoveryQueue.values()].some(entry => entry.camera.city === 'Paris' && entry.requested));
});

test('concurrent city requests share a failed verification without queuing discovery', async t => {
  const now = Date.now();
  let calls = 0;
  let started;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const app = await cameraVerificationHarness(t, { clock: () => now, fetchResource: async () => {
    calls++;
    started();
    await pending;
    throw new Error('Travel provider returned HTTP 403');
  } });
  const first = app.verifiedLiveCameraPosts({ city: 'London', country: 'GB', available: true });
  await entered;
  const second = app.verifiedLiveCameraPosts({ city: 'Paris', country: 'FR', available: true });
  release();
  assert.ok((await Promise.all([first, second])).every(posts => posts.length === 0));
  assert.equal(calls, 1);
  assert.equal(app.liveCameraVerificationState.status, 'degraded');
  assert.equal(app.liveCameraVerificationState.backgroundStatus, 'idle');
  assert.equal(app.liveCameraDiscoveryQueue.size, 0, 'A waiter cannot launch searches after shared verification failed');
});

test('unexpected verification errors use the same bounded failure backoff', async t => {
  let now = Date.now();
  let calls = 0;
  const app = await cameraVerificationHarness(t, { clock: () => now, failVerifier: true, fetchResource: async () => {
    calls++;
    return { items: [] };
  } });
  await app.verifiedLiveCameraPosts({ city: 'London', country: 'GB', available: true });
  const initialCalls = calls;
  assert.equal(app.liveCameraVerificationState.status, 'error');
  assert.ok(initialCalls > 0);
  await app.verifiedLiveCameraPosts({ city: 'Tokyo', country: 'JP', available: true });
  assert.equal(calls, initialCalls, 'An exception cannot bypass the global failure snapshot');
  now += 120000;
  await app.verifiedLiveCameraPosts({ city: 'Tokyo', country: 'JP', available: true });
  assert.ok(calls > initialCalls, 'Unexpected errors remain retryable after the existing TTL');
});

test('Travel resolves a restarted operator channel, verifies the replacement, and batches its new ID on refresh', async t => {
  let now = Date.now();
  const channelId = 'UCfVBWzBee1rnmR8AhT2Esng';
  const catalog = [{ ...verificationProvider, id: 'camera_provider_my_kl_test', destinationId: 'MY:Kuala_Lumpur',
    city: 'Kuala Lumpur', country: 'Malaysia', countryCode: 'MY',
    sourceUrl: `https://www.youtube.com/channel/${channelId}/live`,
    verification: { kind: 'youtube-provider', videoId: 'oldCamera01', channelId } }];
  const requests = [];
  const app = await cameraVerificationHarness(t, { clock: () => now, catalog, fetchResource: async url => {
    if (!url.hostname.endsWith('googleapis.com')) throw new Error('Optional provider unavailable');
    requests.push(url);
    if (url.pathname.endsWith('/search')) return { items: [
      { id: { videoId: 'wrongLive01' }, snippet: { channelId: 'UCn4oQ60oxfvq7aesEPYqpKw', liveBroadcastContent: 'live' } },
      { id: { videoId: 'newCamera02' }, snippet: { channelId, liveBroadcastContent: 'live' } },
    ] };
    return { items: url.searchParams.get('id').split(',').filter(id => ['oldCamera01', 'newCamera02'].includes(id)).map(id => ({
      id, liveStreamingDetails: { actualStartTime: '2026-09-01', ...(id === 'oldCamera01' ? { actualEndTime: '2026-09-02' } : {}) },
      status: { privacyStatus: 'public', embeddable: false },
    })) };
  } });
  const location = { city: 'Kuala Lumpur', country: 'MY', available: true };
  const first = await app.getCountriesCameraFeed(location);
  const camera = first.liveFeeds.find(post => post.id === catalog[0].id);
  assert.equal(camera?.liveVerified, true, 'The operator provider receives the newly verified ID, not the ended catalog ID');
  assert.equal(camera.livePlayback.kind, 'provider', 'Non-embeddable public streams remain operator links');
  assert.equal(camera.livePlayback.url, catalog[0].sourceUrl);
  const searches = requests.filter(url => url.pathname.endsWith('/search'));
  assert.equal(searches.length, 1);
  for (const [key, value] of Object.entries({ part: 'snippet', channelId, eventType: 'live', type: 'video', maxResults: '5', key: 'test-key' })) {
    assert.equal(searches[0].searchParams.get(key), value);
  }
  const searchIndex = requests.indexOf(searches[0]);
  assert.equal(requests[searchIndex + 1].searchParams.get('id'), 'newCamera02', 'Search snippets alone cannot make a replacement live');
  const beforeRefresh = requests.length;
  now += 120000;
  const refreshed = await app.getCountriesCameraFeed(location);
  const refreshedIds = requests.slice(beforeRefresh).filter(url => url.pathname.endsWith('/videos')).flatMap(url => url.searchParams.get('id').split(','));
  assert.ok(refreshedIds.includes('newCamera02'));
  assert.equal(refreshedIds.includes('oldCamera01'), false, 'The resolved candidate replaces the stale ID in normal status batching');
  assert.equal(requests.filter(url => url.pathname.endsWith('/search')).length, 1, 'A still-live replacement needs no new discovery');
  assert.equal(refreshed.liveFeeds.find(post => post.id === catalog[0].id)?.liveVerified, true);
});

test('Travel never searches an operator channel after the shared status batch fails', async t => {
  const requests = [];
  const app = await cameraVerificationHarness(t, { clock: Date.now,
    catalog: [{ ...verificationProvider, verification: { ...verificationProvider.verification, channelId: 'UCfVBWzBee1rnmR8AhT2Esng' } }],
    fetchResource: async url => { requests.push(url); throw new Error('Travel provider returned HTTP 403'); },
  });
  assert.equal((await app.verifiedLiveCameraPosts()).length, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].pathname, '/youtube/v3/videos');
  assert.equal(app.liveCameraVerificationState.status, 'degraded');
});

test('operator channel discovery shares the aggregate search budget and preserves selected-city reserves', async t => {
  for (const mode of ['exhausted', 'reserved-background', 'reserved-selected']) {
    let searches = 0;
    const app = await cameraVerificationHarness(t, { clock: Date.now,
      catalog: [{ ...verificationProvider, verification: { ...verificationProvider.verification, channelId: 'UCfVBWzBee1rnmR8AhT2Esng' } }],
      fetchResource: async url => {
        if (url.pathname.endsWith('/search')) searches++;
        return { items: [] };
      },
    });
    if (mode === 'exhausted') app.exhaustCameraDiscoveryBudget();
    else app.reserveCameraDiscoveryBudget();
    const selected = mode !== 'reserved-background' ? { city: 'London', country: 'GB', available: true } : null;
    await app.verifiedLiveCameraPosts(selected);
    assert.equal(searches, mode === 'reserved-selected' ? 1 : 0, mode);
    assert.equal(app.liveCameraVerificationState.status, 'ready', 'Budget exhaustion must not invalidate a successful status batch');
  }
});

test('Travel adds 50 unique guide cities and exposes all 91 destinations', async t => {
  const app = await harness(t);
  assert.equal(ADDITIONAL_TRAVEL_DESTINATIONS.length, 50);
  const response = await app.request('/travel/destinations');
  assert.equal(response.status, 200);
  const list = response.data.destinations;
  assert.equal(list.length, 91);
  assert.equal(new Set(list.map(d => `${d.countryCode}:${d.city}`)).size, 91);
  assert.ok(list.every(d => d.guideUrl.startsWith('https://en.wikivoyage.org/wiki/')));
  for (const destination of list) {
    assert.ok(app.LIVE_CAMERA_CATALOG.some(camera => app.travelCityMatches(camera, destination)),
      `${destination.city} must participate in live-camera discovery`);
    const search = new URL(destination.liveCameraSearchUrl);
    assert.equal(search.origin, 'https://www.youtube.com');
    assert.equal(search.searchParams.get('search_query'), `${destination.city} ${destination.country} live webcam`);
    assert.equal(search.searchParams.get('sp'), 'EgJAAQ==');
  }
  assert.match(list.find(d => d.city === 'Queenstown').guideUrl, /Queenstown_\(New_Zealand\)/);
  assert.match(list.find(d => d.city === 'Oaxaca').guideUrl, /Oaxaca_\(city\)/);
  for (const stream of require('./travel-camera-streams.json')) {
    const destination=list.find(city=>city.id===stream.destinationId);
    assert.ok(destination,'operator cameras must belong to the published city catalog');
    assert.equal(destination.city,stream.city);
    assert.equal(destination.countryCode,stream.countryCode);
    assert.equal(stream.sourceUrl,'https://www.youtube.com/watch?v='+stream.videoId);
  }
});

test('city matching is exact, accent-insensitive, and country-aware', async t => {
  const app = await harness(t);
  const paris = { city: 'Paris', country: 'France', countryCode: 'FR' };
  assert.equal(app.travelCityMatches(paris, { city: 'Paris', country: 'FR' }), true);
  assert.equal(app.travelCityMatches(paris, { city: 'Paris', country: 'US' }), false);
  assert.equal(app.travelCityMatches(paris, { city: 'Par' }), false);
  assert.equal(app.travelCityMatches({ city: 'San Jose', countryCode: 'CR' }, { city: 'San Jos\u00e9', country: 'CR' }), true);
  assert.equal(app.selectedTravelGuideDestinations({ city: 'London', country: 'CA', countryName: 'Canada' })[0].searchOnly, true);
});

test('every published city can return its own verified feed without search quota', async t => {
  const candidates = [];
  let app;
  app = await harness(t, { env: { YOUTUBE_API_KEY: 'test-key' }, modules: {
    './travel-camera-streams.json': candidates,
    './travel-camera-providers.json': [],
    './travel-providers': { ...providers, fetchTravelResource: async url => {
      assert.ok(url.includes('/videos?'), 'catalog coverage does not require discovery searches');
      app.setYouTubeCallReady();
      const ids = new URL(url).searchParams.get('id').split(',');
      return { items: ids.filter(id => candidates.some(camera => camera.videoId === id)).map(id => ({
        id, liveStreamingDetails: { actualStartTime: '2026-09-01' },
        status: { privacyStatus: 'public', embeddable: true },
      })) };
    } },
  } });
  const destinations = (await app.request('/travel/destinations')).data.destinations;
  candidates.push(...destinations.map((destination, index) => ({
    ...destination, videoId: `cam${String(index).padStart(8, '0')}`, title: `${destination.city} camera`,
  })));
  app.exhaustCameraDiscoveryBudget();
  const result = await app.getCountriesCameraFeed(null);
  assert.equal(result.liveFeeds.length, 91);
  for (const destination of destinations) {
    const feeds = result.liveFeeds.filter(camera => app.travelCityMatches(camera, destination));
    assert.equal(feeds.length, 1, `${destination.city} has one city-specific feed`);
    assert.equal(feeds[0].liveVerified, true);
  }
});

test('every catalog city has an in-app guide endpoint; unknown IDs cannot fetch a URL', async t => {
  let requests=0;
  const app = await harness(t,{modules:{'./travel-providers':{...providers,fetchTravelResource:async url=>{
    requests++;
    const title=new URL(url).searchParams.get('titles');
    return {query:{pages:[{ns:0,title,extract:'A city overview.\n\n== See ==\nExplore the city.'}]}};
  }}}});
  const list=(await app.request('/travel/destinations')).data.destinations;
  for(const city of list) {
    const guide=await app.request('/travel/guides/'+encodeURIComponent(city.id));
    assert.equal(guide.status,200); assert.equal(guide.data.id,city.id);
    assert.equal(guide.data.available,true); assert.equal(guide.data.sections.length,2);
  }
  assert.equal(requests,91);
  assert.equal((await app.request('/travel/guides/'+encodeURIComponent('https://example.invalid/'))).status,404);
  assert.equal(requests,91);
});

test('unknown cities use a country-qualified guide search without guessing a page', async t => {
  let calls = 0;
  const app = await harness(t, { modules: { './travel-providers': { ...providers, fetchTravelResource: async () => { calls++; throw new Error('unexpected request'); } } } });
  const result = await app.fetchTravelGuidePosts(app.selectedTravelGuideDestinations({ city: 'London', country: 'CA', countryName: 'Canada' }));
  assert.equal(calls, 0);
  assert.equal(new URL(result[0].sourceUrl).searchParams.get('search'), 'London Canada');
  assert.equal(result[0].mediaUrl, null);
});

test('a provider outage still returns paginated guides for every catalog city without duplicates', async t => {
  const app = await harness(t);
  app.seedUser(member('traveler'));
  let cursor = '';
  const ids = new Set();
  for (let page = 1; page <= 12; page++) {
    const result = await app.request(`/office/feed?mode=countries&limit=20&page=${page}&cursor=${encodeURIComponent(cursor)}`, { userId: 'traveler' });
    assert.equal(result.status, 200);
    assert.equal(result.data.travel.destinationCount, 91);
    assert.equal(result.data.travel.cameraStatus, 'degraded');
    assert.equal(result.data.liveFeeds.length, 0);
    for (const post of result.data.posts) {
      assert.equal(ids.has(post.id), false, 'a guide must not repeat across pages');
      assert.match(post.travelDestinationId, /^[A-Z]{2}:/, 'feed guide cards keep their in-app destination');
      ids.add(post.id);
    }
    if (!result.data.hasMore) break;
    cursor = result.data.cursor;
  }
  assert.equal(ids.size, 91);
});

test('cold Travel responds without waiting for guide and news providers', async t => {
  const app = await harness(t, { modules: { './travel-providers': { ...providers, fetchTravelResource: () => new Promise(() => {}) } } });
  const result = await Promise.race([
    app.getCountriesCameraFeed({ city: 'Seattle', country: 'US', countryName: 'United States', source: 'member', available: true }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Travel waited for an optional provider')), 500); timer.unref(); }),
  ]);
  assert.equal(result.posts.length, 1, 'a saved city keeps its own guide during a provider outage');
  assert.equal(result.posts[0].city, 'Seattle');
  assert.equal(result.travel.storiesUpdating, true);
  assert.equal(app.locationLiveFeedCache.has('countries:vacation-discovery'), false, 'a selected city does not fetch the unrelated worldwide pool');
});

test('an automatic network city scopes Travel picks without saving a member destination', async t => {
  const app = await harness(t, { env: { TRUST_PROXY: 'loopback', CF_VISITOR_LOCATION_HEADERS: 'true' } });
  const traveler = member('automatic-traveler');
  app.seedUser(traveler);
  const result = await app.request('/office/feed?mode=countries&limit=20', { userId: traveler.id,
    headers: { 'x-forwarded-for': '203.0.113.45, 173.245.48.20', 'cf-ipcountry': 'US', 'cf-ipcity': 'Seattle' } });
  assert.equal(result.status, 200);
  assert.equal(result.data.posts.length, 1);
  assert.equal(result.data.posts[0].city, 'Seattle');
  assert.equal(result.data.posts[0].countryCode, 'US');
  assert.equal(result.data.equalizer.selectedLocation, 'Seattle, United States');
  assert.equal(result.data.location.source, 'network');
  assert.equal(result.data.location.savedForMember, false);
  assert.equal(app.locationLiveFeedCache.has('countries:vacation-discovery'), false, 'first-visit city picks must not fetch the worldwide pool');
  assert.deepEqual(traveler.roleSettings, {}, 'automatic city selection does not save a profile preference');
});

test('selected Travel picks stay in their destination across pagination, member changes and city switches', async t => {
  const app = await harness(t);
  app.seedUser(member('city-traveler'));
  app.seedUser(member('other-traveler', { roleSettings: { feedLocations: { countries: { country: 'France', city: 'Paris' } } } }));
  const select = async selection => {
    const result = await app.request('/profile', { userId: 'city-traveler', method: 'PATCH',
      body: { roleSettings: { feedLocations: { countries: selection } } } });
    assert.equal(result.status, 200);
  };
  await select({ country: 'Japan', city: '' });
  const country = await app.request('/office/feed?mode=countries&limit=1', { userId: 'city-traveler' });
  assert.equal(country.status, 200);
  assert.equal(country.data.posts.length, 1);
  assert.equal(country.data.posts[0].countryCode, 'JP');
  assert.equal(country.data.hasMore, true);
  const next = await app.request(`/office/feed?mode=countries&limit=1&page=2&cursor=${encodeURIComponent(country.data.cursor)}`, { userId: 'city-traveler' });
  assert.equal(next.data.posts.length, 1);
  assert.equal(next.data.posts[0].countryCode, 'JP');
  assert.notEqual(next.data.posts[0].id, country.data.posts[0].id);

  await select({ country: 'United States', city: 'Seattle' });
  const selected = await app.request(`/office/feed?mode=countries&limit=20&cursor=${encodeURIComponent(country.data.cursor)}`, { userId: 'city-traveler' });
  assert.equal(selected.status, 200);
  assert.equal(selected.data.posts.length, 1, 'an old destination cursor cannot introduce worldwide picks');
  assert.equal(selected.data.posts[0].city, 'Seattle');
  assert.equal(selected.data.posts[0].countryCode, 'US');
  assert.equal(selected.data.hasMore, false);
  assert.match(selected.headers.get('cache-control'), /private.*no-store/, 'member Travel retains the outside privacy fix');

  const other = await app.request('/office/feed?mode=countries&limit=20', { userId: 'other-traveler' });
  assert.equal(other.data.posts.length, 1);
  assert.equal(other.data.posts[0].city, 'Paris');
  assert.equal(other.data.posts[0].countryCode, 'FR');
  const reload = await app.request('/office/feed?mode=countries&limit=20', { userId: 'city-traveler' });
  assert.equal(reload.data.location.city, 'Seattle');
  assert.ok(reload.data.posts.every(post => post.city === 'Seattle' && post.countryCode === 'US'));

  await select({ country: 'Canada', city: 'London' });
  const sameName = await app.request('/office/feed?mode=countries&limit=20', { userId: 'city-traveler' });
  assert.equal(sameName.data.posts.length, 1);
  assert.equal(sameName.data.posts[0].city, 'London');
  assert.equal(sameName.data.posts[0].countryCode, 'CA', 'same-named cities in another country cannot become selected picks');
});

test('strict selected picks keep the verified city catalog separate and reject unrelated cached stories', async t => {
  let app;
  app = await harness(t, { env: { YOUTUBE_API_KEY: 'test-key' }, modules: { './travel-camera-providers.json': [], './travel-providers': { ...providers, fetchTravelResource: async url => {
    assert.ok(url.includes('/videos?'), 'warm selected picks need no worldwide discovery or search request');
    app.setYouTubeCallReady();
    return { items: [{ id: 'rnXIjl_Rzy4', liveStreamingDetails: { actualStartTime: '2026-09-01' }, status: { privacyStatus: 'public', embeddable: true } }] };
  } } } });
  const stories = [
    { id: 'paris-fr', city: 'Paris', country: 'France', countryCode: 'FR', source: 'travelnews' },
    { id: 'paris-us', city: 'Paris', country: 'United States', countryCode: 'US', source: 'travelnews' },
    { id: 'lyon-fr', city: 'Lyon', country: 'France', countryCode: 'FR', source: 'travelevents' },
    { id: 'unknown', source: 'travelnews' },
  ];
  app.locationLiveFeedCache.set('countries:selected:paris:france', { posts: stories, expiresAt: Date.now() + 60000 });
  const selected = await app.getCountriesCameraFeed({ city: 'Paris', country: 'FR', countryName: 'France', source: 'member', available: true });
  assert.equal(selected.posts.length, 1);
  assert.equal(selected.posts[0].id, 'paris-fr');
  assert.equal(selected.liveFeeds.length, 1, 'verified cameras remain available for manual city navigation');
  assert.equal(selected.liveFeeds[0].city, 'New York', 'the camera catalog retains each actual location');
  assert.equal(selected.liveFeeds[0].liveVerified, true);
  assert.equal(selected.travel.localCameraAvailable, false);
});

test('profile location persists, applies to Travel, and can be cleared', async t => {
  const app = await harness(t);
  app.seedUser(member('location-member'));
  const saved = await app.request('/profile', { userId: 'location-member', method: 'PATCH', body: { roleSettings: { feedLocation: { city: 'Seattle', country: 'United States' } } } });
  assert.equal(saved.status, 200);
  const feed = await app.request('/office/feed?mode=countries&limit=20&city=Paris&country=FR', { userId: 'location-member' });
  assert.equal(feed.data.location.city, 'Seattle');
  assert.equal(feed.data.location.savedForMember, true);
  assert.ok(feed.data.posts.some(post => post.city === 'Seattle' && post.matchedByLocation));
  await app.request('/profile', { userId: 'location-member', method: 'PATCH', body: { roleSettings: { feedLocation: { city: '', country: '' } } } });
  const clear = await app.request('/office/feed?mode=countries&limit=20', { userId: 'location-member' });
  assert.equal(clear.data.location.city, null);
  assert.equal(clear.data.location.savedForMember, false);
});

test('city news and event queries cannot relabel unrelated country-wide stories as local', async t => {
  const xml = '<rss><channel>' + [
    ['Seattle things to do festival', 'Seattle travel guide and music events'],
    ['Miami things to do festival', 'United States travel guide and events'],
    ['Seattleville things to do festival', 'United States travel guide'],
  ].map(([title, description], i) => `<item><title>${title}</title><description>${description}</description><link>https://example.org/story/${i}</link><source>City paper</source></item>`).join('') + '</channel></rss>';
  const app = await harness(t, { modules: { './travel-providers': { ...providers, fetchTravelResource: async () => xml } } });
  const location = { city: 'Seattle', country: 'US', countryName: 'United States', available: true, source: 'member' };
  assert.match(app.selectedTravelNewsEdition(location).query, /"Seattle" "United States"/);
  const news = await app.fetchSelectedTravelNewsPosts(location);
  const events = await app.fetchSelectedTravelEventPosts(location);
  assert.equal(news.length, 1);
  assert.equal(events.length, 1);
  assert.match(news[0].title, /^Seattle /);
});

test('live verification checks every ID in batches, including cities beyond the first 50', async t => {
  const batches = [];
  let app;
  app = await harness(t, { env: { YOUTUBE_API_KEY: 'test-key' }, modules: { './travel-providers': { ...providers, fetchTravelResource: async url => {
    const ids = new URL(url).searchParams.get('id').split(',');
    batches.push(ids);
    app.setYouTubeCallReady();
    return { items: ids.map(id => ({ id, liveStreamingDetails: { actualStartTime: '2026-09-01T00:00:00Z' }, status: { privacyStatus: 'public', embeddable: true } })) };
  } } } });
  const ids = Array.from({ length: 117 }, (_, i) => `camera${String(i).padStart(5, '0')}`);
  const states = await app.fetchYouTubeLiveStates(ids);
  assert.deepEqual(batches.map(batch => batch.length), [50, 50, 17]);
  assert.equal(states.size, 117);
  assert.equal(states.get(ids[116]).live, true);
});

test('ended, private, and non-embeddable streams never enter the live rail', async t => {
  let app;
  app = await harness(t, { env: { YOUTUBE_API_KEY: 'test-key' }, modules: { './travel-providers': { ...providers, fetchTravelResource: async url => {
    if (!url.includes('googleapis.com')) throw new Error('optional provider unavailable');
    app.setYouTubeCallReady();
    return { items: [
      { id: 'rnXIjl_Rzy4', liveStreamingDetails: { actualStartTime: '2026-09-01' }, status: { privacyStatus: 'public', embeddable: true } },
      { id: 'UUhTr19MH0k', liveStreamingDetails: { actualStartTime: '2026-09-01', actualEndTime: '2026-09-02' }, status: { privacyStatus: 'public', embeddable: true } },
      { id: 'j9Sa4uBGGQ0', liveStreamingDetails: { actualStartTime: '2026-09-01' }, status: { privacyStatus: 'public', embeddable: false } },
      { id: 'Fy8_xLMkAXc', liveStreamingDetails: { actualStartTime: '2026-09-01' }, status: { privacyStatus: 'private', embeddable: true } },
    ] };
  } } } });
  const result = await app.getCountriesCameraFeed(null);
  assert.equal(result.liveFeeds.length, 1);
  assert.equal(result.liveFeeds[0].city, 'New York');
  assert.equal(result.liveFeeds[0].liveVerified, true);
});

test('replacement discovery rejects unrelated streams before verifying candidates', async t => {
  let app;
  app = await harness(t, { env: { YOUTUBE_API_KEY: 'test-key' }, modules: { './travel-providers': { ...providers, fetchTravelResource: async url => {
    app.setYouTubeCallReady();
    if (url.includes('/search?')) return { items: [
      { id: { videoId: 'wrongcity01' }, snippet: { title: 'Paris live webcam', liveBroadcastContent: 'live' } },
      { id: { videoId: 'musicradio1' }, snippet: { title: 'London relaxing music radio 24/7 live stream', liveBroadcastContent: 'live' } },
      { id: { videoId: 'j9Sa4uBGGQ0' }, snippet: { title: 'London live webcam United Kingdom', liveBroadcastContent: 'live' } },
    ] };
    const ids = new URL(url).searchParams.get('id').split(',');
    assert.deepEqual(ids, ['j9Sa4uBGGQ0']);
    return { items: [{ id: ids[0], liveStreamingDetails: { actualStartTime: '2026-09-01' }, status: { privacyStatus: 'public', embeddable: true } }] };
  } } } });
  const stream = await app.discoverLiveCameraReplacement(app.LIVE_CAMERA_CATALOG.find(camera => camera.city === 'London'));
  assert.equal(stream.videoId, 'j9Sa4uBGGQ0');
});

test('operator cameras stay available without search quota and still require live embedding permission', async t => {
  const candidates = [
    {city:'Paris',country:'France',countryCode:'FR',videoId:'parisLive01',title:'Paris river camera',channelTitle:'Camera operator'},
    {city:'Paris',country:'France',countryCode:'FR',videoId:'parisLive02',title:'Paris street camera',channelTitle:'Street operator'},
    {city:'Paris',country:'France',countryCode:'FR',videoId:'parisLive02'},
    {city:'Paris',country:'France',countryCode:'FR',videoId:'parisPriv01'},
    {city:'Paris',country:'United States',countryCode:'US',videoId:'parisTex001'},
    {city:'London',country:'United Kingdom',countryCode:'GB',videoId:'londonPriv1'},
    {city:'Tokyo',country:'Japan',countryCode:'JP',videoId:'tkyEnded001'},
    {city:'Sydney',country:'Australia',countryCode:'AU',videoId:'sydneyNoEmb'},
  ];
  const checked = new Set();
  let app;
  app = await harness(t, {env:{YOUTUBE_API_KEY:'test-key'},modules:{
    './travel-camera-streams.json':candidates,
    './travel-camera-providers.json':[],
    './travel-providers':{...providers,fetchTravelResource:async url => {
      assert.ok(url.includes('/videos?'),'known operator streams need no search calls');
      app.setYouTubeCallReady();
      const ids = new URL(url).searchParams.get('id').split(',');
      ids.forEach(id=>checked.add(id));
      return {items:ids.filter(id=>candidates.some(stream=>stream.videoId===id)).map(id=>({id,
        liveStreamingDetails:{actualStartTime:'2026-09-01',...(id==='tkyEnded001'?{actualEndTime:'2026-09-02'}:{})},
        status:{privacyStatus:['londonPriv1','parisPriv01'].includes(id)?'private':'public',embeddable:id!=='sydneyNoEmb'},
      }))};
    }},
  }});
  app.exhaustCameraDiscoveryBudget();
  const result = await app.getCountriesCameraFeed(null);
  assert.ok(candidates.every(stream=>checked.has(stream.videoId)));
  assert.equal(result.liveFeeds.length,1);
  const camera = result.liveFeeds[0];
  assert.equal(camera.city,'Paris');
  assert.equal(camera.title,'Paris river camera');
  assert.equal(camera.liveStreamChannel,'Camera operator');
  assert.equal(camera.sourceUrl,'https://www.youtube.com/watch?v=parisLive01');
  assert.match(camera.content,/Paris, France/);
  assert.equal(camera.liveVerified,true);
  assert.equal(camera.liveAlternates.length,1,'alternates are distinct public, embeddable streams in the same city and country');
  assert.equal(camera.liveAlternates[0].sourceUrl,'https://www.youtube.com/watch?v=parisLive02');
  assert.equal(camera.liveAlternates[0].title,'Paris street camera');
  assert.equal(camera.liveAlternates[0].liveVerified,true);
});

test('cached discovered streams survive short verification expiry and exhausted search budget', async t => {
  let app;
  app = await harness(t, { env: { YOUTUBE_API_KEY: 'test-key' }, modules: { './travel-providers': { ...providers, fetchTravelResource: async url => {
    assert.ok(url.includes('/videos?'), 'reverification must not spend another search slot');
    app.setYouTubeCallReady();
    return { items: [{ id: 'j9Sa4uBGGQ0', liveStreamingDetails: { actualStartTime: '2026-09-01' }, status: { privacyStatus: 'public', embeddable: true } }] };
  } } } });
  const camera = app.LIVE_CAMERA_CATALOG.find(item => item.id === 'camera_seattle');
  app.liveCameraDiscoveryCache.set(camera.id, { expiresAt: Date.now() + 60000, stream: { videoId: 'j9Sa4uBGGQ0', sourceUrl: 'https://www.youtube.com/watch?v=j9Sa4uBGGQ0', replacement: true } });
  app.exhaustCameraDiscoveryBudget();
  const post = app.currentLiveCameraPosts().find(item => item.id === camera.id);
  assert.equal(post.liveVerified, false);
  assert.match(post.sourceUrl, /j9Sa4uBGGQ0/);
  const result = await app.resolveLiveCameraDiscoveries([post], 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].liveVerified, true);
});

test('Travel provider requests enforce a real timeout and sanitize upstream errors', async t => {
  const server = http.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  await assert.rejects(providers.fetchTravelResource(`http://127.0.0.1:${server.address().port}`, { timeoutMs: 25 }), /timeout|aborted/i);
  await assert.rejects(providers.fetchTravelResource('https://example.invalid/?key=private', {
    fetchImpl: async () => ({ ok: false, status: 403 }),
  }), error => error.message === 'Travel provider returned HTTP 403');
});
