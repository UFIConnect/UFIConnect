import test from 'node:test';
import assert from 'node:assert/strict';
import { publishingResults, publishingUnavailableReason, wasPublishingSubmitted } from './publishingAvailability.mjs';

const provider = { configured: true, connectionMode: 'oauth', crossPost: { supported: true, media: 'native-image' } };
const ready = { connected: true, plan: 'pro' };

test('publishing requires both connection and live publishing permissions', () => {
  assert.equal(publishingUnavailableReason(provider, ready), '');
  assert.match(publishingUnavailableReason(provider, { ...ready, connected: false }), /Connect/);
  assert.match(publishingUnavailableReason({ ...provider, reconnectRequired: true }, ready), /Reconnect/);
  assert.match(publishingUnavailableReason({ ...provider, crossPost: { supported: true, reconnectRequired: true } }, ready), /Reconnect/);
  assert.match(publishingUnavailableReason({ ...provider, crossPost: { supported: false } }, ready), /unavailable/);
  assert.notEqual(publishingUnavailableReason({ ...provider, authorizationAvailable: false }, ready), '');
  assert.notEqual(publishingUnavailableReason({ ...provider, connectionMode: 'external' }, ready), '');
});

test('membership and attachment restrictions remain effective for stored selections', () => {
  for (const plan of ['free', 'business', undefined]) assert.match(publishingUnavailableReason(provider, { ...ready, plan }), /Pro/);
  assert.match(publishingUnavailableReason({ ...provider, locked: true }, ready), /Pro/);
  const photoProvider = { ...provider, crossPost: { ...provider.crossPost, requiresPhoto: true } };
  assert.match(publishingUnavailableReason(photoProvider, ready), /photo/);
  assert.equal(publishingUnavailableReason(photoProvider, { ...ready, media: { type: 'image' } }), '');
  assert.match(publishingUnavailableReason(provider, { ...ready, media: { type: 'video' } }), /video/);
  assert.equal(publishingUnavailableReason({ ...provider, crossPost: { supported: true, media: 'link' } }, { ...ready, media: { type: 'video' } }), '');
});

test('pending deliveries are submitted for duplicate prevention and retain their actual status', () => {
  const targets = [{ platform: 'linkedin', status: 'posted' }, { platform: 'tiktok', status: 'processing', publishId: 'pending' }, { platform: 'legacy', status: 'handoff' }, { platform: 'twitter', status: 'failed', error: 'Provider declined' }];
  const results = publishingResults(['linkedin', 'tiktok', 'legacy', 'twitter', 'missing'], targets);
  assert.deepEqual(results.slice(0, 4), targets);
  assert.deepEqual(results.filter(wasPublishingSubmitted).map(target => target.platform), ['linkedin', 'tiktok', 'legacy']);
  assert.equal(results[1].status, 'processing');
  assert.equal(results[2].status, 'handoff');
  assert.equal(results[4].status, 'failed');
  assert.match(results[4].error, /could not be confirmed/);
  assert.equal(wasPublishingSubmitted({ status: 'queued' }), false);
  assert.equal(wasPublishingSubmitted({ status: 'unsupported' }), false);
});

test('provider media constraints allow YouTube video and reject incompatible drafts', () => {
  const youtube = { ...provider, crossPost: { supported: true, media: 'video', allowedMedia: ['video'], requiresVideo: true, maxVideoBytes: 64 * 1024 * 1024 } };
  assert.match(publishingUnavailableReason(youtube, ready), /Add a video/);
  assert.match(publishingUnavailableReason(youtube, { ...ready, media: { type: 'image' } }), /video/);
  assert.equal(publishingUnavailableReason(youtube, { ...ready, media: { type: 'video', size: 64 * 1024 * 1024 } }), '');
  assert.match(publishingUnavailableReason(youtube, { ...ready, media: { type: 'video', size: 65 * 1024 * 1024 } }), /64 MB/);
  const textOnly = { ...provider, crossPost: { supported: true, allowedMedia: ['text'] } };
  assert.equal(publishingUnavailableReason(textOnly, ready), '');
  assert.match(publishingUnavailableReason(textOnly, { ...ready, media: { type: 'image' } }), /image/);
});
