'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const { createSourceInteractions, registerSourceInteractionRoutes } = require('./source-interactions');
const { YOUTUBE_SCOPES } = require('./youtube-permissions');
const { getInteractionCapabilities } = require('./source-policy');
const { createAppHarness, member } = require('./test-support/app-harness');

const sourceUrl = 'https://bsky.app/profile/author.example/post/abc';
const uri = 'at://did:plc:author/app.bsky.feed.post/abc';
const owner = () => ({ id: 'member', socialTokens: { bluesky: JSON.stringify({ did: 'did:plc:me', accessToken: 'old-access', pdsUrl: 'https://pds.example' }) } });

test('every YouTube connect entry point requests the same five permissions', { timeout: 60000 }, async t => {
  const app = await createAppHarness({ env: { YOUTUBE_CLIENT_ID: 'fixture', YOUTUBE_CLIENT_SECRET: 'fixture-secret' } });
  t.after(() => app.close()); app.seedUser(member('youtube-permissions'));
  for (const query of ['', '?interactions=1', '?publishing=1', '?analytics=1', '?analytics=1&monetization=1']) {
    const response = await app.request('/auth/social/youtube/start' + query, { userId: 'youtube-permissions' });
    assert.equal(response.status, 200);
    const params = new URL(response.data.url).searchParams;
    assert.deepEqual(new Set(params.get('scope').split(' ')), new Set(YOUTUBE_SCOPES));
    assert.equal(params.get('include_granted_scopes'), 'true');
    assert.equal(params.get('access_type'), 'offline');
    assert.equal(params.get('prompt'), 'consent');
  }
});

test('YouTube read-only or unknown grants show reconnect instead of offering denied writes', async () => {
  for (const scopes of [undefined, [], [YOUTUBE_SCOPES[0]], [YOUTUBE_SCOPES[1]]]) {
    const user = { socialTokens: { youtube: 'private-token' }, socialGrantedScopes: { youtube: scopes } };
    const capability = getInteractionCapabilities(user).youtube;
    assert.equal(capability.like, false); assert.equal(capability.comment, false); assert.equal(capability.reconnectRequired, true);
    await assert.rejects(createSourceInteractions({ fetchImpl: () => assert.fail('No denied provider write') }).perform({ user, source: 'youtube', sourceUrl: 'https://youtu.be/abcdefghijk', action: 'like', liked: true }), /Reconnect YouTube/);
  }
});

test('YouTube distinguishes disabled comments, quota and insufficient permission without exposing provider details', async () => {
  const user = { socialTokens: { youtube: 'private-token' }, socialGrantedScopes: { youtube: YOUTUBE_SCOPES } };
  for (const [reason, expected, status] of [['commentsDisabled', /Comments are disabled/, 403], ['quotaExceeded', /API quota/, 429], ['insufficientPermissions', /all five permissions/, 403]]) {
    const service = createSourceInteractions({ fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'PRIVATE', errors: [{ reason }] } }), { status: 403 }) });
    await assert.rejects(service.perform({ user, source: 'youtube', sourceUrl: 'https://youtu.be/abcdefghijk', action: 'like', liked: true }), error => expected.test(error.message) && error.status === status && !error.message.includes('PRIVATE'));
  }
});

test('Bluesky confirmed likes return fresh source metrics and rapid unlike works before AppView indexing', async () => {
  const records = new Map(), calls = [];
  let indexed = false;
  const service = createSourceInteractions({
    atprotoGet: async url => {
      if (url.includes('resolveHandle')) return { status: 200, data: { did: 'did:plc:author' } };
      if (url.includes('getRecord')) {
        const rkey = new URL(url).searchParams.get('rkey');
        return records.has(rkey) ? { status: 200, data: { value: records.get(rkey) } } : { status: 400, data: { error: 'RecordNotFound' } };
      }
      const liked = indexed && records.size > 0;
      return { status: 200, data: { posts: [{ uri, cid: 'parent-cid', likeCount: liked ? 8 : 7, replyCount: 2, viewer: liked ? { like: `at://did:plc:me/app.bsky.feed.like/${[...records.keys()][0]}` } : {} }] } };
    },
    atprotoPostJSON: async (url, body) => {
      calls.push({ url, body });
      if (url.endsWith('putRecord')) { records.set(body.rkey, body.record); return { status: 200, data: { uri: `at://did:plc:me/app.bsky.feed.like/${body.rkey}` } }; }
      records.delete(body.rkey); return { status: 200, data: {} };
    },
  });
  const args = { user: owner(), source: 'bluesky', sourceUrl, action: 'like' };
  const first = await service.perform({ ...args, liked: true });
  assert.deepEqual(first, { liked: true }, 'Do not fabricate a count while indexing lags');
  assert.equal(records.size, 1);
  await service.perform({ ...args, liked: true });
  assert.equal(calls.length, 1, 'A repeated desired state does not create another record');
  await service.perform({ ...args, liked: false });
  assert.equal(records.size, 0, 'An immediate unlike deletes the confirmed repository record');
  indexed = true;
  assert.deepEqual(await service.perform({ ...args, liked: true }), { liked: true, likesCount: 8 });
  assert.deepEqual(await service.read(args), { sourceLikedByMe: true, sourceLikesCount: 8, commentsCount: 2 });
  assert.equal(calls[0].body.rkey, createHash('sha256').update(uri).digest('hex'));
});

