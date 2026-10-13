'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSourceCollectionScheduler, TARGET_CYCLE_MS, MAX_CYCLE_MS } = require('./source-collection-scheduler');
const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture(options = {}) {
  let time = 0;
  const scheduler = createSourceCollectionScheduler({ now: () => time, ...options });
  return { scheduler, advance: ms => { time += ms; } };
}

test('104 source inventories have fair bounded concurrency and one in-flight job per source', async () => {
  const { scheduler } = fixture();
  const started = [], releases = [];
  for (let i = 0; i < 104; i++) scheduler.register({ id: 'source_' + i, keys: ['inventory'], collect: () => {
    started.push(i); return new Promise(resolve => releases.push(resolve));
  } });
  scheduler.pump(); await settle();
  assert.equal(started.length, 4);
  assert.equal(scheduler.status().active, 4);
  const refreshA = scheduler.request('source_0'), refreshB = scheduler.request('source_0');
  scheduler.pump(); await settle();
  assert.equal(started.length, 4, 'Manual requests share the same source/global slots');
  releases.splice(0).forEach(release => release({ posts: 2 }));
  await Promise.all([refreshA, refreshB]); await settle();
  for (let batch = 1; batch < 26; batch++) {
    scheduler.pump(); await settle();
    assert.ok(scheduler.status().active <= 4);
    releases.splice(0).forEach(release => release({ posts: 1 }));
    await settle();
  }
  assert.equal(started.length, 104);
  assert.equal(new Set(started).size, 104);
  assert.equal(scheduler.status().sources.filter(source => source.lastSuccessAt != null).length, 104);
});

test('mapped query keys are deduplicated, rotate once per cycle and respect provider spacing', async () => {
  const { scheduler, advance } = fixture();
  const keys = [];
  scheduler.register({ id: 'queries', keys: ['ai', 'ai', null, 'web'], minSpacingMs: 1000,
    collect: async key => { keys.push(key); return {}; } });
  await Promise.all(scheduler.pump());
  assert.deepEqual(keys, ['ai']);
  advance(TARGET_CYCLE_MS / 2);
  await Promise.all(scheduler.pump());
  assert.deepEqual(keys, ['ai', 'web']);
  const status = scheduler.status().sources[0];
  assert.equal(status.keyCount, 2);
  assert.equal(status.expectedCycleMs, TARGET_CYCLE_MS);
  const pending = scheduler.request('queries');
  await settle();
  assert.equal(keys.length, 2, 'A manual refresh preserves the provider minimum spacing');
  advance(1000); await Promise.all(scheduler.pump()); await pending;
  assert.deepEqual(keys, ['ai', 'web', 'ai']);
});

test('empty successful inventories remain healthy and refresh on cadence', async () => {
  const { scheduler, advance } = fixture();
  let calls = 0;
  scheduler.register({ id: 'quiet', keys: [''], collect: async () => { calls++; return { posts: 0 }; } });
  for (let i = 0; i < 8; i++) { await Promise.all(scheduler.pump()); advance(TARGET_CYCLE_MS); }
  const status = scheduler.status().sources[0];
  assert.equal(calls, 8); assert.equal(status.failures, 0); assert.equal(status.lastError, null);
  assert.equal(status.overdue, false);
});

test('Retry-After, quota resets and repeated errors are not bypassed by manual refresh', async () => {
  const { scheduler, advance } = fixture();
  let calls = 0, quotaReset = 0;
  scheduler.register({ id: 'limited', keys: [''], providerUntil: () => quotaReset, collect: async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('429 provider limit'), { headers: { 'retry-after': '900' } });
    return {};
  } });
  await Promise.all(scheduler.pump());
  assert.equal(scheduler.status().sources[0].backoffUntil, 900000);
  assert.equal((await scheduler.request('limited')).reason, 'backoff');
  advance(MAX_CYCLE_MS + 1);
  assert.equal(scheduler.status().sources[0].overdue, true, 'Unsuccessful sources cannot be hidden by another source succeeding');
  scheduler.nudge(['limited']); await Promise.all(scheduler.pump()); assert.equal(calls, 1);
  advance(300000); quotaReset = 1200000;
  assert.equal((await scheduler.request('limited')).reason, 'backoff');
  advance(300000); await Promise.all(scheduler.pump()); assert.equal(calls, 2);
  assert.equal(scheduler.status().sources[0].lastError, null);
});

test('runtime protection and missing approval do not invent successful checks', async () => {
  let protectedRuntime = true;
  const { scheduler, advance } = fixture({ canRun: () => !protectedRuntime });
  let calls = 0;
  scheduler.register({ id: 'configured', keys: [''], collect: async () => { calls++; return {}; } });
  scheduler.register({ id: 'disabled', keys: [''], enabled: () => false, collect: async () => { throw Error('Must not fetch'); } });
  assert.equal((await scheduler.request('configured')).reason, 'protected');
  assert.equal((await scheduler.request('disabled')).reason, 'disabled');
  assert.equal(scheduler.pump().length, 0);
  advance(MAX_CYCLE_MS + 1);
  assert.deepEqual(scheduler.status().overdue, ['configured']);
  protectedRuntime = false; await Promise.all(scheduler.pump());
  assert.equal(calls, 1);
  assert.deepEqual(scheduler.status().overdue, []);
});

