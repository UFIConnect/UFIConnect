const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable, Writable } = require('node:stream');
const { PGlite } = require('@electric-sql/pglite');
const { createAppHarness, member } = require('./test-support/app-harness');
const { HISTORY_SCHEMA, createGeneratedContentStore, parseHistoryCursor } = require('./generated-content');
const { createGeneratedMediaStorage } = require('./generated-media');

test('generated content persists in PostgreSQL and is isolated per member', async t => {
  const pg = new PGlite();
  await pg.exec(HISTORY_SCHEMA);
  await pg.exec(HISTORY_SCHEMA);
  let failWrites = false;
  const query = (sql, params) => {
    if (failWrites && sql.startsWith('UPDATE generated_content')) throw new Error('Database unavailable');
    return pg.query(sql, params);
  };
  let app = await createAppHarness({ connected: true, query });
  const seed = () => { app.seedUser(member('alice', { plan: 'pro' })); app.seedUser(member('bob', { plan: 'pro' })); };
  seed();
  t.after(async () => { await app.close(); await pg.close(); });
  let draftId;

  await t.test('all draft variations and complete hashtag sets are saved before success', async () => {
    const drafts = await app.request('/command-center/content-draft', {
      userId: 'alice', method: 'POST', body: { platform: 'general', topic: 'Building a useful community', tone: 'friendly' },
    });
    assert.equal(drafts.status, 200, JSON.stringify(drafts.data));
    assert.equal(drafts.data.drafts.length, 3);
    draftId = drafts.data.historyItem.id;
    const hashtags = await app.request('/command-center/hashtag-draft', {
      userId: 'alice', method: 'POST', body: { topic: 'City gardens', audience: 'Designers', location: 'San Diego' },
    });
    assert.equal(hashtags.status, 200);
    assert.equal(hashtags.data.groups.length, 3);
    assert.ok(hashtags.data.groups.every(group => group.hashtags.length === 8));
    const saved = await app.request('/command-center/history', { userId: 'alice' });
    assert.equal(saved.data.items.length, 2);
    assert.deepEqual(saved.data.items.find(item => item.id === draftId).output.drafts, drafts.data.drafts);
    assert.match(saved.headers.get('cache-control'), /private, no-store/);
  });
  await t.test('other members and guests cannot read or refresh someone else\'s content', async () => {
    assert.equal((await app.request('/command-center/history')).status, 401);
    assert.deepEqual((await app.request('/command-center/history', { userId: 'bob' })).data.items, []);
    for (const [suffix, method] of [['', 'GET'], ['/refresh', 'POST']]) {
      assert.equal((await app.request(`/command-center/history/${draftId}${suffix}`, { userId: 'bob', method })).status, 404);
    }
  });
  await t.test('history survives a new server process and an expired membership', async () => {
    await app.close(); app = await createAppHarness({ connected: true, query }); seed();
    app.users.find(user => user.id === 'alice').plan = 'free';
    assert.equal((await app.request(`/command-center/history/${draftId}`, { userId: 'alice' })).data.item.id, draftId);
    assert.equal((await app.request('/command-center/content-draft', { userId: 'alice', method: 'POST', body: { topic: 'New content' } })).status, 403);
    app.users.find(user => user.id === 'alice').plan = 'pro';
  });
  await t.test('failed durable writes report failure but still return copyable generated text', async () => {
    failWrites = true;
    const result = await app.request('/command-center/content-draft', { userId: 'alice', method: 'POST', body: { topic: 'Useful ideas' } });
    assert.equal(result.status, 503);
    assert.equal(result.data.drafts.length, 3);
    assert.equal(result.data.historyItem, undefined);
    failWrites = false;
  });
  await t.test('newest-first pagination has no duplicates or hidden lifetime cap', async () => {
    const store = createGeneratedContentStore(app.db);
    for (let i = 0; i < 65; i++) await store.create('bob', { kind: 'image', prompt: `Image ${i}`, output: { mediaUrl: 'https://example.invalid/image.png' } });
    await pg.query("UPDATE generated_content SET created_at='2026-09-05T12:00:00.123Z' WHERE user_id='bob'");
    const ids = [];
    let cursor = '';
    do {
      const page = await store.list('bob', { section: 'media', cursor, limit: 20 });
      ids.push(...page.items.map(item => item.id)); cursor = page.nextCursor;
    } while (cursor);
    assert.equal(ids.length, 65); assert.equal(new Set(ids).size, 65);
    assert.equal((await store.list('bob', { section: 'media', q: 'Image 64' })).items.length, 1);
    assert.equal((await store.list('bob', { section: 'content' })).items.length, 0);
    assert.equal((await app.request('/command-center/history?cursor=not-json', { userId: 'bob' })).status, 400);
    assert.equal((await app.request('/command-center/history?kind=video', { userId: 'bob' })).status, 400);
    assert.throws(() => parseHistoryCursor(Buffer.from(JSON.stringify(['not-date', 'id'])).toString('base64url')));
  });
  await t.test('database leases prevent concurrent video storage and recover after expiration', async () => {
    const store = createGeneratedContentStore(app.db);
    const entry = await store.create('alice', { kind: 'video', prompt: 'A coastal scene', status: 'processing' });
    await store.update('alice', entry.id, { output: {}, status: 'processing', jobId: 'video_test' });
    assert.equal(await store.claim('bob', entry.id), null);
    assert.ok(await store.claim('alice', entry.id));
    assert.equal(await store.claim('alice', entry.id), null);
    await pg.query("UPDATE generated_content SET processing_until=NOW()-INTERVAL '1 minute' WHERE id=$1", [entry.id]);
    assert.ok(await store.claim('alice', entry.id));
  });
});

