'use strict';

const { createHash } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const { classifyTopic, isUnknownTopic, subtopicRules } = require('./office-topic-transfer');
const failure = (status, message) => Object.assign(new Error(message), { status });
const hash = value => createHash('sha256').update(value).digest('hex');
const iso = value => value ? new Date(value).toISOString() : null;
const PUBLIC_FIELDS = ['id', 'title', 'content', 'topic', 'source', 'source_url', 'author_name', 'author_handle', 'author_avatar_url',
  'author_profile_url', 'media_url', 'media_type', 'media_poster', 'video_duration_seconds', 'likes_count', 'comments_count',
  'likes', 'comments', 'post_created_at', 'fetched_at', 'location', 'group_id'];
const UNKNOWN_TOPIC_REVIEW_SCHEMA = [
  `CREATE INDEX IF NOT EXISTS office_unknown_topic_review_pending_order
    ON office_unknown_topic_review(first_held_at,post_id) WHERE resolved_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS office_unknown_topic_manual_assignments (
    post_id TEXT NOT NULL, review_version TEXT NOT NULL, topic TEXT NOT NULL, subtopic TEXT,
    original_post JSONB NOT NULL, assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), processed_at TIMESTAMPTZ,
    PRIMARY KEY(post_id,review_version))`,
  `ALTER TABLE office_unknown_topic_manual_assignments ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ`,
];
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
  if (!query || typeof query !== 'object' || Array.isArray(query) || Object.keys(query).some(key => !['q','source','limit','cursor'].includes(key))) throw failure(400, 'Invalid topic-review filters.');
  const q = query.q ?? '', source = query.source ?? '', limit = query.limit == null ? 25 : Number(query.limit);
  if (typeof q !== 'string' || q.length > 200 || typeof source !== 'string' || source.length > 100
    || /[\x00-\x1f\x7f]/.test(q + source) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw failure(400, 'Use a search of up to 200 characters and a page size between 1 and 50.');
  const filters = { q: q.trim().toLowerCase(), source: source.trim(), limit };
  const filter = hash(JSON.stringify([filters.q, filters.source]));
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
function createUnknownTopicReview({ db, topics }) {
  const supported = [...new Set(topics.filter(topic => typeof topic === 'string' && !isUnknownTopic(topic)))].sort((a,b) => a.localeCompare(b));
  const taxonomy = supported.map(topic => ({ topic, subtopics: Object.keys(subtopicRules(topic)) }));
  let initialized = false;
  const available = () => { if (!initialized || !db.isConnected()) throw failure(503, 'Held-post review is temporarily unavailable.'); };
  async function initialize() { for (const sql of UNKNOWN_TOPIC_REVIEW_SCHEMA) await db.query(sql); initialized = true; }
  async function list(query) {
    available(); const { q, source, limit, filter, after } = queryInput(query);
    const where = `resolved_at IS NULL AND ($1::text='' OR strpos(lower(COALESCE(post->>'title','') || ' ' || COALESCE(post->>'content','') || ' ' || COALESCE(post->>'source','')),$1)>0)
      AND ($2::text='' OR post->>'source'=$2)`;
    const result = await db.query(`SELECT post_id,first_held_at,last_held_at,reason,post->>'title' AS title,
      to_char(first_held_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS held_cursor,
      left(COALESCE(post->>'content',''),280) AS excerpt,post->>'source' AS source,post->>'media_type' AS media_type
      FROM office_unknown_topic_review WHERE ${where}
      AND ($3::timestamptz IS NULL OR (first_held_at,post_id)>($3::timestamptz,$4::text))
      ORDER BY first_held_at,post_id LIMIT $5`, [q,source,after?.time || null,after?.id || null,limit+1]);
    const count = await db.query(`SELECT COUNT(*)::int AS count FROM office_unknown_topic_review WHERE ${where}`, [q,source]);
    const sources = await db.query("SELECT COALESCE(post->>'source','') AS source,COUNT(*)::int AS count FROM office_unknown_topic_review WHERE resolved_at IS NULL GROUP BY 1 ORDER BY 1");
    const selected = result.rows.slice(0,limit), last = selected.at(-1);
    return { ok: true, items: selected.map(row => ({ id: row.post_id, title: row.title || 'Untitled post', excerpt: row.excerpt,
      source: row.source || '', mediaType: row.media_type || null, heldAt: iso(row.first_held_at), lastHeldAt: iso(row.last_held_at) })),
      total: Number(count.rows[0]?.count || 0), sources: sources.rows.map(row => ({ source: row.source, count: Number(row.count) })),
      nextCursor: result.rows.length > limit ? Buffer.from(JSON.stringify({ time: last.held_cursor, id: last.post_id, filter })).toString('base64url') : null };
  }
  async function detail(id) {
    available(); postId(id);
    const { rows } = await db.query('SELECT * FROM office_unknown_topic_review WHERE post_id=$1', [id]);
    const row = rows[0]; if (!row) throw failure(404, 'This post is no longer held for review.');
    const suggested = classifyTopic(row.post, supported);
    return { ok: true, item: { id, version: reviewVersion(row), pending: !row.resolved_at, heldAt: iso(row.first_held_at),
      lastHeldAt: iso(row.last_held_at), resolvedAt: iso(row.resolved_at), reason: row.reason, post: publicPost(row.post) }, taxonomy,
      suggestions: suggested ? [{ topic: suggested.topic, subtopic: suggested.subtopic || null, evidence: (suggested.evidence || []).slice(0,10) }] : [] };
  }
  async function assign(id, body = {}) {
    available(); postId(id);
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.confirmed !== true
      || Object.keys(body).some(key => !['topic','confirmed','expectedVersion'].includes(key))
      || !supported.includes(body.topic) || typeof body.expectedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedVersion)) throw failure(400, 'Choose a supported topic and confirm the current reviewed post.');
    const subtopic = null;
    return db.withClient(async client => {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '1500ms'");
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        const row = (await client.query('SELECT * FROM office_unknown_topic_review WHERE post_id=$1 FOR UPDATE', [id])).rows[0];
        const previous = (await client.query('SELECT topic,subtopic,assigned_at FROM office_unknown_topic_manual_assignments WHERE post_id=$1 AND review_version=$2', [id,body.expectedVersion])).rows[0];
        if (previous) {
          if (previous.topic !== body.topic || previous.subtopic !== subtopic) throw failure(409, 'This version was already assigned to a different topic. Refresh the post before continuing.');
          await client.query('COMMIT');
          return { ok: true, id, topic: previous.topic, assignedAt: iso(previous.assigned_at), status: 'queued', replayed: true,
            newerReviewPending: Boolean(row && !row.resolved_at && reviewVersion(row) !== body.expectedVersion), message: 'This assignment was already queued for the normal screening and transfer process.' };
        }
        if (!row) throw failure(404, 'This post is no longer held for review.');
        if (reviewVersion(row) !== body.expectedVersion) throw failure(409, 'The held post changed since it was opened. Refresh its preview and review the latest content.');
        if (row.resolved_at) throw failure(409, 'This post has already been resolved. Refresh the review queue.');
        if ((await client.query('SELECT id FROM feed_posts_cache WHERE id=$1', [id])).rows.length) throw failure(409, 'A live copy already exists. Its current content was preserved; refresh the review queue.');
        const saved = await client.query(`INSERT INTO feed_posts_staging
          SELECT (jsonb_populate_record(NULL::feed_posts_staging,$1::jsonb)).*
          WHERE NOT EXISTS(SELECT 1 FROM feed_posts_cache WHERE id=$2)
          ON CONFLICT(id) DO NOTHING RETURNING id`, [JSON.stringify({ ...row.post, id, topic: body.topic }),id]);
        if (!saved.rows.length) throw failure(409, 'Another copy is already staged or live. It was preserved; refresh before assigning again.');
        const receipt = await client.query(`INSERT INTO office_unknown_topic_manual_assignments(post_id,review_version,topic,subtopic,original_post)
          VALUES($1,$2,$3,$4,$5::jsonb) RETURNING assigned_at`, [id,body.expectedVersion,body.topic,subtopic,JSON.stringify(row.post)]);
        await client.query('UPDATE office_unknown_topic_review SET resolved_at=NOW(),checked_at=NOW() WHERE post_id=$1', [id]);
        await client.query('COMMIT');
        return { ok: true, id, topic: body.topic, assignedAt: iso(receipt.rows[0].assigned_at), status: 'queued', replayed: false,
          message: `Assigned to ${body.topic} and queued for normal screening and transfer.` };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (['55P03','40P01','40001'].includes(error.code)) throw failure(409, 'This post is being processed elsewhere. Its content is preserved; refresh and retry.');
        throw error;
      }
    });
  }
  return { initialize, list, detail, assign,
    pendingAssignments: (ids, { queryRunner = db } = {}) => pendingManualAssignmentIds(queryRunner, ids),
    markProcessed: (ids, { queryRunner = db } = {}) => markManualAssignmentsProcessed(queryRunner, ids) };
}
function registerOfficeTopicReviewRoutes(app, { requireOfficeToken, ...options }) {
  const service = createUnknownTopicReview(options);
  const privateResponse = (_req,res,next) => { res.set('Cache-Control','private, no-store'); next(); };
  const readLimit = rateLimit({ windowMs: 60000, limit: 120, standardHeaders: true, legacyHeaders: false });
  const assignLimit = rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false });
  const route = action => async (req,res) => { try { res.json(await action(req)); } catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Topic review could not finish. The preserved post remains available for retry.' }); } };
  app.get('/office/topic-review',privateResponse,requireOfficeToken,readLimit,route(req => service.list(req.query)));
  app.get('/office/topic-review/:id',privateResponse,requireOfficeToken,readLimit,route(req => service.detail(req.params.id)));
  app.post('/office/topic-review/:id/assign',privateResponse,requireOfficeToken,assignLimit,route(req => service.assign(req.params.id,req.body)));
  return service;
}
module.exports = { UNKNOWN_TOPIC_REVIEW_SCHEMA, createUnknownTopicReview, registerOfficeTopicReviewRoutes,
  pendingManualAssignmentIds, markManualAssignmentsProcessed };
