'use strict';

const assert = require('node:assert/strict');
const { before, after, beforeEach, test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { createAppHarness, member } = require('./test-support/app-harness');
const { HISTORY_SCHEMA } = require('./generated-content');
const { createGenerationUsage, schemaStatements } = require('./generation-usage');

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const FREE = 'f0000000-0000-4000-8000-000000000003';
let pg;
before(async () => {
  pg = new PGlite();
  await pg.exec('CREATE TABLE users(id UUID PRIMARY KEY)');
  for (const statement of schemaStatements) await pg.exec(statement);
  await pg.exec(HISTORY_SCHEMA);
});
after(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec('DELETE FROM generated_content; DELETE FROM users');
  await pg.query('INSERT INTO users(id) VALUES ($1),($2),($3)', [A, B, FREE]);
});

const store = () => createGenerationUsage({ query: (sql, params) => pg.query(sql, params), connected: () => true });
const media = (app, userId = A, type = 'image', extra = {}) => app.request('/command-center/media-generate', {
  userId, method: 'POST', body: { type, prompt: 'A coastal garden at sunrise', ...(type === 'video' ? { durationSeconds: 8 } : {}), ...extra },
});

async function setup(t, { env = {}, narrated } = {}) {
  const state = { calls: [], jobs: new Map(), stored: 0, failStorage: false, storageReady: true,
    failQuota: false, failComplete: false, failHistoryInsert: false };
  const accounts = new Map([[A, { plan: 'pro', resume_builder_addon: true }],
    [B, { plan: 'pro', resume_builder_addon: true }], [FREE, { plan: 'free', resume_builder_addon: false }]]);
  const app = await createAppHarness({ connected: true,
    env: { OPENAI_API_KEY: 'test-only-key', MEDIA_GENERATION_RATE_LIMIT: '100', ...env },
    query(sql, params) {
      // Authentication fixtures remain independent of the quota/history SQL,
      // which executes unchanged against a real PostgreSQL database.
      if (/^SELECT \* FROM users/.test(sql)) return { rows: [{ id: params[0], name: 'Test member',
        email: 'member@example.invalid', auth_version: 0, ...accounts.get(params[0]) }] };
      if (/^SELECT id FROM auth_sessions/.test(sql)) return { rows: [{ id: params[0] }] };
      if (state.failQuota && /generation_usage/.test(sql)) throw new Error('database secret');
      if (state.failComplete && /^UPDATE generation_usage_reservations SET state='completed'/.test(sql)) throw new Error('database secret');
      if (state.failHistoryInsert && /^INSERT INTO generated_content/.test(sql)) throw new Error('database secret');
      if (/generation_usage|generated_content/.test(sql)) return pg.query(sql, params);
      return { rows: [], rowCount: 0 };
    },
    modules: {
      './narrated-video': { createNarratedVideoProvider: () => narrated || { configured: () => false } },
      './generated-media': { createGeneratedMediaStorage: () => ({
        assertConfigured() { if (!state.storageReady) throw Object.assign(new Error('storage secret'), { status: 503 }); },
        async save(_userId, id, type) {
          state.stored++;
          if (state.failStorage) throw new Error('asset storage secret');
          return { mediaUrl: `https://res.cloudinary.com/test/${type}/upload/${id}`, mediaType: type };
        },
        async saveOpenAIVideo(_userId, id) {
          state.stored++;
          if (state.failStorage) throw new Error('asset storage secret');
          return { mediaUrl: `https://res.cloudinary.com/test/video/upload/${id}`, mediaType: 'video' };
        },
      }) },
    },
  });
  t.after(() => app.close());
  for (const [id, account] of accounts) app.seedUser(member(id, { plan: account.plan, resumeBuilderAddon: account.resume_builder_addon }));
  app.setContentScreening(async ({ content }) => ({ allowed: true, content }));
  app.setAIImage(async () => { state.calls.push('image'); return 'data:image/png;base64,aW1hZ2U='; });
  app.setAIText(async () => { state.calls.push('text'); return 'A clear professional suggestion.'; });
  app.setAIVideoCreate(async () => {
    state.calls.push('video-create');
    const id = 'video_job' + state.calls.filter(call => call === 'video-create').length;
    state.jobs.set(id, { id, status: 'queued' });
    return state.jobs.get(id);
  });
  app.setAIVideoStatus(async (_provider, id) => { state.calls.push('video-status'); return state.jobs.get(id); });
  app.setConfiguredVideoGenerator(async () => { state.calls.push('custom-video'); return 'https://video.example/result.mp4'; });
  return { app, state, accounts };
}

