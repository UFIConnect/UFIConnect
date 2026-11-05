'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeJobPublishing, snapshotJobAuthorization, createJobPublishing } = require('./job-publishing');

function fixture(overrides = {}) {
  let current = { id: 'fixture-owner', plan: 'pro', socialTokens: { twitter: 'synthetic-x', linkedin: 'synthetic-linkedin' } };
  const sent = [];
  const service = createJobPublishing({ getUser: async () => current,
    known: key => ['twitter', 'linkedin', 'youtube', 'instagram', 'disabled'].includes(key),
    ready: key => key !== 'disabled', capability: key => ({ supported: true, allowedMedia: key === 'youtube' ? ['video'] : key === 'instagram' ? ['image'] : ['text'], requiresVideo: key === 'youtube', requiresPhoto: key === 'instagram' }),
    publishTarget: async (user, platform, payload) => { sent.push({ user, platform, payload }); return { status: 'posted' }; }, ...overrides });
  return { service, sent, user: () => current, replace: value => { current = value; } };
}

test('Jobs source policy preserves Pro and Business limits without treating career sites as adapters', () => {
  const f = fixture(), user = f.user();
  assert.doesNotThrow(() => f.service.validate(user, { targets: ['twitter', 'linkedin'], content: 'Complete hiring post.' }));
  assert.throws(() => f.service.validate({ ...user, plan: 'free' }, { targets: ['linkedin'] }), { status: 403 });
  assert.doesNotThrow(() => f.service.validate({ ...user, plan: 'business' }, { targets: ['linkedin'] }));
  assert.throws(() => f.service.validate({ ...user, plan: 'business' }, { targets: ['twitter'] }), { status: 403 });
  assert.throws(() => f.service.validate(user, { targets: ['indeed'] }), { status: 400 });
  assert.throws(() => f.service.validate(user, { targets: ['disabled'] }), { status: 403 });
  assert.deepEqual(f.sent, []);
});

test('Jobs rejects incomplete, disconnected and incompatible text deliveries before provider calls', () => {
  const f = fixture(), user = f.user();
  assert.throws(() => f.service.validate({ ...user, socialTokens: {} }, { targets: ['linkedin'] }), { status: 409 });
  for (const platform of ['youtube', 'instagram']) assert.throws(() => f.service.validate(user, { targets: [platform] }), { status: 400 });
  assert.throws(() => f.service.validate(user, { targets: ['twitter'], content: 'x'.repeat(281) }), { status: 400 });
  assert.throws(() => f.service.validate(user, { targets: ['linkedin'], content: 'Hiring', mediaUrl: 'https://example.invalid/image.jpg' }), { status: 400 });
  assert.deepEqual(f.sent, []);
});

test('provider delivery requires the captured source authorization and omits internal identity metadata', async () => {
  const f = fixture(), user = f.user(), authorization = snapshotJobAuthorization(user, ['linkedin']);
  const payload = { content: 'Complete hiring post.', settings: {}, crossPostId: 'bp_fixture', authorizationIdentity: authorization.linkedin };
  const outcome = await f.service.publish(user, 'linkedin', payload);
  assert.equal(outcome.status, 'posted'); assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].payload.authorizationIdentity, undefined);
  assert.equal(f.sent[0].payload.allowTokenRefresh, false, 'Jobs never switches to a replacement opaque account during legacy refresh');
  f.replace({ ...user, socialTokens: { linkedin: 'synthetic-other-account' } });
  await assert.rejects(f.service.publish(user, 'linkedin', payload), { status: 409 });
  assert.equal(f.sent.length, 1);
});

test('source options reject prototype keys, excessive nesting and invalid shapes without pollution', () => {
  const malicious = JSON.parse('{"targets":["discord"],"publisherSettings":{"discord":{"__proto__":{"jobPollution":true}}}}');
  for (const value of [malicious, { targets: ['constructor'] }, { targets: {} }, { targets: ['discord'], publisherSettings: { discord: [] } },
    { targets: ['discord'], publisherSettings: { discord: { deep: { a: { b: { c: { d: { e: 1 } } } } } } } },
    { targets: ['discord'], publisherSettings: { discord: { title: 'x'.repeat(4001) } } }]) {
    assert.throws(() => normalizeJobPublishing(value), { status: 400 });
  }
  assert.equal({}.jobPollution, undefined);
});
