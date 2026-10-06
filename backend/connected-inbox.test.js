'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PGlite } = require('@electric-sql/pglite');
const { createInboxReceipts, INBOX_RECEIPTS_SCHEMA } = require('./inbox-receipts');
const { createConnectedInbox, createInboxRequest, githubRows, redditRows, blueskyRows, safePds } = require('./connected-inbox');
const { createAppHarness, member } = require('./test-support/app-harness');

const github = (title = 'Review needed', date = '2026-10-06T14:00:00Z') => [{ id: '12', subject: { title, url: 'https://api.github.com/repos/team/project/pulls/3' }, repository: { full_name: 'team/project' }, unread: true, updated_at: date }];
const reddit = { data: { children: [
  { kind: 't4', data: { name: 't4_abc', id: 'abc', author: 'coworker', subject: 'Hello', body: 'A complete private message.', created_utc: 1791295200, new: true } },
  { kind: 't1', data: { name: 't1_def', author: 'reader', subject: 'comment reply', body: 'Good point.', context: '/r/test/comments/a/post/b/', created_utc: 1791295201, new: true, was_comment: true } },
] } };
function memoryReceipts() { const map = new Map(); return {
  read: async (uid, ids) => new Set(ids.filter(id => map.get(uid)?.has(id))),
  mark: async (uid, ids) => { const seen = map.get(uid) || new Set(); ids.forEach(id => seen.add(id)); map.set(uid, seen); return ids; },
}; }

test('provider adapters distinguish messages and notices and use safe source links', () => {
  const gh = githubRows(github()).notifications[0];
  assert.equal(gh.url, 'https://github.com/team/project/pull/3');
  assert.equal(gh.read, false);
  assert.notEqual(gh.id, githubRows(github('New reply', '2026-10-06T15:00:00Z')).notifications[0].id);
  const rows = redditRows(reddit);
  assert.equal(rows.notifications.length, 1); assert.equal(rows.conversations.length, 1);
  assert.equal(rows.conversations[0].messages[0].text, 'A complete private message.');
  const hostile = github(); hostile[0].subject.url = 'https://api.github.com.attacker.invalid/repos/x';
  assert.equal(githubRows(hostile).notifications[0].url, 'https://github.com/notifications');
  const session = JSON.stringify({ did: 'did:plc:owner' });
  const convo = blueskyRows({ convos: [{ id: 'c1', unreadCount: 2, members: [{ did: 'did:plc:other', handle: 'other.bsky.social' }], lastMessage: { id: 'm1', text: 'Hello', sender: { did: 'did:plc:other' }, sentAt: '2026-10-06T15:00:00Z' } }] }, 'messages', session).conversations[0];
  assert.equal(convo.lastMessage.text, 'Hello'); assert.equal(convo.unreadCount, 2);
});

test('authenticated provider request is fixed-origin, never marks Reddit read, and signs Bluesky proxy reads', async () => {
  const calls = []; const proofs = [];
  const https = { request(url, options, callback) {
    calls.push({ url, ...options }); const req = new EventEmitter();
    req.setTimeout = () => {}; req.end = () => { const res = new EventEmitter(); res.headers = {}; res.statusCode = 200; callback(res); res.emit('data', Buffer.from('{}')); res.emit('end'); }; return req;
  } };
  const request = createInboxRequest(https, (...args) => { proofs.push(args); return 'signed-proof'; });
  await request('reddit', 'reddit-token', 'messages');
  assert.equal(new URL(calls[0].url).hostname, 'oauth.reddit.com');
  assert.equal(new URL(calls[0].url).searchParams.get('mark'), 'false');
  assert.equal(calls[0].method, 'GET');
  const session = JSON.stringify({ accessToken: 'bsky-token', did: 'did:plc:me', pdsUrl: 'https://amanita.us-east.host.bsky.network' });
  await request('bluesky', session, 'messages', 'a/b?url=https://bad.invalid');
  assert.equal(calls[1].headers['atproto-proxy'], 'did:web:api.bsky.chat#bsky_chat');
  assert.equal(calls[1].headers.Authorization, 'DPoP bsky-token');
  assert.equal(proofs[0][0], 'GET');
  assert.equal(new URL(calls[1].url).searchParams.get('convoId'), 'a/b?url=https://bad.invalid');
  for (const url of ['http://bsky.social', 'https://127.0.0.1', 'https://bsky.social.attacker.test', 'https://user:secret@bsky.social', 'https://bsky.social:444', 'https://bsky.social/x']) assert.throws(() => safePds(url));
});

