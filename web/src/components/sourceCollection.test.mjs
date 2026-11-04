import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionSourceRows, collectionTiming, collectionStatus } from './sourceCollection.mjs';

test('backend catalogs include empty and future sources while worker aliases count once', () => {
  const rows = collectionSourceRows({ sourceCatalog: [
    { id: 'hackernews', workerId: 'hn', pullLimit: { windowSeconds: 20, maxPulls: 10 } },
    { id: 'openalex', postCount: 0 }, { id: 'future_source', postCount: 0 },
  ], sources: [{ id: 'hn', postCount: 8, samplePosts: [{ id: 'p1' }] }] });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].id, 'hackernews');
  assert.equal(rows[0].workerId, 'hn');
  assert.equal(rows[0].postCount, 8);
  assert.equal(collectionTiming(rows[0]).pullLimit, '10 pulls / 20s');
});

test('saved tighter policy changes displayed limits independently of collection cadence', () => {
  const original = { pullLimit: { windowSeconds: 30, maxPulls: 12, minSpacingMs: 2500 }, collectionIntervalMs: 300000 };
  assert.deepEqual(collectionTiming(original), { pullLimit: '12 pulls / 30s', minimumSpacing: '2.5s', scheduledInterval: '5m' });
  const updated = { ...original, pullLimit: { windowSeconds: 120, maxPulls: 1, minSpacingMs: 120000 }, pullLimitLabel: '1 pull / 120s' };
  assert.deepEqual(collectionTiming(updated), { pullLimit: '1 pull / 120s', minimumSpacing: '2m', scheduledInterval: '5m' });
});

test('missing metadata never invents a pull rate from legacy delays or shard counts', () => {
  assert.deepEqual(collectionTiming({ delay: 15000, shards: 8 }), { pullLimit: null, minimumSpacing: null, scheduledInterval: null });
  assert.equal(collectionTiming({ pullLimit: { maxPulls: 0, windowSeconds: 30 }, pullLimitLabel: 'untrusted' }).pullLimit, null);
});

test('cached content and member preference never claim observed source activity', () => {
  assert.equal(collectionStatus({ postCount: 20, lastFetch: Date.now(), enabled: true }).label, 'Posts available');
  assert.equal(collectionStatus({ postCount: 20, lastFetch: 1 }).label, 'Posts available');
  assert.equal(collectionStatus({ postCount: 0 }).label, 'No posts yet');
  assert.equal(collectionStatus({ postCount: 20, collection: { enabled: false } }).label, 'Collection disabled');
});

test('observed pauses and provider backoff take precedence over cached posts', () => {
  assert.equal(collectionStatus({ postCount: 20, collection: { enabled: true, pauseReason: 'source_blocked' } }).label, 'Source blocked');
  assert.equal(collectionStatus({ collection: { enabled: true, pauseReason: 'backoff' } }).label, 'Provider cooldown');
  assert.equal(collectionStatus({ collection: { enabled: true, inFlight: true } }).label, 'Collecting');
  assert.equal(collectionStatus({ collection: { enabled: true, overdue: true } }).label, 'Collection overdue');
});
