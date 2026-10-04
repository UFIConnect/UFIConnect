'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');

const topic = 'Science';
function postRow(source, index, duration = 1200) {
  const videoUrl = `https://www.youtube.com/watch?v=fixture${String(index).padStart(4, '0')}`;
  return {
    id: `${source}_selection_${index}`, source, topic,
    title: `Science research update ${index}`, content: 'Researchers share a detailed science project update.',
    source_url: source === 'youtube' ? videoUrl : `https://example.com/science/${index}`,
    author_name: 'Science publisher', post_created_at: new Date(Date.now() - index * 60000).toISOString(),
    media_type: 'video', video_duration_seconds: duration,
    media_url: source === 'youtube' ? videoUrl : `https://example.com/video/${index}.mp4`,
  };
}

// Emulate the indexed source/cursor read, leaving authentication, source gates,
// topic/placement filters, equalization and response pagination in the real app.
async function feedFixture(t, { duration = 1200, emptyFirstWindow = false } = {}) {
  const reads = [];
  const inventory = ['youtube', 'reddit', 'github'].flatMap(source =>
    Array.from({ length: 5 }, (_, index) => postRow(source, index + 1, duration)));
  const app = await createAppHarness({ connected: true, query: async (sql, params) => {
    if (!sql.includes('WITH c(source, before_ts, before_id)')) {
      if (!sql.includes('FROM feed_posts_cache')) return { rows: [], rowCount: 0 };
      const sourceArg = sql.match(/source = (?:ANY\(\$(\d+)::text\[\]\)|\$(\d+))/);
      if (!sourceArg) return { rows: [], rowCount: 0 };
      const value = params[Number(sourceArg[1] || sourceArg[2]) - 1];
      const sources = Array.isArray(value) ? value : [value];
      reads.push({ sources, sql, params });
      const rows = inventory.filter(row => sources.includes(row.source));
      return { rows, rowCount: rows.length };
    }
    const values = sql.match(/AS \(VALUES (.*?)\)\s+SELECT/s)[1];
    const slots = [...values.matchAll(/\(\$(\d+), \$(\d+)::timestamptz, \$(\d+)::text\)/g)];
    const sources = slots.map(slot => params[Number(slot[1]) - 1]);
    reads.push({ sources, sql, params });
    if (emptyFirstWindow && reads.length === 1) return { rows: [], rowCount: 0 };
    const rows = slots.flatMap(slot => {
      const source = params[Number(slot[1]) - 1];
      const before = params[Number(slot[2]) - 1];
      return inventory.filter(row => row.source === source && (!before || row.post_created_at < before));
    });
    return { rows, rowCount: rows.length };
  } });
  t.after(() => app.close());
  app.seedUser(member('source-reader'));
  return { app, reads };
}

const base = '/office/feed?mode=feed&sort=newest&passive=1&topics=Science&limit=3';
const ids = response => response.data.posts.map(post => post.id);

async function subscribedYouTubeFixture(t, interests) {
  const app = await createAppHarness();
  t.after(() => app.close());
  const viewer = member('youtube-subscriber', { preferences: { interests }, socialTokens: { youtube: 'fixture-only' } });
  app.seedUser(viewer);
  app.seedUser(member('another-subscriber', { socialTokens: { youtube: 'other-fixture-only' } }));
  const posts = [null, 'Science', 'Travel'].flatMap((label, index) => [120, 1200].map(duration => ({
    ...app.dbRowToFeedPost(postRow('youtube', index + 1, duration)),
    id: `subscribed-${label || 'untagged'}-${duration}`, topic: label,
  })));
  app.followingSourceCache.set(`${viewer.id}::youtube`, { fetchedAt: Date.now(), posts });
  app.followingSourceCache.set('another-subscriber::youtube', { fetchedAt: Date.now(), posts: posts.map(post => ({ ...post, id: `other-${post.id}` })) });
  return { app, viewer };
}

