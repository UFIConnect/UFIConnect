'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createOfficeAIMemory } = require('./office-ai-memory');
const { createOfficeAIWorkspace } = require('./office-ai-workspace');
const env = { NODE_ENV: 'production', OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 46).toString('base64') };
async function fixture(t) {
  const pg = new PGlite(); await pg.waitReady; t.after(() => pg.close());
  const db = { isConnected: () => true, query: (...args) => pg.query(...args), withClient: callback => callback({ query: (...args) => pg.query(...args) }) };
  const memory = createOfficeAIMemory({ db, env });
  return { db, memory, workspace: createOfficeAIWorkspace({ db, env, memory }) };
}

test('hosted files live in encrypted memory with traceable versions, pinned updates and idempotent retries', async t => {
  const f = await fixture(t), projectId = randomUUID();
  const first = await f.workspace.write(projectId, { path: 'index.html', content: '<h1>Private generated draft</h1>' });
  assert.equal(first.storage, 'memory'); assert.equal(first.version, 1); assert.match(first.revision, /^[a-f0-9]{64}$/);
  const pointers = (await f.db.query('SELECT * FROM office_ai_workspace_files')).rows;
  assert.equal(pointers[0].memory_id, first.memoryId); assert.ok(!JSON.stringify(pointers).includes('Private generated draft'));
  const archive = (await f.db.query('SELECT * FROM office_ai_memory')).rows[0];
  assert.match(archive.encrypted_payload, /^enc:v1:/); assert.ok(!JSON.stringify(archive).includes('Private generated draft'));
  assert.equal((await f.workspace.read(projectId, 'index.html')).content, '<h1>Private generated draft</h1>');
  assert.equal((await f.workspace.write(projectId, { path: 'index.html', content: '<h1>Private generated draft</h1>' })).unchanged, true);
  assert.equal((await f.memory.search('Private generated draft')).entries[0].metadata.projectId, projectId);
  await assert.rejects(f.workspace.write(projectId, { path: 'index.html', content: '<h1>Changed</h1>' }), error => error.status === 409);
  const changed = await f.workspace.write(projectId, { path: 'index.html', content: '<h1>Changed</h1>', expectedRevision: first.revision });
  assert.equal(changed.version, 2); assert.notEqual(changed.memoryId, first.memoryId);
  await assert.rejects(f.workspace.write(projectId, { path: 'index.html', content: '<h1>Stale overwrite</h1>', expectedRevision: first.revision }), error => error.status === 409);
  assert.equal((await f.memory.get(first.memoryId)).content, '<h1>Private generated draft</h1>');
  await f.memory.remove(changed.memoryId);
  await assert.rejects(f.workspace.read(projectId, 'index.html'), error => error.status === 404);
  const recreated = createOfficeAIWorkspace({ db: f.db, env, memory: createOfficeAIMemory({ db: f.db, env }) });
  assert.equal((await recreated.list(projectId)).files[0].revision, changed.revision);
});

test('hosted workspace rejects unsafe paths, absent archives and oversized or stale writes before changing project memory', async t => {
  const f = await fixture(t), projectId = randomUUID();
  for (const path of ['../index.html', '/index.html', 'a/../index.html', 'a//index.html', '.env', '.git/config', 'secrets.json', 'a/credentials.json', 'C:/draft.html', 'a\\draft.html', '%2e%2e/index.html', 'cert.pem']) {
    await assert.rejects(f.workspace.write(projectId, { path, content: 'draft' }), error => error.status === 400, path);
  }
  await assert.rejects(f.workspace.write(projectId, { path: 'index.html', content: 'x'.repeat(60001) }), error => error.status === 400);
  await assert.rejects(f.workspace.write(projectId, { path: 'index.html', content: '🙂'.repeat(30000) }), error => error.status === 400);
  const empty = await f.workspace.write(projectId, { path: 'empty.txt', content: '' });
  assert.equal(empty.bytes, 0); assert.equal((await f.workspace.read(projectId, 'empty.txt')).content, '');
  const unavailable = createOfficeAIWorkspace({ db: f.db, env, memory: { record: async () => { throw new Error('unavailable'); }, get: f.memory.get, status: async () => ({ available: false }) } });
  await assert.rejects(unavailable.write(projectId, { path: 'index.html', content: 'draft' }), error => error.status === 503);
  assert.deepEqual((await f.workspace.list(projectId)).files.map(file => file.path), ['empty.txt']);
  for (let index = 0; index < 19; index++) await f.workspace.write(projectId, { path: `file-${index}.txt`, content: `Draft ${index}` });
  await assert.rejects(f.workspace.write(projectId, { path: 'overflow.txt', content: 'overflow' }), error => error.status === 409);
  assert.equal((await f.workspace.list(projectId)).files.length, 20);
});
