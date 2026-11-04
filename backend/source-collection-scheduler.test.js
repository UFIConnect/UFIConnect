'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSourceCollectionScheduler, TARGET_CYCLE_MS, MAX_CYCLE_MS, MAX_COLLECTION_INTERVAL_MS, retryUntil } = require('./source-collection-scheduler');
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
  advance(MAX_COLLECTION_INTERVAL_MS);
  await Promise.all(scheduler.pump());
  assert.deepEqual(keys, ['ai', 'web']);
  const status = scheduler.status().sources[0];
  assert.equal(status.keyCount, 2);
  assert.equal(status.expectedCycleMs, 2 * MAX_COLLECTION_INTERVAL_MS);
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

test('small source inventories keep pulling within twenty seconds instead of waiting for the coverage target', async () => {
  for (const keyCount of [1, 2, 11, 15, 200]) {
    const { scheduler, advance } = fixture();
    const calls = [];
    scheduler.register({ id: 'inventory', keys: Array.from({ length: keyCount }, (_, i) => String(i)),
      collect: async key => { calls.push(key); return {}; } });
    const expectedInterval = Math.min(MAX_COLLECTION_INTERVAL_MS, TARGET_CYCLE_MS / keyCount);
    assert.equal(scheduler.status().sources[0].intervalMs, expectedInterval);
    await Promise.all(scheduler.pump());
    advance(expectedInterval - 1);
    assert.equal(scheduler.pump().length, 0);
    advance(1);
    await Promise.all(scheduler.pump());
    assert.deepEqual(calls, ['0', keyCount > 1 ? '1' : '0']);
  }
});

test('configured policy spacing can intentionally exceed the normal twenty-second schedule', async () => {
  const { scheduler, advance } = fixture();
  let calls = 0;
  scheduler.register({ id: 'restricted', keys: ['inventory'],
    collectionState: () => ({ allowed: true, minSpacingMs: 60000 }),
    collect: async () => { calls++; return {}; } });
  await Promise.all(scheduler.pump());
  advance(MAX_COLLECTION_INTERVAL_MS);
  assert.equal(scheduler.pump().length, 0);
  assert.equal(scheduler.status().sources[0].intervalMs, 60000);
  advance(40000);
  await Promise.all(scheduler.pump());
  assert.equal(calls, 2);
});

