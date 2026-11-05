'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { API_KEY_TYPES, API_KEY_RATE_LIMIT, API_KEY_GENERATION_LIMITS, createAPIKeys, registerAPIKeyRoutes, feedParameters } = require('./api-keys');
const { createAppHarness } = require('./test-support/app-harness');

async function fixture(t) {
  const pg = new PGlite(); await pg.waitReady; t.after(() => pg.close());
  await pg.exec('CREATE TABLE users(id UUID PRIMARY KEY,name TEXT NOT NULL,billing_closed BOOLEAN NOT NULL DEFAULT false)');
  const calls = [];
  const db = { isConnected: () => true, query: (sql, params) => { calls.push({ sql, params }); return pg.query(sql, params); } };
  return { pg, db, calls, service: createAPIKeys({ db }) };
}
const input = overrides => ({ name: 'Server integration', type: 'data', scopes: ['topics:read', 'feed:read'], expiresInDays: 30, ...overrides });
const bearer = key => `Bearer ${key}`;
const denied = (status, error) => error.status === status && error.publicMessage === error.message;

test('keys use random secrets, persist only hashes, and return metadata without recoverable secrets', async t => {
  const { service, pg, db } = await fixture(t);
  const created = await service.create(input());
  const second = await service.create(input({ expiresInDays: null }));
  assert.match(created.key, /^ufi_live_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(created.key, second.key);
  assert.equal(created.apiKey.prefix, created.key.slice(0, 17));
  assert.equal(created.apiKey.type, 'data');
  assert.equal(created.apiKey.status, 'active');
  assert.ok(new Date(created.apiKey.expiresAt) > new Date(created.apiKey.createdAt));
  assert.equal(second.apiKey.expiresAt, null);
  const stored = (await pg.query('SELECT * FROM ufi_api_keys')).rows;
  assert.equal(stored.find(row => row.id === created.apiKey.id).key_hash, createHash('sha256').update(created.key).digest('hex'));
  assert.ok(!JSON.stringify(stored).includes(created.key));
  const restarted = createAPIKeys({ db });
  const list = await restarted.list();
  assert.equal(list.keys.length, 2);
  assert.deepEqual(list.types, API_KEY_TYPES);
  assert.deepEqual(list.generationLimits, API_KEY_GENERATION_LIMITS);
  assert.equal(list.apiBasePath, '/api/v1');
  assert.ok(!JSON.stringify(list).includes(created.key));
  assert.ok(!JSON.stringify(list).includes('key_hash'));
  const auth = await restarted.consume(bearer(created.key), 'feed:read');
  assert.deepEqual(auth, { id: created.apiKey.id, type: 'data', ownerId: null, scopes: ['topics:read', 'feed:read'] });
  assert.ok((await restarted.list()).keys.find(key => key.id === created.apiKey.id).lastUsedAt);
});

test('each key type can select only its own permissions and the database enforces isolation', async t => {
  const { service, pg } = await fixture(t);
  const ownerId = randomUUID(); await pg.query('INSERT INTO users(id,name) VALUES($1,$2)', [ownerId, 'API author']);
  for (const definition of API_KEY_TYPES) {
    const created = await service.create(input({ type: definition.id, scopes: definition.scopes, ...(definition.id === 'data' ? { ownerId } : {}) }));
    for (const scope of definition.scopes) assert.equal((await service.consume(bearer(created.key), scope)).type, definition.id);
    const other = API_KEY_TYPES.find(type => type.id !== definition.id).scopes[0];
    await assert.rejects(service.consume(bearer(created.key), other), error => denied(403, error));
    await assert.rejects(service.create(input({ type: definition.id, scopes: [...definition.scopes, other] })), error => denied(400, error));
    await assert.rejects(pg.query('UPDATE ufi_api_keys SET scopes=$2 WHERE id=$1', [created.apiKey.id, [other]]), /check constraint/i);
  }
  const imageOnly = await service.create(input({ type: 'media', scopes: ['images:generate'] }));
  await assert.rejects(service.consume(bearer(imageOnly.key), 'videos:generate'), error => denied(403, error));
  const videoOnly = await service.create(input({ type: 'media', scopes: ['videos:generate'] }));
  await assert.rejects(service.consume(bearer(videoOnly.key), 'images:generate'), error => denied(403, error));
});

test('publishing and editing keys require a real active member and stop authenticating when that member closes or is deleted', async t => {
  const { service, pg } = await fixture(t);
  const ownerId = randomUUID(), closedId = randomUUID();
  await pg.query('INSERT INTO users(id,name,billing_closed) VALUES($1,$2,false),($3,$4,true)', [ownerId, 'API author', closedId, 'Closed author']);
  const writing = input({ scopes: ['feed:read', 'posts:publish', 'posts:edit'], ownerId });
  for (const body of [input({ scopes: ['posts:publish'] }), input({ scopes: ['posts:edit'], ownerId: 'bad' }),
    input({ scopes: ['posts:edit'], ownerId }),
    { ...writing, ownerId: randomUUID() }, { ...writing, ownerId: closedId },
    input({ type: 'ai-chat', scopes: ['ai:chat'], ownerId })]) {
    await assert.rejects(service.create(body), error => denied(400, error));
  }
  const created = await service.create(writing);
  assert.equal(created.apiKey.ownerId, ownerId);
  assert.equal((await service.consume(bearer(created.key), 'posts:publish')).ownerId, ownerId);
  await assert.rejects(pg.query('UPDATE ufi_api_keys SET owner_id=NULL WHERE id=$1', [created.apiKey.id]), /check constraint/i);
  await pg.query('UPDATE users SET billing_closed=true WHERE id=$1', [ownerId]);
  await assert.rejects(service.consume(bearer(created.key), 'posts:publish'), error => denied(401, error));
  await assert.rejects(service.consume(bearer(created.key), 'feed:read'), error => denied(401, error));
  await pg.query('UPDATE users SET billing_closed=false WHERE id=$1', [ownerId]);
  await service.consume(bearer(created.key), 'posts:edit');
  await pg.query('DELETE FROM users WHERE id=$1', [ownerId]);
  await assert.rejects(service.consume(bearer(created.key), 'posts:edit'), error => denied(401, error));
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM ufi_api_keys')).rows[0].count, 0);
});

test('invalid names, scopes, expiry choices, and unexpected fields never write keys', async t => {
  const { service, pg } = await fixture(t);
  await service.list();
  for (const body of [null, [], {}, input({ name: '' }), input({ name: 'x'.repeat(81) }), input({ name: 'name\nsecret' }),
    input({ scopes: [] }), input({ scopes: ['office:admin'] }), input({ scopes: ['feed:read', 'feed:read'] }),
    input({ type: 'all' }), input({ type: 'ai-chat', scopes: ['feed:read'] }), input({ expiresInDays: '30' }),
    input({ expiresInDays: 0 }), input({ expiresInDays: false }), input({ expiresInDays: 100 }), input({ admin: true })]) {
    await assert.rejects(service.create(body), error => denied(400, error));
  }
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM ufi_api_keys')).rows[0].count, 0);
  const defaulted = await service.create({ name: 'Default data key', scopes: ['topics:read'] });
  assert.equal(defaulted.apiKey.type, 'data');
  assert.equal(Math.round((new Date(defaulted.apiKey.expiresAt) - new Date(defaulted.apiKey.createdAt)) / 86400000), 90);
});

test('revocation and expiration apply on every request across service instances', async t => {
  const { service, pg, db } = await fixture(t);
  const created = await service.create(input());
  const other = createAPIKeys({ db });
  await other.consume(bearer(created.key), 'topics:read');
  const revoked = await service.revoke(created.apiKey.id);
  assert.equal(revoked.apiKey.status, 'revoked');
  assert.equal((await other.revoke(created.apiKey.id)).apiKey.revokedAt.toISOString(), revoked.apiKey.revokedAt.toISOString());
  await assert.rejects(other.consume(bearer(created.key), 'topics:read'), error => denied(401, error));
  const expiring = await service.create(input());
  await pg.query("UPDATE ufi_api_keys SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", [expiring.apiKey.id]);
  await assert.rejects(other.consume(bearer(expiring.key), 'topics:read'), error => denied(401, error));
  assert.equal((await service.list()).keys.find(key => key.id === expiring.apiKey.id).status, 'expired');
  await assert.rejects(service.revoke('not-a-uuid'), error => denied(400, error));
  await assert.rejects(service.revoke(randomUUID()), error => denied(404, error));
});

test('the per-key minute budget is shared across services, resets, and does not count denied scopes', async t => {
  const { service, pg, db } = await fixture(t);
  const created = await service.create(input({ scopes: ['topics:read'] }));
  const other = createAPIKeys({ db });
  await assert.rejects(service.consume(bearer(created.key), 'feed:read'), error => denied(403, error));
  assert.equal((await pg.query('SELECT rate_window_count FROM ufi_api_keys')).rows[0].rate_window_count, 0);
  await pg.query('UPDATE ufi_api_keys SET rate_window_start=NOW(),rate_window_count=$2 WHERE id=$1', [created.apiKey.id, API_KEY_RATE_LIMIT.requests - 2]);
  const results = await Promise.allSettled([service.consume(bearer(created.key), 'topics:read'), other.consume(bearer(created.key), 'topics:read'),
    service.consume(bearer(created.key), 'topics:read')]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 2);
  assert.equal(results.filter(item => item.status === 'rejected' && item.reason.status === 429).length, 1);
  await pg.query("UPDATE ufi_api_keys SET rate_window_start=NOW()-INTERVAL '61 seconds' WHERE id=$1", [created.apiKey.id]);
  await other.consume(bearer(created.key), 'topics:read');
  assert.equal((await pg.query('SELECT rate_window_count FROM ufi_api_keys')).rows[0].rate_window_count, 1);
});

test('generation budgets are atomic per key and permission per UTC day; status authentication does not consume them', async t => {
  const { service, pg, db } = await fixture(t);
  const created = await service.create(input({ type: 'media', scopes: ['images:generate', 'videos:generate'] }));
  const other = createAPIKeys({ db });
  const scope = 'videos:generate', limit = API_KEY_GENERATION_LIMITS[scope];
  const results = await Promise.allSettled(Array.from({ length: limit + 2 }, (_, index) => (index % 2 ? service : other).consumeGeneration(created.apiKey.id, scope)));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, limit);
  assert.equal(results.filter(item => item.status === 'rejected' && item.reason.status === 429).length, 2);
  assert.equal((await service.consumeGeneration(created.apiKey.id, 'images:generate')).used, 1);
  await service.consume(bearer(created.key), scope); // The video result/status path remains available at the daily cap.
  assert.equal((await pg.query('SELECT requests FROM ufi_api_key_generation_usage WHERE scope=$1', [scope])).rows[0].requests, limit);
  await pg.query("UPDATE ufi_api_key_generation_usage SET day=day-1 WHERE scope=$1", [scope]);
  const nextDay = await other.consumeGeneration(created.apiKey.id, scope);
  assert.equal(nextDay.used, 1); assert.equal(nextDay.remaining, limit - 1);
  assert.equal(new Date(nextDay.resetsAt).getUTCHours(), 0);
  await assert.rejects(service.consumeGeneration(created.apiKey.id, 'ai:chat'), error => denied(403, error));
  await assert.rejects(service.consumeGeneration(created.apiKey.id, 'topics:read'), error => denied(403, error));
  await service.revoke(created.apiKey.id);
  await assert.rejects(other.consumeGeneration(created.apiKey.id, 'images:generate'), error => denied(401, error));
});

