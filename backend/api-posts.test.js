'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { createAPIKeys, registerAPIKeyRoutes } = require('./api-keys');
const { createAPIPosts, registerAPIPostRoutes } = require('./api-posts');
const { createAppHarness, member } = require('./test-support/app-harness');

const denied = status => error => error.status === status && typeof error.publicMessage === 'string';
const body = overrides => ({ requestId: randomUUID(), content: 'Synthetic public API post', title: 'API title', ...overrides });

async function fixture(t) {
  const pg = new PGlite(); await pg.waitReady; t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT NOT NULL,billing_closed BOOLEAN NOT NULL DEFAULT false);
    CREATE TABLE community_posts(id TEXT PRIMARY KEY,group_id TEXT,author_id TEXT,author_name TEXT,title TEXT,content TEXT NOT NULL,
      source TEXT,source_label TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),media_url TEXT,media_type TEXT);`);
  const state = { failOwnership: false, failNotify: false, screen: options => ({ allowed: true, content: options.content.trim() }) };
  let queue = Promise.resolve();
  const db = { isConnected: () => true, query(sql, params) {
    if (state.failOwnership && sql.startsWith('INSERT INTO ufi_api_posts')) throw new Error('synthetic private storage failure');
    return pg.query(sql, params);
  }, withClient(work) { const result = queue.then(() => work({ query: (sql, params) => db.query(sql, params) })); queue = result.catch(() => {}); return result; } };
  const keys = createAPIKeys({ db });
  const owners = [randomUUID(), randomUUID()];
  for (let index = 0; index < owners.length; index++) await pg.query('INSERT INTO users(id,name) VALUES($1,$2)', [owners[index], `API member ${index}`]);
  async function key({ ownerId = owners[0], scopes = ['topics:read', 'feed:read', 'posts:publish', 'posts:edit'] } = {}) {
    const created = await keys.create({ name: 'Post integration', type: 'data', ownerId, scopes, expiresInDays: 30 });
    return { ...created, auth: await keys.consume(`Bearer ${created.key}`, scopes[0]) };
  }
  const screening = [], changed = [];
  const options = { db, async screenContent(input) { screening.push(input); return state.screen(input); },
    validateMedia({ mediaUrl, mediaType }) {
      if (!mediaUrl.startsWith('https://res.cloudinary.com/test/image/upload/') && !mediaUrl.startsWith('https://res.cloudinary.com/test/video/upload/')) {
        throw Object.assign(new Error('Use a verified media upload.'), { status: 400, publicMessage: 'Use a verified media upload.' });
      }
      return { mediaUrl, mediaType };
    }, async onChanged(post, action) { if (state.failNotify) throw new Error('synthetic notification failure'); changed.push({ post, action }); } };
  const posts = createAPIPosts(options);
  return { pg, db, keys, key, owners, state, screening, changed, options, posts };
}

test('API posts publish and edit real native records with durable ownership, moderation, and safe retries', async t => {
  const f = await fixture(t);
  const primary = await f.key(), sameOwner = await f.key(), otherOwner = await f.key({ ownerId: f.owners[1] });
  let original;

  await t.test('publication persists a normal native post and exposes only its public owner and content fields', async () => {
    const result = await f.posts.publish(primary.auth, body({ content: '  Public content  ', title: '  Public title  ' }));
    original = result.post;
    assert.match(original.id, /^[a-f0-9-]{36}$/);
    assert.equal(original.groupId, 'ufi-general'); assert.equal(original.authorId, f.owners[0]);
    assert.equal(original.authorName, 'API member 0'); assert.equal(original.source, 'uficonnect');
    assert.equal(original.content, 'Public content'); assert.equal(original.title, 'Public title'); assert.equal(original.version, 1);
    const row = (await f.pg.query('SELECT * FROM community_posts WHERE id=$1', [original.id])).rows[0];
    assert.equal(row.content, original.content); assert.equal(row.author_id, f.owners[0]); assert.equal(row.group_id, 'ufi-general');
    assert.equal((await f.posts.get(primary.auth, original.id)).post.id, original.id);
    assert.equal(f.changed.at(-1).action, 'published');
    assert.doesNotMatch(JSON.stringify(result), /key_hash|request_hash|password|email/);
  });

  await t.test('matching retries are idempotent and conflicting request IDs cannot replace prior content', async () => {
    const input = body();
    const first = await f.posts.publish(primary.auth, input), screened = f.screening.length;
    const retried = await f.posts.publish(primary.auth, input);
    assert.equal(retried.replayed, true); assert.equal(retried.post.id, first.post.id); assert.equal(f.screening.length, screened);
    await assert.rejects(f.posts.publish(primary.auth, { ...input, content: 'Different content' }), denied(409));
    const concurrent = body({ content: 'Concurrent retry' });
    const results = await Promise.all([f.posts.publish(primary.auth, concurrent), f.posts.publish(primary.auth, concurrent)]);
    assert.equal(results[0].post.id, results[1].post.id); assert.equal(results.filter(result => result.replayed).length, 1);
    assert.equal((await f.pg.query('SELECT count(*)::int AS count FROM ufi_api_posts WHERE key_id=$1 AND request_id=$2', [primary.auth.id, concurrent.requestId])).rows[0].count, 1);
    assert.equal(f.changed.filter(change => change.post.id === results[0].post.id).length, 1);
  });

  await t.test('reading and editing are limited to the same key, including keys bound to the same member', async () => {
    for (const key of [sameOwner, otherOwner]) {
      await assert.rejects(f.posts.get(key.auth, original.id), denied(404));
      await assert.rejects(f.posts.edit(key.auth, original.id, { content: 'Unauthorized', expectedVersion: 1 }), denied(404));
    }
    const oldId = randomUUID();
    await f.pg.query("INSERT INTO community_posts(id,author_id,group_id,content,source) VALUES($1,$2,'ufi-general','Existing manual post','uficonnect')", [oldId, f.owners[0]]);
    await assert.rejects(f.posts.edit(primary.auth, oldId, { content: 'Cannot adopt old posts', expectedVersion: 1 }), denied(404));
    const readOnly = await f.key({ scopes: ['feed:read'] });
    await assert.rejects(f.posts.publish(readOnly.auth, body()), denied(403));
    await assert.rejects(f.posts.edit(readOnly.auth, original.id, { content: 'No write permission', expectedVersion: 1 }), denied(403));
    for (const injection of [{ authorId: f.owners[1] }, { ownerId: f.owners[1] }, { groupId: 'private-group' }, { source: 'reddit' }]) {
      await assert.rejects(f.posts.publish(primary.auth, body(injection)), denied(400));
    }
  });

  await t.test('deleting a native post preserves a request tombstone so delayed retries cannot republish it', async () => {
    const input = body(), published = await f.posts.publish(primary.auth, input);
    await f.pg.query('DELETE FROM community_posts WHERE id=$1', [published.post.id]);
    await assert.rejects(f.posts.get(primary.auth, published.post.id), denied(404));
    await assert.rejects(f.posts.publish(primary.auth, input), denied(410));
    assert.equal((await f.pg.query('SELECT count(*)::int AS count FROM ufi_api_posts WHERE request_id=$1', [input.requestId])).rows[0].count, 1);
    assert.equal((await f.pg.query('SELECT count(*)::int AS count FROM community_posts WHERE id=$1', [published.post.id])).rows[0].count, 0);
  });

  await t.test('edits preserve omitted titles and require the current version to prevent lost updates', async () => {
    const edited = await f.posts.edit(primary.auth, original.id, { content: 'Edited content', expectedVersion: 1 });
    assert.equal(edited.post.title, 'Public title'); assert.equal(edited.post.content, 'Edited content'); assert.equal(edited.post.version, 2);
    await assert.rejects(f.posts.edit(primary.auth, original.id, { content: 'Stale content', expectedVersion: 1 }), denied(409));
    const results = await Promise.allSettled([
      f.posts.edit(primary.auth, original.id, { content: 'Concurrent edit A', title: 'New title', expectedVersion: 2 }),
      f.posts.edit(primary.auth, original.id, { content: 'Concurrent edit B', title: 'New title', expectedVersion: 2 }),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
    const latest = (await f.posts.get(primary.auth, original.id)).post;
    assert.equal(latest.version, 3); assert.equal(latest.title, 'New title');
    assert.equal(f.changed.at(-1).action, 'edited');
    await assert.rejects(f.posts.edit(primary.auth, original.id, { content: 'No media mutation', expectedVersion: 3, mediaUrl: 'https://example.invalid/image.png' }), denied(400));
  });

  await t.test('content, title, and media validation and moderation apply before native writes', async () => {
    const before = (await f.pg.query('SELECT count(*)::int AS count FROM community_posts')).rows[0].count;
    for (const input of [body({ content: '' }), body({ content: 'x'.repeat(2001) }), body({ title: 'x'.repeat(201) }), body({ title: 'Title\ncontrol' }),
      body({ requestId: 'not-a-uuid' }), body({ mediaUrl: 'https://untrusted.invalid/image.jpg', mediaType: 'image' }),
      body({ mediaUrl: 'https://res.cloudinary.com/test/image/upload/file.jpg' }), body({ content: '', mediaUrl: 'https://res.cloudinary.com/test/video/upload/file.mp4', mediaType: 'video' })]) {
      await assert.rejects(f.posts.publish(primary.auth, input), denied(400));
    }
    f.state.screen = () => ({ allowed: false, reason: 'blocked' });
    await assert.rejects(f.posts.publish(primary.auth, body()), denied(422));
    f.state.screen = () => ({ allowed: false, reason: 'screening_unavailable' });
    await assert.rejects(f.posts.publish(primary.auth, body()), denied(503));
    f.state.screen = options => ({ allowed: true, content: options.content.trim() });
    assert.equal((await f.pg.query('SELECT count(*)::int AS count FROM community_posts')).rows[0].count, before);
    const photo = await f.posts.publish(primary.auth, body({ content: '', title: '', mediaUrl: 'https://res.cloudinary.com/test/image/upload/file.jpg', mediaType: 'image' }));
    assert.equal(photo.post.content, ''); assert.equal(photo.post.mediaType, 'image');
  });

  await t.test('native website/app changes advance API versions and cannot be overwritten by an API edit screened earlier', async () => {
    const created = await f.posts.publish(primary.auth, body());
    await f.pg.query('UPDATE community_posts SET content=$2 WHERE id=$1', [created.post.id, 'A newer native edit']);
    const current = (await f.posts.get(primary.auth, created.post.id)).post;
    assert.equal(current.version, 2); assert.equal(current.content, 'A newer native edit');
    await assert.rejects(f.posts.edit(primary.auth, created.post.id, { content: 'Stale client edit', expectedVersion: 1 }), denied(409));
    let entered, release;
    const screened = new Promise(resolve => { entered = resolve; }), hold = new Promise(resolve => { release = resolve; });
    f.state.screen = async options => { entered(); await hold; return { allowed: true, content: options.content }; };
    const pending = f.posts.edit(primary.auth, created.post.id, { content: 'Screened against old content', title: '', expectedVersion: 2 });
    await screened;
    await f.pg.query('UPDATE community_posts SET content=$2 WHERE id=$1', [created.post.id, 'Another native edit during screening']);
    release(); await assert.rejects(pending, denied(409));
    f.state.screen = options => ({ allowed: true, content: options.content.trim() });
    assert.equal((await f.posts.get(primary.auth, created.post.id)).post.content, 'Another native edit during screening');
  });

  await t.test('revocation and account closure during asynchronous screening block the eventual write', async () => {
    for (const revoke of [true, false]) {
      const fresh = await f.key({ ownerId: revoke ? f.owners[0] : f.owners[1] });
      let entered, release;
      const screened = new Promise(resolve => { entered = resolve; });
      const hold = new Promise(resolve => { release = resolve; });
      f.state.screen = async options => { entered(); await hold; return { allowed: true, content: options.content }; };
      const before = (await f.pg.query('SELECT count(*)::int AS count FROM community_posts')).rows[0].count;
      const pending = f.posts.publish(fresh.auth, body({ title: '' }));
      await screened;
      if (revoke) await f.keys.revoke(fresh.auth.id);
      else await f.pg.query('UPDATE users SET billing_closed=true WHERE id=$1', [f.owners[1]]);
      release();
      await assert.rejects(pending, denied(401));
      assert.equal((await f.pg.query('SELECT count(*)::int AS count FROM community_posts')).rows[0].count, before);
    }
    await f.pg.query('UPDATE users SET billing_closed=false WHERE id=$1', [f.owners[1]]);
    f.state.screen = options => ({ allowed: true, content: options.content.trim() });
  });

  await t.test('native post and ownership writes roll back together and notification failures do not erase committed posts', async () => {
    const before = (await f.pg.query('SELECT count(*)::int AS count FROM community_posts')).rows[0].count;
    f.state.failOwnership = true;
    await assert.rejects(f.posts.publish(primary.auth, body()), /synthetic private storage failure/);
    f.state.failOwnership = false;
    assert.equal((await f.pg.query('SELECT count(*)::int AS count FROM community_posts')).rows[0].count, before);
    f.state.failNotify = true;
    const saved = await f.posts.publish(primary.auth, body());
    f.state.failNotify = false;
    assert.equal((await f.posts.get(primary.auth, saved.post.id)).post.id, saved.post.id);
  });

  await t.test('HTTP endpoints enforce their scopes, return versions and no-store headers, and accept safe publishing retries', async () => {
    const app = express(); app.use(express.json());
    const apiKeys = registerAPIKeyRoutes(app, { db: f.db, requireOfficeToken: (_req, res) => res.sendStatus(401), topics: [], readFeed: async () => ({ posts: [] }) });
    registerAPIPostRoutes(app, { apiKeys, ...f.options });
    const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const request = async (path, method = 'GET', input, secret = primary.key) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
        headers: { Authorization: `Bearer ${secret}`, ...(input ? { 'Content-Type': 'application/json' } : {}) }, body: input ? JSON.stringify(input) : undefined });
      return { status: response.status, headers: response.headers, data: await response.json() };
    };
    const input = body();
    const created = await request('/api/v1/posts', 'POST', input);
    assert.equal(created.status, 201); assert.equal(created.headers.get('cache-control'), 'private, no-store');
    const path = `/api/v1/posts/${created.data.post.id}`;
    const retry = await request('/api/v1/posts', 'POST', input);
    assert.equal(retry.status, 200); assert.equal(retry.data.replayed, true);
    assert.equal((await request(path, 'GET', undefined, sameOwner.key)).status, 404);
    assert.equal((await request(path, 'PATCH', { content: 'Edited over HTTP', expectedVersion: 1 })).data.post.version, 2);
    assert.equal((await request(path, 'PATCH', { content: 'Stale over HTTP', expectedVersion: 1 })).status, 409);
    const readOnly = await f.key({ scopes: ['feed:read'] });
    assert.equal((await request('/api/v1/posts', 'POST', body(), readOnly.key)).status, 403);
    f.state.failOwnership = true;
    const failed = await request('/api/v1/posts', 'POST', body());
    f.state.failOwnership = false;
    assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed.data), /synthetic private storage failure/);
  });

  await t.test('missing authoritative transaction support fails closed', async () => {
    const withoutTransactions = createAPIPosts({ ...f.options, db: { ...f.db, withClient: undefined } });
    await assert.rejects(withoutTransactions.publish(primary.auth, body()), denied(503));
  });

  await t.test('the actual app updates its native post cache and SSE after API publishing and editing', async () => {
    await f.pg.exec(`ALTER TABLE users ADD COLUMN joined_groups TEXT[] DEFAULT '{}';
      CREATE TABLE community_groups(id TEXT PRIMARY KEY,is_private BOOLEAN,created_by TEXT);
      INSERT INTO community_groups(id,is_private) VALUES('ufi-general',false);
      CREATE TABLE report_content_suppressions(target_type TEXT,target_id TEXT,source TEXT,source_url TEXT);`);
    const app = await createAppHarness({ connected: true, env: { OFFICE_TOKEN: 'post-integration-office' },
      query: (sql, params) => f.db.query(sql, params), withClient: work => f.db.withClient(work) });
    t.after(() => app.close()); app.markSecurityStorageReady();
    app.seedUser(member(f.owners[0], { name: 'API member 0' }));
    app.setContentScreening(async options => ({ allowed: true, content: options.content }));
    const events = [];
    app.sseClients.set('api-publish-test', { feedViewerId: f.owners[0], write(value) { events.push(value); } });
    const headers = { authorization: `Bearer ${primary.key}` };
    app.mainFeedSnapshots.set('fixture-before-publication', { posts: [] });
    const published = await app.request('/api/v1/posts', { method: 'POST', headers, body: body({ title: '' }) });
    assert.equal(published.status, 201);
    assert.equal(app.posts.find(post => post.id === published.data.post.id).content, published.data.post.content);
    assert.equal(app.mainFeedSnapshots.size, 0);
    await app.flushSSEBatch();
    assert.ok(events.some(event => event.includes(published.data.post.id)));
    const beforeEdit = events.length;
    app.mainFeedSnapshots.set('fixture-before-edit', { posts: [] });
    const edited = await app.request(`/api/v1/posts/${published.data.post.id}`, { method: 'PATCH', headers,
      body: { content: 'Updated through the real app route', expectedVersion: 1 } });
    assert.equal(edited.status, 200); assert.equal(edited.data.post.version, 2);
    assert.equal(app.posts.find(post => post.id === published.data.post.id).content, 'Updated through the real app route');
    assert.equal(app.mainFeedSnapshots.size, 0);
    await app.flushSSEBatch();
    assert.ok(events.length > beforeEdit); assert.ok(events.at(-1).includes(published.data.post.id));
    assert.equal(app.errors.some(error => /post.*(?:error|failed)/i.test(error)), false);
  });
});
