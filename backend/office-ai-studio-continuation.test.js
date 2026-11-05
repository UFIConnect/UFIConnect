'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createOfficeAIStudio } = require('./office-ai-studio');
const { createTokenVault } = require('./token-vault');

async function invoke(handler, id, body = {}) {
  const res = { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ params: { id }, query: {}, body }, res);
  return res;
}
async function harness(t, custom = {}) {
  const pg = new PGlite(); await pg.waitReady;
  const env = { OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 29).toString('base64') };
  const db = { isConnected: () => true, query: (sql, params) => pg.query(sql, params) };
  const calls = [], assemblies = [];
  let time = Date.now();
  const provider = {
    configured: () => ({ openai: true, storage: true, renderer: 'native' }),
    chapter: async (_project, chapter) => { calls.push(chapter); return { status: 'completed', mediaUrl: `https://res.cloudinary.com/fixture/video/upload/${chapter.id}.mp4`, summary: `Clip ${chapter.index + 1}` }; },
    assemble: async (_project, chapters) => { assemblies.push(chapters); return { status: 'completed', mediaUrl: `https://res.cloudinary.com/fixture/video/upload/assembled-${assemblies.length}.mp4` }; },
    ...custom,
  };
  const options = { db, env, provider, now: () => time };
  const studio = createOfficeAIStudio(options);
  t.after(async () => { await studio.idle(); await pg.close(); });
  const create = async (durationSeconds = 365) => {
    const res = await invoke(studio.create, undefined, { clientRequestId: randomUUID(), kind: 'movie', title: 'A continuous film', prompt: 'A robot builds a community garden.', durationSeconds });
    assert.equal(res.statusCode, 201, JSON.stringify(res.body)); return res.body.project;
  };
  const detail = async id => (await invoke(studio.detail, id)).body.project;
  const settle = async (id, service = studio) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise(resolve => setImmediate(resolve));
      await service.tick(); await service.idle();
      const project = (await invoke(service.detail, id)).body.project;
      if (!project.continuous && project.status !== 'generating') return project;
      time += 6000;
    }
    throw Error('Continuous film did not settle.');
  };
  return { pg, db, env, options, provider, studio, calls, assemblies, create, detail, settle, advance: () => { time += 6000; } };
}

test('full-film mode renders beyond two minutes and assembles automatically without a browser', async t => {
  const h = await harness(t), project = await h.create(365);
  const start = await invoke(h.studio.generate, project.id, { continuous: true });
  assert.equal(start.statusCode, 202, JSON.stringify(start.body));
  const done = await h.settle(project.id);
  assert.equal(done.status, 'ready'); assert.equal(done.continuous, false);
  assert.equal(done.completedSeconds, 365); assert.equal(done.remainingSeconds, 0);
  assert.deepEqual(h.calls.map(item => item.durationSeconds), [120, 120, 120, 5]);
  assert.equal(h.calls[1].previousSummary, 'Clip 1');
  assert.equal(h.assemblies.length, 1); assert.equal(done.assembly.complete, true);
  await h.studio.tick(); await invoke(h.studio.detail, project.id);
  assert.equal(h.calls.length, 4); assert.equal(h.assemblies.length, 1);
});

test('manual generation and status reads submit only one chapter; extending uses an idempotent absolute target', async t => {
  const h = await harness(t), project = await h.create(120);
  assert.equal((await invoke(h.studio.generate, project.id)).statusCode, 202); await h.studio.idle();
  await h.studio.tick(); await h.detail(project.id); assert.equal(h.calls.length, 1);
  assert.equal((await invoke(h.studio.extend, project.id, { durationSeconds: 121 })).statusCode, 400);
  assert.equal((await invoke(h.studio.extend, project.id, { durationSeconds: 360 })).statusCode, 200);
  assert.equal((await invoke(h.studio.extend, project.id, { durationSeconds: 360 })).statusCode, 200);
  assert.equal((await invoke(h.studio.extend, project.id, { durationSeconds: 240 })).statusCode, 400);
  const extended = await h.detail(project.id);
  assert.equal(extended.durationSeconds, 360); assert.equal(extended.completedSeconds, 120); assert.equal(extended.remainingSeconds, 240);
  assert.equal(extended.continuous, false); assert.equal(h.calls.length, 1);
  await invoke(h.studio.generate, project.id, { continuous: true });
  const done = await h.settle(project.id);
  assert.equal(done.completedSeconds, 360); assert.equal(h.calls.length, 3); assert.equal(done.assembly.complete, true);
});