test('usage requires authentication and exposes only the current member calendar-month counts', async t => {
  const { app } = await setup(t);
  assert.equal((await app.request('/generation/usage')).status, 401);
  await store().reserve(A, 'image');
  const mine = await app.request('/generation/usage', { userId: A });
  assert.equal(mine.status, 200);
  assert.equal(mine.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(mine.data.limits.image, { limit: 50, used: 1, remaining: 49 });
  assert.equal(mine.data.limits.video.limit, 20);
  assert.equal(mine.data.limits.resume.limit, 30);
  assert.equal(new Date(mine.data.period.startsAt).getUTCDate(), 1);
  assert.equal(new Date(mine.data.period.resetsAt).getUTCDate(), 1);
  assert.equal((await app.request('/generation/usage', { userId: B })).data.limits.image.used, 0);
  assert.equal((await app.request('/generation/usage', { userId: FREE })).status, 200);
});

test('entitlement, input, moderation and provider/storage readiness failures consume no slot', async t => {
  const { app, state } = await setup(t);
  assert.equal((await media(app, FREE)).status, 403);
  assert.equal((await media(app, A, 'image', { prompt: '' })).status, 400);
  assert.equal((await media(app, A, 'video', { durationSeconds: 301 })).status, 400);
  assert.equal((await media(app, A, 'video', { durationSeconds: 300 })).status, 422);
  app.setContentScreening(async () => ({ allowed: false, reason: 'policy' }));
  assert.equal((await media(app)).status, 422);
  app.setContentScreening(async () => ({ allowed: false, reason: 'screening_unavailable' }));
  assert.equal((await media(app)).status, 503);
  state.storageReady = false;
  assert.equal((await media(app)).status, 503);
  const disconnectedProvider = await setup(t, { env: { OPENAI_API_KEY: '' } });
  assert.equal((await media(disconnectedProvider.app)).status, 503);
  assert.equal((await store().usage(A)).limits.image.used, 0);
  assert.equal((await store().usage(A)).limits.video.used, 0);
  assert.deepEqual(state.calls, []);
  assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM generation_usage_reservations')).rows[0].count, 0);
});

test('concurrent image requests share the last slot and return structured quota errors', async t => {
  const { app, state } = await setup(t);
  await Promise.all(Array.from({ length: 49 }, () => store().reserve(A, 'image')));
  const results = await Promise.all([media(app), media(app)]);
  const successful = results.find(result => result.status === 200);
  const rejected = results.find(result => result.status === 429);
  assert.ok(successful, JSON.stringify(results));
  assert.ok(rejected, JSON.stringify(results));
  assert.equal(successful.data.usage.limits.image.used, 50);
  assert.equal(rejected.data.code, 'MONTHLY_GENERATION_LIMIT');
  assert.equal(rejected.data.kind, 'image');
  assert.deepEqual(rejected.data.usage.limits.image, { limit: 50, used: 50, remaining: 0 });
  assert.equal(rejected.data.resetsAt, rejected.data.usage.period.resetsAt);
  assert.deepEqual(state.calls, ['image']);
  assert.equal((await media(app, B)).status, 200);
  assert.equal((await store().usage(B)).limits.image.used, 1);
});

test('explicit provider failure refunds, submission timeout stays counted, and errors hide provider details', async t => {
  const { app } = await setup(t);
  app.setAIImage(async () => { throw Object.assign(new Error('provider secret body and billing details'), {
    generationRejected: true, providerStatus: 429,
  }); });
  const rejected = await media(app);
  assert.equal(rejected.status, 502);
  assert.match(rejected.data.message, /temporarily at capacity/);
  assert.doesNotMatch(JSON.stringify(rejected.data), /secret|billing details/);
  assert.equal((await store().usage(A)).limits.image.used, 0);
  app.setAIImage(async () => { throw new Error('Image generation timed out.'); });
  const unknown = await media(app);
  assert.equal(unknown.status, 502);
  assert.match(unknown.data.message, /did not confirm/);
  assert.equal((await store().usage(A)).limits.image.used, 1);
  const { rows } = await pg.query('SELECT state FROM generation_usage_reservations ORDER BY created_at');
  assert.deepEqual(rows.map(row => row.state), ['released', 'pending']);
});

test('history failure before submission refunds; successful image and custom video remain counted after storage failure', async t => {
  const { app, state } = await setup(t, { env: { VIDEO_GENERATION_API_URL: 'https://video.example/render' } });
  state.failHistoryInsert = true;
  assert.equal((await media(app)).status, 503);
  assert.deepEqual(state.calls, []);
  assert.equal((await store().usage(A)).limits.image.used, 0);
  state.failHistoryInsert = false;
  state.failStorage = true;
  const image = await media(app);
  assert.equal(image.status, 502);
  assert.doesNotMatch(JSON.stringify(image.data), /storage secret/);
  assert.equal((await store().usage(A)).limits.image.used, 1);
  assert.equal((await media(app, A, 'video', { durationSeconds: 300 })).status, 502);
  assert.equal((await store().usage(A)).limits.video.used, 1);
  const { rows } = await pg.query("SELECT kind, state FROM generation_usage_reservations WHERE state <> 'released' ORDER BY kind");
  assert.deepEqual(rows, [{ kind: 'image', state: 'completed' }, { kind: 'video', state: 'completed' }]);
});

test('async video keeps one durable slot; repeated polling and confirmed failure never charge twice', async t => {
  const { app, state } = await setup(t);
  const created = await media(app, A, 'video');
  assert.equal(created.status, 202, JSON.stringify(created.data));
  assert.equal(created.data.usage.limits.video.used, 1);
  const item = created.data.historyItem;
  assert.equal(item.input.generationReservation.userId, A);
  const refresh = '/command-center/history/' + item.id + '/refresh';
  assert.equal((await app.request(refresh, { userId: B, method: 'POST' })).status, 404);
  assert.equal((await app.request(refresh, { userId: A, method: 'POST' })).data.item.status, 'processing');
  state.jobs.set(created.data.job.id, { id: created.data.job.id, status: 'completed', progress: 100 });
  assert.equal((await app.request(refresh, { userId: A, method: 'POST' })).data.item.status, 'completed');
  assert.equal((await app.request(refresh, { userId: A, method: 'POST' })).data.item.status, 'completed');
  assert.equal(state.calls.filter(call => call === 'video-create').length, 1);
  assert.equal(state.stored, 1);
  assert.equal((await store().usage(A)).limits.video.used, 1);

  const failed = await media(app, A, 'video');
  state.jobs.set(failed.data.job.id, { id: failed.data.job.id, status: 'failed', error: { message: 'private provider diagnostics' } });
  const endpoint = `/command-center/media-generate/${failed.data.job.id}?ticket=${encodeURIComponent(failed.data.job.ticket)}`;
  const result = await app.request(endpoint, { userId: A });
  assert.equal(result.data.job.status, 'failed');
  assert.doesNotMatch(JSON.stringify(result.data), /private provider diagnostics/);
  await app.request(endpoint, { userId: A });
  await app.request('/command-center/history/' + failed.data.historyItem.id + '/refresh', { userId: A, method: 'POST' });
  assert.equal((await store().usage(A)).limits.video.used, 1);
  const { rows } = await pg.query('SELECT state FROM generation_usage_reservations WHERE id=$1', [failed.data.historyItem.input.generationReservation.id]);
  assert.equal(rows[0].state, 'released');
});

test('confirmed async success is completed before storage and stays counted after expiry', async t => {
  const { app, state } = await setup(t);
  const created = await media(app, A, 'video');
  state.jobs.set(created.data.job.id, { id: created.data.job.id, status: 'completed', progress: 100 });
  state.failStorage = true;
  const refresh = '/command-center/history/' + created.data.historyItem.id + '/refresh';
  assert.equal((await app.request(refresh, { userId: A, method: 'POST' })).data.item.status, 'processing');
  const reservationId = created.data.historyItem.input.generationReservation.id;
  assert.equal((await pg.query('SELECT state FROM generation_usage_reservations WHERE id=$1', [reservationId])).rows[0].state, 'completed');
  await pg.query("UPDATE generated_content SET created_at=NOW()-INTERVAL '25 hours' WHERE id=$1", [created.data.historyItem.id]);
  assert.equal((await app.request(refresh, { userId: A, method: 'POST' })).data.item.status, 'failed');
  assert.equal((await store().usage(A)).limits.video.used, 1);
  assert.equal(await store().release(created.data.historyItem.input.generationReservation), false);
});

test('narrated asynchronous jobs release a confirmed failed render', async t => {
  const id = '2abd5c11-0f3d-4c6d-ba20-235fc9b8e8b7';
  const { app } = await setup(t, { narrated: { configured: () => true,
    async create() { return { id, stage: 'stage', durationSeconds: 300 }; },
    async status() { return { status: 'failed', error: 'provider secret' }; },
  } });
  const created = await media(app, A, 'video', { durationSeconds: 300 });
  assert.equal(created.status, 202);
  const result = await app.request('/command-center/history/' + created.data.historyItem.id + '/refresh', { userId: A, method: 'POST' });
  assert.equal(result.data.item.status, 'failed');
  assert.doesNotMatch(JSON.stringify(result.data), /provider secret/);
  assert.equal((await store().usage(A)).limits.video.used, 0);
});

test('resume assist and application writing share the cap, including template and useful provider fallback', async t => {
  const { app } = await setup(t);
  const assist = await app.request('/resume-builder/ai-assist', { userId: A, method: 'POST', body: { field: 'summary', context: 'Five years of support experience' } });
  assert.equal(assist.status, 200);
  assert.equal(assist.data.usage.limits.resume.used, 1);
  app.setAIText(async () => { throw new Error('private provider body'); });
  const fallback = await app.request('/resume-builder/application-draft', { userId: A, method: 'POST', body: { type: 'cover_letter', role: 'Engineer' } });
  assert.equal(fallback.status, 200);
  assert.equal(fallback.data.fallback, true);
  assert.equal(fallback.data.usage.limits.resume.used, 2);
  assert.doesNotMatch(fallback.data.draft, /private provider body/);
  const template = await setup(t, { env: { OPENAI_API_KEY: '' } });
  const templated = await template.app.request('/resume-builder/application-draft', { userId: A, method: 'POST', body: { type: 'outreach' } });
  assert.equal(templated.status, 200);
  assert.equal(templated.data.usage.limits.resume.used, 3);
  await Promise.all(Array.from({ length: 27 }, () => store().reserve(A, 'resume')));
  for (const [endpoint, body] of [['ai-assist', { field: 'bullets', context: 'Led support team' }], ['application-draft', { type: 'outreach' }]]) {
    const limited = await app.request('/resume-builder/' + endpoint, { userId: A, method: 'POST', body });
    assert.equal(limited.status, 429);
    assert.equal(limited.data.code, 'MONTHLY_GENERATION_LIMIT');
    assert.equal(limited.data.usage.limits.resume.used, 30);
  }
  assert.equal((await app.request('/resume-builder/draft', { userId: A, method: 'PUT', body: { template: 'modern', data: { contact: { name: 'Alice' } } } })).status, 200);
  const exported = await app.request('/resume-builder/application-export', { userId: A, method: 'POST', body: {
    type: 'outreach', data: { contact: { name: 'Alice' }, outreach: { body: 'A manually written message.' } },
  } });
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get('content-type'), 'application/pdf');
  assert.equal((await store().usage(A)).limits.resume.used, 30);
  assert.equal((await store().usage(B)).limits.resume.used, 0);
});

