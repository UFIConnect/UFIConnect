'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const catalog = require('../shared/feed-source-catalog.json');
const { DEFAULT_SOURCE_PULL_LIMITS, normalizeSourcePullLimits, sourcePullLimit, createSourcePullGate } = require('./source-pull-limits');

test('all published and added sources have collection budgets; future sources remain bounded', () => {
  const sources = new Set([...catalog.home, ...catalog.jobs, ...Object.keys(catalog.following),
    'crossref', 'datacite', 'zenodo', 'openalex', 'linkedin']);
  for (const id of sources) {
    assert.ok(Object.hasOwn(DEFAULT_SOURCE_PULL_LIMITS, id), `${id} has an explicit budget`);
    assert.ok(sourcePullLimit(id).minSpacingMs > 0);
  }
  assert.deepEqual(sourcePullLimit('future_provider'), { windowSeconds: 300, maxPulls: 1, minSpacingMs: 300000 });
  assert.deepEqual(sourcePullLimit(undefined), sourcePullLimit('future_provider'));
});

test('high-volume and quota-limited sources keep their distinct ceilings with upward-rounded pacing', () => {
  assert.deepEqual(sourcePullLimit('reddit'), { windowSeconds: 15, maxPulls: 8, minSpacingMs: 1875 });
  assert.deepEqual(sourcePullLimit('medium'), { windowSeconds: 90, maxPulls: 14, minSpacingMs: 6429 });
  assert.deepEqual(sourcePullLimit('github'), { windowSeconds: 240, maxPulls: 1, minSpacingMs: 240000 });
  assert.equal(sourcePullLimit('stackoverflow').minSpacingMs, 300000);
  assert.equal(sourcePullLimit('openalex').minSpacingMs, 300000);
  for (const id of ['crossref', 'datacite', 'zenodo', 'cntraveler', 'weworkremotely', 'twitch']) {
    assert.equal(sourcePullLimit(id).minSpacingMs, 60000);
  }
});

test('partial source maps preserve unrelated settings and canonicalize Hacker News once', () => {
  const current = normalizeSourcePullLimits({ medium: { windowSeconds: 90, maxPulls: 7 } });
  const updated = normalizeSourcePullLimits({ hn: { windowSeconds: 20, maxPulls: 5 } }, current);
  assert.deepEqual(updated.medium, { windowSeconds: 90, maxPulls: 7 });
  assert.deepEqual(updated.hackernews, { windowSeconds: 20, maxPulls: 5 });
  assert.equal(Object.hasOwn(updated, 'hn'), false);
  assert.deepEqual(sourcePullLimit('hn', updated), { windowSeconds: 20, maxPulls: 5, minSpacingMs: 4000 });
  assert.deepEqual(sourcePullLimit('hackernews', { hn: { windowSeconds: 20, maxPulls: 5 } }), sourcePullLimit('hn', updated));
  assert.deepEqual(normalizeSourcePullLimits({ hn: { windowSeconds: 40, maxPulls: 5 } }, {}),
    { hackernews: { windowSeconds: 40, maxPulls: 5 } });
  assert.deepEqual(current.hackernews, DEFAULT_SOURCE_PULL_LIMITS.hackernews);
});

test('equivalent or tighter windows are allowed; faster known and future-source overrides are rejected', () => {
  const limits = normalizeSourcePullLimits({ medium: { windowSeconds: 180, maxPulls: 28 },
    future_provider: { windowSeconds: 600, maxPulls: 1 } });
  assert.equal(sourcePullLimit('medium', limits).minSpacingMs, 6429);
  assert.equal(sourcePullLimit('future_provider', limits).minSpacingMs, 600000);
  for (const overrides of [
    { medium: { windowSeconds: 90, maxPulls: 15 } },
    { github: { windowSeconds: 239, maxPulls: 1 } },
    { future_provider: { windowSeconds: 299, maxPulls: 1 } },
  ]) assert.throws(() => normalizeSourcePullLimits(overrides), /cannot exceed/);
});

test('invalid, incomplete, ambiguous, and prototype-bearing settings cannot enter persisted policy', () => {
  for (const overrides of [null, [], 'medium']) assert.throws(() => normalizeSourcePullLimits(overrides), /object/);
  for (const setting of [null, [], { maxPulls: 1 }, { windowSeconds: 60 },
    { windowSeconds: 60, maxPulls: 1, enabled: true }, { windowSeconds: '60', maxPulls: 1 },
    { windowSeconds: 0, maxPulls: 1 }, { windowSeconds: 86401, maxPulls: 1 },
    { windowSeconds: 60, maxPulls: 0 }, { windowSeconds: 60, maxPulls: 1.5 },
    { windowSeconds: 86400, maxPulls: 10001 }, { windowSeconds: Infinity, maxPulls: 1 }]) {
    assert.throws(() => normalizeSourcePullLimits({ medium: setting }));
  }
  for (const id of ['', '__proto__', 'constructor', 'prototype', 'source/path', 'a'.repeat(81)]) {
    assert.throws(() => normalizeSourcePullLimits(Object.fromEntries([[id, { windowSeconds: 300, maxPulls: 1 }]])), /Invalid source ID/);
  }
  assert.throws(() => normalizeSourcePullLimits({ hn: { windowSeconds: 20, maxPulls: 5 },
    hackernews: { windowSeconds: 20, maxPulls: 5 } }), /only once/);
  const inherited = Object.create({ medium: { windowSeconds: 1, maxPulls: 10000 } });
  assert.throws(() => normalizeSourcePullLimits(inherited), /object/);
  assert.equal(sourcePullLimit('medium', inherited).minSpacingMs, 6429);
  assert.ok(Object.isFrozen(DEFAULT_SOURCE_PULL_LIMITS));
  assert.ok(Object.isFrozen(DEFAULT_SOURCE_PULL_LIMITS.medium));
});

