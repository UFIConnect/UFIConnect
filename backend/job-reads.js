'use strict';

const NATIVE_JOB_SOURCE = 'uficonnect';

const JOB_READ_SCHEMA = `CREATE TABLE IF NOT EXISTS job_read_receipts (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  job_id TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, source, job_id)
)`;

const JOB_READ_LISTING_INDEX = `CREATE INDEX IF NOT EXISTS job_read_receipts_listing_idx
  ON job_read_receipts (source, job_id)`;

async function markJobRead(db, userId, id) {
  await db.query(`INSERT INTO job_read_receipts (user_id, source, job_id)
    VALUES ($1, $2, $3) ON CONFLICT (user_id, source, job_id) DO NOTHING`, [userId, NATIVE_JOB_SOURCE, id]);
}

async function jobReaderCount(db, authorId, id) {
  const { rows } = await db.query(`SELECT COUNT(*) AS readers FROM job_read_receipts
    WHERE user_id<>$1 AND source=$2 AND job_id=$3`, [authorId, NATIVE_JOB_SOURCE, id]);
  return Number(rows[0].readers);
}

module.exports = { JOB_READ_SCHEMA, JOB_READ_LISTING_INDEX, NATIVE_JOB_SOURCE, markJobRead, jobReaderCount };
