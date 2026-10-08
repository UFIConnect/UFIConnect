'use strict';

const { randomUUID } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const { getSourcePolicy, validateOriginalUrl, normalizeSource } = require('./source-policy');

const REPORT_REASONS = Object.freeze(['child_safety', 'copyright', 'nonconsensual_intimate', 'harassment', 'spam', 'inappropriate', 'impersonation', 'other']);
const REPORT_SCHEMA = [
  `ALTER TABLE reports ADD COLUMN IF NOT EXISTS source TEXT`,
  `ALTER TABLE reports ADD COLUMN IF NOT EXISTS source_url TEXT`,
  `CREATE TABLE IF NOT EXISTS report_review_events (
    id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    actor TEXT NOT NULL, previous_status TEXT NOT NULL, status TEXT NOT NULL,
    note TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS report_review_events_report ON report_review_events(report_id, created_at)`,
  `ALTER TABLE report_review_events ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'review'`,
  `ALTER TABLE report_review_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
  `ALTER TABLE report_review_events ADD COLUMN IF NOT EXISTS outcome JSONB NOT NULL DEFAULT '{}'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS report_review_action_key ON report_review_events(report_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
  // This record survives report/reporter deletion: deleting private report notes
  // must not publish content that Office already removed.
  `CREATE TABLE IF NOT EXISTS report_content_suppressions (
    target_type TEXT NOT NULL, target_id TEXT NOT NULL, source TEXT, source_url TEXT,
    kind TEXT NOT NULL, removed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(target_type, target_id))`,
  `CREATE INDEX IF NOT EXISTS report_suppression_original ON report_content_suppressions(source, source_url) WHERE source_url IS NOT NULL`,
];
// Run after both tables exist. Older Analytics reports become reviewable in
// the same protected queue; their established 90-day retention still applies.
const COPYRIGHT_REPORT_BRIDGE_SCHEMA = `INSERT INTO reports(id,reporter_id,target_type,target_id,reason,details,source,source_url,status,created_at)
  SELECT id::text,user_id::text,'post',source_url,'copyright',reason,source,source_url,
    CASE WHEN status='resolved' THEN 'resolved' ELSE 'open' END,created_at FROM creator_copyright_reports
  ON CONFLICT(id) DO NOTHING`;
const failure = (status, message) => Object.assign(new Error(message), { status });

// Only stored source identities and validated original links select a handoff.
// These links open the provider's reporting controls; they do not submit a report.
const SOURCE_REPORT_HELP = Object.freeze({
  youtube: 'https://support.google.com/youtube/answer/2802027',
  reddit: 'https://support.reddithelp.com/hc/en-us/articles/360058309512-How-do-I-report-a-post-or-comment',
  github: 'https://docs.github.com/en/communities/maintaining-your-safety-on-github/reporting-abuse-or-spam',
  twitter: 'https://help.x.com/en/safety-and-security/report-a-post',
  tiktok: 'https://www.tiktok.com/safety/en/reporting',
  bluesky: 'https://bsky.social/about/blog/11-19-2025-moderation-updates',
  mastodon: 'https://docs.joinmastodon.org/user/moderating/',
  vimeo: 'https://help.vimeo.com/hc/en-us/articles/12426004118417-Report-Abuse-and-Violations',
  tumblr: 'https://help.tumblr.com/knowledge-base/reporting-content/',
  twitch: 'https://help.twitch.tv/s/article/a-tour-of-your-channel-page',
  facebook: 'https://www.facebook.com/help/274852255072531',
  linkedin: 'https://www.linkedin.com/help/linkedin/answer/a1344213/recognize-and-report-spam-inappropriate-and-abusive-content',
  pinterest: 'https://help.pinterest.com/en-gb/article/report-something-on-pinterest',
  gitlab: 'https://docs.gitlab.com/user/report_abuse/',
  discord: 'https://discord.com/safety/360044103651-reporting-abusive-behavior-to-discord',
  snapchat: 'https://help.snapchat.com/hc/en-us/articles/7012399221652-How-do-I-report-abuse-illegal-content-or-other-violations-on-Snapchat',
});

function reportSuppressionPredicate(alias = 'fp') {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias)) throw new Error('Invalid feed table alias.');
  return `NOT EXISTS (SELECT 1 FROM report_content_suppressions rcs WHERE rcs.target_type = 'post'
    AND (rcs.target_id = ${alias}.id OR (rcs.source = ${alias}.source AND rcs.source_url IS NOT NULL AND rcs.source_url = ${alias}.source_url)))`;
}

function actionInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['action', 'note', 'confirmed', 'idempotencyKey'].includes(key))
      || !['remove_uficonnect', 'source_handoff', 'support_handoff'].includes(body.action)) throw failure(400, 'Choose a report action.');
  if (body.confirmed !== true) throw failure(400, 'Confirm the action before continuing.');
  if (typeof body.note !== 'string' || body.note.trim().length < 5 || body.note.length > 2000) throw failure(400, 'Add an action note between 5 and 2,000 characters.');
  if (typeof body.idempotencyKey !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.idempotencyKey)) throw failure(400, 'Provide an action request reference.');
  return { ...body, note: body.note.trim() };
}

function supportHandoff(id) {
  return { url: `mailto:support@uficonnect.org?subject=${encodeURIComponent(`Report review ${id}`)}&body=${encodeURIComponent(`Please review UFIConnect report ${id}.\n\n`)}`,
    deliveryStatus: 'manual_submission_required', label: 'UFIConnect support' };
}

async function resolveReportTarget(query, report) {
  const suppression = await query(`SELECT * FROM report_content_suppressions WHERE target_type=$1 AND (target_id=$2
    OR (source=$3 AND source_url=$2)) LIMIT 1`, [report.target_type, report.target_id, normalizeSource(report.source)]);
  let target = suppression.rows[0] ? { ...suppression.rows[0], removed: true } : null;
  if (!target && report.target_type === 'comment') {
    const { rows } = await query('SELECT id, post_id FROM post_comments WHERE id=$1', [report.target_id]);
    if (rows[0]) target = { target_type: 'comment', target_id: rows[0].id, postId: rows[0].post_id, source: 'uficonnect', source_url: null, kind: 'native_comment' };
  }
  if (!target && report.target_type === 'post') {
    const native = await query("SELECT id FROM community_posts WHERE id=$1 AND COALESCE(source,'uficonnect')='uficonnect'", [report.target_id]);
    if (native.rows[0]) target = { target_type: 'post', target_id: native.rows[0].id, source: 'uficonnect', source_url: null, kind: 'native_post' };
    else if (/^snap_[a-f0-9-]{36}$/i.test(report.target_id)) {
      const { rows } = await query('SELECT id FROM community_snaps WHERE id=$1 AND deleted_at IS NULL AND media_cleaned_at IS NULL', [report.target_id]);
      if (rows[0]) target = { target_type: 'post', target_id: rows[0].id, source: 'uficonnect', source_url: null, kind: 'native_snap' };
    }
    if (!target) {
      const { rows } = await query(`SELECT id, source, source_url FROM feed_posts_cache WHERE id=$1
        UNION ALL SELECT id, source, source_url FROM feed_posts_staging WHERE id=$1
        UNION ALL SELECT id, source, source_url FROM feed_posts_archive WHERE id=$1 LIMIT 1`, [report.target_id]);
      let row = rows[0];
      // Older creator reports use the original URL as their target ID. Require
      // both the stored URL and provider to match an actual cached record.
      if (!row && /^https:\/\//.test(report.target_id) && report.source) {
        const legacy = await query(`SELECT id, source, source_url FROM feed_posts_cache WHERE source_url=$1 AND source=$2
          UNION ALL SELECT id, source, source_url FROM feed_posts_staging WHERE source_url=$1 AND source=$2
          UNION ALL SELECT id, source, source_url FROM feed_posts_archive WHERE source_url=$1 AND source=$2 LIMIT 1`, [report.target_id, normalizeSource(report.source)]);
        row = legacy.rows[0];
      }
      if (row) target = { target_type: 'post', target_id: row.id, source: row.source, source_url: row.source_url, kind: 'external_post' };
    }
  }
  if (!target) return null;
  if (report.source && normalizeSource(report.source) !== normalizeSource(target.source)) throw failure(409, 'The reported source does not match the stored target. Review this report before taking action.');
  if (target.kind === 'external_post' && report.source_url && originalUrl(report.source_url) !== originalUrl(target.source_url)) throw failure(409, 'The reported original link does not match the stored target. Review this report before taking action.');
  return target;
}

