'use strict';

// Application collection budgets. These bound starts across topic workers and
// manual refreshes; a provider's stricter quota or Retry-After still wins.
const FALLBACK_SOURCE_PULL_LIMIT = Object.freeze({ windowSeconds: 20, maxPulls: 1 });
// Used only by the one-time stored-policy migration. Preserve custom ceilings.
const LEGACY_SLOW_SOURCE_PULL_LIMITS = Object.freeze(Object.fromEntries([
  [240, ['github', 'arxiv', 'usajobs']],
  [300, ['stackoverflow', 'twitter', 'linkedin', 'facebook', 'openalex']],
  [60, ['cntraveler', 'weworkremotely', 'twitch', 'crossref', 'datacite', 'zenodo']],
].flatMap(([windowSeconds, ids]) => ids.map(id => [id, Object.freeze({ windowSeconds, maxPulls: 1 })]))));
// The reference photo specifies an interval per shard. Keep its shard counts
// and cap the updated pull budget window at twenty seconds.
const photoBudgets = [
  [15, 8, ['reddit']],
  [20, 10, ['hackernews', 'mastodon']],
  [30, 12, ['bluesky']],
  [60, 12, ['devto', 'indeed', 'techcrunch', 'theverge']],
  [90, 14, ['medium', 'youtube', 'hashnode', 'producthunt', 'arstechnica', 'wired', 'venturebeat', 'phoronix']],
  [120, 18, ['theregister', 'remoteok', 'behance']],
  [180, 20, ['indiehackers', 'smashing', 'infoq', 'mittr', 'gitlab', 'yc', 'crunchbase', 'designweb']],
  [240, 16, ['lobsters']],
  [240, 1, ['github', 'arxiv', 'usajobs']],
  [300, 1, ['stackoverflow', 'twitter', 'linkedin', 'facebook']],
  [20, 1, ['remotive', 'muse']],
];
// Sites absent from the photo follow comparable collectors: news (12),
// video (14), job boards (18), and scholarly APIs (1, like arXiv).
const addedBudgets = [
  [20, 12, ['cntraveler']],
  [20, 14, ['twitch']],
  [20, 18, ['weworkremotely']],
  [20, 1, ['crossref', 'datacite', 'zenodo', 'openalex']],
];
const DEFAULT_SOURCE_PULL_LIMITS = Object.freeze(Object.fromEntries([...photoBudgets, ...addedBudgets].flatMap(
  ([seconds, maxPulls, ids]) => ids.map(id => [id, Object.freeze({ windowSeconds: Math.min(20, seconds), maxPulls })]),
)));
// Exact shipped v2 defaults, used only to migrate unchanged saved settings.
const PREVIOUS_SOURCE_PULL_LIMITS = Object.freeze(Object.fromEntries([
  ...photoBudgets.map(([seconds, shards, ids]) => [shards === 1 ? Math.min(20, seconds) : seconds, shards, ids]),
  [20, 1, addedBudgets.flatMap(([, , ids]) => ids)],
].flatMap(([windowSeconds, maxPulls, ids]) => ids.map(id => [id, Object.freeze({ windowSeconds, maxPulls })]))));
const forbiddenIds = new Set(['__proto__', 'prototype', 'constructor']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const plainObject = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function canonicalId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,79}$/.test(id) || forbiddenIds.has(id)) return null;
  return id === 'hn' ? 'hackernews' : id;
}

function validateLimit(id, value) {
  if (!plainObject(value) || Object.keys(value).length !== 2
    || !own(value, 'windowSeconds') || !own(value, 'maxPulls')) {
    throw new Error(`Provide windowSeconds and maxPulls for source ${id}.`);
  }
  const { windowSeconds, maxPulls } = value;
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86400) {
    throw new Error(`Invalid windowSeconds for source ${id}; use 1 to 86400.`);
  }
  if (!Number.isInteger(maxPulls) || maxPulls < 1 || maxPulls > 10000) {
    throw new Error(`Invalid maxPulls for source ${id}; use 1 to 10000.`);
  }
  const ceiling = DEFAULT_SOURCE_PULL_LIMITS[id] || FALLBACK_SOURCE_PULL_LIMIT;
  // Compare exact integer ratios, not rounded milliseconds. Equivalent windows
  // are valid, but cannot weaken the configured collection ceiling.
  if (maxPulls * ceiling.windowSeconds > ceiling.maxPulls * windowSeconds) {
    throw new Error(`Source ${id} cannot exceed ${ceiling.maxPulls} pulls per ${ceiling.windowSeconds} seconds.`);
  }
  return { windowSeconds, maxPulls };
}

function normalizeSourcePullLimits(overrides, current = DEFAULT_SOURCE_PULL_LIMITS) {
  if (!plainObject(overrides) || !plainObject(current)) throw new Error('Provide source pull limits as an object.');
  const next = {};
  for (const entries of [current, overrides]) {
    const supplied = new Set();
    for (const [rawId, value] of Object.entries(entries)) {
      const id = canonicalId(rawId);
      if (!id) throw new Error(`Invalid source ID: ${rawId}.`);
      if (supplied.has(id)) throw new Error(`Provide source ${id} only once; hn is an alias of hackernews.`);
      supplied.add(id);
      next[id] = validateLimit(id, value);
    }
  }
  return next;
}

