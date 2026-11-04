'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeedRoutingFixture } = require('./test-support/feed-routing-fixture');
const { createUnknownTopicReview } = require('./unknown-topic-review');

test('manual promotion atomically preserves a live copy inserted after review and stage selection without broadcasting old content', async t => {
  let inject = false, picked = false, pendingRead = false, f;
  f = await createFeedRoutingFixture(t, { guardian: true, beforeQuery: async sql => {
    if (!inject) return;
    if (sql.includes('WITH picked AS')) picked = true;
    if (sql.includes('office_unknown_topic_manual_assignments') && sql.includes('SELECT')) pendingRead = true;
    if (sql.includes('INSERT INTO feed_posts_cache AS existing')) {
      assert.equal(picked, true); assert.equal(pendingRead, true);
      inject = false;
      // PGlite has one connection. Place the concurrent writer's committed
      // outcome at the exact boundary before the real production upsert.
      await f.pg.query(`INSERT INTO feed_posts_cache(id,source,title,content,topic,source_url,post_created_at)
        VALUES('manual-race','reddit','Newer live title','Newer live body','Cybersecurity','https://example.org/manual-race',NOW())`);
      f.app.globalFeedCache.posts.push({ id: 'manual-race', source: 'reddit', title: 'Newer live title', content: 'Newer live body', topic: 'Cybersecurity' });
    }
  } });
  const review = createUnknownTopicReview({ db: f.app.db, topics: ['Python', 'Cybersecurity'] });
  await review.initialize();
  const original = { id: 'manual-race', source: 'reddit', title: 'Historical retained title', content: 'Historical retained body', topic: null,
    source_url: 'https://example.org/manual-race', post_created_at: new Date().toISOString(), fetched_at: new Date().toISOString() };
  await f.pg.query('INSERT INTO office_unknown_topic_review(post_id,post) VALUES($1,$2::jsonb)', [original.id, JSON.stringify(original)]);
  const detail = await review.detail(original.id);
  await review.assign(original.id, { topic: 'Python', confirmed: true, expectedVersion: detail.item.version });
  const frames = [];
  f.app.sseClients.set('manual-review-test', { feedViewerId: null, write: frame => frames.push(frame) });
  inject = true;
  const result = await f.app.transferStagedPosts({ maxBatches: 1, reason: 'manual-race-test' });
  assert.equal(result.error, undefined); assert.equal(inject, false);
  assert.equal(result.transferred, 0); assert.equal(result.heldForReview, 0); assert.equal(result.drained, 1);
  const live = (await f.pg.query("SELECT title,content,topic FROM feed_posts_cache WHERE id='manual-race'")).rows[0];
  assert.deepEqual(live, { title: 'Newer live title', content: 'Newer live body', topic: 'Cybersecurity' });
  assert.equal(f.app.globalFeedCache.posts.find(post => post.id === original.id)?.content, 'Newer live body');
  assert.ok((await f.pg.query('SELECT processed_at FROM office_unknown_topic_manual_assignments')).rows[0].processed_at);
  await f.app.flushSSEBatch(); assert.equal(frames.length, 0);

  // The one historical review copy is consumed. Future provider refreshes
  // retain their normal update behavior instead of being blocked forever.
  const fresh = { id: original.id, source: 'reddit', title: 'Latest provider title', content: 'Latest provider body', topic: 'Cybersecurity',
    sourceUrl: original.source_url, createdAt: new Date().toISOString() };
  assert.equal(await f.app.savePostsToDBFast([fresh], 'feed_posts_staging'), 1);
  const updated = await f.app.transferStagedPosts({ maxBatches: 1, reason: 'normal-provider-refresh' });
  assert.equal(updated.error, undefined); assert.equal(updated.transferred, 1);
  assert.equal((await f.pg.query("SELECT content FROM feed_posts_cache WHERE id='manual-race'")).rows[0].content, fresh.content);
  await f.app.flushSSEBatch();
  assert.deepEqual(frames.flatMap(frame => JSON.parse(frame.slice(6).trim()).posts.map(post => post.id)), ['manual-race']);
});
