'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SOURCE_CONTENT_MAX_CHARS, boundedSourceText, createImportedContentRecovery } = require('./source-post-content');
const { importedContentLimit, jobDescriptionText } = require('./job-content');
const { mastodonContentText } = require('./mastodon-content');
const { screenImportedFeedPost, localTextScreen } = require('./content-screening');
const paragraph = 'A source-authored paragraph explains the project and its practical effect on customers. ';
const content = `${paragraph.repeat(90).trim()}\n\nThe final section includes café, 東京 and 🧭. Reference: https://example.org/read?chapter=last&language=en`;
const post = (overrides = {}) => ({ id: 'source-full', source: 'news', sourceUrl: 'https://example.org/article', title: 'A complete source article',
  content, author: { id: 'publisher', name: 'Publisher', profileUrl: 'https://example.org/author' }, createdAt: '2026-10-10T12:00:00Z', isExternal: true, ...overrides });

test('the generous source ceiling preserves writing while native limits stay unchanged', () => {
  assert.equal(SOURCE_CONTENT_MAX_CHARS, 100000);
  assert.equal(importedContentLimit(post()), 100000);
  assert.equal(importedContentLimit({ source: 'uficonnect' }), 2000);
  assert.equal(importedContentLimit({ source: 'uficonnect', type: 'job' }), 60000);
  assert.equal(importedContentLimit({ source: 'news', isExternal: false }), 2000);
  assert.equal(screenImportedFeedPost(post()).post.content, content);
  assert.equal(localTextScreen(content, { maxLength: 2000 }).reason, 'too_long');
});

test('source HTML retains paragraphs and complete link destinations without executing markup', () => {
  const html = `<p>${paragraph.repeat(90)}</p><p>Final café 東京 🧭 <a href="https://example.org/full?x=1&amp;y=2">Complete document</a>.</p><script>forbidden()</script>`;
  for (const parse of [mastodonContentText, jobDescriptionText]) {
    const result = parse(html);
    assert.ok(result.length > 5000);
    assert.match(result, /\n\n?Final café 東京 🧭/);
    assert.match(result, /Complete document \(https:\/\/example.org\/full\?x=1&y=2\)/);
    assert.doesNotMatch(result, /forbidden|<script|<p>/);
  }
  assert.equal(mastodonContentText('<p>x &lt; y and 5 &gt; 2</p>'), 'x < y and 5 > 2');
});

