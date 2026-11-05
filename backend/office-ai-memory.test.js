'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createOfficeAIMemory } = require('./office-ai-memory');
const { createTokenVault } = require('./token-vault');

const KEY = Buffer.alloc(32, 74).toString('base64');
const instant = Date.parse('2026-11-04T20:00:00.000Z');
const environment = () => ({ NODE_ENV: 'production', OAUTH_TOKEN_ENCRYPTION_KEY: KEY, OFFICE_GITHUB_TOKEN: 'private-github-memory-test-credential' });
async function database(t) {
  const pg = new PGlite(); await pg.waitReady; t.after(() => pg.close());
  return { isConnected: () => true, query: (sql, params) => pg.query(sql, params) };
}
const event = overrides => ({ kind: 'conversation', mode: 'chat', role: 'user', content: 'Discuss the public website deployment.', ...overrides });

test('memory survives service recreation, encrypts payloads and its search words, and preserves traceable event references', async t => {
  const db = await database(t), env = environment(), service = createOfficeAIMemory({ db, env, now: () => instant });
  const recorded = await service.record(event({ title: 'Website planning', referenceId: 'chat:conversation-1:0',
    metadata: { source: 'office-ai', sources: [{ title: 'Official source', url: 'https://developers.cloudflare.com/' }] } }));
  assert.equal(recorded.createdAt, new Date(instant).toISOString());
  assert.equal(recorded.referenceId, 'chat:conversation-1:0');
  const { rows } = await db.query('SELECT * FROM office_ai_memory');
  const persisted = JSON.stringify(rows);
  assert.ok(!persisted.includes('Website planning'));
  assert.ok(!persisted.includes('public website'));
  assert.ok(rows[0].encrypted_payload.startsWith('enc:v1:'));
  assert.ok(rows[0].search_tokens.every(word => /^[A-Za-z0-9_-]{43}$/.test(word)));
  assert.match(createTokenVault(env).open(rows[0].encrypted_payload, `office:memory:office:${recorded.id}`), /public website deployment/);
  const recreated = createOfficeAIMemory({ db, env });
  assert.deepEqual((await recreated.search('website')).entries.map(item => item.id), [recorded.id]);
  assert.deepEqual(await recreated.status(), { available: true, persistent: true, shared: true, scope: 'office' });
});

test('replayed event references are idempotent while distinct conversation and execution references remain independent', async t => {
  const db = await database(t), service = createOfficeAIMemory({ db, env: environment() });
  const first = await service.record(event({ referenceId: 'request:1' }));
  const duplicate = await service.record(event({ content: 'A replay must not overwrite the original.', referenceId: 'request:1' }));
  assert.equal(first.id, duplicate.id);
  assert.equal(duplicate.content, first.content);
  const execution = await service.record(event({ kind: 'execution', mode: 'public-web', role: 'system', referenceId: 'request:1', status: 'succeeded', content: 'Published commit abc123 after verified build.' }));
  assert.notEqual(execution.id, first.id);
  assert.equal((await service.list()).entries.length, 2);
  assert.ok((await service.search('abc123')).entries.some(item => item.id === execution.id));
});

test('memory search ranks multiple query matches, honors scope, and supports recent retrieval and stable pagination', async t => {
  const db = await database(t); let time = instant;
  const service = createOfficeAIMemory({ db, env: environment(), now: () => time++ });
  const focused = await service.record(event({ content: 'Website deployment blue theme decisions.' }));
  await service.record(event({ content: 'Website editorial outline.' }));
  await service.record(event({ content: 'Deployment review checklist.' }));
  const hidden = await service.record(event({ content: 'Website deployment finance workspace.' }), { scope: 'finance' });
  const results = await service.search('What did we discuss about website deployment?');
  assert.equal(results.entries[0].id, focused.id);
  assert.ok(!results.entries.some(item => item.id === hidden.id));
  assert.equal((await service.search('', { limit: 2 })).entries.length, 2);
  assert.equal((await service.search('What did we discuss before?', { limit: 2 })).entries.length, 2);
  const firstPage = await service.list({ limit: 2 });
  assert.equal(firstPage.entries.length, 2);
  assert.equal(typeof firstPage.nextCursor, 'string');
  const secondPage = await service.list({ limit: 2, before: firstPage.nextCursor });
  assert.equal(secondPage.entries.length, 1);
  assert.equal(secondPage.nextCursor, null);
  assert.equal(new Set([...firstPage.entries, ...secondPage.entries].map(item => item.id)).size, 3);
});

