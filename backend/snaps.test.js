'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { SNAP_SCHEMA, createSnaps, registerSnapRoutes } = require('./snaps');
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const carol = '33333333-3333-4333-8333-333333333333';
const hidden = '44444444-4444-4444-8444-444444444444';
const now = Date.parse('2026-10-08T12:00:00Z');
async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,avatar_url TEXT,profile_hidden BOOLEAN DEFAULT false,role_settings JSONB DEFAULT '{}');
    CREATE TABLE follows(follower_id TEXT,following_id TEXT);
    CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE connections(from_id TEXT,to_id TEXT,status TEXT);
    CREATE TABLE report_content_suppressions(target_type TEXT,target_id TEXT);`);
  for (const sql of SNAP_SCHEMA) await pg.exec(sql);
  for (const [id, name] of [[alice, 'Alice'], [bob, 'Bob'], [carol, 'Carol'], [hidden, 'Hidden']]) await pg.query('INSERT INTO users(id,name) VALUES($1,$2)', [id, name]);
  await pg.query('UPDATE users SET profile_hidden=true WHERE id=$1', [hidden]);
  let connected = true, screening = 'allowed', destructionFails = false, clock = now, clockStep = 0, unique = 0;
  const removedMedia = [], db = { isConnected: () => connected, query: (...args) => pg.query(...args) };
  const service = createSnaps({ db, now: () => { clock += clockStep; return clock; }, uuid: () => `00000000-0000-4000-8000-${String(++unique).padStart(12, '0')}`,
    getUser: async id => { const user = (await pg.query('SELECT * FROM users WHERE id=$1', [id])).rows[0]; return user ? { ...user, avatarUrl: user.avatar_url } : null; },
    validateUpload: async (_id, body) => ({ publicId: body.upload.publicId, mediaUrl: 'https://media.invalid/photo.jpg', mediaType: body.mediaType,
      thumbnailUrl: 'https://media.invalid/photo.jpg', bytes: 10, duration: body.mediaType === 'video' ? 15 : null }),
    removeMedia: async (id, type) => { if (destructionFails) throw new Error('unavailable'); removedMedia.push([id, type]); },
    screenMemberContent: async ({ content }) => screening === 'allowed' ? { allowed: true, content } : { allowed: false, reason: screening } });
  const body = (key, visibility = 'public') => ({ caption: 'A snap', visibility, mediaType: 'image', mediaUrl: 'https://media.invalid/photo.jpg', upload: { publicId: key } });
  return { pg, db, service, body, removedMedia, controls: {
    connected: value => { connected = value; }, screening: value => { screening = value; },
    destructionFails: value => { destructionFails = value; }, clock: value => { clock = value; },
    advanceClock: () => { clockStep = 1; } } };
}
test('native Snaps respect followers, blocks, profile visibility and expiry without using feed seen state', async t => {
  const { pg, service, body, controls } = await fixture(t);
  const own = await service.create(alice, body('own', 'followers'));
  const followed = await service.create(bob, body('followed', 'followers'));
  const publicSnap = await service.create(carol, body('public'));
  await service.create(hidden, body('hidden'));
  assert.deepEqual((await service.list()).map(snap => snap.id), [publicSnap.id]);
  assert.deepEqual((await service.list({ viewerId: alice, mode: 'following' })).map(snap => snap.id), [own.id]);
  await pg.query('INSERT INTO follows VALUES($1,$2)', [alice, bob]);
  assert.deepEqual(new Set((await service.list({ viewerId: alice, mode: 'home' })).map(snap => snap.id)), new Set([own.id, followed.id, publicSnap.id]));
  assert.deepEqual(new Set((await service.list({ viewerId: alice, mode: 'following' })).map(snap => snap.id)), new Set([own.id, followed.id]));
  await pg.query('INSERT INTO blocks VALUES($1,$2)', [bob, alice]);
  assert.deepEqual((await service.list({ viewerId: alice, mode: 'following' })).map(snap => snap.id), [own.id]);
  await pg.query("INSERT INTO report_content_suppressions VALUES('post',$1)", [publicSnap.id]);
  assert.deepEqual((await service.list()).map(snap => snap.id), []);
  await assert.rejects(service.list({ mode: 'following' }), error => error.status === 401);
  controls.clock(now + 86400000);
  assert.deepEqual(await service.list({ viewerId: alice }), [], 'Exact 24 hour boundary is expired');
});
test('publication is durable, rejects changes to ownership/lifetime and fails closed on screening or storage errors', async t => {
  const { pg, service, body, controls } = await fixture(t);
  for (const extra of [{ authorId: bob }, { expiresAt: '2030-01-01' }, { caption: 'a'.repeat(501) }, { visibility: 'anybody' }]) {
    await assert.rejects(service.create(alice, { ...body('invalid'), ...extra }), error => error.status === 400);
  }
  controls.screening('policy'); await assert.rejects(service.create(alice, body('screened')), error => error.status === 422);
  controls.screening('screening_unavailable'); await assert.rejects(service.create(alice, body('screened')), error => error.status === 503);
  controls.screening('allowed'); controls.connected(false); await assert.rejects(service.create(alice, body('outage')), error => error.status === 503);
  controls.connected(true); controls.advanceClock(); const snap = await service.create(alice, body('published'));
  assert.equal(snap.owned, true); assert.equal(snap.author.name, 'Alice');
  assert.equal(Date.parse(snap.expiresAt) - Date.parse(snap.createdAt), 86400000);
  assert.equal((await pg.query('SELECT count(*)::int AS total FROM community_snaps')).rows[0].total, 1);
  await assert.rejects(service.create(alice, body('published')), error => error.status === 409);
  await pg.exec("ALTER TABLE community_snaps ADD CONSTRAINT reject_snap_caption CHECK(caption <> 'storage failure')");
  await assert.rejects(service.create(alice, { ...body('failed-write'), caption: 'storage failure' }), error => error.status === 503);
  assert.equal((await pg.query('SELECT count(*)::int AS total FROM community_snaps')).rows[0].total, 1);
});
test('owner removal hides immediately; failed media cleanup retries and successful cleanup prevents asset reuse', async t => {
  const { pg, service, body, controls, removedMedia } = await fixture(t);
  const snap = await service.create(alice, body('owned-photo'));
  await assert.rejects(service.remove(bob, snap.id), error => error.status === 404);
  await service.remove(alice, snap.id); assert.deepEqual(await service.list(), []);
  controls.destructionFails(true);
  assert.deepEqual(await service.cleanup(), { cleaned: 0, retrying: 1 });
  assert.equal((await pg.query('SELECT media_cleaned_at FROM community_snaps')).rows[0].media_cleaned_at, null);
  controls.destructionFails(false);
  assert.deepEqual(await service.cleanup(), { cleaned: 1, retrying: 0 });
  assert.deepEqual(removedMedia, [['owned-photo', 'image']]);
  assert.equal((await pg.query('SELECT caption FROM community_snaps')).rows[0].caption, '');
  await assert.rejects(service.create(alice, body('owned-photo')), error => error.status === 409);
  await pg.query("INSERT INTO snap_media_cleanup(public_id,media_type) VALUES('departed-account-asset','video')");
  assert.deepEqual(await service.cleanup(), { cleaned: 1, retrying: 0 });
  assert.equal((await pg.query('SELECT count(*)::int AS total FROM snap_media_cleanup')).rows[0].total, 0);
  controls.clock(now + 8 * 86400000); await service.cleanup();
  assert.equal((await pg.query('SELECT count(*)::int AS total FROM community_snaps')).rows[0].total, 0);
});
test('Snap routes enforce authentication and private caching; UFI never invokes external adapters', async t => {
  const { service } = await fixture(t);
  const routes = {}, optional = () => {}, auth = () => {}, limiter = () => {}; let externalReads = 0;
  registerSnapRoutes({ get: (path, ...handlers) => { assert.equal(handlers[0], optional); routes.get = handlers.at(-1); },
    post: (path, ...handlers) => { assert.equal(handlers[0], auth); assert.equal(handlers[1], limiter); },
    delete: (path, ...handlers) => { assert.equal(handlers[0], auth); assert.equal(handlers[1], limiter); } }, {
    service, authenticate: auth, authenticateOptional: optional, limiter,
    loadExternalSnaps: async () => { externalReads++; return { snaps: [], sourceErrors: {} }; } });
  async function get(mode) {
    const response = { code: 200, set(name, value) { this.cache = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await routes.get({ query: { mode } }, response); return response;
  }
  assert.equal((await get('following')).code, 401); assert.equal(externalReads, 0);
  assert.equal((await get('ufi')).code, 200); assert.equal(externalReads, 0);
  assert.equal((await get('home')).cache, 'private, no-store'); assert.equal(externalReads, 1);
  assert.equal((await get('invalid')).code, 400);
});

test('source refresh isolates native storage and external adapters, rejects invalid sources and protects Following', async () => {
  let get, nativeReads = 0;
  const externalCalls = [];
  registerSnapRoutes({ get: (_path, ...handlers) => { get = handlers.at(-1); }, post() {}, delete() {} }, {
    service: { list: async () => { nativeReads++; return [{ id: 'native', source: 'uficonnect' }]; } },
    authenticate() {}, authenticateOptional() {}, limiter() {},
    loadExternalSnaps: async options => {
      externalCalls.push(options);
      return { snaps: [{ id: 'masto', source: 'mastodon' }, { id: 'x', source: 'twitter' }],
        sourceErrors: { mastodon: 'Reconnect Mastodon.', twitter: 'Reconnect X.' } };
    },
  });
  async function request(query, user = { id: alice }) {
    const response = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await get({ query, user }, response); return response;
  }
  const native = await request({ mode: 'home', source: 'uficonnect', bust: '1' });
  assert.deepEqual(native.body.snaps, [{ id: 'native', source: 'uficonnect' }]);
  assert.equal(nativeReads, 1); assert.equal(externalCalls.length, 0);
  const external = await request({ mode: 'following', source: 'mastodon', bust: '1' });
  assert.deepEqual(external.body.snaps, [{ id: 'masto', source: 'mastodon' }]);
  assert.deepEqual(external.body.sourceErrors, { mastodon: 'Reconnect Mastodon.' });
  assert.equal(nativeReads, 1);
  assert.deepEqual(externalCalls, [{ mode: 'following', viewerId: alice, source: 'mastodon', bust: true }]);
  for (const query of [{ mode: 'home', source: 'unknown' }, { mode: 'ufi', source: 'mastodon' },
    { mode: 'following', source: 'facebook' }, { mode: 'home', source: ['mastodon'] }]) {
    assert.equal((await request(query)).code, 400);
  }
  assert.equal((await request({ mode: 'following', source: 'mastodon' }, null)).code, 401);
  assert.equal(nativeReads, 1); assert.equal(externalCalls.length, 1);
});