function sourceHandoff(target) {
  const source = normalizeSource(target?.source), helpUrl = SOURCE_REPORT_HELP[source];
  const url = helpUrl && validateOriginalUrl(source, target.source_url);
  return url ? { url, helpUrl, label: getSourcePolicy(source).label, deliveryStatus: 'manual_submission_required' } : null;
}

function createReportVisibilityFilter({ db }) {
  return async function filterVisiblePosts(posts, targetType = 'post') {
    if (!['post', 'comment'].includes(targetType)) throw failure(400, 'Invalid content moderation target type.');
    if (!Array.isArray(posts) || !posts.length) return [];
    if (!db.isConnected()) throw failure(503, 'Content moderation checks are temporarily unavailable. Please try again.');
    const ids = posts.map(post => String(post.id || ''));
    const urls = targetType === 'post' ? posts.map(post => post.sourceUrl || post.source_url).filter(value => typeof value === 'string') : [];
    const { rows } = await db.query(`SELECT target_id, source, source_url FROM report_content_suppressions
      WHERE target_type=$3::text AND (target_id=ANY($1::text[]) OR ($3::text='post' AND source_url=ANY($2::text[])))`, [ids, urls, targetType]);
    const removedIds = new Set(rows.map(row => row.target_id));
    const removedOriginals = new Set(rows.filter(row => row.source_url).map(row => `${normalizeSource(row.source)}\n${row.source_url}`));
    return posts.filter(post => !removedIds.has(String(post.id || ''))
      && (targetType === 'comment' || !removedOriginals.has(`${normalizeSource(post.source)}\n${post.sourceUrl || post.source_url || ''}`)));
  };
}

// Context is supplied by the reporter, never treated as evidence of ownership
// or fetched by the server. In particular, reporting a URL cannot make an SSRF request.
function originalUrl(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f]/.test(value)) throw failure(400, 'Invalid original link.');
  let url;
  try { url = new URL(value); } catch { throw failure(400, 'Invalid original link.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw failure(400, 'Use an HTTPS original link without sign-in credentials.');
  return url.href;
}
function reportInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !['targetType', 'targetId', 'reason', 'details', 'source', 'sourceUrl'].includes(key))) throw failure(400, 'Invalid report.');
  const { targetType, targetId, reason, details, source } = body;
  if (!['post', 'comment', 'user'].includes(targetType)) throw failure(400, 'Invalid target type.');
  if (typeof targetId !== 'string' || !targetId.trim() || targetId.length > 300 || /[\u0000-\u001f]/.test(targetId)) throw failure(400, 'Invalid target.');
  if (!REPORT_REASONS.includes(reason)) throw failure(400, 'Choose a report reason.');
  if (details != null && (typeof details !== 'string' || details.length > 1000)) throw failure(400, 'Details must be 1,000 characters or fewer.');
  if (source != null && (typeof source !== 'string' || !/^[a-z0-9_-]{1,50}$/.test(source))) throw failure(400, 'Invalid source.');
  const sourceUrl = originalUrl(body.sourceUrl);
  const policy = getSourcePolicy(source);
  // A disabled adapter must still be reportable. Its original-link allowlist
  // prevents a forged URL being presented to reviewers as another provider.
  if (sourceUrl && policy && !validateOriginalUrl(source, sourceUrl)) throw failure(400, 'The original link does not match this source.');
  return { targetType, targetId: targetId.trim(), reason, details: details?.trim() || null, source: source || null, sourceUrl };
}