test('history database outages are retryable, not empty successful histories', async t => {
  const app = await createAppHarness(); t.after(() => app.close()); app.seedUser(member('alice', { plan: 'pro' }));
  assert.equal((await app.request('/command-center/history', { userId: 'alice' })).status, 503);
  assert.equal((await app.request('/command-center/content-draft', { userId: 'alice', method: 'POST', body: { topic: 'Useful ideas' } })).status, 503);
});

function providerStub() {
  const calls = [];
  return {
    calls,
    request(target, options, callback) {
      const cb = typeof options === 'function' ? options : callback;
      const url = typeof target === 'string' ? new URL(target).pathname : target.path;
      const method = typeof target === 'string' ? options.method : target.method;
      calls.push({ url, method });
      const request = new EventEmitter();
      request.write = () => {};
      request.setTimeout = () => {};
      request.end = () => setImmediate(() => {
        const data = url.includes('moderations') ? { results: [{ flagged: false, categories: {} }] }
          : url.includes('images/generations') ? { data: [{ b64_json: 'aW1hZ2U=' }] }
            : { id: 'video_saved123', status: method === 'POST' ? 'queued' : 'completed', progress: 100 };
        const response = Readable.from([JSON.stringify(data)]); response.statusCode = 200; response.headers = {};
        cb(response);
      });
      return request;
    },
  };
}

test('Studio saves images server-side and resumes member-owned video jobs', async t => {
  const pg = new PGlite(); await pg.exec(HISTORY_SCHEMA);
  const provider = providerStub(); let stored = 0;
  const app = await createAppHarness({ connected: true, query: (sql, params) => pg.query(sql, params),
    env: { OPENAI_API_KEY: 'test-only' }, modules: {
      https: { ...require('node:https'), ...provider, get() { throw new Error('Network disabled'); } },
      './generated-media': { createGeneratedMediaStorage: () => ({
        assertConfigured() {},
        async save(_userId, id, type) { stored++; return { mediaUrl: `https://res.cloudinary.com/test/image/upload/${id}.png`, mediaType: type }; },
        async saveOpenAIVideo(_userId, id) { stored++; return { mediaUrl: `https://res.cloudinary.com/test/video/upload/${id}.mp4`, mediaType: 'video' }; },
      }) },
    },
  });
  t.after(async () => { await app.close(); await pg.close(); });
  app.seedUser(member('alice', { plan: 'pro' })); app.seedUser(member('bob', { plan: 'pro' }));
  const image = await app.request('/command-center/media-generate', { userId: 'alice', method: 'POST', body: { type: 'image', prompt: 'A coastal city skyline' } });
  assert.equal(image.status, 200, JSON.stringify(image.data));
  assert.equal(image.data.historyItem.status, 'completed');
  assert.ok(image.data.mediaUrl.startsWith('https://res.cloudinary.com/'));
  const video = await app.request('/command-center/media-generate', { userId: 'alice', method: 'POST', body: { type: 'video', prompt: 'A coastal city skyline', durationSeconds: 8 } });
  assert.equal(video.status, 202, JSON.stringify(video.data));
  const id = video.data.historyItem.id;
  assert.equal(video.data.historyItem.resumable, true);
  assert.equal((await app.request(`/command-center/history/${id}/refresh`, { userId: 'bob', method: 'POST' })).status, 404);
  // No signed browser ticket is required after reopening a saved job.
  app.users.find(user => user.id === 'alice').plan = 'free';
  const resumed = await app.request(`/command-center/history/${id}/refresh`, { userId: 'alice', method: 'POST' });
  assert.equal(resumed.status, 200, JSON.stringify(resumed.data));
  assert.equal(resumed.data.item.status, 'completed');
  assert.equal(stored, 2);
  await app.request(`/command-center/history/${id}/refresh`, { userId: 'alice', method: 'POST' });
  assert.equal(stored, 2, 'Completed media should never regenerate or reupload');
  assert.equal(provider.calls.filter(call => call.url === '/v1/videos' && call.method === 'POST').length, 1);
});

test('video storage streams bytes, avoids duplicate assets, and never forwards provider credentials on redirects', async () => {
  const calls = []; let received = '';
  const env = { CLOUDINARY_CLOUD_NAME: 'test', CLOUDINARY_API_KEY: 'test-key', CLOUDINARY_API_SECRET: 'test-secret' };
  const storage = createGeneratedMediaStorage({ env, fetchImpl: async (url, config) => {
    calls.push({ url, config });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://cdn.example/video.mp4' } }) : new Response('video bytes');
  }, uploader: { upload_stream(options, done) {
    assert.equal(options.overwrite, false);
    assert.match(options.public_id, /^uficonnect-studio\/[a-f0-9]{24}\/entry$/);
    return new Writable({ write(chunk, _encoding, callback) { received += chunk; callback(); }, final(callback) {
      done(null, { secure_url: 'https://res.cloudinary.com/test/video/upload/entry.mp4', public_id: options.public_id }); callback();
    } });
  } } });
  const result = await storage.saveOpenAIVideo('alice', 'entry', 'video_test', 'provider-secret');
  assert.equal(result.mediaType, 'video'); assert.equal(received, 'video bytes');
  assert.equal(calls[0].config.headers.Authorization, 'Bearer provider-secret');
  assert.deepEqual(calls[1].config.headers, {});
  assert.throws(() => createGeneratedMediaStorage({ env: {} }).assertConfigured(), /not configured/);
});
