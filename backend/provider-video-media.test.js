const test = require('node:test');
const assert = require('node:assert/strict');
const { mastodonMedia, blueskyMedia } = require('./provider-video-media');
const { normalizePostMedia } = require('./post-media');
const { isPlayableVideoPost, isVideoSurfacePost } = require('./video-placement');

const file = 'https://files.mastodon.social/media_attachments/files/123/original/clip.mp4';
const playlist = 'https://video.bsky.app/watch/did%3Aplc%3Acreator/bafysynthetic/playlist.m3u8?quality=high#video';
const poster = 'https://video.bsky.app/watch/did%3Aplc%3Acreator/bafysynthetic/thumbnail.jpg';
const bskySource = 'https://bsky.app/profile/creator.bsky.social/post/3ltestvideo';

test('Mastodon selects a real video attachment after an image and preserves poster, duration and remote fallback', () => {
  const result = mastodonMedia([
    { type: 'image', url: 'https://files.mastodon.social/photo.jpg' },
    { type: 'video', url: null, remote_url: file, preview_url: 'https://files.mastodon.social/preview.png', meta: { duration: 44.9 } },
  ]);
  assert.deepEqual(result, { mediaType: 'video', mediaUrl: file, mediaPoster: 'https://files.mastodon.social/preview.png', videoDurationSeconds: 44 });
  assert.equal(mastodonMedia({ type: 'gifv', url: file, meta: { original: { duration: 8.8 } } }).videoPresentation, 'gif');
});

test('Mastodon rejects unsafe attachments and never substitutes a preview for an unfinished video', () => {
  const result = mastodonMedia({ type: 'video', url: 'https://name:secret@cdn.example/clip.mp4', remote_url: 'http://cdn.example/clip.mp4', preview_url: 'https://cdn.example/preview.jpg' });
  assert.equal(result.mediaType, 'video'); assert.equal(result.mediaUrl, null);
  assert.equal(result.mediaPoster, 'https://cdn.example/preview.jpg');
  assert.equal(mastodonMedia({ type: 'video', url: 'https://127.0.0.1/clip.mp4' }).mediaUrl, null);
});

test('Mastodon link cards retain the original official YouTube or Vimeo reference, not arbitrary embed HTML', () => {
  for (const url of ['https://youtu.be/abcdefghijk', 'https://vimeo.com/123456']) {
    assert.equal(mastodonMedia([], { url, image: 'https://cdn.example/poster.jpg' }).mediaUrl, url);
  }
  assert.equal(mastodonMedia([], { url: 'https://evil.example/youtube.com/watch?v=abcdefghijk', html: '<video src="https://cdn.example/clip.mp4">' }).mediaType, null);
});

test('Bluesky native video requires the supplied playlist, not the optional thumbnail', () => {
  const media = blueskyMedia({ embed: { $type: 'app.bsky.embed.video#view', cid: 'bafysynthetic', playlist } });
  assert.deepEqual(media, { mediaType: 'video', mediaUrl: playlist, mediaPoster: null });
  assert.equal(isPlayableVideoPost({ ...media, source: 'bluesky', sourceUrl: bskySource }), true);
  const missing = blueskyMedia({ embed: { $type: 'app.bsky.embed.video#view', thumbnail: poster } });
  assert.equal(missing.mediaUrl, null);
  assert.equal(isPlayableVideoPost({ ...missing, source: 'bluesky', sourceUrl: bskySource }), false);
});

test('Bluesky recordWithMedia resolves its own video while a quoted record alone is not promoted', () => {
  const video = { $type: 'app.bsky.embed.video#view', playlist, thumbnail: poster, presentation: 'gif' };
  assert.deepEqual(blueskyMedia({ embed: { $type: 'app.bsky.embed.recordWithMedia#view', record: { author: { handle: 'other.bsky.social' } }, media: video } }),
    { mediaType: 'video', mediaUrl: playlist, mediaPoster: poster, videoPresentation: 'gif' });
  assert.equal(blueskyMedia({ embed: { $type: 'app.bsky.embed.record#view', record: { embeds: [video] } } }).mediaType, null);
});

