'use strict';

// Keep the API runtime copy inside backend's Render root. Its equality with the
// authoritative shared catalog is covered by the analytics contract test.
const CATEGORY_CATALOG = Object.freeze(Object.fromEntries(Object.entries(require('./analytics-categories.json'))
  .map(([category, page]) => [category, Object.freeze(page)])));
const PAGE_CATEGORIES = Object.freeze(Object.keys(CATEGORY_CATALOG));
const EXCLUDED_CATEGORIES = Object.freeze([
  { category: 'vault', label: 'Vault', platform: 'web', reason: 'Private Vault pages and activity are excluded.' },
  { category: 'vault_device', label: 'Vault devices', platform: 'web', reason: 'Private Vault device pages and activity are excluded.' },
  { category: 'app_vpn', label: 'VPN', platform: 'mobile', reason: 'VPN screens and connection activity are excluded.' },
  { category: 'auth_callback', label: 'Authorization callbacks', platform: 'web', reason: 'Credentials and authorization callback routes are excluded.' },
].map(Object.freeze));
const CLIENT_ERROR_CODES = Object.freeze(['script_error', 'unhandled_rejection', 'render_error', 'request_failed']);
const categorySet = new Set(PAGE_CATEGORIES);
const codeSet = new Set(CLIENT_ERROR_CODES);
const sqlList = values => values.map(value => `'${value}'`).join(',');
const categoryConstraint = `CHECK (category IN (${sqlList(PAGE_CATEGORIES)}))`;
const ANALYTICS_SCHEMA = `CREATE TABLE IF NOT EXISTS analytics_daily_counts (
  day DATE NOT NULL,
  category TEXT NOT NULL CONSTRAINT analytics_daily_counts_category_check ${categoryConstraint},
  kind TEXT NOT NULL CHECK (kind IN ('page_view', 'client_error')),
  code TEXT NOT NULL CHECK ((kind = 'page_view' AND code = '') OR
    (kind = 'client_error' AND code IN (${sqlList(CLIENT_ERROR_CODES)}))),
  event_count BIGINT NOT NULL CHECK (event_count > 0),
  PRIMARY KEY (day, category, kind, code)
)`;
// CREATE TABLE IF NOT EXISTS cannot expand an existing CHECK. Replace the old
// constraint in one atomic ALTER so every previous category/count survives and
// there is no window that permits arbitrary paths or identifiers.
const ANALYTICS_MIGRATIONS = Object.freeze([`ALTER TABLE analytics_daily_counts
  DROP CONSTRAINT IF EXISTS analytics_daily_counts_category_check,
  ADD CONSTRAINT analytics_daily_counts_category_check ${categoryConstraint}`]);