function createContentReports({ db, notifyChildSafety = async () => {}, onRemoved = () => {} }) {
  function available() {
    if (!db.isConnected()) throw failure(503, 'Reporting is temporarily unavailable. Please try again.');
  }
  async function submit(reporterId, body) {
    if (!reporterId) throw failure(401, 'Sign in to submit a report.');
    const value = reportInput(body);
    available();
    const report = { id: `report_${randomUUID()}`, reporterId, ...value };
    await db.query(`INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, source, source_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [report.id, reporterId, value.targetType, value.targetId, value.reason, value.details, value.source, value.sourceUrl]);
    // Notification failures never remove a successfully persisted report. The
    // alert only carries the queue reference, not private report text or identities.
    if (value.reason === 'child_safety') Promise.resolve().then(() => notifyChildSafety({ id: report.id })).catch(() => {});
    return { ok: true, id: report.id, status: 'open' };
  }
  async function list(status) {
    available();
    if (status != null && !['open', 'resolved'].includes(status)) throw failure(400, 'Invalid report status.');
    const { rows } = await db.query(`SELECT * FROM reports ${status ? 'WHERE status = $1' : ''}
      ORDER BY CASE WHEN reason = 'child_safety' THEN 0 ELSE 1 END, created_at DESC LIMIT 200`, status ? [status] : []);
    return { reports: rows.map(row => ({ id: row.id, reporterId: row.reporter_id, targetType: row.target_type, targetId: row.target_id,
      reason: row.reason, details: row.details, source: row.source, sourceUrl: row.source_url, status: row.status,
      createdAt: row.created_at, resolvedAt: row.resolved_at, resolvedBy: row.resolved_by })),
    openCount: rows.filter(row => row.status === 'open').length };
  }
  async function review(id, body) {
    available();
    if (!body || Object.keys(body).some(key => !['status', 'note'].includes(key)) || !['open', 'resolved'].includes(body.status)) throw failure(400, 'Choose open or resolved.');
    if (typeof body.note !== 'string' || body.note.trim().length < 5 || body.note.length > 2000) throw failure(400, 'Add a review note between 5 and 2,000 characters.');
    // A single statement commits the status and its audit entry together. The
    // Office credential is shared; do not invent an individual reviewer identity.
    const { rows } = await db.query(`WITH current AS (
        SELECT id, status FROM reports WHERE id = $1 FOR UPDATE
      ), updated AS (
        UPDATE reports SET status = $2, resolved_at = CASE WHEN $2 = 'resolved' THEN NOW() ELSE NULL END,
          resolved_by = CASE WHEN $2 = 'resolved' THEN 'office' ELSE NULL END
        WHERE id IN (SELECT id FROM current) RETURNING id
      ), creator_status AS (
        UPDATE creator_copyright_reports SET status = CASE WHEN $2 = 'resolved' THEN 'resolved' ELSE 'received' END
        WHERE id::text IN (SELECT id FROM updated)
      ) INSERT INTO report_review_events(id,report_id,actor,previous_status,status,note)
      SELECT $3, updated.id, 'office', current.status, $2, $4 FROM updated JOIN current ON current.id = updated.id RETURNING report_id`,
    [id, body.status, `review_${randomUUID()}`, body.note.trim()]);
    if (!rows.length) throw failure(404, 'Report not found.');
    return { ok: true, status: body.status };
  }
  async function history(id) {
    available();
    const report = await db.query('SELECT id FROM reports WHERE id = $1', [id]);
    if (!report.rows.length) throw failure(404, 'Report not found.');
    const { rows } = await db.query(`SELECT id, actor, previous_status AS "previousStatus", status, note, action, outcome, created_at AS "createdAt"
      FROM report_review_events WHERE report_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`, [id]);
    return { events: rows };
  }
  async function actions(id) {
    available();
    const { rows } = await db.query('SELECT * FROM reports WHERE id=$1', [id]);
    if (!rows[0]) throw failure(404, 'Report not found.');
    let target = null, targetError = '', account = null;
    if (rows[0].target_type === 'user') {
      const stored = await db.query('SELECT id FROM users WHERE id::text=$1', [rows[0].target_id]);
      if (stored.rows[0] && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(stored.rows[0].id)) {
        account = { available: true, id: stored.rows[0].id, url: `?account=${encodeURIComponent(stored.rows[0].id)}#analytics` };
      }
    }
    try { target = await resolveReportTarget(db.query.bind(db), rows[0]); }
    catch (error) { if (error.status !== 409) throw error; targetError = error.message; }
    const source = sourceHandoff(target);
    return { removal: { available: Boolean(target && !target.removed), removed: Boolean(target?.removed), kind: target?.kind || null,
      targetId: target?.target_id || null, source: target?.source || null,
      explanation: targetError || (target ? target.removed ? 'This content has already been removed from UFIConnect.' : target.kind === 'external_post'
        ? 'Remove the cached post from UFIConnect and prevent it from returning to the feed.' : 'Delete the stored UFIConnect content.'
        : rows[0].target_type === 'user' ? account ? 'Review this account in account management before taking account actions.' : 'The reported account could not be verified in stored accounts.' : 'The target could not be verified in stored content.') },
      source: source || { available: false, explanation: targetError || 'Source reporting is unavailable for this target. Contact support for guidance.' },
      support: supportHandoff(id), account };
  }
  async function act(id, body) {
    available();
    const value = actionInput(body);
    if (typeof db.withClient !== 'function') throw failure(503, 'Report actions are temporarily unavailable. Please try again.');
    const result = await db.withClient(async client => {
      await client.query('BEGIN');
      try {
        const { rows } = await client.query('SELECT * FROM reports WHERE id=$1 FOR UPDATE', [id]);
        const report = rows[0];
        if (!report) throw failure(404, 'Report not found.');
        const prior = await client.query('SELECT action, note, outcome FROM report_review_events WHERE report_id=$1 AND idempotency_key=$2', [id, value.idempotencyKey]);
        if (prior.rows[0]) {
          if (prior.rows[0].action !== value.action || prior.rows[0].note !== value.note) throw failure(409, 'This request reference was already used for a different action.');
          await client.query('COMMIT');
          return { ...prior.rows[0].outcome, replayed: true };
        }
        let outcome, nextStatus = report.status;
        if (value.action === 'support_handoff') outcome = { action: value.action, status: nextStatus, handoff: supportHandoff(id), message: 'Support draft prepared. Send it from your email application to contact support.' };
        else {
          const target = await resolveReportTarget(client.query.bind(client), report);
          if (!target) throw failure(409, 'The reported target could not be verified in stored content.');
          if (value.action === 'source_handoff') {
            const handoff = sourceHandoff(target);
            if (!handoff) throw failure(409, 'Source reporting is unavailable for this target. Contact support for guidance.');
            outcome = { action: value.action, status: nextStatus, handoff, message: 'Source reporting prepared. Open the original post and submit using the source reporting controls.' };
          } else {
            await client.query(`INSERT INTO report_content_suppressions(target_type,target_id,source,source_url,kind)
              VALUES($1,$2,$3,$4,$5) ON CONFLICT(target_type,target_id) DO NOTHING`, [target.target_type, target.target_id, target.source, target.source_url, target.kind]);
            if (target.kind === 'native_post') {
              await client.query('DELETE FROM post_comments WHERE post_id=$1', [target.target_id]);
              await client.query("DELETE FROM community_posts WHERE id=$1 AND COALESCE(source,'uficonnect')='uficonnect'", [target.target_id]);
            } else if (target.kind === 'native_snap') {
              await client.query('UPDATE community_snaps SET deleted_at=COALESCE(deleted_at,NOW()) WHERE id=$1', [target.target_id]);
            } else if (target.kind === 'native_comment' && !target.removed) {
              const deleted = await client.query('DELETE FROM post_comments WHERE id=$1 RETURNING post_id', [target.target_id]);
              if (deleted.rows[0]) await client.query('UPDATE community_posts SET comments_count=GREATEST(comments_count-1,0) WHERE id=$1', [deleted.rows[0].post_id]);
            } else if (target.kind === 'external_post') {
              for (const table of ['feed_posts_cache', 'feed_posts_staging', 'feed_posts_archive']) await client.query(`DELETE FROM ${table}
                WHERE id=$1 OR (source=$2 AND source_url=$3 AND $3 IS NOT NULL)`, [target.target_id, target.source, target.source_url]);
            }
            nextStatus = 'resolved';
            outcome = { action: value.action, status: nextStatus, removed: true, targetType: target.target_type, targetId: target.target_id,
              source: target.source, sourceUrl: target.source_url, kind: target.kind, postId: target.postId || null,
              message: target.removed ? 'This content was already removed from UFIConnect.' : 'Content removed from UFIConnect.' };
          }
        }
        await client.query(`UPDATE reports SET status=$2, resolved_at=CASE WHEN $2='resolved' THEN COALESCE(resolved_at,NOW()) ELSE NULL END,
          resolved_by=CASE WHEN $2='resolved' THEN 'office' ELSE NULL END WHERE id=$1`, [id, nextStatus]);
        if (nextStatus === 'resolved') await client.query("UPDATE creator_copyright_reports SET status='resolved' WHERE id::text=$1", [id]);
        await client.query(`INSERT INTO report_review_events(id,report_id,actor,previous_status,status,note,action,idempotency_key,outcome)
          VALUES($1,$2,'office',$3,$4,$5,$6,$7,$8::jsonb)`, [`review_${randomUUID()}`, id, report.status, nextStatus, value.note, value.action, value.idempotencyKey, JSON.stringify(outcome)]);
        await client.query('COMMIT');
        return outcome;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    });
    if (result.removed && !result.replayed) { try { await onRemoved(result); } catch { /* The durable suppression remains authoritative. */ } }
    return { ok: true, ...result };
  }
  return { submit, list, review, history, actions, act };
}