test('Bluesky external YouTube and Vimeo video cards stay playable despite a Bluesky source label', () => {
  for (const uri of ['https://www.youtube.com/shorts/abcdefghijk', 'https://player.vimeo.com/video/123456']) {
    const media = blueskyMedia({ embed: { $type: 'app.bsky.embed.external#view', external: { uri, thumb: poster } } });
    assert.equal(media.mediaUrl, uri);
    assert.equal(isPlayableVideoPost({ ...media, source: 'bluesky', sourceUrl: bskySource }), true);
  }
  assert.equal(blueskyMedia({ embed: { $type: 'app.bsky.embed.external#view', external: { uri: 'https://youtube.com.evil.example/watch?v=abcdefghijk' } } }).mediaType, null);
});

test('Bluesky images remain images and unsafe or processing-only video blobs never become playable URLs', () => {
  const image = { fullsize: 'https://cdn.bsky.app/full.jpg', thumb: 'https://cdn.bsky.app/thumb.jpg' };
  assert.equal(blueskyMedia({ embed: { $type: 'app.bsky.embed.images#view', images: [image] } }, { fullsize: true }).mediaUrl, image.fullsize);
  for (const candidate of ['javascript:alert(1)', 'https://localhost/private.m3u8', 'https://video.bsky.app/thumbnail.jpg']) {
    assert.equal(blueskyMedia({ embed: { $type: 'app.bsky.embed.video#view', playlist: candidate } }).mediaUrl, null);
  }
  assert.equal(blueskyMedia({ embed: { $type: 'app.bsky.embed.video', video: { ref: { $link: 'bafysynthetic' }, mimeType: 'video/mp4' } } }).mediaUrl, null);
});

test('legacy video cache classification recovers official source references but rejects fake hosts and bare IDs', () => {
  const youtube = normalizePostMedia({ source: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk', mediaType: 'image', mediaUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' });
  assert.equal(youtube.mediaType, 'video'); assert.equal(isVideoSurfacePost(youtube), true);
  assert.equal(isPlayableVideoPost({ source: 'youtube', mediaType: 'video', embedId: 'abcdefghijk' }), false);
  assert.equal(isPlayableVideoPost({ source: 'youtube', mediaType: 'video', sourceUrl: 'https://evil.example/youtube.com/watch?v=abcdefghijk' }), false);
  assert.notEqual(normalizePostMedia({ mediaUrl: 'https://youtube.com/channel/UCnotavideo' }).mediaType, 'video');
});

test('API media survives the real persistence mapper and resolves through the same frontend contract', async t => {
  const { createAppHarness } = require('./test-support/app-harness');
  const { resolveVideoSource } = await import('../web/src/utils/videoSource.mjs');
  const app = await createAppHarness({ connected: true }); t.after(() => app.close());
  const inputs = [
    { id: 'mastodon-real-video', source: 'mastodon', sourceUrl: 'https://mastodon.social/@creator/123', ...mastodonMedia({ type: 'video', url: file, meta: { duration: 45 } }) },
    { id: 'bluesky-real-video', source: 'bluesky', sourceUrl: bskySource, ...blueskyMedia({ embed: { $type: 'app.bsky.embed.video#view', playlist } }) },
  ].map(post => app.normalizeFeedPost({ ...post, title: 'A field science update', content: 'Observing the changing seasons.', isExternal: true }));
  await app.savePostsToDBFast(inputs, 'feed_posts_cache', app.db, { skipTrim: true });
  const write = app.queries.find(query => query.sql.includes('jsonb_to_recordset'));
  assert.ok(write, 'Media reached the actual database persistence mapper');
  const stored = JSON.parse(write.params[0]);
  for (const input of inputs) {
    const row = stored.find(item => item.id === input.id);
    assert.equal(row.media_url, input.mediaUrl); assert.equal(row.media_type, 'video');
    const restored = app.dbRowToFeedPost(row);
    assert.equal(isPlayableVideoPost(restored), true);
    assert.equal(resolveVideoSource(restored)?.kind, input.source === 'bluesky' ? 'hls' : 'file');
    assert.equal(restored.sourceUrl, input.sourceUrl, 'Playback keeps source credit identity');
  }
});

