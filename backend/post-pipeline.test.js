const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { initializePostPipeline, createPostPipelineTracker, createPostPipelineReader, pipelineFilters, safeUrl } = require('./post-pipeline');
const { createAppHarness } = require('./test-support/app-harness');
require('./generated-media');

test('post pipeline persists ordered decisions, lists every storage stage and paginates without duplicate copies', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await initializePostPipeline(pg);
  for (const table of ['feed_posts_staging', 'feed_posts_cache', 'feed_posts_archive']) await pg.exec(`CREATE TABLE ${table} (
    id TEXT PRIMARY KEY, source TEXT, title TEXT, content TEXT, source_url TEXT, media_type TEXT, topic TEXT,
    post_created_at TIMESTAMPTZ, fetched_at TIMESTAMPTZ DEFAULT NOW(), archived_at TIMESTAMPTZ DEFAULT NOW(), archive_reason TEXT)`);
  await pg.exec(`INSERT INTO feed_posts_staging (id, source, title, fetched_at) VALUES
    ('waiting', 'youtube', 'A waiting video', '2026-01-01'), ('both', 'reddit', 'Two copies', '2026-01-02');
    INSERT INTO feed_posts_cache (id, source, title) VALUES ('live', 'news', 'Published article'), ('both', 'reddit', 'Two copies');
    INSERT INTO feed_posts_archive (id, source, title, archive_reason) VALUES ('archived', 'news', 'Old article', 'source-deleted');`);
  let connected = true;
  const db = { query: (...args) => pg.query(...args), isConnected: () => connected };
  const tracker = createPostPipelineTracker(db, { schedule: () => ({ unref() {} }), role: 'pipeline' });
  tracker.record({ id: 'retry', source: 'youtube', title: 'Retry video', sourceUrl: 'https://user:secret@example.invalid/v?token=secret' }, 'queued', 'Passed screening');
  tracker.record({ id: 'retry', source: 'youtube', title: 'Retry video' }, 'retrying', 'Database unavailable');
  tracker.record({ id: 'reject', source: 'news', title: 'Rejected item' }, 'rejected', 'Policy screening');
  connected = false; await tracker.flush(); assert.equal(tracker.status().pendingEvents, 3);
  connected = true; await tracker.flush(); assert.equal(tracker.status().pendingEvents, 0);
  const reader = createPostPipelineReader(db);
  const ids = [];
  for (let offset = 0; ; offset += 2) {
    const page = await reader.list({ limit: 2, offset }); ids.push(...page.posts.map(post => post.id));
    assert.equal(Number(page.stats.live), 2); assert.equal(Number(page.stats.staging), 2);
    if (!page.hasMore) break;
  }
  assert.equal(ids.length, 6); assert.equal(new Set(ids).size, 6);
  assert.deepEqual((await reader.list({ stage: 'retrying' })).posts.map(row => row.id), ['retry']);
  assert.equal((await reader.list({ source: 'YOUTUBE', q: 'waiting' })).posts[0].id, 'waiting');
  assert.equal((await reader.list({ q: "' OR 1=1 --" })).posts.length, 0);
  const detail = await reader.detail('retry');
  assert.deepEqual(detail.events.map(event => event.stage), ['retrying', 'queued']);
  assert.equal(detail.events[1].source_url, 'https://example.invalid/v');
  assert.equal((await reader.detail('both')).queuePosition, 2);
  assert.equal((await reader.detail('both')).snapshots.length, 2);
  assert.equal((await reader.detail('archived')).snapshots[0].archive_reason, 'source-deleted');
  assert.equal((await reader.detail('live')).events.length, 0);
  assert.equal(await reader.detail('missing'), null);
  await pg.exec("UPDATE feed_post_events SET occurred_at=NOW()-INTERVAL '8 days'");
  const cleanupTracker = createPostPipelineTracker(db, { schedule: () => ({ unref() {} }) });
  cleanupTracker.record({ id: 'cleanup', source: 'news' }, 'rejected'); await cleanupTracker.flush();
  assert.equal((await pg.query('SELECT COUNT(*) AS count FROM feed_post_events')).rows[0].count, 1);
});

test('pipeline filters validate input and source URLs never carry credentials', () => {
  assert.throws(() => pipelineFilters({ stage: 'anything' }), /Invalid/);
  assert.throws(() => pipelineFilters({ since: 'tomorrow-ish' }), /Invalid/);
  assert.equal(pipelineFilters({ limit: 9999, offset: -4 }).limit, 100);
  assert.equal(pipelineFilters({ offset: -4 }).offset, 0);
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('https://youtube.com/watch?v=abc123&token=secret'), 'https://youtube.com/watch?v=abc123');
});

