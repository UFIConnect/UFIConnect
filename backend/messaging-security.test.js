'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const http = require('node:http');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { createMessageMedia, publicMessage, registerMessageAttachmentRoutes, queueMessageAccountMedia, MESSAGE_MEDIA_SCHEMA,
  MESSAGE_IMAGE_MAX_BYTES } = require('./messaging-security');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const env = { CLOUDINARY_CLOUD_NAME: 'fixture-cloud', CLOUDINARY_API_KEY: 'fixture-key', CLOUDINARY_API_SECRET: 'fixture-secret' };
const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ownedId = id => `uficonnect-messages/message-${createHash('sha256').update(id).digest('hex')}-${uuid}`;
const stored = id => ({ publicId: ownedId(id), type: 'image', version: 1, format: 'jpg', deliveryType: 'authenticated', bytes: 3 });
const proof = id => ({ publicId: ownedId(id), version: 1,
  signature: createHash('sha1').update(`public_id=${ownedId(id)}&version=1${env.CLOUDINARY_API_SECRET}`).digest('hex') });
const url = id => `https://res.cloudinary.com/fixture-cloud/image/authenticated/s--fixture--/v1/${ownedId(id)}.jpg`;
const upload = id => ({ type: 'image', url: url(id), upload: proof(id) });
const asset = id => ({ public_id: ownedId(id), version: 1, resource_type: 'image', type: 'authenticated', format: 'jpg', bytes: 3, secure_url: url(id) });

async function database(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,billing_closed BOOLEAN DEFAULT false);
    CREATE TABLE direct_messages(id TEXT PRIMARY KEY,sender_id TEXT,receiver_id TEXT,attachment JSONB)`);
  for (const sql of MESSAGE_MEDIA_SCHEMA) await pg.exec(sql);
  await pg.query("INSERT INTO users(id,name) VALUES($1,'Alice'),($2,'Bob'),($3,'Carol')", [A,B,C]);
  const db = { isConnected: () => true, query: (sql, params) => pg.query(sql, params),
    withClient: fn => fn({ query: (sql, params) => pg.query(sql, params) }) };
  return { pg, db };
}

test('message upload signatures pin authenticated delivery, overwrite denial and a private owner identity', () => {
  const media = createMessageMedia({ env, now: () => 1000000, uuid: () => uuid });
  const signed = media.signature(A);
  assert.equal(signed.deliveryType, 'authenticated');
  assert.equal(signed.overwrite, false);
  assert.equal(`${signed.folder}/${signed.publicId}`, ownedId(A));
  assert.equal(signed.publicId.includes(A), false);
  const params = `folder=uficonnect-messages&overwrite=false&public_id=${signed.publicId}&timestamp=1000&type=authenticated`;
  assert.equal(signed.signature, createHash('sha1').update(params + env.CLOUDINARY_API_SECRET).digest('hex'));
  assert.throws(() => media.signature(null), { status: 401 });
  assert.throws(() => createMessageMedia({ env: {} }).signature(A), { status: 503 });
});

test('attachments require an owned response proof and authoritative private media metadata', async () => {
  let value = asset(A); let calls = 0;
  const media = createMessageMedia({ env, api: { resource: async (_id, options) => {
    calls++; assert.equal(options.type, 'authenticated'); return value;
  } } });
  assert.deepEqual(await media.validate(A, upload(A)), stored(A));
  assert.equal('url' in await media.validate(A, upload(A)), false);
  for (const malformed of [null, [], { url: 'javascript:alert(1)', type: 'image' }, upload(B),
    { ...upload(A), upload: { ...proof(A), signature: '0'.repeat(40) } }]) {
    const before = calls;
    await assert.rejects(media.validate(A, malformed), { status: 400 });
    assert.equal(calls, before);
  }
  for (const change of [{ type: 'upload' }, { format: 'svg' }, { format: 'html' }, { bytes: MESSAGE_IMAGE_MAX_BYTES + 1 },
    { public_id: ownedId(B) }, { secure_url: 'https://attacker.invalid/tracker.jpg' }, { version: 2 }]) {
    value = { ...asset(A), ...change };
    await assert.rejects(media.validate(A, { ...upload(A), url: value.secure_url }), { status: 400 });
  }
  const failing = createMessageMedia({ env, api: { resource: async () => { throw new Error('provider secret details'); } } });
  await assert.rejects(failing.validate(A, upload(A)), error => error.status === 503 && !error.message.includes('secret'));
});

test('conversation responses expose an authorized attachment path and retain only safe historical message media', () => {
  const message = { id: 'message/a', senderId: A, attachment: stored(A), content: '<img src=x onerror=alert(1)>', read: false };
  const result = publicMessage(message, B, env.CLOUDINARY_CLOUD_NAME);
  assert.equal(result.content, message.content);
  assert.deepEqual(result.attachment, { type: 'image', bytes: 3, accessPath: `/messages/${B}/attachments/message%2Fa` });
  assert.equal(JSON.stringify(result).includes(ownedId(A)), false);
  for (const href of ['javascript:alert(1)', 'https://attacker.invalid/tracker.jpg', 'https://res.cloudinary.com/foreign/image/upload/uficonnect-messages/a.jpg',
    'https://res.cloudinary.com/fixture-cloud/image/upload/uficonnect-messages/a.svg']) {
    assert.deepEqual(publicMessage({ ...message, attachment: { type: 'image', url: href } }, B, env.CLOUDINARY_CLOUD_NAME).attachment, { unavailable: true });
  }
  const href = 'https://res.cloudinary.com/fixture-cloud/image/upload/v1/uficonnect-messages/a.jpg';
  assert.deepEqual(publicMessage({ ...message, attachment: { type: 'image', url: href } }, B, env.CLOUDINARY_CLOUD_NAME).attachment,
    { type: 'image', url: href, legacy: true });
});

async function attachmentApp(t, { db, media, blocked = async () => false }) {
  const app = express();
  registerMessageAttachmentRoutes(app, {
    authenticate: (req, res, next) => { req.user = { id: req.get('x-test-member') }; req.user.id ? next() : res.status(401).end(); },
    privateResponse: (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); },
    db, media, isBlocked: blocked, getTargetUser: async id => [A,B,C].includes(id) ? { id } : null,
  });
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return (id = A, other = B) => fetch(`http://127.0.0.1:${server.address().port}/messages/${other}/attachments/m1`,
    { headers: id ? { 'x-test-member': id } : {}, signal: AbortSignal.timeout(5000) });
}