test('account caches/receipts stay isolated, new source activity becomes unread, and read actions cannot forge IDs', async () => {
  let clock = 100000; let calls = 0; let version = '2026-10-06T14:00:00Z';
  const service = createConnectedInbox({ receipts: memoryReceipts(), now: () => clock, refreshToken: async () => null,
    request: async (_source, token) => { calls++; return { status: 200, data: github(token, version) }; } });
  const a = { id: 'a', socialTokens: { github: 'account-a' } }; const b = { id: 'b', socialTokens: { github: 'account-b' } };
  const first = await service.list(a, 'notifications');
  await service.mark(a, 'notifications', [first.notifications[0].id]);
  assert.equal((await service.list(a, 'notifications')).notifications[0].read, true);
  assert.equal((await service.list(b, 'notifications')).notifications[0].title, 'account-b');
  assert.equal((await service.list(b, 'notifications')).notifications[0].read, false); assert.equal(calls, 2);
  await assert.rejects(service.mark(a, 'notifications', ['forged']), { status: 409 });
  version = '2026-10-06T15:00:00Z'; clock += 61000;
  assert.equal((await service.list(a, 'notifications')).notifications[0].read, false);
  service.invalidate('a', 'github'); await service.list(a, 'notifications'); assert.equal(calls, 4);
});

test('source refresh uses current member tokens and failed imports cannot be acknowledged as read', async () => {
  const requests = []; const user = { id: 'a', socialTokens: { github: 'expired', twitter: 'x-grant' } };
  const service = createConnectedInbox({ receipts: memoryReceipts(), getAccount: async () => user,
    refreshToken: async (uid, source, token) => { assert.deepEqual([uid, source, token], ['a', 'github', 'expired']); user.socialTokens.github = 'refreshed'; return 'refreshed'; },
    request: async (_source, token) => { requests.push(token); return token === 'expired' ? { status: 401 } : { status: 200, data: github() }; } });
  const payload = await service.list(user, 'notifications'); assert.equal(payload.notifications.length, 1);
  assert.deepEqual(requests, ['expired', 'refreshed']);
  assert.equal(payload.sources.find(s => s.source === 'twitter').status, 'external');
  const denied = createConnectedInbox({ receipts: memoryReceipts(), refreshToken: async () => null, request: async () => ({ status: 403 }) });
  assert.equal((await denied.list(user, 'notifications')).sources[0].status, 'reconnect_required');
  await assert.rejects(denied.mark(user, 'notifications', [payload.notifications[0].id]), { status: 409 });
});

test('disconnect during an in-flight provider read cannot expose private results', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const current = { id: 'a', socialTokens: { github: 'token' } };
  const service = createConnectedInbox({ receipts: memoryReceipts(), refreshToken: async () => null, getAccount: async () => current,
    request: async () => { await gate; return { status: 200, data: github('private') }; } });
  const result = service.list({ ...current, socialTokens: { ...current.socialTokens } }, 'notifications');
  current.socialTokens = {}; service.invalidate('a', 'github'); release();
  assert.equal((await result).notifications.length, 0);
  assert.equal((await service.list(current, 'notifications')).sources.length, 0);
});

test('read receipts persist per user and account deletion cascades in the real schema', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec('CREATE TABLE users(id UUID PRIMARY KEY)'); await pg.exec(INBOX_RECEIPTS_SCHEMA);
  const a = '11111111-1111-4111-8111-111111111111'; const b = '22222222-2222-4222-8222-222222222222';
  await pg.query('INSERT INTO users(id) VALUES ($1),($2)', [a,b]);
  const options = { db: { isConnected: () => true, query: (...args) => pg.query(...args) }, isDBId: () => true };
  await createInboxReceipts(options).mark(a, ['connreq_1', 'source:github:opaque']);
  const restart = createInboxReceipts(options);
  assert.equal((await restart.read(a, ['connreq_1'])).has('connreq_1'), true);
  assert.equal((await restart.read(b, ['connreq_1'])).size, 0);
  await pg.query('DELETE FROM users WHERE id=$1', [a]);
  assert.equal((await pg.query('SELECT * FROM inbox_read_receipts')).rows.length, 0);
  await assert.rejects(createInboxReceipts({ ...options, db: { isConnected: () => false } }).mark(a, ['id']), { status: 503 });
});

