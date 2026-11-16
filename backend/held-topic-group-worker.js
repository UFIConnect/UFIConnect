'use strict';

const BATCH_SIZE = 200;
const MAX_ATTEMPTS = 5;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS office_held_group_state (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), catalog_version TEXT NOT NULL,
    scan_after TIMESTAMPTZ, scan_after_id TEXT, scan_through TIMESTAMPTZ, scan_through_id TEXT,
    scan_complete BOOLEAN NOT NULL, batch_size INTEGER NOT NULL DEFAULT ${BATCH_SIZE},
    batch_failures INTEGER NOT NULL DEFAULT 0, next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retry_failed_through TIMESTAMPTZ, last_progress_at TIMESTAMPTZ, last_error TEXT)`,
  `CREATE TABLE IF NOT EXISTS office_held_group_work (
    post_id TEXT PRIMARY KEY REFERENCES office_unknown_topic_review(post_id) ON DELETE CASCADE,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), attempts INTEGER NOT NULL DEFAULT 0,
    failed_at TIMESTAMPTZ, last_error TEXT, error_catalog_version TEXT)`,
  `CREATE INDEX IF NOT EXISTS office_held_group_due ON office_held_group_work(next_attempt_at,post_id) WHERE failed_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS office_held_group_failed ON office_held_group_work(failed_at,post_id) WHERE failed_at IS NOT NULL`,
  `CREATE OR REPLACE FUNCTION office_enqueue_held_group() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF NEW.resolved_at IS NOT NULL THEN
          DELETE FROM office_held_group_work WHERE post_id=NEW.post_id;
          RETURN NEW;
        END IF;
        IF OLD.resolved_at IS NULL AND OLD.post IS NOT DISTINCT FROM NEW.post
          AND OLD.last_held_at IS NOT DISTINCT FROM NEW.last_held_at THEN RETURN NEW; END IF;
      ELSIF NEW.resolved_at IS NOT NULL THEN RETURN NEW;
      END IF;
      INSERT INTO office_held_group_work(post_id) VALUES (NEW.post_id) ON CONFLICT(post_id) DO UPDATE
        SET next_attempt_at=NOW(),attempts=0,failed_at=NULL,last_error=NULL,error_catalog_version=NULL;
      RETURN NEW;
    END $$`,
  `CREATE OR REPLACE TRIGGER office_held_group_enqueue
    AFTER INSERT OR UPDATE OF post,last_held_at,resolved_at ON office_unknown_topic_review
    FOR EACH ROW EXECUTE FUNCTION office_enqueue_held_group()`,
  // During a rolling restart a previous release can still write a group with
  // its older catalog. Requeue that post even if the new scan already passed it.
  `CREATE OR REPLACE FUNCTION office_requeue_stale_held_group() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO office_held_group_work(post_id)
        SELECT NEW.post_id FROM office_held_group_state
        WHERE singleton AND catalog_version<>NEW.catalog_version
        ON CONFLICT(post_id) DO NOTHING;
      RETURN NEW;
    END $$`,
  `CREATE OR REPLACE TRIGGER office_held_group_requeue_stale
    AFTER INSERT OR UPDATE OF catalog_version ON office_unknown_topic_review_groups
    FOR EACH ROW EXECUTE FUNCTION office_requeue_stale_held_group()`,
];

const freshGroup = 'g.catalog_version=$1 AND g.last_held_at=r.last_held_at';
const groupJoin = `FROM office_unknown_topic_review r LEFT JOIN office_unknown_topic_review_groups g ON g.post_id=r.post_id AND ${freshGroup}`;
const errorCode = error => /^[A-Z0-9]{5}$/.test(error?.code || '') ? error.code : 'worker_error';
const rowError = error => /^(22|23)/.test(error.code || '') || error.code === 'P0001';

function createHeldTopicGroupWorker({ db, catalogVersion, classify, reviewVersion }) {
  let running = false;

  async function progress() {
    const { rows: [row] } = await db.query(`SELECT inventory.*,s.scan_complete,s.batch_failures,s.last_progress_at,s.last_error,
        CASE WHEN s.next_run_at>NOW() THEN s.next_run_at ELSE inventory.next_retry_at END AS next_retry_at,
        s.retry_failed_through IS NOT NULL AS retry_requested
      FROM (SELECT COUNT(*)::int AS total,COUNT(g.post_id)::int AS indexed,
          COUNT(w.failed_at) FILTER (WHERE g.post_id IS NULL)::int AS failed,
          COUNT(*) FILTER (WHERE g.post_id IS NULL AND w.failed_at IS NULL AND w.attempts>0)::int AS retrying,
          MIN(w.next_attempt_at) FILTER (WHERE g.post_id IS NULL AND w.failed_at IS NULL AND w.attempts>0) AS next_retry_at
        ${groupJoin} LEFT JOIN office_held_group_work w ON w.post_id=r.post_id WHERE r.resolved_at IS NULL) inventory
      LEFT JOIN office_held_group_state s ON s.singleton AND s.catalog_version=$1`, [catalogVersion]);
    const { total, indexed, failed, retrying } = row;
    const remaining = total - indexed - failed;
    const status = row.batch_failures >= MAX_ATTEMPTS ? 'paused'
      : row.batch_failures || retrying ? 'retrying'
      : remaining || row.retry_requested || (total > 0 && !row.scan_complete) ? 'running'
      : failed ? 'needs_attention' : 'complete';
    return { total, indexed, remaining, failed, retrying, status, lastProgressAt: row.last_progress_at,
      nextRetryAt: status === 'retrying' ? row.next_retry_at : null, lastError: row.last_error,
      retryRequested: Boolean(row.retry_requested) };
  }

  async function stateFor(client) {
    const { rows: [state] } = await client.query(`SELECT *,scan_after::text AS after_time,scan_through::text AS through_time,
        retry_failed_through::text AS retry_through,next_run_at<=NOW() AS due FROM office_held_group_state WHERE singleton`);
    if (state?.catalog_version === catalogVersion) return state;
    const { rows: [last] } = await client.query(`SELECT post_id,first_held_at::text AS held_at FROM office_unknown_topic_review
      WHERE resolved_at IS NULL ORDER BY first_held_at DESC,post_id DESC LIMIT 1`);
    const { rows } = await client.query(`INSERT INTO office_held_group_state(catalog_version,scan_through,scan_through_id,scan_complete)
      VALUES($1,$2,$3,$4) ON CONFLICT(singleton) DO UPDATE SET catalog_version=EXCLUDED.catalog_version,
        scan_through=EXCLUDED.scan_through,scan_through_id=EXCLUDED.scan_through_id,scan_complete=EXCLUDED.scan_complete,
        scan_after=NULL,scan_after_id=NULL,batch_size=${BATCH_SIZE},batch_failures=0,next_run_at=NOW(),
        retry_failed_through=NULL,last_progress_at=NULL,last_error=NULL
      RETURNING *,scan_through::text AS through_time,TRUE AS due`, [catalogVersion, last?.held_at || null, last?.post_id || null, !last]);
    return rows[0];
  }

  async function seedPage(client, state) {
    if (state.scan_complete) return false;
    const params = [catalogVersion, state.through_time, state.scan_through_id];
    if (state.after_time) params.push(state.after_time, state.scan_after_id);
    const { rows } = await client.query(`WITH page AS MATERIALIZED (
        SELECT r.post_id,r.first_held_at,r.last_held_at FROM office_unknown_topic_review r
        WHERE r.resolved_at IS NULL AND (r.first_held_at,r.post_id)<=($2::timestamptz,$3::text)
          ${state.after_time ? 'AND (r.first_held_at,r.post_id)>($4::timestamptz,$5::text)' : ''}
        ORDER BY r.first_held_at,r.post_id LIMIT ${BATCH_SIZE} FOR KEY SHARE OF r
      ), queued AS (
        INSERT INTO office_held_group_work AS w(post_id)
        SELECT r.post_id FROM page r LEFT JOIN office_unknown_topic_review_groups g ON g.post_id=r.post_id AND ${freshGroup}
        WHERE g.post_id IS NULL
        ON CONFLICT(post_id) DO UPDATE SET attempts=0,failed_at=NULL,last_error=NULL,error_catalog_version=NULL,next_attempt_at=NOW()
        WHERE w.last_error IS NOT NULL AND w.error_catalog_version IS DISTINCT FROM $1
      ) SELECT post_id,first_held_at::text AS held_at FROM page ORDER BY first_held_at,post_id`, params);
    const last = rows.at(-1);
    await client.query(`UPDATE office_held_group_state SET scan_after=COALESCE($1::timestamptz,scan_after),
      scan_after_id=COALESCE($2,scan_after_id),scan_complete=$3 WHERE singleton`,
    [last?.held_at || null, last?.post_id || null, rows.length < BATCH_SIZE]);
    return true;
  }

  async function requeueFailures(client, through) {
    if (!through) return;
    // A click retries a fixed set. Failures from this retry need a new request.
    const { rows } = await client.query(`WITH batch AS (
        SELECT post_id FROM office_held_group_work WHERE failed_at<=$1::timestamptz
        ORDER BY failed_at,post_id LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED
      ) UPDATE office_held_group_work w SET attempts=0,next_attempt_at=NOW(),failed_at=NULL,last_error=NULL,error_catalog_version=NULL
        FROM batch WHERE w.post_id=batch.post_id RETURNING w.post_id`, [through]);
    if (!rows.length) await client.query(`UPDATE office_held_group_state SET retry_failed_through=NULL
      WHERE singleton AND retry_failed_through=$1::timestamptz
      AND NOT EXISTS(SELECT 1 FROM office_held_group_work WHERE failed_at<=$1::timestamptz)`, [through]);
  }

  async function recordFailures(client, errors) {
    if (!errors.length) return;
    await client.query(`UPDATE office_held_group_work w SET attempts=w.attempts+1,last_error=x.code,error_catalog_version=$2,
        failed_at=CASE WHEN w.attempts+1>=${MAX_ATTEMPTS} THEN NOW() END,
        next_attempt_at=NOW()+make_interval(secs=>5*(1<<w.attempts))
      FROM jsonb_to_recordset($1::jsonb) AS x(post_id TEXT,code TEXT) WHERE w.post_id=x.post_id`, [JSON.stringify(errors), catalogVersion]);
  }

  async function persist(client, values) {
    await client.query(`INSERT INTO office_unknown_topic_review_groups(post_id,review_version,last_held_at,post_hash,catalog_version,
        group_id,label,suggested_topic,method,suggested_subtopic)
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(post_id TEXT,review_version TEXT,last_held_at TIMESTAMPTZ,post_hash TEXT,
        catalog_version TEXT,group_id TEXT,label TEXT,suggested_topic TEXT,method TEXT,suggested_subtopic TEXT)
      ON CONFLICT(post_id) DO UPDATE SET review_version=EXCLUDED.review_version,last_held_at=EXCLUDED.last_held_at,post_hash=EXCLUDED.post_hash,
        catalog_version=EXCLUDED.catalog_version,group_id=EXCLUDED.group_id,label=EXCLUDED.label,suggested_topic=EXCLUDED.suggested_topic,
        method=EXCLUDED.method,suggested_subtopic=EXCLUDED.suggested_subtopic,indexed_at=NOW(),indexed_generation=EXCLUDED.indexed_generation`,
    [JSON.stringify(values)]);
  }

  async function processDue(client, size) {
    // Pick from the partial due index, then take the review locks in post ID
    // order. Review/transfer edits use the same review-row-before-queue order.
    const { rows } = await client.query(`WITH due AS MATERIALIZED (
        SELECT post_id FROM office_held_group_work WHERE failed_at IS NULL AND next_attempt_at<=NOW()
        ORDER BY next_attempt_at,post_id LIMIT ($1::int * 2)
      ) SELECT r.post_id,r.post,r.last_held_at,r.last_held_at::text AS exact_last_held_at,
        r.resolved_at IS NOT NULL AS done,md5(r.post::text) AS post_hash
        FROM due JOIN office_unknown_topic_review r USING(post_id)
        ORDER BY r.post_id LIMIT $1 FOR UPDATE OF r SKIP LOCKED`, [size]);
    const values = [], completed = [], errors = [];
    for (const row of rows) {
      if (row.done) { completed.push(row.post_id); continue; }
      try {
        const group = classify(row.post);
        values.push({ post_id: row.post_id, review_version: reviewVersion(row), last_held_at: row.exact_last_held_at, post_hash: row.post_hash,
          catalog_version: catalogVersion, group_id: group.id, label: group.label, suggested_topic: group.topic,
          method: group.method, suggested_subtopic: group.subtopic || null });
      } catch (error) { errors.push({ post_id: row.post_id, code: errorCode(error) }); }
    }
    let processed = 0, nextSize = size;
    if (values.length) {
      await client.query('SAVEPOINT held_group_results');
      try {
        await persist(client, values);
        completed.push(...values.map(row => row.post_id));
        processed = values.length;
        nextSize = Math.min(size * 2, BATCH_SIZE);
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT held_group_results');
        if (!rowError(error)) throw error;
        // Reduce the next write until a bad row is identified by itself.
        // Other rows retain their queue entries and original retry counts.
        if (values.length > 1) nextSize = Math.max(1, Math.floor(values.length / 2));
        else errors.push({ post_id: values[0].post_id, code: errorCode(error) });
      }
      await client.query('RELEASE SAVEPOINT held_group_results');
    }
    await recordFailures(client, errors);
    if (completed.length) await client.query('DELETE FROM office_held_group_work WHERE post_id=ANY($1::text[])', [completed]);
    return { processed, nextSize };
  }

  async function tick() {
    if (running) return { ok: true, processed: 0, busy: true };
    running = true;
    try {
      return await db.withClient(async client => {
        let connectionError;
        const onDisconnect = error => { connectionError ||= error; };
        client.on?.('error', onDisconnect);
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('statement_timeout','5s',true),set_config('lock_timeout','500ms',true),set_config('idle_in_transaction_session_timeout','15s',true)");
          // The lease ends at commit, rollback or connection loss. Postgres
          // never hands it to another worker while this batch can still write.
          const { rows: [lock] } = await client.query('SELECT pg_try_advisory_xact_lock(721432,3) AS locked');
          const result = lock.locked ? await runBatch(client) : { ok: true, processed: 0, busy: true };
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw connectionError || error;
        } finally { client.removeListener?.('error', onDisconnect); }
      });
    } finally { running = false; }
  }

  async function runBatch(client) {
    const state = await stateFor(client);
    if (!state.due || state.batch_failures >= MAX_ATTEMPTS) return { ok: true, processed: 0, waiting: true };
    await client.query('SAVEPOINT held_group_batch');
    try {
      const seeded = await seedPage(client, state);
      await requeueFailures(client, state.retry_through);
      const { processed, nextSize } = await processDue(client, state.batch_size);
      if (seeded || processed || nextSize !== state.batch_size || state.batch_failures) {
        await client.query(`UPDATE office_held_group_state SET batch_size=$1,batch_failures=0,next_run_at=NOW(),last_error=NULL,
          last_progress_at=CASE WHEN $2 THEN NOW() ELSE last_progress_at END WHERE singleton`, [nextSize, seeded || processed > 0]);
      }
      return { ok: true, processed };
    } catch (error) {
      // A recoverable DB statement error rolls back checkpoint and writes
      // together. Save backoff after rollback so a restart retains it.
      await client.query('ROLLBACK TO SAVEPOINT held_group_batch');
      await client.query(`UPDATE office_held_group_state SET batch_failures=batch_failures+1,
        next_run_at=NOW()+make_interval(secs=>15*(1<<batch_failures)),last_error=$1 WHERE singleton`, [errorCode(error)]);
      return { ok: true, processed: 0, waiting: true };
    }
  }

  async function retry() {
    await db.query(`UPDATE office_held_group_state SET batch_failures=0,next_run_at=NOW(),last_error=NULL,
      retry_failed_through=clock_timestamp() WHERE singleton AND catalog_version=$1`, [catalogVersion]);
    return { ok: true };
  }

  return { tick, progress, retry };
}

module.exports = { HELD_TOPIC_GROUP_WORKER_SCHEMA: SCHEMA, createHeldTopicGroupWorker, groupJoin };
