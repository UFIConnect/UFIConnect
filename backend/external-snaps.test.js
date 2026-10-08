'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { externalSnapsFromPosts, createExternalSnapLoader, CLIP_LOOKBACK_MS } = require('./external-snaps');
const now = Date.parse('2026-10-08T12:00:00Z');
function clip(id, source = 'mastodon', extra = {}) {
  return { id, source, title: 'A short update from a followed creator', content: 'A source video about a community project.', mediaType: 'video', mediaUrl: 'https://files.mastodon.social/video.mp4',
    mediaPoster: 'https://files.mastodon.social/poster.jpg', videoDurationSeconds: 30,
    sourceUrl: source === 'mastodon' ? `https://mastodon.social/@creator/${id.replace(/\D/g, '') || '123'}`
      : source === 'twitter' ? 'https://x.com/creator/status/123' : source === 'twitch' ? 'https://clips.twitch.tv/RealClip-Ab12' : 'https://www.youtube.com/watch?v=abcdefghijk',
    createdAt: new Date(now - 60000).toISOString(), isExternal: true,
    author: { name: 'Source creator', profileUrl: 'https://mastodon.social/@creator' }, ...extra };
}

test('source clips retain attribution, use trusted length, reject thumbnails and long/expired/future media', () => {
  const posts = [clip('1'), clip('2', 'twitter'), clip('short', 'youtube', { videoDurationSeconds: null, sourceUrl: 'https://www.youtube.com/shorts/abcdefghijk', mediaUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' }),
    clip('photo', 'mastodon', { mediaType: 'image' }), clip('long', 'mastodon', { videoDurationSeconds: 181 }),
    clip('unknown', 'mastodon', { videoDurationSeconds: null }), clip('expired', 'mastodon', { createdAt: new Date(now - CLIP_LOOKBACK_MS).toISOString() }),
    clip('future', 'mastodon', { createdAt: new Date(now + 1).toISOString() }), clip('bad-date', 'mastodon', { createdAt: null }),
    clip('unsafe', 'mastodon', { mediaUrl: 'javascript:alert(1)' }), clip('impersonation', 'twitter', { sourceUrl: 'https://x.com.evil.example/creator/status/123' })];
  const snaps = externalSnapsFromPosts(posts, { now });
  assert.deepEqual(snaps.map(item => item.id), ['1', '2', 'short']);
  assert.equal(snaps[0].sourceUrl, posts[0].sourceUrl); assert.equal(snaps[0].author.name, 'Source creator');
  assert.equal(snaps[0].mediaKind, 'source'); assert.equal(snaps[0].directPlaybackAuthorized, false);
  assert.equal(snaps[0].owned, false); assert.equal(snaps[0].isExternal, true);
  assert.equal(Date.parse(snaps[0].expiresAt) - Date.parse(snaps[0].createdAt), CLIP_LOOKBACK_MS);
  assert.equal(snaps[2].mediaKind, 'youtube'); assert.equal(snaps[2].embedId, 'abcdefghijk');
  assert.equal(snaps[2].mediaUrl, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(externalSnapsFromPosts([clip('1')], { now, env: { SOURCE_MASTODON_ENABLED: 'false' } }).length, 0);
});

test('public Home and authorized Following keep their audiences separate and respect disabled sources', () => {
  const privateClip = clip('private', 'twitter', { visibility: 'followers' });
  const interest = clip('interest', 'twitter', { matchedByInterest: true });
  assert.equal(externalSnapsFromPosts([privateClip], { now }).length, 0);
  assert.equal(externalSnapsFromPosts([privateClip], { now, mode: 'following' }).length, 1);
  assert.equal(externalSnapsFromPosts([interest], { now, mode: 'following' }).length, 0);
  assert.equal(externalSnapsFromPosts([clip('1')], { now, disabledSources: ['mastodon'] }).length, 0);
  assert.equal(externalSnapsFromPosts([clip('1', 'instagram')], { now }).length, 0);
  assert.equal(externalSnapsFromPosts([clip('ufi', 'uficonnect')], { now }).length, 0);
});

test('Twitch clips use canonical source playback and only the current member\'s followed channels in Following', async () => {
  const { clipPost } = require('./twitch-feed');
  const post = clipPost({ id: 'RealClip-Ab12', broadcaster_id: '101', broadcaster_name: 'Creator',
    title: 'Recent clip', url: 'https://clips.twitch.tv/RealClip-Ab12',
    thumbnail_url: 'https://clips-media-assets2.twitch.tv/preview.jpg',
    created_at: new Date(now - 60000).toISOString(), duration: 180 }, { id: '101', login: 'creator' }, now);
  let publicReads = 0;
  const followingReads = [];
  const load = createExternalSnapLoader({ now: () => now, env: {}, getUser: async id => id === 'member' ? { roleSettings: {} } : null,
    getPublicPosts: async () => { publicReads++; return { posts: [post] }; },
    getFollowingPosts: async (...args) => { followingReads.push(args); return { posts: [post] }; } });
  const publicClips = await load({ mode: 'home', source: 'twitch' });
  assert.equal(publicClips.snaps[0].sourceUrl, post.sourceUrl);
  assert.equal(publicClips.snaps[0].author.profileUrl, 'https://www.twitch.tv/creator');
  assert.equal(publicClips.snaps[0].mediaKind, 'source');
  assert.equal(publicClips.snaps[0].directPlaybackAuthorized, false);
  assert.equal(publicClips.snaps[0].videoDurationSeconds, 180);
  const following = await load({ mode: 'following', viewerId: 'member', source: 'twitch', bust: true });
  assert.deepEqual(following.snaps, publicClips.snaps);
  assert.deepEqual(followingReads, [['member', ['twitch'], { bust: true, surface: null }]]);
  assert.deepEqual(await load({ mode: 'following', viewerId: 'missing', source: 'twitch' }), { snaps: [], sourceErrors: {} });
  assert.equal(followingReads.length, 1); assert.equal(publicReads, 1);
});

test('bounded source round robin retains quiet providers and removes duplicate clips', () => {
  const posts = Array.from({ length: 60 }, (_, index) => clip(String(index + 1)));
  posts.push(clip('quiet', 'twitter'), clip('quiet', 'twitter'));
  const snaps = externalSnapsFromPosts(posts, { now });
  assert.equal(snaps.length, 17); assert.equal(snaps[1].source, 'twitter');
});

test('loader has no public fallback for Following, does not force paid cache busts, and preserves partial errors/removals', async () => {
  let publicReads = 0, followingReads = 0;
  const load = createExternalSnapLoader({ now: () => now, env: {},
    getUser: async id => id === 'member' ? { roleSettings: { disabledSources: ['twitter'] } } : null,
    getPublicPosts: async () => { publicReads++; return { posts: [clip('public')], sourceErrors: {} }; },
    getFollowingPosts: async (id, sources, options) => {
      followingReads++; assert.equal(id, 'member'); assert.equal(sources.includes('twitter'), false);
      assert.deepEqual(options, { bust: false, surface: null });
      return { posts: [clip('removed'), clip('followed')], sourceErrors: { youtube: 'Reconnect YouTube.' } };
    }, filterVisible: async posts => posts.filter(post => post.id !== 'removed') });
  assert.deepEqual(await load({ mode: 'following' }), { snaps: [], sourceErrors: {} });
  assert.deepEqual(await load({ mode: 'following', viewerId: 'missing' }), { snaps: [], sourceErrors: {} });
  assert.deepEqual(await load({ mode: 'ufi', viewerId: 'member' }), { snaps: [], sourceErrors: {} });
  assert.equal(publicReads, 0); assert.equal(followingReads, 0);
  const following = await load({ mode: 'following', viewerId: 'member', bust: true });
  assert.deepEqual(following.snaps.map(snap => snap.id), ['followed']);
  assert.deepEqual(following.sourceErrors, { youtube: 'Reconnect YouTube.' });
  assert.equal(publicReads, 0);
  assert.equal((await load({ mode: 'home' })).snaps[0].id, 'public'); assert.equal(publicReads, 1);
});

test('explicit source refresh calls only its provider and bypasses only its cache', async () => {
  const followingCalls = [], publicCalls = [];
  const load = createExternalSnapLoader({ now: () => now, env: {},
    getUser: async () => ({ roleSettings: { disabledSources: ['twitter'] } }),
    getPublicPosts: async options => { publicCalls.push(options); return { posts: [clip('masto'), clip('other', 'twitter')] }; },
    getFollowingPosts: async (...args) => { followingCalls.push(args); return { posts: [clip('followed'), clip('other', 'twitter')] }; },
  });
  const following = await load({ mode: 'following', viewerId: 'member', source: 'mastodon', bust: true });
  assert.deepEqual(followingCalls, [['member', ['mastodon'], { bust: true, surface: null }]]);
  assert.deepEqual(following.snaps.map(snap => snap.id), ['followed']); assert.equal(publicCalls.length, 0);
  assert.deepEqual(await load({ mode: 'following', viewerId: 'member', source: 'twitter', bust: true }), { snaps: [], sourceErrors: {} });
  assert.equal(followingCalls.length, 1);
  assert.deepEqual(await load({ mode: 'home', viewerId: 'member', source: 'uficonnect', bust: true }), { snaps: [], sourceErrors: {} });
  assert.equal(publicCalls.length, 0);
  assert.deepEqual((await load({ mode: 'home', source: 'mastodon', bust: true })).snaps.map(snap => snap.id), ['masto']);
  assert.deepEqual(publicCalls, [{ source: 'mastodon', bust: true }]);
});

test('official source player links cannot accept arbitrary iframe hosts or malformed input', async () => {
  const { officialSnapEmbedUrl } = await import('../web/src/utils/snapSourcePlayer.mjs');
  assert.equal(officialSnapEmbedUrl({ source: 'mastodon', sourceUrl: 'https://mastodon.social/@creator/123' }), 'https://mastodon.social/@creator/123/embed');
  assert.equal(officialSnapEmbedUrl({ source: 'bluesky', sourceUrl: 'https://bsky.app/profile/person.bsky.social/post/3abc' }), 'https://embed.bsky.app/embed/person.bsky.social/app.bsky.feed.post/3abc?colorMode=dark');
  assert.match(officialSnapEmbedUrl({ source: 'reddit', sourceUrl: 'https://www.reddit.com/r/science/comments/abc/title/' }), /^https:\/\/www\.redditmedia\.com\/r\/science\/comments\/abc\/title\//);
  for (const sourceUrl of ['https://bsky.app.evil.example/profile/person.test/post/abc', 'https://bsky.app/profile/%E0%A4%A/post/abc', 'javascript:alert(1)', 'https://user:pass@bsky.app/profile/person.test/post/abc']) {
    assert.equal(officialSnapEmbedUrl({ source: 'bluesky', sourceUrl }), null);
  }
  for (const sourceUrl of ['https://localhost/@creator/123', 'https://127.0.0.1/@creator/123', 'https://mastodon.social/settings', 'http://mastodon.social/@creator/123']) assert.equal(officialSnapEmbedUrl({ source: 'mastodon', sourceUrl }), null);
});

test('real Snap route serves connected short clips only to their member and never adds them to public Home', async t => {
  const { createAppHarness, member } = require('./test-support/app-harness');
  const app = await createAppHarness(); t.after(() => app.close());
  app.seedUser(member('clip-reader', { socialTokens: { mastodon: 'member-token' } }));
  app.seedUser(member('other-reader'));
  app.setFollowingFetcher('mastodon', async token => {
    assert.equal(token, 'member-token');
    return [clip('authorized', 'mastodon', { createdAt: new Date().toISOString() }),
      clip('long', 'mastodon', { videoDurationSeconds: 500, createdAt: new Date().toISOString() })];
  });
  const response = await app.request('/snaps?mode=following', { userId: 'clip-reader' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(response.data.snaps.map(snap => snap.id), ['authorized']);
  assert.deepEqual((await app.request('/snaps?mode=home')).data.snaps, []);
  assert.deepEqual((await app.request('/snaps?mode=following', { userId: 'other-reader' })).data.snaps, []);
  assert.equal((await app.request('/snaps?mode=following')).status, 401);
});

test('bounded public clip query filters length before each source limit and enforces canonical Shorts and recency', async t => {
  const { PGlite } = require('@electric-sql/pglite');
  const { PUBLIC_CLIP_QUERY } = require('./external-snaps');
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`CREATE TABLE feed_posts_cache (
    id TEXT PRIMARY KEY, source TEXT NOT NULL, media_type TEXT,
    media_url TEXT, source_url TEXT, video_duration_seconds INTEGER,
    post_created_at TIMESTAMPTZ NOT NULL)`);
  const sources = ['mastodon', 'reddit', 'youtube', 'twitch'];
  for (const source of sources) {
    await db.query(`INSERT INTO feed_posts_cache
      SELECT $1 || '_long_' || n, $1, 'video', 'https://media.invalid/long.mp4',
        'https://www.youtube.com/watch?v=abcdefghijk', 181,
        $2::timestamptz - n * INTERVAL '1 second' FROM generate_series(1,45) AS n`, [source, new Date(now).toISOString()]);
    await db.query(`INSERT INTO feed_posts_cache
      SELECT $1 || '_unknown_' || n, $1, 'video', 'https://media.invalid/unknown.mp4',
        'https://www.youtube.com/watch?v=abcdefghijk', NULL,
        $2::timestamptz - n * INTERVAL '1 second' FROM generate_series(1,45) AS n`, [source, new Date(now).toISOString()]);
  }
  async function insert(id, source, duration, createdAt = now - 2 * 3600000, sourceUrl = 'https://www.youtube.com/watch?v=abcdefghijk', mediaType = 'video') {
    await db.query(`INSERT INTO feed_posts_cache VALUES($1,$2,$3,'https://media.invalid/clip.mp4',$4,$5,$6)`,
      [id, source, mediaType, sourceUrl, duration, new Date(createdAt).toISOString()]);
  }
  for (const source of sources) {
    await insert(`${source}_valid`, source, 30);
    await insert(`${source}_exact_three_minutes`, source, 180);
    await insert(`${source}_zero`, source, 0);
    await insert(`${source}_negative`, source, -1);
    await insert(`${source}_expired_exact`, source, 30, now - CLIP_LOOKBACK_MS);
    await insert(`${source}_expired_older`, source, 30, now - CLIP_LOOKBACK_MS - 1);
    await insert(`${source}_future`, source, 30, now + 1);
    await insert(`${source}_photo`, source, 30, now - 60000, undefined, 'image');
  }
  await insert('youtube_short_unknown', 'youtube', null, undefined, 'https://www.youtube.com/shorts/abcdefghijk');
  await insert('youtube_short_zero', 'youtube', 0, undefined, 'https://m.youtube.com/shorts/abcdefghijk/?feature=share');
  await insert('youtube_short_over_limit', 'youtube', 181, undefined, 'https://www.youtube.com/shorts/abcdefghijk');
  await insert('youtube_bad_short_path', 'youtube', null, undefined, 'https://www.youtube.com/shorts/abcdefghijk/extra');
  await insert('youtube_bad_short_host', 'youtube', null, undefined, 'https://www.youtube.com.evil.invalid/shorts/abcdefghijk');
  await insert('unselected_valid', 'twitter', 30);
  const params = [sources, new Date(now - CLIP_LOOKBACK_MS).toISOString(), new Date(now).toISOString()];
  const { rows } = await db.query(PUBLIC_CLIP_QUERY, params);
  assert.deepEqual(new Set(rows.map(row => row.id)), new Set([
    ...sources.flatMap(source => [`${source}_valid`, `${source}_exact_three_minutes`]),
    'youtube_short_unknown', 'youtube_short_zero',
  ]), 'Newer long/unknown videos must not hide an eligible older clip or bypass duration and age rules');
  await db.query(`INSERT INTO feed_posts_cache
    SELECT 'mastodon_short_' || n, 'mastodon', 'video', 'https://media.invalid/clip.mp4',
      'https://mastodon.social/@creator/123', 30,
      $1::timestamptz - n * INTERVAL '1 second' FROM generate_series(1,60) AS n`, [new Date(now).toISOString()]);
  const bounded = await db.query(PUBLIC_CLIP_QUERY, params);
  assert.equal(bounded.rows.filter(row => row.source === 'mastodon').length, 40);
  assert.equal(bounded.rows.filter(row => row.source === 'reddit').length, 2, 'A busy source cannot consume another source’s bounded slots');
});
