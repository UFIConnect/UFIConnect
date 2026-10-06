'use strict';

const PAGE_CATEGORIES = Object.freeze([
  'home', 'login', 'register', 'forgot_password', 'reset_password', 'onboarding', 'global', 'videos',
  'you', 'music', 'groups', 'group', 'opportunities', 'opportunity', 'resume', 'cover_letter',
  'messages', 'conversation', 'notifications', 'profile', 'command_center', 'connected_accounts',
  'compose', 'post', 'search', 'member', 'settings', 'sources', 'privacy', 'terms', 'child_safety',
  'app_login', 'app_register', 'app_onboarding', 'app_opportunities', 'app_groups', 'app_group',
  'app_feed', 'app_messages', 'app_conversation', 'app_profile', 'app_connected_accounts',
  'app_security', 'app_privacy', 'other',
]);
const CLIENT_ERROR_CODES = Object.freeze(['script_error', 'unhandled_rejection', 'render_error', 'request_failed']);
const categorySet = new Set(PAGE_CATEGORIES);
const codeSet = new Set(CLIENT_ERROR_CODES);
const sqlList = values => values.map(value => `'${value}'`).join(',');
const ANALYTICS_SCHEMA = `CREATE TABLE IF NOT EXISTS analytics_daily_counts (
  day DATE NOT NULL,
  category TEXT NOT NULL CHECK (category IN (${sqlList(PAGE_CATEGORIES)})),
  kind TEXT NOT NULL CHECK (kind IN ('page_view', 'client_error')),
  code TEXT NOT NULL CHECK ((kind = 'page_view' AND code = '') OR
    (kind = 'client_error' AND code IN (${sqlList(CLIENT_ERROR_CODES)}))),
  event_count BIGINT NOT NULL CHECK (event_count > 0),
  PRIMARY KEY (day, category, kind, code)
)`;

