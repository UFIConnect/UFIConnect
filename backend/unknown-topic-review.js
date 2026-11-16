'use strict';

const { createHash } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const { resolvePostTopic, isUnknownTopic, subtopicRules, TOPIC_EVIDENCE_VERSION } = require('./office-topic-transfer');
const { heldPostGroup } = require('./held-topic-groups');
const { HELD_TOPIC_GROUP_WORKER_SCHEMA, createHeldTopicGroupWorker, groupJoin } = require('./held-topic-group-worker');
const { HELD_POST_JOB_SCHEMA, createHeldPostJobs } = require('./held-post-jobs');
const { pendingStagedReceipts, pendingReceiptsForRemoval } = require('./held-post-receipts');
const failure = (status, message) => Object.assign(new Error(message), { status });
const hash = value => createHash('sha256').update(value).digest('hex');
const iso = value => value ? new Date(value).toISOString() : null;
const PUBLIC_FIELDS = ['id', 'title', 'content', 'topic', 'source', 'source_url', 'author_name', 'author_handle', 'author_avatar_url',
  'author_profile_url', 'media_url', 'media_type', 'media_poster', 'video_duration_seconds', 'minimum_viewer_age', 'likes_count', 'comments_count',
  'likes', 'comments', 'post_created_at', 'fetched_at', 'location', 'group_id'];
const UNKNOWN_TOPIC_REVIEW_SCHEMA = [
  `CREATE INDEX IF NOT EXISTS office_unknown_topic_review_pending_order
    ON office_unknown_topic_review(first_held_at,post_id) WHERE resolved_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS office_unknown_topic_manual_assignments (
    post_id TEXT NOT NULL, review_version TEXT NOT NULL, topic TEXT NOT NULL, subtopic TEXT,
    original_post JSONB NOT NULL, assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), processed_at TIMESTAMPTZ,
    PRIMARY KEY(post_id,review_version))`,
  `ALTER TABLE office_unknown_topic_manual_assignments ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ`,
  `ALTER TABLE office_unknown_topic_manual_assignments ADD COLUMN IF NOT EXISTS outcome TEXT,
    ADD COLUMN IF NOT EXISTS outcome_reason TEXT,ADD COLUMN IF NOT EXISTS live_topic TEXT`,
  `ALTER TABLE feed_posts_staging ADD COLUMN IF NOT EXISTS held_review_version TEXT`,
  `CREATE INDEX IF NOT EXISTS office_unknown_topic_pending_assignments
    ON office_unknown_topic_manual_assignments(assigned_at,post_id) WHERE processed_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS office_held_assignment_missing_staging
    ON office_unknown_topic_manual_assignments(post_id) WHERE outcome='missing'`,
  `CREATE SEQUENCE IF NOT EXISTS office_unknown_topic_group_generation`,
  `CREATE TABLE IF NOT EXISTS office_unknown_topic_review_groups (
    post_id TEXT PRIMARY KEY REFERENCES office_unknown_topic_review(post_id) ON DELETE CASCADE,
    review_version TEXT NOT NULL, last_held_at TIMESTAMPTZ NOT NULL, post_hash TEXT NOT NULL,
    catalog_version TEXT NOT NULL, group_id TEXT NOT NULL, label TEXT NOT NULL, suggested_topic TEXT, method TEXT NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    indexed_generation BIGINT NOT NULL DEFAULT nextval('office_unknown_topic_group_generation'))`,
  `CREATE INDEX IF NOT EXISTS office_unknown_topic_review_group_members ON office_unknown_topic_review_groups(group_id,post_id)`,
  `CREATE INDEX IF NOT EXISTS office_unknown_topic_review_group_generation ON office_unknown_topic_review_groups(indexed_generation)`,
  `ALTER TABLE office_unknown_topic_review_groups ADD COLUMN IF NOT EXISTS suggested_subtopic TEXT`,
  `CREATE OR REPLACE FUNCTION office_invalidate_held_post_group() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      DELETE FROM office_unknown_topic_review_groups WHERE post_id=NEW.post_id;
      RETURN NEW;
    END $$`,
  `CREATE OR REPLACE TRIGGER office_held_post_group_invalidate
    AFTER UPDATE OF post,last_held_at ON office_unknown_topic_review FOR EACH ROW
    WHEN (OLD.post IS DISTINCT FROM NEW.post OR OLD.last_held_at IS DISTINCT FROM NEW.last_held_at)
    EXECUTE FUNCTION office_invalidate_held_post_group()`,
  ...HELD_TOPIC_GROUP_WORKER_SCHEMA,
  ...HELD_POST_JOB_SCHEMA,
];
const reviewSearch = `($2::text='' OR strpos(lower(COALESCE(r.post->>'title','') || ' ' || COALESCE(r.post->>'content','') || ' ' || COALESCE(r.post->>'source','') || ' ' || COALESCE(g.label,'') || ' ' || COALESCE(g.suggested_topic,'')),$2)>0)
  AND ($3::text='' OR r.post->>'source'=$3)`;