test('attachment byte delivery binds sender/receiver and blocks outsiders, revoked relationships and database outages', async t => {
  const { pg, db } = await database(t);
  await pg.query('INSERT INTO direct_messages VALUES($1,$2,$3,$4)', ['m1', A, B, stored(A)]);
  const requests = [];
  const media = createMessageMedia({ env, fetchImpl: async (href, options) => {
    requests.push(href); assert.equal(options.redirect, 'manual'); assert.equal(options.signal.aborted, false);
    const privateUrl = new URL(href);
    assert.equal(privateUrl.hostname, 'api.cloudinary.com');
    assert.equal(privateUrl.searchParams.get('type'), 'authenticated');
    return new Response('abc', { headers: { 'content-type': 'image/jpeg', 'content-length': '3' } });
  } });
  let isBlocked = false;
  const request = await attachmentApp(t, { db, media, blocked: async () => isBlocked });
  assert.equal((await request(null)).status, 401);
  assert.equal((await request(C)).status, 404);
  assert.equal((await request(C, A)).status, 404);
  assert.equal(requests.length, 0);
  const response = await request();
  assert.equal(response.status, 200); assert.equal(await response.text(), 'abc');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('location'), null);
  assert.equal((await request(B, A)).status, 200);
  isBlocked = true; assert.equal((await request()).status, 404);
  assert.equal(requests.length, 2);
  isBlocked = false; db.isConnected = () => false;
  assert.equal((await request()).status, 503);
  assert.equal(requests.length, 2);
});

test('attachment proxy rejects hostile redirects, wrong MIME and oversized upstream bodies without disclosing provider errors', async t => {
  const { pg, db } = await database(t);
  await pg.query('INSERT INTO direct_messages VALUES($1,$2,$3,$4)', ['m1', A, B, stored(A)]);
  let response;
  const calls = [];
  const media = createMessageMedia({ env, fetchImpl: async href => { calls.push(href); return response; } });
  const request = await attachmentApp(t, { db, media });
  for (response of [new Response(null, { status: 302, headers: { location: 'https://attacker.invalid/private' } }),
    new Response('html', { headers: { 'content-type': 'text/html' } }),
    new Response('huge', { headers: { 'content-type': 'image/jpeg', 'content-length': '4' } })]) {
    const result = await request(); assert.equal(result.status, 503);
    assert.equal((await result.text()).includes(env.CLOUDINARY_API_SECRET), false);
  }
  assert.equal(calls.length, 3);
  response = new Response('toolong', { headers: { 'content-type': 'image/jpeg' } });
  await assert.rejects(async () => { const result = await request(); await result.arrayBuffer(); });
});

