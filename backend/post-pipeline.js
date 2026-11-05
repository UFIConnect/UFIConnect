'use strict';

const { randomUUID } = require('node:crypto');
const RETENTION_DAYS = 7;
const MAX_EVENTS = 100000;
const MAX_PENDING = 5000;
const STAGES = ['staging', 'live', 'archived', 'queued', 'rejected', 'duplicate', 'retrying', 'dropped'];
const clean = (value, limit = 500) => String(value ?? '').replace(/\u0000/g, '').slice(0, limit).toWellFormed();
const safeUrl = value => {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    url.username = ''; url.password = ''; url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|secret|auth|pass|signature|credential|session|jwt|x-amz|x-goog/i.test(key)) url.searchParams.delete(key);
    }
    return url.href.slice(0, 2000);
  } catch { return ''; }
};

async function initializePostPipeline(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS feed_post_events (
    event_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, source TEXT NOT NULL,
    title TEXT, source_url TEXT, stage TEXT NOT NULL, reason TEXT, role TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await db.query('CREATE INDEX IF NOT EXISTS fpe_post_time_idx ON feed_post_events(post_id, occurred_at DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS fpe_time_idx ON feed_post_events(occurred_at DESC)');
  await db.query(`CREATE TABLE IF NOT EXISTS feed_post_progress (
    post_id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT, source_url TEXT,
    stage TEXT NOT NULL, reason TEXT, role TEXT, occurred_at TIMESTAMPTZ NOT NULL
  )`);
  await db.query('CREATE INDEX IF NOT EXISTS fpp_time_idx ON feed_post_progress(occurred_at DESC, post_id DESC)');
  await db.query('CREATE INDEX IF NOT EXISTS fpp_stage_time_idx ON feed_post_progress(stage, occurred_at DESC)');
}

// Bounded, asynchronous telemetry must never block ingestion or claim to be lossless.
function createPostPipelineTracker(db, { role = 'api', schedule = setTimeout } = {}) {
  let pending = [], timer = null, inFlight = false, lastCleanup = 0, lastTimestamp = 0;
  let liveCount = 0;
  const health = { droppedEvents: 0, lastError: null, lastPersistedAt: null };
  function enqueue() {
    if (timer || inFlight || !pending.length) return;
    timer = schedule(() => { timer = null; void flush(); }, health.lastError ? 5000 : 500);
    timer?.unref?.();
  }
  function record(post, stage, reason = '') {
    if (!STAGES.includes(stage)) return;
    lastTimestamp = Math.max(Date.now() * 1000, lastTimestamp + 1);
    const occurredAt = new Date(Math.floor(lastTimestamp / 1000)).toISOString().replace('Z', String(lastTimestamp % 1000).padStart(3, '0') + 'Z');
    pending.push({ event_id: randomUUID(), post_id: clean(post?.id || `invalid:${randomUUID()}`, 1000),
      source: clean(post?.source || 'unknown', 100), title: clean(post?.title),
      source_url: safeUrl(post?.sourceUrl || post?.source_url), stage,
      reason: clean(reason, 300), role, occurred_at: occurredAt });
    if (pending.length > MAX_PENDING) {
      health.droppedEvents += pending.length - MAX_PENDING;
      pending.splice(0, pending.length - MAX_PENDING);
    }
    enqueue();
  }
  async function flush() {
    if (inFlight || !pending.length) return;
    if (!db.isConnected()) { health.lastError = 'Database unavailable'; enqueue(); return; }
    inFlight = true;
    const batch = pending.splice(0, 1000);
    try {
      await db.query(`WITH incoming AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(event_id TEXT, post_id TEXT, source TEXT,
          title TEXT, source_url TEXT, stage TEXT, reason TEXT, role TEXT, occurred_at TIMESTAMPTZ)
      ), events AS (
        INSERT INTO feed_post_events SELECT * FROM incoming ON CONFLICT (event_id) DO NOTHING
      ) INSERT INTO feed_post_progress
        SELECT DISTINCT ON (post_id) post_id, source, title, source_url, stage, reason, role, occurred_at
        FROM incoming ORDER BY post_id, (stage='duplicate'), occurred_at DESC, event_id DESC
        ON CONFLICT (post_id) DO UPDATE SET source=EXCLUDED.source, title=EXCLUDED.title,
          source_url=EXCLUDED.source_url,
          stage=CASE WHEN EXCLUDED.stage='duplicate' THEN feed_post_progress.stage ELSE EXCLUDED.stage END,
          reason=CASE WHEN EXCLUDED.stage='duplicate' THEN feed_post_progress.reason ELSE EXCLUDED.reason END,
          role=EXCLUDED.role, occurred_at=EXCLUDED.occurred_at
        WHERE feed_post_progress.occurred_at <= EXCLUDED.occurred_at`, [JSON.stringify(batch)]);
      health.lastError = null;
      health.lastPersistedAt = new Date().toISOString();
      try {
        const { rows: countRows } = await db.query('SELECT COUNT(*) as count FROM feed_posts_cache');
        liveCount = Number(countRows[0].count);
      } catch {
        // Silent fail to prevent blocking flush
      }
      if (Date.now() - lastCleanup > 60000) {
        await db.query(`DELETE FROM feed_post_events WHERE occurred_at < NOW() - INTERVAL '7 days'
          OR event_id IN (SELECT event_id FROM feed_post_events ORDER BY occurred_at DESC OFFSET ${MAX_EVENTS})`);
        await db.query(`DELETE FROM feed_post_progress WHERE occurred_at < NOW() - INTERVAL '7 days'
          OR post_id IN (SELECT post_id FROM feed_post_progress ORDER BY occurred_at DESC OFFSET ${MAX_EVENTS})`);
        lastCleanup = Date.now();
      }
    } catch {
      health.lastError = 'Post history write failed; retry pending';
      pending = [...batch, ...pending];
      if (pending.length > MAX_PENDING) {
        health.droppedEvents += pending.length - MAX_PENDING;
        pending = pending.slice(-MAX_PENDING);
      }
    } finally { inFlight = false; enqueue(); }
  }
  return { record, flush, status: () => ({ ...health, pendingEvents: pending.length, inFlight, liveCount }) };
}

const inventory = `
  SELECT s.id, s.source, s.title, s.source_url, s.media_type, s.topic, s.post_created_at,
    s.fetched_at AS updated_at, 'staging'::text AS stage, 'Awaiting transfer'::text AS reason
    FROM feed_posts_staging s
  UNION ALL
  SELECT c.id, c.source, c.title, c.source_url, c.media_type, c.topic, c.post_created_at,
    c.fetched_at, 'live', 'Available in live cache' FROM feed_posts_cache c
    WHERE NOT EXISTS (SELECT 1 FROM feed_posts_staging s WHERE s.id=c.id)
  UNION ALL
  SELECT a.id, a.source, a.title, a.source_url, a.media_type, a.topic, a.post_created_at,
    a.archived_at, 'archived', a.archive_reason FROM feed_posts_archive a
    WHERE NOT EXISTS (SELECT 1 FROM feed_posts_staging s WHERE s.id=a.id)
      AND NOT EXISTS (SELECT 1 FROM feed_posts_cache c WHERE c.id=a.id)
  UNION ALL
  SELECT p.post_id, p.source, p.title, p.source_url, NULL, NULL, NULL,
    p.occurred_at, p.stage, p.reason FROM feed_post_progress p
    WHERE NOT EXISTS (SELECT 1 FROM feed_posts_staging s WHERE s.id=p.post_id)
      AND NOT EXISTS (SELECT 1 FROM feed_posts_cache c WHERE c.id=p.post_id)
      AND NOT EXISTS (SELECT 1 FROM feed_posts_archive a WHERE a.id=p.post_id)
      AND p.stage NOT IN ('staging', 'live', 'archived')`;

function pipelineFilters(query = {}) {
  const stage = clean(query.stage, 30);
  if (stage && stage !== 'all' && !STAGES.includes(stage)) throw new Error('Invalid pipeline stage');
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 40));
  const offset = Math.max(0, Math.min(10000000, Number.parseInt(query.offset, 10) || 0));
  const q = clean(query.q, 200).trim();
  const source = clean(query.source, 100).trim();
  const since = query.since ? new Date(String(query.since)) : null;
  if (since && !Number.isFinite(since.getTime())) throw new Error('Invalid pipeline date');
  return { stage, limit, offset, q, source, since };
}