test('known and newly connected credentials are redacted before storage, indexing and return, including nested metadata', async t => {
  const db = await database(t), env = environment(), service = createOfficeAIMemory({ db, env });
  env.OFFICE_NOTION_TOKEN = 'newly-connected-notion-secret';
  const result = await service.record(event({ title: env.OFFICE_GITHUB_TOKEN,
    content: `${env.OFFICE_GITHUB_TOKEN} ${env.OFFICE_NOTION_TOKEN} Bearer arbitrary-private-credential password=hunter2 https://alice:privatepw@example.org/`,
    metadata: { token: 'do-not-store', nested: { authorization: 'do-not-store', message: env.OFFICE_NOTION_TOKEN }, links: ['https://example.org/?token=do-not-store'] } }));
  const returned = JSON.stringify(result);
  for (const value of [env.OFFICE_GITHUB_TOKEN, env.OFFICE_NOTION_TOKEN, 'arbitrary-private-credential', 'hunter2', 'privatepw', 'do-not-store']) assert.ok(!returned.includes(value), value);
  const { rows } = await db.query('SELECT * FROM office_ai_memory');
  const plaintext = createTokenVault(env).open(rows[0].encrypted_payload, `office:memory:office:${result.id}`);
  assert.ok(!plaintext.includes(env.OFFICE_GITHUB_TOKEN));
  assert.ok(!plaintext.includes(env.OFFICE_NOTION_TOKEN));
  assert.match(result.content, /credential omitted/);
});

test('entry deletion is scope-bound and clearing shared memory requires explicit confirmation', async t => {
  const db = await database(t), service = createOfficeAIMemory({ db, env: environment() });
  const item = await service.record(event());
  await service.record(event({ content: 'Private scope note.' }), { scope: 'finance' });
  await assert.rejects(service.remove(item.id, { scope: 'finance' }), error => error.status === 404);
  await assert.rejects(service.clear({}), error => error.status === 400);
  assert.equal((await service.list()).entries.length, 1);
  assert.deepEqual(await service.remove(item.id), { deleted: true, id: item.id });
  await service.record(event());
  assert.equal((await service.clear({ confirmed: true })).count, 1);
  assert.equal((await service.list()).entries.length, 0);
  assert.equal((await service.list({ scope: 'finance' })).entries.length, 1);
});

test('forgetting and clearing erase payloads while retaining tombstones that prevent replay resurrection', async t => {
  const db = await database(t), service = createOfficeAIMemory({ db, env: environment() });
  const original = await service.record(event({ referenceId: 'chat:one:0', content: 'Discussion to forget permanently.' }));
  await service.remove(original.id);
  const replay = await service.record(event({ referenceId: 'chat:one:0', content: 'Discussion to forget permanently.' }));
  assert.equal(replay.deleted, true); assert.equal(replay.content, undefined);
  assert.equal((await service.search('discussion')).entries.length, 0);
  await service.record(event({ referenceId: 'chat:two:0' }));
  await service.record(event({ referenceId: 'chat:two:1' }));
  assert.equal((await service.removeReferences('chat:two:')).count, 2);
  assert.equal((await service.record(event({ referenceId: 'chat:two:1' }))).deleted, true);
  await service.record(event({ referenceId: 'chat:three:0' }));
  await service.clear({ confirmed: true });
  assert.equal((await service.record(event({ referenceId: 'chat:three:0' }))).deleted, true);
  const rows = (await db.query('SELECT encrypted_payload,search_tokens,deleted_at FROM office_ai_memory')).rows;
  assert.ok(rows.every(row => row.encrypted_payload === null && row.search_tokens.length === 0 && row.deleted_at));
});

