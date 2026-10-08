import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSnapGroups, snapFileError, snapTimeRemaining, snapAvailabilityLabel, snapDurationLabel, normalizeSnapSourceErrors, snapPlaybackInfo } from './snapRanking.mjs';

const now = Date.parse('2026-10-08T12:00:00Z');
const snap = (id, source, createdAt = '2026-10-08T10:00:00Z', extra = {}) => ({
  id, source, createdAt, expiresAt: '2026-10-09T10:00:00Z',
  mediaType: 'image', mediaUrl: 'https://media.example.com/photo.jpg', ...extra,
});

test('favorites keep their order while other active sources rank by recency', () => {
  const groups = rankSnapGroups([
    snap('recent', 'uficonnect', '2026-10-08T11:59:00Z'),
    snap('favorite', 'instagram'),
    snap('first', 'facebook', '2026-10-08T09:00:00Z'),
    snap('later', 'instagram', '2026-10-08T11:00:00Z'),
  ], ['facebook', 'instagram'], now);
  assert.deepEqual(groups.map(group => group.source), ['facebook', 'instagram', 'uficonnect']);
  assert.equal(groups[0].favorite, true);
  assert.equal(groups[2].favorite, false);
  assert.deepEqual(groups[1].items.map(item => item.id), ['later', 'favorite']);
});

test('expired, duplicated and unsafe stories never make a source box', () => {
  const live = snap('same', 'uficonnect');
  const groups = rankSnapGroups([live, live,
    snap('expired', 'facebook', undefined, { expiresAt: '2026-10-08T12:00:00Z' }),
    snap('unknown-expiry', 'tiktok', undefined, { expiresAt: null }),
    snap('unsafe', 'instagram', undefined, { mediaUrl: 'javascript:alert(1)' }),
  ], [], now);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 1);
});

test('file limits reject unsupported formats and oversize media', () => {
  assert.equal(snapFileError({ type: 'image/jpeg', size: 10 * 1024 * 1024 }), '');
  assert.match(snapFileError({ type: 'image/png', size: 10 * 1024 * 1024 + 1 }), /10 MB/);
  assert.match(snapFileError({ type: 'image/svg+xml', size: 40 }), /JPG/);
  assert.match(snapFileError({ type: 'video/mp4', size: 100 * 1024 * 1024 + 1 }), /100 MB/);
  assert.equal(snapTimeRemaining('2026-10-08T12:01:00Z', now), '1m left');
  assert.equal(snapTimeRemaining('2026-10-08T12:00:00Z', now), 'Expired');
});

test('external preview windows do not imply that source clips expire', () => {
  const clip = snap('source-clip', 'youtube', '2026-10-07T10:00:00Z', { isExternal: true, videoDurationSeconds: 75 });
  const label = snapAvailabilityLabel(clip, now);
  assert.match(label, /Recent source clip/);
  assert.match(label, /1:15/);
  assert.match(label, /2026/);
  assert.doesNotMatch(label, /left|Expired|24 hours|disappear/i);
  assert.equal(snapAvailabilityLabel(snap('native', 'uficonnect'), now), '22h left');
  assert.equal(snapDurationLabel(12), '12s');
  assert.equal(snapDurationLabel(0), '');
  assert.equal(snapDurationLabel('invalid'), '');
});

test('source failures stay source-labeled and reject malformed metadata', () => {
  assert.deepEqual(normalizeSnapSourceErrors({ youtube: ' Temporarily unavailable ', mastodon: { message: 'Authorization expired' }, facebook: null, 'not a source': 'ignore' }), {
    youtube: 'Temporarily unavailable', mastodon: 'Authorization expired',
  });
  assert.deepEqual(normalizeSnapSourceErrors(['error']), {});
  assert.equal(normalizeSnapSourceErrors({ reddit: 'x'.repeat(400) }).reddit.length, 240);
});

test('YouTube embeds require a real official URL and matching identity', () => {
  const clip = snap('youtube', 'youtube', undefined, { isExternal: true, mediaType: 'video', mediaKind: 'youtube', embedId: 'abcdefghijk', mediaUrl: 'https://www.youtube.com/watch?v=abcdefghijk' });
  assert.equal(snapPlaybackInfo(clip).kind, 'youtube');
  assert.equal(snapPlaybackInfo(clip).id, 'abcdefghijk');
  assert.equal(snapPlaybackInfo({ ...clip, embedId: 'zzzzzzzzzzz' }).kind, 'source');
  assert.equal(snapPlaybackInfo({ ...clip, mediaUrl: 'https://youtube.com.evil.example/watch?v=abcdefghijk' }).kind, 'source');
  assert.equal(snapPlaybackInfo({ ...clip, mediaUrl: 'javascript:alert(1)' }).kind, 'source');
});

test('public source videos require recorded authorization for direct or HLS playback', () => {
  const clip = snap('mastodon', 'mastodon', undefined, { isExternal: true, mediaType: 'video', mediaKind: 'file', mediaUrl: 'https://media.example.com/video.mp4', sourceUrl: 'https://mastodon.social/@author/12345' });
  assert.equal(snapPlaybackInfo(clip).kind, 'source');
  assert.equal(snapPlaybackInfo({ ...clip, directPlaybackAuthorized: true }).kind, 'file');
  assert.equal(snapPlaybackInfo({ ...clip, mediaKind: 'hls', mediaUrl: 'https://media.example.com/stream.m3u8', directPlaybackAuthorized: true }).kind, 'hls');
  assert.equal(snapPlaybackInfo({ ...clip, mediaUrl: 'http://media.example.com/video.mp4', directPlaybackAuthorized: true }).kind, 'source');
  assert.equal(snapPlaybackInfo({ ...clip, isExternal: false, source: 'uficonnect' }).kind, 'file');
});
