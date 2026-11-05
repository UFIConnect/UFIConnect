import test from 'node:test';
import assert from 'node:assert/strict';
import { publishingDestinationState, publishingResults, publishingUnavailableReason, wasPublishingSubmitted } from './publishingAvailability.mjs';

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
  assert.equal(publishingUnavailableReason({ ...provider, locked: true }, ready), '');
  const photoProvider = { ...provider, crossPost: { ...provider.crossPost, requiresPhoto: true } };
  assert.match(publishingUnavailableReason(photoProvider, ready), /photo/);
  assert.equal(publishingUnavailableReason(photoProvider, { ...ready, media: { type: 'image' } }), '');
  assert.match(publishingUnavailableReason(provider, { ...ready, media: { type: 'video' } }), /video/);
  assert.equal(publishingUnavailableReason({ ...provider, crossPost: { supported: true, media: 'link' } }, { ...ready, media: { type: 'video' } }), '');
});

test('configured publishing destinations stay actionable while draft prerequisites are incomplete', () => {
  const youtube = { ...provider, locked: true, crossPost: { supported: true, requiresVideo: true, allowedMedia: ['video'] } };
  for (const options of [ready, { ...ready, media: { type: 'image' } }, { ...ready, plan: 'free' }]) {
    const state = publishingDestinationState(youtube, options);
    assert.equal(state.available, true);
    assert.equal(state.selectable, true);
    assert.equal(state.action, 'select');
    assert.ok(state.reason, 'Incomplete drafts must still explain why publication cannot start');
  }
  assert.equal(publishingDestinationState(youtube, { ...ready, media: { type: 'video' } }).reason, '');
  const disconnected = publishingDestinationState(youtube, { ...ready, connected: false });
  assert.equal(disconnected.available, true);
  assert.equal(disconnected.selectable, false);
  assert.equal(disconnected.action, 'connect');
  assert.match(disconnected.reason, /Connect/);
  const expired = publishingDestinationState({ ...youtube, reconnectRequired: true }, ready);
  assert.equal(expired.available, true);
  assert.equal(expired.action, 'reconnect');
  assert.match(expired.reason, /Reconnect/);
});

test('account-only configured services can be managed without inventing a publishing adapter', () => {
  const account = { ...provider, crossPost: { supported: false, note: 'This account has no publishing adapter.' } };
  assert.equal(publishingDestinationState(account, ready).action, 'manage');
  assert.equal(publishingDestinationState(account, ready).available, true);
  assert.equal(publishingDestinationState(account, ready).selectable, false);
  assert.equal(publishingDestinationState(account, { ...ready, connected: false }).action, 'manage');
  assert.match(publishingUnavailableReason(account, ready), /no publishing adapter/);
});

test('a publishing permission denial changes the existing destination into a connection action', () => {
  const state = publishingDestinationState(provider, { ...ready, reconnectRequired: true });
  assert.equal(state.available, true);
  assert.equal(state.selectable, false);
  assert.equal(state.action, 'reconnect');
  assert.match(state.reason, /Connect.*permission/);
  assert.equal(publishingDestinationState(provider, ready).action, 'select');
});

test('source setup and explicit server authorization denials remain unavailable', () => {
  for (const denied of [{ configured: false }, { canStartAuthorization: false }, { authorizationAvailable: false },
    { connectionMode: 'external' }, { authorizationSupported: false }, { forceComingSoon: true }]) {
    const state = publishingDestinationState({ ...provider, ...denied }, ready);
    assert.equal(state.available, false);
    assert.equal(state.selectable, false);
    assert.equal(state.action, 'unavailable');
    assert.ok(state.reason);
  }
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
