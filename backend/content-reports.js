'use strict';

const { randomUUID } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const { getSourcePolicy, validateOriginalUrl } = require('./source-policy');

const REPORT_REASONS = Object.freeze(['child_safety', 'copyright', 'nonconsensual_intimate', 'harassment', 'spam', 'inappropriate', 'impersonation', 'other']);
const REPORT_SCHEMA = [
  `ALTER TABLE reports ADD COLUMN IF NOT EXISTS source TEXT`,
  `ALTER TABLE reports ADD COLUMN IF NOT EXISTS source_url TEXT`,
  `CREATE TABLE IF NOT EXISTS report_review_events (
    id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    actor TEXT NOT NULL, previous_status TEXT NOT NULL, status TEXT NOT NULL,
    note TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS report_review_events_report ON report_review_events(report_id, created_at)`,
];
// Run after both tables exist. Older Analytics reports become reviewable in
// the same protected queue; their established 90-day retention still applies.
const COPYRIGHT_REPORT_BRIDGE_SCHEMA = `INSERT INTO reports(id,reporter_id,target_type,target_id,reason,details,source,source_url,status,created_at)
  SELECT id::text,user_id::text,'post',source_url,'copyright',reason,source,source_url,
    CASE WHEN status='resolved' THEN 'resolved' ELSE 'open' END,created_at FROM creator_copyright_reports
  ON CONFLICT(id) DO NOTHING`;
const failure = (status, message) => Object.assign(new Error(message), { status });

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

function createContentReports({ db, notifyChildSafety = async () => {} }) {
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
    const { rows } = await db.query(`SELECT id, actor, previous_status AS "previousStatus", status, note, created_at AS "createdAt"
      FROM report_review_events WHERE report_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`, [id]);
    return { events: rows };
  }
  return { submit, list, review, history };
}

function registerContentReportRoutes(app, { db, authenticate, requireOfficeToken, notifyChildSafety }) {
  const service = createContentReports({ db, notifyChildSafety });
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
}

module.exports = { REPORT_REASONS, REPORT_SCHEMA, COPYRIGHT_REPORT_BRIDGE_SCHEMA, reportInput, createContentReports, registerContentReportRoutes };
