const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness } = require('./test-support/app-harness');
const cameraProviders = require('./travel-camera-providers');
const travelProviders = require('./travel-providers');
const camera = { id: 'camera_provider_hr_dubrovnik_test', destinationId: 'HR:Dubrovnik', city: 'Dubrovnik', country: 'Croatia', countryCode: 'HR', title: 'Dubrovnik public camera', operator: 'City of Dubrovnik', sourceUrl: 'https://www.dubrovnik.hr/web-kamere/ilijina-glavica', verification: { kind: 'youtube-provider', videoId: 'retained001' } };
const location = { city: 'Dubrovnik', country: 'HR', countryCode: 'HR', countryName: 'Croatia', available: true, source: 'member' };

test('a verified external camera survives the YouTube outage path and serialization with correct attribution', async t => {
  const row = { ...camera, liveVerified: true, providerStatus: 'live', liveCheckedAt: new Date().toISOString(), livePlayback: { kind: 'provider', url: camera.sourceUrl, providerName: camera.operator } };
  const app = await createAppHarness({ modules: {
    './travel-camera-providers': { ...cameraProviders, createCameraProviderVerifier: () => ({ read: () => [row], snapshot: () => [row], youtubeIds: [], updateYouTubeStates() {}, youtubeStatesFresh: () => true }) },
  } });
  t.after(() => app.close());
  const result = await app.getCountriesCameraFeed(location);
  assert.equal(result.liveFeeds.length, 1);
  assert.equal(result.liveFeeds[0].sourceUrl, camera.sourceUrl);
  assert.equal(result.liveFeeds[0].mediaUrl, null);
  assert.equal(result.liveFeeds[0].livePlayback.providerName, camera.operator);
  assert.equal(result.travel.localCameraAvailable, true);
  assert.equal(result.travel.cameraStatus, 'ready');
  assert.equal(result.travel.verifiedCameraCities, 1);
});

test('an available but unverified operator page stays in provider choices and never becomes a live feed', async t => {
  const row = { ...camera, liveVerified: false, providerStatus: 'unverified' };
  const app = await createAppHarness({ modules: {
    './travel-camera-providers': { ...cameraProviders, createCameraProviderVerifier: () => ({ read: () => [row], snapshot: () => [row], youtubeIds: [], updateYouTubeStates() {}, youtubeStatesFresh: () => true }) },
  } });
  t.after(() => app.close());
  const result = await app.getCountriesCameraFeed(location);
  assert.equal(result.liveFeeds.length, 0);
  assert.equal(result.travel.cameraProviders.length, 1);
  assert.equal(result.travel.localCameraAvailable, false);
  assert.equal(result.travel.verifiedCameraCities, 0);
});

test('public non-embeddable YouTube operator cameras reuse the existing batch and play only on the provider', async t => {
  let app; let videoBatches = 0;
  app = await createAppHarness({ env: { YOUTUBE_API_KEY: 'test-key' }, modules: {
    './travel-camera-providers.json': [camera], './travel-camera-streams.json': [],
    './travel-providers': { ...travelProviders, fetchTravelResource: async url => {
      if (!url.includes('/videos?')) throw new Error('Optional provider unavailable');
      videoBatches++; app.setYouTubeCallReady();
      const ids = new URL(url).searchParams.get('id').split(',');
      return { items: ids.includes('retained001') ? [{ id: 'retained001', liveStreamingDetails: { actualStartTime: '2026-10-24' }, status: { privacyStatus: 'public', embeddable: false } }] : [] };
    } },
  } });
  t.after(() => app.close()); app.exhaustCameraDiscoveryBudget();
  const result = await app.getCountriesCameraFeed(location);
  assert.equal(result.liveFeeds.length, 1); assert.equal(result.liveFeeds[0].id, camera.id);
  assert.equal(result.liveFeeds[0].livePlayback.kind, 'provider'); assert.equal(result.liveFeeds[0].liveVerified, true);
  assert.equal(videoBatches, 1, 'all existing IDs and the one provider ID fit the same batch');
});

test('expired provider YouTube status forces a shared refresh even while the main camera cache is valid', async t => {
  let app; let calls = 0; let now = Date.now(); let online = true;
  const service = cameraProviders.createCameraProviderVerifier([camera], { now: () => now });
  app = await createAppHarness({ env: { YOUTUBE_API_KEY: 'test-key' }, modules: {
    './travel-camera-providers.json': [camera], './travel-camera-streams.json': [],
    './travel-camera-providers': { ...cameraProviders, createCameraProviderVerifier: () => service },
    './travel-providers': { ...travelProviders, fetchTravelResource: async url => {
      if (!url.includes('/videos?')) throw new Error('Optional provider unavailable');
      calls++; app.setYouTubeCallReady();
      return { items: online ? [{ id: 'retained001', liveStreamingDetails: { actualStartTime: '2026-10-24' }, status: { privacyStatus: 'public', embeddable: false } }] : [] };
    } },
  } });
  t.after(() => app.close()); app.exhaustCameraDiscoveryBudget();
  assert.equal((await app.getCountriesCameraFeed(location)).liveFeeds.length, 1);
  assert.equal((await app.getCountriesCameraFeed(location)).liveFeeds.length, 1);
  assert.equal(calls, 1, 'repeat reads use the shared status cache');
  now += 180001; online = false;
  const ended = await app.getCountriesCameraFeed(location);
  assert.equal(calls, 2); assert.equal(ended.liveFeeds.length, 0);
  assert.equal(ended.travel.cameraProviders[0].providerStatus, 'offline');
});

test('Office verification schedules provider work without awaiting it and reports only verified unique Travel cities', async t => {
  let reads = 0;
  const rows = [{ ...camera, liveVerified: true, providerStatus: 'live' }, { ...camera, id: camera.id + '_backup', liveVerified: true, providerStatus: 'live' },
    { ...camera, id: camera.id + '_pending', city: 'London', liveVerified: false, providerStatus: 'checking' }];
  const app = await createAppHarness({ connected: true, env: { OFFICE_TOKEN: 'travel-control-fixture' }, modules: {
    './travel-camera-providers': { ...cameraProviders, createCameraProviderVerifier: () => ({
      read: () => { reads++; return rows; }, snapshot: () => rows, youtubeIds: [], updateYouTubeStates() {}, youtubeStatesFresh: () => true,
      settle() { throw new Error('Office controls must not await background provider queues'); },
    }) },
  } });
  t.after(() => app.close()); app.exhaustCameraDiscoveryBudget();
  const result = await app.request('/office/controls/location.verify-live-travel/execute', { method: 'POST', headers: { 'x-office-token': 'travel-control-fixture' }, body: {} });
  assert.equal(result.status, 200); assert.equal(reads, 1);
  assert.equal(result.data.result.liveCameras, 1); assert.equal(result.data.result.verifiedProviderCameras, 2);
  assert.equal(result.data.result.checkingProviderCameras, 1); assert.equal(result.data.result.unavailable, 90);
  assert.equal(result.data.result.status, 'ready');
});
