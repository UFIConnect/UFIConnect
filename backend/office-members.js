'use strict';

const { createHash } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const OUTCOMES = ['created', 'invalid', 'duplicate', 'limited', 'unavailable', 'failed'];
const REGISTRATION_HISTORY_START = '2026-05-01';
const OFFICE_MEMBERS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS signup_daily_counts (
    day DATE NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('created','invalid','duplicate','limited','unavailable','failed')),
    event_count BIGINT NOT NULL CHECK(event_count > 0), PRIMARY KEY(day,outcome))`,
  `CREATE TABLE IF NOT EXISTS registration_history_daily_counts (
    source TEXT NOT NULL CHECK(source='database_backup_20261008'), day DATE NOT NULL CHECK(day >= DATE '2026-05-01'),
    event_count BIGINT NOT NULL CHECK(event_count > 0), restored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(source,day))`,
  `CREATE TABLE IF NOT EXISTS registration_history_date_corrections (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    registered_day DATE NOT NULL CHECK(registered_day >= DATE '2026-05-01'),
    source TEXT NOT NULL CHECK(source='database_backup_20261008'), restored_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE TABLE IF NOT EXISTS office_member_email (
    id UUID PRIMARY KEY, user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    subject TEXT NOT NULL CHECK(length(subject) BETWEEN 1 AND 160), payload_hash CHAR(64) NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('sending','accepted','failed','uncertain')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS office_member_email_created ON office_member_email(created_at)`,
  `CREATE TABLE IF NOT EXISTS office_user_cache_epoch (id INTEGER PRIMARY KEY CHECK(id=1), version BIGINT NOT NULL DEFAULT 0)`,
  `INSERT INTO office_user_cache_epoch(id,version) VALUES(1,0) ON CONFLICT(id) DO NOTHING`,
];
const failure = (status, message) => Object.assign(new Error(message), { status });
const count = value => Number(value || 0);
const deliveryStatusSql = `CASE WHEN status='sending' AND updated_at < NOW() - INTERVAL '2 minutes'
  THEN 'uncertain' ELSE status END`;
const addressOf = value => typeof value === 'string' ? value.trim().toLowerCase()
  : typeof value?.address === 'string' ? value.address.trim().toLowerCase() : '';
function explicitMailRejection(error) {
  if (error?.code === 'EAUTH') return true;
  const code = Number(error?.responseCode);
  const command = typeof error?.command === 'string' ? error.command.toUpperCase().trim() : '';
  // A QUIT failure can happen after DATA was already accepted. Require an
  // explicit rejection of a command that precedes or submits the message.
  return Number.isInteger(code) && code >= 400 && code <= 599
    && /^(?:CONN|EHLO|HELO|AUTH(?:\s|$)|MAIL FROM(?:\s|$)|RCPT TO(?:\s|$)|DATA(?:\s|$))/.test(command);
}

function createOfficeMembers({ db, getCachedUserIds = () => [], clearUserCache = () => 0,
  mailAvailable = () => false, sendMail = async () => { throw failure(503, 'Email delivery is not configured.'); }, schedule = setInterval }) {
  let lastPrunedDay = '';
  let cacheVersion = 0;
  async function refreshCacheEpoch() {
    if (!db.isConnected()) return;
    const { rows: [row] } = await db.query('SELECT version FROM office_user_cache_epoch WHERE id=1');
    if (row && Number(row.version) !== cacheVersion) {
      clearUserCache();
      cacheVersion = Number(row.version);
    }
  }
  // A shared revision invalidates each worker's user cache, including workers
  // other than the one that received the Office action.
  const timer = schedule(() => { void refreshCacheEpoch().catch(() => {}); }, 5000);
  timer?.unref?.();
  function available() { if (!db.isConnected()) throw failure(503, 'Account storage is temporarily unavailable.'); }
  async function prune() {
    const today = new Date().toISOString().slice(0, 10);
    if (lastPrunedDay === today) return;
    await db.query('DELETE FROM signup_daily_counts WHERE day < $1::date', [REGISTRATION_HISTORY_START]);
    await db.query("DELETE FROM office_member_email WHERE created_at < NOW() - INTERVAL '90 days'");
    lastPrunedDay = today;
  }
  async function recordSignup(status) {
    if (!db.isConnected()) return;
    const outcome = status === 201 ? 'created' : status === 400 ? 'invalid' : status === 409 ? 'duplicate'
      : status === 429 ? 'limited' : status === 503 ? 'unavailable' : 'failed';
    await db.query(`INSERT INTO signup_daily_counts(day,outcome,event_count)
      VALUES((NOW() AT TIME ZONE 'UTC')::date,$1,1) ON CONFLICT(day,outcome)
      DO UPDATE SET event_count=signup_daily_counts.event_count+1`, [outcome]);
  }
  function signupMiddleware(_req, res, next) {
    // Only the fixed response outcome is collected; no submitted fields,
    // account IDs, addresses, IPs or session identifiers enter these counts.
    res.once('finish', () => { void recordSignup(res.statusCode).catch(() => {}); });
    next();
  }
  async function list(query = {}) {
    available();
    const search = query.q == null ? '' : query.q;
    const state = query.state || 'all';
    if (typeof search !== 'string' || search.length > 160 || !['all', 'complete', 'incomplete', 'hidden'].includes(state)) throw failure(400, 'Invalid account filter.');
    const page = query.page == null ? 1 : Number(query.page);
    if (!Number.isInteger(page) || page < 1 || page > 100000) throw failure(400, 'Invalid account page.');
    const registrationFrom = query.days === 'since_may' ? REGISTRATION_HISTORY_START : null;
    const days = query.days == null || query.days === 'all' || registrationFrom ? null : Number(query.days);
    if (days !== null && ![30,120].includes(days)) throw failure(400, 'Choose registrations since May, all registrations, 30 days or 120 days.');
    const pageSize = 50;
    // Counts and the page use the same PostgreSQL statement snapshot. Office
    // reads authoritative records directly, never a feed/profile cache.
    const { rows: [row] } = await db.query(`WITH account_rows AS (
      SELECT users.id,name,CASE WHEN email LIKE '%@identity.uficonnect.invalid' THEN '' ELSE email END AS email,created_at,COALESCE(onboarding_complete,false) AS onboarded,
        LEAST((created_at AT TIME ZONE 'UTC')::date, correction.registered_day) AS registered_day,
        (profile_hidden IS TRUE OR COALESCE(role_settings->>'privacy_publicProfile','true')='false') AS hidden
      FROM users LEFT JOIN registration_history_date_corrections correction ON correction.user_id=users.id
    ), filtered AS (
      SELECT * FROM account_rows WHERE ($1='' OR id::text=$1 OR strpos(lower(name),lower($1))>0 OR strpos(lower(email),lower($1))>0)
      AND ($2='all' OR ($2='complete' AND onboarded) OR ($2='incomplete' AND NOT onboarded) OR ($2='hidden' AND hidden))
      AND ($5::integer IS NULL OR created_at >= (date_trunc('day',NOW() AT TIME ZONE 'UTC') - ($5::integer - 1) * INTERVAL '1 day') AT TIME ZONE 'UTC')
      AND ($6::date IS NULL OR created_at >= $6::date::timestamp AT TIME ZONE 'UTC')
    ), page_rows AS (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT $3 OFFSET $4),
    registration_days AS (
      SELECT registered_day AS day, COUNT(*) AS registrations,
        COUNT(*) FILTER (WHERE onboarded) AS onboarded, COUNT(*) FILTER (WHERE NOT onboarded) AS incomplete
      FROM account_rows WHERE registered_day >= $7::date AND created_at <= NOW()
      GROUP BY registered_day
    ), recovered_days AS (
      SELECT day,SUM(event_count) AS recovered FROM registration_history_daily_counts
      WHERE day >= $7::date AND day <= (NOW() AT TIME ZONE 'UTC')::date GROUP BY day
    ), known_days AS (
      SELECT COALESCE(current.day,recovered.day) AS day, COALESCE(current.registrations,0) AS current_registrations,
        COALESCE(recovered.recovered,0) AS recovered_registrations, COALESCE(current.onboarded,0) AS onboarded,
        COALESCE(current.incomplete,0) AS incomplete
      FROM registration_days current FULL OUTER JOIN recovered_days recovered ON current.day=recovered.day
    )
    SELECT (SELECT COUNT(*) FROM account_rows) AS total,
      (SELECT COUNT(*) FROM account_rows WHERE onboarded) AS onboarded,
      (SELECT COUNT(*) FROM account_rows WHERE hidden) AS hidden,
      (SELECT COUNT(*) FROM account_rows WHERE created_at >= date_trunc('day',NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today,
      (SELECT COUNT(*) FROM account_rows WHERE created_at >= (date_trunc('day',NOW() AT TIME ZONE 'UTC') - INTERVAL '6 days') AT TIME ZONE 'UTC') AS last7,
      (SELECT COUNT(*) FROM account_rows WHERE created_at >= (date_trunc('day',NOW() AT TIME ZONE 'UTC') - INTERVAL '29 days') AT TIME ZONE 'UTC') AS last30,
      (SELECT COUNT(*) FROM account_rows WHERE created_at >= (date_trunc('day',NOW() AT TIME ZONE 'UTC') - INTERVAL '119 days') AT TIME ZONE 'UTC') AS last120,
      (SELECT COUNT(*) FROM account_rows WHERE NOT onboarded AND created_at >= (date_trunc('day',NOW() AT TIME ZONE 'UTC') - INTERVAL '119 days') AT TIME ZONE 'UTC') AS incomplete120,
      (SELECT COALESCE(SUM(registrations),0) FROM registration_days) AS since_may,
      (SELECT COALESCE(SUM(incomplete),0) FROM registration_days) AS incomplete_since_may,
      (SELECT COALESCE(SUM(recovered),0) FROM recovered_days) AS recovered_registrations,
      (SELECT COUNT(*) FROM registration_history_date_corrections) AS earlier_registration_dates,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('day',day,'registrations',current_registrations+recovered_registrations,'currentRegistrations',current_registrations,'recoveredRegistrations',recovered_registrations,'onboarded',onboarded,'incomplete',incomplete) ORDER BY day) FROM known_days),'[]'::jsonb) AS registration_daily,
      (SELECT COUNT(*) FROM filtered) AS filtered_total,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'email',email,'createdAt',created_at,'registeredDay',registered_day,'onboarded',onboarded,'hidden',hidden) ORDER BY created_at DESC,id) FROM page_rows),'[]'::jsonb) AS recent`,
    [search.trim(), state, pageSize, (page - 1) * pageSize, days, registrationFrom, REGISTRATION_HISTORY_START]);
    let signupRequests = { available: false, outcomes: [], daily: [] };
    try {
      await prune();
      const { rows: counts } = await db.query(`SELECT day::text,outcome,event_count FROM signup_daily_counts
        WHERE day >= $1::date AND day <= (NOW() AT TIME ZONE 'UTC')::date ORDER BY day,outcome`, [REGISTRATION_HISTORY_START]);
      const totals = new Map(OUTCOMES.map(outcome => [outcome, 0]));
      for (const entry of counts) totals.set(entry.outcome, (totals.get(entry.outcome) || 0) + count(entry.event_count));
      signupRequests = { available: true, since: counts[0]?.day || null, retentionFrom: REGISTRATION_HISTORY_START,
        range: { from: REGISTRATION_HISTORY_START, to: new Date().toISOString().slice(0, 10) },
        outcomes: [...totals].map(([outcome, requests]) => ({ outcome, requests })),
        daily: counts.map(entry => ({ day: entry.day, outcome: entry.outcome, requests: count(entry.event_count) })) };
    } catch { /* The authoritative user list remains usable if diagnostics fail. */ }
    return { available: true, generatedAt: new Date().toISOString(), countSource: 'database', cacheUsed: false,
      total: count(row.total), onboarded: count(row.onboarded), incomplete: count(row.total) - count(row.onboarded),
      hidden: count(row.hidden), discoverable: count(row.total) - count(row.hidden),
      today: count(row.today), last7: count(row.last7), last30: count(row.last30), last120: count(row.last120), incomplete120: count(row.incomplete120), registrationWindowDays: days,
      sinceMay: count(row.since_may), incompleteSinceMay: count(row.incomplete_since_may), registrationFrom,
      recoveredRegistrations: count(row.recovered_registrations), knownRegistrationsSinceMay: count(row.since_may) + count(row.recovered_registrations),
      registrationHistory: { from: REGISTRATION_HISTORY_START, to: new Date().toISOString().slice(0, 10), daily: row.registration_daily,
        source: 'current-accounts-and-recovered-registration-counts', earlierRegistrationDates: count(row.earlier_registration_dates),
        definition: 'Earliest recorded registration dates for current accounts plus recovered registrations absent from current accounts. Recovery does not recreate accounts.' },
      recent: row.recent, pagination: { page, pageSize, total: count(row.filtered_total), pages: Math.max(1, Math.ceil(count(row.filtered_total) / pageSize)) },
      activeAvailable: false, signInsAvailable: false, signupRequests, email: { available: Boolean(mailAvailable()) } };
  }
  async function inspectCache() {
    available();
    const cached = new Set(getCachedUserIds());
    const { rows } = await db.query('SELECT id FROM users');
    const registered = new Set(rows.map(row => String(row.id)));
    const matched = [...cached].filter(id => registered.has(id)).length;
    return { checkedAt: new Date().toISOString(), countSource: 'database', cacheScope: 'this-api-worker', invalidationRefreshSeconds: 5, database: registered.size,
      cached: cached.size, matched, notCached: registered.size - matched, cacheOnly: cached.size - matched,
      note: 'An uncached account still exists in the database and loads when needed. Cache-only entries are not registered accounts.' };
  }
  async function clearCache(body) {
    if (!body || body.confirmed !== true || Object.keys(body).some(key => key !== 'confirmed')) throw failure(400, 'Confirm clearing the user cache.');
    await inspectCache(); // Never clear during a failed authoritative read.
    const { rows: [epoch] } = await db.query('UPDATE office_user_cache_epoch SET version=version+1 WHERE id=1 RETURNING version');
    if (!epoch) throw failure(503, 'User cache coordination is temporarily unavailable.');
    const cleared = clearUserCache();
    cacheVersion = Number(epoch.version);
    return { ok: true, cleared, ...(await inspectCache()) };
  }
  async function email(userId, body) {
    available();
    if (!UUID.test(userId) || !body || Object.keys(body).some(key => !['subject','message','requestId'].includes(key))
      || typeof body.subject !== 'string' || !body.subject.trim() || body.subject.length > 160 || /[\r\n\x00-\x1f]/.test(body.subject)
      || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 10000 || body.message.includes('\0')
      || !UUID.test(body.requestId || '')) throw failure(400, 'Use a subject of up to 160 characters and a message of up to 10,000 characters.');
    if (!mailAvailable()) throw failure(503, 'Email delivery is not configured.');
    const { rows: [user] } = await db.query('SELECT email FROM users WHERE id=$1', [userId]);
    if (!user) throw failure(404, 'Account not found.');
    if (!user.email || /@identity\.uficonnect\.invalid$/i.test(user.email)) throw failure(422, 'This account has not added an email address.');
    const subject = body.subject.trim(), message = body.message.trim();
    const hash = createHash('sha256').update(JSON.stringify([userId, subject, message])).digest('hex');
    const { rows: claimed } = await db.query(`INSERT INTO office_member_email(id,user_id,subject,payload_hash,status)
      VALUES($1,$2,$3,$4,'sending') ON CONFLICT(id) DO NOTHING RETURNING id`, [body.requestId, userId, subject, hash]);
    if (!claimed.length) {
      const { rows: [existing] } = await db.query(`SELECT payload_hash,${deliveryStatusSql} AS status FROM office_member_email WHERE id=$1`, [body.requestId]);
      if (existing?.payload_hash !== hash) throw failure(409, 'This request reference belongs to a different message.');
      return { ok: existing.status === 'accepted', status: existing.status, requestId: body.requestId,
        message: existing.status === 'accepted' ? 'Accepted by the email provider.' : 'This submission is already recorded. Check its status before sending another message.' };
    }
    let status = 'uncertain';
    try {
      const result = await sendMail({ to: user.email, subject, text: message });
      const accepted = Array.isArray(result?.accepted) && result.accepted.some(recipient => addressOf(recipient) === addressOf(user.email));
      const rejected = Array.isArray(result?.rejected) && result.rejected.some(recipient => addressOf(recipient) === addressOf(user.email));
      status = accepted ? 'accepted' : rejected ? 'failed' : 'uncertain';
    } catch (error) {
      // Only explicit SMTP rejection proves no delivery. A network error can
      // occur after acceptance, so retries cannot resend this request ID.
      status = explicitMailRejection(error) ? 'failed' : 'uncertain';
    }
    await db.query('UPDATE office_member_email SET status=$2,updated_at=NOW() WHERE id=$1', [body.requestId, status]);
    return { ok: status === 'accepted', status, requestId: body.requestId,
      message: status === 'accepted' ? 'Accepted by the email provider. Inbox delivery depends on the recipient’s mail service.'
        : status === 'failed' ? 'The email provider rejected this message.' : 'Delivery could not be confirmed. Check the provider before sending again.' };
  }
  async function emailHistory(userId) {
    available();
    if (!UUID.test(userId)) throw failure(400, 'Invalid account.');
    const { rows } = await db.query(`SELECT id,subject,${deliveryStatusSql} AS status,created_at AS "createdAt",updated_at AS "updatedAt"
      FROM office_member_email WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20`, [userId]);
    return { messages: rows };
  }
  return { list, inspectCache, clearCache, email, emailHistory, signupMiddleware, recordSignup, refreshCacheEpoch };
}

function registerOfficeMemberRoutes(app, { requireOfficeToken, ...options }) {
  const service = createOfficeMembers(options);
  const privateResponse = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
  const route = action => async (req, res) => {
    try { res.json(await action(req)); }
    catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Account tools are temporarily unavailable.' }); }
  };
  const emailLimit = rateLimit({ windowMs: 60000, limit: 10, standardHeaders: true, legacyHeaders: false,
    message: { message: 'Wait a minute before sending more messages.' } });
  app.get('/office/users', privateResponse, requireOfficeToken, route(req => service.list(req.query)));
  app.get('/office/users/cache', privateResponse, requireOfficeToken, route(() => service.inspectCache()));
  app.post('/office/users/cache/clear', privateResponse, requireOfficeToken, route(req => service.clearCache(req.body)));
  app.post('/office/users/:id/email', privateResponse, requireOfficeToken, emailLimit, route(req => service.email(req.params.id, req.body)));
  app.get('/office/users/:id/email', privateResponse, requireOfficeToken, route(req => service.emailHistory(req.params.id)));
  return service;
}
module.exports = { OFFICE_MEMBERS_SCHEMA, createOfficeMembers, registerOfficeMemberRoutes };