async function pendingManualAssignmentIds(queryRunner, ids) {
  const requested = [...new Set(ids)];
  if (!requested.length) return [];
  const exists = await queryRunner.query("SELECT to_regclass('office_unknown_topic_manual_assignments') AS relation");
  if (!exists.rows[0]?.relation) return [];
  const result = await queryRunner.query(`SELECT DISTINCT post_id FROM office_unknown_topic_manual_assignments
    WHERE processed_at IS NULL AND post_id=ANY($1::text[])`, [requested]);
  return result.rows.map(row => row.post_id);
}
async function markManualAssignmentsProcessed(queryRunner, ids) {
  const requested = [...new Set(ids)];
  if (!requested.length) return;
  await queryRunner.query(`UPDATE office_unknown_topic_manual_assignments SET processed_at=NOW()
    WHERE processed_at IS NULL AND post_id=ANY($1::text[])`, [requested]);
}
async function manualSubtopicsFor(posts, queryRunner) {
  const exists = await queryRunner.query("SELECT to_regclass('office_unknown_topic_manual_assignments') AS relation");
  if (!exists.rows[0]?.relation) return new Map();
  const fingerprints = posts.map(({ id, topic, title, content }) => ({ id, topic,
    body_hash: createHash('md5').update([title || '', content || ''].join('\x1f')).digest('hex') }));
  const { rows } = await queryRunner.query(`SELECT DISTINCT ON (a.post_id) a.post_id,a.subtopic
    FROM jsonb_to_recordset($1::jsonb) AS p(id TEXT,topic TEXT,body_hash TEXT)
    JOIN office_unknown_topic_manual_assignments a ON a.post_id=p.id AND a.topic=p.topic
    WHERE a.subtopic IS NOT NULL AND md5(COALESCE(a.original_post->>'title','') || chr(31) || COALESCE(a.original_post->>'content',''))=p.body_hash
    ORDER BY a.post_id,a.assigned_at DESC,a.review_version`, [JSON.stringify(fingerprints)]);
  return new Map(rows.map(row => [row.post_id, row.subtopic]));
}
async function recordRecoveredAssignments(assignments, queryRunner) {
  const exists = await queryRunner.query("SELECT to_regclass('office_unknown_topic_manual_assignments') AS relation");
  if (!exists.rows[0]?.relation) return;
  const values = assignments.map(({ row, decision }) => ({
    post_id: row.post_id, review_version: reviewVersion(row), topic: decision.topic, subtopic: decision.subtopic, post: row.post,
  }));
  await queryRunner.query(`WITH recorded AS (
    INSERT INTO office_unknown_topic_manual_assignments(post_id,review_version,topic,subtopic,original_post)
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(post_id TEXT,review_version TEXT,topic TEXT,subtopic TEXT,post JSONB)
    ON CONFLICT(post_id,review_version) DO NOTHING RETURNING post_id,review_version
  )
  UPDATE feed_posts_staging s SET held_review_version=r.review_version FROM recorded r WHERE s.id=r.post_id`, [JSON.stringify(values)]);
}
function postId(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) throw failure(400, 'Invalid held-post identifier.');
  return value;
}
function reviewVersion(row) { return hash(JSON.stringify(row.post) + '\0' + iso(row.last_held_at)); }
function publicPost(post) {
  return Object.fromEntries(PUBLIC_FIELDS.filter(key => Object.hasOwn(post || {}, key))
    .map(key => [key, ['string', 'number', 'boolean'].includes(typeof post[key]) || post[key] === null ? post[key] : null]));
}
function queryInput(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key => !['q','source','group','limit','cursor'].includes(key))) throw failure(400, 'Invalid topic-review filters.');
  const q = query.q ?? '', source = query.source ?? '', limit = query.limit == null ? 25 : Number(query.limit);
  const group = query.group ?? '';
  if (typeof q !== 'string' || q.length > 200 || typeof source !== 'string' || source.length > 100
    || /[\x00-\x1f\x7f]/.test(q + source) || !Number.isInteger(limit) || limit < 1 || limit > 50
    || typeof group !== 'string' || (group && !/^[a-f0-9]{64}$/.test(group))) throw failure(400, 'Use valid review filters, a search of up to 200 characters and a page size between 1 and 50.');
  const filters = { q: q.trim().toLowerCase(), source: source.trim(), group, limit };
  const filter = hash(JSON.stringify([filters.q, filters.source, filters.group]));
  let after = null;
  if (query.cursor != null && query.cursor !== '') {
    try {
      if (typeof query.cursor !== 'string' || query.cursor.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
      after = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
      if (!after || Object.keys(after).sort().join(',') !== 'filter,id,time' || after.filter !== filter || typeof after.time !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(after.time)
        || new Date(after.time).toISOString().slice(0,19) !== after.time.slice(0,19)) throw new Error();
      postId(after.id);
    } catch { throw failure(400, 'The review page cursor is invalid or belongs to different filters.'); }
  }
  return { ...filters, filter, after };
}
function createUnknownTopicReview({ db, topics, transfer, groupForPost = () => null }) {
  const supported = [...new Set(topics.filter(topic => typeof topic === 'string' && !isUnknownTopic(topic)))].sort((a,b) => a.localeCompare(b));
  const taxonomy = supported.map(topic => ({ topic, subtopics: Object.keys(subtopicRules(topic)) }));
  const catalogVersion = hash(JSON.stringify(['review-groups-v3', TOPIC_EVIDENCE_VERSION, supported]));
  const grouping = createHeldTopicGroupWorker({ db, catalogVersion, reviewVersion,
    classify: post => heldPostGroup(post, supported, groupForPost(post)) });
  let initialized = false;
  const available = () => { if (!initialized || !db.isConnected()) throw failure(503, 'Held-post review is temporarily unavailable.'); };
  const jobs = createHeldPostJobs({ db, assignBatch: applyBatchAssignments,
    remainingDistribution: distributionRemaining, distribute, distributeJob });
  async function initialize() {
    await db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '5000ms'");
        await client.query('SELECT pg_advisory_xact_lock(721432,2)');
        for (const sql of UNKNOWN_TOPIC_REVIEW_SCHEMA) await client.query(sql);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      }
    });
    initialized = true;
  }
  async function distribution(queryRunner = db) {
    available();
    const { rows } = await queryRunner.query(`SELECT
      to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS through,
      (SELECT COUNT(*)::int FROM (${pendingStagedReceipts('a.assigned_at<=NOW()')}) staged) AS pending,
      (SELECT COUNT(DISTINCT a.post_id)::int FROM office_unknown_topic_manual_assignments a
       WHERE (a.processed_at IS NULL OR a.outcome='missing') AND NOT EXISTS (SELECT 1 FROM feed_posts_staging s WHERE s.id=a.post_id
         AND (s.held_review_version IS NULL OR s.held_review_version=a.review_version))) AS missing_staging`);
    return { ok: true, pending: Number(rows[0].pending), missingStaging: Number(rows[0].missing_staging), through: rows[0].through };
  }
  async function distributionRemaining(through) {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS pending
      FROM (${pendingStagedReceipts('a.assigned_at<=$1::timestamptz')}) staged`, [through]);
    return Number(rows[0].pending);
  }
  async function distribute(body = {}) {
    available();
    const through = body?.through;
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.confirmed !== true
      || Object.keys(body).some(key => !['confirmed','through'].includes(key))
      || typeof through !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(through)
      || !Number.isFinite(Date.parse(through)) || new Date(through).toISOString().slice(0,23) !== through.slice(0,23)) {
      throw failure(400, 'Confirm distribution using the current assigned-post snapshot.');
    }
    if (!await distributionRemaining(through)) return { ok: true, transferred: 0, drained: 0, screenedOut: 0,
      heldForReview: 0, remaining: 0, through, status: 'complete', message: 'Distribution finished for the assigned-post snapshot.' };
    if (typeof transfer !== 'function') throw failure(503, 'Assigned-post distribution is temporarily unavailable.');
    const result = await transfer({ maxBatches: 1, reason: 'office-held-distribute', manualAssignmentsThrough: through });
    if (!result || result.skipped) throw failure(409, 'A staging transfer is already running. Retry distribution when it completes.');
    const remaining = await distributionRemaining(through);
    const counts = { transferred: Number(result.transferred || 0), drained: Number(result.drained || 0),
      screenedOut: Number(result.screenedOut || 0), heldForReview: Number(result.heldForReview || 0) };
    const status = result.error && !result.retryable ? 'failed' : remaining ? 'running' : 'complete';
    const message = status === 'failed'
      ? 'Distribution stopped. Completed results are retained; uncommitted posts remain queued for retry.'
      : remaining ? 'Distribution is continuing through the assigned-post snapshot.' : 'Distribution finished for the assigned-post snapshot.';
    return { ok: true, ...counts, remaining, through, status, message };
  }
  async function distributeJob(id) {
    const result = await transfer({ maxBatches: 1, reason: 'office-held-distribute', distributionJobId: id });
    if (!result || result.skipped) throw failure(409, 'A staging transfer is already running. Retry distribution when it completes.');
    return result;
  }
  async function list(query) {
    available(); const { q, source, group, limit, filter, after } = queryInput(query);
    const where = `r.resolved_at IS NULL AND ${reviewSearch} AND ($4::text='' OR g.group_id=$4)`;
    const parameters = [catalogVersion,q,source,group];
    const result = await db.query(`SELECT r.post_id,r.post,r.first_held_at,r.last_held_at,r.reason,r.post->>'title' AS title,
      to_char(r.first_held_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS held_cursor,
      left(COALESCE(r.post->>'content',''),280) AS excerpt,r.post->>'source' AS source,r.post->>'media_type' AS media_type
      ${groupJoin} WHERE ${where}
      AND ($5::timestamptz IS NULL OR (r.first_held_at,r.post_id)>($5::timestamptz,$6::text))
      ORDER BY r.first_held_at,r.post_id LIMIT $7`, [...parameters,after?.time || null,after?.id || null,limit+1]);
    const count = await db.query(`SELECT COUNT(*)::int AS count ${groupJoin} WHERE ${where}`, parameters);
    const sources = await db.query("SELECT COALESCE(post->>'source','') AS source,COUNT(*)::int AS count FROM office_unknown_topic_review WHERE resolved_at IS NULL GROUP BY 1 ORDER BY 1");
    const selected = result.rows.slice(0,limit), last = selected.at(-1);
    return { ok: true, taxonomy, items: selected.map(row => ({ id: row.post_id, version: reviewVersion(row), title: row.title || 'Untitled post', excerpt: row.excerpt,
      source: row.source || '', mediaType: row.media_type || null, heldAt: iso(row.first_held_at), lastHeldAt: iso(row.last_held_at) })),
      total: Number(count.rows[0]?.count || 0), sources: sources.rows.map(row => ({ source: row.source, count: Number(row.count) })),
      nextCursor: result.rows.length > limit ? Buffer.from(JSON.stringify({ time: last.held_cursor, id: last.post_id, filter })).toString('base64url') : null };
  }
  async function groupProgress() {
    available();
    return grouping.progress();
  }
  async function refreshGroups(body = {}) {
    available();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw failure(400, 'Group refresh accepts an empty request body.');
    return grouping.retry();
  }
  async function indexGroups() {
    if (!initialized || !db.isConnected()) return { ok: false, processed: 0, waiting: true };
    return grouping.tick();
  }
  async function groups(query = {}) {
    available();
    if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key=>!['q','source','offset','limit'].includes(key))) throw failure(400,'Invalid review-group filters.');
    const {q,source}=queryInput({q:query.q,source:query.source});
    const offset=query.offset == null ? 0 : Number(query.offset),limit=query.limit == null ? 100 : Number(query.limit);
    if(!Number.isSafeInteger(offset)||offset<0||offset>1000000||!Number.isInteger(limit)||limit<1||limit>200) throw failure(400,'Use a group page size between 1 and 200 and a valid offset.');
    const where=`r.resolved_at IS NULL AND g.post_id IS NOT NULL AND ${reviewSearch}`;
    const parameters=[catalogVersion,q,source];
    const result=await db.query(`SELECT g.group_id,g.label,g.suggested_topic,g.suggested_subtopic,g.method,COUNT(*)::int AS count ${groupJoin}
      WHERE ${where} GROUP BY g.group_id,g.label,g.suggested_topic,g.suggested_subtopic,g.method ORDER BY count DESC,g.label,g.group_id LIMIT $4 OFFSET $5`,[...parameters,limit+1,offset]);
    const count=await db.query(`SELECT COUNT(DISTINCT g.group_id)::int AS count,COUNT(*)::int AS matched ${groupJoin} WHERE ${where}`,parameters);
    const selected=result.rows.slice(0,limit);
    const sampleRows=selected.length ? (await db.query(`SELECT id,title,group_id FROM (
      SELECT r.post_id AS id,left(COALESCE(r.post->>'title','Untitled post'),300) AS title,g.group_id,
        row_number() OVER(PARTITION BY g.group_id ORDER BY r.first_held_at,r.post_id) AS sample_number ${groupJoin}
      WHERE ${where} AND g.group_id=ANY($4::text[])) samples WHERE sample_number<=3`,[...parameters,selected.map(row=>row.group_id)])).rows : [];
    const sources=await db.query("SELECT COALESCE(post->>'source','') AS source,COUNT(*)::int AS count FROM office_unknown_topic_review WHERE resolved_at IS NULL GROUP BY 1 ORDER BY 1");
    return {ok:true,taxonomy,...await groupProgress(),matchedTotal:Number(count.rows[0]?.matched || 0),totalGroups:Number(count.rows[0]?.count || 0),
      sources:sources.rows.map(row=>({source:row.source,count:Number(row.count)})),
      groups:selected.map(row=>({id:row.group_id,label:row.label,topic:row.suggested_topic,subtopic:row.suggested_subtopic,method:row.method,count:Number(row.count),
        samples:sampleRows.filter(sample=>sample.group_id===row.group_id).map(({id,title})=>({id,title}))})),
      hasMore:result.rows.length>limit,nextOffset:result.rows.length>limit ? offset+limit : null};
  }
  async function groupMembers(id, query = {}) {
    available();
    if(typeof id !== 'string'||!/^[a-f0-9]{64}$/.test(id)||!query||typeof query!=='object'||Array.isArray(query)
      ||Object.keys(query).some(name=>!['q','source','cursor'].includes(name))) throw failure(400,'Invalid group membership request.');
    const {q,source}=queryInput({q:query.q,source:query.source});
    const filter=hash(JSON.stringify([id,q,source,catalogVersion]));
    const timestamp = value => typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)&&Number.isFinite(Date.parse(value));
    let after=null;
    if(query.cursor!=null&&query.cursor!=='') {
      try {
        if(typeof query.cursor!=='string'||query.cursor.length>4096||!/^[A-Za-z0-9_-]+$/.test(query.cursor))throw new Error();
        after=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));
        if(!after||Object.keys(after).sort().join(',')!=='filter,id,snapshot,time'||after.filter!==filter||!timestamp(after.time)
          ||typeof after.snapshot!=='string'||!/^\d{1,19}$/.test(after.snapshot)||BigInt(after.snapshot)>9223372036854775807n)throw new Error();
        postId(after.id);
      }catch{throw failure(400,'The group selection cursor is invalid or belongs to different filters.');}
    }
    // Refreshes serialize under their advisory lock. A sequence watermark
    // excludes a refresh that was in flight when this selection began, even
    // if that transaction's NOW() timestamp predates the first page.
    const snapshot=after?.snapshot || (await db.query('SELECT COALESCE(MAX(indexed_generation),0)::text AS snapshot FROM office_unknown_topic_review_groups')).rows[0].snapshot;
    const where=`r.resolved_at IS NULL AND ${reviewSearch} AND g.group_id=$4 AND g.indexed_generation<=$5::bigint`;
    const parameters=[catalogVersion,q,source,id,snapshot];
    const result=await db.query(`SELECT r.post_id,g.review_version,
      to_char(r.first_held_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS held_cursor
      ${groupJoin} WHERE ${where} AND ($6::timestamptz IS NULL OR (r.first_held_at,r.post_id)>($6::timestamptz,$7::text))
      ORDER BY r.first_held_at,r.post_id LIMIT 1001`,[...parameters,after?.time || null,after?.id || null]);
    const count=await db.query(`SELECT COUNT(*)::int AS count ${groupJoin} WHERE ${where}`,parameters);
    const selected=result.rows.slice(0,1000),last=selected.at(-1);
    return {ok:true,items:selected.map(row=>({id:row.post_id,expectedVersion:row.review_version})),total:Number(count.rows[0]?.count||0),
      nextCursor:result.rows.length>1000?Buffer.from(JSON.stringify({filter,time:last.held_cursor,id:last.post_id,snapshot})).toString('base64url'):null};
  }
  async function detail(id) {
    available(); postId(id);
    const { rows } = await db.query('SELECT * FROM office_unknown_topic_review WHERE post_id=$1', [id]);
    const row = rows[0]; if (!row) throw failure(404, 'This post is no longer held for review.');
    const suggested = resolvePostTopic(row.post, supported, { group: groupForPost(row.post) });
    return { ok: true, item: { id, version: reviewVersion(row), pending: !row.resolved_at, heldAt: iso(row.first_held_at),
      lastHeldAt: iso(row.last_held_at), resolvedAt: iso(row.resolved_at), reason: row.reason, post: publicPost(row.post) }, taxonomy,
      suggestions: suggested ? [{ topic: suggested.topic, subtopic: suggested.subtopic || null, evidence: suggested.evidence.slice(0, 10),
        confidence: suggested.confidence, evidenceSource: suggested.evidenceSource, subtopicEvidence: suggested.subtopicEvidence,
        subtopicAmbiguous: Boolean(suggested.subtopicAmbiguous) }] : [] };
  }
  const canAssign = body => body && typeof body === 'object' && !Array.isArray(body) && body.confirmed === true
    && supported.includes(body.topic) && (!Object.hasOwn(body, 'subtopic')
      || typeof body.subtopic === 'string' && Object.hasOwn(subtopicRules(body.topic), body.subtopic));
  const isReviewVersion = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const rejected = (id, status, message) => ({ id, ok: false, status, message });

  async function writeAssignments(client, items, topic, subtopic) {
    const { rows } = await client.query(`SELECT r.post_id,r.post,r.last_held_at,r.resolved_at,
      EXISTS(SELECT 1 FROM feed_posts_cache live WHERE live.id=r.post_id) AS live
      FROM office_unknown_topic_review r WHERE r.post_id=ANY($1::text[]) ORDER BY r.post_id FOR UPDATE OF r`, [items.map(item => item.id)]);
    const { rows: receipts } = await client.query(`SELECT a.post_id,a.topic,a.subtopic,a.assigned_at
      FROM jsonb_to_recordset($1::jsonb) AS request(id TEXT,"expectedVersion" TEXT)
      JOIN office_unknown_topic_manual_assignments a ON a.post_id=request.id AND a.review_version=request."expectedVersion"`, [JSON.stringify(items)]);
    const held = new Map(rows.map(row => [row.post_id, row]));
    const recorded = new Map(receipts.map(row => [row.post_id, row]));
    const results = new Map(), pending = [];
    for (const { id, expectedVersion } of items) {
      const row = held.get(id), previous = recorded.get(id);
      if (previous) {
        results.set(id, previous.topic !== topic || previous.subtopic !== subtopic
          ? rejected(id, 409, 'This version was already assigned to a different topic or subtopic. Refresh the post before continuing.')
          : { ok: true, id, topic, subtopic, assignedAt: iso(previous.assigned_at), status: 'queued', replayed: true,
            newerReviewPending: Boolean(row && !row.resolved_at && reviewVersion(row) !== expectedVersion),
            message: 'This assignment was already queued for the normal screening and transfer process.' });
      } else if (!row) {
        results.set(id, rejected(id, 404, 'This post is no longer held for review.'));
      } else if (reviewVersion(row) !== expectedVersion) {
        results.set(id, rejected(id, 409, 'The held post changed since it was opened. Refresh its preview and review the latest content.'));
      } else if (row.resolved_at || row.live) {
        const message = row.resolved_at ? 'This post has already been resolved. Refresh the review queue.'
          : 'A live copy already exists. Its current content was preserved; refresh the review queue.';
        results.set(id, rejected(id, 409, message));
      } else {
        pending.push({ post_id: id, review_version: expectedVersion, post: row.post });
      }
    }
    if (pending.length) {
      const saved = await client.query(`WITH incoming AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(post_id TEXT,review_version TEXT,post JSONB)
      ), staged AS (
        INSERT INTO feed_posts_staging
        SELECT (jsonb_populate_record(NULL::feed_posts_staging, x.post ||
          jsonb_build_object('id',x.post_id,'topic',$2::text,'held_review_version',x.review_version))).*
        FROM incoming x WHERE NOT EXISTS (SELECT 1 FROM feed_posts_cache live WHERE live.id=x.post_id)
        ORDER BY x.post_id ON CONFLICT(id) DO NOTHING RETURNING id
      ), assigned AS (
        INSERT INTO office_unknown_topic_manual_assignments(post_id,review_version,topic,subtopic,original_post)
        SELECT x.post_id,x.review_version,$2,$3,x.post FROM staged s JOIN incoming x ON x.post_id=s.id
        RETURNING post_id,assigned_at
      )
      UPDATE office_unknown_topic_review r SET resolved_at=NOW(),checked_at=NOW()
      FROM assigned a WHERE r.post_id=a.post_id RETURNING a.post_id,a.assigned_at`, [JSON.stringify(pending), topic, subtopic]);
      const assigned = new Map(saved.rows.map(row => [row.post_id, row.assigned_at]));
      const destination = subtopic ? `${topic} / ${subtopic}` : topic;
      for (const { post_id: id } of pending) {
        const assignedAt = assigned.get(id);
        results.set(id, assignedAt
          ? { ok: true, id, topic, subtopic, assignedAt: iso(assignedAt), status: 'queued', replayed: false,
            message: `Assigned to ${destination} and queued for normal screening and transfer.` }
          : rejected(id, 409, 'Another copy is already staged or live. It was preserved; refresh before assigning again.'));
      }
    }
    return items.map(({ id }) => results.get(id));
  }

  async function queueAssignments(items, topic, subtopic) {
    return db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '1500ms'");
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        const results = await writeAssignments(client, items, topic, subtopic);
        await client.query('COMMIT');
        return results;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (['55P03','40P01','40001'].includes(error.code)) throw failure(409, 'This post is being processed elsewhere. Its content is preserved; refresh and retry.');
        throw error;
      }
    });
  }

  async function writeAssignmentBatch(client, items, topic, subtopic) {
    await client.query('SAVEPOINT review_assignment_batch');
    try {
      const result = await writeAssignments(client, items, topic, subtopic);
      await client.query('RELEASE SAVEPOINT review_assignment_batch');
      return result;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT review_assignment_batch');
      await client.query('RELEASE SAVEPOINT review_assignment_batch');
      throw error;
    }
  }
  async function assign(id, body = {}) {
    available(); postId(id);
    if (!canAssign(body) || Object.keys(body).some(key => !['topic','subtopic','confirmed','expectedVersion'].includes(key))
      || !isReviewVersion(body.expectedVersion)) throw failure(400, 'Choose a supported topic and subtopic and confirm the current reviewed post.');
    const [result] = await queueAssignments([{ id, expectedVersion: body.expectedVersion }], body.topic, body.subtopic ?? null);
    if (!result.ok) throw failure(result.status, result.message);
    return result;
  }
  function validateAssignment(body, maxItems = Infinity, extraKeys = []) {
    const keys = ['items', 'topic', 'subtopic', 'confirmed', ...extraKeys];
    if (!canAssign(body) || Object.keys(body).some(key => !keys.includes(key))
      || !Array.isArray(body.items) || !body.items.length || body.items.length > maxItems) {
      throw failure(400, 'Choose a supported topic and subtopic and confirm the selected post versions.');
    }
    const seen = new Set();
    for (const item of body.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort().join(',') !== 'expectedVersion,id'
        || !isReviewVersion(item.expectedVersion)) throw failure(400, 'Each selected post must include its current review version.');
      postId(item.id);
      if (seen.has(item.id)) throw failure(400, 'A selected post may appear only once in a batch.');
      seen.add(item.id);
    }
  }

  async function applyBatchAssignments(items, topic, subtopic, client) {
    const queue = entries => client ? writeAssignmentBatch(client, entries, topic, subtopic) : queueAssignments(entries, topic, subtopic);
    const contentError = error => !error.status && /^(22|23|P0)/.test(error.code || '');
    let results;
    try {
      results = await queue(items);
    } catch (error) {
      // Isolate a content-specific failure so other reviewed posts can commit.
      // A background job retries transient failures with its cursor intact.
      if (client && !contentError(error)) throw error;
      if (items.length > 1 && contentError(error)) {
        results = [];
        for (const item of items) {
          try { results.push(...await queue([item])); }
          catch (rowError) {
            if (client && !contentError(rowError)) throw rowError;
            results.push(rejected(item.id, rowError.status || 503, rowError.status ? rowError.message
              : 'This post could not be queued. Its preserved review remains available for retry.'));
          }
        }
      } else {
        const message = error.status ? error.message : 'This batch could not be queued. Its preserved reviews remain available for retry.';
        results = items.map(({ id }) => rejected(id, error.status || 503, message));
      }
    }
    const assigned = results.filter(result => result.ok && !result.replayed).length;
    const replayed = results.filter(result => result.ok && result.replayed).length;
    const conflicts = results.filter(result => !result.ok && [404,409].includes(result.status)).length;
    const failed = results.length - assigned - replayed - conflicts;
    return { ok: true, assigned, replayed, conflicts, failed, results,
      message: `${assigned} posts queued for ${topic}; ${replayed} already queued; ${conflicts} changed or resolved; ${failed} failed.` };
  }

  async function batchAssign(body = {}) {
    available();
    validateAssignment(body, 100);
    return applyBatchAssignments(body.items, body.topic, body.subtopic ?? null);
  }

  async function startAssignment(body) {
    available();
    validateAssignment(body, Infinity, ['id']);
    const { id, items, topic, subtopic } = body;
    return jobs.start('assignment', { id, items, topic, subtopic });
  }

  async function startDistribution(body) {
    available();
    if (!body || body.confirmed !== true || Object.keys(body).sort().join(',') !== 'confirmed,id') {
      throw failure(400, 'Confirm distribution of the currently assigned held posts.');
    }
    return jobs.start('distribution', { id: body.id });
  }
  return { initialize, list, detail, assign, groups, refreshGroups, indexGroups, groupMembers, batchAssign, distribution, distribute,
    groupProgress: () => groupProgress(),
    listJobs: async () => {
      available();
      const [snapshot, active] = await Promise.all([distribution(), jobs.list()]);
      return { pending: snapshot.pending, missingStaging: snapshot.missingStaging, ...active };
    },
    startAssignment, startDistribution,
    stopJob: id => { available(); return jobs.stop(id); },
    sweepJobs: () => initialized && jobs.sweep(),
    pruneJobs: () => initialized && db.isConnected() && jobs.prune(),
    pendingAssignments: (ids, { queryRunner = db } = {}) => pendingManualAssignmentIds(queryRunner, ids),
    markProcessed: (ids, { queryRunner = db } = {}) => markManualAssignmentsProcessed(queryRunner, ids),
    recordOutcomes: (client, outcomes) => jobs.recordDistribution(client, outcomes),
    recordStagingRemoval: async (client, removed, reason) => {
      const receipts = await pendingReceiptsForRemoval(client, removed);
      await jobs.recordDistribution(client, receipts.map(({ post_id: id, review_version }) => ({
        id, review_version, outcome: 'screened', reason,
      })));
    } };
}
function registerOfficeTopicReviewRoutes(app, { requireOfficeToken, ...options }) {
  const service = createUnknownTopicReview(options);
  const privateResponse = (_req,res,next) => { res.set('Cache-Control','private, no-store'); next(); };
  const readLimit = rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false });
  const assignLimit = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false });
  const groupLimit = rateLimit({ windowMs:60000,limit:240,standardHeaders:true,legacyHeaders:false });
  const batchLimit = rateLimit({ windowMs:60000,limit:300,standardHeaders:true,legacyHeaders:false });
  const distributionLimit = rateLimit({ windowMs:60000,limit:60,standardHeaders:true,legacyHeaders:false });
  const route = action => async (req,res) => { try { res.json(await action(req)); } catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Topic review could not finish. The preserved post remains available for retry.' }); } };
  app.get('/office/topic-review',privateResponse,requireOfficeToken,readLimit,route(req => service.list(req.query)));
  app.get('/office/topic-review/groups',privateResponse,requireOfficeToken,readLimit,route(req=>service.groups(req.query)));
  app.get('/office/topic-review/groups/progress',privateResponse,requireOfficeToken,readLimit,route(()=>service.groupProgress()));
  app.post('/office/topic-review/groups/refresh',privateResponse,requireOfficeToken,groupLimit,route(req=>service.refreshGroups(req.body)));
  app.get('/office/topic-review/groups/:id/members',privateResponse,requireOfficeToken,readLimit,route(req=>service.groupMembers(req.params.id,req.query)));
  app.post('/office/topic-review/batch-assign',privateResponse,requireOfficeToken,batchLimit,route(req=>service.batchAssign(req.body)));
  app.get('/office/topic-review/distribution',privateResponse,requireOfficeToken,readLimit,route(() => service.distribution()));
  app.post('/office/topic-review/distribute',privateResponse,requireOfficeToken,distributionLimit,route(req => service.distribute(req.body)));
  app.get('/office/topic-review/jobs',privateResponse,requireOfficeToken,readLimit,route(() => service.listJobs()));
  app.post('/office/topic-review/jobs/assignment',privateResponse,requireOfficeToken,batchLimit,route(req => service.startAssignment(req.body)));
  app.post('/office/topic-review/jobs/distribution',privateResponse,requireOfficeToken,distributionLimit,route(req => service.startDistribution(req.body)));
  app.post('/office/topic-review/jobs/:id/stop',privateResponse,requireOfficeToken,distributionLimit,route(req => service.stopJob(req.params.id)));
  app.get('/office/topic-review/:id',privateResponse,requireOfficeToken,readLimit,route(req => service.detail(req.params.id)));
  app.post('/office/topic-review/:id/assign',privateResponse,requireOfficeToken,assignLimit,route(req => service.assign(req.params.id,req.body)));
  return service;
}
module.exports = { UNKNOWN_TOPIC_REVIEW_SCHEMA, createUnknownTopicReview, registerOfficeTopicReviewRoutes,
  pendingManualAssignmentIds, markManualAssignmentsProcessed, manualSubtopicsFor, recordRecoveredAssignments };