test('a restarted worker restores the durable full-film authorization and polls existing remote receipts', async t => {
  let jobs = 0, polls = 0;
  const h = await harness(t, {
    configured: () => ({ openai: true, storage: true, renderer: 'shotstack', shotstack: true }),
    chapter: async () => ({ status: 'processing', jobId: `receipt-${++jobs}` }),
    poll: async chapter => { polls++; return { status: 'completed', mediaUrl: `https://res.cloudinary.com/fixture/video/upload/${chapter.id}.mp4` }; },
  });
  const project = await h.create(244);
  await invoke(h.studio.generate, project.id, { continuous: true }); await h.studio.idle();
  const restored = createOfficeAIStudio(h.options);
  t.after(() => restored.idle());
  const done = await h.settle(project.id, restored);
  assert.equal(done.completedSeconds, 244); assert.equal(done.assembly.complete, true);
  assert.equal(jobs, 3); assert.equal(polls, 3); assert.equal(h.assemblies.length, 1);
});

test('a restart between result persistence and project completion reconciles the receipt without repeating paid work', async t => {
  const h = await harness(t), project = await h.create(240);
  await invoke(h.studio.generate, project.id); await h.studio.idle();
  const first = (await h.detail(project.id)).chapters[0];
  // Reproduce a crash after the child result commit but before the project's
  // active receipt was cleared by the finishing worker.
  await h.pg.query("UPDATE office_ai_studio_projects SET status='generating',active_chapter_id=$2,continuous=TRUE WHERE id=$1", [project.id, first.id]);
  const restored = createOfficeAIStudio(h.options); t.after(() => restored.idle());
  const done = await h.settle(project.id, restored);
  assert.equal(done.status, 'ready'); assert.equal(done.completedSeconds, 240); assert.equal(done.assembly.complete, true);
  assert.equal(h.calls.length, 2); assert.deepEqual(h.calls.map(item => item.startSeconds), [0, 120]);
});

test('persisted failure receipts reconcile after a crash and clear continuous authorization', async t => {
  for (const status of ['failed', 'needs_review']) {
    const h = await harness(t, { chapter: async () => ({ status, error: 'Saved failure.' }) });
    const project = await h.create(240);
    await invoke(h.studio.generate, project.id); await h.studio.idle();
    const receipt = (await h.detail(project.id)).chapters[0];
    await h.pg.query("UPDATE office_ai_studio_projects SET status='generating',active_chapter_id=$2,continuous=TRUE WHERE id=$1", [project.id, receipt.id]);
    const restored = createOfficeAIStudio(h.options); t.after(() => restored.idle());
    await restored.tick();
    const after = (await invoke(restored.detail, project.id)).body.project;
    assert.equal(after.status, status); assert.equal(after.continuous, false); assert.equal(after.chapters.length, 1);
  }
});

test('stop clears automatic authorization and resume does not restart paid generation', async t => {
  let finish;
  const h = await harness(t, { chapter: async (_project, chapter) => new Promise(resolve => { finish = () => resolve({ status: 'completed', mediaUrl: `https://res.cloudinary.com/fixture/video/upload/${chapter.id}.mp4` }); }) });
  const project = await h.create(360);
  await invoke(h.studio.generate, project.id, { continuous: true });
  assert.equal((await invoke(h.studio.cancel, project.id)).body.project.continuous, false);
  finish(); await h.studio.idle();
  assert.equal((await h.detail(project.id)).status, 'cancelled');
  const resumed = await invoke(h.studio.resume, project.id);
  assert.equal(resumed.body.project.continuous, false); assert.equal(resumed.body.project.completedSeconds, 120);
  await h.studio.tick(); assert.equal((await h.detail(project.id)).chapterCount, 1);
});

