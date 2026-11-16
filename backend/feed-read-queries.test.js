const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness } = require('./test-support/app-harness');
const { createFeedRoutingFixture } = require('./test-support/feed-routing-fixture');

const ids = posts => Array.from(posts, post => post.id);

test('feed reads preserve compound, legacy and unstarted cursors in the same page', async t => {
  const { app, pg } = await createFeedRoutingFixture(t);
  await pg.exec('ALTER TABLE seen_posts ADD COLUMN user_id TEXT, ADD COLUMN engaged_at TIMESTAMPTZ');
  const tie = new Date(Math.floor(Date.now() / 1000) * 1000 - 60 * 60 * 1000).toISOString();
  await pg.query(`
    INSERT INTO feed_posts_cache (id, source, post_created_at, topic, title, content, source_url)
    SELECT id, source, $1::timestamptz + offset_hours * interval '1 hour', topic,
           'Software release', 'Details about a new open source software release.', 'https://example.com/' || id
    FROM (VALUES
      ('reddit_d', 'reddit', 0, 'Python'),
      ('reddit_c', 'reddit', 0, 'Python'),
      ('reddit_b', 'reddit', 0, 'Python'),
      ('reddit_a', 'reddit', -1, 'Python'),
      ('reddit_old', 'reddit', -2, 'Python'),
      ('reddit_other_topic', 'reddit', -1, 'Travel'),
      ('devto_newer', 'devto', 0.5, 'Python'),
      ('devto_legacy', 'devto', 0, 'Python'),
      ('devto_fallback', 'devto', 0, 'Python'),
      ('bluesky_undated', 'bluesky', NULL, 'Travel')
    ) fixture(id, source, offset_hours, topic)
  `, [tie]);
  await pg.exec("INSERT INTO seen_posts (user_id, post_id, engaged_at) VALUES ('viewer', 'reddit_a', now())");

  const options = {
    userId: 'viewer', sources: ['reddit', 'devto', 'bluesky'], maxPostsPerSource: 1,
    sourceTopics: { reddit: ['python'], devto: ['python'] },
    cursorMap: { reddit: { ts: tie, id: 'reddit_c' }, devto: tie },
  };
  const first = await app.getCursorFeedPage(options);
  assert.deepEqual(ids(first.posts), ['reddit_b', 'devto_legacy', 'bluesky_undated']);
  const cursorMap = JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString());
  assert.deepEqual(cursorMap.reddit, { ts: tie, id: 'reddit_b' });
  const second = await app.getCursorFeedPage({ ...options, cursorMap });
  assert.deepEqual(ids(second.posts), ['reddit_old']);

  const live = await app.getCursorFeedPage({ ...options, cursorMap: { __liveSince: tie } });
  assert.deepEqual(ids(live.posts), ['devto_newer']);
  assert.deepEqual(app.errors, []);
});

test('ranked candidates hydrate full posts after applying the per-source page and filters', async t => {
  const { app, pg } = await createFeedRoutingFixture(t);
  await pg.exec(`INSERT INTO feed_posts_cache
    (id, source, likes_count, post_created_at, fetched_at, media_type, video_duration_seconds, title, content, source_url)
    SELECT id, 'devto', likes, now() - interval '30 minutes', now(), media, duration,
      'Engineering demo', 'A complete explanation of the engineering demo.', 'https://example.com/' || id
    FROM (VALUES ('devto_b', 100, 'video', 250), ('devto_a', 100, 'video', 250),
      ('devto_short', 500, 'video', 20), ('devto_article', 500, 'article', NULL)) fixture(id, likes, media, duration)`);
  const options = { sortMode: 'ranked', source: 'devto', mediaType: 'video', videoDurationMinSeconds: 61, perSourcePageSize: 1 };
  const first = await app.getBalancedFeedPosts(options);
  const second = await app.getBalancedFeedPosts({ ...options, page: 2 });
  assert.deepEqual(ids(first.posts), ['devto_b']);
  assert.deepEqual(ids(second.posts), ['devto_a']);
  assert.equal(first.perSourceCount, 1);
  assert.equal(first.posts[0].content, 'A complete explanation of the engineering demo.');

  const group = await app.getPublicGroupPostsFromDB(['ext_devto']);
  assert.deepEqual(new Set(ids(group.posts)), new Set(['devto_a', 'devto_b', 'devto_short', 'devto_article']));
  assert.equal(group.posts[0].groupId, 'ext_devto');
});

test('a feed deadline does not let another request duplicate the pending database read', async t => {
  const timeoutMs = 5;
  const app = await createAppHarness({ liveTimeoutMs: timeoutMs });
  t.after(() => app.close());
  let reads = 0;
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const query = () => { reads++; return pending; };
  const options = { cacheKey: 'balanced::ranked::all', timeoutMs };

  const burst = await Promise.all(Array.from({ length: 25 }, () => app.readFeedCandidates(query, options)));
  assert.ok(burst.every(posts => posts.length === 0));
  assert.equal((await app.readFeedCandidates(query, options)).length, 0);
  assert.equal(reads, 1);
  const awaiting = app.readFeedCandidates(query, options);
  finish([{ id: 'late_post' }]);
  assert.deepEqual(ids(await awaiting), ['late_post']);
  assert.deepEqual(ids(await app.readFeedCandidates(query, options)), ['late_post']);
  assert.equal(reads, 1);
});
