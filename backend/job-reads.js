'use strict';

const { jobReadIdentity, jobReadKey } = require('../shared/job-read.mjs');

const JOB_READ_SCHEMA = `CREATE TABLE IF NOT EXISTS job_read_receipts (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  job_id TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, source, job_id)
)`;

async function markJobRead(db, userId, { source, id }) {
  await db.query(`INSERT INTO job_read_receipts (user_id, source, job_id)
    VALUES ($1, $2, $3) ON CONFLICT (user_id, source, job_id) DO NOTHING`, [userId, source, id]);
}

async function withJobReadStatus(db, userId, jobs) {
  const identities = jobs.map(jobReadIdentity).filter(Boolean);
  if (!identities.length || !db.isConnected()) return jobs;
  const { rows } = await db.query(`SELECT receipt.source, receipt.job_id AS id
    FROM job_read_receipts receipt
    JOIN unnest($2::text[], $3::text[]) AS listing(source, job_id)
      ON receipt.source=listing.source AND receipt.job_id=listing.job_id
    WHERE receipt.user_id=$1`, [userId, identities.map(job => job.source), identities.map(job => job.id)]);
  const readKeys = new Set(rows.map(jobReadKey));
  return jobs.map(job => readKeys.has(jobReadKey(job)) ? { ...job, read: true } : job);
}

module.exports = { JOB_READ_SCHEMA, markJobRead, withJobReadStatus };