test('keys fail closed when storage is unavailable and malformed credentials never reach storage', async () => {
  let calls = 0;
  const service = createAPIKeys({ db: { isConnected: () => false, query: async () => { calls++; throw new Error('private database host'); } } });
  await assert.rejects(service.list(), error => denied(503, error));
  await assert.rejects(service.create(input()), error => denied(503, error));
  await assert.rejects(service.consume('Bearer bad-key', 'topics:read'), error => denied(401, error));
  await assert.rejects(service.consume(`Bearer ufi_live_${'a'.repeat(43)}`, 'topics:read'), error => denied(503, error));
  assert.equal(calls, 0);
});

test('feed parameter validation bounds limits and rejects malformed cursors and query objects', () => {
  assert.deepEqual(feedParameters({}), { limit: 20, cursor: undefined });
  const cursor = Buffer.from(JSON.stringify({ reddit: { ts: new Date().toISOString(), id: 'reddit_post' } })).toString('base64url');
  assert.deepEqual(feedParameters({ limit: '50', cursor }), { limit: 50, cursor });
  const sourceCursor = size => Buffer.from(JSON.stringify(Object.fromEntries(Array.from({ length: size }, (_, index) =>
    [`source-${index}`, { ts: '2026-11-04T00:00:00.000Z', id: String(index).padStart(2, '0') + 'x'.repeat(48) }])))).toString('base64url');
  const accumulated = sourceCursor(36);
  assert.ok(accumulated.length > 4096 && accumulated.length <= 8192);
  assert.equal(feedParameters({ cursor: accumulated }).cursor, accumulated);
  const oversized = sourceCursor(80);
  assert.ok(oversized.length > 8192);
  assert.throws(() => feedParameters({ cursor: oversized }), error => denied(400, error));
  for (const query of [{ limit: '0' }, { limit: '51' }, { limit: ['20'] }, { limit: '1.1' }, { q: 'all' }, { cursor: [] },
    { cursor: 'not-a-cursor' }, { cursor: '' }, { cursor: 'x'.repeat(8193) }, { cursor: Buffer.from('[]').toString('base64url') },
    { cursor: Buffer.from(JSON.stringify({ reddit: { ts: 'invalid date', id: 'x' } })).toString('base64url') }]) {
    assert.throws(() => feedParameters(query), error => denied(400, error));
  }
});

