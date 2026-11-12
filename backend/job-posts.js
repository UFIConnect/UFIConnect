'use strict';

const { jobReadIdentity } = require('../shared/job-read.mjs');
const { NATIVE_JOB_SOURCE, markJobRead, jobReaderCount } = require('./job-reads');

const fail = (status, message) => Object.assign(new Error(message), { status });
const text = value => typeof value === 'string' ? value.trim() : '';
const nativeSource = 'UFIConnect';

function nativeJob(row) {
  const details = row.details || {};
  const location = text(details.location);
  const sourceUrl = `https://uficonnect.org/opportunities/${encodeURIComponent(row.id)}`;
  let applyUrl = null;
  try {
    const candidate = new URL(details.applyUrl);
    if (['https:', 'http:'].includes(candidate.protocol) && !candidate.username && !candidate.password) applyUrl = candidate.href;
  } catch { /* An application link is optional. */ }
  return {
    id: row.id, type: 'job', title: row.title || text(details.title),
    org: text(details.company) || row.author_name, authorId: row.author_id,
    author: { id: row.author_id, name: row.author_name },
    content: row.content, description: row.content, fullDescription: row.content,
    location, remote: /\bremote\b/i.test(location) && !/\b(?:not|non)[ -]?remote\b/i.test(location),
    pay: text(details.pay), posted: row.created_at, createdAt: row.created_at,
    source: nativeSource, sourceId: 'uficonnect', sourceUrl, applyUrl,
    isLive: true, nativeJob: true, tags: [],
  };
}

// Shared hiring storage preserves screening, idempotency and privacy export.
// Its member Jobs entry point always includes UFIConnect; optional connected
// source sharing keeps its own provider and plan checks. Business tools retain
// their separate membership requirements.
function createJobPosts({ db, businessPosts, visibilitySql, suppressionSql }) {
  if (!visibilitySql || !suppressionSql) throw new Error('Native job visibility predicates are required.');
  const select = `SELECT p.id,p.author_id,u.name AS author_name,p.title,p.content,p.created_at,b.details
    FROM business_posts b
    JOIN (SELECT id,author_id,title,content,created_at,group_id,source,source_label,url AS source_url FROM community_posts) p
      ON p.id=b.native_post_id AND p.author_id=b.user_id::text
    JOIN users u ON u.id=b.user_id
    WHERE b.status='published' AND p.source='uficonnect' AND p.source_label='Hiring'
      AND b.targets @> '[{"platform":"uficonnect","status":"posted"}]'::jsonb
      AND (p.group_id='ufi-general' OR EXISTS (
        SELECT 1 FROM community_groups public_job_group
        WHERE public_job_group.id=p.group_id AND public_job_group.is_private IS NOT TRUE))
      AND NOT EXISTS (SELECT 1 FROM blocks job_block
        WHERE (job_block.blocker_id=$1::text AND job_block.blocked_id=p.author_id)
        OR (job_block.blocked_id=$1::text AND job_block.blocker_id=p.author_id))
      AND (${visibilitySql}) AND (${suppressionSql})`;
  function ready() {
    if (!db.isConnected()) throw fail(503, 'Job posting storage is temporarily unavailable.');
  }
  async function list(viewerId) {
    ready();
    const { rows } = await db.query(`${select} ORDER BY p.created_at DESC,p.id`, [viewerId]);
    return rows.map(nativeJob);
  }
  async function get(viewerId, id) {
    ready();
    if (!/^[\w-]{1,120}$/.test(String(id || ''))) throw fail(404, 'Job listing not found.');
    const { rows } = await db.query(`${select} AND p.id=$2 LIMIT 1`, [viewerId, id]);
    if (!rows[0]) throw fail(404, 'Job listing not found.');
    return nativeJob(rows[0]);
  }
  async function recordRead(viewerId, input) {
    const receipt = jobReadIdentity(input);
    if (!receipt) throw fail(400, 'A job ID and source are required.');
    if (receipt.source !== NATIVE_JOB_SOURCE) return;
    const job = await get(viewerId, receipt.id);
    if (job.authorId !== viewerId) await markJobRead(db, viewerId, job.id);
  }
  async function activity(viewerId, id) {
    const job = await get(viewerId, id);
    if (job.authorId !== viewerId) throw fail(404, 'Job listing not found.');
    return { readers: await jobReaderCount(db, viewerId, job.id) };
  }
  async function create(userId, input = {}) {
    const post = await businessPosts.createNativeJob(userId, {
      requestId: input.requestId, details: input.details,
      targets: input.targets, publisherSettings: input.publisherSettings,
    });
    const delivered = post.targets?.some(target => target.platform === 'uficonnect' && target.status === 'posted');
    // Missing/hidden publication stays unavailable: a draft or an uncertain
    // provider outcome must never be advertised as a live job.
    let job = null;
    if (post.status === 'published' && delivered && post.nativePostId) {
      try { job = await get(userId, post.nativePostId); } catch (error) { if (error.status !== 404) throw error; }
    }
    return { post, job };
  }
  return { list, get, create, recordRead, activity };
}

function registerJobPostRoutes(app, { service, authenticate, limiter }) {
  const handler = (fn, successStatus = 200) => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const result = await fn(req);
      if (successStatus === 204) return res.status(204).end();
      res.json(result);
    }
    catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Jobs are temporarily unavailable. Please try again.' }); }
  };
  app.post('/jobs/posts', authenticate, limiter, handler(req => service.create(req.user.id, req.body || {})));
  app.post('/jobs/read', authenticate, handler(req => service.recordRead(req.user.id, req.body), 204));
  app.get('/jobs/posts/:id/activity', authenticate, handler(req => service.activity(req.user.id, req.params.id)));
  app.get('/opportunities/:id', authenticate, handler(async req => ({ job: await service.get(req.user.id, req.params.id) })));
}

module.exports = { nativeJob, createJobPosts, registerJobPostRoutes };