test('account deletion durably queues only owned private uploads, including abandoned upload intents', async t => {
  const { pg, db } = await database(t);
  await pg.query('INSERT INTO direct_messages VALUES($1,$2,$3,$4),($5,$6,$7,$8),($9,$10,$11,$12)',
    ['sent', A, B, stored(A), 'received', B, A, stored(B), 'forged', A, B, stored(B)]);
  const media = createMessageMedia({ env, uuid: () => uuid });
  await media.recordUploadIntent(db, A, media.signature(A));
  await pg.exec('BEGIN');
  await queueMessageAccountMedia({ query: (sql, params) => pg.query(sql, params) }, A);
  await pg.exec('ROLLBACK');
  assert.equal((await pg.query('SELECT * FROM message_media_cleanup')).rows.length, 0);
  assert.equal((await pg.query('SELECT * FROM message_media_uploads')).rows.length, 1);
  await pg.exec('BEGIN');
  await queueMessageAccountMedia({ query: (sql, params) => pg.query(sql, params) }, A);
  await pg.exec('COMMIT');
  assert.deepEqual((await pg.query('SELECT public_id,media_type FROM message_media_cleanup ORDER BY media_type')).rows,
    [{ public_id: ownedId(A), media_type: 'image' }, { public_id: ownedId(A), media_type: 'raw' }, { public_id: ownedId(A), media_type: 'video' }]);
  assert.equal((await pg.query('SELECT * FROM message_media_uploads')).rows.length, 0);
});

test('cleanup retries provider failure and removes abandoned files while retaining assets referenced by live messages', async t => {
  const { pg, db } = await database(t);
  await pg.query("INSERT INTO message_media_uploads(public_id,owner_id,created_at) VALUES($1,$2,NOW()-INTERVAL '25 hours'),($3,$4,NOW()-INTERVAL '25 hours')",
    [ownedId(A), A, ownedId(B), B]);
  await pg.query('INSERT INTO direct_messages VALUES($1,$2,$3,$4)', ['live', B, C, stored(B)]);
  let fail = true; const removed = [];
  const media = createMessageMedia({ env, uploader: { destroy: async (id, options) => {
    removed.push(id); assert.equal(options.type, 'authenticated');
    if (fail) throw new Error('provider error with secret credentials');
    return { result: 'ok' };
  } } });
  await media.cleanup(db);
  assert.equal((await pg.query('SELECT * FROM message_media_cleanup')).rows.length, 3);
  assert.deepEqual((await pg.query('SELECT public_id FROM message_media_uploads')).rows, [{ public_id: ownedId(B) }]);
  fail = false; await pg.exec('UPDATE message_media_cleanup SET available_at=NOW()');
  await media.cleanup(db);
  assert.equal((await pg.query('SELECT * FROM message_media_cleanup')).rows.length, 0);
  assert.ok(removed.every(id => id === ownedId(A)));
});

test('account cleanup revisits media while a previously issued direct upload signature can still recreate it', async t => {
  const { pg, db } = await database(t);
  let removed = 0;
  const media = createMessageMedia({ env, uuid: () => uuid, uploader: { destroy: async () => { removed++; return { result: 'not found' }; } } });
  await media.recordUploadIntent(db, A, media.signature(A));
  await pg.exec('BEGIN');
  await queueMessageAccountMedia({ query: (sql, params) => pg.query(sql, params) }, A);
  await pg.exec('COMMIT');
  await media.cleanup(db);
  assert.equal(removed, 3);
  assert.equal((await pg.query('SELECT * FROM message_media_cleanup')).rows.length, 3);
  await pg.exec('UPDATE message_media_cleanup SET available_at=NOW()');
  await media.cleanup(db);
  assert.equal(removed, 6);
  await pg.exec("UPDATE message_media_cleanup SET available_at=NOW(),retire_after=NOW()-INTERVAL '1 second'");
  await media.cleanup(db);
  assert.equal(removed, 9);
  assert.equal((await pg.query('SELECT * FROM message_media_cleanup')).rows.length, 0);
});
