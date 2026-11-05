'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { createOfficeAIStudio } = require('./office-ai-studio');
const { createTokenVault } = require('./token-vault');

async function invoke(handler, extra = {}) {
  const response = { statusCode: 200, headers: {}, set(name, value) { this.headers[name] = value; return this; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; },
    chunks: [], write(value) { this.chunks.push(String(value)); return true; },
    end(value = '') { this.chunks.push(String(value)); this.body = JSON.parse(this.chunks.join('')); this.writableEnded = true; return this; } };
  await handler({ params: {}, query: {}, body: {}, ...extra }, response);
  return response;
}

async function harness(t, options = {}) {
  const pg = new PGlite(); await pg.waitReady;
  const env = { OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString('base64'), ...options.env };
  const db = { isConnected: () => true, query: (sql, params) => pg.query(sql, params) };
  const provider = { configured: () => ({ openai: true, shotstack: true, storage: true }),
    photo: async () => ({ status: 'completed', mediaUrl: 'https://res.cloudinary.com/fixture/image/upload/photo.png' }),
    chapter: async () => ({ status: 'completed', mediaUrl: 'https://res.cloudinary.com/fixture/video/upload/chapter.mp4' }),
    assemble: async () => ({ status: 'completed', mediaUrl: 'https://res.cloudinary.com/fixture/video/upload/assembled.mp4' }),
    ...options.provider };
  const studio = createOfficeAIStudio({ db, env, provider });
  t.after(async () => { await studio.idle(); await pg.close(); });
  const create = async (body = {}) => {
    const response = await invoke(studio.create, { body: { clientRequestId: randomUUID(), kind: 'photo', title: 'Review production', prompt: 'A small blue robot explores a library.', ...body } });
    assert.equal(response.statusCode, 201, JSON.stringify(response.body));
    return response.body.project;
  };
  const call = (name, id, extra) => invoke(studio[name], { params: { id }, ...extra });
  return { pg, env, db, studio, create, call };
}

test('studio redacts creative strings without damaging JSON structure or neighboring fields', async t => {
  const h = await harness(t);
  const project = await h.create({ prompt: 'A detective finds secret=fictional-code',
    producer: { brief: 'An old sign reads token: sample', roles: ['Director'] },
    characters: [{ name: 'Mira', appearance: 'A blue cloak', personality: 'Curious', voice: 'Quiet' }] });
  assert.match(project.prompt, /credential omitted/);
  assert.match(project.producer.brief, /credential omitted/);
  assert.equal(project.characters[0].name, 'Mira');
  assert.equal(project.characters[0].appearance, 'A blue cloak');
  const stored = await h.pg.query('SELECT encrypted_payload FROM office_ai_studio_projects WHERE id=$1', [project.id]);
  assert.ok(!stored.rows[0].encrypted_payload.includes('fictional-code'));
  const restored = await h.call('detail', project.id);
  assert.equal(restored.statusCode, 200); assert.equal(restored.body.project.title, project.title);
});

test('cancel followed by resume cannot bypass an uncertain paid generation receipt', async t => {
  let dispatches = 0;
  const h = await harness(t, { provider: { photo: async () => { dispatches++; throw Error('Provider connection ended after submission.'); } } });
  const project = await h.create();
  assert.equal((await h.call('generate', project.id)).statusCode, 202);
  await h.studio.idle();
  assert.equal((await h.call('detail', project.id)).body.project.status, 'needs_review');
  assert.equal((await h.call('cancel', project.id)).statusCode, 200);
  assert.equal((await h.call('resume', project.id)).statusCode, 409);
  assert.equal((await h.call('generate', project.id)).statusCode, 409);
  assert.equal(dispatches, 1);
  const stored = await h.pg.query('SELECT status FROM office_ai_studio_chapters WHERE project_id=$1', [project.id]);
  assert.equal(stored.rows.length, 1); assert.equal(stored.rows[0].status, 'needs_review');
});

