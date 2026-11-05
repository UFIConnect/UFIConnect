'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAccountPublishingAdapters } = require('./publishing-account-adapters');
const { createPublishingTargets } = require('./publishing-targets');
const target = { providerId: 'video123456', publishId: 'video123456', destinationId: 'UC-member', privacyStatus: 'unlisted' };
const video = (id = target.providerId, extra = {}) => ({ id, snippet: { channelId: 'UC-member' }, status: { uploadStatus: 'processed', privacyStatus: 'unlisted' }, ...extra });
function fixture(videos, overrides = {}) {
  const calls = [];
  const options = { request: async (url, input = {}) => {
    calls.push({ url, ...input });
    if (url.includes('/channels?')) return { status: 200, data: { items: [{ id: 'UC-member' }] } };
    if (url.includes('/videos?part=')) return { status: 200, data: { items: videos.filter(value => new URL(url).searchParams.get('id').split(',').includes(value.id)) } };
    throw Error('Unexpected request');
  }, ...overrides };
  return { calls, adapters: createAccountPublishingAdapters(options), service: createPublishingTargets(options) };
}

test('processed video remains posted after processing details terminate; real progress and safe failure reasons are retained', async () => {
  const f = fixture([video(undefined, { processingDetails: { processingStatus: 'terminated' } })]);
  const done = await f.adapters.youtube.sync('token', target);
  assert.equal(done.status, 'posted');
  assert.equal(done.providerStatus, 'processed');
  assert.ok(Number.isFinite(Date.parse(done.statusCheckedAt)));
  const progress = fixture([video(undefined, { status: { uploadStatus: 'uploaded', privacyStatus: 'unlisted' }, processingDetails: { processingStatus: 'processing', processingProgress: { partsTotal: '8', partsProcessed: '3', timeLeftMs: '45000' } } })]);
  const pending = await progress.service.syncMany('youtube', 'token', [target]);
  assert.equal(pending[0].processingProgress, 37);
  assert.equal(pending[0].processingTimeLeftMs, 45000);
  assert.equal(pending[0].status, 'processing');
  const rejected = fixture([video(undefined, { status: { uploadStatus: 'rejected', rejectionReason: 'copyright' } })]);
  assert.match((await rejected.adapters.youtube.sync('token', target)).error, /copyright/);
  const secret = fixture([video(undefined, { status: { uploadStatus: 'failed', failureReason: 'secret-bearer-token' } })]);
  assert.equal((await secret.adapters.youtube.sync('token', target)).error.includes('secret-bearer-token'), false);
});

test('batch status verifies channels once, requests at most fifty IDs and preserves duplicate target order', async () => {
  const targets = Array.from({ length: 51 }, (_, i) => ({ ...target, providerId: `video_${String(i).padStart(6, '0')}` }));
  const f = fixture(targets.map(value => video(value.providerId)));
  const results = await f.adapters.youtube.syncMany('token', [...targets, targets[0]]);
  assert.equal(f.calls.filter(call => call.url.includes('/channels?')).length, 1);
  const reads = f.calls.filter(call => call.url.includes('/videos?part='));
  assert.equal(reads.length, 2);
  assert.ok(reads.every(call => new URL(call.url).searchParams.get('id').split(',').length <= 50));
  assert.deepEqual(results.map(value => value.providerId), [...targets, targets[0]].map(value => value.providerId));
  assert.ok(results.every(value => value.status === 'posted'));
});

test('batch results isolate unavailable videos, foreign channels and changed privacy without claiming publication', async () => {
  const f = fixture([video(), video('foreign1234', { snippet: { channelId: 'UC-foreign' } }), video('private1234', { status: { uploadStatus: 'processed', privacyStatus: 'private' } })]);
  const inputs = [target, { ...target, providerId: 'missing1234' }, { ...target, providerId: 'foreign1234' },
    { ...target, providerId: 'private1234' }, { ...target, providerId: 'invalid' , destinationId: 'UC-other' }];
  const results = await f.service.syncMany('youtube', 'token', inputs);
  assert.deepEqual(results.map(value => value.status), ['posted', 'processing', 'handoff', 'handoff', 'handoff']);
  assert.equal(results[2].deliveryUncertain, true);
  assert.equal(results[1].processingProgress, null);
  assert.equal(results[1].providerStatus, 'unavailable');
});