async function httpFixture(t, db) {
  const app = express(); app.use(express.json());
  const calls = [];
  const requireOfficeToken = (req, res, next) => req.get('x-office-token') === 'office-test' ? next() : res.status(401).json({ error: 'Unauthorized' });
  const service = registerAPIKeyRoutes(app, { db, requireOfficeToken, topics: ['Developer Tools'], readFeed: async params => {
    calls.push(params); return { posts: [{ id: 'shared-post' }], cursor: null, hasMore: false };
  } });
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = async (path, options = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      body: options.body ? JSON.stringify(options.body) : undefined });
    return { status: response.status, headers: response.headers, data: await response.json().catch(() => null) };
  };
  return { request, calls, service };
}

test('HTTP management stays Office-only; bearer routes isolate permissions, suppress caching, and validate input', async t => {
  const { db } = await fixture(t);
  const { request, calls } = await httpFixture(t, db);
  const office = { 'x-office-token': 'office-test' };
  assert.equal((await request('/office/api-keys')).status, 401);
  assert.equal((await request('/office/api-keys', { method: 'POST', body: input() })).status, 401);
  const created = await request('/office/api-keys', { method: 'POST', headers: office, body: input() });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('cache-control'), 'private, no-store');
  const api = { Authorization: bearer(created.data.key) };
  assert.equal((await request('/office/api-keys', { headers: api })).status, 401);
  assert.equal((await request('/api/v1/topics?key=' + created.data.key)).status, 401);
  const topics = await request('/api/v1/topics', { headers: api });
  assert.equal(topics.status, 200); assert.deepEqual(topics.data.topics, ['Developer Tools']);
  assert.equal(topics.headers.get('cache-control'), 'private, no-store');
  assert.equal((await request('/api/v1/topics?unexpected=1', { headers: api })).status, 400);
  assert.equal((await request('/api/v1/feed?limit=51', { headers: api })).status, 400);
  assert.equal((await request('/api/v1/feed?limit=2&limit=3', { headers: api })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await request('/api/v1/feed?limit=2', { headers: api })).status, 200);
  assert.deepEqual(calls, [{ limit: 2, cursor: undefined }]);
  assert.equal((await request(`/office/api-keys/${created.data.apiKey.id}`, { method: 'DELETE', headers: api })).status, 401);
  assert.equal((await request(`/office/api-keys/${created.data.apiKey.id}`, { method: 'DELETE', headers: office })).status, 200);
  const revoked = await request('/api/v1/topics', { headers: api });
  assert.equal(revoked.status, 401); assert.match(revoked.headers.get('www-authenticate'), /^Bearer /);
});

