'use strict';

const TARGET_CYCLE_MS = 5 * 60 * 1000;
const MAX_CYCLE_MS = 10 * 60 * 1000;

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
function createSourceCollectionScheduler({ concurrency = 4, now = Date.now, schedule = setInterval,
  cancel = clearInterval, canRun = () => true, effectiveConcurrency, onError = () => {} } = {}) {
  concurrency = Math.max(1, Math.min(4, Number(concurrency) || 4));
  const sources = new Map();
  let active = 0, timer = null, stopped = false;
  const slotLimit = () => Math.max(1, Math.min(concurrency, Number(effectiveConcurrency?.()) || concurrency));

  function register({ id, keys, collect, enabled = () => true, minSpacingMs = 1000,
    targetCycleMs = TARGET_CYCLE_MS, providerUntil = () => 0, startDelayMs = 0,
    collectionState = () => ({ allowed: true }) }) {
    if (sources.has(id)) throw new Error(`Source already registered: ${id}`);
    const uniqueKeys = [...new Map(keys.filter(key => key != null).map(key => [String(key), key])).values()];
    if (!uniqueKeys.length || typeof collect !== 'function') throw new Error(`Source has no collection inventory: ${id}`);
    const spacing = Math.max(1000, minSpacingMs);
    const intervalMs = Math.max(spacing, targetCycleMs / uniqueKeys.length);
    const source = { id, keys: uniqueKeys, collect, enabled, providerUntil, collectionState, minSpacingMs: spacing, intervalMs,
      cursor: 0, registeredAt: now(), nextAt: now() + startDelayMs, lastAttemptAt: null, lastSuccessAt: null,
      inFlight: null, failures: 0, backoffUntil: 0, deferredUntil: 0, deferredReason: null, lastError: null, completedKeys: new Set(), keySuccessAt: new Map(),
      keyFailures: new Map(), attemptedKeys: new Set(), cycleStartedAt: null,
      lastCycleFinishedAt: null, lastCycleDurationMs: null, lastDurationMs: null,
      lastAttemptCycleFinishedAt: null, lastAttemptCycleDurationMs: null,
      lastAttemptCycleSuccessfulKeys: 0, lastAttemptCycleFailedKeys: 0,
      totalRuns: 0, waiters: [] };
    sources.set(id, source);
    return source;
  }

  function readCollectionState(source) {
    try {
      const state = source.collectionState();
      if (!state || typeof state.allowed !== 'boolean') throw new Error('Collection policy unavailable');
      return { ...state, minSpacingMs: Math.max(source.minSpacingMs, Number(state.minSpacingMs) || 0) };
    } catch { return { allowed: false, reason: 'policy_unavailable', retryAt: null, remaining: 0, minSpacingMs: source.minSpacingMs }; }
  }

  function gate(source, state = readCollectionState(source)) {
    if (!source.enabled()) return { reason: 'disabled', retryAt: null };
    if (!canRun()) return { reason: 'protected', retryAt: null };
    if (!state.allowed) return { reason: state.reason || 'policy_unavailable', retryAt: state.retryAt || null };
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

  function defer(source, result, keyIndex) {
    source.cursor = keyIndex;
    source.deferredUntil = Math.max(now() + 1000, Number(result.retryAt) || 0);
    source.deferredReason = result.reason || 'deferred';
    source.nextAt = Math.max(source.nextAt, source.deferredUntil);
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
    source.cursor = (selected.index + 1) % source.keys.length;
    source.lastAttemptAt = started;
    source.cycleStartedAt ??= started;
    source.nextAt = started + Math.max(source.intervalMs, state.minSpacingMs);
    active++;
    let outcome;
    const task = Promise.resolve().then(() => source.collect(key)).then(result => {
      if (result?.deferred) {
        defer(source, result, selected.index);
        outcome = result;
        return;
      }
      source.lastSuccessAt = now();
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
        defer(source, outcome, selected.index);
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
      if (!outcome?.deferred || outcome?.error) source.attemptedKeys.add(String(key));
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
      if (active >= slotLimit()) break;
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
      const enabled = source.enabled(), blockedUntil = Math.max(source.backoffUntil, source.providerUntil() || 0, source.deferredUntil, state.allowed ? 0 : state.retryAt || 0);
      const intervalMs = Math.max(source.intervalMs, state.minSpacingMs);
      const ageMs = source.lastSuccessAt == null ? null : sampledAt - source.lastSuccessAt;
      const keyAges = source.keys.map(key => sampledAt - (source.keySuccessAt.get(String(key)) ?? source.registeredAt));
      return { id: source.id, enabled, keyCount: source.keys.length, completedKeys: source.completedKeys.size,
        attemptedKeys: source.attemptedKeys.size, failedKeyCount: source.keyFailures.size,
        failedKeys: [...source.keyFailures.values()],
        intervalMs, minSpacingMs: state.minSpacingMs, expectedCycleMs: Math.ceil(source.keys.length * intervalMs),
        collectionReason: state.allowed ? null : state.reason || 'policy_unavailable', collectionRetryAt: state.allowed ? null : state.retryAt || null,
        remainingAdmission: state.remaining ?? null, pauseReason: blocked?.reason || null, retryAt: blocked?.retryAt || null,
        coverageLimited: source.keys.length * intervalMs > MAX_CYCLE_MS,
        staleKeyCount: keyAges.filter(age => age > MAX_CYCLE_MS).length,
        oldestKeyAgeMs: Math.max(0, ...keyAges),
        cycleOverdue: enabled && keyAges.some(age => age > MAX_CYCLE_MS),
        lastAttemptAt: source.lastAttemptAt, lastSuccessAt: source.lastSuccessAt, ageMs,
        overdue: enabled && (ageMs == null ? sampledAt - source.registeredAt > MAX_CYCLE_MS : ageMs > MAX_CYCLE_MS),
        inFlight: Boolean(source.inFlight), inFlightMs: source.inFlight ? sampledAt - source.lastAttemptAt : 0,
        nextAt: Math.max(source.nextAt, spacingDueAt(source, state), blockedUntil, availableKey(source, sampledAt) ? 0 : nextKeyRetryAt(source)), backoffUntil: blockedUntil || null,
        lastError: source.lastError, failures: source.failures, totalRuns: source.totalRuns,
        lastCycleFinishedAt: source.lastCycleFinishedAt, lastCycleDurationMs: source.lastCycleDurationMs,
        lastAttemptCycleFinishedAt: source.lastAttemptCycleFinishedAt, lastAttemptCycleDurationMs: source.lastAttemptCycleDurationMs,
        lastAttemptCycleSuccessfulKeys: source.lastAttemptCycleSuccessfulKeys, lastAttemptCycleFailedKeys: source.lastAttemptCycleFailedKeys,
        lastDurationMs: source.lastDurationMs };
    });
    return { targetCycleMs: TARGET_CYCLE_MS, maxCycleMs: MAX_CYCLE_MS, maxConcurrency: concurrency, effectiveConcurrency: slotLimit(), active,
      total: inventory.length, enabled: inventory.filter(source => source.enabled).length,
      overdue: inventory.filter(source => source.overdue).map(source => source.id),
      coverageOverdue: inventory.filter(source => source.cycleOverdue).map(source => source.id),
      sources: inventory, sampledAt };
  }

  return { register, request, nudge, pump, status,
    start() { stopped = false; if (!timer) { timer = schedule(pump, 1000); timer?.unref?.(); } pump(); },
    stop() { stopped = true; if (timer) cancel(timer); timer = null; for (const source of sources.values()) settle(source, { deferred: true, reason: 'stopped' }); },
  };
}

module.exports = { createSourceCollectionScheduler, TARGET_CYCLE_MS, MAX_CYCLE_MS, retryUntil };