test('a completed provider result retains the operator cancellation and can be recovered without another dispatch', async t => {
  let finish, dispatches = 0;
  const result = new Promise(resolve => { finish = resolve; });
  const h = await harness(t, { provider: { photo: async () => { dispatches++; return result; } } });
  const project = await h.create();
  assert.equal((await h.call('generate', project.id)).statusCode, 202);
  assert.equal((await h.call('cancel', project.id)).body.project.status, 'cancelled');
  finish({ status: 'completed', mediaUrl: 'https://res.cloudinary.com/fixture/image/upload/recovered.png' });
  await h.studio.idle();
  const after = await h.call('detail', project.id);
  assert.equal(after.body.project.status, 'cancelled');
  assert.equal(after.body.project.artifacts.length, 1);
  const resumed = await h.call('resume', project.id);
  assert.equal(resumed.statusCode, 200); assert.equal(resumed.body.project.status, 'ready');
  assert.equal((await h.call('generate', project.id)).statusCode, 409);
  assert.equal(dispatches, 1);
});

test('a completed assembled MP4 remains visible after the active receipt is cleared', async t => {
  let assemblies = 0;
  const h = await harness(t, { provider: { assemble: async () => { assemblies++; return {
    status: 'completed', mediaUrl: 'https://res.cloudinary.com/fixture/video/upload/final.mp4' }; } } });
  const project = await h.create({ kind: 'movie', durationSeconds: 4 });
  assert.equal((await h.call('generate', project.id)).statusCode, 202); await h.studio.idle();
  assert.equal((await h.call('assemble', project.id)).statusCode, 202); await h.studio.idle();
  const row = (await h.pg.query('SELECT active_chapter_id FROM office_ai_studio_projects WHERE id=$1', [project.id])).rows[0];
  assert.equal(row.active_chapter_id, null);
  const after = (await h.call('detail', project.id)).body.project;
  assert.equal(after.assembly.complete, true);
  assert.equal(after.assembly.coveredChapters, 1);
  assert.ok(after.artifacts.some(item => item.filename.endsWith('-assembled.mp4') && item.url.endsWith('/final.mp4')));
  assert.equal((await h.call('assemble', project.id)).statusCode, 200); assert.equal(assemblies, 1);
});