test('HTTP rate errors return Retry-After and storage failures do not reveal internal details', async t => {
  const { db, pg } = await fixture(t);
  const { request } = await httpFixture(t, db);
  const created = await request('/office/api-keys', { method: 'POST', headers: { 'x-office-token': 'office-test' }, body: input() });
  await pg.query('UPDATE ufi_api_keys SET rate_window_start=NOW(),rate_window_count=120 WHERE id=$1', [created.data.apiKey.id]);
  const limited = await request('/api/v1/topics', { headers: { Authorization: bearer(created.data.key) } });
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
  db.query = async () => { throw new Error('private storage connection secret'); };
  const failed = await request('/office/api-keys', { headers: { 'x-office-token': 'office-test' } });
  assert.equal(failed.status, 503); assert.doesNotMatch(JSON.stringify(failed.data), /private storage|connection secret/);
});

test('the actual application mounts key routes behind Office access and accepts generated keys on the topics endpoint', async t => {
  const { pg } = await fixture(t);
  const app = await createAppHarness({ connected: true, env: { OFFICE_TOKEN: 'office-core-fixture' }, query: (sql, params) => pg.query(sql, params) });
  t.after(() => app.close()); app.markSecurityStorageReady();
  assert.equal((await app.request('/office/api-keys')).status, 401);
  const created = await app.request('/office/api-keys', { method: 'POST', headers: { 'x-office-token': 'office-core-fixture' }, body: input({ scopes: ['topics:read'] }) });
  assert.equal(created.status, 201);
  const topics = await app.request('/api/v1/topics', { headers: { Authorization: bearer(created.data.key) } });
  assert.equal(topics.status, 200); assert.ok(topics.data.topics.includes('Developer Tools'));
  assert.equal((await app.request('/office/status', { headers: { Authorization: bearer(created.data.key) } })).status, 401);
  assert.equal((await app.request('/api/v1/feed', { headers: { Authorization: bearer(created.data.key) } })).status, 403);
});