const cappedAdd = (value, addition) => Math.min(Number.MAX_SAFE_INTEGER, value + addition);

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
  const collector = { accepted: 0, invalid: 0, rateLimited: 0, storageUnavailable: 0, writeFailures: 0, dropped: 0 };
  let lastPersistedAt = null;
  let lastFailureAt = null;
  let lastRetentionAt = null;
  function storageSnapshot() {
    return { connected: db.isConnected(), status: !db.isConnected() ? 'unavailable' : collector.writeFailures && pending.size ? 'retrying' : 'ready',
      acknowledgement: 'after-durable-write', pendingKeys: pending.size,
      pendingEvents: [...pending.values()].reduce((sum, row) => cappedAdd(sum, row.event_count), 0),
      lastPersistedAt, lastFailureAt, lastRetentionAt, collector: { scope: 'current-process', since, ...collector } };
  }
  function flush() {
    if (flushing) return flushing;
    if (!db.isConnected()) return Promise.resolve(false);
    const cleanupDay = new Date(now()).toISOString().slice(0, 10);
    if (!pending.size && prunedDay === cleanupDay) return Promise.resolve(true);
    flushing = (async () => {
      // Requests wait for this drain before receiving 204. Events arriving while
      // a write is underway are included in the next batch before it resolves.
      // Acknowledged views therefore survive deploys and process restarts.
      while (true) {
        while (pending.size) {
          const batch = pending; pending = new Map();
          try {
            await db.query(`INSERT INTO analytics_daily_counts (day, category, kind, code, event_count)
              SELECT day, category, kind, code, event_count FROM jsonb_to_recordset($1::jsonb)
              AS incoming(day DATE, category TEXT, kind TEXT, code TEXT, event_count BIGINT)
              ON CONFLICT (day, category, kind, code) DO UPDATE
              SET event_count = LEAST(9007199254740991, analytics_daily_counts.event_count + EXCLUDED.event_count)`,
            [JSON.stringify([...batch.values()])]);
            lastPersistedAt = new Date(now()).toISOString();
          } catch {
            collector.writeFailures++;
            lastFailureAt = new Date(now()).toISOString();
            // Only bounded anonymous aggregates are retained for the scheduled
            // retry. The caller receives 503, never a false successful receipt.
            for (const [key, value] of batch) {
              if (!pending.has(key) && pending.size >= maximumPendingKeys) {
                collector.dropped = cappedAdd(collector.dropped, value.event_count); continue;
              }
              value.event_count = cappedAdd(value.event_count, pending.get(key)?.event_count || 0);
              pending.set(key, value);
            }
            return false;
          }
        }
        const day = new Date(now()).toISOString().slice(0, 10);
        if (prunedDay !== day) {
          try {
            await db.query("DELETE FROM analytics_daily_counts WHERE day < $1::date - INTERVAL '29 days'", [day]);
            prunedDay = day; lastRetentionAt = new Date(now()).toISOString();
          } catch { /* The durable increments committed; retry retention later. */ }
        }
        // A view may arrive while the retention query is awaiting storage.
        // Drain it too before releasing callers waiting on this promise.
        if (!pending.size) return true;
      }
    })().finally(() => { flushing = null; });
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
    return async (req, res) => {
      res.set('Cache-Control', 'no-store');
      // Query strings and extra fields are rejected before any persistence.
      // Only constants are stored; no identity, request headers, raw path,
      // searches, errors, content, credentials or route parameters enter rows.
      if ((req.originalUrl || req.url || '').includes('?') || !validBody(req.body, kind)) {
        collector.invalid++; return res.status(400).json({ error: 'Invalid aggregate event.' });
      }
      if (!db.isConnected()) {
        collector.storageUnavailable++; return res.status(503).json({ error: 'Metrics storage unavailable.' });
      }
      if (now() - windowStart >= 60_000) { windowStart = now(); windowCount = 0; }
      const day = new Date(now()).toISOString().slice(0, 10);
      const code = kind === 'client_error' ? req.body.code : '';
      const key = [day, req.body.category, kind, code].join(':');
      if (windowCount >= 6000 || (!pending.has(key) && pending.size >= maximumPendingKeys)) {
        collector.rateLimited++; return res.status(429).json({ error: 'Metrics rate limit reached.' });
      }
      windowCount++;
      pending.set(key, { day, category: req.body.category, kind, code,
        event_count: cappedAdd(pending.get(key)?.event_count || 0, 1) });
      // Synchronous bursts share one insert instead of one insert per event.
      await Promise.resolve();
      if (!await flush()) {
        collector.storageUnavailable++; return res.status(503).json({ error: 'Metrics storage unavailable.' });
      }
      collector.accepted++;
      if (kind === 'page_view') onPageview();
      return res.status(204).end();
    };
  }
  function serviceMiddleware(req, res, next) {
    const path = req.path || '';
    if (path.startsWith('/analytics') || path.startsWith('/office') || /^\/vpn(?:\/|$)/.test(path) || ['/health', '/health/details', '/readyz'].includes(path)) return next();
    const started = now();
    res.once('finish', () => {
      const elapsed = Math.max(0, Math.min(300_000, now() - started));
      const durationBucket = elapsed < 100 ? 'under_100ms' : elapsed < 500 ? '100_499ms'
        : elapsed < 2000 ? '500_1999ms' : elapsed < 10000 ? '2_10s' : 'over_10s';
      const statusClass = `${Math.max(1, Math.min(5, Math.floor(res.statusCode / 100)))}xx`;
      const key = `${statusClass}:${durationBucket}`;
      serviceCounts.set(key, cappedAdd(serviceCounts.get(key) || 0, 1));
      serviceTotal = cappedAdd(serviceTotal, 1);
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
    const unavailable = () => ({ available: false, mode: 'aggregate', error: 'Metrics storage unavailable.',
      storage: storageSnapshot(), excludedCategories: EXCLUDED_CATEGORIES, service: serviceSnapshot() });
    if (!db.isConnected()) return res.json(unavailable());
    try {
      if (!await flush()) return res.status(503).json(unavailable());
      const today = new Date(now()).toISOString().slice(0, 10);
      const dayAt = offset => new Date(now() - offset * 86400_000).toISOString().slice(0, 10);
      const { rows } = await db.query(`SELECT day::text, category, kind, code, event_count
        FROM analytics_daily_counts WHERE day >= $1 AND day <= $2 ORDER BY day ASC`, [dayAt(29), today]);
      const emptyCounts = () => ({ today: 0, last7: 0, last30: 0 });
      const days = Array.from({ length: 30 }, (_, index) => dayAt(29 - index));
      const daily = new Map(days.map(day => [day, { day, views: 0, errors: 0, web: 0, mobile: 0 }]));
      const categories = new Map(Object.values(CATEGORY_CATALOG).map(page => [page.category,
        { ...page, ...emptyCounts(), errors: emptyCounts(), firstRecordedDay: null, lastRecordedDay: null,
          daily: days.map(day => ({ day, views: 0, errors: 0 })) }]));
      const errorCodes = new Map(CLIENT_ERROR_CODES.map(code => [code, { code, count: 0, ...emptyCounts() }]));
      const result = { available: true, mode: 'aggregate', window: 'utc-calendar-days', retentionDays: 30,
        range: { from: dayAt(29), to: today }, generatedAt: new Date(now()).toISOString(),
        definition: 'A view is a page or screen navigation or a tab selection. Repeat views count; these totals do not measure unique people.',
        today: 0, last7: 0, last30: 0, topPaths: [], daily: [], categories: [],
        platforms: { web: emptyCounts(), mobile: emptyCounts() },
        viewTypes: { page: emptyCounts(), screen: emptyCounts(), tab: emptyCounts() },
        performance: { ...emptyCounts(), byCode: [], byCategory: [] },
        excludedCategories: EXCLUDED_CATEGORIES, storage: storageSnapshot(), service: serviceSnapshot() };
      const increment = (target, day, count) => {
        target.last30 = cappedAdd(target.last30, count);
        if (day >= dayAt(6)) target.last7 = cappedAdd(target.last7, count);
        if (day === today) target.today = cappedAdd(target.today, count);
      };
      for (const row of rows) {
        const category = categories.get(row.category);
        const count = Number(row.event_count);
        if (!category || !daily.has(row.day) || !Number.isSafeInteger(count) || count <= 0) continue;
        const categoryDay = category.daily[days.indexOf(row.day)];
        if (row.kind === 'page_view' && row.code === '') {
          increment(result, row.day, count);
          increment(category, row.day, count);
          increment(result.platforms[category.platform], row.day, count);
          increment(result.viewTypes[category.viewType], row.day, count);
          daily.get(row.day).views = cappedAdd(daily.get(row.day).views, count);
          daily.get(row.day)[category.platform] = cappedAdd(daily.get(row.day)[category.platform], count);
          categoryDay.views = cappedAdd(categoryDay.views, count);
        } else if (row.kind === 'client_error' && codeSet.has(row.code)) {
          increment(result.performance, row.day, count);
          increment(category.errors, row.day, count);
          const errorCode = errorCodes.get(row.code);
          increment(errorCode, row.day, count); errorCode.count = cappedAdd(errorCode.count, count);
          daily.get(row.day).errors = cappedAdd(daily.get(row.day).errors, count);
          categoryDay.errors = cappedAdd(categoryDay.errors, count);
        } else continue;
        category.firstRecordedDay ||= row.day;
        category.lastRecordedDay = row.day;
      }
      result.categories = [...categories.values()];
      result.topPaths = result.categories.filter(row => row.last30).map(row => ({ category: row.category, path: row.label, views: row.last30 }))
        .sort((a, b) => b.views - a.views).slice(0, 15);
      result.daily = [...daily.values()];
      result.performance.byCode = [...errorCodes.values()];
      result.performance.byCategory = result.categories.filter(row => row.errors.last30)
        .map(row => ({ category: row.category, label: row.label, platform: row.platform, ...row.errors }));
      return res.json(result);
    } catch { return res.status(503).json(unavailable()); }
  }
  return { pageview: handler('page_view'), performance: handler('client_error'), serviceMiddleware, report, flush };
}

module.exports = { PAGE_CATEGORIES, CATEGORY_CATALOG, EXCLUDED_CATEGORIES, CLIENT_ERROR_CODES, ANALYTICS_SCHEMA, ANALYTICS_MIGRATIONS, createAggregateAnalytics };
