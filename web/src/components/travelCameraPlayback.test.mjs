import test from 'node:test';
import assert from 'node:assert/strict';
import { providerCameraPlayback, providerCameraStatus } from './travelCameraPlayback.mjs';
const camera = { sourceUrl: 'https://camera.example.com/city', livePlayback: { kind: 'provider', url: 'https://camera.example.com/city', providerName: 'City operator' } };
test('operator actions require matching public HTTPS source and playback URLs', () => {
  assert.equal(providerCameraPlayback(camera).providerName, 'City operator');
  for (const url of ['javascript:alert(1)', 'http://camera.example.com/', 'https://evil.example.com/', 'https://user:password@camera.example.com/']) {
    assert.equal(providerCameraPlayback({ ...camera, livePlayback: { ...camera.livePlayback, url } }), null);
  }
});
test('provider status distinguishes live video, updating image, offline and unverified pages', () => {
  assert.equal(providerCameraStatus({ liveVerified: true, providerStatus: 'live' }), 'Live on provider');
  assert.equal(providerCameraStatus({ liveVerified: true, providerStatus: 'live', liveMediaKind: 'image', liveUpdateIntervalSeconds: 60 }), 'Live camera image · updates every 1 minute');
  assert.match(providerCameraStatus({ providerStatus: 'offline' }), /offline/);
  assert.match(providerCameraStatus({ providerStatus: 'unverified' }), /not confirmed/);
  assert.doesNotMatch(providerCameraStatus({ liveVerified: false, providerStatus: 'live' }), /^Live/);
});
