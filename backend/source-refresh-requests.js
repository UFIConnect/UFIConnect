'use strict';

// Coalesced requests cross the API/Pipeline process boundary through their
// existing shared database. The public API never waits for upstream fetches.
function createSourceRefreshRequests({ db, sourceIds, now = Date.now }) {
  const allowed = new Set(sourceIds);
  let initializing = null;
  async function initialize() {
    if (!db.isConnected()) return false;
    if (!initializing) initializing = db.query(`CREATE TABLE IF NOT EXISTS feed_source_refresh_requests (
      source TEXT PRIMARY KEY, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).then(() => true).catch(error => { initializing = null; throw error; });
    return initializing;
  }
  async function enqueue(ids = [...allowed]) {
    const accepted = [...new Set(ids)].filter(id => allowed.has(id));
    if (!accepted.length) return { queued: false, sourceIds: [], requestedAt: null };
    if (!await initialize()) return { queued: false, sourceIds: [], requestedAt: null, reason: 'storage_unavailable' };
    const requestedAt = new Date(now()).toISOString();
    await db.query(`INSERT INTO feed_source_refresh_requests (source, requested_at)
      SELECT unnest($1::text[]), $2::timestamptz ON CONFLICT (source) DO UPDATE
      SET requested_at=GREATEST(feed_source_refresh_requests.requested_at, EXCLUDED.requested_at)`, [accepted, requestedAt]);
    return { queued: true, sourceIds: accepted, requestedAt };
  }
  async function take() {
    if (!await initialize()) return [];
    // Atomic deletion returns each source at most once. Requests arriving after
    // this statement form the next batch, including requests during collection.
    const { rows } = await db.query(`DELETE FROM feed_source_refresh_requests
      WHERE source=ANY($1::text[]) RETURNING source, requested_at`, [[...allowed]]);
    return rows.map(row => row.source).filter(id => allowed.has(id));
  }
  return { initialize, enqueue, take };
}

module.exports = { createSourceRefreshRequests };