test('quota outages block new work while successful writing survives a completion outage', async t => {
  const { app, state } = await setup(t);
  state.failQuota = true;
  for (const result of [await app.request('/generation/usage', { userId: A }), await media(app),
    await app.request('/resume-builder/application-draft', { userId: A, method: 'POST', body: { type: 'outreach' } })]) {
    assert.equal(result.status, 503);
    assert.equal(result.data.code, 'GENERATION_USAGE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(result.data), /database secret/);
  }
  assert.deepEqual(state.calls, []);
  state.failQuota = false; state.failComplete = true;
  const assist = await app.request('/resume-builder/ai-assist', { userId: A, method: 'POST', body: { field: 'summary', context: 'Support leader' } });
  assert.equal(assist.status, 200);
  assert.equal(assist.data.suggestion, 'A clear professional suggestion.');
  const draft = await app.request('/resume-builder/application-draft', { userId: A, method: 'POST', body: { type: 'outreach' } });
  assert.equal(draft.status, 200);
  assert.equal(draft.data.draft, 'A clear professional suggestion.');
  assert.equal(draft.data.usage.limits.resume.used, 2);
  assert.equal((await store().usage(A)).limits.resume.used, 2);
  const { rows } = await pg.query("SELECT state FROM generation_usage_reservations WHERE kind='resume'");
  assert.deepEqual(rows.map(row => row.state), ['pending', 'pending']);
});