test('ingestion retains posts during a database outage and records retries before durable staging', async t => {
  const events = [];
  const app = await createAppHarness({ env: { SERVICE_ROLE: 'pipeline' }, modules: {
    './post-pipeline': { ...require('./post-pipeline'), createPostPipelineTracker: () => ({
      record: (post, stage) => events.push({ id: post.id, stage }), status: () => ({}),
    }) } }, query: async () => ({ rows: [], rowCount: 1 }) });
  t.after(() => app.close());
  const post = { id: 'outage-post', source: 'news', title: 'A useful source update', content: 'Detailed source context.', sourceUrl: 'https://example.com/story', createdAt: new Date().toISOString() };
  assert.equal(app.addAndBroadcast([post]), 1);
  assert.equal(app.ingestPersistenceQueues.get('feed_posts_staging').pending.size, 1);
  await app.flushFeedPersistenceQueue('feed_posts_staging');
  assert.equal(app.ingestPersistenceQueues.get('feed_posts_staging').pending.size, 1);
  assert.equal(events.at(-1).stage, 'retrying');
  app.db.isConnected = () => true;
  await app.flushFeedPersistenceQueue('feed_posts_staging');
  assert.equal(app.ingestPersistenceQueues.get('feed_posts_staging').pending.size, 0);
  assert.equal(events.at(-1).stage, 'staging');
  app.addAndBroadcast([post]); assert.equal(events.at(-1).stage, 'duplicate');
});

test('pipeline routes require Office auth and report database outages honestly', async t => {
  const app = await createAppHarness({ env: { OFFICE_TOKEN: 'pipeline-test-only' } }); t.after(() => app.close());
  const headers = { 'x-office-token': 'pipeline-test-only' };
  assert.equal((await app.request('/office/post-pipeline')).status, 401);
  assert.equal((await app.request('/office/post-pipeline/detail?id=x')).status, 401);
  assert.equal((await app.request('/office/post-pipeline', { headers })).status, 503);
  assert.equal((await app.request('/office/post-pipeline?stage=bad', { headers })).status, 400);
  assert.equal((await app.request('/office/post-pipeline/detail', { headers })).status, 400);
});

test('transfer events reflect committed publication and rollback without false live states', async t => {
  for (const failCommit of [false, true]) {
    const events = [], calls = [];
    const rows = [{ id: 'approved-transfer', source: 'news', title: 'A useful source update', content: 'Useful context.', source_url: 'https://example.com/story', post_created_at: new Date().toISOString() },
      { id: 'rejected-transfer', source: 'news', title: 'Unsafe source link', source_url: 'javascript:alert(1)', post_created_at: new Date().toISOString() }];
    const app = await createAppHarness({ connected: true, modules: {
      './post-pipeline': { ...require('./post-pipeline'), createPostPipelineTracker: () => ({ record: (post, stage, reason) => events.push({ id: post.id, stage, reason }), status: () => ({}) }) },
    }, query: async sql => {
      calls.push(sql);
      if (sql === 'COMMIT' && failCommit) throw new Error('Simulated transaction failure');
      if (sql.includes('WITH picked AS')) return { rows, rowCount: 2 };
      return { rows: [{ count: 0 }], rowCount: 1 };
    } });
    t.after(() => app.close());
    await app.transferStagedPosts({ maxBatches: 1, reason: 'audit' });
    if (failCommit) {
      assert.ok(calls.includes('ROLLBACK'));
      assert.equal(events.filter(event => event.stage === 'live').length, 0);
      assert.equal(events.filter(event => event.stage === 'retrying').length, 2);
    } else {
      assert.ok(calls.includes('COMMIT'));
      assert.deepEqual(events.map(event => event.stage), ['live', 'rejected']);
      assert.match(events[1].reason, /screening/);
    }
  }
});

test('Office refreshes authentication once and reconnects streams with the current token', async () => {
  const { createOfficeClient, connectOfficeStreams, mergeOfficeLog } = await import('../office/src/office-runtime.mjs');
  let token = '', prompts = 0, tokenListener, notifications = 0;
  const client = createOfficeClient({ storage: { getItem: () => token, setItem: (_, value) => { token = value; } },
    fetcher: async (_, options) => ({ status: options.headers['x-office-token'] === 'new-token' ? 200 : 401 }),
    prompt: () => { prompts++; return 'new-token'; }, onTokenChange: () => { notifications++; tokenListener?.(); } });
  assert.deepEqual((await Promise.all([client.request('/a'), client.request('/b')])).map(response => response.status), [200, 200]);
  assert.equal(prompts, 1); assert.equal(notifications, 1);
  const streams = [], timers = new Map(), connections = [], entries = [];
  class FakeStream { constructor(url) { this.url = url; streams.push(this); } close() { this.closed = true; } }
  const close = connectOfficeStreams({ bases: ['api', 'pipeline'], urlFor: base => base + '?token=' + token,
    EventSourceClass: FakeStream, onConnection: value => connections.push(value), onData: rows => entries.push(...rows),
    subscribeToken: listener => { tokenListener = listener; return () => { tokenListener = null; }; },
    schedule: fn => { const id = timers.size + 1; timers.set(id, fn); return id; }, cancel: id => timers.delete(id) });
  streams[0].onopen(); assert.equal(connections.at(-1), false);
  streams[1].onopen(); assert.equal(connections.at(-1), true);
  streams[0].onmessage({ data: '{bad' });
  const entry = { agentId: 'feed', ts: '2026-01-01T00:00:00Z', msg: 'Transferred' };
  streams[0].onmessage({ data: JSON.stringify({ backlog: [entry, entry] }) });
  assert.equal(entries.length, 1); assert.equal(mergeOfficeLog(entries, entries).length, 1);
  streams[0].onerror(); assert.equal(connections.at(-1), false);
  token = 'rotated'; tokenListener(); assert.equal(timers.size, 0);
  assert.ok(streams.at(-1).url.endsWith('token=rotated'));
  close(); streams.at(-1).onerror(); assert.equal(timers.size, 0); assert.equal(tokenListener, null);
});