test('batch provider authentication errors propagate for one safe route refresh', async () => {
  const f = fixture([], { request: async () => ({ status: 401, data: { error: 'private-provider-details' } }) });
  await assert.rejects(f.service.syncMany('youtube', 'token', [target]), error => error.status === 401 && error.reconnectRequired === true && !error.message.includes('private-provider-details'));
});

test('completed uploads with unverifiable visibility require review and never look still processing', async () => {
  for (const [value, input] of [[video(), { ...target, privacyStatus: undefined }],
    [video(undefined, { status: { uploadStatus: 'processed' } }), target]]) {
    const f = fixture([value]);
    const result = await f.adapters.youtube.sync('token', input);
    assert.equal(result.status, 'handoff');
    assert.equal(result.deliveryUncertain, true);
    assert.match(result.error, /finished processing.*visibility.*verified/);
    assert.equal(result.processingProgress, null);
    assert.equal(result.processingTimeLeftMs, null);
  }
  const foreign = fixture([video(undefined, { snippet: { channelId: 'UC-foreign' } })]);
  const [unverified] = await foreign.adapters.youtube.syncMany('token', [{ ...target, processingProgress: 37, processingTimeLeftMs: 45000 }]);
  assert.equal(unverified.processingProgress, null);
  assert.equal(unverified.processingTimeLeftMs, null);
});

test('malformed provider progress cannot fabricate a percentage or processing estimate', async () => {
  for (const progress of [{ partsTotal: 10, partsProcessed: null, timeLeftMs: null },
    { partsTotal: 10, partsProcessed: 11, timeLeftMs: -2 }, { partsTotal: 'private-token', partsProcessed: '0', timeLeftMs: 'private-token' }]) {
    const f = fixture([video(undefined, { status: { uploadStatus: 'uploaded', privacyStatus: 'unlisted' }, processingDetails: { processingStatus: 'processing', processingProgress: progress } })]);
    const result = await f.adapters.youtube.sync('token', target);
    assert.equal(result.processingProgress, null);
    assert.equal(result.processingTimeLeftMs, null);
  }
});

test('a definitive processed upload receipt is returned immediately without an extra status query', async () => {
  const calls = [];
  const f = fixture([], { downloadMedia: async () => ({ body: Buffer.from('video'), contentType: 'video/mp4' }),
    request: async (url, input = {}) => {
      calls.push({ url, ...input });
      if (url.includes('/channels?')) return { status: 200, data: { items: [{ id: 'UC-member' }] } };
      if (input.method === 'POST') return { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture' } };
      if (input.method === 'PUT') return { status: 201, data: video() };
      throw Error('No unnecessary status request');
    } });
  const result = await f.adapters.youtube.publish('token', { content: 'Video', mediaUrl: 'https://res.cloudinary.com/test/video/upload/video.mp4', mediaType: 'video', settings: { destinationId: 'UC-member', title: 'Video', privacyStatus: 'unlisted', madeForKids: 'no' } });
  assert.equal(result.status, 'posted');
  assert.equal(calls.length, 3);
});

test('adapter recovers a lost upload acknowledgement without creating another video or redownloading media', async () => {
  const calls = [];
  let downloads = 0, uploads = 0;
  const f = fixture([], { downloadMedia: async () => { downloads++; return { body: Buffer.from('video'), contentType: 'video/mp4' }; },
    request: async (url, input = {}) => {
      calls.push({ url, ...input });
      if (url.includes('/channels?')) return { status: 200, data: { items: [{ id: 'UC-member' }] } };
      if (input.method === 'POST') return { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture' } };
      if (input.method === 'PUT' && ++uploads === 1) throw Object.assign(Error('private-token connection reset'), { deliveryUncertain: true });
      assert.equal(input.headers['Content-Range'], 'bytes */5');
      assert.equal(input.body.length, 0);
      return { status: 201, data: video() };
    } });
  const result = await f.adapters.youtube.publish('token', { content: 'Video', mediaUrl: 'https://res.cloudinary.com/test/video/upload/video.mp4', mediaType: 'video', settings: { destinationId: 'UC-member', title: 'Video', privacyStatus: 'unlisted', madeForKids: 'no' } });
  assert.equal(result.status, 'posted');
  assert.equal(downloads, 1);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(calls.filter(call => call.method === 'PUT').length, 2);
});