for (const route of ['/office/feed?mode=following&passive=1', '/office/feed/videos/following?']) {
  for (const interests of [[], ['Science']]) {
    test(`untagged subscribed YouTube videos survive default Following scope: ${route}, interests=${interests.length}`, async t => {
      const { app, viewer } = await subscribedYouTubeFixture(t, interests);
      assert.equal((await app.request(`${route}&source=youtube`)).status, 401);
      const result = await app.request(`${route}&source=youtube&limit=20`, { userId: viewer.id });
      assert.equal(result.status, 200);
      assert.ok(result.data.posts.some(post => post.id.startsWith('subscribed-untagged-')), 'YouTube subscription API posts have no topic label and must not all disappear');
      assert.ok(result.data.posts.every(post => post.source === 'youtube' && post.id.startsWith('subscribed-')));
      assert.ok(result.data.posts.every(post => post.topic == null || interests.includes(post.topic)), 'Tagged posts still obey the saved topic scope');
      assert.ok(result.data.posts.filter(post => post.id.startsWith('subscribed-untagged-')).every(post => post.topic == null), 'Do not invent a topic for a subscribed video');
    });
  }
  test(`explicit Following topics still exclude untagged YouTube videos: ${route}`, async t => {
    const { app, viewer } = await subscribedYouTubeFixture(t, ['Travel']);
    const result = await app.request(`${route}&source=youtube&topics=Science&limit=20`, { userId: viewer.id });
    assert.equal(result.status, 200);
    assert.ok(result.data.posts.length > 0);
    assert.ok(result.data.posts.every(post => post.topic === 'Science' && post.id.startsWith('subscribed-')));
  });
}

test('Maps singleton sources returns only YouTube and advances its cursor', async t => {
  const { app, reads } = await feedFixture(t);
  assert.equal((await app.request(`${base}&sources=youtube`)).status, 401);
  const first = await app.request(`${base}&sources=youtube`, { userId: 'source-reader' });
  assert.equal(first.status, 200);
  assert.equal(first.data.source, 'youtube');
  assert.equal(first.data.posts.length, 3);
  assert.ok(first.data.posts.every(post => post.source === 'youtube'));
  assert.deepEqual(reads[0].sources, ['youtube']);
  const second = await app.request(`${base}&sources=youtube&cursor=${encodeURIComponent(first.data.cursor)}`, { userId: 'source-reader' });
  assert.equal(second.status, 200);
  assert.ok(second.data.posts.length > 0);
  assert.ok(ids(second).every(id => !ids(first).includes(id)));
  assert.ok(second.data.posts.every(post => post.source === 'youtube'));
  assert.ok(reads.every(read => read.sources.length === 1 && read.sources[0] === 'youtube'));
});

test('singleton plural sources matches legacy singular, including accepted mixed lists', async t => {
  const { app } = await feedFixture(t);
  const legacy = await app.request(`${base}&source=youtube`, { userId: 'source-reader' });
  assert.equal(legacy.data.posts.length, 3);
  for (const selection of ['sources=youtube', 'sources=YouTube%20', 'sources=youtube,instagram', 'sources=youtube,youtube', 'sources=,youtube,,']) {
    const result = await app.request(`${base}&${selection}`, { userId: 'source-reader' });
    assert.equal(result.status, 200, selection);
    assert.deepEqual(ids(result), ids(legacy), selection);
    assert.equal(result.data.source, 'youtube', selection);
  }
  const explicit = await app.request(`${base}&source=reddit&sources=youtube`, { userId: 'source-reader' });
  assert.ok(explicit.data.posts.every(post => post.source === 'reddit'), 'legacy singular precedence remains intact');
});

test('multi-source, empty selection, and member-only authorization keep their existing scopes', async t => {
  const { app, reads } = await feedFixture(t);
  const multi = await app.request(`${base}&sources=youtube,reddit`, { userId: 'source-reader' });
  assert.deepEqual(multi.data.sources, ['youtube', 'reddit']);
  assert.deepEqual(new Set(multi.data.posts.map(post => post.source)), new Set(['youtube', 'reddit']));
  assert.deepEqual(reads.at(-1).sources, ['youtube', 'reddit']);
  const all = await app.request(`${base}&sources=`, { userId: 'source-reader' });
  assert.equal(all.status, 200);
  assert.ok(reads.at(-1).sources.length > 3);
  const before = reads.length;
  const privateOnly = await app.request(`${base}&sources=instagram`, { userId: 'source-reader' });
  assert.equal(privateOnly.data.memberOnly, true);
  assert.deepEqual(privateOnly.data.posts, []);
  assert.equal(reads.length, before, 'member-only source never falls through to the aggregate database');
  const alias = await app.request(`${base}&sources=hn,hackernews`, { userId: 'source-reader' });
  assert.equal(alias.data.source, 'hackernews');
  assert.deepEqual(reads.at(-1).sources, ['hackernews']);
});