function createAggregateAnalytics({ db, now = Date.now, onPageview = () => {}, schedule = setInterval }) {
  let windowStart = now();
  let windowCount = 0;
  let prunedDay = '';
  const since = new Date(now()).toISOString();
  const serviceCounts = new Map();
  let serviceTotal = 0;
  let pending = new Map();
  let flushing = null;
  const maximumPendingKeys = 1000;
  function flush() {
    if (flushing) return flushing;
    if (!db.isConnected()) return Promise.resolve(false);
    const cleanupDay = new Date(now()).toISOString().slice(0, 10);
    if (!pending.size && prunedDay === cleanupDay) return Promise.resolve(true);
    const batch = pending; pending = new Map();
    flushing = (async () => {
      try {
        if (batch.size) await db.query(`INSERT INTO analytics_daily_counts (day, category, kind, code, event_count)
          SELECT day, category, kind, code, event_count FROM jsonb_to_recordset($1::jsonb)
          AS incoming(day DATE, category TEXT, kind TEXT, code TEXT, event_count BIGINT)
          ON CONFLICT (day, category, kind, code) DO UPDATE
          SET event_count = analytics_daily_counts.event_count + EXCLUDED.event_count`,
        [JSON.stringify([...batch.values()])]);
        const day = new Date(now()).toISOString().slice(0, 10);
        if (prunedDay !== day) {
          try {
            await db.query("DELETE FROM analytics_daily_counts WHERE day < $1::date - INTERVAL '29 days'", [day]);
            prunedDay = day;
          } catch { /* Retry retention later; the aggregate increment already committed. */ }
        }
        return true;
      } catch {
        // Keep only bounded aggregates while storage is unavailable. A restart
        // can lose this short buffer; it never affects the application request.
        for (const [key, value] of batch) {
          if (!pending.has(key) && pending.size >= maximumPendingKeys) continue;
          value.event_count = Math.min(Number.MAX_SAFE_INTEGER, value.event_count + (pending.get(key)?.event_count || 0));
          pending.set(key, value);
        }
        return false;
      } finally { flushing = null; }
    })();
    return flushing;
  }
  const timer = schedule(() => { void flush(); }, 30_000); timer?.unref?.();
  function validBody(body, kind) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const keys = Object.keys(body).sort().join(',');
    if (kind === 'page_view' ? keys !== 'category' : keys !== 'category,code,kind') return false;
    return typeof body.category === 'string' && categorySet.has(body.category)
      && (kind === 'page_view' || (body.kind === 'client_error' && typeof body.code === 'string' && codeSet.has(body.code)));
  }
  function handler(kind) {
    return (req, res) => {
      res.set('Cache-Control', 'no-store');
      // Query strings and extra fields are rejected before any persistence.
      // No authentication middleware, headers, IP, cookies, or request URL
      // enter an aggregate. Network addresses only support separate abuse limits.
      if ((req.originalUrl || req.url || '').includes('?') || !validBody(req.body, kind)) {
        return res.status(400).json({ error: 'Invalid aggregate event.' });
      }
      if (!db.isConnected()) return res.status(503).json({ error: 'Metrics storage unavailable.' });
      if (now() - windowStart >= 60_000) { windowStart = now(); windowCount = 0; }
      const day = new Date(now()).toISOString().slice(0, 10);
      const code = kind === 'client_error' ? req.body.code : '';
      const key = [day, req.body.category, kind, code].join(':');
      if (windowCount >= 6000 || (!pending.has(key) && pending.size >= maximumPendingKeys)) {
        return res.status(429).json({ error: 'Metrics rate limit reached.' });
      }
      windowCount++;
      pending.set(key, { day, category: req.body.category, kind, code,
        event_count: Math.min(Number.MAX_SAFE_INTEGER, (pending.get(key)?.event_count || 0) + 1) });
      if (kind === 'page_view') onPageview();
      return res.status(204).end();
    };
  }
  function serviceMiddleware(req, res, next) {
    // Exclude collectors, their reports, and health probes. Otherwise viewing
    // metrics or health polling would manufacture the service activity shown.
    const path = req.path || '';
    if (path.startsWith('/analytics') || path.startsWith('/office') || /^\/vpn(?:\/|$)/.test(path) || ['/health', '/health/details', '/readyz'].includes(path)) return next();
    const started = now();
    res.once('finish', () => {
      const elapsed = Math.max(0, Math.min(300_000, now() - started));
      const durationBucket = elapsed < 100 ? 'under_100ms' : elapsed < 500 ? '100_499ms'
        : elapsed < 2000 ? '500_1999ms' : elapsed < 10000 ? '2_10s' : 'over_10s';
      const statusClass = `${Math.max(1, Math.min(5, Math.floor(res.statusCode / 100)))}xx`;
      const key = `${statusClass}:${durationBucket}`;
      serviceCounts.set(key, Math.min(Number.MAX_SAFE_INTEGER, (serviceCounts.get(key) || 0) + 1));
      serviceTotal = Math.min(Number.MAX_SAFE_INTEGER, serviceTotal + 1);
    });
    next();
  }
  function serviceSnapshot() {
    return { scope: 'current-process', since, total: serviceTotal,
      responses: [...serviceCounts].map(([key, count]) => {
        const [statusClass, durationBucket] = key.split(':'); return { statusClass, durationBucket, count };
      }) };
  }
  async function report(_req, res) {
    res.set('Cache-Control', 'no-store');
    if (!db.isConnected()) return res.json({ available: false, mode: 'aggregate', service: serviceSnapshot() });
    try {
      if (!await flush()) return res.status(503).json({ available: false, mode: 'aggregate', error: 'Metrics storage unavailable.', service: serviceSnapshot() });
      const today = new Date(now()).toISOString().slice(0, 10);
      const dayAt = offset => new Date(now() - offset * 86400_000).toISOString().slice(0, 10);
      const { rows } = await db.query(`SELECT day::text, category, kind, code, event_count
        FROM analytics_daily_counts WHERE day >= $1 AND day <= $2 ORDER BY day ASC`, [dayAt(29), today]);
      const daily = new Map(); const categories = new Map(); const errors = new Map();
      const result = { available: true, mode: 'aggregate', window: 'utc-calendar-days', retentionDays: 30,
        today: 0, last7: 0, last30: 0, topPaths: [], daily: [],
        performance: { last30: 0, byCode: [] }, service: serviceSnapshot() };
      for (const row of rows) {
        if (!categorySet.has(row.category)) continue;
        const count = Number(row.event_count);
        if (!Number.isFinite(count) || count <= 0) continue;
        if (row.kind === 'page_view') {
          result.last30 += count;
          if (row.day >= dayAt(6)) result.last7 += count;
          if (row.day === today) result.today += count;
          categories.set(row.category, (categories.get(row.category) || 0) + count);
          daily.set(row.day, (daily.get(row.day) || 0) + count);
        } else if (row.kind === 'client_error' && codeSet.has(row.code)) {
          result.performance.last30 += count;
          errors.set(row.code, (errors.get(row.code) || 0) + count);
        }
      }
      result.topPaths = [...categories].map(([category, views]) => ({ category, path: category.replace(/_/g, ' '), views }))
        .sort((a, b) => b.views - a.views).slice(0, 15);
      result.daily = [...daily].map(([day, views]) => ({ day, views }));
      result.performance.byCode = [...errors].map(([code, count]) => ({ code, count }));
      return res.json(result);
    } catch { return res.status(503).json({ available: false, mode: 'aggregate', error: 'Metrics storage unavailable.', service: serviceSnapshot() }); }
  }
  return { pageview: handler('page_view'), performance: handler('client_error'), serviceMiddleware, report, flush };
}

module.exports = { PAGE_CATEGORIES, CLIENT_ERROR_CODES, ANALYTICS_SCHEMA, createAggregateAnalytics };