test('pull gate consults policy only during run and never spends time or starts work for denied intake', async () => {
  let at = 0, calls = 0, policyReads = 0, policy;
  const gate = createSourcePullGate({ now: () => at, collectionState: () => { policyReads++; return policy; } });
  for (const reason of ['source_blocked', 'policy_unavailable', 'approval_cooldown', 'source_flood']) {
    policy = { allowed: false, reason, retryAt: 5000 };
    assert.equal(gate.state('medium').allowed, true);
    await assert.rejects(gate.run('medium', () => calls++), { code: 'source_collection_deferred', reason, retryAt: 5000 });
  }
  assert.equal(policyReads, 4, 'Own state reads do not recurse into policy');
  policy = { allowed: true, remaining: 0 };
  await assert.rejects(gate.run('medium', () => calls++), { code: 'source_collection_deferred', reason: 'source_flood' });
  assert.equal(calls, 0);
  policy = { allowed: true, remaining: 10 };
  assert.equal(await gate.run('medium', () => ++calls), 1, 'Previously denied work has no reserved slot');
  at = 6428;
  await assert.rejects(gate.run('medium', () => calls++), { code: 'source_collection_deferred', reason: 'source_pull_limit', retryAt: 6429 });
  at = 6429;
  assert.equal(await gate.run('medium', () => ++calls), 2, 'Denied retry did not push out the next start');
});

test('same-source concurrent queries defer without joining; independent sources may run', async () => {
  let finish, started = 0;
  const gate = createSourcePullGate({ now: () => 0 });
  const pending = gate.run('hn', () => { started++; return new Promise(resolve => { finish = resolve; }); });
  assert.equal(gate.state('hackernews').reason, 'source_in_flight');
  await assert.rejects(gate.run('hackernews', () => { started++; }), { code: 'source_collection_deferred', reason: 'source_in_flight' });
  assert.equal(await gate.run('medium', () => 'separate provider'), 'separate provider');
  assert.equal(started, 1);
  finish('first query');
  assert.equal(await pending, 'first query');
  assert.equal(gate.state('hackernews').reason, 'source_pull_limit');
});

test('pull gate applies changed spacing to last real start and charges failed provider requests', async () => {
  let at = 0, spacing = 6429, calls = 0;
  const gate = createSourcePullGate({ now: () => at, collectionState: () => ({ allowed: true, minSpacingMs: spacing }) });
  await assert.rejects(gate.run('medium', () => { calls++; throw new Error('Provider unavailable'); }), /Provider unavailable/);
  at = 7000; spacing = 15000;
  await assert.rejects(gate.run('medium', () => calls++), { code: 'source_collection_deferred', retryAt: 15000 });
  at = 15000;
  await gate.run('medium', () => calls++);
  spacing = 1; at = 21428;
  await assert.rejects(gate.run('medium', () => calls++), { code: 'source_collection_deferred', retryAt: 21429 });
  at = 21429;
  await gate.run('medium', () => calls++);
  assert.equal(calls, 3);
});

test('all source ceilings bound repeated pulls, including providers added after this version', async () => {
  let at = 0;
  const gate = createSourcePullGate({ now: () => at });
  for (const id of [...Object.keys(DEFAULT_SOURCE_PULL_LIMITS), 'future_provider']) {
    at = 0;
    await gate.run(id, () => null);
    const spacing = sourcePullLimit(id).minSpacingMs;
    at = spacing - 1;
    await assert.rejects(gate.run(id, () => null), { code: 'source_collection_deferred', retryAt: spacing });
    at = spacing;
    await gate.run(id, () => null);
  }
});

test('bounded gate storage preserves active protection and reclaims expired source entries', async () => {
  let at = 0;
  const gate = createSourcePullGate({ now: () => at, maxSources: 1 });
  await gate.run('first_provider', () => null);
  await assert.rejects(gate.run('second_provider', () => assert.fail('Capacity denial must not start work')),
    { code: 'source_collection_deferred', reason: 'source_capacity', retryAt: 86400000 });
  assert.equal(gate.state('first_provider').reason, 'source_pull_limit');
  at = 86400000;
  await gate.run('second_provider', () => null);
  assert.equal(gate.state('second_provider').reason, 'source_pull_limit');
  assert.equal(gate.state('first_provider').allowed, true);
});
