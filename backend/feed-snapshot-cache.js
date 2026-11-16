'use strict';

// A conservative weight for the JSON-shaped data the feed retains. Count
// strings without serializing entire snapshots or allocating UTF-8 buffers.
function estimateFeedValueBytes(value) {
  if (typeof value === 'string') return 24 + value.length * 2;
  if (value === null || typeof value !== 'object') return 8;
  if (Array.isArray(value)) {
    let bytes = 32;
    for (const item of value) bytes += 8 + estimateFeedValueBytes(item);
    return bytes;
  }
  let bytes = 64;
  for (const key of Object.keys(value)) bytes += 16 + estimateFeedValueBytes(value[key]);
  return bytes;
}

function createFeedSnapshotCache({ maxEntries, maxBytes, ttlMs, now = Date.now,
  capacityFraction = () => 1, cacheable = () => true }) {
  const entries = new Map();
  const builds = new Map();
  let bytes = 0;

  function remove(key) {
    const entry = entries.get(key);
    if (!entry) return false;
    bytes -= entry.bytes;
    return entries.delete(key);
  }

  function get(key) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (now() >= entry.expiresAt) {
      remove(key);
      return undefined;
    }
    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  }

  function trim(fraction = capacityFraction()) {
    for (const key of entries.keys()) {
      if (bytes <= maxBytes * fraction && entries.size <= Math.floor(maxEntries * fraction)) break;
      remove(key);
    }
  }

  function set(key, value) {
    remove(key);
    if (!cacheable(value)) return;
    const weight = 64 + key.length * 2 + estimateFeedValueBytes(value);
    const fraction = capacityFraction();
    if (weight > maxBytes * fraction) return;
    entries.set(key, { value, bytes: weight, expiresAt: (value.computedAt ?? now()) + ttlMs });
    bytes += weight;
    trim(fraction);
  }

  async function getOrBuild(key, build) {
    const existing = get(key);
    if (existing !== undefined) return existing;
    if (builds.has(key)) return builds.get(key);

    const pending = Promise.resolve().then(build).then(value => {
      // A cleared build cannot restore stale data or delete a new build's slot.
      if (builds.get(key) === pending) set(key, value);
      return value;
    }).finally(() => {
      if (builds.get(key) === pending) builds.delete(key);
    });
    builds.set(key, pending);
    return pending;
  }

  function pruneExpired(sampledAt = now()) {
    let removed = 0;
    for (const [key, entry] of entries) {
      if (sampledAt >= entry.expiresAt && remove(key)) removed++;
    }
    return removed;
  }

  return {
    get, set, getOrBuild, trim, pruneExpired,
    delete: remove,
    clear() { entries.clear(); builds.clear(); bytes = 0; },
    keys: () => entries.keys(),
    *values() { for (const entry of entries.values()) yield entry.value; },
    *entries() { for (const [key, entry] of entries) yield [key, entry.value]; },
    get size() { return entries.size; },
    get bytes() { return bytes; },
  };
}

module.exports = { createFeedSnapshotCache, estimateFeedValueBytes };
