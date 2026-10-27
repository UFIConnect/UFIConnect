'use strict';

const cap = (a, b) => Math.min(Number.MAX_SAFE_INTEGER, a + b);
const numeric = value => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
  && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const total = values => values.reduce((sum, value) => cap(sum, numeric(value) || 0), 0);

// Independently produced SQL aggregates are compared with the report's public
// projections. Never expose a raw category, path, user, or database error here.
function verifyAnalyticsReport(report, expected) {
  const checks = [];
  function scalar(name, want, actual) {
    const left = numeric(want), right = numeric(actual);
    const mismatches = left === null || right === null || left !== right ? 1 : 0;
    checks.push({ name, status: mismatches ? 'mismatch' : 'pass', expected: left, actual: right, mismatches });
  }
  function buckets(name, wanted, actual) {
    function collect(entries) {
      const values = new Map(); let invalid = Array.isArray(entries) ? 0 : 1;
      for (const [key, value] of entries || []) {
        const amount = numeric(value);
        if (amount === null) { invalid++; continue; }
        if (amount) values.set(key, cap(values.get(key) || 0, amount));
      }
      return { values, invalid };
    }
    const left = collect(wanted), right = collect(actual);
    const keys = new Set([...left.values.keys(), ...right.values.keys()]);
    const mismatches = left.invalid + right.invalid + [...keys].filter(key => (left.values.get(key) || 0) !== (right.values.get(key) || 0)).length;
    checks.push({ name, status: mismatches ? 'mismatch' : 'pass',
      expected: total([...left.values.values()]), actual: total([...right.values.values()]), mismatches });
  }
  const sums = expected?.totals || {};
  scalar('valid-storage-rows', 0, expected?.invalidRows);
  for (const period of ['today', 'last7', 'last30']) {
    scalar(`views-${period}`, sums[period], report?.[period]);
    scalar(`errors-${period}`, sums['errors' + period[0].toUpperCase() + period.slice(1)], report?.performance?.[period]);
  }
  scalar('all-recorded-views', sums.views, Array.isArray(report?.daily) ? total(report.daily.map(row => row.views)) : null);
  scalar('all-recorded-errors', sums.errors, Array.isArray(report?.daily) ? total(report.daily.map(row => row.errors)) : null);
  scalar('restored-history-views', sums.restoredViews, report?.history?.restoredViews);
  const categoryDays = expected?.categoryDays;
  for (const field of ['views', 'errors']) {
    buckets(`category-day-${field}`, categoryDays?.map(row => [JSON.stringify([row.category, row.day]), row[field]]),
      report?.categories?.flatMap(category => category.daily?.map(day => [JSON.stringify([category.category, day.day]), day[field]]) || []));
    const days = new Map();
    for (const row of categoryDays || []) days.set(row.day, cap(days.get(row.day) || 0, numeric(row[field]) || 0));
    buckets(`daily-${field}`, [...days], report?.daily?.map(row => [row.day, row[field]]));
  }
  const end = Date.parse(report?.range?.to), windows = new Map();
  for (const row of categoryDays || []) {
    const age = (end - Date.parse(row.day)) / 86_400_000;
    for (const [period, days] of [['today', 0], ['last7', 6], ['last30', 29]]) {
      if (age < 0 || age > days || !Number.isFinite(age)) continue;
      for (const field of ['views', 'errors']) {
        const key = JSON.stringify([row.category, period, field]);
        windows.set(key, cap(windows.get(key) || 0, numeric(row[field]) || 0));
      }
    }
  }
  scalar('valid-report-date', 1, Number.isFinite(end) ? 1 : 0);
  buckets('category-window-counts', [...windows], report?.categories?.flatMap(category => ['today', 'last7', 'last30']
    .flatMap(period => [[JSON.stringify([category.category, period, 'views']), category[period]],
      [JSON.stringify([category.category, period, 'errors']), category.errors?.[period]]])));
  buckets('source-views', expected?.sources?.map(row => [row.source, row.views]), report?.history?.sources?.map(row => [row.source, row.views]));
  for (const [dimension, keys] of [['platforms', ['web', 'mobile']], ['viewTypes', ['page', 'screen', 'tab']]]) {
    buckets(dimension, expected?.[dimension]?.flatMap(row => ['today', 'last7', 'last30'].map(period => [row.key + ':' + period, row[period]])),
      keys.flatMap(key => ['today', 'last7', 'last30'].map(period => [key + ':' + period, report?.[dimension]?.[key]?.[period]])));
  }
  const type = key => numeric(expected?.viewTypes?.find(row => row.key === key)?.today) || 0;
  return { checks, mismatchCount: checks.reduce((sum, check) => sum + check.mismatches, 0), metrics: {
    bucketRows: numeric(expected?.rowCount), liveBucketRows: numeric(expected?.anonymousRows), historyBucketRows: numeric(expected?.historyRows),
    viewsToday: numeric(sums.today), allViews: numeric(sums.views),
    pageViewsToday: type('page'), screenViewsToday: type('screen'), tabViewsToday: type('tab'),
    restoredViews: numeric(sums.restoredViews), invalidRows: numeric(expected?.invalidRows),
  } };
}