test('source routes renew only explicit expired access, preserving deduplication and account context', async t => {
  const app = express(); app.use(express.json());
  let current = { id: 'member', socialTokens: { youtube: 'expired' }, socialGrantedScopes: { youtube: YOUTUBE_SCOPES } };
  const calls = [], refreshes = [];
  registerSourceInteractionRoutes(app, {
    authenticate: (req, _res, next) => { req.user = { id: 'member' }; next(); }, limiter: (_req, _res, next) => next(),
    getUser: async () => current, screenMemberContent: async ({ content }) => ({ allowed: true, content }),
    refreshAccessToken: async (...args) => { refreshes.push(args); current = { ...current, socialTokens: { youtube: 'renewed' } }; return 'renewed'; },
    fetchImpl: async (_url, options) => {
      calls.push(options.headers.Authorization);
      return new Response(null, { status: options.headers.Authorization === 'Bearer expired' ? 401 : 204 });
    },
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const payload = { source: 'youtube', sourceUrl: 'https://youtu.be/abcdefghijk', action: 'like', liked: true, requestId: 'renew-access-fixture-0001' };
  const send = () => fetch(`http://127.0.0.1:${server.address().port}/social/interactions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal((await send()).status, 200); assert.equal((await send()).status, 200);
  assert.deepEqual(calls, ['Bearer expired', 'Bearer renewed']);
  assert.deepEqual(refreshes, [['member', 'youtube', 'expired']]);
});

test('Bluesky engagement reads are private, resolve handles and renew expired sessions', async t => {
  const app = express(); app.use(express.json()); let user = owner(), refreshed = 0;
  registerSourceInteractionRoutes(app, {
    authenticate: (req, res, next) => { if (!req.headers['x-member']) return res.sendStatus(401); req.user = { id: 'member' }; next(); },
    limiter: (_req, _res, next) => next(), getUser: async () => user,
    refreshAccessToken: async () => { refreshed++; user = { ...user, socialTokens: { bluesky: JSON.stringify({ ...JSON.parse(user.socialTokens.bluesky), accessToken: 'renewed' }) } }; return user.socialTokens.bluesky; },
    atprotoGet: async (url, options) => {
      if (options.accessToken === 'old-access') return { status: 401, data: {} };
      if (url.includes('resolveHandle')) return { status: 200, data: { did: 'did:plc:author' } };
      return { status: 200, data: { posts: [{ uri, cid: 'cid', likeCount: 12, replyCount: 4, viewer: { like: 'at://did:plc:me/app.bsky.feed.like/abc' } }] } };
    },
  });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/social/post-engagement?${new URLSearchParams({ source: 'bluesky', sourceUrl })}`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers: { 'x-member': 'member' } });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), { sourceLikedByMe: true, sourceLikesCount: 12, commentsCount: 4 }); assert.equal(refreshed, 1);
  assert.equal((await fetch(url.replace('bsky.app', 'evil.example'), { headers: { 'x-member': 'member' } })).status, 400);
});

test('Bluesky reply loading resolves the author DID and keeps the confirmed reply URI', { timeout: 60000 }, async t => {
  const calls = [];
  const replyUri = 'at://did:plc:me/app.bsky.feed.post/reply123';
  const app = await createAppHarness({ modules: { https: {
    ...require('node:https'),
    get(target, _options, callback) {
      const url = new URL(target); calls.push(url);
      assert.equal(url.hostname, 'public.api.bsky.app');
      const data = url.pathname.endsWith('resolveHandle') ? { did: 'did:plc:author' } : { thread: { replies: [{ post: {
        uri: replyUri, cid: 'reply-cid', author: { did: 'did:plc:me', handle: 'me.example' },
        record: { text: 'A visible reply', createdAt: new Date().toISOString() }, likeCount: 0,
      } }] } };
      const request = new EventEmitter(); request.setTimeout = () => request;
      queueMicrotask(() => {
        const response = new EventEmitter(); Object.assign(response, { statusCode: 200, headers: {} });
        callback(response); response.emit('data', JSON.stringify(data)); response.emit('end');
      });
      return request;
    },
  } } });
  t.after(() => app.close());
  app.globalFeedCache.posts.push({ id: 'bluesky_reply_fixture', source: 'bluesky', sourceUrl, isExternal: true, title: 'A real fixture conversation', content: 'Fixture', createdAt: new Date().toISOString() });
  const response = await app.request('/feed/bluesky_reply_fixture/comments');
  assert.equal(response.status, 200); assert.equal(response.data.live, true);
  assert.equal(response.data.comments[0].id, replyUri);
  assert.equal(response.data.comments[0].body, 'A visible reply');
  assert.equal(calls.find(url => url.pathname.endsWith('getPostThread')).searchParams.get('uri'), uri);
});
