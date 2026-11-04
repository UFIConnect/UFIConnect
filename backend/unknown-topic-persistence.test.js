'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeedRoutingFixture } = require('./test-support/feed-routing-fixture');

const post = (id, extra = {}) => ({ id, source: 'reddit', title: 'A Django tutorial using Python',
  content: 'Build a useful Django application with Python.', topic: null,
  sourceUrl: `https://example.org/articles/${id}`, createdAt: new Date().toISOString(), ...extra });
const ambiguous = id => post(id, { title: 'An ordinary afternoon', content: 'A plain update without a subject.' });
const rows = async (f, table) => (await f.pg.query(`SELECT * FROM ${table} ORDER BY ${table === 'office_unknown_topic_review' ? 'post_id' : 'id'}`)).rows;
const count = async (f, table) => (await rows(f, table)).length;
const stream = app => {
  const frames = [];
  app.sseClients.set('guardian-test', { feedViewerId: null, write: frame => frames.push(frame) });
  return { frames, ids: () => frames.flatMap(frame => JSON.parse(frame.slice(6).trim()).posts.map(post => post.id)) };
};

test('actual single and bulk live writers admit evidence and publish topic changes only after commit', async t => {
  let pending = null, checks = 0;
  const f = await createFeedRoutingFixture(t, { guardian: true, beforeQuery: async sql => {
    if (sql === 'COMMIT' && pending) { assert.equal(pending.topic, null); checks++; }
  } });
  const single = post('single-live'), bulk = post('bulk-live');
  pending = single;
  assert.equal(await f.app.savePostsToDB([single], 'feed_posts_cache'), 1);
  assert.equal(single.topic, 'Python');
  assert.equal(single.subtopic, 'Web frameworks');
  pending = bulk;
  assert.equal(await f.app.savePostsToDBFast([bulk], 'feed_posts_cache', f.app.db, { skipTrim: true }), 1);
  assert.equal(bulk.topic, 'Python');
  assert.equal(bulk.subtopic, 'Web frameworks');
  assert.equal(checks, 2);
  assert.deepEqual((await rows(f, 'feed_posts_cache')).map(row => [row.id, row.topic]), [['bulk-live', 'Python'], ['single-live', 'Python']]);
  assert.equal(await count(f, 'office_unknown_topic_review'), 0);
});

test('actual live writers preserve ambiguous posts for review without live rows or false routing labels', async t => {
  let verifyCommit = null;
  const f = await createFeedRoutingFixture(t, { guardian: true, beforeQuery: async sql => {
    if (sql === 'COMMIT') verifyCommit?.();
  } });
  const single = ambiguous('single-held'), bulk = ambiguous('bulk-held');
  const notifications = stream(f.app);
  f.app.globalFeedCache.posts.push(single, bulk);
  const sourceCache = { posts: [single, bulk] }; f.app.agentSourceCache.set('guardian-cache', sourceCache);
  f.app.broadcastSSE([single, bulk]);
  verifyCommit = () => assert.ok(f.app.globalFeedCache.posts.some(post => post.id === single.id), 'A held row leaves caches only after commit');
  assert.equal(await f.app.savePostsToDB([single], 'feed_posts_cache'), 0);
  assert.equal(f.app.globalFeedCache.posts.some(post => post.id === single.id), false);
  verifyCommit = () => assert.ok(sourceCache.posts.some(post => post.id === bulk.id), 'Source caches stay intact until commit');
  assert.equal(await f.app.savePostsToDBFast([bulk], 'feed_posts_cache', f.app.db, { skipTrim: true }), 0);
  verifyCommit = null;
  assert.equal(f.app.globalFeedCache.posts.length, 0); assert.equal(sourceCache.posts.length, 0);
  await f.app.flushSSEBatch(); assert.deepEqual(notifications.ids(), []);
  assert.equal(await count(f, 'feed_posts_cache'), 0);
  assert.equal(single.topic, null); assert.equal(bulk.topic, null);
  const held = await rows(f, 'office_unknown_topic_review');
  assert.deepEqual(held.map(row => row.post_id), ['bulk-held', 'single-held']);
  for (const row of held) {
    assert.equal(row.post.content, single.content);
    assert.equal(row.post.source, 'reddit');
    assert.equal(row.post.source_url, `https://example.org/articles/${row.post_id}`);
    assert.ok(row.post.post_created_at);
  }
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM office_feed_topic_assignments')).rows[0].n, 0);
  const snapshot = await f.guardian.snapshot();
  assert.equal(snapshot.unknownLive, 0); assert.equal(snapshot.heldForReview, 2);
});

