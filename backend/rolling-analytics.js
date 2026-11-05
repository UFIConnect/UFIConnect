'use strict';

// Anonymous minute totals support rolling and local calendar windows without
// retaining identities, routes, error text or individual activity records.
const MINUTE_MS = 60_000, RETENTION_MS = 10 * 86400_000;
const ROLLING_ANALYTICS_SCHEMA = `
CREATE TABLE IF NOT EXISTS analytics_minute_counts (
  minute TIMESTAMPTZ NOT NULL CHECK(minute = date_trunc('minute', minute)),
  platform TEXT NOT NULL CHECK(platform IN ('web','mobile')),
  kind TEXT NOT NULL CHECK(kind IN ('page_view','client_error')),
  event_count BIGINT NOT NULL CHECK(event_count > 0),
  PRIMARY KEY(minute,platform,kind)
);
CREATE TABLE IF NOT EXISTS analytics_minute_coverage (
  id INTEGER PRIMARY KEY CHECK(id=1),
  available_from TIMESTAMPTZ NOT NULL
)`;
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
const counter = value => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid metric count');
  return result;
};

function createRollingAnalytics({ db, now = Date.now }) {
  // The first partial minute is deliberately outside verified coverage. The
  // persisted marker survives workers/restarts and is never moved backwards.
  const startedAt = new Date(Math.ceil(now() / MINUTE_MS) * MINUTE_MS).toISOString();
  const unavailable = asOf => ({ available: false, asOf: typeof asOf === 'string' ? asOf : null,
    reason: 'Minute analytics storage could not be verified.', windows: {} });
  const initialize = () => db.query('INSERT INTO analytics_minute_coverage(id,available_from) VALUES(1,$1::timestamptz) ON CONFLICT(id) DO NOTHING', [startedAt]);
  const prune = () => db.query('DELETE FROM analytics_minute_counts WHERE minute < $1::timestamptz',
    [new Date(Math.floor((now() - RETENTION_MS) / MINUTE_MS) * MINUTE_MS).toISOString()]);
  async function snapshot({ windows, asOf } = {}) {
    try {
      if (!db?.isConnected?.()) return unavailable(asOf);
      const end = timestamp(asOf);
      if (!Number.isFinite(end) || end % MINUTE_MS || end > Math.floor(now() / MINUTE_MS) * MINUTE_MS) return unavailable(asOf);
      const requested = Object.entries(windows || {});
      if (!requested.length || requested.length > 3 || requested.some(([key, window]) => !['past24h','today','week'].includes(key)
        || !Number.isFinite(timestamp(window?.from)) || timestamp(window.from) % MINUTE_MS
        || timestamp(window.from) > end || window.to !== asOf)) return unavailable(asOf);
      await initialize();
      // One statement observes the shared coverage marker and all counts.
      const { rows } = await db.query(`WITH windows AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS requested_window(key TEXT, "from" TIMESTAMPTZ, "to" TIMESTAMPTZ)
      ), coverage AS (
        SELECT GREATEST(available_from,$2::timestamptz) AS available_from FROM analytics_minute_coverage WHERE id=1
      ) SELECT windows.key,coverage.available_from,
        LEAST(9007199254740991,COALESCE(SUM(event_count) FILTER(WHERE platform='web' AND kind='page_view'),0)) AS web_views,
        LEAST(9007199254740991,COALESCE(SUM(event_count) FILTER(WHERE platform='web' AND kind='client_error'),0)) AS web_errors,
        LEAST(9007199254740991,COALESCE(SUM(event_count) FILTER(WHERE platform='mobile' AND kind='page_view'),0)) AS mobile_views,
        LEAST(9007199254740991,COALESCE(SUM(event_count) FILTER(WHERE platform='mobile' AND kind='client_error'),0)) AS mobile_errors
      FROM windows CROSS JOIN coverage LEFT JOIN analytics_minute_counts
        ON minute >= GREATEST(windows."from",coverage.available_from) AND minute < windows."to"
      GROUP BY windows.key,coverage.available_from`, [JSON.stringify(requested.map(([key, window]) => ({ key, ...window }))),
        new Date(Math.ceil((now() - RETENTION_MS) / MINUTE_MS) * MINUTE_MS).toISOString()]);
      if (rows.length !== requested.length) return unavailable(asOf);
      const byKey = new Map(rows.map(row => [row.key, row]));
      const result = {};
      let availableFrom;
      for (const [key, window] of requested) {
        const row = byKey.get(key);
        if (!row || !Number.isFinite(new Date(row.available_from).getTime())) return unavailable(asOf);
        availableFrom = new Date(row.available_from).toISOString();
        const web = { views: counter(row.web_views), clientErrors: counter(row.web_errors) };
        const mobile = { views: counter(row.mobile_views), clientErrors: counter(row.mobile_errors) };
        result[key] = { ...window, complete: timestamp(window.from) >= timestamp(availableFrom), availableFrom,
          web, mobile, views: Math.min(Number.MAX_SAFE_INTEGER, web.views + mobile.views),
          clientErrors: Math.min(Number.MAX_SAFE_INTEGER, web.clientErrors + mobile.clientErrors) };
      }
      return { available: true, asOf, availableFrom,
        definition: 'Recorded page, screen and tab opens and client error reports; repeat opens count. Totals end at the latest completed minute and do not measure unique people.',
        coverageDefinition: 'Complete means the requested period falls inside retained minute instrumentation. It does not prove every visit or client error was reported; collection refusals and failures are reported separately.',
        windows: result };
    } catch { return unavailable(asOf); }
  }
  return { startedAt, snapshot, prune, initialize, unavailable };
}

module.exports = { ROLLING_ANALYTICS_SCHEMA, createRollingAnalytics };