test('real routes clear seen request/follower badges without resolving requests; native and connected messages remain separate', async t => {
  const real = require('./connected-inbox');
  const harness = await createAppHarness({ modules: { './connected-inbox': { ...real, createInboxRequest: () => async source => ({ status: 200, data: source === 'reddit' ? reddit : github() }) } } });
  t.after(() => harness.close());
  harness.seedUser(member('alice', { socialTokens: { reddit: 'token' } })); harness.seedUser(member('bob')); harness.seedUser(member('carol'));
  harness.connections.push({ id: 'r1', fromId: 'bob', toId: 'alice', status: 'pending', createdAt: '2026-10-06T10:00:00Z' });
  harness.follows.push({ followerId: 'carol', followingId: 'alice', createdAt: '2026-10-06T10:00:00Z' });
  assert.equal((await harness.request('/connected-inbox/messages')).status, 401);
  const first = await harness.request('/notifications/badge-counts', { userId: 'alice' });
  assert.equal(first.data.notificationCount, 3); assert.equal(first.data.pendingConnections, 1); assert.equal(first.data.unreadMessages, 1);
  const native = await harness.request('/notifications', { userId: 'alice' });
  assert.equal(native.data.notifications.filter(n => !n.read).length, 2);
  const read = await harness.request('/notifications/mark-read', { userId: 'alice', method: 'POST', body: { ids: native.data.notifications.map(n => n.id) } });
  assert.equal(read.status, 200); assert.equal(harness.connections[0].status, 'pending');
  const source = await harness.request('/connected-inbox/notifications', { userId: 'alice' });
  await harness.request('/connected-inbox/notifications/mark-read', { userId: 'alice', method: 'POST', body: { ids: source.data.notifications.map(n => n.id) } });
  const clear = await harness.request('/notifications/badge-counts', { userId: 'alice' });
  assert.equal(clear.data.notificationCount, 0); assert.equal(clear.data.pendingConnections, 1); assert.equal(clear.data.unreadMessages, 1);
  assert.ok(clear.headers.get('cache-control').includes('no-store'));
  const messages = await harness.request('/connected-inbox/messages', { userId: 'alice' }); const conversation = messages.data.conversations[0];
  const detailPath = `/connected-inbox/messages/reddit/${encodeURIComponent(conversation.id)}`;
  assert.equal((await harness.request(detailPath, { userId: 'bob' })).status, 404);
  assert.equal((await harness.request(detailPath, { userId: 'alice' })).data.messages[0].text, 'A complete private message.');
  assert.equal((await harness.request('/connected-inbox/messages/mark-read', { userId: 'alice', method: 'POST', body: { ids: [conversation.id] } })).status, 200);
  assert.equal((await harness.request('/notifications/badge-counts', { userId: 'alice' })).data.unreadMessages, 0);
  assert.equal((await harness.request('/notifications', { userId: 'alice' })).data.notifications.every(n => n.read), true);
  assert.equal((await harness.request('/notifications/mark-read', { userId: 'bob', method: 'POST', body: { ids: ['connreq_r1'] } })).status, 409);
});

test('unavailable actors and older hidden notices cannot strand the red badge; legacy mark-read uses available rows', async t => {
  const notices = Array.from({ length: 105 }, (_, i) => ({ id: `n${i}`, user_id: 'alice', type: 'like', actor_id: i === 0 ? 'deleted' : 'bob', read: false, created_at: '2026-10-06T10:00:00Z' }));
  const harness = await createAppHarness({ connected: true, query: async sql => ({ rows: sql.startsWith('SELECT * FROM notifications') ? notices.slice(0,100) : [], rowCount: 0 }) });
  t.after(() => harness.close()); harness.seedUser(member('alice')); harness.seedUser(member('bob'));
  const list = await harness.request('/notifications', { userId: 'alice' });
  assert.equal(list.data.notifications.length, 99);
  assert.equal((await harness.request('/notifications/badge-counts', { userId: 'alice' })).data.notificationCount, 99);
  assert.equal((await harness.request('/notifications/mark-read', { userId: 'alice', method: 'POST', body: {} })).status, 200);
  assert.equal((await harness.request('/notifications/badge-counts', { userId: 'alice' })).data.notificationCount, 0);
});