test('a production longer than one chapter page remains navigable and exports every completed chapter', async t => {
  const h = await harness(t), project = await h.create({ kind: 'movie', durationSeconds: 408 });
  const vault = createTokenVault(h.env), values = [], groups = [];
  for (let index = 0; index < 102; index++) {
    const id = randomUUID(), chapter = { id, index, startSeconds: index * 4, durationSeconds: 4,
      status: 'completed', mediaUrl: `https://res.cloudinary.com/fixture/video/upload/chapter-${index}.mp4` };
    const start = values.length;
    values.push(id, project.id, index, 'completed', 4, vault.seal(JSON.stringify(chapter), `office:studio:chapter:${id}`));
    groups.push('(' + Array.from({ length: 6 }, (_, offset) => '$' + (start + offset + 1)).join(',') + ')');
  }
  await h.pg.query('INSERT INTO office_ai_studio_chapters (id,project_id,chapter_index,status,duration_seconds,encrypted_payload) VALUES ' + groups.join(','), values);
  const first = (await h.call('detail', project.id)).body.project;
  assert.equal(first.chapters.length, 100); assert.equal(first.nextChapterOffset, 100);
  const last = (await h.call('detail', project.id, { query: { after: '100' } })).body.project;
  assert.deepEqual(last.chapters.map(chapter => chapter.index), [100, 101]); assert.equal(last.nextChapterOffset, null);
  assert.equal(first.completedSeconds, 408); assert.equal(first.chapterCount, 102);
  const exported = await h.call('exportProject', project.id);
  assert.equal(exported.statusCode, 200);
  assert.equal(exported.body.project.chapters.length, 102);
  assert.equal(exported.body.project.nextChapterOffset, undefined);
  assert.ok(exported.body.project.chapters.every(chapter => chapter.mediaUrl && chapter.status === 'completed'));
  assert.equal(exported.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(exported.writableEnded, true);
});

test('two independent studio workers share a durable admission limit for paid submissions', async t => {
  let finish, dispatches = 0;
  const waiting = new Promise(resolve => { finish = resolve; });
  const provider = { configured: () => ({ openai: true, shotstack: true, storage: true }),
    photo: async () => { dispatches++; return waiting; } };
  const h = await harness(t, { provider });
  const other = createOfficeAIStudio({ db: h.db, env: h.env, provider });
  const projects = [await h.create(), await h.create(), await h.create()];
  try {
    assert.equal((await h.call('generate', projects[0].id)).statusCode, 202);
    assert.equal((await invoke(other.generate, { params: { id: projects[1].id } })).statusCode, 202);
    const blocked = await h.call('generate', projects[2].id);
    assert.equal(blocked.statusCode, 429); assert.equal(dispatches, 2);
    const remaining = await h.call('detail', projects[2].id);
    assert.equal(remaining.body.project.status, 'draft'); assert.equal(remaining.body.project.chapters.length, 0);
  } finally {
    finish({ status: 'completed', mediaUrl: 'https://res.cloudinary.com/fixture/image/upload/admitted.png' });
    await Promise.all([h.studio.idle(), other.idle()]);
  }
  const released = (await h.pg.query('SELECT COUNT(*)::int AS count FROM office_ai_studio_slots WHERE owner IS NOT NULL')).rows[0].count;
  assert.equal(released, 0);
});

test('a receipt persistence failure atomically rolls back the project claim and releases admission', async t => {
  let dispatches = 0;
  const h = await harness(t, { provider: { photo: async () => { dispatches++; return {
    status: 'completed', mediaUrl: 'https://res.cloudinary.com/fixture/image/upload/persisted.png' }; } } });
  const project = await h.create();
  await h.pg.query("ALTER TABLE office_ai_studio_chapters ADD CONSTRAINT reject_receipt_fixture CHECK(status<>'dispatching')");
  const rejected = await h.call('generate', project.id);
  assert.equal(rejected.statusCode, 503); assert.equal(dispatches, 0);
  const row = (await h.pg.query('SELECT status,active_chapter_id FROM office_ai_studio_projects WHERE id=$1', [project.id])).rows[0];
  assert.equal(row.status, 'draft'); assert.equal(row.active_chapter_id, null);
  assert.equal((await h.pg.query('SELECT COUNT(*)::int AS count FROM office_ai_studio_chapters')).rows[0].count, 0);
  assert.equal((await h.pg.query('SELECT COUNT(*)::int AS count FROM office_ai_studio_slots WHERE owner IS NOT NULL')).rows[0].count, 0);
  await h.pg.query('ALTER TABLE office_ai_studio_chapters DROP CONSTRAINT reject_receipt_fixture');
  assert.equal((await h.call('generate', project.id)).statusCode, 202);
  await h.studio.idle(); assert.equal(dispatches, 1);
});

test('member workspaces isolate client request IDs, libraries and every project operation', async t => {
  let dispatches = 0;
  const provider = { configured: () => ({ openai: true, shotstack: true, storage: true }),
    photo: async () => { dispatches++; return { status: 'completed', mediaUrl: 'https://res.cloudinary.com/fixture/image/upload/member.png' }; } };
  const h = await harness(t, { provider });
  const alpha = createOfficeAIStudio({ db: h.db, env: h.env, provider, scope: 'pip:key_alpha:user_alpha' });
  const beta = createOfficeAIStudio({ db: h.db, env: h.env, provider, scope: 'pip:key_alpha:user_beta' });
  const body = { clientRequestId: randomUUID(), kind: 'photo', title: 'Private member project', prompt: 'A blue robot visits a library.' };
  const a = await invoke(alpha.create, { body });
  const b = await invoke(beta.create, { body: { ...body, title: 'Another member project' } });
  assert.equal(a.statusCode, 201); assert.equal(b.statusCode, 201);
  assert.notEqual(a.body.project.id, b.body.project.id);
  const alphaList = await invoke(alpha.list), betaList = await invoke(beta.list), officeList = await invoke(h.studio.list);
  assert.deepEqual(alphaList.body.projects.map(item => item.id), [a.body.project.id]);
  assert.deepEqual(betaList.body.projects.map(item => item.id), [b.body.project.id]);
  assert.deepEqual(officeList.body.projects, []);
  for (const operation of ['detail', 'generate', 'assemble', 'cancel', 'resume', 'exportProject']) {
    const forbidden = await invoke(beta[operation], { params: { id: a.body.project.id } });
    assert.equal(forbidden.statusCode, 404, operation);
    assert.ok(!JSON.stringify(forbidden.body).includes('Private member project'));
  }
  assert.equal(dispatches, 0);
  const duplicate = await invoke(alpha.create, { body });
  assert.equal(duplicate.statusCode, 200); assert.equal(duplicate.body.project.id, a.body.project.id);
  const restored = createOfficeAIStudio({ db: h.db, env: h.env, provider, scope: 'pip:key_alpha:user_alpha' });
  assert.equal((await invoke(restored.detail, { params: { id: a.body.project.id } })).body.project.id, a.body.project.id);
});
