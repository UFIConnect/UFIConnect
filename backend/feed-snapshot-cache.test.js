const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeedSnapshotCache, estimateFeedValueBytes } = require('./feed-snapshot-cache');
const { createAppHarness } = require('./test-support/app-harness');

test('feed snapshots keep recent reads within the memory budget and expire at their original TTL', () => {
  let now = 0;
  let capacity = 1;
  const cache = createFeedSnapshotCache({ maxEntries: 8, maxBytes: 4000, ttlMs: 100,
    now: () => now, capacityFraction: () => capacity });
  const snapshot = id => ({ computedAt: now, posts: [{ id, content: 'x'.repeat(700) }] });
  cache.set('first', snapshot('first'));
  cache.set('second', snapshot('second'));
  now = 20;
  assert.equal(cache.get('first').posts[0].id, 'first');
  cache.set('third', snapshot('third'));
  assert.deepEqual([...cache.keys()], ['first', 'third']);
  assert.ok(cache.bytes <= 4000);

  cache.set('oversized', { posts: [{ content: 'x'.repeat(3000) }] });
  assert.equal(cache.get('oversized'), undefined);
  assert.deepEqual([...cache.keys()], ['first', 'third']);
  now = 100;
  assert.equal(cache.get('first'), undefined);
  assert.equal(cache.size, 1);

  capacity = 0.5;
  cache.trim();
  cache.set('fourth', snapshot('fourth'));
  assert.deepEqual([...cache.keys()], ['fourth']);
  assert.ok(cache.bytes <= 2000);
  assert.equal(cache.pruneExpired(200), 1);
  assert.equal(cache.bytes, 0);
});

test('concurrent snapshot readers share a build, and clearing prevents a stale build from restoring entries', async () => {
  const cache = createFeedSnapshotCache({ maxEntries: 4, maxBytes: 4096, ttlMs: 1000 });
  let resolveOld;
  const old = cache.getOrBuild('topic', () => new Promise(resolve => { resolveOld = resolve; }));
  const joined = cache.getOrBuild('topic', () => assert.fail('duplicate build'));
  await Promise.resolve();
  cache.clear();
  const replacement = await cache.getOrBuild('topic', () => ({ posts: [{ id: 'new' }] }));
  resolveOld({ posts: [{ id: 'old' }] });
  assert.equal(await old, await joined);
  assert.equal(cache.get('topic'), replacement);
});

test('a wide source filter shares its result and reads sources in bounded batches', async t => {
  const sources = ['github', 'reddit', 'hackernews', 'devto', 'arxiv', 'medium'];
  const calls = [];
  let concurrent = 0;
  let peak = 0;
  const app = await createAppHarness({ connected: true, query: async (sql, params) => {
    if (!sql.includes('SELECT * FROM feed_posts_cache') || !sources.includes(params[0])) return { rows: [] };
    const source = params[0];
    calls.push(source);
    peak = Math.max(peak, ++concurrent);
    await new Promise(resolve => setImmediate(resolve));
    concurrent--;
    return { rows: [{ id: `post-${source}`, source, title: `${source} engineering news`,
      content: 'An article on software engineering', source_url: `https://www.example.org/articles/${source}`,
      post_created_at: '2026-11-15T12:00:00Z' }] };
  } });
  t.after(() => app.close());

  const [first, second] = await Promise.all([
    app.getFilteredFeedPool(sources, 'newest', 'all'),
    app.getFilteredFeedPool(sources, 'newest', 'all'),
  ]);
  assert.equal(first, second);
  assert.deepEqual(calls, sources);
  assert.deepEqual(Array.from(first, post => post.source), sources);
  assert.equal(peak, 4);
});

test('ranking preserves sort modes and ties and the hot feed keeps smaller posts when a body will not fit', async t => {
  const now = Date.parse('2026-11-15T12:00:00Z');
  const app = await createAppHarness({ clock: () => now });
  t.after(() => app.close());
  const fixtures = [
    { id: 'a', source: 'github', createdAt: now - 3600000, likesCount: 80 },
    { id: 'b', source: 'github', createdAt: now, likesCount: 10 },
    { id: 'c', source: 'hn', createdAt: now, likesCount: 2 },
    { id: 'd', source: 'hn', createdAt: now, likesCount: 2 },
    { id: 'e', source: 'uficonnect', createdAt: now, likesCount: 4 },
  ];
  const ids = (sort, options) => Array.from(app.sortFeedBatch(fixtures, 'test', { sort, ...options }), post => post.id);
  assert.deepEqual(ids('newest'), ['b', 'c', 'd', 'e', 'a']);
  assert.deepEqual(ids('popular'), ['a', 'c', 'd', 'e', 'b']);
  assert.deepEqual(ids('ranked'), ['a', 'e', 'c', 'd', 'b']);
  assert.deepEqual(ids('ranked', { levelSources: false }), ['a', 'e', 'b', 'c', 'd']);

  const [first, last] = fixtures;
  const oversized = { id: 'large', content: 'x'.repeat(10000) };
  const maxBytes = estimateFeedValueBytes(first) + estimateFeedValueBytes(last) + 16;
  const fitted = app.fitHotFeedPosts([first, oversized, last], maxBytes);
  assert.deepEqual(Array.from(fitted, post => post.id), ['a', 'b']);
});
