'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeedRoutingFixture } = require('./test-support/feed-routing-fixture');

const post = (id, extra = {}) => ({ id, source: 'reddit', title: 'A Django tutorial using Python',
  content: 'Build a useful Django application with Python.', topic: null,
  sourceUrl: `https://example.org/articles/${id}`, createdAt: new Date().toISOString(), ...extra });
const assignments = async f => (await f.pg.query('SELECT * FROM office_feed_topic_assignments ORDER BY post_id')).rows;

test('single and bulk saves route actual persisted content and publish labels only after commit', async t => {
  const single = post('single'), bulk = post('bulk');
  let pending = single, commitChecks = 0;
  const f = await createFeedRoutingFixture(t, { beforeQuery: async sql => {
    if (sql === 'COMMIT') { assert.equal(pending.topic, null, 'Memory must not change before commit'); commitChecks++; }
  } });
  assert.equal(await f.app.savePostsToDB([single], 'feed_posts_staging'), 1);
  assert.equal(single.topic, 'Python'); assert.equal(single.subtopic, 'Web frameworks');
  pending = bulk;
  assert.equal(await f.app.savePostsToDBFast([bulk], 'feed_posts_staging'), 1);
  assert.equal(bulk.topic, 'Python'); assert.equal(bulk.subtopic, 'Web frameworks');
  assert.equal(commitChecks, 2);
  assert.deepEqual((await assignments(f)).map(row => [row.post_id, row.topic, row.subtopic]),
    [['bulk', 'Python', 'Web frameworks'], ['single', 'Python', 'Web frameworks']]);
});

test('unchanged bulk rows acquire missing routing without inflating the changed-post count', async t => {
  const f = await createFeedRoutingFixture(t), item = post('unchanged', { topic: 'Python' });
  assert.equal(await f.app.savePostsToDBFast([item], 'feed_posts_staging'), 1);
  await f.pg.query("DELETE FROM office_feed_topic_assignments WHERE post_id='unchanged'");
  assert.equal(await f.app.savePostsToDBFast([item], 'feed_posts_staging'), 0);
  assert.equal((await assignments(f))[0].subtopic, 'Web frameworks');
  const before = (await assignments(f))[0];
  assert.equal(await f.app.savePostsToDBFast([{ ...item, likesCount: 17 }], 'feed_posts_staging'), 1);
  const after = (await assignments(f))[0];
  assert.equal(String(after.checked_at), String(before.checked_at));
  assert.equal(String(after.retry_at), String(before.retry_at));
});

test('routing failure and commit failure roll back feed rows, labels, counters and memory together', async t => {
  let failure = '';
  const f = await createFeedRoutingFixture(t, { beforeQuery: async sql => {
    if (failure === 'routing' && sql.includes('INSERT INTO office_feed_topic_assignments')) throw new Error('Routing storage failed');
    if (failure === 'commit' && sql === 'COMMIT') throw new Error('Commit failed');
  } });
  for (const mode of ['routing', 'commit']) {
    failure = mode;
    const single = post(`${mode}-single`), bulk = post(`${mode}-bulk`);
    assert.equal(await f.app.savePostsToDB([single], 'feed_posts_staging'), 0);
    await assert.rejects(f.app.savePostsToDBFast([bulk], 'feed_posts_staging'), /failed/i);
    assert.equal(single.topic, null); assert.equal(bulk.topic, null);
    assert.equal((await f.pg.query('SELECT COUNT(*)::int AS n FROM feed_posts_staging')).rows[0].n, 0);
    assert.equal((await assignments(f)).length, 0);
    assert.equal((await f.pg.query('SELECT SUM(checked)::int AS n FROM office_topic_agent_state')).rows[0].n, 0);
  }
});

test('promotion routes unclassified staging atomically and publishes nothing when commit fails', async t => {
  let failCommit = false;
  const f = await createFeedRoutingFixture(t, { beforeQuery: async sql => {
    if (failCommit && sql === 'COMMIT') throw new Error('Promotion commit failed');
  } });
  const item = post('promotion', { topic: 'Python' });
  await f.app.savePostsToDBFast([item], 'feed_posts_staging');
  await f.pg.query("UPDATE feed_posts_staging SET topic=NULL WHERE id='promotion'");
  await f.pg.query("DELETE FROM office_feed_topic_assignments WHERE post_id='promotion'");
  const memory = { ...item, topic: null }; f.app.globalFeedCache.posts.push(memory);
  const countersBefore = (await f.pg.query('SELECT SUM(checked)::int AS n FROM office_topic_agent_state')).rows[0].n;
  failCommit = true;
  const failed = await f.app.transferStagedPosts({ maxBatches: 1, reason: 'routing-test' });
  assert.ok(failed.error); assert.equal(failed.transferred, 0); assert.equal(memory.topic, null);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS n FROM feed_posts_staging')).rows[0].n, 1);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS n FROM feed_posts_cache')).rows[0].n, 0);
  assert.equal((await assignments(f)).length, 0);
  assert.equal((await f.pg.query('SELECT SUM(checked)::int AS n FROM office_topic_agent_state')).rows[0].n, countersBefore);
  failCommit = false;
  const result = await f.app.transferStagedPosts({ maxBatches: 1, reason: 'routing-test' });
  assert.equal(result.transferred, 1); assert.equal(result.drained, 1);
  assert.equal(memory.topic, 'Python'); assert.equal(memory.subtopic, 'Web frameworks');
  assert.equal((await f.pg.query('SELECT topic FROM feed_posts_cache')).rows[0].topic, 'Python');
  assert.equal((await assignments(f))[0].subtopic, 'Web frameworks');
});

test('routing cannot resurrect source-blocked or durably suppressed posts at save or promotion', async t => {
  const f = await createFeedRoutingFixture(t);
  const staged = post('blocked-staging'); await f.app.savePostsToDBFast([staged], 'feed_posts_staging');
  await f.audit.block('reddit', 'Confirmed source breach');
  assert.equal(await f.app.savePostsToDB([post('blocked-single')], 'feed_posts_staging'), 0);
  assert.equal(await f.app.savePostsToDBFast([post('blocked-bulk')], 'feed_posts_staging'), 0);
  const transfer = await f.app.transferStagedPosts({ maxBatches: 1, reason: 'blocked-test' });
  assert.equal(transfer.transferred, 0); assert.equal(transfer.drained, 1);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS n FROM feed_posts_cache')).rows[0].n, 0);
  await f.audit.unblock('reddit');
  await f.pg.query("INSERT INTO report_content_suppressions(target_type,target_id,kind) VALUES('post','suppressed','policy')");
  assert.equal(await f.app.savePostsToDB([post('suppressed')], 'feed_posts_staging'), 0);
  assert.equal(await f.app.savePostsToDBFast([post('suppressed')], 'feed_posts_staging'), 0);
  assert.equal((await assignments(f)).some(row => row.post_id === 'suppressed'), false);
});

test('promotion of an unchanged live copy counts no changed row and no screening rejection', async t => {
  const f = await createFeedRoutingFixture(t), item = post('existing-live', { topic: 'Python', createdAt: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString() });
  assert.equal(await f.app.savePostsToDBFast([item], 'feed_posts_cache', f.app.db, { skipTrim: true }), 1);
  assert.equal(await f.app.savePostsToDBFast([item], 'feed_posts_staging'), 1);
  const result = await f.app.transferStagedPosts({ maxBatches: 1, reason: 'unchanged-test' });
  assert.equal(result.transferred, 0); assert.equal(result.drained, 1); assert.equal(result.screenedOut, 0);
  assert.equal((await assignments(f))[0].subtopic, 'Web frameworks');
});
