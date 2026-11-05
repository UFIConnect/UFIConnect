'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createOfficeAIStudioKeys, MEDIA_KEY_SCOPES } = require('./office-ai-studio-keys');
const { createOfficeAIStudio } = require('./office-ai-studio');
const { createAppHarness } = require('./test-support/app-harness');
async function invoke(handler, extra = {}) {
  const res = { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body: {}, params: {}, query: {}, headers: {}, ...extra }, res); return res;
}
async function harness(t, options = {}) {
  const pg = new PGlite(); await pg.waitReady;
  const db = { isConnected: () => true, query: (sql, params) => pg.query(sql, params) };
  const env = { OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 21).toString('base64') };
  let generations = 0;
  const provider = { configured: () => ({ openai: true, storage: true, renderer: 'native' }),
    photo: async () => { generations++; return { status: 'completed', mediaUrl: 'https://res.cloudinary.com/fixture/image/upload/output.png' }; } };
  const keys = createOfficeAIStudioKeys({ db, env, provider, contentGenerator: async ({ topic }) => ({ drafts: ['Caption: ' + topic,'Another caption','Final caption'], provider: 'openai', tool: 'never returned' }), ...options });
  t.after(async () => { await keys.idle(); await pg.close(); });
  const create = async (extra = {}) => { const res = await invoke(keys.create, { body: { name: 'Render integration', ...extra } }); assert.equal(res.statusCode, 201, JSON.stringify(res.body)); return res.body; };
  const access = (secret, subject) => keys.authorize(secret, subject);
  const call = async (operation, pipMedia, body = {}, params = {}) => { const result = await invoke(keys.route(operation), { pipMedia, body, params }); await keys.idle(); return result; };
  return { pg, db, env, keys, create, access, call, generations: () => generations };
}