test('staging promotion reports held rows separately and broadcasts only posts actually committed live', async t => {
  const f = await createFeedRoutingFixture(t, { guardian: true });
  const notifications = stream(f.app);
  await f.app.savePostsToDBFast([post('promoted-known'), ambiguous('promoted-held')], 'feed_posts_staging');
  const result = await f.app.transferStagedPosts({ maxBatches: 1, reason: 'guardian-test' });
  assert.equal(result.error, undefined);
  assert.equal(result.transferred, 1);
  assert.equal(result.drained, 2);
  assert.equal(result.heldForReview, 1);
  assert.equal(result.screenedOut, 0);
  assert.equal(await count(f, 'feed_posts_staging'), 0);
  assert.deepEqual((await rows(f, 'feed_posts_cache')).map(row => row.id), ['promoted-known']);
  assert.deepEqual((await rows(f, 'office_unknown_topic_review')).map(row => row.post_id), ['promoted-held']);
  await f.app.flushSSEBatch();
  assert.deepEqual(notifications.ids(), ['promoted-known']);
});

test('stale unknown refreshes through both writers retain a known live topic while refreshing its body', async t => {
  const f = await createFeedRoutingFixture(t, { guardian: true });
  for (const writer of ['single', 'bulk']) {
    const id = `known-${writer}`;
    await f.app.savePostsToDBFast([post(id)], 'feed_posts_cache', f.app.db, { skipTrim: true });
    const refresh = { ...ambiguous(id), likesCount: 23 };
    const saved = writer === 'single'
      ? await f.app.savePostsToDB([refresh], 'feed_posts_cache')
      : await f.app.savePostsToDBFast([refresh], 'feed_posts_cache', f.app.db, { skipTrim: true });
    assert.equal(saved, 1);
    const row = (await f.pg.query('SELECT topic,title,content,likes_count FROM feed_posts_cache WHERE id=$1', [id])).rows[0];
    assert.deepEqual(row, { topic: 'Python', title: refresh.title, content: refresh.content, likes_count: 23 });
    assert.equal(refresh.topic, 'Python');
  }
  assert.equal(await count(f, 'office_unknown_topic_review'), 0);
});

test('failed live writes roll back held content and live classifications together', async t => {
  let failCommit = false;
  const f = await createFeedRoutingFixture(t, { guardian: true, beforeQuery: async sql => {
    if (failCommit && sql === 'COMMIT') throw new Error('Synthetic guardian commit failure');
  } });
  failCommit = true;
  const known = post('rollback-known'), held = ambiguous('rollback-held');
  f.app.globalFeedCache.posts.push(known, held);
  const sourceCache = { posts: [known, held] }; f.app.agentSourceCache.set('rollback-cache', sourceCache);
  await assert.rejects(f.app.savePostsToDBFast([known, held], 'feed_posts_cache', f.app.db, { skipTrim: true }), /commit failure/);
  assert.equal(await f.app.savePostsToDB([ambiguous('rollback-single')], 'feed_posts_cache'), 0);
  assert.equal(await count(f, 'feed_posts_cache'), 0);
  assert.equal(await count(f, 'office_unknown_topic_review'), 0);
  assert.equal(known.topic, null); assert.equal(held.topic, null);
  assert.deepEqual(Array.from(f.app.globalFeedCache.posts, post => post.id), ['rollback-known', 'rollback-held']);
  assert.deepEqual(sourceCache.posts.map(post => post.id), ['rollback-known', 'rollback-held']);
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM office_feed_topic_assignments')).rows[0].n, 0);
});

test('failed promotion retains staging and emits no held or live changes before a successful retry', async t => {
  let failCommit = false;
  const f = await createFeedRoutingFixture(t, { guardian: true, beforeQuery: async sql => {
    if (failCommit && sql === 'COMMIT') throw new Error('Synthetic promotion commit failure');
  } });
  const notifications = stream(f.app);
  await f.app.savePostsToDBFast([post('retry-known'), ambiguous('retry-held')], 'feed_posts_staging');
  failCommit = true;
  const failed = await f.app.transferStagedPosts({ maxBatches: 1, reason: 'guardian-rollback' });
  assert.ok(failed.error); assert.equal(failed.transferred, 0); assert.equal(failed.drained, 0);
  assert.equal(await count(f, 'feed_posts_staging'), 2);
  assert.equal(await count(f, 'feed_posts_cache'), 0);
  assert.equal(await count(f, 'office_unknown_topic_review'), 0);
  await f.app.flushSSEBatch(); assert.deepEqual(notifications.ids(), []);
  failCommit = false;
  const retried = await f.app.transferStagedPosts({ maxBatches: 1, reason: 'guardian-retry' });
  assert.equal(retried.transferred, 1); assert.equal(retried.heldForReview, 1); assert.equal(retried.drained, 2);
  assert.equal(await count(f, 'feed_posts_staging'), 0);
  assert.equal(await count(f, 'feed_posts_cache'), 1);
  assert.equal(await count(f, 'office_unknown_topic_review'), 1);
  await f.app.flushSSEBatch(); assert.deepEqual(notifications.ids(), ['retry-known']);
});
