const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { pruneUnusedPosts } = require('./unused-feed-cleanup');

test('cleanup deletes stale external copies, preserving all member-owned and referenced posts', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE community_posts (id TEXT); CREATE TABLE saved_posts (post_id TEXT);
    CREATE TABLE post_comments (post_id TEXT); CREATE TABLE restaurant_post_likes (post_id TEXT);
    CREATE TABLE job_tracking (job_id TEXT);
    INSERT INTO community_posts VALUES ('member-owned'); INSERT INTO saved_posts VALUES ('saved');
    INSERT INTO post_comments VALUES ('commented'); INSERT INTO restaurant_post_likes VALUES ('liked');
    INSERT INTO job_tracking VALUES ('tracked');`);
  for (const table of ['feed_posts_cache', 'feed_posts_archive', 'feed_posts_staging']) {
    await pg.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, source TEXT, fetched_at TIMESTAMPTZ,
      post_created_at TIMESTAMPTZ, archive_reason TEXT, archived_at TIMESTAMPTZ DEFAULT now());
      INSERT INTO ${table} (id, source, fetched_at, post_created_at)
      SELECT id, 'reddit', now() - interval '10 days', now() - interval '10 days'
      FROM unnest(ARRAY['expired','member-owned','saved','commented','liked','native','fresh','tombstone','tracked']) id;
      UPDATE ${table} SET source='uficonnect' WHERE id='native';
      UPDATE ${table} SET fetched_at=now(), post_created_at=now() WHERE id='fresh';
      UPDATE ${table} SET archive_reason='source-deleted' WHERE id='tombstone';`);
  }
  const result = await pruneUnusedPosts(pg, { batchSize: 1 });
  assert.equal(result.removed, 3);
  for (const table of ['feed_posts_cache', 'feed_posts_archive', 'feed_posts_staging']) {
    const rows = (await pg.query(`SELECT id FROM ${table}`)).rows.map(r => r.id);
    assert.ok(!rows.includes('expired'));
    for (const id of ['member-owned', 'saved', 'commented', 'liked', 'native', 'fresh', 'tombstone', 'tracked']) assert.ok(rows.includes(id), id);
  }
});
