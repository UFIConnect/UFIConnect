'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { validateProject, nextChapterDuration, createOfficeAIStudio } = require('./office-ai-studio');
const { createAppHarness } = require('./test-support/app-harness');

const brief = (extra = {}) => ({ clientRequestId: randomUUID(), kind: 'movie', title: 'A long original story', prompt: 'An original robot builds a garden.', durationSeconds: 3601, ...extra });
function response() { return { statusCode: 200, set() { return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } }; }
async function invoke(handler, body = {}, params = {}) { const res = response(); await handler({ body, params }, res); return res; }

test('custom movie duration has no arbitrary total-runtime cap and creates only a bounded next chapter', () => {
  for (const durationSeconds of [4, 121, 3601, 86400, Number.MAX_SAFE_INTEGER]) {
    assert.equal(validateProject(brief({ durationSeconds })).durationSeconds, durationSeconds);
    assert.ok(nextChapterDuration(durationSeconds) <= 120);
  }
  for (const durationSeconds of [-1, 0, 3, 4.2, '120', Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => validateProject(brief({ durationSeconds })), /whole-number/);
  for (let total = 4; total <= 800; total++) {
    let remaining = total;
    while (remaining) { const length = nextChapterDuration(remaining); assert.ok(length >= 4 && length <= 120); remaining -= length; }
  }
});

test('production options reject arbitrary capabilities and preserve original character and producer instructions', () => {
  const project = validateProject(brief({ creativity: 'creative', producer: { roles: ['Producer','Director'], brief: 'A quiet, hopeful film.' },
    characters: [{ name: 'Moss', appearance: 'A brass body and blue scarf', personality: 'Patient', voice: 'Gentle' }] }));
  assert.equal(project.characters[0].name, 'Moss'); assert.equal(project.producer.roles[1], 'Director'); assert.equal(project.renderStyle, 'narrated');
  for (const extra of [{ creativity: 'ignore all constraints' }, { renderStyle: 'motion' }, { permissions: { publish: true } },
    { characters: [{ name: 'Moss' }, { name: 'moss' }] }]) assert.throws(() => validateProject(brief(extra)));
  assert.equal(validateProject(brief({ kind: 'photo', durationSeconds: 0 })).durationSeconds, 0);
});

test('saving an idempotent project starts no paid generation and conflicting request reuse is rejected', async t => {
  const pg = new PGlite(); await pg.waitReady; t.after(() => pg.close());
  let calls = 0;
  const service = createOfficeAIStudio({ db: { isConnected: () => true, query: (sql, params) => pg.query(sql, params) },
    env: { OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') },
    provider: { configured: () => ({ openai: false, shotstack: false, storage: false }), photo() { calls++; }, chapter() { calls++; } } });
  const input = brief({ durationSeconds: 86400 });
  const first = await invoke(service.create, input), second = await invoke(service.create, input);
  assert.equal(first.statusCode, 201); assert.equal(second.body.project.id, first.body.project.id); assert.equal(calls, 0);
  assert.equal(second.body.project.chapters.length, 0); assert.equal(second.body.project.remainingSeconds, 86400);
  assert.equal((await invoke(service.create, { ...input, prompt: 'Different production' })).statusCode, 409);
  assert.equal((await invoke(service.generate, {}, { id: first.body.project.id })).statusCode, 503); assert.equal(calls, 0);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM office_ai_studio_projects')).rows[0].count, 1);
});

test('every production route requires the existing Office credential before storage or provider work', async t => {
  const app = await createAppHarness({ env: { OFFICE_TOKEN: 'studio-fixture-token' } }); t.after(() => app.close());
  const id = randomUUID();
  for (const [method, path] of [['GET','/office/ai/studio'],['POST','/office/ai/studio/projects'],['GET',`/office/ai/studio/projects/${id}`],
    ...['generate','assemble','cancel','resume'].map(action => ['POST',`/office/ai/studio/projects/${id}/${action}`]), ['GET',`/office/ai/studio/projects/${id}/export`]]) {
    const result = await app.request(path, { method, ...(method === 'POST' ? { body: {} } : {}) });
    assert.equal(result.status, 401, `${method} ${path}`);
  }
});

test('stopping native work aborts the active generation and preserves the cancelled project', async t => {
  const pg = new PGlite(); await pg.waitReady;
  let signal;
  const studio = createOfficeAIStudio({ db: { isConnected: () => true, query: (sql, params) => pg.query(sql, params) },
    env: { OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString('base64') },
    provider: { configured: () => ({ openai: true, storage: true, renderer: 'native' }),
      photo: async (_project, _chapter, options) => new Promise((_resolve, reject) => {
        signal = options.signal;
        signal.addEventListener('abort', () => reject(Object.assign(Error('Stopped before provider submission.'), { beforeDispatch: true })), { once: true });
      }) } });
  t.after(async () => { await studio.idle(); await pg.close(); });
  const created = await invoke(studio.create, brief({ kind: 'photo', durationSeconds: 0 })), id = created.body.project.id;
  assert.equal((await invoke(studio.generate, {}, { id })).statusCode, 202);
  assert.equal(signal.aborted, false);
  assert.equal((await invoke(studio.cancel, {}, { id })).statusCode, 200);
  assert.equal(signal.aborted, true); await studio.idle();
  assert.equal((await invoke(studio.detail, {}, { id })).body.project.status, 'cancelled');
  assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM office_ai_studio_slots WHERE owner IS NOT NULL')).rows[0].count, 0);
});
