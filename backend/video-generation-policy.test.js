const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { PGlite } = require('@electric-sql/pglite');
const { createAppHarness, member, generationUsageStub } = require('./test-support/app-harness');
const { HISTORY_SCHEMA } = require('./generated-content');
const { videoDurationSeconds } = require('./video-generation-policy');

test('video duration preserves requested seconds and rejects attempts to bypass the five-minute lock', () => {
  for (const value of [4, 8, 12, 30, 60, 299, 300, '300']) assert.equal(videoDurationSeconds(value), Number(value));
  assert.equal(videoDurationSeconds(undefined, 8), 8);
  for (const value of [301, 1800, 1801, '300.1', 12.5, '300junk', '', null, true, [], {}, -1, 3, Infinity, NaN]) {
    assert.throws(() => videoDurationSeconds(value), error => error.status === 400);
  }
});

test('media options require membership and reveal capabilities without credentials', async t => {
  const app = await createAppHarness({ env: { OPENAI_API_KEY: 'private-openai-token', VIDEO_GENERATION_API_URL: 'https://video.example/render?secret=hidden', VIDEO_GENERATION_API_KEY: 'private-video-token' } });
  t.after(() => app.close());
  app.seedUser(member('pro', { plan: 'pro' })); app.seedUser(member('free'));
  assert.equal((await app.request('/command-center/media-options')).status, 401);
  assert.equal((await app.request('/command-center/media-options', { userId: 'free' })).status, 403);
  const options = await app.request('/command-center/media-options', { userId: 'pro' });
  assert.equal(options.status, 200);
  assert.equal(options.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(options.data.video, { minSeconds: 4, maxSeconds: 300, plannedMaxSeconds: 1800, shortClipSeconds: [4, 8, 12], longFormConfigured: true });
  assert.doesNotMatch(JSON.stringify(options.data), /private|hidden|video.example/);
});

test('unsupported duration is rejected before history, storage, or provider work', async t => {
  const app = await createAppHarness({ env: { OPENAI_API_KEY: 'test-key', MEDIA_GENERATION_RATE_LIMIT: '100' } });
  t.after(() => app.close()); app.seedUser(member('pro', { plan: 'pro' }));
  for (const durationSeconds of [301, 1800, 8.2, '300junk', null]) {
    const result = await app.request('/command-center/media-generate', { userId: 'pro', method: 'POST', body: { type: 'video', prompt: 'A narrated garden tour', durationSeconds } });
    assert.equal(result.status, 400);
  }
  const missingProvider = await app.request('/command-center/media-generate', { userId: 'pro', method: 'POST', body: { type: 'video', prompt: 'A narrated garden tour', durationSeconds: 300 } });
  assert.equal(missingProvider.status, 422);
  assert.match(missingProvider.data.message, /connected long-form video service/);
  assert.equal(app.queries.filter(item => /INSERT INTO generated_content/.test(item.sql)).length, 0);
  assert.equal(app.errors.length, 0);
});

test('configured long-form provider receives 300 seconds unchanged and saves the result', async t => {
  const pg = new PGlite(); await pg.exec(HISTORY_SCHEMA);
  const calls = [];
  const app = await createAppHarness({ connected: true, generationUsage: generationUsageStub(), query: (sql, params) => pg.query(sql, params),
    env: { VIDEO_GENERATION_API_URL: 'https://video.example/render', VIDEO_GENERATION_API_KEY: 'test-token', OPENAI_API_KEY: 'test-openai-token' },
    modules: {
      https: { ...require('node:https'), request(target, config, onResponse) {
        const callback = typeof config === 'function' ? config : onResponse;
        const url = typeof target === 'string' ? new URL(target) : null;
        const options = url ? { ...config, hostname: url.hostname, path: url.pathname } : target;
        const request = new EventEmitter(); let body = '';
        request.write = chunk => { body += chunk; }; request.setTimeout = () => {};
        request.end = () => setImmediate(() => {
          calls.push({ options, body: JSON.parse(body) });
          const output = options.path?.includes('moderations') ? { results: [{ flagged: false, categories: {} }] } : { mediaUrl: 'https://video.example/result.mp4' };
          const response = Readable.from([JSON.stringify(output)]); response.statusCode = 200; response.headers = {};
          callback(response);
        });
        return request;
      } },
      './generated-media': { createGeneratedMediaStorage: () => ({
        assertConfigured() {},
        async save(userId, id, type, source) {
          assert.equal(userId, 'pro'); assert.equal(type, 'video'); assert.equal(source, 'https://video.example/result.mp4');
          return { mediaUrl: `https://res.cloudinary.com/test/video/upload/${id}.mp4`, mediaType: type };
        },
      }) },
    },
  });
  t.after(async () => { await app.close(); await pg.close(); }); app.seedUser(member('pro', { plan: 'pro' }));
  const result = await app.request('/command-center/media-generate', { userId: 'pro', method: 'POST', body: { type: 'video', prompt: 'A narrated garden tour', durationSeconds: 300 } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const renderCalls = calls.filter(call => call.options.hostname === 'video.example');
  assert.equal(renderCalls.length, 1);
  assert.deepEqual(renderCalls[0].body, { prompt: 'A narrated garden tour', durationSeconds: 300, duration: 300 });
  assert.equal(result.data.historyItem.input.durationSeconds, 300);
  assert.equal(result.data.historyItem.status, 'completed');
});

test('narrated render persists its job, isolates owners, and saves completion without regenerating', async t => {
  const pg = new PGlite(); await pg.exec(HISTORY_SCHEMA);
  const calls = [];
  const jobId = '2abd5c11-0f3d-4c6d-ba20-235fc9b8e8b7';
  let finished = false;
  const app = await createAppHarness({ connected: true, generationUsage: generationUsageStub(), query: (sql, params) => pg.query(sql, params),
    modules: {
      './narrated-video': { createNarratedVideoProvider: () => ({
        configured: () => true,
        async create(prompt, seconds) {
          calls.push('create'); assert.equal(seconds, 300); assert.equal(prompt, 'A narrated garden tour');
          return { id: jobId, stage: 'stage', durationSeconds: seconds };
        },
        async status(id, stage) {
          calls.push('status'); assert.equal(id, jobId); assert.equal(stage, 'stage');
          return finished ? { status: 'completed', mediaUrl: 'https://video.example/result.mp4', durationSeconds: 300 } : { status: 'processing' };
        },
      }) },
      './generated-media': { createGeneratedMediaStorage: () => ({
        assertConfigured() {},
        async save(userId, id, type, source) {
          calls.push('save'); assert.equal(userId, 'pro'); assert.equal(type, 'video'); assert.equal(source, 'https://video.example/result.mp4');
          return { mediaUrl: 'https://res.cloudinary.com/test/video/upload/' + id + '.mp4', mediaType: type };
        },
      }) },
    },
  });
  t.after(async () => { await app.close(); await pg.close(); });
  app.seedUser(member('pro', { plan: 'pro' })); app.seedUser(member('other', { plan: 'pro' }));
  const created = await app.request('/command-center/media-generate', { userId: 'pro', method: 'POST',
    body: { type: 'video', prompt: 'A narrated garden tour', durationSeconds: 300 } });
  assert.equal(created.status, 202, JSON.stringify(created.data));
  assert.equal(created.data.historyItem.status, 'processing');
  const endpoint = '/command-center/history/' + created.data.historyItem.id + '/refresh';
  assert.equal((await app.request(endpoint, { userId: 'other', method: 'POST' })).status, 404);
  assert.deepEqual(calls, ['create']);
  assert.equal((await app.request(endpoint, { userId: 'pro', method: 'POST' })).data.item.status, 'processing');
  finished = true;
  const saved = await app.request(endpoint, { userId: 'pro', method: 'POST' });
  assert.equal(saved.data.item.status, 'completed');
  assert.equal(saved.data.item.output.durationSeconds, 300);
  await app.request(endpoint, { userId: 'pro', method: 'POST' });
  assert.deepEqual(calls, ['create', 'status', 'status', 'save'], 'Refreshing a finished job never submits another paid render');
});
