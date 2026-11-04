'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { VAULT_STORAGE_SCHEMA, createVaultStorage, registerVaultStorageRoutes, validateRecord } = require('./vault-storage');
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const record = (fill = 1, size = 24) => ({ version: 1, kdf: { salt: Buffer.alloc(16, fill).toString('base64'), iterations: 600000 },
  wrappedKey: { iv: Buffer.alloc(12, fill).toString('base64'), data: Buffer.alloc(48, fill).toString('base64') },
  content: { iv: Buffer.alloc(12, fill).toString('base64'), data: Buffer.alloc(size, fill).toString('base64') } });

test('durable encrypted vaults isolate owners, reject stale writes, support retries and cascade deletion', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('CREATE TABLE users(id UUID PRIMARY KEY)');
    await pg.query('INSERT INTO users VALUES($1),($2)', [alice, bob]);
    for (const sql of VAULT_STORAGE_SCHEMA) await pg.exec(sql);
    const db = { isConnected: () => true, query: (...args) => pg.query(...args) };
    const storage = createVaultStorage(db);
    assert.equal((await storage.get(alice)).record, null);
    assert.equal((await storage.put(alice, { revision: 0, record: record() })).revision, 1);
    assert.equal((await storage.get(bob)).record, null);
    const writes = await Promise.allSettled([storage.put(alice, { revision: 1, record: record(2) }), storage.put(alice, { revision: 1, record: record(3) })]);
    assert.equal(writes.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(writes.find(value => value.status === 'rejected').reason.status, 409);
    const saved = await storage.get(alice);
    assert.equal(saved.revision, 2);
    assert.equal((await storage.put(alice, { revision: 1, record: saved.record })).revision, 2, 'Lost-response retry is idempotent');
    assert.deepEqual((await createVaultStorage(db).get(alice)).record, saved.record, 'A new service instance reads PostgreSQL');
    await storage.put(bob, { revision: 0, record: record(4) });
    await pg.query('DELETE FROM users WHERE id=$1', [alice]);
    assert.equal((await storage.get(alice)).record, null);
    assert.deepEqual((await storage.get(bob)).record, record(4));
  } finally { await pg.close(); }
});

test('envelope validation excludes plaintext, identity, device credentials and unsupported formats', async () => {
  for (const invalid of [{ ...record(), passphrase: 'never accept' }, { ...record(), entries: [] },
    { ...record(), device: {} }, { ...record(), accountId: alice }, { ...record(), version: 2 },
    { ...record(), kdf: { ...record().kdf, iterations: 1 } }, { ...record(), wrappedKey: { iv: 'x', data: 'x' } },
    record(1, 2 * 1024 * 1024 + 17)]) assert.throws(() => validateRecord(invalid), error => error.status === 400);
  assert.deepEqual(validateRecord(record(1, 700000)), record(1, 700000));
  const service = createVaultStorage({ isConnected: () => false });
  await assert.rejects(service.get(alice), error => error.status === 503);
  await assert.rejects(service.put(alice, { revision: 0, record: record() }), error => error.status === 503);
});

test('authenticated routes accept large encrypted records and fail closed without a database', async () => {
  const app = express();
  let queries = 0;
  const db = { isConnected: () => true, query: async (_sql, values) => {
    queries++;
    assert.equal(values[0], alice);
    return { rows: values.length > 1 ? [{ revision: 1, record: JSON.parse(values[1]) }] : [] };
  } };
  registerVaultStorageRoutes(app, { db, json: express.json, limiter: (_req, _res, next) => next(),
    authenticate: (req, res, next) => { if (req.headers.authorization !== 'Bearer synthetic') return res.sendStatus(401); req.user = { id: alice }; next(); } });
  app.use(express.json({ limit: '512kb' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/vault/storage`;
  try {
    const headers = { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' };
    assert.equal((await fetch(url)).status, 401);
    assert.equal(queries, 0);
    const response = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ revision: 0, record: record(1, 700000) }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal((await response.json()).accountId, alice);
    assert.equal((await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ revision: 0, record: record(), accountId: bob }) })).status, 400);
    assert.equal((await fetch(url, { method: 'PUT', headers, body: '{broken' })).status, 400);
    db.isConnected = () => false;
    assert.equal((await fetch(url, { headers })).status, 503);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
