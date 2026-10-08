const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createAppHarness, member } = require('./test-support/app-harness');
const { ADDITIONAL_TRAVEL_DESTINATIONS } = require('./travel-destinations');
const providers = require('./travel-providers');

async function harness(t, options) {
  const app = await createAppHarness(options);
  t.after(() => app.close());
  return app;
}

test('Travel adds 50 unique guide cities and exposes all 91 destinations', async t => {
  const app = await harness(t);
  assert.equal(ADDITIONAL_TRAVEL_DESTINATIONS.length, 50);
  const response = await app.request('/travel/destinations');
  assert.equal(response.status, 200);
  const list = response.data.destinations;
  assert.equal(list.length, 91);
  assert.equal(new Set(list.map(d => `${d.countryCode}:${d.city}`)).size, 91);
  assert.ok(list.every(d => d.guideUrl.startsWith('https://en.wikivoyage.org/wiki/')));
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

test('strict selected picks keep verified fallback cameras separate and reject unrelated cached stories', async t => {
  let app;
  app = await harness(t, { env: { YOUTUBE_API_KEY: 'test-key' }, modules: { './travel-providers': { ...providers, fetchTravelResource: async url => {
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
  assert.equal(selected.liveFeeds.length, 1, 'a city without its own camera retains a verified fallback');
  assert.equal(selected.liveFeeds[0].city, 'New York', 'fallback retains its actual location');
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
    {city:'London',country:'United Kingdom',countryCode:'GB',videoId:'londonPriv1'},
    {city:'Tokyo',country:'Japan',countryCode:'JP',videoId:'tkyEnded001'},
    {city:'Sydney',country:'Australia',countryCode:'AU',videoId:'sydneyNoEmb'},
  ];
  const checked = new Set();
  let app;
  app = await harness(t, {env:{YOUTUBE_API_KEY:'test-key'},modules:{
    './travel-camera-streams.json':candidates,
    './travel-providers':{...providers,fetchTravelResource:async url => {
      assert.ok(url.includes('/videos?'),'known operator streams need no search calls');
      app.setYouTubeCallReady();
      const ids = new URL(url).searchParams.get('id').split(',');
      ids.forEach(id=>checked.add(id));
      return {items:ids.filter(id=>candidates.some(stream=>stream.videoId===id)).map(id=>({id,
        liveStreamingDetails:{actualStartTime:'2026-09-01',...(id==='tkyEnded001'?{actualEndTime:'2026-09-02'}:{})},
        status:{privacyStatus:id==='londonPriv1'?'private':'public',embeddable:id!=='sydneyNoEmb'},
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
