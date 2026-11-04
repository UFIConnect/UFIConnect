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
    assert.ok(sourcePullLimit(id).minSpacingMs <= 20000, `${id} defaults to at most 20 seconds between pulls`);
  }
  assert.deepEqual(sourcePullLimit('future_provider'), { windowSeconds: 20, maxPulls: 1, minSpacingMs: 20000 });
  assert.deepEqual(sourcePullLimit(undefined), sourcePullLimit('future_provider'));
});

test('photo shard budgets use upward-rounded pacing and single-slot sources use 20 seconds', () => {
  assert.deepEqual(sourcePullLimit('reddit'), { windowSeconds: 15, maxPulls: 8, minSpacingMs: 1875 });
  assert.deepEqual(sourcePullLimit('medium'), { windowSeconds: 20, maxPulls: 14, minSpacingMs: 1429 });
  assert.deepEqual(sourcePullLimit('github'), { windowSeconds: 20, maxPulls: 1, minSpacingMs: 20000 });
  for (const id of ['arxiv', 'usajobs', 'stackoverflow', 'twitter', 'linkedin', 'facebook', 'openalex',
    'crossref', 'datacite', 'zenodo', 'remotive', 'muse']) {
    assert.equal(sourcePullLimit(id).minSpacingMs, 20000, id);
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

test('every photo group preserves its shard count and caps the per-shard interval at twenty seconds', () => {
  const groups = [
    [15, 8, ['reddit']], [20, 10, ['hackernews', 'mastodon']],
    [20, 12, ['bluesky', 'devto', 'indeed', 'techcrunch', 'theverge', 'cntraveler']],
    [20, 14, ['medium', 'youtube', 'hashnode', 'producthunt', 'arstechnica', 'wired', 'venturebeat', 'phoronix', 'twitch']],
    [20, 18, ['theregister', 'remoteok', 'behance', 'weworkremotely']],
    [20, 20, ['indiehackers', 'smashing', 'infoq', 'mittr', 'gitlab', 'yc', 'crunchbase', 'designweb']],
    [20, 16, ['lobsters']],
    [20, 1, ['github', 'arxiv', 'usajobs', 'stackoverflow', 'twitter', 'linkedin', 'facebook', 'remotive', 'muse', 'crossref', 'datacite', 'zenodo', 'openalex']],
  ];
  const covered = new Set();
  for (const [windowSeconds, maxPulls, ids] of groups) for (const id of ids) {
    assert.deepEqual(sourcePullLimit(id), { windowSeconds, maxPulls, minSpacingMs: Math.ceil(windowSeconds * 1000 / maxPulls) }, id);
    covered.add(id);
  }
  assert.deepEqual([...covered].sort(), Object.keys(DEFAULT_SOURCE_PULL_LIMITS).sort());
});

test('equivalent or tighter windows are allowed; faster known and future-source overrides are rejected', () => {
  const limits = normalizeSourcePullLimits({ medium: { windowSeconds: 40, maxPulls: 28 },
    future_provider: { windowSeconds: 600, maxPulls: 1 } });
  assert.equal(sourcePullLimit('medium', limits).minSpacingMs, 1429);
  assert.equal(sourcePullLimit('future_provider', limits).minSpacingMs, 600000);
  for (const overrides of [
    { medium: { windowSeconds: 20, maxPulls: 15 } },
    { github: { windowSeconds: 19, maxPulls: 1 } },
    { future_provider: { windowSeconds: 19, maxPulls: 1 } },
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
  assert.equal(sourcePullLimit('medium', inherited).minSpacingMs, 1429);
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
  at = 1428;
  await assert.rejects(gate.run('medium', () => calls++), { code: 'source_collection_deferred', reason: 'source_pull_limit', retryAt: 1429 });
  at = 1429;
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
  let at = 0, spacing = 1429, calls = 0;
  const gate = createSourcePullGate({ now: () => at, collectionState: () => ({ allowed: true, minSpacingMs: spacing }) });
  await assert.rejects(gate.run('medium', () => { calls++; throw new Error('Provider unavailable'); }), /Provider unavailable/);
  at = 7000; spacing = 15000;
  await assert.rejects(gate.run('medium', () => calls++), { code: 'source_collection_deferred', retryAt: 15000 });
  at = 15000;
  await gate.run('medium', () => calls++);
  spacing = 1; at = 16428;
  await assert.rejects(gate.run('medium', () => calls++), { code: 'source_collection_deferred', retryAt: 16429 });
  at = 16429;
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