test('100k clipping never invents a partial link or splits an emoji', () => {
  const start = paragraph.repeat(1200).slice(0, 99980);
  const clipped = boundedSourceText(start + ' https://example.org/' + 'long-path'.repeat(100));
  assert.ok(clipped.length <= 100000); assert.ok(clipped.endsWith('…'));
  assert.doesNotMatch(clipped, /https:\/\//);
  assert.equal(boundedSourceText('abc🧭tail', 5), 'abc…');
  const screened = screenImportedFeedPost(post({ content: paragraph.repeat(2000) }));
  assert.equal(screened.allowed, true); assert.ok(screened.post.content.length <= 100000);
});

test('long source articles can cite references while dense links and member link spam remain blocked', () => {
  const references = Array.from({ length: 7 }, (_, i) => `Reference ${i}: https://example.org/${i}`).join('\n');
  assert.equal(screenImportedFeedPost(post({ content: `${content}\n${references}` })).allowed, true);
  assert.equal(screenImportedFeedPost(post({ content: references })).reason, 'link_spam');
  assert.equal(localTextScreen(`${content}\n${references}`).reason, 'link_spam');
});

test('bounded recovery updates only fuller source text and preserves identity and metadata', () => {
  const recovery = createImportedContentRecovery({ maxEntries: 2 });
  const old = post({ content: content.slice(0, 1999) + '…', mediaUrl: 'https://example.org/old.mp4', likesCount: 12 });
  recovery.remember(old);
  assert.equal(recovery.take(post({ sourceUrl: 'https://different.test/post' })), null);
  assert.equal(recovery.take(post({ author: { name: 'Other author' } })), null);
  assert.equal(recovery.take(post({ content: 'Short preview' })), null);
  const result = recovery.take(post({ mediaUrl: 'https://example.org/replacement.mp4', likesCount: 200 }));
  const upgraded = result.post;
  assert.equal(upgraded.content, content); assert.equal(old.content, content.slice(0, 1999) + '…', 'Memory changes only after successful conditional persistence');
  assert.equal(upgraded.mediaUrl, 'https://example.org/old.mp4'); assert.equal(upgraded.likesCount, 12);
  assert.equal(recovery.take(post({ content: content + ' More' })), null, 'One repair per remembered historical item');
  for (let n = 0; n < 4; n++) recovery.remember(post({ id: `p${n}`, content: 'Short source preview' }));
  assert.equal(recovery.size, 2); assert.equal(recovery.take(post({ id: 'p0' })), null);
  recovery.remember(post({ id: 'native', source: 'uficonnect', content: 'Native writing' }));
  assert.equal(recovery.take(post({ id: 'native', source: 'uficonnect' })), null);
});

test('actual RSS/YouTube normalization and both database paths retain long text, links and Unicode', async () => {
  const { createAppHarness } = require('./test-support/app-harness');
  const app = await createAppHarness({ connected: true });
  try {
    const [item] = app.parseRSSItems(`<rss><channel><item><title>Article</title><link>https://example.org/article</link><description>Only a teaser</description><content:encoded><![CDATA[<p>${paragraph.repeat(90)}</p><p>Final 東京 🧭 <a href="https://example.org/reference">Read reference</a></p>]]></content:encoded></item></channel></rss>`);
    const imported = app.rssPost(item, 'news', 'News', 'ext_news', 'News', 'News', 'Topic');
    assert.ok(imported.content.length > 5000); assert.match(imported.content, /Final 東京 🧭 Read reference \(https:\/\/example.org\/reference\)/);
    const [youtube] = app.parseYouTubeChannelRSS(`<feed><entry><yt:videoId>abcdefghijk</yt:videoId><title>A video</title><published>2026-10-10T12:00:00Z</published><media:description>${content}</media:description></entry></feed>`, 'Channel', 'Topic');
    assert.equal(youtube.content, content);
    assert.equal(app.stripAndDecodeHTML('<p>First paragraph.</p><p>Second <a href="https://example.org">link</a>.</p>'), 'First paragraph.\n\nSecond link (https://example.org/).');
    assert.match(app.decodeAndStripHTML('&lt;p&gt;x &amp;lt; y and 5 &amp;gt; 2&lt;/p&gt;'), /x < y and 5 > 2/);
    const normalized = app.normalizeFeedPost(app.trimPostContent(post()));
    assert.equal(normalized.content, content);
    await app.savePostsToDB([normalized]);
    const rowWrite = app.queries.find(q => /INSERT INTO feed_posts_cache\s+\(/.test(q.sql));
    assert.equal(rowWrite.params[4], content);
    await app.savePostsToDBFast([normalized], 'feed_posts_cache', app.db, { skipTrim: true });
    const batch = app.queries.find(q => q.sql.includes('jsonb_to_recordset'));
    assert.equal(JSON.parse(batch.params[0])[0].content, content);
    const muchLonger = content.repeat(4);
    assert.equal(app.buildSavedPostSnapshot(post({ content: muchLonger })).content, muchLonger);
    assert.equal(app.dbRowToFeedPost({ id: 'saved', source: 'news', content, source_url: post().sourceUrl }).content, content);
    assert.equal(app.buildSavedPostSnapshot(post({ source: 'uficonnect', content: 'native '.repeat(1800) })).content.length, 12000);
  } finally { await app.close(); }
});

test('seen posts recover through the real equalizer without duplicate broadcast or shorter overwrite', async () => {
  const { createAppHarness } = require('./test-support/app-harness');
  const app = await createAppHarness({ connected: true, query: async (sql, params) => ({ rows: sql.includes('SET content = candidate.content') ? JSON.parse(params[0]).map(row => ({ id: row.id })) : [], rowCount: 0 }) });
  try {
    const old = post({ content: content.slice(0, 1999) + '…' });
    app.globalFeedCache.posts.push(old); app.addSeenId(old.id, old);
    const count = app.globalFeedCache.posts.length;
    app.pushToEqualizer('news', [post()]);
    assert.equal(app.sourceContentRecoveryQueue.size, 1);
    await app.sourceContentRecoveryQueue.flush();
    assert.equal(old.content, content); assert.equal(app.globalFeedCache.posts.length, count);
    assert.equal(app.ingestPersistenceQueues.size, 0, 'Recovery bypasses full-row persistence');
    assert.equal(app.addAndBroadcast([post({ content: 'Short source preview' })]), 0);
    assert.equal(old.content, content); assert.equal(app.sourceContentRecoveryQueue.size, 0);
    const blocked = post({ id: 'blocked', content: 'Short source preview' }); app.addSeenId(blocked.id, blocked);
    assert.equal(app.refreshImportedPostBody(post({ id: 'blocked', screeningStatus: 'blocked' })), false);
    assert.equal(blocked.content, 'Short source preview');
  } finally { await app.close(); }
});

test('legacy job recovery is bounded by both entries and retained text', () => {
  const recovery = createImportedContentRecovery({ maxEntries: 5, maxTextChars: 70000 });
  const old = post({ id: 'legacy-job', source: 'remotive', content: paragraph.repeat(800).slice(0, 60000) });
  recovery.remember(old);
  const repaired = recovery.take({ ...old, content: paragraph.repeat(950) });
  assert.ok(repaired.post.content.length > 60000);
  recovery.remember(old); recovery.remember({ ...old, id: 'second-job' });
  assert.equal(recovery.size, 1); assert.ok(recovery.textChars <= 70000);
});

test('real PostgreSQL recovery changes only body, protects concurrent edits, suppression and identity, and permits normal shorter edits', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const { createSourceContentRecoveryQueue } = require('./source-content-recovery');
  const { createAppHarness } = require('./test-support/app-harness');
  const { OFFICE_TOPIC_SCHEMA } = require('./office-topic-transfer');
  const { createTopicRoutingAgents } = require('./topic-routing-agents');
  const pg = new PGlite();
  const columns = `id TEXT PRIMARY KEY, source TEXT, group_id TEXT, title TEXT, content TEXT, author_name TEXT,
    source_url TEXT, media_url TEXT, media_type TEXT, video_duration_seconds INTEGER, topic TEXT, likes_count INTEGER,
    comments_count INTEGER, post_created_at TIMESTAMPTZ, location TEXT, media_poster TEXT, author_avatar_url TEXT,
    author_profile_url TEXT, fetched_at TIMESTAMPTZ DEFAULT NOW()`;
  await pg.exec(`CREATE TABLE feed_posts_cache (${columns}); CREATE TABLE feed_posts_staging (${columns});
    CREATE TABLE report_content_suppressions (target_type TEXT, target_id TEXT, source TEXT, source_url TEXT);`);
  let connected = true;
  const db = { isConnected: () => connected, query: async (sql, params) => {
    const result = await pg.query(sql, params); return { ...result, rowCount: result.affectedRows };
  } };
  for (const sql of OFFICE_TOPIC_SCHEMA) await pg.exec(sql);
  await createTopicRoutingAgents({ db, topics: [] }).initialize();
  const queue = createSourceContentRecoveryQueue({ db, tables: ['feed_posts_cache', 'feed_posts_staging'], schedule: () => ({}) });
  const oldBody = content.slice(0, 1999) + '…';
  const seed = async id => {
    for (const table of ['feed_posts_cache', 'feed_posts_staging']) await pg.query(`INSERT INTO ${table}
      (id,source,source_url,content,author_name,author_profile_url,media_url,likes_count,comments_count,fetched_at)
      VALUES ($1,'news',$2,$3,'Publisher',$4,'https://example.org/newer.mp4',91,23,'2026-10-10T00:00:00Z')`,
      [id, post().sourceUrl, oldBody, post().author.profileUrl]);
    const cachedPost = post({ id, content: oldBody });
    queue.enqueue({ post: post({ id }), previousContent: oldBody, cachedPost }, cachedPost.author.profileUrl);
    return cachedPost;
  };
  let app;
  try {
    const cached = await seed('repair'); connected = false; await queue.flush();
    assert.equal(queue.size, 1); assert.equal(cached.content, oldBody, 'Failed persistence does not change visible memory');
    connected = true; await queue.flush();
    assert.equal(cached.content, content);
    for (const table of ['feed_posts_cache', 'feed_posts_staging']) {
      const row = (await pg.query(`SELECT * FROM ${table} WHERE id='repair'`)).rows[0];
      assert.equal(row.content, content); assert.equal(row.likes_count, 91); assert.equal(row.comments_count, 23);
      assert.equal(row.media_url, 'https://example.org/newer.mp4'); assert.equal(row.author_name, 'Publisher');
      assert.equal(new Date(row.fetched_at).toISOString(), '2026-10-10T00:00:00.000Z');
    }
    await seed('edited'); await pg.exec("UPDATE feed_posts_cache SET content='Provider edited this to shorter text.' WHERE id='edited'; UPDATE feed_posts_staging SET content='Provider edited this to shorter text.' WHERE id='edited';");
    await seed('identity'); await pg.exec("UPDATE feed_posts_cache SET author_name='New identity' WHERE id='identity'; UPDATE feed_posts_staging SET author_name='New identity' WHERE id='identity';");
    await seed('suppressed'); await pg.exec("INSERT INTO report_content_suppressions(target_type,target_id) VALUES('post','suppressed')");
    await queue.flush();
    assert.equal((await pg.query("SELECT content FROM feed_posts_cache WHERE id='edited'")).rows[0].content, 'Provider edited this to shorter text.');
    for (const id of ['identity', 'suppressed']) assert.equal((await pg.query('SELECT content FROM feed_posts_cache WHERE id=$1', [id])).rows[0].content, oldBody);
    app = await createAppHarness({ connected: true, query: db.query });
    await pg.query(`INSERT INTO feed_posts_cache (id,source,source_url,content,author_name,author_profile_url)
      VALUES ('nullable-profile','github','https://github.com/source-author/project',$1,'Publisher',NULL)`, [oldBody]);
    const nullable = app.dbRowToFeedPost((await pg.query("SELECT * FROM feed_posts_cache WHERE id='nullable-profile'")).rows[0]);
    app.addSeenId(nullable.id, nullable);
    assert.equal(app.refreshImportedPostBody({ ...nullable, content, author: { ...nullable.author, profileUrl: 'https://github.com/source-author' } }), true);
    await app.sourceContentRecoveryQueue.flush();
    const nullableRow = (await pg.query("SELECT content,author_profile_url FROM feed_posts_cache WHERE id='nullable-profile'")).rows[0];
    assert.equal(nullableRow.content, content); assert.equal(nullableRow.author_profile_url, null, 'Legacy unknown identity remains unchanged');
    await app.savePostsToDBFast([post({ id: 'repair', content: 'A legitimate shorter provider revision.' })], 'feed_posts_cache', app.db, { skipTrim: true });
    assert.equal((await pg.query("SELECT content FROM feed_posts_cache WHERE id='repair'")).rows[0].content, 'A legitimate shorter provider revision.');
    for (let i = 0; i < 200; i++) queue.enqueue({ post: post({ id: `limit-${i}`, content: 'a'.repeat(100000) }), previousContent: oldBody, cachedPost: post() }, post().author.profileUrl);
    assert.ok(queue.size <= 100); assert.ok(queue.textChars <= 2000000);
  } finally { if (app) await app.close(); await pg.close(); }
});
