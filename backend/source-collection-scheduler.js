'use strict';

const TARGET_CYCLE_MS = 5 * 60 * 1000;
const MAX_CYCLE_MS = 10 * 60 * 1000;
const DEFAULT_COLLECTION_INTERVAL_MS = 20 * 1000;
const MIN_NORMAL_COLLECTION_INTERVAL_MS = 12 * 1000;
const MAX_NORMAL_COLLECTION_INTERVAL_MS = 25 * 1000;
const UNUSED_SHARD_DELAY_MS = 250;
const PACING_REASONS = new Set(['source_pull_limit', 'source_in_flight']);

function retryUntil(error, now, failures) {
  const value = error?.headers?.['retry-after'];
  const retry = Number(value);
  const headerUntil = value && !Number.isFinite(retry) ? Date.parse(value) : now + Math.max(0, retry || 0) * 1000;
  const retryAfter = Number(error?.retryAfter);
  const adapterUntil = Number.isFinite(retryAfter) && retryAfter >= 0 ? now + retryAfter * 1000 : 0;
  return Math.max(Number.isFinite(headerUntil) ? headerUntil : 0,
    adapterUntil,
    now + Math.min(MAX_CYCLE_MS, 30000 * 2 ** Math.min(5, Math.max(0, failures - 1))));
}