function registerContentReportRoutes(app, { db, authenticate, requireOfficeToken, notifyChildSafety, onRemoved }) {
  const service = createContentReports({ db, notifyChildSafety, onRemoved });
  const privateResponse = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
  const route = action => async (req, res) => {
    try { res.json(await action(req)); }
    catch (error) {
      // Database errors may contain private submitted values. Never echo or log them.
      const status = Number.isInteger(error?.status) ? error.status : 503;
      res.status(status).json({ message: error?.status ? error.message : 'Report storage is unavailable. Please try again.' });
    }
  };
  const limit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
    keyGenerator: req => req.user.id, message: { message: 'Too many reports. Please try again later.' } });
  app.post('/reports', privateResponse, authenticate, limit, route(req => service.submit(req.user.id, req.body)));
  app.get('/office/reports', privateResponse, requireOfficeToken, route(req => service.list(req.query.status)));
  app.patch('/office/reports/:id', privateResponse, requireOfficeToken, route(req => service.review(req.params.id, req.body)));
  app.get('/office/reports/:id/history', privateResponse, requireOfficeToken, route(req => service.history(req.params.id)));
  app.get('/office/reports/:id/actions', privateResponse, requireOfficeToken, route(req => service.actions(req.params.id)));
  app.post('/office/reports/:id/actions', privateResponse, requireOfficeToken, route(req => service.act(req.params.id, req.body)));
}

module.exports = { REPORT_REASONS, REPORT_SCHEMA, COPYRIGHT_REPORT_BRIDGE_SCHEMA, reportInput, actionInput, reportSuppressionPredicate, createReportVisibilityFilter, createContentReports, registerContentReportRoutes };