test('Mastodon authorized Following and own-content routes preserve actual video API attachments', async t => {
  const { createAppHarness, member } = require('./test-support/app-harness');
  const implementation = require('./mastodon-oauth');
  const calls = [];
  const post = { id: '123', url: 'https://social.example/@creator/123', visibility: 'public', created_at: new Date().toISOString(),
    content: '<p>A field science update</p>', account: { id: '42', username: 'creator', acct: 'creator', url: 'https://social.example/@creator' },
    media_attachments: [{ type: 'video', url: file, meta: { duration: 45 } }] };
  const app = await createAppHarness({ modules: { './mastodon-oauth': { ...implementation, createMastodonService: () => ({
    json: async (origin, path, options) => {
      assert.equal(origin, 'https://social.example'); assert.equal(options.token, 'synthetic-access'); calls.push(path); return [post];
    },
  }) } } }); t.after(() => app.close());
  const user = member('masto-video-reader', { plan: 'pro', socialTokens: { mastodon: JSON.stringify({ origin: 'https://social.example', accessToken: 'synthetic-access', accountId: '42', scope: 'read:statuses' }) } });
  app.seedUser(user);
  const following = await app.getFollowingFeedPosts(user.id, 'mastodon', { bust: true, surface: 'videos' });
  const own = await app.request('/command-center/your-content?platform=mastodon', { userId: user.id });
  assert.equal(own.status, 200);
  for (const posts of [following.posts, own.data.posts]) {
    assert.equal(posts.length, 1, JSON.stringify({ following, own: own.data, errors: app.errors }));
    assert.equal(posts[0].mediaUrl, file); assert.equal(posts[0].mediaType, 'video');
    assert.equal(posts[0].sourceUrl, post.url); assert.equal(isVideoSurfacePost(posts[0]), true);
  }
  assert.ok(calls.some(path => path.startsWith('/api/v1/timelines/home')));
  assert.ok(calls.some(path => path.startsWith('/api/v1/accounts/42/statuses')));
});

test('Bluesky authorized Following and own-content routes preserve thumbnail-free recordWithMedia videos', async t => {
  const { createAppHarness, member } = require('./test-support/app-harness');
  const { generateKeyPairSync } = require('node:crypto');
  const { EventEmitter } = require('node:events');
  const signingKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
  const calls = [];
  const post = { cid: 'bafysyntheticvideo', uri: 'at://did:plc:creator/app.bsky.feed.post/3ltestvideo',
    author: { did: 'did:plc:creator', handle: 'creator.bsky.social' }, record: { text: 'A field science update', createdAt: new Date().toISOString() },
    embed: { $type: 'app.bsky.embed.recordWithMedia#view', media: { $type: 'app.bsky.embed.video#view', cid: 'bafysynthetic', playlist } } };
  // This release retains the reviewed inline HTTPS transport. Stub its wire
  // boundary while exercising the real authorization headers and route mapper.
  const app = await createAppHarness({ env: { BLUESKY_SIGNING_KEY: JSON.stringify(signingKey) }, modules: { https: {
    ...require('node:https'),
    get: () => { throw new Error('Unexpected HTTPS GET in media fixture'); },
    request: (options, callback) => {
      assert.equal(options.hostname, 'pds.example'); assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'DPoP synthetic-access'); assert.ok(options.headers.DPoP);
      calls.push('https://' + options.hostname + options.path);
      const request = new EventEmitter();
      request.setTimeout = () => request;
      request.destroy = error => request.emit('error', error);
      request.end = () => queueMicrotask(() => {
        const response = new EventEmitter(); response.statusCode = 200; response.headers = {};
        callback(response); response.emit('data', JSON.stringify({ feed: [{ post }] })); response.emit('end');
      });
      return request;
    },
  } } }); t.after(() => app.close());
  const user = member('bsky-video-reader', { plan: 'pro', socialTokens: { bluesky: JSON.stringify({ accessToken: 'synthetic-access', did: 'did:plc:creator', pdsUrl: 'https://pds.example' }) } });
  app.seedUser(user);
  const following = await app.getFollowingFeedPosts(user.id, 'bluesky', { bust: true, surface: 'videos' });
  const own = await app.request('/command-center/your-content?platform=bluesky', { userId: user.id });
  assert.equal(own.status, 200);
  for (const posts of [following.posts, own.data.posts]) {
    assert.equal(posts.length, 1, JSON.stringify({ following, own: own.data, errors: app.errors }));
    assert.equal(posts[0].mediaUrl, playlist); assert.equal(posts[0].mediaType, 'video');
    assert.equal(posts[0].mediaPoster, null); assert.equal(posts[0].sourceUrl, bskySource);
    assert.equal(isVideoSurfacePost(posts[0]), true);
  }
  assert.ok(calls.some(url => url.includes('/app.bsky.feed.getTimeline?')));
  assert.ok(calls.some(url => url.includes('/app.bsky.feed.getAuthorFeed?')));
});