// One timer and a finite source inventory replace one permanent loop per shard.
// Each source gets one slot at a time, shared by automatic and manual requests.
// A provider's Retry-After or quota reset always wins over our freshness target.
function createSourceCollectionScheduler({ concurrency = 4, startWindowMs = 0, now = Date.now, schedule = setInterval,
  cancel = clearInterval, canRun = () => true, effectiveConcurrency, onError = () => {} } = {}) {
  concurrency = Math.max(1, Math.min(4, Number(concurrency) || 4));
  const sources = new Map();
  let active = 0, timer = null, stopped = false, lastStartAt = -Infinity;
  const slotLimit = () => Math.max(1, Math.min(concurrency, Number(effectiveConcurrency?.()) || concurrency));
  const nextStartAt = () => lastStartAt + Math.ceil(startWindowMs / slotLimit());
  const tickMs = startWindowMs > 0 ? Math.min(1000, Math.ceil(startWindowMs / concurrency)) : 1000;

  function register({ id, keys, collect, enabled = () => true, minSpacingMs = 1000,
    targetCycleMs = TARGET_CYCLE_MS, targetIntervalMs = null, pullBudget = null, providerUntil = () => 0, startDelayMs = 0,
    collectionState = () => ({ allowed: true }) }) {
    if (sources.has(id)) throw new Error(`Source already registered: ${id}`);
    const uniqueKeys = [...new Map(keys.filter(key => key != null).map(key => [String(key), key])).values()];
    if (!uniqueKeys.length || typeof collect !== 'function') throw new Error(`Source has no collection inventory: ${id}`);
    let shardSpacingMs = 0;
    if (pullBudget) {
      const shards = pullBudget.maxPulls;
      const activeShards = Math.min(shards, uniqueKeys.length);
      const windowMs = pullBudget.windowSeconds * 1000;
      // Give larger pull windows more time, and space repeat checks when the
      // inventory has fewer distinct keys than the configured shard count.
      const activeSpacingMs = Math.max(MIN_NORMAL_COLLECTION_INTERVAL_MS, windowMs * 0.75,
        (windowMs + windowMs / activeShards) / 2);
      const spareSlots = shards - activeShards;
      shardSpacingMs = Math.min(MAX_NORMAL_COLLECTION_INTERVAL_MS, Math.ceil(activeSpacingMs + spareSlots * UNUSED_SHARD_DELAY_MS));
    }
    const spacing = Math.max(1000, minSpacingMs, shardSpacingMs);
    const requestedInterval = Number.isFinite(targetIntervalMs) && targetIntervalMs > 0
      ? targetIntervalMs : shardSpacingMs || Math.min(DEFAULT_COLLECTION_INTERVAL_MS, targetCycleMs / uniqueKeys.length);
    const intervalMs = Math.max(spacing, Math.ceil(requestedInterval));
    const source = { id, keys: uniqueKeys, collect, enabled, providerUntil, collectionState, minSpacingMs: spacing, intervalMs,
      cursor: 0, registeredAt: now(), nextAt: now() + startDelayMs, lastAttemptAt: null, lastSuccessAt: null, lastBatchPosts: 0,
      inFlight: null, failures: 0, backoffUntil: 0, deferredUntil: 0, deferredReason: null, lastError: null, completedKeys: new Set(), keySuccessAt: new Map(),
      keyFailures: new Map(), attemptedKeys: new Set(), cycleStartedAt: null,
      lastCycleFinishedAt: null, lastCycleDurationMs: null, lastDurationMs: null,
      lastAttemptCycleFinishedAt: null, lastAttemptCycleDurationMs: null,
      lastAttemptCycleSuccessfulKeys: 0, lastAttemptCycleFailedKeys: 0,
      totalRuns: 0, skippedRuns: 0, lastSkippedAt: null, lastSkipReason: null, waiters: [] };
    sources.set(id, source);
    return source;
  }

  function readCollectionState(source) {
    try {
      const state = source.collectionState();
      if (!state || typeof state.allowed !== 'boolean') throw new Error('Collection policy unavailable');
      // Use the previous batch to pace the next start within the normal window.
      // Admission and backlog checks enforce the saved cap when the batch is larger.
      const postSpacingMs = state.postLimitPerMinute > 0
        ? Math.min(MAX_NORMAL_COLLECTION_INTERVAL_MS, Math.ceil(source.lastBatchPosts * 60000 / state.postLimitPerMinute)) : 0;
      return { ...state, minSpacingMs: Math.max(source.minSpacingMs, Number(state.minSpacingMs) || 0, postSpacingMs) };
    } catch { return { allowed: false, reason: 'policy_unavailable', retryAt: null, remaining: 0, minSpacingMs: source.minSpacingMs }; }
  }

  function gate(source, state = readCollectionState(source)) {
    if (!source.enabled()) return { reason: state.reason === 'setup_required' ? 'setup_required' : 'disabled', retryAt: null };
    if (!canRun()) return { reason: 'protected', retryAt: null };
    if (!state.allowed) {
      const reason = state.reason || 'policy_unavailable';
      const retryAt = PACING_REASONS.has(reason) ? Math.max(state.retryAt || 0, spacingDueAt(source, state)) : state.retryAt;
      return { reason, retryAt: retryAt || null };
    }
    const providerRetryAt = Math.max(source.backoffUntil, source.providerUntil() || 0);
    if (now() < providerRetryAt) return { reason: 'backoff', retryAt: providerRetryAt };
    if (now() < source.deferredUntil) return { reason: source.deferredReason || 'deferred', retryAt: source.deferredUntil };
    return null;
  }

  const spacingDueAt = (source, state) => (source.lastAttemptAt ?? -Infinity) + state.minSpacingMs;

  function settle(source, result) {
    const waiters = source.waiters.splice(0);
    for (const resolve of waiters) resolve(result);
  }

  function defer(source, result, keyIndex, previousAttemptAt) {
    source.cursor = keyIndex;
    source.lastAttemptAt = previousAttemptAt;
    source.deferredUntil = Math.max(now() + 1000, Number(result.retryAt) || 0);
    source.deferredReason = result.reason || 'deferred';
    source.nextAt = source.deferredUntil;
  }

  function availableKey(source, at = now()) {
    for (let offset = 0; offset < source.keys.length; offset++) {
      const index = (source.cursor + offset) % source.keys.length;
      const key = source.keys[index];
      if ((source.keyFailures.get(String(key))?.retryAt || 0) <= at) return { key, index };
    }
    return null;
  }

  function nextKeyRetryAt(source) {
    return Math.min(...source.keys.map(key => source.keyFailures.get(String(key))?.retryAt || now()));
  }

  function launch(source) {
    const state = readCollectionState(source), blocked = gate(source, state);
    if (blocked) { settle(source, { deferred: true, ...blocked }); return null; }
    if (now() < spacingDueAt(source, state)) return null;
    const started = now(), selected = availableKey(source, started);
    if (!selected) { source.nextAt = Math.max(source.nextAt, nextKeyRetryAt(source)); return null; }
    const key = selected.key;
    const previousAttemptAt = source.lastAttemptAt;
    source.cursor = (selected.index + 1) % source.keys.length;
    source.lastAttemptAt = started;
    lastStartAt = started;
    source.cycleStartedAt ??= started;
    source.nextAt = started + source.intervalMs;
    active++;
    let outcome;
    const task = Promise.resolve().then(() => source.collect(key)).then(result => {
      if (result?.deferred) {
        defer(source, result, selected.index, previousAttemptAt);
        outcome = result;
        return;
      }
      if (result?.skipped) {
        source.skippedRuns++;
        source.lastSkippedAt = now();
        source.lastSkipReason = String(result.skipped).slice(0, 80);
        outcome = { ...result, deferred: false };
        return;
      }
      source.lastSuccessAt = now();
      if (Number.isSafeInteger(result?.posts) && result.posts >= 0) source.lastBatchPosts = result.posts;
      source.lastSkipReason = null;
      source.lastError = null;
      source.failures = 0;
      source.backoffUntil = 0;
      source.deferredUntil = 0;
      source.deferredReason = null;
      source.totalRuns++;
      source.completedKeys.add(String(key));
      source.keySuccessAt.set(String(key), now());
      source.keyFailures.delete(String(key));
      outcome = { ...result, scannedTopics: 1, deferred: false };
    }, error => {
      if (error?.code === 'source_collection_deferred') {
        outcome = { deferred: true, reason: error.reason || 'source_capacity', retryAt: error.retryAt || null };
        defer(source, outcome, selected.index, previousAttemptAt);
        return;
      }
      source.completedKeys.delete(String(key));
      source.lastError = String(error?.message || error).slice(0, 500);
      if (error?.collectionKeyFailure === true && [404, 410].includes(error.status)) {
        // A missing channel is not a provider outage. Preserve its failure
        // evidence, retry it after a normal cycle, and keep other keys moving.
        const previous = source.keyFailures.get(String(key));
        source.keyFailures.set(String(key), { key: String(key), status: error.status,
          error: source.lastError, failedAt: now(), retryAt: now() + TARGET_CYCLE_MS,
          attempts: (previous?.attempts || 0) + 1 });
      } else {
        source.failures++;
        source.backoffUntil = retryUntil(error, now(), source.failures);
        source.nextAt = Math.max(source.nextAt, source.backoffUntil);
      }
      onError(source.id, error);
      outcome = { deferred: true, error: source.lastError,
        retryAt: source.keyFailures.get(String(key))?.retryAt || source.backoffUntil };
    }).finally(() => {
      if (!outcome?.skipped && (!outcome?.deferred || outcome?.error)) source.attemptedKeys.add(String(key));
      if (source.attemptedKeys.size === source.keys.length) {
        source.lastAttemptCycleFinishedAt = now();
        source.lastAttemptCycleDurationMs = now() - source.cycleStartedAt;
        source.lastAttemptCycleSuccessfulKeys = source.completedKeys.size;
        source.lastAttemptCycleFailedKeys = source.keys.length - source.completedKeys.size;
        if (source.completedKeys.size === source.keys.length) {
          source.lastCycleFinishedAt = now();
          source.lastCycleDurationMs = source.lastAttemptCycleDurationMs;
        }
        source.cycleStartedAt = null;
        source.attemptedKeys.clear();
        source.completedKeys.clear();
      }
      source.lastDurationMs = now() - started;
      source.inFlight = null;
      active--;
      settle(source, outcome);
    });
    source.inFlight = task;
    return task;
  }

  function pump() {
    if (stopped) return [];
    const due = [...sources.values()].filter(source => {
      if (source.inFlight) return false;
      const state = readCollectionState(source), blocked = gate(source, state);
      if (blocked) { settle(source, { deferred: true, ...blocked }); return false; }
      return Math.max(source.nextAt, spacingDueAt(source, state)) <= now();
    })
      .sort((a, b) => (a.lastAttemptAt ?? -Infinity) - (b.lastAttemptAt ?? -Infinity) || a.nextAt - b.nextAt);
    const tasks = [];
    for (const source of due) {
      if (active >= slotLimit() || now() < nextStartAt()) break;
      const task = launch(source);
      if (task) tasks.push(task);
    }
    return tasks;
  }

  function request(id) {
    const source = sources.get(id);
    if (!source) return Promise.resolve({ deferred: false, skipped: 'unconfigured' });
    const state = readCollectionState(source), blocked = gate(source, state);
    if (blocked) {
      if (!source.inFlight) settle(source, { deferred: true, ...blocked });
      return Promise.resolve({ deferred: true, ...blocked });
    }
    if (!source.inFlight && !availableKey(source)) return Promise.resolve({ deferred: true,
      reason: 'key_backoff', retryAt: nextKeyRetryAt(source) });
    const result = new Promise(resolve => source.waiters.push(resolve));
    // Repeated refreshes share the running request; manual requests never bypass
    // provider spacing or start a parallel all-topic sweep.
    if (!source.inFlight) {
      source.nextAt = Math.min(source.nextAt, Math.max(now(), spacingDueAt(source, state)));
      pump();
    }
    return result;
  }

  function nudge(ids) {
    const accepted = [];
    for (const id of new Set(ids)) {
      const source = sources.get(id);
      if (!source) continue;
      const state = readCollectionState(source), blocked = gate(source, state);
      if (blocked) { if (!source.inFlight) settle(source, { deferred: true, ...blocked }); continue; }
      if (!source.inFlight) source.nextAt = Math.min(source.nextAt, Math.max(now(), spacingDueAt(source, state)));
      accepted.push(id);
    }
    pump();
    return accepted;
  }

  function status() {
    const sampledAt = now();
    const inventory = [...sources.values()].map(source => {
      const state = readCollectionState(source), blocked = gate(source, state);
      const enabled = source.enabled(), providerUntil = Math.max(source.backoffUntil, source.providerUntil() || 0);
      const deferredPauseUntil = PACING_REASONS.has(source.deferredReason) ? 0 : source.deferredUntil;
      // A routine spacing/in-flight wait is scheduling information, not a
      // provider failure or policy pause. Office uses backoffUntil as health.
      const backoffUntil = Math.max(providerUntil, deferredPauseUntil,
        state.allowed || PACING_REASONS.has(state.reason) ? 0 : state.retryAt || 0);
      const waitUntil = Math.max(providerUntil, source.deferredUntil, state.allowed ? 0 : state.retryAt || 0);
      const pause = blocked && !PACING_REASONS.has(blocked.reason) ? blocked
        : providerUntil > sampledAt ? { reason: 'backoff', retryAt: providerUntil }
          : deferredPauseUntil > sampledAt ? { reason: source.deferredReason || 'deferred', retryAt: deferredPauseUntil } : null;
      const intervalMs = Math.max(source.intervalMs, state.minSpacingMs);
      const ageMs = source.lastSuccessAt == null ? null : sampledAt - source.lastSuccessAt;
      const keyAges = source.keys.map(key => sampledAt - (source.keySuccessAt.get(String(key)) ?? source.registeredAt));
      return { id: source.id, enabled, keyCount: source.keys.length, completedKeys: source.completedKeys.size,
        attemptedKeys: source.attemptedKeys.size, failedKeyCount: source.keyFailures.size,
        failedKeys: [...source.keyFailures.values()],
        intervalMs, minSpacingMs: state.minSpacingMs, expectedCycleMs: Math.ceil(source.keys.length * intervalMs),
        collectionReason: state.allowed ? null : state.reason || 'policy_unavailable', collectionRetryAt: state.allowed ? null : state.retryAt || null,
        remainingAdmission: state.remaining ?? null, pauseReason: pause?.reason || null, retryAt: pause?.retryAt || blocked?.retryAt || null,
        coverageLimited: source.keys.length * intervalMs > MAX_CYCLE_MS,
        staleKeyCount: keyAges.filter(age => age > MAX_CYCLE_MS).length,
        oldestKeyAgeMs: Math.max(0, ...keyAges),
        cycleOverdue: enabled && keyAges.some(age => age > MAX_CYCLE_MS),
        lastAttemptAt: source.lastAttemptAt, lastSuccessAt: source.lastSuccessAt, ageMs,
        overdue: enabled && (ageMs == null ? sampledAt - source.registeredAt > MAX_CYCLE_MS : ageMs > MAX_CYCLE_MS),
        inFlight: Boolean(source.inFlight), inFlightMs: source.inFlight ? sampledAt - source.lastAttemptAt : 0,
        nextAt: Math.max(source.nextAt, spacingDueAt(source, state), nextStartAt(), waitUntil, availableKey(source, sampledAt) ? 0 : nextKeyRetryAt(source)), backoffUntil: backoffUntil || null,
        lastError: source.lastError, failures: source.failures, totalRuns: source.totalRuns,
        skippedRuns: source.skippedRuns, lastSkippedAt: source.lastSkippedAt, lastSkipReason: source.lastSkipReason,
        lastCycleFinishedAt: source.lastCycleFinishedAt, lastCycleDurationMs: source.lastCycleDurationMs,
        lastAttemptCycleFinishedAt: source.lastAttemptCycleFinishedAt, lastAttemptCycleDurationMs: source.lastAttemptCycleDurationMs,
        lastAttemptCycleSuccessfulKeys: source.lastAttemptCycleSuccessfulKeys, lastAttemptCycleFailedKeys: source.lastAttemptCycleFailedKeys,
        lastDurationMs: source.lastDurationMs };
    });
    return { targetCycleMs: TARGET_CYCLE_MS, maxCycleMs: MAX_CYCLE_MS, maxCollectionIntervalMs: MAX_NORMAL_COLLECTION_INTERVAL_MS,
      maxConcurrency: concurrency, effectiveConcurrency: slotLimit(), active,
      total: inventory.length, enabled: inventory.filter(source => source.enabled).length,
      overdue: inventory.filter(source => source.overdue).map(source => source.id),
      coverageOverdue: inventory.filter(source => source.cycleOverdue).map(source => source.id),
      sources: inventory, sampledAt };
  }

  return { register, request, nudge, pump, status,
    start() { stopped = false; if (!timer) { timer = schedule(pump, tickMs); timer?.unref?.(); } pump(); },
    stop() { stopped = true; if (timer) cancel(timer); timer = null; for (const source of sources.values()) settle(source, { deferred: true, reason: 'stopped' }); },
  };
}

module.exports = { createSourceCollectionScheduler, TARGET_CYCLE_MS, MAX_CYCLE_MS, retryUntil };
