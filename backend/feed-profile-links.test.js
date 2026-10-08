const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { REPORT_SCHEMA } = require('./content-reports');
const { createAppHarness } = require('./test-support/app-harness');

test('source author profiles survive actual single/bulk writes, promotion, archive and saved snapshots', async t => {
  const pg = new PGlite();
  const entry = fs.readFileSync(require.resolve('./index'), 'utf8');
  const tables = new Set(['feed_posts_cache', 'feed_posts_staging', 'feed_posts_archive']);
  const migration = entry.slice(entry.indexOf('async function migrateDB()'), entry.indexOf('// --- Save external posts'));
  for (const match of migration.matchAll(/await db\.query\(`([\s\S]*?)`\)/g)) {
    const sql = match[1].trim();
    const table = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql)?.[1] || /^ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS/.exec(sql)?.[1];
    if (tables.has(table)) await pg.exec(sql);
  }
  // Feed writes and promotion check the durable moderation table in production.
  for (const sql of REPORT_SCHEMA.filter(sql => sql.includes('report_content_suppressions'))) await pg.exec(sql);
  const app = await createAppHarness({ connected: true, query: async (sql, params) => {
    // Unrelated startup statistics/transfer logging are outside these fixture tables.
    if (/feed_posts_(?:cache|staging|archive)|report_content_suppressions/.test(sql) || ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return pg.query(sql, params);
    return { rows: [], rowCount: 0 };
  } });
  t.after(async () => { await app.close(); await pg.close(); });
  const channel = 'UCabcdefghijklmnopqrstuv';
  const expected = `https://www.youtube.com/channel/${channel}`;
  const [post] = app.parseYouTubeChannelRSS(`<feed><yt:channelId>${channel}</yt:channelId><entry><yt:videoId>abcdefghijk</yt:videoId><title>A useful science update</title><published>${new Date().toISOString()}</published><author><name>Creator display name</name></author></entry></feed>`, 'science', 'Fallback name');
  assert.equal(post.author.profileUrl, expected);
  assert.equal(await app.savePostsToDB([post], 'feed_posts_staging'), 1);
  let row = (await pg.query('SELECT * FROM feed_posts_staging WHERE id=$1', [post.id])).rows[0];
  assert.equal(app.dbRowToFeedPost(row).author.profileUrl, expected);
  await app.transferStagedPosts({ maxBatches: 1, reason: 'profile-link-test' });
  assert.equal((await pg.query('SELECT count(*)::int AS count FROM feed_posts_staging')).rows[0].count, 0);
  row = (await pg.query('SELECT * FROM feed_posts_cache WHERE id=$1', [post.id])).rows[0];
  assert.ok(row, app.errors.join('\n'));
  assert.equal(app.dbRowToFeedPost(row).author.profileUrl, expected);
  const restored = app.dbRowToFeedPost(row);
  assert.equal(app.buildSavedPostSnapshot(restored).author.profileUrl, expected);
  // Refreshes from older collectors must not discard a known source profile.
  const missing = { ...post, author: { name: post.author.name } };
  await app.savePostsToDBFast([missing], 'feed_posts_cache', app.db, { skipTrim: true });
  assert.equal((await pg.query('SELECT author_profile_url FROM feed_posts_cache WHERE id=$1', [post.id])).rows[0].author_profile_url, expected);
  const updated = { ...post, author: { ...post.author, profileUrl: 'https://www.youtube.com/@verifiedCreator' } };
  await app.savePostsToDBFast([updated], 'feed_posts_cache', app.db, { skipTrim: true });
  await pg.exec(`INSERT INTO feed_posts_archive (${app.ARCHIVE_COLUMNS}) SELECT ${app.ARCHIVE_COLUMNS} FROM feed_posts_cache`);
  row = (await pg.query('SELECT * FROM feed_posts_archive WHERE id=$1', [post.id])).rows[0];
  assert.equal(app.dbRowToFeedPost(row).author.profileUrl, updated.author.profileUrl);
  assert.equal(app.dbRowToFeedPost({ ...row, author_profile_url: 'javascript:alert(1)' }).author.profileUrl, undefined);
  assert.equal(app.buildSavedPostSnapshot({ ...post, author: { name: 'Unknown', profileUrl: 'javascript:alert(1)' } }).author.profileUrl, '');
});
