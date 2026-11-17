const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');
const { createFeedRoutingFixture } = require('./test-support/feed-routing-fixture');

const ids = posts => Array.from(posts, post => post.id);

test('Home and Global serve a varied discovery mix without losing posts across cursors', async t => {
  const { app, pg } = await createFeedRoutingFixture(t);
  await pg.exec('ALTER TABLE seen_posts ADD COLUMN user_id TEXT, ADD COLUMN engaged_at TIMESTAMPTZ');
  app.seedUser(member('discovery-viewer', { preferences: { interests: ['Python'] } }));
  await pg.exec(`
    INSERT INTO feed_posts_cache (id, source, topic, title, content, source_url, post_created_at)
    SELECT id, source, topic, topic || ' post', 'A discussion shared by an outside community.',
           'https://example.com/' || id, now() - minutes * interval '1 minute'
    FROM (VALUES
      ('python_first', 'github', 'Python', 1),
      ('python_second', 'github', 'Python', 8),
      ('python_other', 'hackernews', 'Python', 2),
      ('outside_scope', 'gitlab', 'Venture Capital', 3),
      ('clean_joke', 'bluesky', 'Humor & Memes', 4),
      ('second_joke', 'bluesky', 'Humor & Memes', 9),
      ('kitchen_tip', 'mastodon', 'Everyday Tips', 5),
      ('history_explainer', 'reddit', 'Facts & Explainers', 6),
      ('weekend_photos', 'medium', 'Photography', 7)
    ) fixture(id, source, topic, minutes)
  `);

  const home = '/office/feed?mode=feed&sort=newest&passive=1&limit=6';
  const request = suffix => app.request(home + suffix, { userId: 'discovery-viewer' });
  const first = await request('');
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.posts.map(post => post.topic), [
    'Python', 'Humor & Memes', 'Everyday Tips', 'Python', 'Facts & Explainers', 'Photography',
  ]);
  const second = await request('&cursor=' + encodeURIComponent(first.data.cursor));
  assert.deepEqual(ids(second.data.posts).sort(), ['python_second', 'second_joke']);
  assert.equal(new Set(ids([...first.data.posts, ...second.data.posts])).size, 8);

  const topic = await request('&topics=Python');
  assert.deepEqual(ids(topic.data.posts).sort(), ['python_first', 'python_other', 'python_second']);
  const source = await request('&source=gitlab');
  assert.deepEqual(ids(source.data.posts), ['outside_scope']);

  const guest = await app.request('/feed/guest?limit=6');
  assert.deepEqual(guest.data.posts.map(post => post.topic), [
    'Python', 'Humor & Memes', 'Everyday Tips', 'Venture Capital', 'Facts & Explainers', 'Photography',
  ]);
  const nextGuest = await app.request('/feed/guest?limit=6&cursor=' + encodeURIComponent(guest.data.cursor));
  assert.deepEqual(ids([...guest.data.posts, ...nextGuest.data.posts]).sort(), [
    'clean_joke', 'history_explainer', 'kitchen_tip', 'outside_scope', 'python_first',
    'python_other', 'python_second', 'second_joke', 'weekend_photos',
  ]);
  assert.deepEqual(app.errors, []);
});

test('opening discovery surfaces recent topics behind busier source streams without repeating picks', async t => {
  const { app, pg } = await createFeedRoutingFixture(t);
  await pg.exec('ALTER TABLE seen_posts ADD COLUMN user_id TEXT, ADD COLUMN engaged_at TIMESTAMPTZ');
  app.seedUser(member('opening-discovery', { preferences: { interests: ['Open Source'] } }));
  const collectors = ['bluesky', 'mastodon', 'devto', 'github'];
  await pg.exec(`INSERT INTO feed_posts_cache (id, source, topic, title, content, source_url, post_created_at)
    SELECT source || '_' || n, source, 'Open Source', 'A new open source release',
      'The project community explains its latest release.', 'https://example.com/' || source || '/' || n,
      now() - n * interval '1 minute'
    FROM unnest(ARRAY['bluesky','mastodon','devto','github']) AS collector(source)
    CROSS JOIN generate_series(1,4) AS n;
    INSERT INTO feed_posts_cache (id, source, topic, title, content, source_url, post_created_at)
    SELECT id, source, topic, topic || ' post', 'A discussion from a public community.', 'https://example.com/' || id,
      now() - hours * interval '1 hour'
    FROM (VALUES
      ('old_joke', 'bluesky', 'Humor & Memes', 3),
      ('old_tip', 'bluesky', 'Everyday Tips', 4),
      ('old_explainer', 'mastodon', 'Facts & Explainers', 5)
    ) fixture(id, source, topic, hours)`);

  for (const request of [
    query => app.request('/feed/guest?limit=6' + query),
    query => app.request('/office/feed?mode=feed&sort=newest&passive=1&limit=6' + query, { userId: 'opening-discovery' }),
  ]) {
    const received = [];
    let cursor = '';
    for (let i = 0; i < 4; i++) {
      const result = await request(cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      assert.equal(result.status, 200);
      const page = result.data.posts;
      if (i === 0) assert.deepEqual(ids(page).filter(id => id.startsWith('old_')).sort(), ['old_explainer', 'old_joke', 'old_tip']);
      assert.ok(collectors.every(source => page.filter(post => post.source === source).length <= 2));
      received.push(...ids(page));
      cursor = result.data.cursor;
    }
    const expected = [...collectors.flatMap(source => [1, 2, 3, 4].map(n => `${source}_${n}`)), 'old_explainer', 'old_joke', 'old_tip'];
    assert.deepEqual(received.sort(), expected.sort());
  }

  const recent = await app.request('/office/feed?mode=feed&passive=1&limit=6&timeRange=1h', { userId: 'opening-discovery' });
  assert.equal(recent.data.posts.length, 6);
  assert.ok(recent.data.posts.every(post => post.topic === 'Open Source'));
  assert.deepEqual(app.errors, []);
});

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
