const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeedRoutingFixture } = require('./test-support/feed-routing-fixture');

test('source author profiles survive actual single/bulk writes, promotion, archive and saved snapshots', async t => {
  const { pg, app } = await createFeedRoutingFixture(t);
  const channel = 'UCabcdefghijklmnopqrstuv';
  const expected = `https://www.youtube.com/channel/${channel}`;
  const [post] = app.parseYouTubeChannelRSS(`<feed><yt:channelId>${channel}</yt:channelId><entry><yt:videoId>abcdefghijk</yt:videoId><title>A useful science update</title><published>${new Date().toISOString()}</published><author><name>Creator display name</name></author></entry></feed>`, 'science', 'Fallback name');
  assert.equal(post.author.profileUrl, expected);
  assert.equal(post.author.channelId, channel);
  assert.equal(post.authorId, `youtube_channel_${channel}`);
  assert.equal(post.author.id, post.authorId);
  const [renamed] = app.parseYouTubeChannelRSS(`<feed><yt:channelId>${channel}</yt:channelId><entry><yt:videoId>abcdefghijk</yt:videoId><title>A useful science update</title><published>${new Date().toISOString()}</published><author><name>Renamed creator</name></author></entry></feed>`, 'science', 'Fallback name');
  assert.equal(renamed.author.id, post.author.id, 'A changed display name must not change the provider channel identity used for Snap profiles');
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
  assert.equal(app.buildSavedPostSnapshot({ ...post, author: { name: 'Unknown', profileUrl: 'javascript:alert(1)' } }).author.profileUrl, expected, 'A safe known channel identity replaces an unsafe supplied link');
  assert.equal(app.buildSavedPostSnapshot({ ...post, authorId: 'youtube_unknown', author: { name: 'Unknown', profileUrl: 'javascript:alert(1)' } }).author.profileUrl, '', 'Unsafe profile links remain rejected when there is no genuine channel identity');
});
