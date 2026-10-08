import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSnapGroups, snapFileError, snapTimeRemaining } from './snapRanking.mjs';

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