test('empty recent window retries retained history with the same YouTube-only scope', async t => {
  const { app, reads } = await feedFixture(t, { emptyFirstWindow: true });
  const result = await app.request(`${base}&sources=youtube`, { userId: 'source-reader' });
  assert.equal(result.status, 200);
  assert.equal(result.data.posts.length, 3);
  assert.equal(reads.length, 2);
  assert.deepEqual(reads.map(read => read.sources), [['youtube'], ['youtube']]);
  assert.match(reads[0].sql, /fp\.post_created_at >=/);
  assert.doesNotMatch(reads[1].sql, /fp\.post_created_at >=/);
});

test('video discovery respects singleton sources and aggregate authorization', async t => {
  const { app, reads } = await feedFixture(t, { duration: 120 });
  const url = '/office/feed/videos?topics=Science&limit=3';
  assert.equal((await app.request(`${url}&sources=youtube`)).status, 401);
  const result = await app.request(`${url}&sources=youtube`, { userId: 'source-reader' });
  assert.equal(result.status, 200);
  assert.equal(result.data.posts.length, 3);
  assert.ok(result.data.posts.every(post => post.source === 'youtube'));
  assert.deepEqual(reads[0].sources, ['youtube']);
  const privateOnly = await app.request(`${url}&sources=instagram`, { userId: 'source-reader' });
  assert.equal(privateOnly.data.memberOnly, true);
  assert.deepEqual(privateOnly.data.posts, []);
});

test('following source selections do not include another connected account or native author', async t => {
  const app = await createAppHarness(); t.after(() => app.close());
  app.seedUser(member('following-reader', { socialTokens: { youtube: 'fixture-only', reddit: 'fixture-only' } }));
  app.seedUser(member('following-author'));
  app.follows.push({ followerId: 'following-reader', followingId: 'following-author' });
  for (const duration of [120, 1200]) {
    app.posts.push({ id: `native_${duration}`, source: 'uficonnect', groupId: 'ufi-general', authorId: 'following-author',
      title: 'Science native update', content: 'A science update for everyone.', topic, createdAt: new Date().toISOString(),
      mediaType: 'video', mediaUrl: 'https://example.com/native.mp4', videoDurationSeconds: duration, likes: [] });
  }
  for (const source of ['youtube', 'reddit']) {
    app.followingSourceCache.set(`following-reader::${source}`, { fetchedAt: Date.now(), posts: [120, 1200].map(duration => ({
      ...app.dbRowToFeedPost(postRow(source, duration, duration)),
    })) });
  }
  for (const url of ['/office/feed?mode=following&passive=1', '/office/feed/videos/following?']) {
    const result = await app.request(`${url}&sources=youtube&topics=Science`, { userId: 'following-reader' });
    assert.equal(result.status, 200, url);
    assert.ok(result.data.posts.length > 0, url);
    assert.ok(result.data.posts.every(post => post.source === 'youtube'), url);
  }
});

test('ranked page two stays YouTube-only when database reads fail and cached posts exist', async t => {
  const app = await createAppHarness({ connected: true, query: async sql => {
    if (sql.includes('FROM feed_posts_cache')) throw new Error('Fixture database outage');
    return { rows: [], rowCount: 0 };
  } });
  t.after(() => app.close());
  app.seedUser(member('source-reader'));
  const inventory = ['youtube', 'reddit'].flatMap(source =>
    Array.from({ length: 5 }, (_, index) => app.dbRowToFeedPost(postRow(source, index + 1))));
  assert.equal(app.addAndBroadcast(inventory), 10);
  const result = await app.request('/office/feed?mode=feed&sort=ranked&passive=1&topics=Science&sources=youtube&page=2&limit=3', { userId: 'source-reader' });
  assert.equal(result.status, 200);
  assert.equal(result.data.posts.length, 3);
  assert.ok(result.data.posts.every(post => post.source === 'youtube'));
});

test('video search and balanced sorting retain singleton source scope', async t => {
  for (const selection of ['sort=balanced', 'q=science']) {
    await t.test(selection, async t => {
      const { app, reads } = await feedFixture(t, { duration: 120 });
      const result = await app.request(`/office/feed/videos?topics=Science&limit=3&sources=youtube&${selection}`, { userId: 'source-reader' });
      assert.equal(result.status, 200);
      assert.ok(result.data.posts.length > 0);
      assert.ok(result.data.posts.every(post => post.source === 'youtube'));
      assert.ok(reads.length > 0);
      assert.ok(reads.every(read => read.sources.length === 1 && read.sources[0] === 'youtube'));
    });
  }
});