test('missing setup remains degraded without attempts and resumes when credentials are configured', async () => {
  const { scheduler, advance } = fixture();
  let configured = false, calls = 0;
  scheduler.register({ id: 'needs_setup', keys: ['inventory'], enabled: () => configured,
    collectionState: () => ({ allowed: configured, reason: configured ? null : 'setup_required', minSpacingMs: 20000 }),
    collect: async () => { calls++; return {}; } });
  advance(TARGET_CYCLE_MS);
  assert.equal(scheduler.pump().length, 0);
  assert.equal((await scheduler.request('needs_setup')).reason, 'setup_required');
  assert.deepEqual(scheduler.nudge(['needs_setup']), []);
  assert.equal(scheduler.status().sources[0].pauseReason, 'setup_required');
  assert.equal(scheduler.status().sources[0].lastAttemptAt, null);
  configured = true;
  await Promise.all(scheduler.pump());
  advance(MAX_COLLECTION_INTERVAL_MS);
  await Promise.all(scheduler.pump());
  assert.equal(calls, 2);
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

test('adapter retryAfter seconds preserve research provider cooldowns across manual and automatic collection', async () => {
  const { scheduler, advance } = fixture();
  let calls = 0;
  scheduler.register({ id: 'openalex', keys: ['research'], collect: async () => {
    if (++calls === 1) throw Object.assign(new Error('Provider rate limit'), { status: 429, retryAfter: 900 });
    return {};
  } });
  await Promise.all(scheduler.pump());
  assert.equal(scheduler.status().sources[0].backoffUntil, 900000);
  advance(899999);
  assert.equal((await scheduler.request('openalex')).retryAt, 900000);
  scheduler.nudge(['openalex']); await Promise.all(scheduler.pump());
  assert.equal(calls, 1);
  advance(1); await Promise.all(scheduler.pump());
  assert.equal(calls, 2);
  assert.equal(scheduler.status().sources[0].failures, 0);
});

test('malformed adapter cooldowns retain normal backoff and cannot shorten a provider header', () => {
  for (const retryAfter of [undefined, null, -5, NaN, Infinity, 'invalid']) {
    assert.equal(retryUntil({ retryAfter }, 1000, 1), 31000);
  }
  assert.equal(retryUntil({ retryAfter: 60, headers: { 'retry-after': '900' } }, 1000, 1), 901000);
  assert.equal(retryUntil({ retryAfter: 900, headers: { 'retry-after': '60' } }, 1000, 1), 901000);
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

test('collection policy pauses provider calls without advancing keys or claiming freshness', async () => {
  const { scheduler } = fixture();
  let policy = { allowed: false, reason: 'source_blocked', remaining: 0, retryAt: null, minSpacingMs: 2500 };
  const calls = [];
  scheduler.register({ id: 'bluesky', keys: ['first', 'second'], collectionState: () => policy,
    collect: async key => { calls.push(key); return {}; } });
  for (const reason of ['source_blocked', 'policy_unavailable', 'approval_cooldown', 'source_flood']) {
    policy = { ...policy, reason, retryAt: reason === 'source_flood' ? 60000 : null };
    assert.equal(scheduler.pump().length, 0);
    assert.equal((await scheduler.request('bluesky')).reason, reason);
    assert.deepEqual(scheduler.nudge(['bluesky']), []);
    const status = scheduler.status().sources[0];
    assert.equal(status.collectionReason, reason); assert.equal(status.collectionRetryAt, policy.retryAt);
    assert.equal(status.totalRuns, 0); assert.equal(status.lastSuccessAt, null); assert.equal(status.lastAttemptAt, null);
  }
  policy = { allowed: true, remaining: 2, minSpacingMs: 2500 };
  await Promise.all(scheduler.pump());
  assert.deepEqual(calls, ['first']);
  assert.equal(scheduler.status().sources[0].remainingAdmission, 2);
});

test('dynamic pull ceilings govern automatic visits, manual requests, and nudges across query keys', async () => {
  let time = 0, spacing = 2500;
  const scheduler = createSourceCollectionScheduler({ now: () => time });
  const starts = [];
  scheduler.register({ id: 'bluesky', keys: ['a', 'b', 'c'], targetCycleMs: 3000,
    collectionState: () => ({ allowed: true, remaining: null, minSpacingMs: spacing }),
    collect: async key => { starts.push({ key, time }); return {}; } });
  await Promise.all(scheduler.pump());
  const manual = scheduler.request('bluesky');
  time = 2499; scheduler.nudge(['bluesky']); assert.equal(scheduler.pump().length, 0);
  time = 2500; await Promise.all(scheduler.pump()); await manual;
  assert.deepEqual(starts, [{ key: 'a', time: 0 }, { key: 'b', time: 2500 }]);
  spacing = 5000;
  time = 5000; scheduler.nudge(['bluesky']); assert.equal(scheduler.pump().length, 0);
  time = 7500; await Promise.all(scheduler.pump());
  assert.deepEqual(starts.at(-1), { key: 'c', time: 7500 });
  assert.equal(scheduler.status().sources[0].minSpacingMs, 5000);
});

test('a queued manual request settles when policy pauses its source before collection', async () => {
  const { scheduler, advance } = fixture();
  let allowed = true, calls = 0;
  scheduler.register({ id: 'medium', keys: ['tag'], minSpacingMs: 2000,
    collectionState: () => ({ allowed, reason: 'approval_cooldown', remaining: 0, retryAt: 60000 }),
    collect: async () => { calls++; return {}; } });
  await Promise.all(scheduler.pump());
  const manual = scheduler.request('medium');
  allowed = false; advance(500); scheduler.pump();
  assert.deepEqual(await manual, { deferred: true, reason: 'approval_cooldown', retryAt: 60000 });
  assert.equal(calls, 1); assert.equal(scheduler.status().sources[0].totalRuns, 1);
});

test('collector deferral honors retryAt, preserves its query key, and cannot be bypassed manually', async () => {
  const { scheduler, advance } = fixture();
  const calls = [];
  scheduler.register({ id: 'budgeted', keys: ['first', 'second'], targetCycleMs: 2000,
    collect: async key => { calls.push(key); return calls.length === 1 ? { deferred: true, reason: 'source_capacity', retryAt: 60000 } : {}; } });
  await Promise.all(scheduler.pump());
  assert.equal(scheduler.status().sources[0].lastSuccessAt, null);
  assert.equal((await scheduler.request('budgeted')).retryAt, 60000);
  advance(59999); scheduler.nudge(['budgeted']); assert.equal(scheduler.pump().length, 0);
  advance(1); await Promise.all(scheduler.pump());
  assert.deepEqual(calls, ['first', 'first']);
  assert.equal(scheduler.status().sources[0].totalRuns, 1);
});

test('an unavailable collection policy fails closed without creating provider errors', async () => {
  const { scheduler } = fixture();
  scheduler.register({ id: 'unavailable', keys: ['inventory'], collectionState: () => { throw new Error('Policy not initialized'); },
    collect: async () => { throw new Error('Must not fetch'); } });
  assert.equal(scheduler.pump().length, 0);
  assert.equal((await scheduler.request('unavailable')).reason, 'policy_unavailable');
  assert.equal(scheduler.status().sources[0].failures, 0);
});

test('a shared pull gate race defers the same key without reporting a provider failure', async () => {
  let errors = 0;
  const { scheduler, advance } = fixture({ onError: () => { errors++; } });
  const calls = [];
  scheduler.register({ id: 'bluesky', keys: ['first', 'second'], targetCycleMs: 2000,
    collect: async key => {
      calls.push(key);
      if (calls.length === 1) throw Object.assign(new Error('Source pull ceiling reached'), {
        code: 'source_collection_deferred', reason: 'source_pull_limit', retryAt: 5000,
      });
      return { posts: 1 };
    } });
  await Promise.all(scheduler.pump());
  assert.equal(errors, 0);
  let status = scheduler.status().sources[0];
  assert.equal(status.failures, 0); assert.equal(status.attemptedKeys, 0);
  assert.equal(status.lastError, null); assert.equal(status.lastSuccessAt, null);
  assert.equal((await scheduler.request('bluesky')).reason, 'source_pull_limit');
  advance(5000); await Promise.all(scheduler.pump());
  assert.deepEqual(calls, ['first', 'first']);
  status = scheduler.status().sources[0]; assert.equal(status.totalRuns, 1);
});

test('blocking a later manual request does not misreport the result of an already running request', async () => {
  const { scheduler } = fixture();
  let allowed = true, release, firstSettled = false;
  scheduler.register({ id: 'bluesky', keys: ['inventory'],
    collectionState: () => ({ allowed, reason: 'source_blocked' }),
    collect: () => new Promise(resolve => { release = resolve; }) });
  const first = scheduler.request('bluesky').then(result => { firstSettled = true; return result; });
  await settle(); allowed = false;
  assert.equal((await scheduler.request('bluesky')).reason, 'source_blocked');
  await settle(); assert.equal(firstSettled, false);
  release({ posts: 2 });
  assert.equal((await first).posts, 2);
});

test('normal pull spacing and in-flight waits remain visible without reporting a health pause', async () => {
  const { scheduler, advance } = fixture();
  let reason = null;
  scheduler.register({ id: 'bluesky', keys: ['inventory'],
    collectionState: () => ({ allowed: !reason, reason, retryAt: 300000, minSpacingMs: 2500 }),
    collect: async () => ({ posts: 1 }) });
  await Promise.all(scheduler.pump());
  for (const wait of ['source_pull_limit', 'source_in_flight']) {
    reason = wait;
    const status = scheduler.status().sources[0];
    assert.equal(status.collectionReason, wait);
    assert.equal(status.collectionRetryAt, 300000);
    assert.equal(status.retryAt, 300000);
    assert.equal(status.nextAt, 300000);
    assert.equal(status.pauseReason, null);
    assert.equal(status.backoffUntil, null);
    assert.equal(status.overdue, false);
  }
  advance(MAX_CYCLE_MS + 1);
  assert.equal(scheduler.status().sources[0].overdue, true, 'Routine wait labels cannot conceal genuinely stale collection');
});

test('a shared-gate race wait retains its deadline without becoming a health backoff', async () => {
  const { scheduler } = fixture();
  scheduler.register({ id: 'bluesky', keys: ['inventory'], collect: async () => {
    throw Object.assign(new Error('Collection already in flight'), {
      code: 'source_collection_deferred', reason: 'source_in_flight', retryAt: 300000,
    });
  } });
  await Promise.all(scheduler.pump());
  const status = scheduler.status().sources[0];
  assert.equal(status.pauseReason, null); assert.equal(status.backoffUntil, null);
  assert.equal(status.retryAt, 300000); assert.equal(status.nextAt, 300000);
  assert.equal(status.failures, 0);
});

test('normal pull waits cannot hide an independent provider error cooldown', async () => {
  const { scheduler } = fixture();
  let pacing = false;
  scheduler.register({ id: 'bluesky', keys: ['inventory'],
    collectionState: () => ({ allowed: !pacing, reason: 'source_pull_limit', retryAt: 2500 }),
    collect: async () => { throw Object.assign(new Error('429 provider limit'), { retryAfter: 900 }); } });
  await Promise.all(scheduler.pump()); pacing = true;
  const status = scheduler.status().sources[0];
  assert.equal(status.collectionReason, 'source_pull_limit');
  assert.equal(status.collectionRetryAt, 2500);
  assert.equal(status.pauseReason, 'backoff');
  assert.equal(status.backoffUntil, 900000); assert.equal(status.retryAt, 900000);
  assert.equal(status.failures, 1); assert.equal(status.lastError, '429 provider limit');
});