function createAnalyticsVerification({ readReport, now = Date.now, schedule = setInterval, enabled = true,
  intervalMs = 60_000, timeoutMs = 10_000, staleAfterMs = 120_000 }) {
  let inFlight = null, state = { status: 'pending', checkedAt: null, lastVerifiedAt: null,
    totalRuns: 0, lastDurationMs: null, mismatchCount: 0, checks: [], metrics: null, error: null };
  function snapshot() {
    const stale = state.status === 'verified' && now() - Date.parse(state.checkedAt) > staleAfterMs;
    return { agent: 'analytics_verification', scope: 'canonical-aggregate-report', enabled,
      intervalSeconds: intervalMs / 1000, staleAfterSeconds: staleAfterMs / 1000,
      ...state, status: stale ? 'stale' : state.status, lastRun: state.checkedAt, running: Boolean(inFlight) };
  }
  function unavailable() {
    state = { ...state, status: 'error', checkedAt: new Date(now()).toISOString(), error: 'Metrics storage unavailable.' };
    return snapshot();
  }
  function check() {
    if (inFlight) return inFlight.result;
    const started = now(); let timeout;
    const task = { result: null };
    inFlight = task;
    state = { ...state, totalRuns: state.totalRuns + 1 };
    const work = Promise.resolve().then(readReport);
    const deadline = new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('deadline')), timeoutMs); });
    task.result = Promise.race([work, deadline]).then(({ report, expected }) => {
      const checked = verifyAnalyticsReport(report, expected), at = new Date(now()).toISOString();
      state = { ...state, ...checked, checkedAt: at, status: checked.mismatchCount ? 'mismatch' : 'verified',
        lastVerifiedAt: checked.mismatchCount ? state.lastVerifiedAt : at, lastDurationMs: Math.max(0, now() - started), error: null };
      return { report, verification: snapshot() };
    }).catch(() => {
      unavailable(); state.lastDurationMs = Math.max(0, now() - started);
      throw Object.assign(new Error('Metrics storage unavailable.'), { status: 503 });
    }).finally(() => clearTimeout(timeout));
    // A timed-out database read may still be settling. Keep the single-flight
    // slot until it finishes, rather than creating unbounded overlapping reads.
    work.then(() => {}, () => {}).finally(() => { if (inFlight === task) inFlight = null; });
    return task.result;
  }
  async function run() { try { await check(); } catch { /* Safe status is retained. */ } return snapshot(); }
  async function read() { const value = await check(); return { ...value.report, verification: snapshot() }; }
  const timer = enabled ? schedule(() => { void run(); }, intervalMs) : null;
  timer?.unref?.();
  return { run, read, snapshot, unavailable };
}

module.exports = { verifyAnalyticsReport, createAnalyticsVerification };