function createPostPipelineReader(db) {
  let statsCache = null, statsAt = 0;
  async function stats() {
    if (statsCache && Date.now() - statsAt < 30000) return statsCache;
    const { rows } = await db.query(`SELECT
      (SELECT COUNT(*) FROM feed_posts_staging) AS staging,
      (SELECT COUNT(*) FROM feed_posts_cache) AS live,
      (SELECT COUNT(*) FROM feed_posts_archive) AS archived,
      (SELECT MIN(fetched_at) FROM feed_posts_staging) AS oldest_staged_at,
      (SELECT COUNT(*) FROM feed_post_events) AS retained_events,
      (SELECT MIN(occurred_at) FROM feed_post_events) AS history_starts_at`);
    statsCache = { ...rows[0], sampledAt: new Date().toISOString() }; statsAt = Date.now();
    return statsCache;
  }
  async function list(query) {
    const { stage, limit, offset, q, source, since } = pipelineFilters(query);
    const params = [], where = [];
    const bind = value => { params.push(value); return `$${params.length}`; };
    if (stage && stage !== 'all') where.push(`stage=${bind(stage)}`);
    if (source) where.push(`LOWER(source)=LOWER(${bind(source)})`);
    if (q) {
      const term = bind('%' + q.replace(/[\\%_]/g, '\\$&') + '%');
      where.push(`(id ILIKE ${term} OR title ILIKE ${term} OR source_url ILIKE ${term})`);
    }
    if (since) where.push(`updated_at >= ${bind(since.toISOString())}`);
    const { rows } = await db.query(`SELECT * FROM (${inventory}) inventory
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT ${bind(limit + 1)} OFFSET ${bind(offset)}`, params);
    return { posts: rows.slice(0, limit).map(row => ({ ...row, source_url: safeUrl(row.source_url) })),
      hasMore: rows.length > limit, offset, limit, stats: await stats(),
      coverage: { retentionDays: RETENTION_DAYS, maxEvents: MAX_EVENTS, storage: 'All retained staging, live and archive rows; current storage takes precedence over recent events.' },
      fetchedAt: new Date().toISOString() };
  }
  async function detail(id) {
    const snapshots = [];
    for (const [table, stage] of [['feed_posts_staging', 'staging'], ['feed_posts_cache', 'live'], ['feed_posts_archive', 'archived']]) {
      const { rows } = await db.query(`SELECT * FROM ${table} WHERE id=$1`, [id]);
      if (rows[0]) snapshots.push({ ...rows[0], source_url: safeUrl(rows[0].source_url), media_url: safeUrl(rows[0].media_url), media_poster: safeUrl(rows[0].media_poster), stage });
    }
    const { rows: events } = await db.query(`SELECT * FROM feed_post_events WHERE post_id=$1
      ORDER BY occurred_at DESC, event_id DESC LIMIT 501`, [id]);
    if (!snapshots.length && !events.length) return null;
    let queuePosition = null;
    const staged = snapshots.find(row => row.stage === 'staging');
    if (staged?.fetched_at) {
      const { rows } = await db.query(`SELECT COUNT(*)+1 AS position FROM feed_posts_staging
        WHERE (fetched_at, id) < ($1::timestamptz, $2::text)`, [staged.fetched_at, id]);
      queuePosition = Number(rows[0].position);
    }
    return { id, snapshots, events: events.slice(0, 500), historyTruncated: events.length > 500,
      queuePosition, fetchedAt: new Date().toISOString(), retentionDays: RETENTION_DAYS };
  }
  return { list, detail };
}

module.exports = { initializePostPipeline, createPostPipelineTracker, createPostPipelineReader, pipelineFilters, safeUrl };
