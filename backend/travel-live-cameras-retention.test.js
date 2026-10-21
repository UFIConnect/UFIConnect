const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness } = require('./test-support/app-harness');
const providers = require('./travel-providers');

const VIDEO_ID = 'retained001';
const SOURCE_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`;
const EXPIRED_BY = 7 * 60 * 60 * 1000;

async function retentionHarness(t, initialState = 'live') {
  let state = initialState;
  const calls = [];
  let app;
  app = await createAppHarness({ env: { YOUTUBE_API_KEY: 'test-key' }, modules: {
    './travel-camera-streams.json': [],
    './travel-providers': { ...providers, fetchTravelResource: async url => {
      assert.ok(url.includes('/videos?'), 'retained candidates never spend discovery search quota');
      app.setYouTubeCallReady();
      const ids = new URL(url).searchParams.get('id').split(',');
      calls.push(ids);
      if (state === 'outage') throw new Error('simulated provider outage');
      return { items: ids.includes(VIDEO_ID) && state !== 'missing' ? [{
        id: VIDEO_ID,
        liveStreamingDetails: { actualStartTime: '2026-09-01',
          ...(state === 'ended' ? { actualEndTime: '2026-09-02' } : {}) },
        status: { privacyStatus: state === 'private' ? 'private' : 'public', embeddable: state !== 'no-embed' },
      }] : [] };
    } },
  } });
  t.after(() => app.close());
  const camera = app.LIVE_CAMERA_CATALOG.find(item => item.id === 'camera_seattle');
  app.liveCameraDiscoveryCache.set(camera.id, {
    expiresAt: Date.now() - EXPIRED_BY,
    stream: { videoId: VIDEO_ID, sourceUrl: SOURCE_URL, replacement: true },
  });
  app.exhaustCameraDiscoveryBudget();
  return { app, camera, calls, setState(next) { state = next; } };
}

test('after an idle gap, known discovered cameras survive pruning and batch verification without search quota', async t => {
  const { app, camera, calls } = await retentionHarness(t);
  app.pruneExpiredRuntimeCaches();
  assert.equal(app.liveCameraDiscoveryCache.has(camera.id), true);
  const candidate = app.currentLiveCameraPosts().find(item => item.id === camera.id);
  assert.equal(candidate.sourceUrl, SOURCE_URL);
  assert.equal(candidate.liveVerified, false, 'retaining a URL does not grant live status');
  const verified = await app.refreshVerifiedLiveCameraPosts();
  assert.equal(verified.length, 1);
  assert.equal(verified[0].city, 'Seattle');
  assert.equal(verified[0].sourceUrl, SOURCE_URL);
  assert.equal(verified[0].liveVerified, true);
  assert.ok(calls.some(ids => ids.includes(VIDEO_ID)), 'batch status verification includes the retained URL');
});

test('provider outage hides retained cameras, and a later batch check recovers them without another search', async t => {
  const { app, camera, setState, calls } = await retentionHarness(t, 'outage');
  app.pruneExpiredRuntimeCaches();
  assert.equal((await app.refreshVerifiedLiveCameraPosts()).length, 0);
  assert.equal(app.liveCameraVerificationState.status, 'degraded');
  assert.equal(app.liveCameraDiscoveryCache.has(camera.id), true);
  assert.equal(app.currentLiveCameraPosts().find(item => item.id === camera.id).liveVerified, false);
  const failedCallCount = calls.length;
  setState('live');
  const recovered = await app.refreshVerifiedLiveCameraPosts();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].sourceUrl, SOURCE_URL);
  assert.equal(recovered[0].liveVerified, true);
  assert.ok(calls.length > failedCallCount);
});

for (const state of ['ended', 'private', 'no-embed', 'missing']) {
  test(`batch verification removes a retained ${state} candidate`, async t => {
    const { app, camera } = await retentionHarness(t, state);
    const verified = await app.refreshVerifiedLiveCameraPosts();
    assert.equal(verified.length, 0);
    assert.equal(app.liveCameraDiscoveryCache.has(camera.id), false);
    assert.notEqual(app.currentLiveCameraPosts().find(item => item.id === camera.id).sourceUrl, SOURCE_URL);
  });
}

test('direct discovery rechecks a retained candidate after its TTL and survives a temporary provider failure', async t => {
  const { app, camera, setState, calls } = await retentionHarness(t, 'outage');
  assert.equal(await app.discoverLiveCameraReplacement(camera), null);
  assert.equal(app.liveCameraDiscoveryCache.has(camera.id), true);
  setState('live');
  const result = await app.discoverLiveCameraReplacement(camera);
  assert.equal(result.videoId, VIDEO_ID);
  assert.equal(calls.length, 2);
});

test('cache pruning still removes expired failed discoveries while preserving a pending lookup', async t => {
  const { app, camera } = await retentionHarness(t);
  app.liveCameraDiscoveryCache.set('expired-failure', { stream: null, expiresAt: Date.now() - 1 });
  app.liveCameraDiscoveryCache.set('recent-failure', { stream: null, expiresAt: Date.now() + 60000 });
  app.liveCameraDiscoveryCache.set('pending-lookup', { stream: null, expiresAt: 0, pending: Promise.resolve(null) });
  app.pruneExpiredRuntimeCaches();
  assert.equal(app.liveCameraDiscoveryCache.has('expired-failure'), false);
  assert.equal(app.liveCameraDiscoveryCache.has('recent-failure'), true);
  assert.equal(app.liveCameraDiscoveryCache.has('pending-lookup'), true);
  assert.equal(app.liveCameraDiscoveryCache.has(camera.id), true);
});