test('tampered envelopes and cross-entry ciphertext copying fail closed without leaking stored contents', async t => {
  const db = await database(t), service = createOfficeAIMemory({ db, env: environment() });
  const first = await service.record(event({ content: 'First sensitive discussion.' }));
  const second = await service.record(event({ content: 'Second sensitive discussion.' }));
  await db.query('UPDATE office_ai_memory SET encrypted_payload=(SELECT encrypted_payload FROM office_ai_memory WHERE id=$1) WHERE id=$2', [first.id, second.id]);
  await assert.rejects(service.list(), error => error.status === 503 && !error.message.includes('sensitive'));
  await db.query("UPDATE office_ai_memory SET encrypted_payload=encrypted_payload || 'tampered'");
  await assert.rejects(service.search('sensitive'), error => error.status === 503 && !error.message.includes('sensitive'));
});

test('unavailable database or encryption key never produces fake persistence or plaintext fallback', async () => {
  let writes = 0;
  const db = { isConnected: () => true, query: async () => { writes++; throw new Error('connection-secret-do-not-leak'); } };
  const unkeyed = createOfficeAIMemory({ db, env: {} });
  assert.equal((await unkeyed.status()).available, false);
  await assert.rejects(unkeyed.record(event()), error => error.status === 503);
  assert.equal(writes, 0);
  const disconnected = createOfficeAIMemory({ db: { ...db, isConnected: () => false }, env: environment() });
  assert.equal((await disconnected.status()).persistent, false);
  await assert.rejects(disconnected.search('website'), error => error.status === 503);
  assert.equal(writes, 0);
  const failed = createOfficeAIMemory({ db, env: environment() });
  await assert.rejects(failed.record(event()), error => error.status === 503 && !error.message.includes('connection-secret'));
});

test('malformed inputs and oversized data are rejected before database access', async () => {
  let queries = 0;
  const service = createOfficeAIMemory({ db: { isConnected: () => true, query: async () => { queries++; return { rows: [] }; } }, env: environment() });
  for (const input of [null, event({ content: '' }), event({ content: 'x'.repeat(64001) }), event({ mode: 'invalid mode' }), event({ referenceId: "';DROP TABLE users;" }), event({ referenceId: environment().OFFICE_GITHUB_TOKEN })]) {
    await assert.rejects(service.record(input), error => error.status === 400);
  }
  await assert.rejects(service.search('x'.repeat(2001)), error => error.status === 400);
  await assert.rejects(service.search('website', { limit: 51 }), error => error.status === 400);
  await assert.rejects(service.list({ before: 'not-a-valid-cursor' }), error => error.status === 400);
  await assert.rejects(service.list({ scope: '../other' }), error => error.status === 400);
  assert.equal(queries, 0);
});

