'use strict';

// Process caches are collector working sets, not the API's durable inventory.
// Share one small aggregate snapshot across status polling and source browsers;
// historical post bodies are read only for bounded, source-indexed samples.
const REAL_POST_SQL = `id NOT LIKE '%\\_fallback' ESCAPE '\\'
  AND id NOT LIKE '%\\_social' ESCAPE '\\'
  AND id NOT LIKE 'social\\_%' ESCAPE '\\'
  AND id !~* '^indeed_j[0-9]+$'
  AND id !~* '^govt_g[0-9]+$'`;
const INVENTORY_SQL = `SELECT source, COUNT(*)::int AS count,
  COUNT(*) FILTER (WHERE ${REAL_POST_SQL})::int AS feed_count,
  MAX(fetched_at) AS newest_fetched_at,
  MAX(post_created_at) AS newest_post_created_at
  FROM feed_posts_cache GROUP BY source`;
const SAMPLE_SQL = `SELECT picked.* FROM unnest($1::text[]) AS requested(source)
  CROSS JOIN LATERAL (
    SELECT fp.id, fp.source, LEFT(fp.title, 500) AS title,
      LEFT(fp.content, 200) AS content, fp.author_name, fp.source_url,
      fp.likes_count, fp.comments_count, fp.post_created_at, fp.fetched_at
    FROM feed_posts_cache fp
    WHERE fp.source = requested.source AND ${REAL_POST_SQL}
    ORDER BY fp.post_created_at DESC, fp.id DESC LIMIT $2
  ) picked ORDER BY requested.source, picked.post_created_at DESC, picked.id DESC`;
const UNAVAILABLE = 'Stored feed inventory is temporarily unavailable.';
const iso = value => {
  const time = value == null ? NaN : new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const newest = (left, right) => !left || (right && right > left) ? right : left;

function createFeedSourceInventory(db, { now = Date.now, ttlMs = 60_000, retryMs = 5_000 } = {}) {
  let current = { count: null, bySource: {}, newestFetchedAt: null, newestPostCreatedAt: null, lastCheckedAt: null };
  let pending = null, lastAttemptAt = null, lastError = null;
  let sampleCache = null, samplePending = null;
  const snapshot = () => ({ ...current,
    status: current.count === null ? 'unavailable' : lastError || !db.isConnected() || now() - Date.parse(current.lastCheckedAt) >= ttlMs * 2 ? 'stale' : 'ready',
    lastError: lastError || (!db.isConnected() ? UNAVAILABLE : null),
  });
  async function refresh({ force = false } = {}) {
    if (pending) return pending;
    if (!force && lastAttemptAt !== null && now() - lastAttemptAt < (lastError ? retryMs : ttlMs)) return snapshot();
    lastAttemptAt = now();
    pending = (async () => {
      try {
        if (!db.isConnected()) throw new Error(UNAVAILABLE);
        const { rows } = await db.query(INVENTORY_SQL);
        const next = { count: 0, bySource: {}, newestFetchedAt: null, newestPostCreatedAt: null, lastCheckedAt: new Date(now()).toISOString() };
        for (const row of rows) {
          const count = Number(row.count) || 0;
          const entry = { count, feedCount: Number(row.feed_count) || 0, newestFetchedAt: iso(row.newest_fetched_at), newestPostCreatedAt: iso(row.newest_post_created_at) };
          next.bySource[String(row.source || 'unknown')] = entry;
          next.count += count;
          next.newestFetchedAt = newest(next.newestFetchedAt, entry.newestFetchedAt);
          next.newestPostCreatedAt = newest(next.newestPostCreatedAt, entry.newestPostCreatedAt);
        }
        current = next;
        lastError = null;
      } catch {
        // A failed read is unknown, never a replacement zero-count snapshot.
        lastError = UNAVAILABLE;
      }
      return snapshot();
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function samples(sources, limit = 10) {
    const selected = [...new Set(sources)].filter(source => typeof source === 'string' && source).sort();
    const sampleLimit = Math.max(1, Math.min(10, Math.floor(Number(limit) || 10)));
    if (!selected.length) return { rows: [], status: 'ready' };
    const key = JSON.stringify([selected, sampleLimit]);
    if (sampleCache?.key === key && now() < sampleCache.expiresAt) return sampleCache.result;
    if (samplePending?.key === key) return samplePending.promise;
    const previous = sampleCache?.key === key ? sampleCache.result : null;
    const promise = (async () => {
      let result;
      try {
        if (!db.isConnected()) throw new Error(UNAVAILABLE);
        const { rows } = await db.query(SAMPLE_SQL, [selected, sampleLimit]);
        result = { rows, status: 'ready' };
      } catch {
        result = { rows: previous?.rows || [], status: previous ? 'stale' : 'unavailable' };
      }
      sampleCache = { key, result, expiresAt: now() + (result.status === 'ready' ? ttlMs : retryMs) };
      return result;
    })();
    samplePending = { key, promise };
    try { return await promise; } finally { if (samplePending?.promise === promise) samplePending = null; }
  }
  return { snapshot, refresh, samples };
}

module.exports = { createFeedSourceInventory };