test('provider-constrained query coverage is reported separately from successful source visits', async () => {
  const { scheduler } = fixture();
  scheduler.register({ id: 'limited-search', keys: Array.from({ length: 20 }, (_, i) => i), minSpacingMs: 60000, collect: async () => ({}) });
  await Promise.all(scheduler.pump());
  const status = scheduler.status().sources[0];
  assert.equal(status.coverageLimited, true);
  assert.equal(status.expectedCycleMs, 1200000);
  assert.equal(status.lastSuccessAt, 0);
  assert.equal(status.overdue, false);
});

test('a refresh immediately after completion cannot join an already-settled source flight', async () => {
  const { scheduler, advance } = fixture();
  let calls = 0;
  scheduler.register({ id: 'successive', keys: ['inventory'], minSpacingMs: 1000, collect: async () => ({ posts: ++calls }) });
  assert.equal((await scheduler.request('successive')).posts, 1);
  advance(1000);
  assert.equal((await scheduler.request('successive')).posts, 2);
  assert.equal(scheduler.status().active, 0);
});

for (const status of [404, 410]) test(`a missing YouTube channel (${status}) cannot pause healthy channels or count as fresh`, async () => {
  const { scheduler, advance } = fixture();
  const calls = [];
  scheduler.register({ id: 'youtube', keys: ['live-a', 'missing', 'live-b'], collect: async key => {
    calls.push(key);
    if (key === 'missing') throw Object.assign(new Error('HTTP ' + status + ' channel missing'), { status, collectionKeyFailure: true });
    return { posts: 15 };
  } });
  await Promise.all(scheduler.pump());
  advance(100000); await Promise.all(scheduler.pump());
  let source = scheduler.status().sources[0];
  assert.equal(source.backoffUntil, null, 'The missing channel does not stop the provider');
  assert.equal(source.failedKeyCount, 1);
  assert.equal(source.failedKeys[0].key, 'missing');
  assert.equal(source.failedKeys[0].retryAt, 400000);
  assert.equal(source.lastSuccessAt, 0, 'Failure does not move successful freshness forward');
  advance(100000); await Promise.all(scheduler.pump());
  source = scheduler.status().sources[0];
  assert.deepEqual(calls, ['live-a', 'missing', 'live-b']);
  assert.equal(source.lastAttemptCycleFinishedAt, 200000);
  assert.equal(source.lastAttemptCycleSuccessfulKeys, 2);
  assert.equal(source.lastAttemptCycleFailedKeys, 1);
  assert.equal(source.lastCycleFinishedAt, null, 'Attempting every channel is not a successful full cycle');
  advance(100000); await Promise.all(scheduler.pump());
  advance(1000); scheduler.nudge(['youtube']); await Promise.all(scheduler.pump());
  assert.equal(calls.filter(key => key === 'missing').length, 1, 'Manual refresh respects the per-channel five-minute cooldown');
  advance(300000); await Promise.all(scheduler.pump());
  source = scheduler.status().sources[0];
  assert.ok(source.staleKeyCount >= 1);
  assert.equal(source.cycleOverdue, true, 'An unavailable channel remains visible in incomplete coverage');
});

test('an entirely missing channel inventory reports a key cooldown without holding a manual refresh open', async () => {
  const { scheduler, advance } = fixture();
  let calls = 0;
  scheduler.register({ id: 'youtube', keys: ['missing'], collect: async () => {
    calls++; throw Object.assign(new Error('HTTP 404'), { status: 404, collectionKeyFailure: true });
  } });
  await Promise.all(scheduler.pump());
  assert.equal((await scheduler.request('youtube')).reason, 'key_backoff');
  advance(299999); assert.equal(scheduler.pump().length, 0); assert.equal(calls, 1);
  advance(1); await Promise.all(scheduler.pump()); assert.equal(calls, 2);
  assert.equal(scheduler.status().sources[0].lastSuccessAt, null);
});

for (const status of [403, 429, 503]) test(`provider failure ${status} still pauses all channel jobs`, async () => {
  const { scheduler, advance } = fixture();
  const calls = [];
  scheduler.register({ id: 'youtube', keys: ['first', 'second'], collect: async key => {
    calls.push(key);
    throw Object.assign(new Error('HTTP ' + status), { status, collectionKeyFailure: true });
  } });
  await Promise.all(scheduler.pump());
  const source = scheduler.status().sources[0];
  assert.equal(source.backoffUntil, 30000);
  assert.equal(source.failedKeyCount, 0);
  assert.equal((await scheduler.request('youtube')).reason, 'backoff');
  scheduler.nudge(['youtube']); advance(29999); assert.equal(scheduler.pump().length, 0);
  assert.deepEqual(calls, ['first']);
});