function sourcePullLimit(source, overrides = {}) {
  const id = canonicalId(source);
  const defaults = id && own(DEFAULT_SOURCE_PULL_LIMITS, id) ? DEFAULT_SOURCE_PULL_LIMITS[id] : FALLBACK_SOURCE_PULL_LIMIT;
  let limit = defaults;
  if (id && plainObject(overrides)) {
    const key = own(overrides, id) ? id : id === 'hackernews' && own(overrides, 'hn') ? 'hn' : null;
    if (key) limit = validateLimit(id, overrides[key]);
  }
  return { ...limit, minSpacingMs: Math.ceil(limit.windowSeconds * 1000 / limit.maxPulls) };
}

function createSourcePullGate({ collectionState = () => ({ allowed: true }), now = Date.now, maxSources = 512 } = {}) {
  if (typeof collectionState !== 'function' || typeof now !== 'function') throw new TypeError('Provide collectionState and now functions.');
  if (!Number.isInteger(maxSources) || maxSources < 1 || maxSources > 10000) throw new RangeError('Invalid maximum tracked source count.');
  const entries = new Map(), longestWindowMs = 86400000;
  const allowed = () => ({ allowed: true, reason: null, retryAt: null });
  const denied = (reason, retryAt) => ({ allowed: false, reason, retryAt });
  function ownState(entry, at, minSpacingMs = entry?.minSpacingMs) {
    if (!entry) return allowed();
    const nextStart = entry.lastStart + minSpacingMs;
    if (entry.inFlight) return denied('source_in_flight', Math.max(at + 1000, nextStart));
    return at < nextStart ? denied('source_pull_limit', nextStart) : allowed();
  }
  // This is intentionally independent of collectionState. The caller may use
  // state() while assembling that callback's policy/backlog availability.
  function state(source, minSpacingMs) {
    const id = canonicalId(source);
    if (!id) return denied('invalid_source', null);
    const entry = entries.get(id);
    const spacing = entry && Number.isFinite(minSpacingMs) ? Math.max(sourcePullLimit(id).minSpacingMs, Math.ceil(minSpacingMs)) : undefined;
    return ownState(entry, now(), spacing);
  }
  function defer(check) {
    const error = new Error('Source collection is deferred.');
    error.code = 'source_collection_deferred';
    error.reason = check.reason || 'policy_unavailable';
    error.retryAt = Number.isFinite(check.retryAt) ? check.retryAt : now() + 1000;
    throw error;
  }
  async function run(source, task) {
    if (typeof task !== 'function') throw new TypeError('Provide a source collection task.');
    const id = canonicalId(source);
    if (!id) return defer(denied('invalid_source', null));
    const collection = collectionState(id);
    if (collection?.allowed !== true || collection.remaining === 0) {
      return defer({ ...collection, reason: collection?.reason || (collection?.remaining === 0 ? 'source_flood' : 'policy_unavailable') });
    }
    const at = now(), baseline = sourcePullLimit(id).minSpacingMs;
    const suppliedSpacing = Number.isFinite(collection.minSpacingMs) ? Math.ceil(collection.minSpacingMs) : baseline;
    const minSpacingMs = Math.max(baseline, suppliedSpacing);
    let entry = entries.get(id);
    if (entry) {
      // Evaluate the newly configured spacing against the actual last start.
      // A denied attempt never moves that timestamp forward.
      entry.minSpacingMs = minSpacingMs;
      const check = ownState(entry, at);
      if (!check.allowed) return defer(check);
    } else {
      // Retain timing long enough for any valid later policy tightening. Never
      // evict an in-flight request or forget an unexpired source's protection.
      for (const [key, previous] of entries) {
        if (!previous.inFlight && at - previous.lastStart >= Math.max(longestWindowMs, previous.minSpacingMs)) entries.delete(key);
      }
      if (entries.size >= maxSources) {
        const retryAt = Math.min(...[...entries.values()].map(previous => previous.inFlight
          ? Math.max(at + 1000, previous.lastStart + previous.minSpacingMs)
          : previous.lastStart + Math.max(longestWindowMs, previous.minSpacingMs)));
        return defer(denied('source_capacity', retryAt));
      }
      entry = { lastStart: at, minSpacingMs, inFlight: false };
      entries.set(id, entry);
    }
    entry.lastStart = at;
    entry.inFlight = true;
    try { return await task(); }
    finally { entry.inFlight = false; }
  }
  return { state, run };
}

module.exports = { DEFAULT_SOURCE_PULL_LIMITS, PREVIOUS_SOURCE_PULL_LIMITS, FALLBACK_SOURCE_PULL_LIMIT, LEGACY_SLOW_SOURCE_PULL_LIMITS, normalizeSourcePullLimits, sourcePullLimit, createSourcePullGate };