test('media secrets are shown once, hashed at rest and absent from metadata and revocation responses', async t => {
  const h = await harness(t), created = await h.create();
  assert.match(created.secret, /^pip_media_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(created.key.scopes, [...MEDIA_KEY_SCOPES]);
  assert.ok(created.key.prefix.length < created.secret.length);
  const row = (await h.pg.query('SELECT * FROM office_ai_studio_keys')).rows[0];
  assert.equal(row.key_hash, createHash('sha256').update(created.secret).digest('hex'));
  assert.ok(!JSON.stringify(row).includes(created.secret));
  const listed = await invoke(h.keys.list);
  assert.ok(!JSON.stringify(listed.body).includes(created.secret)); assert.ok(!JSON.stringify(listed.body).includes(row.key_hash));
  assert.equal(listed.body.integration.environmentVariable, 'PIP_STUDIO_API_KEY');
  const revoked = await invoke(h.keys.revoke, { params: { id: created.key.id } });
  assert.ok(revoked.body.key.revokedAt); assert.equal(revoked.body.secret, undefined);
  await assert.rejects(h.access(created.secret, 'user1'), error => error.status === 401);
});

test('keys cannot grant Office, code, deployment, memory, connections or agent tools', async t => {
  const h = await harness(t);
  for (const scopes of [['office:*'],['memory:read'],['deploy'],['photos:generate','repo:write'],[]]) {
    const result = await invoke(h.keys.create, { body: { name: 'Invalid scope', scopes } }); assert.equal(result.statusCode, 400);
  }
  assert.deepEqual(MEDIA_KEY_SCOPES, ['photos:generate','videos:generate','content:generate']);
  const key = await h.create({ scopes: ['photos:generate'] }), access = await h.access(key.secret, 'user');
  const denied = await h.call('create', access, { clientRequestId: randomUUID(), kind: 'video', prompt: 'An original story', durationSeconds: 4 });
  assert.equal(denied.statusCode, 403); assert.equal(h.generations(), 0);
  assert.equal((await invoke(h.keys.contentDraft, { pipMedia: access, body: { topic: 'A caption' } })).statusCode, 403);
});

test('integration projects isolate keys and authenticated end users including idempotency and exports', async t => {
  const h = await harness(t), key = await h.create(), otherKey = await h.create();
  const first = await h.access(key.secret, 'member-one'), second = await h.access(key.secret, 'member-two'), third = await h.access(otherKey.secret, 'member-one');
  const input = { clientRequestId: randomUUID(), kind: 'photo', prompt: 'A small blue robot.' };
  const a = await h.call('create', first, input), b = await h.call('create', second, input);
  assert.equal(a.statusCode, 201); assert.equal(b.statusCode, 201); assert.notEqual(a.body.project.id, b.body.project.id);
  for (const operation of ['detail','generate','cancel','resume','exportProject']) {
    assert.equal((await h.call(operation, second, {}, { id: a.body.project.id })).statusCode, 404, operation);
    assert.equal((await h.call(operation, third, {}, { id: a.body.project.id })).statusCode, 404, operation);
  }
  const listing = await h.call('list', first); assert.deepEqual(listing.body.projects.map(item => item.id), [a.body.project.id]);
  const office = createOfficeAIStudio({ db: h.db, env: h.env, provider: { configured: () => ({}) } });
  assert.equal((await invoke(office.detail, { params: { id: a.body.project.id } })).statusCode, 404);
  assert.equal(h.generations(), 0);
});

test('per-key and per-user daily submission quotas enforce media-only generation limits', async t => {
  const h = await harness(t), key = await h.create({ dailyGenerationLimit: 3, userDailyGenerationLimit: 2 });
  const a = await h.access(key.secret, 'a'), b = await h.access(key.secret, 'b');
  const generate = async access => {
    const created = await h.call('create', access, { clientRequestId: randomUUID(), kind: 'photo', prompt: 'A blue garden.' });
    assert.equal(created.statusCode, 201);
    return h.call('generate', access, {}, { id: created.body.project.id });
  };
  assert.equal((await generate(a)).statusCode, 202); assert.equal((await generate(a)).statusCode, 202);
  assert.equal((await generate(a)).statusCode, 429);
  assert.equal((await generate(b)).statusCode, 202); assert.equal((await generate(b)).statusCode, 429);
  assert.equal(h.generations(), 3);
});

test('existing content keys accept caption fields only and return no tool or execution capability', async t => {
  const h = await harness(t), key = await h.create({ scopes: ['content:generate'] }), access = await h.access(key.secret, 'caption-user');
  const result = await invoke(h.keys.contentDraft, { pipMedia: access, body: { topic: 'A community garden', platform: 'linkedin', tone: 'friendly' } });
  assert.equal(result.statusCode, 200); assert.equal(result.body.drafts.length, 3);
  assert.equal(result.body.tool, undefined); assert.equal(result.body.provider, 'openai');
  for (const extra of [{ tools: ['terminal'] }, { messages: [] }, { model: 'arbitrary' }, { instructions: 'Deploy a website' }]) {
    assert.equal((await invoke(h.keys.contentDraft, { pipMedia: access, body: { topic: 'A caption', ...extra } })).statusCode, 400);
  }
  assert.equal((await h.call('list', access)).statusCode, 403);
});

test('member bridges use the server key and verified member identity while integration servers require a subject', async t => {
  const h = await harness(t), key = await h.create(); h.env.PIP_STUDIO_API_KEY = key.secret;
  const run = async (handler, req) => { let accepted = false; const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } }; await handler(req, res, () => { accepted = true; }); return { accepted, res, req }; };
  const member = await run(h.keys.authenticateMember, { user: { id: 'verified-member' }, headers: { authorization: 'Bearer a-browser-JWT' }, body: { userId: 'attacker' } });
  assert.equal(member.accepted, true); assert.ok(member.req.pipMedia.scope.includes(key.key.id));
  assert.equal((await run(h.keys.authenticateMember, { headers: {} })).res.code, 401);
  const server = await run(h.keys.authenticateServer, { headers: { authorization: 'Bearer ' + key.secret, 'x-pip-user-id': 'verified-member' } });
  assert.equal(server.accepted, true); assert.notEqual(server.req.pipMedia.scope, member.req.pipMedia.scope);
  assert.equal((await run(h.keys.authenticateServer, { headers: { authorization: 'Bearer ' + key.secret } })).res.code, 400);
  assert.equal((await run(h.keys.authenticateServer, { headers: { authorization: 'Bearer office-token' } })).res.code, 401);
});

test('key management stays Office-only and public generation routes require their own credential', async t => {
  const app = await createAppHarness({ env: { OFFICE_TOKEN: 'office-fixture' } }); t.after(() => app.close());
  for (const [method, path] of [['GET','/office/ai/studio/keys'],['POST','/office/ai/studio/keys'],['DELETE','/office/ai/studio/keys/' + randomUUID()],
    ['GET','/api/pip/studio'],['POST','/api/pip/studio/content-draft'],['GET','/pip/studio']]) {
    const result = await app.request(path, { method, ...(method === 'POST' ? { body: {} } : {}) });
    assert.equal(result.status, 401, `${method} ${path}`);
  }
});
