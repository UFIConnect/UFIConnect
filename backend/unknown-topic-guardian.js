'use strict';

const { UNKNOWN, isUnknownTopic, classifyTopic } = require('./office-topic-transfer');
const INTERVAL_MS = 15000;
const BATCH_SIZE = 500;
const UNKNOWN_SQL = "lower(btrim(COALESCE(topic,''))) = ANY($1::text[])";
const unknownLiteral = "ARRAY['','unknown','unclassified','uncategorized','general','none','null']::text[]";
const UNKNOWN_TOPIC_GUARDIAN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS office_unknown_topic_review (
    post_id TEXT PRIMARY KEY, post JSONB NOT NULL, reason TEXT NOT NULL DEFAULT 'ambiguous-topic',
    first_held_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_held_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checked_at TIMESTAMPTZ, retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), resolved_at TIMESTAMPTZ)`,
  `CREATE INDEX IF NOT EXISTS office_unknown_topic_review_retry ON office_unknown_topic_review(retry_at,post_id)`,
  `CREATE TABLE IF NOT EXISTS office_unknown_topic_guardian_state (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK(singleton), last_run TIMESTAMPTZ, last_error TEXT,
    total_checked BIGINT NOT NULL DEFAULT 0, total_classified BIGINT NOT NULL DEFAULT 0,
    total_held BIGINT NOT NULL DEFAULT 0, total_restored BIGINT NOT NULL DEFAULT 0,
    last_checked INTEGER NOT NULL DEFAULT 0, last_classified INTEGER NOT NULL DEFAULT 0,
    last_held INTEGER NOT NULL DEFAULT 0, last_restored INTEGER NOT NULL DEFAULT 0)`,
  `INSERT INTO office_unknown_topic_guardian_state(singleton) VALUES(true) ON CONFLICT DO NOTHING`,
  // A storage boundary, rather than a periodic count check, closes the burst
  // and multi-worker race. Unknown inserts are retained in the same transaction.
  `CREATE OR REPLACE FUNCTION office_guard_unknown_live_topic() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE previous_topic TEXT; has_existing BOOLEAN := false;
    BEGIN
      IF NOT (lower(btrim(COALESCE(NEW.topic,''))) = ANY(${unknownLiteral})) THEN RETURN NEW; END IF;
      IF TG_OP = 'UPDATE' THEN previous_topic := OLD.topic;
      ELSE SELECT topic INTO previous_topic FROM feed_posts_cache WHERE id=NEW.id FOR UPDATE;
        has_existing := FOUND;
      END IF;
      IF NOT (lower(btrim(COALESCE(previous_topic,''))) = ANY(${unknownLiteral})) THEN
        NEW.topic := previous_topic;
        RETURN NEW;
      END IF;
      INSERT INTO office_unknown_topic_review(post_id,post)
        VALUES(NEW.id,to_jsonb(NEW)) ON CONFLICT(post_id) DO UPDATE
        SET post=EXCLUDED.post,last_held_at=NOW(),resolved_at=NULL,retry_at=CASE
          WHEN office_unknown_topic_review.post->>'title' IS DISTINCT FROM EXCLUDED.post->>'title'
            OR office_unknown_topic_review.post->>'content' IS DISTINCT FROM EXCLUDED.post->>'content'
          THEN NOW() ELSE office_unknown_topic_review.retry_at END
        WHERE office_unknown_topic_review.resolved_at IS NOT NULL OR COALESCE((EXCLUDED.post->>'fetched_at')::timestamptz,NOW()) >=
          COALESCE((office_unknown_topic_review.post->>'fetched_at')::timestamptz,'epoch'::timestamptz);
      -- Legacy unknown rows still need the bounded drain. Keep their newest
      -- body in place until that drain atomically preserves and removes it.
      IF TG_OP = 'UPDATE' OR has_existing THEN RETURN NEW; END IF;
      RETURN NULL;
    END $$`,
  `CREATE OR REPLACE TRIGGER office_unknown_live_admission BEFORE INSERT OR UPDATE OF topic
    ON feed_posts_cache FOR EACH ROW EXECUTE FUNCTION office_guard_unknown_live_topic()`,
];

function createUnknownTopicGuardian({ db, topics, onChanged = () => {}, reconcile = async () => {}, schedule = setInterval, cancel = clearInterval, now = Date.now }) {
  let initialized = false, timer = null, busy = false, cached = null;
  const definition = { id: 'unknown_topic_guardian', name: 'Unknown topic guardian', emoji: 'TOP', category: 'Topic routing',
    serviceRole: 'api', description: 'Keeps Unknown live at zero. Classifies supported topics and preserves ambiguous posts for review before they enter the live inventory.',
    intervalMs: INTERVAL_MS, batchLimit: BATCH_SIZE, target: 0, ceiling: 500, triggerable: true };
  async function initialize() {
    await db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(721432,0)');
        await client.query("SET LOCAL lock_timeout = '5000ms'");
        for (const sql of UNKNOWN_TOPIC_GUARDIAN_SCHEMA) await client.query(sql);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    });
    initialized = true;
  }
  async function transaction(work) {
    return db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        const lock = await client.query('SELECT pg_try_advisory_xact_lock(721432,1) AS locked');
        if (!lock.rows[0]?.locked) { await client.query('ROLLBACK'); return null; }
        const value = await work(client);
        await client.query('COMMIT');
        return value;
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    });
  }
  async function drainBatch() {
    return transaction(async client => {
      const { rows } = await client.query(`SELECT * FROM feed_posts_cache WHERE ${UNKNOWN_SQL}
        ORDER BY fetched_at,id LIMIT $2 FOR UPDATE SKIP LOCKED`, [UNKNOWN, BATCH_SIZE]);
      const classified = [], held = [];
      for (const post of rows) {
        const decision = classifyTopic(post, topics);
        if (decision && !isUnknownTopic(decision.topic)) classified.push({ id: post.id, topic: decision.topic, subtopic: decision.subtopic });
        else held.push(post.id);
      }
      if (classified.length) await client.query(`UPDATE feed_posts_cache p SET topic=x.topic
        FROM jsonb_to_recordset($1::jsonb) AS x(id TEXT,topic TEXT) WHERE p.id=x.id`, [JSON.stringify(classified)]);
      if (held.length) {
        // Insert and remove within a single transaction. Any storage failure
        // rolls back both operations and leaves every live post intact.
        await client.query(`INSERT INTO office_unknown_topic_review(post_id,post,checked_at,retry_at)
          SELECT p.id,to_jsonb(p),NOW(),NOW()+INTERVAL '30 minutes' FROM feed_posts_cache p WHERE p.id=ANY($1::text[])
          ON CONFLICT(post_id) DO UPDATE SET post=EXCLUDED.post,last_held_at=NOW(),checked_at=NOW(),retry_at=EXCLUDED.retry_at,resolved_at=NULL`, [held]);
        await client.query('DELETE FROM feed_posts_cache WHERE id=ANY($1::text[])', [held]);
      }
      await client.query(`UPDATE office_unknown_topic_guardian_state SET total_checked=total_checked+$1,
        total_classified=total_classified+$2,total_held=total_held+$3 WHERE singleton`, [rows.length, classified.length, held.length]);
      return { checked: rows.length, classified: classified.length, held: held.length, changes: classified, heldIds: held };
    });
  }
  async function retryReview() {
    return transaction(async client => {
      const { rows } = await client.query(`SELECT r.post_id,r.post,live.topic AS live_topic FROM office_unknown_topic_review r
        LEFT JOIN feed_posts_cache live ON live.id=r.post_id
        WHERE r.resolved_at IS NULL AND r.retry_at<=NOW()
        ORDER BY r.retry_at,r.post_id LIMIT 100 FOR UPDATE OF r SKIP LOCKED`);
      let restored = 0;
      for (const row of rows) {
        if (!isUnknownTopic(row.live_topic)) {
          // Retain the earlier full payload as history, but an already-live
          // known post no longer belongs in the pending review count.
          await client.query('UPDATE office_unknown_topic_review SET resolved_at=NOW(),checked_at=NOW() WHERE post_id=$1', [row.post_id]);
          continue;
        }
        const decision = classifyTopic(row.post, topics);
        if (decision && !isUnknownTopic(decision.topic)) {
          // Re-enter staging, never bypass source-policy/suppression screening.
          // Promotion locks staging before review; never wait indefinitely in
          // the reverse order. A conflicting restore keeps its preserved row.
          await client.query('SAVEPOINT topic_review_restore');
          let saved = { rows: [] };
          try {
            await client.query("SET LOCAL lock_timeout = '250ms'");
            saved = await client.query(`INSERT INTO feed_posts_staging
              SELECT (jsonb_populate_record(NULL::feed_posts_staging,$1::jsonb)).*
              WHERE NOT EXISTS(SELECT 1 FROM feed_posts_cache WHERE id=$2)
              ON CONFLICT(id) DO NOTHING RETURNING id`, [JSON.stringify({ ...row.post, topic: decision.topic }), row.post_id]);
          } catch (error) {
            if (!['55P03','40P01'].includes(error.code)) throw error;
            await client.query('ROLLBACK TO SAVEPOINT topic_review_restore');
          }
          await client.query('RELEASE SAVEPOINT topic_review_restore');
          await client.query("SET LOCAL lock_timeout = '0'");
          if (saved.rows.length) {
            await client.query('DELETE FROM office_unknown_topic_review WHERE post_id=$1', [row.post_id]);
            restored++; continue;
          }
        }
        await client.query("UPDATE office_unknown_topic_review SET checked_at=NOW(),retry_at=NOW()+INTERVAL '30 minutes' WHERE post_id=$1", [row.post_id]);
      }
      await client.query('UPDATE office_unknown_topic_guardian_state SET total_restored=total_restored+$1 WHERE singleton', [restored]);
      return restored;
    });
  }
  async function run({ maxBatches = 20 } = {}) {
    if (!initialized || !db.isConnected()) return { ok: false, skipped: 'storage-unavailable' };
    if (busy) return { ok: true, skipped: 'running' };
    if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 40) throw new Error('Invalid guardian batch limit.');
    busy = true;
    const totals = { ok: true, checked: 0, classified: 0, held: 0, restored: 0 };
    const started = now();
    try {
      for (let batch = 0; batch < maxBatches; batch++) {
        const result = await drainBatch();
        if (!result) break;
        for (const key of ['checked', 'classified', 'held']) totals[key] += result[key];
        try { onChanged(result); } catch { /* Committed storage remains authoritative. */ }
        if (result.checked < BATCH_SIZE || now() - started >= 10000) break;
        await new Promise(resolve => setImmediate(resolve));
      }
      totals.restored = await retryReview() || 0;
      await reconcile();
      await db.query(`UPDATE office_unknown_topic_guardian_state SET last_run=NOW(),last_error=NULL,
        last_checked=$1,last_classified=$2,last_held=$3,last_restored=$4 WHERE singleton`,
      [totals.checked, totals.classified, totals.held, totals.restored]);
      await snapshot();
      return totals;
    } catch (error) {
      await db.query("UPDATE office_unknown_topic_guardian_state SET last_error='Unknown topic cleanup could not finish; preserved posts will retry.' WHERE singleton").catch(() => {});
      cached = { ...cached, ...definition, enabled: initialized, status: 'degraded', lastError: 'Unknown topic cleanup could not finish; preserved posts will retry.' };
      throw error;
    } finally { busy = false; }
  }
  async function snapshot() {
    if (!initialized) return currentSnapshot();
    const { rows } = await db.query(`SELECT s.*,
      (SELECT COUNT(*)::int FROM feed_posts_cache WHERE ${UNKNOWN_SQL}) AS unknown_live,
      (SELECT COUNT(*)::int FROM office_unknown_topic_review WHERE resolved_at IS NULL) AS held_for_review
      FROM office_unknown_topic_guardian_state s WHERE singleton`, [UNKNOWN]);
    const s = rows[0] || {};
    cached = { ...definition, enabled: initialized, status: s.last_error ? 'degraded' : Number(s.unknown_live || 0) > 500 ? 'catching_up' : Number(s.unknown_live || 0) ? 'draining' : 'ready',
      unknownLive: Number(s.unknown_live || 0), heldForReview: Number(s.held_for_review || 0), lastRun: s.last_run ? new Date(s.last_run).toISOString() : null, lastError: s.last_error || null,
      lastChecked: Number(s.last_checked || 0), lastClassified: Number(s.last_classified || 0), lastHeld: Number(s.last_held || 0), lastRestored: Number(s.last_restored || 0),
      totalChecked: Number(s.total_checked || 0), totalClassified: Number(s.total_classified || 0), totalHeld: Number(s.total_held || 0), totalRestored: Number(s.total_restored || 0) };
    return cached;
  }
  function currentSnapshot() { return cached || { ...definition, enabled: initialized, status: 'waiting', lastRun: null }; }
  function start() { if (timer) return; timer = schedule(() => { void run().catch(() => {}); }, INTERVAL_MS); timer?.unref?.(); void run().catch(() => {}); }
  function stop() { if (timer) cancel(timer); timer = null; }
  return { initialize, run, snapshot, currentSnapshot, start, stop, definition };
}

module.exports = { UNKNOWN_TOPIC_GUARDIAN_SCHEMA, INTERVAL_MS, BATCH_SIZE, createUnknownTopicGuardian };
