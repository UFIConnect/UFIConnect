const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('source social videos cannot enter a native direct-file player by default', async () => {
  const { directMediaPlaybackAllowed } = await import('../web/src/utils/sourceMediaPolicy.mjs');
  for (const source of ['youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'bluesky', 'mastodon', 'reddit', 'vimeo', 'devto', 'twitch']) {
    assert.equal(directMediaPlaybackAllowed({ source, isExternal: true, mediaUrl: 'https://cdn.example/video.mp4' }), false);
    assert.equal(directMediaPlaybackAllowed({ source }), false);
  }
  assert.equal(directMediaPlaybackAllowed({}), false);
  assert.equal(directMediaPlaybackAllowed({ source: 'uficonnect' }), true);
  assert.equal(directMediaPlaybackAllowed({ source: 'livecamera', isExternal: false }), true);
  assert.equal(directMediaPlaybackAllowed({ source: 'licensed-provider', directPlaybackAuthorized: true }), true);
});

test('Twitch clip embeds use canonical provider links and the current parent hostname', async () => {
  const { officialTwitchClipId, officialTwitchClipUrl, officialTwitchClipEmbedUrl } = await import('../web/src/utils/sourceMediaPolicy.mjs');
  for (const value of ['https://clips.twitch.tv/RealClip-Ab12', 'https://www.twitch.tv/creator/clip/RealClip-Ab12?tt_content=clips']) {
    assert.equal(officialTwitchClipId(value), 'RealClip-Ab12');
    assert.equal(officialTwitchClipUrl(value), 'https://clips.twitch.tv/RealClip-Ab12');
    const embed = new URL(officialTwitchClipEmbedUrl(value, 'uficonnect.org'));
    assert.equal(embed.origin, 'https://clips.twitch.tv');
    assert.equal(embed.pathname, '/embed');
    assert.deepEqual(Object.fromEntries(embed.searchParams), { clip: 'RealClip-Ab12', parent: 'uficonnect.org', autoplay: 'false' });
  }
  for (const value of ['http://clips.twitch.tv/RealClip-Ab12', 'https://clips.twitch.tv.evil.example/RealClip-Ab12',
    'https://user:secret@clips.twitch.tv/RealClip-Ab12', 'https://clips.twitch.tv:8443/RealClip-Ab12',
    'https://clips.twitch.tv/embed?clip=RealClip-Ab12&parent=evil.example', 'https://clips.twitch.tv/create',
    'https://clips.twitch.tv/a/clip/RealClip-Ab12', 'https://clips.twitch.tv/RealClip%2FAb12',
    'https://www.twitch.tv/creator/videos/RealClip-Ab12', 'https://www.twitch.tv/creator', 'https://cdn.example/clip.mp4']) {
    assert.equal(officialTwitchClipId(value), null, value);
    assert.equal(officialTwitchClipEmbedUrl(value, 'uficonnect.org'), null, value);
  }
  for (const parent of ['https://uficonnect.org', 'uficonnect.org:443', 'uficonnect.org&autoplay=true', 'user@uficonnect.org', '.uficonnect.org', '', null]) {
    assert.equal(officialTwitchClipEmbedUrl('https://clips.twitch.tv/RealClip-Ab12', parent), null);
  }
  assert.equal(new URL(officialTwitchClipEmbedUrl('https://clips.twitch.tv/RealClip-Ab12', 'www.uficonnect.org')).searchParams.get('parent'), 'www.uficonnect.org');
  assert.equal(new URL(officialTwitchClipEmbedUrl('https://clips.twitch.tv/RealClip-Ab12', '127.0.0.1')).searchParams.get('parent'), '127.0.0.1');
});

test('Twitch clip posters reject untrusted hosts, insecure URLs and URL credentials', async () => {
  const { officialTwitchPosterUrl } = await import('../web/src/utils/sourceMediaPolicy.mjs');
  assert.equal(officialTwitchPosterUrl('https://clips-media-assets2.twitch.tv/clip-preview.jpg'), 'https://clips-media-assets2.twitch.tv/clip-preview.jpg');
  assert.equal(officialTwitchPosterUrl('https://static-cdn.jtvnw.net/clip-preview.jpg'), 'https://static-cdn.jtvnw.net/clip-preview.jpg');
  for (const value of ['http://static-cdn.jtvnw.net/poster.jpg', 'https://static-cdn.jtvnw.net.evil.example/poster.jpg',
    'https://name:secret@static-cdn.jtvnw.net/poster.jpg', 'https://evil.example/poster.jpg', 'data:image/png;base64,none']) {
    assert.equal(officialTwitchPosterUrl(value), null);
  }
});

test('player identity comes only from an official HTTPS source URL', async () => {
  const { officialYouTubeId, officialVimeoId } = await import('../web/src/utils/sourceMediaPolicy.mjs');
  assert.equal(officialYouTubeId('https://www.youtube.com/watch?v=abcdefghijk'), 'abcdefghijk');
  assert.equal(officialYouTubeId('https://youtu.be/abcdefghijk'), 'abcdefghijk');
  assert.equal(officialVimeoId('https://player.vimeo.com/video/1234'), '1234');
  for (const url of ['https://evil.example/youtube.com/watch?v=abcdefghijk', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'http://youtube.com/watch?v=abcdefghijk', 'https://name:secret@youtube.com/watch?v=abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk&v=otherid1234']) assert.equal(officialYouTubeId(url), null);
  assert.equal(officialVimeoId('https://evil.example/vimeo.com/1234'), null);
});

test('YouTube acquisition has no unofficial search fallback or copied video preference', () => {
  const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const acquisition = index.slice(index.indexOf('async function fetchYouTubeByKeyword'), index.indexOf('async function fetchYouTubeByKeyword') + 9000);
  assert.equal(/INVIDIOUS_INSTANCES|invidiousFetch|youtubeInvidious/.test(index), false);
  assert.equal(acquisition.includes('https://www.googleapis.com/youtube/v3/'), true);
  assert.equal(acquisition.includes('https://www.youtube.com/feeds/videos.xml'), true);
  assert.equal(index.includes('const mediaUrl = v.cloudinary_video_url ||'), false);
});

test('Reddit missing credentials or OAuth denial never invokes an anonymous fallback', async () => {
  const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const start = index.indexOf('async function fetchRedditSub(sub, keyword) {');
  const end = index.indexOf('\nasync function fetchRedditByKeyword(keyword)', start);
  const calls = [];
  let token = null;
  const context = { getRedditToken: async () => token, parseRedditJSON: () => [],
    fetchJSON: async (url, headers) => { calls.push({url, headers}); throw new Error('403 PROVIDER-SECRET'); },
    _redditToken: null, _redditTokenExpiry: 0 };
  const fetchSub = vm.runInNewContext(`${index.slice(start,end)}; fetchRedditSub`, context);
  assert.equal((await fetchSub('programming','test')).length, 0);
  assert.equal(calls.length, 0);
  token = 'authorized-token';
  await assert.rejects(fetchSub('programming','test'), error => /authorized Reddit API/.test(error.message) && !error.message.includes('SECRET'));
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).origin, 'https://oauth.reddit.com');
  assert.equal(calls[0].headers.Authorization, 'Bearer authorized-token');
  assert.equal(/fetchJSON\(`https:\/\/www\.reddit\.com\/comments/.test(index), false);
  assert.equal(/fetchText\(`https:\/\/www\.reddit\.com\/r\/\$\{sub\}\/new\.rss/.test(index), false);
});

test('common feed filtering removes a revoked source from cached results and preserves native posts', () => {
  const index = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const start = index.indexOf('function realFeedPosts(posts = []) {');
  const end = index.indexOf('// SSE batch buffer:', start);
  const env = {SOURCE_YOUTUBE_ENABLED:'false'};
  const filter = vm.runInNewContext(`${index.slice(start,end)}; realFeedPosts`, {
    process:{env}, isSourceDisplayAllowed:require('./source-policy').isSourceDisplayAllowed,
    isFallbackFeedPost:()=>false, screenFeedPost:post=>({allowed:true,post}),
  });
  const cached=[{id:'video',source:'youtube'},{id:'member-post',source:'uficonnect'}];
  assert.equal(filter(cached).length,1);assert.equal(filter(cached)[0].id,'member-post');
  env.SOURCE_YOUTUBE_ENABLED='true';assert.equal(filter(cached).length,2);
});
