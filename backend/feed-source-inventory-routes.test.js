'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createAppHarness, member } = require('./test-support/app-harness');

test('API source browser, statistics and Office agree on stored posts with an empty process cache', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.query(`CREATE TABLE feed_posts_cache (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT, content TEXT, author_name TEXT,
    source_url TEXT, post_created_at TIMESTAMPTZ, fetched_at TIMESTAMPTZ DEFAULT NOW()
    , likes_count INTEGER DEFAULT 0, comments_count INTEGER DEFAULT 0
  )`);
  await pg.query(`INSERT INTO feed_posts_cache (id, source, title, content, author_name, source_url, post_created_at)
    SELECT 'hn_' || n, 'hackernews', 'Engineering article ' || n,
      'A detailed engineering report on database query performance and production operations.',
      'Engineering team', 'https://news.ycombinator.com/item?id=' || n, NOW() - n * INTERVAL '1 minute'
    FROM generate_series(1, 25) AS n`);
  await pg.query(`INSERT INTO feed_posts_cache(id,source,title,content,author_name,source_url,post_created_at)
    VALUES ('arxiv_one','arxiv','Research into database algorithms',
      'Researchers describe a new approach to processing distributed database queries.',
      'Research team','https://arxiv.org/abs/2611.00001',NOW())`);
  let time = Date.now(), failing = false;
  const app = await createAppHarness({ connected: true, clock: () => time,
    env: { SERVICE_ROLE: 'api', OFFICE_TOKEN: 'inventory-test-office' },
    query: (sql, params) => {
      if (sql.includes('FROM feed_posts_cache')) {
        if (failing) throw new Error('secret-database-host');
        return pg.query(sql, params);
      }
      return { rows: [], rowCount: 0 };
    },
  });
  t.after(() => app.close()); app.seedUser(member('inventory-member'));
  assert.equal(app.globalFeedCache.posts.length, 0);
  assert.equal((await app.request('/feed/sources')).status, 401);
  const browser = await app.request('/feed/sources?sample=1', { userId: 'inventory-member' });
  assert.equal(browser.status, 200, JSON.stringify(browser.data));
  assert.equal(browser.data.totalPosts, 26);
  assert.equal(browser.data.totalSources, 2);
  assert.equal(browser.data.cachedInMemory, 0);
  assert.equal(browser.data.countBasis, 'stored');
  const hn = browser.data.sources.find(source => source.id === 'hackernews');
  assert.equal(hn.postCount, 25);
  assert.equal(hn.samplePosts.length, 1);
  assert.equal(hn.samplePosts[0].id, 'hn_1');
  const stats = await app.request('/feed/stats', { userId: 'inventory-member' });
  assert.equal(stats.data.total, 26); assert.equal(stats.data.stats.hackernews, 25);
  const status = await app.request('/office/status', { headers: { 'x-office-token': 'inventory-test-office' } });
  assert.equal(status.status, 200, JSON.stringify(status.data));
  assert.equal(status.data.feed.postCount, 26); assert.equal(status.data.feed.cachedInMemory, 0);
  assert.equal(status.data.feedStorage.cache.count, 26);
  assert.equal(status.data.feed.composition.find(source => source.source === 'hackernews').count, 25);
  assert.equal(app.queries.filter(({ sql }) => sql.includes('FROM feed_posts_cache GROUP BY source')).length, 1);
  await app.request('/feed/sources?sample=5', { userId: 'inventory-member' });
  assert.equal(app.queries.filter(({ sql }) => sql.includes('CROSS JOIN LATERAL')).length, 1, 'sample-size choices reuse the same bounded cache');
  time += 60_001; failing = true;
  const stale = await app.request('/feed/stats', { userId: 'inventory-member' });
  assert.equal(stale.status, 200); assert.equal(stale.data.total, 26);
  assert.equal(stale.data.status, 'stale');
  assert.doesNotMatch(JSON.stringify(stale.data), /secret-database-host/);
  const staleSources = await app.request('/feed/sources', { userId: 'inventory-member' });
  assert.equal(staleSources.data.totalPosts, 26); assert.equal(staleSources.data.status, 'stale');
  assert.equal(staleSources.data.samplesStatus, 'stale');
});

test('an unavailable database is not reported as a verified zero-post API', async t => {
  const app = await createAppHarness({ connected: false, env: { SERVICE_ROLE: 'api', OFFICE_TOKEN: 'inventory-office' } });
  t.after(() => app.close()); app.seedUser(member('inventory-member'));
  const stats = await app.request('/feed/stats', { userId: 'inventory-member' });
  assert.equal(stats.status, 503); assert.equal(stats.data.total, null);
  const browser = await app.request('/feed/sources', { userId: 'inventory-member' });
  assert.equal(browser.status, 503); assert.equal(browser.data.totalPosts, null);
  assert.equal(browser.data.status, 'unavailable');
  const office = await app.request('/office/status', { headers: { 'x-office-token': 'inventory-office' } });
  assert.equal(office.data.feed.postCount, null); assert.equal(office.data.feed.status, 'unavailable');
});

test('pipeline status continues to identify its memory working set separately from persisted inventory', async t => {
  const app = await createAppHarness({ env: { SERVICE_ROLE: 'pipeline', OFFICE_TOKEN: 'pipeline-office' } });
  t.after(() => app.close());
  app.globalFeedCache.posts.push({ id: 'hn_one', source: 'hackernews', topic: 'Engineering' });
  const office = await app.request('/office/status', { headers: { 'x-office-token': 'pipeline-office' } });
  assert.equal(office.data.feed.postCount, 1); assert.equal(office.data.feed.cachedInMemory, 1);
  assert.equal(office.data.feed.countBasis, 'memory');
  assert.equal(office.data.feedStorage.cache.count, null);
});
