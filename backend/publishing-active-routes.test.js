'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createActivePublishingFixture } = require('./test-support/active-publishing-fixture');

const github = { destinationId: 'member/project', title: 'Reviewed release', tagName: 'v1.0' };
const gitlab = { destinationId: '12', title: 'Reviewed release', tagName: 'v2.0' };
const draft = { content: 'A reviewed product release.', platforms: ['github'], publisherSettings: { github } };
async function fixture(t) { const result = await createActivePublishingFixture(); t.after(() => result.app.close()); return result; }

test('read-only YouTube does not stop a ready target producing a real provider receipt', { timeout: 30000 }, async t => {
  const { app, owner, writes, history } = await fixture(t);
  const denied = await app.request('/command-center/cross-post/youtube/destinations', { userId: owner.id });
  assert.equal(denied.status, 409);
  assert.equal(denied.data.reconnectRequired, true);
  const posted = await app.request('/command-center/cross-post', { userId: owner.id, method: 'POST', body: draft });
  assert.equal(posted.status, 200);
  assert.equal(posted.data.targets[0].status, 'posted');
  assert.equal(posted.data.targets[0].providerId, '99');
  assert.equal(posted.data.targets[0].destinationId, github.destinationId);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].json.name, github.title);
  assert.equal(writes[0].json.tag_name, github.tagName);
  assert.equal(writes[0].json.body, draft.content);
  assert.equal(history[0].targets[0].status, 'posted');
  assert.equal(posted.data.historySaved, true);
});

test('incomplete YouTube gets its own failure without blocking a valid GitHub release', { timeout: 30000 }, async t => {
  const { app, owner, writes } = await fixture(t);
  const response = await app.request('/command-center/cross-post', { userId: owner.id, method: 'POST', body: { ...draft, platforms: ['youtube', 'github'] } });
  assert.equal(response.status, 200);
  assert.equal(response.data.targets[0].platform, 'youtube');
  assert.equal(response.data.targets[0].status, 'failed');
  assert.match(response.data.targets[0].error, /uploaded video/);
  assert.equal(response.data.targets[1].status, 'posted');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, 'https://api.github.com/repos/member/project/releases');
});

test('matching release formats preserve each provider destination and existing tag', { timeout: 30000 }, async t => {
  const { app, owner, writes } = await fixture(t);
  const response = await app.request('/command-center/cross-post', { userId: owner.id, method: 'POST', body: { ...draft, platforms: ['github', 'gitlab'], publisherSettings: { github, gitlab, youtube: { privacyStatus: 'public' } } } });
  assert.equal(response.status, 200);
  assert.deepEqual(response.data.targets.map(target => [target.platform, target.status, target.destinationId]), [['github', 'posted', 'member/project'], ['gitlab', 'posted', '12']]);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].json.tag_name, 'v1.0');
  assert.equal(writes[1].json.tag_name, 'v2.0');
  assert.equal(writes[0].json.name, writes[1].json.name);
  assert.ok(writes.every(write => !Object.hasOwn(write.json, 'privacyStatus')));
});

test('YouTube uploads require explicit visibility and audience before a processing receipt', { timeout: 30000 }, async t => {
  const { app, owner, writes, state } = await fixture(t); state.youtubeDenied = false;
  const input = { content: 'Reviewed video description.', platforms: ['youtube'], mediaType: 'video', mediaUrl: 'https://res.cloudinary.com/fixture/video/upload/video.mp4' };
  const settings = { destinationId: 'UCfixturechannel', title: 'Reviewed video', privacyStatus: 'unlisted', madeForKids: 'no', notifySubscribers: false };
  for (const missing of ['privacyStatus', 'madeForKids']) {
    const incomplete = { ...settings }; delete incomplete[missing];
    const denied = await app.request('/command-center/cross-post', { userId: owner.id, method: 'POST', body: { ...input, publisherSettings: { youtube: incomplete } } });
    assert.equal(denied.data.targets[0].status, 'failed');
    assert.equal(writes.length, 0);
  }
  const response = await app.request('/command-center/cross-post', { userId: owner.id, method: 'POST', body: { ...input, publisherSettings: { youtube: settings } } });
  assert.equal(response.status, 200);
  assert.equal(response.data.targets[0].status, 'processing');
  assert.equal(response.data.targets[0].privacyStatus, 'unlisted');
  assert.equal(response.data.targets[0].destinationId, 'UCfixturechannel');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].json.status, { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false });
  assert.equal(new URL(writes[0].url).searchParams.get('notifySubscribers'), 'false');
});

test('missing receipts become uncertain handoff and known duplicate releases cannot be sent again', { timeout: 30000 }, async t => {
  const { app, owner, writes, state } = await fixture(t); state.githubReceipt = false;
  const first = await app.request('/command-center/cross-post', { userId: owner.id, method: 'POST', body: draft });
  assert.equal(first.data.targets[0].status, 'handoff');
  assert.equal(first.data.targets[0].deliveryUncertain, true);
  assert.equal(writes.length, 1);
  const duplicate = await app.request('/command-center/cross-post', { userId: owner.id, method: 'POST', body: draft });
  assert.equal(duplicate.data.targets[0].status, 'failed');
  assert.match(duplicate.data.targets[0].error, /already has a release/);
  assert.equal(writes.length, 1);
});

test('a verified YouTube channel does not manufacture upload permission or block another provider', { timeout: 30000 }, async t => {
  const { app, owner, writes, state } = await fixture(t);
  state.youtubeDenied = false; state.youtubeUploadDenied = true;
  const schema = await app.request('/command-center/cross-post/youtube/destinations', { userId: owner.id });
  assert.equal(schema.status, 200);
  assert.equal(schema.data.destinations[0].id, 'UCfixturechannel');
  const response = await app.request('/command-center/cross-post', { userId: owner.id, method: 'POST', body: {
    content: draft.content, platforms: ['youtube', 'github'], mediaType: 'video', mediaUrl: 'https://res.cloudinary.com/fixture/video/upload/video.mp4',
    publisherSettings: { github, youtube: { destinationId: 'UCfixturechannel', title: 'Reviewed upload', privacyStatus: 'private', madeForKids: 'no' } },
  } });
  assert.equal(response.status, 200);
  assert.equal(response.data.targets[0].status, 'failed');
  assert.equal(response.data.targets[0].reconnectRequired, true);
  assert.match(response.data.targets[0].error, /access was denied|Reconnect/);
  assert.equal(response.data.targets[1].status, 'posted');
  assert.equal(writes.filter(write => write.url.includes('/upload/youtube/') && write.method === 'POST').length, 1);
  assert.equal(writes.filter(write => write.method === 'PUT').length, 0);
  assert.equal(writes.filter(write => write.url === 'https://api.github.com/repos/member/project/releases').length, 1);
});

test('unprepared history and unconnected member cannot cause provider writes', { timeout: 30000 }, async t => {
  const { app, owner, writes, state } = await fixture(t);
  state.failHistory = true;
  const unavailable = await app.request('/command-center/cross-post', { userId: owner.id, method: 'POST', body: draft });
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.data.message, /Nothing was sent/);
  assert.equal(writes.length, 0);
  state.failHistory = false;
  const other = await app.request('/command-center/cross-post', { userId: 'other-publisher', method: 'POST', body: draft });
  assert.equal(other.data.targets[0].status, 'failed');
  assert.equal(writes.length, 0);
});