test('activity pagination excludes unrelated payloads, old events, deleted records and other scopes before decryption', async t => {
  const db = await database(t), service = createOfficeAIMemory({ db, env: environment(), now: () => instant });
  const hidden = await service.record(event({ content: 'Private chat, never needed for a runtime scan.' }));
  await db.query("UPDATE office_ai_memory SET encrypted_payload='unreadable-private-payload' WHERE id=$1", [hidden.id]);
  await service.record(event({ kind: 'note', mode: 'hosted-web' }));
  const old = await service.record(event({ kind: 'execution' }));
  await db.query('UPDATE office_ai_memory SET created_at=$2 WHERE id=$1', [old.id, new Date(instant - 3600001).toISOString()]);
  await service.record(event({ kind: 'execution' }), { scope: 'finance' });
  const execution = await service.record(event({ kind: 'execution', referenceId: 'task:scan', status: 'failed' }));
  const observation = await service.record(event({ kind: 'note', mode: 'activity', referenceId: 'anomaly:scan' }));
  const forgotten = await service.record(event({ kind: 'execution', referenceId: 'task:deleted' }));
  await service.remove(forgotten.id);
  const first = await service.listActivity({ limit: 1 });
  assert.equal(first.entries.length, 1); assert.ok(first.nextCursor);
  const second = await service.listActivity({ limit: 1, before: first.nextCursor });
  assert.equal(second.nextCursor, null);
  assert.deepEqual(new Set([...first.entries, ...second.entries].map(entry => entry.id)), new Set([execution.id, observation.id]));
  await assert.rejects(service.list(), error => error.status === 503, 'The unrelated tampered payload still fails ordinary memory validation');
});

test('memory revisions invalidate activity cache only after real successful mutations', async t => {
  const db = await database(t), service = createOfficeAIMemory({ db, env: environment() });
  assert.equal(service.version(), 0);
  const first = await service.record(event({ referenceId: 'task:revision' }));
  assert.equal(service.version(), 1);
  await service.record(event({ referenceId: 'task:revision' }));
  await service.listActivity();
  assert.equal(service.version(), 1, 'Idempotent receipts and reads do not invalidate a scan');
  await service.remove(first.id);
  assert.equal(service.version(), 2);
  await service.record(event({ referenceId: 'task:revision' }));
  assert.equal(service.version(), 2, 'A forgotten receipt remains a tombstone');
  await service.record(event({ referenceId: 'chat:revision' }));
  await service.removeReferences('chat:revision');
  assert.equal(service.version(), 4);
  await service.record(event());
  await service.clear({ confirmed: true });
  assert.equal(service.version(), 6);
});

test('persistent storage statistics count scoped records and artifact versions without exposing content and preserve canonical task statuses', async t => {
  const db = await database(t), service = createOfficeAIMemory({ db, env: environment() });
  await service.record(event());
  const pending = await service.record(event({ kind: 'execution', mode: 'office', status: 'needs_confirmation', content: 'A deployment awaits confirmation.' }));
  assert.equal(pending.status, 'needs_confirmation');
  const continuation = await service.record(event({ kind: 'execution', mode: 'task', status: 'needs_continuation', content: 'A task reached its current step budget.' }));
  assert.equal(continuation.status, 'needs_continuation');
  const discarded = await service.record(event({ kind: 'note', mode: 'knowledge', content: 'A note to forget.' }));
  await service.remove(discarded.id);
  await service.record(event({ kind: 'note', mode: 'knowledge', content: 'The user prefers concise release notes.' }));
  for (const version of [1, 2]) await service.record(event({ kind: 'note', mode: 'hosted-web', content: `Private file contents version ${version}`,
    referenceId: `artifact:project-1:path-hash:${version}:content-hash` }));
  await service.record(event({ content: 'Other scope discussion.' }), { scope: 'finance' });
  const result = await service.stats();
  assert.equal(result.persistent, true); assert.equal(result.storage, 'encrypted-database');
  assert.equal(result.records, 6); assert.equal(result.conversations, 1); assert.equal(result.executions, 2);
  assert.equal(result.notes, 3); assert.equal(result.artifacts, 1); assert.equal(result.versions, 2); assert.equal(result.deletedTombstones, 1);
  const actualBytes = (await db.query('SELECT sum(octet_length(encrypted_payload)) AS bytes FROM office_ai_memory WHERE scope=$1 AND deleted_at IS NULL', ['office'])).rows[0].bytes;
  assert.equal(result.storedBytes, Number(actualBytes)); assert.ok(result.storedBytes > 0);
  assert.ok(!JSON.stringify(result).includes('Private file contents'));
  assert.equal((await service.stats({ scope: 'finance' })).records, 1);
});
