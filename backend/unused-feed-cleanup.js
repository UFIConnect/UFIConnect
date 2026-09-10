'use strict';

const tables = [
  { name: 'feed_posts_cache', keep: 40000 },
  { name: 'feed_posts_archive', keep: 20000 },
  { name: 'feed_posts_staging', keep: 10000 },
];
const state = { inFlight: false, lastRun: null, lastError: null, removed: 0, byTable: {} };
const intervalMs = 5 * 60 * 1000;

async function pruneUnusedPosts(client, { batchSize = 1000, maxAgeDays = 7 } = {}) {
  const byTable = {};
  for (const table of tables) {
    // Only external, unreferenced copies are disposable. Never delete the
    // member-owned bookmark snapshot, original post, comment, or account.
    const { rows } = await client.query(`WITH ranked AS (
      SELECT p.id, p.fetched_at, p.post_created_at,
        ROW_NUMBER() OVER (ORDER BY p.fetched_at DESC NULLS LAST, p.id) AS global_rank,
        ROW_NUMBER() OVER (PARTITION BY p.source ORDER BY p.fetched_at DESC NULLS LAST, p.id) AS source_rank
      FROM ${table.name} p
      WHERE p.source <> 'uficonnect'
        ${table.name === 'feed_posts_archive' ? "AND (p.archive_reason IS DISTINCT FROM 'source-deleted' OR p.archived_at < NOW() - INTERVAL '30 days')" : ''}
        AND NOT EXISTS (SELECT 1 FROM community_posts c WHERE c.id = p.id)
        AND NOT EXISTS (SELECT 1 FROM saved_posts s WHERE s.post_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM job_tracking j WHERE j.job_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM post_comments c WHERE c.post_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM restaurant_post_likes l WHERE l.post_id = p.id)
    ), candidates AS (
      SELECT id FROM ranked
      WHERE (COALESCE(post_created_at, fetched_at) < NOW() - ($1::int * INTERVAL '1 day')
             OR (global_rank > $2 AND source_rank > 150))
        AND (fetched_at IS NULL OR fetched_at < NOW() - INTERVAL '1 hour')
      ORDER BY fetched_at ASC NULLS FIRST, id LIMIT $3
    ), removed AS (
      DELETE FROM ${table.name} p USING candidates c WHERE p.id = c.id RETURNING p.id
    ) SELECT COUNT(*)::int AS count FROM removed`, [maxAgeDays, table.keep, batchSize]);
    byTable[table.name] = Number(rows[0].count);
  }
  return { byTable, removed: Object.values(byTable).reduce((sum, count) => sum + count, 0) };
}

async function runUnusedFeedCleanup(db, { force = false } = {}) {
  if (!db.isConnected()) return { skipped: 'database-unavailable', ...state };
  if (state.inFlight || (!force && state.lastRun && Date.now() - Date.parse(state.lastRun) < intervalMs)) return { skipped: 'not-due', ...state };
  state.inFlight = true;
  try {
    const result = await db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL statement_timeout = '15s'");
        await client.query("SET LOCAL lock_timeout = '1s'");
        const lock = await client.query('SELECT pg_try_advisory_xact_lock(84719320) AS acquired');
        if (!lock.rows[0].acquired) { await client.query('ROLLBACK'); return { skipped: 'another-service' }; }
        const removed = await pruneUnusedPosts(client);
        await client.query('COMMIT');
        return removed;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
    if (!result.skipped) Object.assign(state, result, { lastRun: new Date().toISOString(), lastError: null });
    return { ...result, lastRun: state.lastRun };
  } catch (error) {
    state.lastError = error.message;
    throw error;
  } finally { state.inFlight = false; }
}

module.exports = { pruneUnusedPosts, runUnusedFeedCleanup, state };