test('an uncertain provider attempt stops the automatic run and is never automatically resubmitted', async t => {
  let submissions = 0;
  const h = await harness(t, { chapter: async () => { submissions++; throw Error('Connection ended after dispatch.'); } });
  const project = await h.create(360);
  await invoke(h.studio.generate, project.id, { continuous: true }); await h.studio.idle();
  const done = await h.detail(project.id);
  assert.equal(done.status, 'needs_review'); assert.equal(done.continuous, false);
  await h.studio.tick(); await invoke(h.studio.detail, project.id); assert.equal(submissions, 1);
});

test('terminal provider result objects stop the run instead of leaving it rendering forever', async t => {
  for (const status of ['failed', 'needs_review']) {
    const h = await harness(t, { chapter: async () => ({ status, error: 'The provider could not complete this clip.' }) });
    const project = await h.create(360);
    await invoke(h.studio.generate, project.id, { continuous: true }); await h.studio.idle();
    const after = await h.detail(project.id);
    assert.equal(after.status, status); assert.equal(after.continuous, false);
    await h.studio.tick(); assert.equal((await h.detail(project.id)).chapters.length, 1);
  }
});

test('regeneration preserves original media until success, keeps runtime stable and invalidates assembled films', async t => {
  const h = await harness(t), project = await h.create(4);
  await invoke(h.studio.generate, project.id); await h.studio.idle();
  await invoke(h.studio.assemble, project.id); await h.studio.idle();
  const before = await h.detail(project.id), original = before.chapters.find(item => item.index === 0);
  assert.equal(before.assembly.complete, true);
  let finish;
  h.provider.chapter = async (_project, chapter) => new Promise(resolve => { finish = () => resolve({ status: 'completed', mediaUrl: `https://res.cloudinary.com/fixture/video/upload/${chapter.id}.mp4` }); });
  const started = await invoke(h.studio.regenerate, project.id, { chapterId: original.id });
  assert.equal(started.statusCode, 202, JSON.stringify(started.body));
  assert.equal((await invoke(h.studio.regenerate, project.id, { chapterId: original.id })).statusCode, 409);
  const rendering = await h.detail(project.id);
  assert.equal(rendering.completedSeconds, 4); assert.equal(rendering.chapterCount, 1);
  assert.ok(rendering.artifacts.some(item => item.id === original.id));
  finish(); await h.studio.idle();
  const done = await h.detail(project.id);
  assert.equal(done.completedSeconds, 4); assert.equal(done.chapterCount, 1); assert.equal(done.assembly, undefined);
  assert.equal(done.chapters.filter(item => item.status === 'completed' && item.index === 0).length, 1);
  assert.ok(!done.artifacts.some(item => item.id === original.id));
  assert.equal((await h.pg.query('SELECT status FROM office_ai_studio_chapters WHERE id=$1', [original.id])).rows[0].status, 'superseded');
});

test('failed clip regeneration retains the original completed clip and runtime', async t => {
  const h = await harness(t), project = await h.create(4);
  await invoke(h.studio.generate, project.id); await h.studio.idle();
  const original = (await h.detail(project.id)).chapters[0];
  h.provider.chapter = async () => { throw Object.assign(Error('Provider rejected request.'), { knownRejected: true }); };
  await invoke(h.studio.regenerate, project.id, { chapterId: original.id }); await h.studio.idle();
  const done = await h.detail(project.id);
  assert.equal(done.status, 'failed'); assert.equal(done.completedSeconds, 4); assert.equal(done.chapterCount, 1);
  assert.ok(done.artifacts.some(item => item.id === original.id));
});

