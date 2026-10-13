'use strict';

const TARGET_CYCLE_MS = 5 * 60 * 1000;
const MAX_CYCLE_MS = 10 * 60 * 1000;

function retryUntil(error, now, failures) {
  const value = error?.headers?.['retry-after'];
  const retry = Number(value);
  const headerUntil = value && !Number.isFinite(retry) ? Date.parse(value) : now + Math.max(0, retry || 0) * 1000;
  return Math.max(Number.isFinite(headerUntil) ? headerUntil : 0,
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
    targetCycleMs = TARGET_CYCLE_MS, providerUntil = () => 0, startDelayMs = 0 }) {
    if (sources.has(id)) throw new Error(`Source already registered: ${id}`);
    const uniqueKeys = [...new Map(keys.filter(key => key != null).map(key => [String(key), key])).values()];
    if (!uniqueKeys.length || typeof collect !== 'function') throw new Error(`Source has no collection inventory: ${id}`);
    const spacing = Math.max(1000, minSpacingMs);
    const intervalMs = Math.max(spacing, targetCycleMs / uniqueKeys.length);
    const source = { id, keys: uniqueKeys, collect, enabled, providerUntil, minSpacingMs: spacing, intervalMs,
      cursor: 0, registeredAt: now(), nextAt: now() + startDelayMs, lastAttemptAt: null, lastSuccessAt: null,
      inFlight: null, failures: 0, backoffUntil: 0, lastError: null, completedKeys: new Set(), keySuccessAt: new Map(),
      cycleStartedAt: null, lastCycleFinishedAt: null, lastCycleDurationMs: null, lastDurationMs: null,
      totalRuns: 0, waiters: [] };
    sources.set(id, source);
    return source;
  }

  function gate(source) {
    if (!source.enabled()) return 'disabled';
    if (!canRun()) return 'protected';
    if (now() < Math.max(source.backoffUntil, source.providerUntil() || 0)) return 'backoff';
    return null;
  }

  function settle(source, result) {
    const waiters = source.waiters.splice(0);
    for (const resolve of waiters) resolve(result);
  }

  function launch(source) {
    const started = now(), key = source.keys[source.cursor];
    source.cursor = (source.cursor + 1) % source.keys.length;
    source.lastAttemptAt = started;
    source.cycleStartedAt ??= started;
    source.nextAt = started + source.intervalMs;
    active++;
    let outcome;
    const task = Promise.resolve().then(() => source.collect(key)).then(result => {
      if (result?.deferred) {
        source.nextAt = Math.max(source.nextAt, now() + 1000);
        outcome = result;
        return;
      }
      source.lastSuccessAt = now();
      source.lastError = null;
      source.failures = 0;
      source.backoffUntil = 0;
      source.totalRuns++;
      source.completedKeys.add(String(key));
      source.keySuccessAt.set(String(key), now());
      if (source.completedKeys.size === source.keys.length) {
        source.lastCycleFinishedAt = now();
        source.lastCycleDurationMs = now() - source.cycleStartedAt;
        source.cycleStartedAt = null;
        source.completedKeys.clear();
      }
      outcome = { ...result, scannedTopics: 1, deferred: false };
    }, error => {
      source.failures++;
      source.lastError = String(error?.message || error).slice(0, 500);
      source.backoffUntil = retryUntil(error, now(), source.failures);
      source.nextAt = Math.max(source.nextAt, source.backoffUntil);
      onError(source.id, error);
      outcome = { deferred: true, error: source.lastError, retryAt: source.backoffUntil };
    }).finally(() => {
      source.lastDurationMs = now() - started;
      source.inFlight = null;
      active--;
      settle(source, outcome);
    });
    source.inFlight = task;
    return task;
  }

  function pump() {
    if (stopped || !canRun()) return [];
    const due = [...sources.values()].filter(source => !source.inFlight && source.nextAt <= now() && !gate(source))
      .sort((a, b) => (a.lastAttemptAt ?? -Infinity) - (b.lastAttemptAt ?? -Infinity) || a.nextAt - b.nextAt);
    const tasks = [];
    for (const source of due) {
      if (active >= slotLimit()) break;
      tasks.push(launch(source));
    }
    return tasks;
  }

  function request(id) {
    const source = sources.get(id);
    if (!source) return Promise.resolve({ deferred: false, skipped: 'unconfigured' });
    const blocked = gate(source);
    if (blocked) return Promise.resolve({ deferred: true, reason: blocked,
      retryAt: Math.max(source.backoffUntil, source.providerUntil() || 0) || null });
    const result = new Promise(resolve => source.waiters.push(resolve));
    // Repeated refreshes share the running request; manual requests never bypass
    // provider spacing or start a parallel all-topic sweep.
    if (!source.inFlight) {
      source.nextAt = Math.min(source.nextAt, Math.max(now(), (source.lastAttemptAt ?? -Infinity) + source.minSpacingMs));
      pump();
    }
    return result;
  }

  function nudge(ids) {
    const accepted = [];
    for (const id of new Set(ids)) {
      const source = sources.get(id);
      if (!source || !source.enabled()) continue;
      if (!source.inFlight) source.nextAt = Math.min(source.nextAt, Math.max(now(), (source.lastAttemptAt ?? -Infinity) + source.minSpacingMs));
      accepted.push(id);
    }
    pump();
    return accepted;
  }

  function status() {
    const sampledAt = now();
    const inventory = [...sources.values()].map(source => {
      const enabled = source.enabled(), blockedUntil = Math.max(source.backoffUntil, source.providerUntil() || 0);
      const ageMs = source.lastSuccessAt == null ? null : sampledAt - source.lastSuccessAt;
      const keyAges = source.keys.map(key => sampledAt - (source.keySuccessAt.get(String(key)) ?? source.registeredAt));
      return { id: source.id, enabled, keyCount: source.keys.length, completedKeys: source.completedKeys.size,
        intervalMs: source.intervalMs, expectedCycleMs: Math.ceil(source.keys.length * source.intervalMs),
        coverageLimited: source.keys.length * source.intervalMs > MAX_CYCLE_MS,
        staleKeyCount: keyAges.filter(age => age > MAX_CYCLE_MS).length,
        oldestKeyAgeMs: Math.max(0, ...keyAges),
        cycleOverdue: enabled && keyAges.some(age => age > MAX_CYCLE_MS),
        lastAttemptAt: source.lastAttemptAt, lastSuccessAt: source.lastSuccessAt, ageMs,
        overdue: enabled && (ageMs == null ? sampledAt - source.registeredAt > MAX_CYCLE_MS : ageMs > MAX_CYCLE_MS),
        inFlight: Boolean(source.inFlight), inFlightMs: source.inFlight ? sampledAt - source.lastAttemptAt : 0,
        nextAt: Math.max(source.nextAt, blockedUntil), backoffUntil: blockedUntil || null,
        lastError: source.lastError, failures: source.failures, totalRuns: source.totalRuns,
        lastCycleFinishedAt: source.lastCycleFinishedAt, lastCycleDurationMs: source.lastCycleDurationMs,
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
