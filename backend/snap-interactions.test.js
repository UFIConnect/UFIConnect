'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { SNAP_SCHEMA, createSnaps, registerSnapRoutes } = require('./snaps');
const alice = '11111111-1111-4111-8111-111111111111', bob = '22222222-2222-4222-8222-222222222222';
const carol = '33333333-3333-4333-8333-333333333333';
const clockStart = Date.parse('2026-10-11T12:00:00Z');
const request = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,avatar_url TEXT,profile_hidden BOOLEAN DEFAULT false,role_settings JSONB DEFAULT '{}');
    CREATE TABLE follows(follower_id TEXT,following_id TEXT); CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE connections(from_id TEXT,to_id TEXT,status TEXT); CREATE TABLE report_content_suppressions(target_type TEXT,target_id TEXT);`);
  for (const statement of SNAP_SCHEMA) await pg.exec(statement);
  for (const [id, name] of [[alice, 'Alice'], [bob, 'Bob'], [carol, 'Carol']]) await pg.query('INSERT INTO users(id,name) VALUES($1,$2)', [id, name]);
  let time = clockStart, sequence = 0, screen = async content => ({ allowed: true, content }), connected = true;
  const service = createSnaps({ db: { isConnected: () => connected, query: (...args) => pg.query(...args) }, now: () => time,
    uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    getUser: async id => (await pg.query('SELECT * FROM users WHERE id=$1', [id])).rows[0],
    validateUpload: async () => ({ publicId: `asset-${sequence}`, mediaUrl: 'https://media.invalid/snap.jpg', mediaType: 'image', thumbnailUrl: 'https://media.invalid/snap.jpg', bytes: 10 }),
    screenMemberContent: async ({ content }) => screen(content), removeMedia: async () => {} });
  const make = (author = alice, visibility = 'public') => service.create(author, { caption: 'A Snap', mediaType: 'image', visibility });
  return { pg, service, make, clock: value => { time = value; }, screening: fn => { screen = fn; }, connected: value => { connected = value; } };
}
const denied = status => error => error.status === status;

test('native Snap likes are durable, desired-state idempotent, and never optimistic after storage failure', async t => {
  const f = await fixture(t), snap = await f.make();
  assert.deepEqual(await f.service.engagement(snap.id, bob), { likesCount: 0, likedByMe: false, commentsCount: 0 });
  await Promise.all([f.service.like(bob, snap.id, { liked: true }), f.service.like(bob, snap.id, { liked: true })]);
  assert.deepEqual(await f.service.engagement(snap.id, bob), { likesCount: 1, likedByMe: true, commentsCount: 0 });
  assert.equal((await f.service.engagement(snap.id, carol)).likedByMe, false);
  assert.equal((await f.service.like(bob, snap.id, { liked: false })).likesCount, 0);
  for (const body of [{ liked: 'true' }, { liked: true, userId: alice }, null]) await assert.rejects(f.service.like(bob, snap.id, body), denied(400));
  await assert.rejects(f.service.like(null, snap.id, { liked: true }), denied(401));
  f.connected(false); await assert.rejects(f.service.like(bob, snap.id, { liked: true }), denied(503));
  f.connected(true); assert.equal((await f.service.engagement(snap.id, bob)).likesCount, 0);
});

test('all native interaction reads and writes honor current followers, two-way blocks, profile privacy and suppression', async t => {
  const f = await fixture(t), snap = await f.make(alice, 'followers');
  const exerciseDenied = async () => {
    await assert.rejects(f.service.get(snap.id, bob), denied(404));
    await assert.rejects(f.service.engagement(snap.id, bob), denied(404));
    await assert.rejects(f.service.comments(snap.id, bob), denied(404));
    await assert.rejects(f.service.like(bob, snap.id, { liked: true }), denied(404));
    await assert.rejects(f.service.comment(bob, snap.id, { content: 'Hello', requestId: request(1) }), denied(404));
  };
  await exerciseDenied();
  await f.pg.query('INSERT INTO follows VALUES($1,$2)', [bob, alice]);
  assert.equal((await f.service.like(bob, snap.id, { liked: true })).likedByMe, true);
  for (const [blocker, blocked] of [[alice, bob], [bob, alice]]) {
    await f.pg.query('INSERT INTO blocks VALUES($1,$2)', [blocker, blocked]); await exerciseDenied(); await f.pg.exec('DELETE FROM blocks');
  }
  await f.pg.exec('DELETE FROM follows'); await f.pg.query("UPDATE community_snaps SET visibility='public' WHERE id=$1", [snap.id]);
  await f.pg.query('UPDATE users SET profile_hidden=true WHERE id=$1', [alice]); await exerciseDenied();
  await f.pg.query("INSERT INTO connections VALUES($1,$2,'accepted')", [alice, bob]);
  assert.equal((await f.service.engagement(snap.id, bob)).likedByMe, true);
  await f.pg.query("INSERT INTO report_content_suppressions VALUES('post',$1)", [snap.id]); await exerciseDenied();
});

test('comments require screening and use a persistent member/request key for uncertain and concurrent retries', async t => {
  const f = await fixture(t), snap = await f.make();
  f.screening(async () => ({ allowed: false, reason: 'screening_unavailable' }));
  await assert.rejects(f.service.comment(bob, snap.id, { content: 'Hello', requestId: request(1) }), denied(503));
  f.screening(async () => ({ allowed: false, reason: 'policy' }));
  await assert.rejects(f.service.comment(bob, snap.id, { content: 'Hello', requestId: request(1) }), denied(422));
  f.screening(async content => ({ allowed: true, content: content.replace('raw', 'screened') }));
  const body = { content: 'raw comment', requestId: request(1) };
  const replies = await Promise.all([f.service.comment(bob, snap.id, body), f.service.comment(bob, snap.id, body)]);
  assert.equal(replies[0].comment.id, replies[1].comment.id); assert.equal(replies[0].comment.content, 'screened comment');
  assert.equal((await f.service.comment(bob, snap.id, body)).commentsCount, 1);
  await assert.rejects(f.service.comment(bob, snap.id, { ...body, content: 'Changed' }), denied(409));
  const other = await f.make(); await assert.rejects(f.service.comment(bob, other.id, body), denied(409));
  await f.service.comment(carol, snap.id, body); assert.equal((await f.service.engagement(snap.id, bob)).commentsCount, 2);
  for (const invalid of [{ content: ' ', requestId: request(2) }, { content: 'a'.repeat(1001), requestId: request(2) }, { content: 'Hello' }, { content: 'Hello', requestId: request(2), authorId: alice }]) {
    await assert.rejects(f.service.comment(bob, snap.id, invalid), denied(400));
  }
});

test('expiry and deletion recheck after asynchronous screening and remove engagement on cleanup', async t => {
  const f = await fixture(t), snap = await f.make();
  await f.service.like(bob, snap.id, { liked: true });
  await f.service.comment(bob, snap.id, { content: 'First', requestId: request(1) });
  f.screening(async content => { f.clock(clockStart + 86400000); return { allowed: true, content }; });
  await assert.rejects(f.service.comment(bob, snap.id, { content: 'Too late', requestId: request(2) }), denied(404));
  await assert.rejects(f.service.engagement(snap.id, bob), denied(404));
  await assert.rejects(f.service.get(snap.id, bob), denied(404));
  await assert.rejects(f.service.comments(snap.id, bob), denied(404));
  assert.equal((await f.pg.query('SELECT COUNT(*)::int n FROM snap_comments')).rows[0].n, 1);
  await f.service.cleanup();
  for (const table of ['snap_comments', 'snap_likes']) assert.equal((await f.pg.query(`SELECT COUNT(*)::int n FROM ${table}`)).rows[0].n, 0);
  f.clock(clockStart); f.screening(async content => ({ allowed: true, content }));
  const next = await f.make(); await f.service.remove(alice, next.id);
  await assert.rejects(f.service.like(bob, next.id, { liked: true }), denied(404));
});

test('comments paginate real rows and filter blocked authors and reported comments consistently with counts', async t => {
  const f = await fixture(t), snap = await f.make();
  const first = await f.service.comment(bob, snap.id, { content: 'One', requestId: request(1) });
  await f.service.comment(carol, snap.id, { content: 'Two', requestId: request(2) });
  await f.service.comment(alice, snap.id, { content: 'Three', requestId: request(3) });
  const page = await f.service.comments(snap.id, alice, { limit: 2 });
  assert.deepEqual(page.comments.map(c => c.content), ['One', 'Two']); assert.equal(page.hasMore, true); assert.equal(page.commentsCount, 3);
  assert.deepEqual((await f.service.comments(snap.id, alice, { limit: 2, offset: 2 })).comments.map(c => c.content), ['Three']);
  await f.pg.query('INSERT INTO blocks VALUES($1,$2)', [alice, carol]);
  await f.pg.query("INSERT INTO report_content_suppressions VALUES('comment',$1)", [first.comment.id]);
  await assert.rejects(f.service.comment(bob, snap.id, { content: 'One', requestId: request(1) }), denied(404), 'An idempotent retry never returns suppressed content');
  const filtered = await f.service.comments(snap.id, alice);
  assert.deepEqual(filtered.comments.map(c => c.content), ['Three']); assert.equal(filtered.commentsCount, 1);
  assert.equal((await f.service.engagement(snap.id, alice)).commentsCount, 1);
  await assert.rejects(f.service.comments(snap.id, alice, { offset: -1 }), denied(400));
  await assert.rejects(f.service.comments(snap.id, alice, { limit: 1000 }), denied(400));
});

test('new routes authenticate writes, apply limiter, and return private no-store responses', async t => {
  const f = await fixture(t), snap = await f.make(), routes = new Map();
  const optional = () => {}, auth = () => {}, limiter = () => {};
  registerSnapRoutes(Object.fromEntries(['get', 'post', 'delete'].map(method => [method, (path, ...handlers) => routes.set(`${method} ${path}`, handlers)])),
    { service: f.service, authenticateOptional: optional, authenticate: auth, limiter });
  for (const route of ['post /snaps/:id/like', 'post /snaps/:id/comments']) assert.deepEqual(routes.get(route).slice(0, -1), [auth, limiter]);
  for (const route of ['get /snaps/:id', 'get /snaps/:id/engagement', 'get /snaps/:id/comments']) {
    const handlers = routes.get(route); assert.equal(handlers[0], optional);
    const res = { set(name, value) { assert.equal(name, 'Cache-Control'); this.cache = value; }, status(value) { this.code = value; return this; }, json(value) { this.body = value; } };
    await handlers.at(-1)({ params: { id: snap.id }, user: { id: bob }, query: {} }, res);
    assert.equal(res.code, 200); assert.equal(res.cache, 'private, no-store');
  }
});

test('public native Snap permalinks resolve an authorized live snapshot without extending expiry or exposing upload identifiers', async t => {
  const f = await fixture(t), snap = await f.make();
  const publicSnap = await f.service.get(snap.id);
  assert.equal(publicSnap.id, snap.id); assert.equal(publicSnap.author.name, 'Alice'); assert.equal(publicSnap.owned, false);
  assert.equal(publicSnap.expiresAt, snap.expiresAt); assert.equal(publicSnap.source, 'uficonnect');
  assert.equal(publicSnap.public_id, undefined); assert.equal(publicSnap.media_bytes, undefined);
  assert.equal((await f.service.get(snap.id, alice)).owned, true);
  const privateSnap = await f.make(alice, 'followers');
  await assert.rejects(f.service.get(privateSnap.id), denied(404));
  await f.service.remove(alice, snap.id); await assert.rejects(f.service.get(snap.id), denied(404));
});
