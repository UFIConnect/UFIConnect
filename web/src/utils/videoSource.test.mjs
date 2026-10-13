import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVideoSource, deriveBlueskyPlaylistUrl, isDirectVideoUrl } from './videoSource.mjs';
import { directMediaPlaybackAllowed } from './sourceMediaPolicy.mjs';

const mastodon = { source: 'mastodon', isExternal: true, mediaType: 'video', sourceUrl: 'https://mastodon.social/@creator/12345',
  mediaUrl: 'https://files.mastodon.social/media/clip.mp4?download=1#fragment', mediaPoster: 'https://files.mastodon.social/media/preview.png' };
const bluesky = { source: 'bluesky', isExternal: true, mediaType: 'video', sourceUrl: 'https://bsky.app/profile/creator.bsky.social/post/3ltestvideo',
  mediaUrl: 'https://video.bsky.app/watch/did%3Aplc%3Acreator/bafysynthetic/playlist.m3u8?quality=high#video' };

test('Mastodon API attachments play as files without changing the original source credit', () => {
  assert.deepEqual(resolveVideoSource(mastodon), { kind: 'file', src: mastodon.mediaUrl, poster: mastodon.mediaPoster });
  assert.equal(isDirectVideoUrl(mastodon.mediaUrl, mastodon), true);
  assert.equal(mastodon.sourceUrl, 'https://mastodon.social/@creator/12345');
  const extensionless = { ...mastodon, mediaUrl: 'https://mastodon.social/media/attachment123' };
  assert.equal(resolveVideoSource(extensionless)?.kind, 'file');
  assert.equal(isDirectVideoUrl(extensionless.mediaUrl, extensionless), true);
});

test('Bluesky uses the actual playlist with optional poster and signed query intact', () => {
  assert.deepEqual(resolveVideoSource(bluesky), { kind: 'hls', src: bluesky.mediaUrl, poster: null });
  assert.equal(deriveBlueskyPlaylistUrl(bluesky.mediaUrl), bluesky.mediaUrl);
  assert.equal(deriveBlueskyPlaylistUrl('https://video.bsky.app/watch/thumbnail.jpg'), null);
  assert.equal(resolveVideoSource({ ...bluesky, mediaUrl: 'https://video.bsky.app/watch/thumbnail.jpg' }), null);
});

test('open-source provider labels or image types alone do not authorize a direct player', () => {
  for (const post of [mastodon, bluesky]) {
    assert.equal(directMediaPlaybackAllowed({ ...post, sourceUrl: 'https://evil.example/post/123' }), false);
    assert.equal(resolveVideoSource({ ...post, sourceUrl: null }), null);
    assert.equal(resolveVideoSource({ ...post, mediaType: 'image' }), null);
  }
});

test('unsafe API media and private destinations are never resolved for open protocols', () => {
  for (const value of ['http://files.mastodon.social/clip.mp4', 'https://name:secret@files.mastodon.social/clip.mp4',
    'https://127.0.0.1/clip.mp4', 'https://2130706433/clip.mp4', 'https://[::1]/clip.mp4', 'https://10.0.0.1/clip.mp4',
    'https://private.internal/clip.mp4', 'https://localhost/clip.mp4', 'https://device.local/clip.mp4', 'https://cdn.example:8443/clip.mp4',
    'javascript:alert(1)', 'data:video/mp4,abc', 'https://files.mastodon.social\\@evil.example/clip.mp4']) {
    assert.equal(resolveVideoSource({ ...mastodon, mediaUrl: value }), null, value);
    assert.equal(deriveBlueskyPlaylistUrl(value.replace('clip.mp4', 'playlist.m3u8')), null, value);
  }
});

test('YouTube references resolve to the official player for every source and stale provider labels', () => {
  for (const source of ['youtube', 'mastodon', 'bluesky', 'reddit', 'devto', 'uficonnect']) {
    const resolved = resolveVideoSource({ source, mediaType: 'video', mediaUrl: 'https://www.youtube.com/watch?v=abcdefghijk', sourceUrl: 'https://example.org/article' });
    assert.equal(resolved.kind, 'youtube'); assert.equal(resolved.id, 'abcdefghijk');
    assert.equal(resolved.poster, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  }
  assert.equal(resolveVideoSource({ source: 'bluesky', mediaUrl: 'https://www.youtube.com/shorts/abcdefghijk' }).vertical, true);
  assert.equal(resolveVideoSource({ source: 'youtube', embedId: 'abcdefghijk' }), null);
});

test('official provider references reject deceptive hosts, insecure URLs and ambiguous video IDs', () => {
  for (const value of ['https://youtube.com.evil.example/watch?v=abcdefghijk', 'https://evil.example/youtube.com/watch?v=abcdefghijk',
    'https://user:pass@youtube.com/watch?v=abcdefghijk', 'http://youtube.com/watch?v=abcdefghijk',
    'https://youtube.com/watch?v=abcdefghijk&v=lmnopqrstuv', 'https://youtube.com/channel/UCcreator']) {
    assert.equal(resolveVideoSource({ source: 'youtube', mediaUrl: value, embedId: 'abcdefghijk' }), null, value);
  }
});

test('Vimeo references embedded in other sources retain official playback', () => {
  assert.deepEqual(resolveVideoSource({ ...bluesky, mediaUrl: 'https://player.vimeo.com/video/12345' }), { kind: 'vimeo', id: '12345', poster: null });
});

test('native and explicitly authorized media still play; closed providers do not gain direct CDN playback', () => {
  const value = 'https://cdn.example/video.webm?token=synthetic#fragment';
  assert.equal(resolveVideoSource({ source: 'uficonnect', mediaType: 'video', mediaUrl: value })?.kind, 'file');
  assert.equal(resolveVideoSource({ source: 'licensed-provider', directPlaybackAuthorized: true, mediaUrl: value })?.kind, 'file');
  for (const source of ['youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'reddit', 'vimeo', 'twitch']) {
    assert.equal(resolveVideoSource({ source, mediaType: 'video', mediaUrl: value, isExternal: true }), null, source);
  }
});
