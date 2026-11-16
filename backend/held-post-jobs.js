'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { pendingStagedReceipts } = require('./held-post-receipts');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS office_held_post_jobs (
    id UUID PRIMARY KEY, kind TEXT NOT NULL, request_hash TEXT NOT NULL, status TEXT NOT NULL,
    topic TEXT, subtopic TEXT, through TIMESTAMPTZ, total INTEGER NOT NULL, remaining INTEGER NOT NULL,
    progress JSONB NOT NULL DEFAULT '{}'::jsonb, stop_requested BOOLEAN NOT NULL DEFAULT FALSE,
    waiting BOOLEAN NOT NULL DEFAULT FALSE, lease_id UUID, next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS office_held_post_jobs_active
    ON office_held_post_jobs(kind) WHERE status='running'`,
  `CREATE TABLE IF NOT EXISTS office_held_post_job_items (
    job_id UUID NOT NULL REFERENCES office_held_post_jobs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, post_id TEXT NOT NULL, review_version TEXT NOT NULL,
    PRIMARY KEY(job_id,position))`,
  `CREATE INDEX IF NOT EXISTS office_held_post_job_item_version
    ON office_held_post_job_items(job_id,post_id,review_version)`,
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ASSIGNMENT_BATCH = 100;
const REVIEW_RESULTS_LIMIT = 100;
const lockSnapshot = client => client.query('SELECT pg_advisory_xact_lock(721432,4)');
const invalid = (status, message) => Object.assign(new Error(message), { status });
const columns = 'id,kind,status,topic,subtopic,total,remaining,progress,stop_requested,waiting';

function jobId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(400, 'A valid request ID is required.');
  return value;
}

function publicJob(row) {
  return {
    id: row.id, kind: row.kind, status: row.status, topic: row.topic, subtopic: row.subtopic,
    total: row.total, remaining: row.remaining, progress: row.progress,
    stopRequested: row.stop_requested, waiting: row.waiting,
  };
}

function createHeldPostJobs({ db, assignBatch, remainingDistribution, distribute, distributeJob }) {
  let sweeping = false;

  async function transaction(work) {
    return db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '1500ms'");
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    });
  }

  async function list() {
    const { rows } = await db.query(`SELECT DISTINCT ON(kind) ${columns} FROM office_held_post_jobs
      ORDER BY kind,created_at DESC,id DESC`);
    return Object.fromEntries(rows.map(row => [row.kind, publicJob(row)]));
  }

  async function start(kind, { id, topic = null, subtopic = null, items = null }) {
    jobId(id);
    const payload = items ? JSON.stringify(items) : null;
    const hash = createHash('sha256').update(JSON.stringify([kind, topic, subtopic])).update(payload || '').digest('hex');
    return transaction(async client => {
      // Synchronize the distribution snapshot with in-flight transfer commits.
      if (kind === 'distribution') await lockSnapshot(client);
      else await client.query('SELECT pg_advisory_xact_lock(721432,5)');
      const previous = (await client.query(`SELECT ${columns},request_hash FROM office_held_post_jobs WHERE id=$1`, [id])).rows[0];
      if (previous) {
        if (previous.request_hash !== hash) throw invalid(409, 'This request ID was already used for a different job.');
        return publicJob(previous);
      }
      const active = await client.query("SELECT 1 FROM office_held_post_jobs WHERE kind=$1 AND status='running'", [kind]);
      if (active.rows.length) throw invalid(409, 'This type of held-post job is already running.');
      const { rows } = await client.query(`INSERT INTO office_held_post_jobs(id,kind,request_hash,status,topic,subtopic,through,total,remaining)
        VALUES($1,$2,$3,'running',$4,$5,NULL,$6,$6) RETURNING ${columns}`,
      [id, kind, hash, topic, subtopic, items?.length ?? 0]);
      if (items) {
        await client.query(`INSERT INTO office_held_post_job_items(job_id,position,post_id,review_version)
          SELECT $1,ordinality,value->>'id',value->>'expectedVersion'
          FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS item(value,ordinality)`, [id, payload]);
        return publicJob(rows[0]);
      }
      const snapshot = await client.query(`WITH members AS (
        INSERT INTO office_held_post_job_items(job_id,position,post_id,review_version)
        SELECT $1,row_number() OVER (ORDER BY post_id),post_id,review_version
        FROM (${pendingStagedReceipts()}) a RETURNING 1
      ), counts AS (SELECT COUNT(*)::int AS total FROM members)
      UPDATE office_held_post_jobs j SET total=c.total,remaining=c.total,
        status=CASE WHEN c.total=0 THEN 'complete' ELSE 'running' END
      FROM counts c WHERE j.id=$1 RETURNING ${columns.split(',').map(col => 'j.' + col).join(',')}`, [id]);
      return publicJob(snapshot.rows[0]);
    });
  }

  async function stop(id) {
    jobId(id);
    const { rows } = await db.query(`UPDATE office_held_post_jobs SET stop_requested=(status='running' OR stop_requested),
      next_run_at=CASE WHEN lease_id IS NULL THEN NOW() ELSE next_run_at END WHERE id=$1 RETURNING ${columns}`, [id]);
    if (!rows.length) throw invalid(404, 'This held-post job could not be found.');
    return publicJob(rows[0]);
  }

  async function runAssignment() {
    await transaction(async client => {
      const job = (await client.query(`SELECT ${columns} FROM office_held_post_jobs
        WHERE kind='assignment' AND status='running' FOR UPDATE SKIP LOCKED`)).rows[0];
      if (!job) return;
      if (job.stop_requested) {
        await client.query("UPDATE office_held_post_jobs SET status='stopped' WHERE id=$1", [job.id]);
        return;
      }
      const { rows: items } = await client.query(`SELECT post_id AS id,review_version AS "expectedVersion"
        FROM office_held_post_job_items WHERE job_id=$1 AND position>$2 ORDER BY position LIMIT $3`,
      [job.id, job.total - job.remaining, ASSIGNMENT_BATCH]);
      if (!items.length) throw new Error('Held-post assignment snapshot is missing its next batch.');
      // Commit the reviewed versions, receipts and job cursor together.
      const result = await assignBatch(items, job.topic, job.subtopic, client);
      const progress = {};
      for (const key of ['assigned','replayed','conflicts','failed']) progress[key] = (job.progress[key] || 0) + result[key];
      progress.results = [...(job.progress.results || []), ...result.results.filter(row => !row.ok)].slice(0, REVIEW_RESULTS_LIMIT);
      const remaining = job.remaining - items.length;
      await client.query(`UPDATE office_held_post_jobs SET progress=$2,remaining=$3,status=$4 WHERE id=$1`,
        [job.id, JSON.stringify(progress), remaining, remaining ? 'running' : 'complete']);
    });
  }

  async function runDistribution() {
    const lease = randomUUID();
    const { rows } = await db.query(`UPDATE office_held_post_jobs SET lease_id=$1,next_run_at=NOW()+INTERVAL '60 seconds'
      WHERE kind='distribution' AND status='running' AND next_run_at<=NOW()
      RETURNING id,remaining,stop_requested,to_char(through AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS through`, [lease]);
    const job = rows[0];
    if (!job) return;
    let remaining = null;
    let waiting = false;
    try {
      if (job.through) {
        // Jobs created before fixed membership continue with their saved cutoff.
        if (job.stop_requested) remaining = await remainingDistribution(job.through);
        else {
          const result = await distribute({ confirmed: true, through: job.through });
          remaining = result.remaining;
          waiting = result.status === 'failed' || (remaining > 0 && !result.drained);
        }
      } else if (!job.stop_requested && job.remaining) {
        const result = await distributeJob(job.id);
        waiting = Boolean(result.error) || (!result.drained && !(await reconcileMissingStaging(job.id)));
      }
    } catch (error) {
      waiting = true;
      if (error.status !== 409) console.warn('[topic review] Distribution will retry:', error.code || error.status || 'runtime error');
    }
    await db.query(`UPDATE office_held_post_jobs SET remaining=LEAST(remaining,$3),waiting=($4 AND LEAST(remaining,$3)>0 AND NOT stop_requested),
      status=CASE WHEN LEAST(remaining,$3)=0 THEN 'complete' WHEN stop_requested THEN 'stopped' ELSE 'running' END,
      lease_id=NULL,next_run_at=NOW()+CASE WHEN $4 THEN INTERVAL '6 seconds' ELSE INTERVAL '0 seconds' END
      WHERE id=$1 AND lease_id=$2`, [job.id, lease, remaining, waiting]);
  }

  async function reconcileMissingStaging(id) {
    return transaction(async client => {
      await lockSnapshot(client);
      const { rows } = await client.query(`SELECT a.post_id AS id,a.review_version,
          CASE WHEN a.processed_at IS NULL THEN 'staging_copy_missing' ELSE 'outcome_unavailable' END AS reason
        FROM office_held_post_job_items i
        JOIN office_unknown_topic_manual_assignments a USING (post_id,review_version)
        WHERE i.job_id=$1 AND a.outcome IS NULL AND (a.processed_at IS NOT NULL OR
          NOT EXISTS (SELECT 1 FROM feed_posts_staging s WHERE s.id=i.post_id
            AND (s.held_review_version IS NULL OR s.held_review_version=i.review_version)))
        ORDER BY i.position LIMIT 500`, [id]);
      await recordDistribution(client, rows.map(row => ({ ...row, outcome: 'missing' })), { locked: true });
      return rows.length;
    });
  }

  async function sweep() {
    if (sweeping || !db.isConnected()) return;
    sweeping = true;
    try {
      // Each operation gets a bounded pass even if the other one needs a retry.
      await runAssignment().catch(error => console.warn('[topic review] Assignment will retry:', error.code || error.message));
      await runDistribution();
    } finally {
      sweeping = false;
    }
  }

  async function recordDistribution(client, outcomes, { locked = false } = {}) {
    if (!outcomes.length) return;
    if (!locked) await lockSnapshot(client);
    // The normal transfer and a requested run share this accounting. Record
    // the outcome once, in the same transaction that drains the staging row.
    await client.query(`WITH outcomes AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS o(id TEXT,review_version TEXT,outcome TEXT,reason TEXT,live_topic TEXT)
    ), marked AS (
      UPDATE office_unknown_topic_manual_assignments a SET processed_at=COALESCE(a.processed_at,NOW()),
        outcome=o.outcome,outcome_reason=o.reason,live_topic=o.live_topic
      FROM outcomes o WHERE a.post_id=o.id AND a.review_version=o.review_version
        AND (a.processed_at IS NULL OR (o.outcome='missing' AND a.outcome IS NULL))
      RETURNING a.post_id,a.review_version,a.assigned_at,a.outcome
    ), counts AS (
      SELECT j.id,COUNT(DISTINCT m.post_id)::int AS drained,
        COUNT(DISTINCT m.post_id) FILTER (WHERE m.outcome='published')::int AS transferred,
        COUNT(DISTINCT m.post_id) FILTER (WHERE m.outcome='screened')::int AS screened,
        COUNT(DISTINCT m.post_id) FILTER (WHERE m.outcome='held')::int AS held,
        COUNT(DISTINCT m.post_id) FILTER (WHERE m.outcome='preserved')::int AS preserved,
        COUNT(DISTINCT m.post_id) FILTER (WHERE m.outcome='conflict')::int AS conflicts,
        COUNT(DISTINCT m.post_id) FILTER (WHERE m.outcome='missing')::int AS missing,
        COUNT(DISTINCT m.post_id) FILTER (WHERE m.outcome='failed')::int AS failed
      FROM office_held_post_jobs j JOIN marked m ON
        (j.through IS NOT NULL AND m.assigned_at<=j.through) OR
        (j.through IS NULL AND EXISTS (SELECT 1 FROM office_held_post_job_items i
          WHERE i.job_id=j.id AND i.post_id=m.post_id AND i.review_version=m.review_version))
      WHERE j.kind='distribution' AND j.status='running' GROUP BY j.id
    )
    UPDATE office_held_post_jobs j SET remaining=GREATEST(j.remaining-c.drained,0),
      progress=j.progress || jsonb_build_object(
        'drained',COALESCE((j.progress->>'drained')::int,0)+c.drained,
        'transferred',COALESCE((j.progress->>'transferred')::int,0)+c.transferred,
        'screenedOut',COALESCE((j.progress->>'screenedOut')::int,0)+c.screened,
        'heldForReview',COALESCE((j.progress->>'heldForReview')::int,0)+c.held,
        'preserved',COALESCE((j.progress->>'preserved')::int,0)+c.preserved,
        'conflicts',COALESCE((j.progress->>'conflicts')::int,0)+c.conflicts,
        'missing',COALESCE((j.progress->>'missing')::int,0)+c.missing,
        'failed',COALESCE((j.progress->>'failed')::int,0)+c.failed)
    FROM counts c WHERE j.id=c.id`, [JSON.stringify(outcomes)]);
  }

  async function prune() {
    await db.query(`DELETE FROM office_held_post_jobs WHERE status IN ('complete','stopped')
      AND created_at<NOW()-INTERVAL '7 days'`);
  }

  return { list, start, stop, sweep, recordDistribution, prune };
}

module.exports = { HELD_POST_JOB_SCHEMA: SCHEMA, createHeldPostJobs };
