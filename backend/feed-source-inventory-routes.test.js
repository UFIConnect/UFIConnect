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

test('cached source samples honor durable removals immediately and clear bodies when moderation checks fail', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE feed_posts_cache (
    id TEXT PRIMARY KEY,source TEXT NOT NULL,title TEXT,content TEXT,author_name TEXT,source_url TEXT,
    post_created_at TIMESTAMPTZ,fetched_at TIMESTAMPTZ DEFAULT NOW(),likes_count INTEGER DEFAULT 0,comments_count INTEGER DEFAULT 0);
    CREATE TABLE report_content_suppressions(target_type TEXT,target_id TEXT,source TEXT,source_url TEXT);
    INSERT INTO feed_posts_cache(id,source,title,content,author_name,source_url,post_created_at) VALUES
      ('hn_removed','hackernews','Database indexing investigation','An engineering team explains database indexing and query optimization.',
       'Engineering team','https://news.ycombinator.com/item?id=123',NOW()),
      ('hn_visible','hackernews','Distributed database design','Researchers compare consistency and replication strategies for distributed databases.',
       'Research team','https://news.ycombinator.com/item?id=456',NOW());`);
  let moderationUnavailable = false;
  const app = await createAppHarness({ connected: true, env: { SERVICE_ROLE: 'api' }, query: (sql, params) => {
    if (sql.includes('FROM report_content_suppressions')) {
      if (moderationUnavailable) throw Error('private-moderation-database-password');
      return pg.query(sql, params);
    }
    if (sql.includes('FROM feed_posts_cache')) return pg.query(sql, params);
    return { rows: [], rowCount: 0 };
  } });
  t.after(() => app.close()); app.seedUser(member('inventory-member'));
  const first = await app.request('/feed/sources', { userId: 'inventory-member' });
  assert.equal(first.status, 200); assert.equal(first.data.sources[0].samplePosts.length, 2);
  assert.equal(app.queries.filter(({ sql }) => sql.includes('CROSS JOIN LATERAL')).length, 1);
  await pg.query("INSERT INTO report_content_suppressions VALUES('post','hn_removed','hackernews','https://news.ycombinator.com/item?id=123')");
  await pg.query("DELETE FROM feed_posts_cache WHERE id='hn_removed'");
  const removed = await app.request('/feed/sources', { userId: 'inventory-member' });
  assert.deepEqual(removed.data.sources[0].samplePosts.map(post => post.id), ['hn_visible']);
  assert.doesNotMatch(JSON.stringify(removed.data), /Database indexing investigation|item\?id=123/);
  assert.equal(app.queries.filter(({ sql }) => sql.includes('CROSS JOIN LATERAL')).length, 1, 'Removal is honored while the old sample cache is reused.');
  moderationUnavailable = true;
  const unavailable = await app.request('/feed/sources', { userId: 'inventory-member' });
  assert.equal(unavailable.status, 200); assert.equal(unavailable.data.totalPosts, 2, 'Known inventory counts retain their explicit snapshot.');
  assert.equal(unavailable.data.samplesStatus, 'unavailable');
  assert.equal(unavailable.data.sources[0].samplePosts.length, 0, 'An outage clears all unchecked excerpts.');
  assert.doesNotMatch(JSON.stringify(unavailable.data), /private-moderation-database-password/);
});

test('provider display switches remove public counts and samples while Office preserves raw stored inventory', async t => {
  const sampleRequests = [];
  const app = await createAppHarness({ connected: true,
    env: { SERVICE_ROLE: 'api', OFFICE_TOKEN: 'source-policy-office', SOURCE_YOUTUBE_DISPLAY_POST_ENABLED: 'false' },
    query: (sql, params) => {
      if (sql.includes('FROM feed_posts_cache GROUP BY source')) return { rows: [
        { source: 'hackernews', count: 3, feed_count: 3 }, { source: 'youtube', count: 99, feed_count: 99 },
      ] };
      if (sql.includes('CROSS JOIN LATERAL')) { sampleRequests.push(params[0]); return { rows: [] }; }
      return { rows: [], rowCount: 0 };
    },
  });
  t.after(() => app.close()); app.seedUser(member('inventory-member'));
  const sources = await app.request('/feed/sources', { userId: 'inventory-member' });
  assert.equal(sources.status, 200); assert.equal(sources.data.totalPosts, 3); assert.equal(sources.data.totalStoredPosts, 3);
  assert.equal(sources.data.sources.some(source => source.id === 'youtube'), false);
  assert.deepEqual(sampleRequests, [['hackernews']], 'Disabled provider rows are not even sampled.');
  const stats = await app.request('/feed/stats', { userId: 'inventory-member' });
  assert.equal(stats.data.total, 3); assert.equal(stats.data.stats.youtube, undefined);
  const office = await app.request('/office/status', { headers: { 'x-office-token': 'source-policy-office' } });
  assert.equal(office.data.feed.postCount, 102); assert.equal(office.data.feedStorage.cache.bySource.youtube.count, 99);
});