test('automatic assembly continues beyond thirty inputs and extension reuses the assembled prefix', async t => {
  const h = await harness(t), project = await h.create(3720), vault = createTokenVault(h.env);
  for (let index = 0; index < 31; index++) {
    const id = randomUUID(), part = { id, index, startSeconds: index * 120, durationSeconds: 120, status: 'completed', mediaUrl: `https://res.cloudinary.com/fixture/video/upload/${id}.mp4` };
    await h.pg.query('INSERT INTO office_ai_studio_chapters (id,project_id,chapter_index,status,duration_seconds,encrypted_payload) VALUES ($1,$2,$3,$4,$5,$6)', [id, project.id, index, 'completed', 120, vault.seal(JSON.stringify(part), `office:studio:chapter:${id}`)]);
  }
  await invoke(h.studio.generate, project.id, { continuous: true });
  const done = await h.settle(project.id);
  assert.equal(done.assembly.complete, true); assert.deepEqual(h.assemblies.map(parts => parts.length), [30, 2]);
  assert.equal(h.assemblies[1][0].durationSeconds, 3600);
  await invoke(h.studio.extend, project.id, { durationSeconds: 3724 });
  assert.equal((await h.detail(project.id)).assembly.complete, false);
  await invoke(h.studio.generate, project.id, { continuous: true });
  const extended = await h.settle(project.id);
  assert.equal(extended.assembly.complete, true); assert.equal(extended.completedSeconds, 3724);
  assert.equal(h.assemblies[2][0].durationSeconds, 3720); assert.equal(h.calls.length, 1);
});

test('chapter pagination counts timeline positions rather than failed attempts at the page boundary', async t => {
  const h = await harness(t), project = await h.create(408), vault = createTokenVault(h.env);
  for (let index = 0; index < 102; index++) {
    for (const status of index === 99 ? ['failed', 'completed'] : ['completed']) {
      const id = randomUUID(), part = { id, index, startSeconds: index * 4, durationSeconds: 4, status,
        ...(status === 'completed' ? { mediaUrl: `https://res.cloudinary.com/fixture/video/upload/${id}.mp4` } : {}) };
      await h.pg.query('INSERT INTO office_ai_studio_chapters (id,project_id,chapter_index,status,duration_seconds,encrypted_payload) VALUES ($1,$2,$3,$4,$5,$6)', [id, project.id, index, status, 4, vault.seal(JSON.stringify(part), `office:studio:chapter:${id}`)]);
    }
  }
  const first = await h.detail(project.id);
  assert.equal(first.chapters.length, 100); assert.equal(first.nextChapterOffset, 100);
  assert.equal(first.chapters[99].index, 99); assert.equal(first.chapters[99].status, 'completed');
  const res = { set() {}, json(value) { this.body = value; }, status() { return this; } };
  await h.studio.detail({ params: { id: project.id }, query: { after: '100' } }, res);
  assert.deepEqual(res.body.project.chapters.map(item => item.index), [100, 101]);
  assert.equal(res.body.project.nextChapterOffset, null); assert.equal(first.completedSeconds, 408);
});

test('new mutations respect workspace ownership and integration generation cannot bypass per-key quotas', async t => {
  const h = await harness(t), project = await h.create(4);
  const scoped = createOfficeAIStudio({ ...h.options, scope: 'pip:key_alpha:user_alpha' });
  for (const [operation, body] of [['extend', { durationSeconds: 240 }], ['regenerate', { chapterId: randomUUID() }]]) {
    assert.equal((await invoke(scoped[operation], project.id, body)).statusCode, 404);
  }
  assert.equal((await invoke(scoped.generate, project.id, { continuous: true })).statusCode, 403);
  assert.equal(scoped.capabilities().continuousGeneration, false);
  await scoped.tick(); assert.equal(h.calls.length, 0);
});
