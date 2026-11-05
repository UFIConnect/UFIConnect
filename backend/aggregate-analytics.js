'use strict';

const { analyticsGeography, createGeographyReportHandler } = require('./analytics-geography');
const { ISO_COUNTRY_CODES } = require('./feed-location');
const { createAnalyticsVerification } = require('./analytics-verification');
const { ROLLING_ANALYTICS_SCHEMA, createRollingAnalytics } = require('./rolling-analytics');

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
);
CREATE TABLE IF NOT EXISTS analytics_history_daily_counts (
  source TEXT NOT NULL CHECK (source IN ('legacy_page_views_primary', 'legacy_page_views_backup')),
  day DATE NOT NULL CHECK (day >= DATE '2026-05-01'),
  category TEXT NOT NULL CONSTRAINT analytics_history_daily_counts_category_check ${categoryConstraint},
  event_count BIGINT NOT NULL CHECK (event_count > 0),
  restored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, day, category)
);
CREATE TABLE IF NOT EXISTS analytics_geography_daily_counts (
  day DATE NOT NULL,
  category TEXT NOT NULL CONSTRAINT analytics_geography_daily_counts_category_check ${categoryConstraint},
  country TEXT NOT NULL CHECK (country IN (${sqlList(ISO_COUNTRY_CODES)})),
  city TEXT NOT NULL DEFAULT '' CHECK (length(city) <= 80),
  region TEXT NOT NULL DEFAULT '' CHECK (length(region) <= 80),
  event_count BIGINT NOT NULL CHECK (event_count > 0),
  PRIMARY KEY (day, category, country, city, region)
);${ROLLING_ANALYTICS_SCHEMA}`;
// CREATE TABLE IF NOT EXISTS cannot expand an existing CHECK. Replace the old
// constraint in one atomic ALTER so every previous category/count survives and
// there is no window that permits arbitrary paths or identifiers.
const ANALYTICS_MIGRATIONS = Object.freeze([`ALTER TABLE analytics_daily_counts
  DROP CONSTRAINT IF EXISTS analytics_daily_counts_category_check,
  ADD CONSTRAINT analytics_daily_counts_category_check ${categoryConstraint}`,
`ALTER TABLE analytics_history_daily_counts
  DROP CONSTRAINT IF EXISTS analytics_history_daily_counts_category_check,
  ADD CONSTRAINT analytics_history_daily_counts_category_check ${categoryConstraint}`,
`ALTER TABLE analytics_geography_daily_counts
  DROP CONSTRAINT IF EXISTS analytics_geography_daily_counts_category_check,
  ADD CONSTRAINT analytics_geography_daily_counts_category_check ${categoryConstraint}`]);
const cappedAdd = (value, addition) => Math.min(Number.MAX_SAFE_INTEGER, value + addition);
const ANALYTICS_HISTORY_START = '2026-05-01';

// Both the Office formatter's input and its independently grouped comparison
// come from one statement snapshot. Concurrent collection cannot cause a false
// mismatch. Raw legacy page_views are already represented by the history table
// and must not be added a second time.
const viewSum = condition => `LEAST(9007199254740991,COALESCE(SUM(event_count) FILTER(WHERE kind='page_view' AND code=''${condition ? ' AND ' + condition : ''}),0))`;
const errorSum = condition => `LEAST(9007199254740991,COALESCE(SUM(event_count) FILTER(WHERE kind='client_error'${condition ? ' AND ' + condition : ''}),0))`;
const windowSums = `${viewSum('day=$2::date')} AS today,${viewSum("day >= $2::date - 6")} AS "last7",${viewSum("day >= $2::date - 29")} AS "last30"`;
const ANALYTICS_VERIFICATION_QUERY = `WITH counts AS MATERIALIZED (
  SELECT day,category,kind,code,event_count,'anonymous-daily-counts'::text AS source
  FROM analytics_daily_counts WHERE day >= $1::date AND day <= $2::date
  UNION ALL
  SELECT day,category,'page_view'::text AS kind,''::text AS code,event_count,source
  FROM analytics_history_daily_counts WHERE day >= $1::date AND day <= $2::date
), catalog AS (
  SELECT * FROM jsonb_to_recordset($3::jsonb) AS page(category TEXT,platform TEXT,"viewType" TEXT)
), classified AS (
  SELECT counts.*,catalog.platform,catalog."viewType",catalog.category IS NULL AS unknown_category
  FROM counts LEFT JOIN catalog USING(category)
)
SELECT COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY day,source) FROM counts c),'[]'::jsonb) AS rows,
 jsonb_build_object(
  'rowCount',(SELECT COUNT(*) FROM counts),
  'anonymousRows',(SELECT COUNT(*) FROM counts WHERE source='anonymous-daily-counts'),
  'historyRows',(SELECT COUNT(*) FROM counts WHERE source<>'anonymous-daily-counts'),
  'invalidRows',(SELECT COUNT(*) FROM classified WHERE unknown_category OR event_count<=0 OR event_count>9007199254740991
    OR kind NOT IN ('page_view','client_error') OR (kind='page_view' AND code<>'')
    OR (kind='client_error' AND code NOT IN (${sqlList(CLIENT_ERROR_CODES)}))),
  'totals',(SELECT to_jsonb(t) FROM (SELECT ${viewSum()} AS views,${errorSum()} AS errors,${windowSums},
    ${errorSum('day=$2::date')} AS "errorsToday",${errorSum('day >= $2::date - 6')} AS "errorsLast7",
    ${errorSum('day >= $2::date - 29')} AS "errorsLast30",${viewSum("source<>'anonymous-daily-counts'")} AS "restoredViews" FROM counts) t),
  'categoryDays',COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT day::text,category,${viewSum()} AS views,${errorSum()} AS errors FROM counts GROUP BY day,category) c),'[]'::jsonb),
  'sources',COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT source,${viewSum()} AS views FROM counts GROUP BY source) s),'[]'::jsonb),
  'platforms',COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM (SELECT platform AS key,${windowSums} FROM classified GROUP BY platform) p),'[]'::jsonb),
  'viewTypes',COALESCE((SELECT jsonb_agg(to_jsonb(v)) FROM (SELECT "viewType" AS key,${windowSums} FROM classified GROUP BY "viewType") v),'[]'::jsonb)
 ) AS expected`;

function createAggregateAnalytics({ db, now = Date.now, onPageview = () => {}, schedule = setInterval, env = process.env, verificationEnabled = true, rollingEnabled = true }) {
  const rolling = createRollingAnalytics({ db, now });
  let windowStart = now();
  let windowCount = 0;
  let prunedDay = '';
  const since = new Date(now()).toISOString();
  const serviceCounts = new Map();
  let serviceTotal = 0;
  let pending = new Map();
  let flushing = null;
  let reportRevision = 0, reportCache = null;
  const reportCacheMs = 15_000;
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
            // Daily, minute and geography counts commit together. A failure in
            // any projection cannot commit a subset and duplicate it on retry.
            await db.query(`WITH incoming AS (
              SELECT * FROM jsonb_to_recordset($1::jsonb)
              AS event(day DATE, minute TIMESTAMPTZ, platform TEXT, category TEXT, kind TEXT, code TEXT, event_count BIGINT, country TEXT, city TEXT, region TEXT)
            ), saved_coverage AS (
              INSERT INTO analytics_minute_coverage(id, available_from)
              SELECT 1, $2::timestamptz WHERE $3::boolean
              ON CONFLICT (id) DO NOTHING RETURNING id
            ), saved_minutes AS (
              INSERT INTO analytics_minute_counts(minute, platform, kind, event_count)
              SELECT minute, platform, kind, LEAST(9007199254740991, SUM(event_count))::bigint
              FROM incoming WHERE $3::boolean GROUP BY minute, platform, kind
              ON CONFLICT (minute, platform, kind) DO UPDATE
              SET event_count = LEAST(9007199254740991, analytics_minute_counts.event_count + EXCLUDED.event_count)
              RETURNING minute
            ), saved_geography AS (
              INSERT INTO analytics_geography_daily_counts (day, category, country, city, region, event_count)
              SELECT day, category, country, city, region, LEAST(9007199254740991, SUM(event_count))::bigint
              FROM incoming WHERE kind='page_view' AND country <> '' GROUP BY day, category, country, city, region
              ON CONFLICT (day, category, country, city, region) DO UPDATE
              SET event_count = LEAST(9007199254740991, analytics_geography_daily_counts.event_count + EXCLUDED.event_count)
              RETURNING day
            )
              INSERT INTO analytics_daily_counts (day, category, kind, code, event_count)
              SELECT day, category, kind, code, LEAST(9007199254740991, SUM(event_count))::bigint
              FROM incoming GROUP BY day, category, kind, code
              ON CONFLICT (day, category, kind, code) DO UPDATE
              SET event_count = LEAST(9007199254740991, analytics_daily_counts.event_count + EXCLUDED.event_count)`,
            [JSON.stringify([...batch.values()]), rolling.startedAt, rollingEnabled]);
            lastPersistedAt = new Date(now()).toISOString();
            reportRevision++; reportCache = null;
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
            // Anonymous daily totals are the history, rather than a rolling
            // cache. Keep every recorded day from the requested May launch.
            await db.query('DELETE FROM analytics_daily_counts WHERE day < $1::date', [ANALYTICS_HISTORY_START]);
            await db.query('DELETE FROM analytics_geography_daily_counts WHERE day < $1::date', [ANALYTICS_HISTORY_START]);
            if (rollingEnabled) {
              await rolling.initialize();
              await rolling.prune();
            }
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
      // The body contains only constants. Coarse location comes separately
      // from verified network headers; no identity, raw headers, IPs, paths,
      // searches, error text, content, credentials or route parameters enter rows.
      if ((req.originalUrl || req.url || '').includes('?') || !validBody(req.body, kind)) {
        collector.invalid++; return res.status(400).json({ error: 'Invalid aggregate event.' });
      }
      if (!db.isConnected()) {
        collector.storageUnavailable++; return res.status(503).json({ error: 'Metrics storage unavailable.' });
      }
      const eventAt = now();
      if (eventAt - windowStart >= 60_000) { windowStart = eventAt; windowCount = 0; }
      const day = new Date(eventAt).toISOString().slice(0, 10);
      const minute = new Date(Math.floor(eventAt / 60_000) * 60_000).toISOString();
      const platform = CATEGORY_CATALOG[req.body.category].platform;
      const code = kind === 'client_error' ? req.body.code : '';
      const location = kind === 'page_view' ? analyticsGeography(req, env) : { country: '', city: '', region: '' };
      const key = JSON.stringify([rollingEnabled ? minute : day, req.body.category, kind, code, location.country, location.city, location.region]);
      if (windowCount >= 6000 || (!pending.has(key) && pending.size >= maximumPendingKeys)) {
        collector.rateLimited++; return res.status(429).json({ error: 'Metrics rate limit reached.' });
      }
      windowCount++;
      pending.set(key, { day, minute, platform, category: req.body.category, kind, code,
        ...location, event_count: cappedAdd(pending.get(key)?.event_count || 0, 1) });
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
  async function readReport() {
      if (!db.isConnected()) throw new Error('Metrics storage unavailable.');
      const timestamp = now();
      const today = new Date(timestamp).toISOString().slice(0, 10);
      const dayAt = offset => new Date(timestamp - offset * 86400_000).toISOString().slice(0, 10);
      const from = today >= ANALYTICS_HISTORY_START ? ANALYTICS_HISTORY_START : dayAt(29);
      if (reportCache && reportCache.day === today && reportCache.revision === reportRevision
        && timestamp - reportCache.at < reportCacheMs) return reportCache.value;
      const revision = reportRevision;
      const { rows: [snapshot] } = await db.query(ANALYTICS_VERIFICATION_QUERY,
        [from, today, JSON.stringify(Object.values(CATEGORY_CATALOG))]);
      if (!snapshot || !Array.isArray(snapshot.rows) || !snapshot.expected) throw new Error('Metrics snapshot unavailable.');
      const rows = snapshot.rows;
      const emptyCounts = () => ({ today: 0, last7: 0, last30: 0 });
      const dayCount = Math.round((Date.parse(today) - Date.parse(from)) / 86400_000) + 1;
      const days = Array.from({ length: dayCount }, (_, index) => new Date(Date.parse(from) + index * 86400_000).toISOString().slice(0, 10));
      const daily = new Map(days.map(day => [day, { day, views: 0, errors: 0, web: 0, mobile: 0 }]));
      const categories = new Map(Object.values(CATEGORY_CATALOG).map(page => [page.category,
        { ...page, ...emptyCounts(), errors: emptyCounts(), firstRecordedDay: null, lastRecordedDay: null,
          daily: [] }]));
      // A retained day with no bucket has zero recorded events. Allocate only
      // populated category/day buckets; the public full shape is expanded below.
      const categoryDays = new Map();
      const errorCodes = new Map(CLIENT_ERROR_CODES.map(code => [code, { code, count: 0, ...emptyCounts() }]));
      const result = { available: true, mode: 'aggregate', window: 'utc-calendar-days', retentionDays: dayCount,
        range: { from, to: today }, generatedAt: new Date(timestamp).toISOString(),
        history: { requestedFrom: ANALYTICS_HISTORY_START, firstRecordedDay: null, lastRecordedDay: null,
          source: 'anonymous-daily-counts', sources: [], restoredViews: 0,
          recordedViews: 0, pageScreenViews: 0, tabOpens: 0,
          missingHistory: 'Only retained events can be reported; unrecorded or previously expired events are unavailable.' },
        definition: 'A view is a page or screen navigation or a tab selection. Repeat views count; these totals do not measure unique people.',
        uniqueVisitors: { available: false, reason: 'Anonymous open counts do not identify or deduplicate people.' },
        today: 0, last7: 0, last30: 0, topPaths: [], daily: [], categories: [],
        platforms: { web: emptyCounts(), mobile: emptyCounts() },
        viewTypes: { page: emptyCounts(), screen: emptyCounts(), tab: emptyCounts() },
        performance: { ...emptyCounts(), byCode: [], byCategory: [], details: [] },
        excludedCategories: EXCLUDED_CATEGORIES, storage: storageSnapshot(), service: serviceSnapshot() };
      const increment = (target, day, count) => {
        if (day >= dayAt(29)) target.last30 = cappedAdd(target.last30, count);
        if (day >= dayAt(6)) target.last7 = cappedAdd(target.last7, count);
        if (day === today) target.today = cappedAdd(target.today, count);
      };
      const sources = new Map();
      for (const row of rows) {
        const category = categories.get(row.category);
        const count = Number(row.event_count);
        if (!category || !daily.has(row.day) || !Number.isSafeInteger(count) || count <= 0) continue;
        const dayKey = JSON.stringify([row.category, row.day]);
        let categoryDay = categoryDays.get(dayKey);
        if (!categoryDay) {
          categoryDay = { day: row.day, views: 0, errors: 0 };
          categoryDays.set(dayKey, categoryDay); category.daily.push(categoryDay);
        }
        if (row.kind === 'page_view' && row.code === '') {
          increment(result, row.day, count);
          increment(category, row.day, count);
          increment(result.platforms[category.platform], row.day, count);
          increment(result.viewTypes[category.viewType], row.day, count);
          daily.get(row.day).views = cappedAdd(daily.get(row.day).views, count);
          daily.get(row.day)[category.platform] = cappedAdd(daily.get(row.day)[category.platform], count);
          categoryDay.views = cappedAdd(categoryDay.views, count);
          result.history.recordedViews = cappedAdd(result.history.recordedViews, count);
          const historyField = category.viewType === 'tab' ? 'tabOpens' : 'pageScreenViews';
          result.history[historyField] = cappedAdd(result.history[historyField], count);
        } else if (row.kind === 'client_error' && codeSet.has(row.code)) {
          result.performance.details.push({ day: row.day, category: row.category, code: row.code, count });
          increment(result.performance, row.day, count);
          increment(category.errors, row.day, count);
          const errorCode = errorCodes.get(row.code);
          increment(errorCode, row.day, count); errorCode.count = cappedAdd(errorCode.count, count);
          daily.get(row.day).errors = cappedAdd(daily.get(row.day).errors, count);
          categoryDay.errors = cappedAdd(categoryDay.errors, count);
        } else continue;
        category.firstRecordedDay ||= row.day;
        category.lastRecordedDay = row.day;
        result.history.firstRecordedDay ||= row.day;
        result.history.lastRecordedDay = row.day;
        const source = row.source || 'anonymous-daily-counts';
        if (!sources.has(source)) sources.set(source, { source, firstRecordedDay: row.day, lastRecordedDay: row.day, views: 0 });
        const sourceCoverage = sources.get(source);
        sourceCoverage.lastRecordedDay = row.day;
        if (row.kind === 'page_view') {
          sourceCoverage.views = cappedAdd(sourceCoverage.views, count);
          if (source !== 'anonymous-daily-counts') result.history.restoredViews = cappedAdd(result.history.restoredViews, count);
        }
      }
      result.history.sources = [...sources.values()];
      result.categories = [...categories.values()];
      result.topPaths = result.categories.filter(row => row.last30).map(row => ({ category: row.category, path: row.label, views: row.last30 }))
        .sort((a, b) => b.views - a.views).slice(0, 15);
      result.daily = [...daily.values()];
      result.performance.byCode = [...errorCodes.values()];
      result.performance.byCategory = result.categories.filter(row => row.errors.last30)
        .map(row => ({ category: row.category, label: row.label, platform: row.platform, ...row.errors }));
      const value = { report: result, expected: snapshot.expected };
      if (revision === reportRevision) reportCache = { day: today, revision, at: timestamp, value };
      return value;
  }
  const verification = createAnalyticsVerification({ readReport, now, schedule, enabled: verificationEnabled });
  async function snapshot({ detail = 'compact' } = {}) {
    if (!['full', 'compact', 'summary'].includes(detail)) throw new TypeError('Invalid analytics detail level.');
    const unavailable = () => ({ available: false, mode: 'aggregate', error: 'Metrics storage unavailable.',
      storage: storageSnapshot(), excludedCategories: EXCLUDED_CATEGORIES, service: serviceSnapshot(), verification: verification.snapshot() });
    if (!db.isConnected()) { verification.unavailable(); return unavailable(); }
    try {
      if (!await flush()) { verification.unavailable(); return unavailable(); }
      const canonical = await verification.read();
      const result = { ...canonical, detail, categoryDailyEncoding: detail === 'full' ? 'dense' : detail === 'compact' ? 'sparse' : 'omitted',
        storage: storageSnapshot(), service: serviceSnapshot(),
        snapshot: { checkedAt: canonical.generatedAt, maximumAgeMs: reportCacheMs } };
      if (detail === 'full') result.categories = canonical.categories.map(category => {
        const populated = new Map(category.daily.map(day => [day.day, day]));
        return { ...category, daily: canonical.daily.map(({ day }) => populated.get(day) || { day, views: 0, errors: 0 }) };
      });
      if (detail === 'summary') {
        delete result.categories;
        const { details, byCategory, ...performance } = canonical.performance;
        result.performance = performance;
      }
      return result;
    } catch { return unavailable(); }
  }
  async function report(req, res) {
    res.set('Cache-Control', 'private, no-store');
    const detail = req.query?.detail || 'full';
    if (!['full', 'compact', 'summary'].includes(detail)) return res.status(400).json({ available: false, error: 'Choose a valid analytics detail level.' });
    const result = await snapshot({ detail });
    return res.status(result.available ? 200 : 503).json(result);
  }
  const welcomeSnapshot = async input => {
    if (!rollingEnabled) return { ...rolling.unavailable(input?.asOf),
      reason: 'Minute analytics collection belongs to the API service.', storage: storageSnapshot() };
    const result = !await flush() ? rolling.unavailable(input?.asOf) : await rolling.snapshot(input);
    return { ...result, storage: storageSnapshot() };
  };
  return { pageview: handler('page_view'), performance: handler('client_error'), serviceMiddleware, report, snapshot, flush, verification, welcomeSnapshot,
    geography: createGeographyReportHandler({ db, catalog: CATEGORY_CATALOG, now, env }) };
}

module.exports = { PAGE_CATEGORIES, CATEGORY_CATALOG, EXCLUDED_CATEGORIES, CLIENT_ERROR_CODES, ANALYTICS_SCHEMA, ANALYTICS_MIGRATIONS, ANALYTICS_HISTORY_START, ANALYTICS_VERIFICATION_QUERY, createAggregateAnalytics };
