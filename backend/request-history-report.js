'use strict';
const { REQUEST_HISTORY_CUTOFF } = require('./request-history-schema');
const DAY = 86400000;
const summaries = `COALESCE(SUM(request_count),0)::bigint AS requests,
  CASE WHEN BOOL_OR(status_observed) THEN COALESCE(SUM(request_count) FILTER(WHERE status_class='5xx'),0)::bigint END AS errors,
  CASE WHEN BOOL_OR(status_observed) THEN COALESCE(SUM(request_count) FILTER(WHERE status_class='4xx'),0)::bigint END AS "clientErrors",
  CASE WHEN BOOL_OR(latency_observed) THEN COALESCE(SUM(request_count) FILTER(WHERE latency_bucket IN ('2_10s','over_10s')),0)::bigint END AS "slowRequests",
  CASE WHEN BOOL_OR(aborted_observed) THEN COALESCE(SUM(request_count) FILTER(WHERE status_class='aborted'),0)::bigint END AS aborted,
  CASE WHEN BOOL_OR(duration_observed) THEN COALESCE(SUM(duration_ms),0)::bigint END AS "durationMs",
  COALESCE(SUM(request_count) FILTER(WHERE status_observed),0)::bigint AS "statusKnownRequests",
  COALESCE(SUM(request_count) FILTER(WHERE latency_observed),0)::bigint AS "latencyKnownRequests",
  COALESCE(SUM(request_count) FILTER(WHERE duration_observed),0)::bigint AS "durationKnownRequests",
  COALESCE(SUM(request_count) FILTER(WHERE aborted_observed),0)::bigint AS "abortedKnownRequests"`;
const grouped = (columns, group, order, condition = '') => `COALESCE((SELECT jsonb_agg(to_jsonb(summary) ORDER BY ${order}) FROM
  (SELECT ${columns},${summaries} FROM matching ${condition} GROUP BY ${group}) summary),'[]'::jsonb)`;
const rawClassified = `SELECT day,role,family,status_class,latency_bucket,request_count,duration_ms,
    'live-instrumentation'::text AS source,status_class<>'aborted' AS status_observed,
    TRUE AS latency_observed,TRUE AS duration_observed,TRUE AS aborted_observed
  FROM request_analytics_daily_counts WHERE day >= $1::date AND day <= $2::date
  UNION ALL
  SELECT h.day,h.role,h.family,h.status_class,h.latency_bucket,h.request_count,h.duration_ms,h.source,
    h.status_class<>'unknown',FALSE,FALSE,FALSE
  FROM request_analytics_history_daily_counts h
  WHERE h.day >= $1::date AND h.day <= $2::date AND h.day < DATE '${REQUEST_HISTORY_CUTOFF}'
    AND NOT EXISTS(SELECT 1 FROM request_analytics_daily_counts live WHERE live.day=h.day AND live.role=h.role)`;
const rawProvider = `SELECT day,role,NULL::text AS family,
    CASE WHEN status_code=0 THEN 'unknown' ELSE (status_code/100)::text||'xx' END AS status_class,
    'unknown'::text AS latency_bucket,request_count,NULL::bigint AS duration_ms,source,
    status_code<>0 AS status_observed,FALSE AS latency_observed,FALSE AS duration_observed,FALSE AS aborted_observed
  FROM request_analytics_provider_daily_counts WHERE day >= $1::date AND day <= $2::date`;
function reportSql(raw, source) {
  return `WITH recorded AS MATERIALIZED (${raw}), matching AS MATERIALIZED (
    SELECT * FROM recorded
    UNION ALL
    SELECT observed_day,c.role,NULL::text,'unknown','unknown',0::bigint,NULL::bigint,c.source,TRUE,FALSE,FALSE,FALSE
    FROM request_analytics_history_coverage c CROSS JOIN LATERAL unnest(c.complete_days) observed_day
    WHERE c.source='${source}' AND observed_day >= $1::date AND observed_day <= $2::date
      AND NOT EXISTS(SELECT 1 FROM recorded r WHERE r.day=observed_day AND r.role=c.role)
  ) SELECT (SELECT to_jsonb(summary) FROM (SELECT ${summaries} FROM matching) summary) AS totals,
    ${grouped('day::text AS day','day','day')} AS daily,
    ${grouped('day::text AS day,role','day,role','day,role')} AS daily_roles,
    ${grouped('role','role','role')} AS by_role,
    ${grouped('family','family','family','WHERE family IS NOT NULL')} AS by_family,
    COALESCE((SELECT jsonb_agg(to_jsonb(summary) ORDER BY "statusClass") FROM
      (SELECT status_class AS "statusClass",SUM(request_count)::bigint AS requests FROM matching WHERE request_count>0 GROUP BY status_class) summary),'[]'::jsonb) AS by_status,
    COALESCE((SELECT jsonb_agg(to_jsonb(summary) ORDER BY "latencyBucket") FROM
      (SELECT latency_bucket AS "latencyBucket",SUM(request_count)::bigint AS requests FROM matching WHERE request_count>0 GROUP BY latency_bucket) summary),'[]'::jsonb) AS by_latency,
    COALESCE((SELECT jsonb_agg(to_jsonb(coverage_window) ORDER BY coverage_window.role) FROM (
      SELECT c.source,c.role,c.requested_from,c.requested_to_exclusive,c.first_observed_at,c.last_observed_at,
        c.complete,c.complete_days,c.partial_days,c.imported_at,
        (SELECT MIN(day)::text FROM matching r WHERE r.source=c.source AND r.role=c.role) AS first_day,
        (SELECT MAX(day)::text FROM matching r WHERE r.source=c.source AND r.role=c.role) AS last_day,
        (SELECT COALESCE(SUM(request_count),0)::bigint FROM recorded r WHERE r.source=c.source AND r.role=c.role) AS recovered_requests
      FROM request_analytics_history_coverage c WHERE c.source='${source}'
        AND c.requested_from < ($2::date+1)::timestamptz AND c.requested_to_exclusive > $1::date::timestamptz
    ) coverage_window),'[]'::jsonb) AS history_sources`;
}
const CLASSIFIED_REQUEST_REPORT_SQL = reportSql(rawClassified, 'render-request-logs');
const PROVIDER_REQUEST_REPORT_SQL = reportSql(rawProvider, 'render-http-metrics');
function numericRow(row, identity = []) {
  const result = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (identity.includes(key)) result[key] = value;
    else if (value === null) result[key] = null;
    else {
      const count = Number(value);
      if (!Number.isSafeInteger(count) || count < 0) throw Error('Invalid anonymous request aggregate');
      result[key] = count;
    }
  }
  return result;
}
const dateTime = value => value == null ? null : new Date(value).toISOString();
function decode(snapshot, { from, to, today }, source) {
  if (!snapshot || !snapshot.totals || !Array.isArray(snapshot.daily)) throw Error('Request snapshot unavailable');
  const totals = numericRow(snapshot.totals), daily = snapshot.daily.map(row => numericRow(row, ['day']));
  const observed = new Set(daily.map(row => row.day)), missingDays = [];
  for (let time = Date.parse(from); time <= Date.parse(to); time += DAY) {
    const day = new Date(time).toISOString().slice(0, 10); if (!observed.has(day)) missingDays.push(day);
  }
  const sources = snapshot.history_sources.map(row => {
    const completeDays = (row.complete_days || []).filter(day => day >= from && day <= to);
    const partialDays = (row.partial_days || []).filter(item => item.day >= from && item.day <= to);
    const expectedDays = row.first_day && row.last_day ? Math.round((Date.parse(row.last_day) - Date.parse(row.first_day)) / DAY) + 1 : 0;
    return { source: row.source, role: row.role, from: row.first_day || null, to: row.last_day || null,
      firstRecordedDay: row.first_day || null, lastRecordedDay: row.last_day || null,
      requestedFrom: dateTime(row.requested_from), requestedToExclusive: dateTime(row.requested_to_exclusive),
      firstObservedAt: dateTime(row.first_observed_at), lastObservedAt: dateTime(row.last_observed_at),
      retrievedCompletely: row.complete === true,
      complete: row.complete === true && expectedDays > 0 && completeDays.length === expectedDays && !partialDays.length,
      completeDays, partialDays, recoveredRequests: numericRow({ count: row.recovered_requests }).count,
      importedAt: dateTime(row.imported_at),
      measurement: source === 'render-http-metrics'
        ? 'Render platform public HTTP response counts by UTC day and status. Private-network service calls are outside this provider dataset.'
        : 'Retained public HTTP request logs classified into fixed endpoint families, with private routes excluded. Historical time to response headers and abort counts are unknown.',
    };
  });
  const partialDays = new Set(sources.flatMap(item => item.partialDays.map(day => day.day)));
  if (source === 'render-request-logs') {
    if (observed.has(REQUEST_HISTORY_CUTOFF)) partialDays.add(REQUEST_HISTORY_CUTOFF);
    if (today && observed.has(today)) partialDays.add(today);
  }
  return { totals, daily, dailyByRole: snapshot.daily_roles.map(row => numericRow(row, ['day', 'role'])),
    byRole: snapshot.by_role.map(row => numericRow(row, ['role'])), byFamily: snapshot.by_family.map(row => numericRow(row, ['family'])),
    byStatus: snapshot.by_status.map(row => numericRow(row, ['statusClass'])), byLatency: snapshot.by_latency.map(row => numericRow(row, ['latencyBucket'])),
    coverage: { firstRecordedDay: daily[0]?.day || null, lastRecordedDay: daily.at(-1)?.day || null,
      observedDays: daily.length, missingDays, partialDays: [...partialDays].sort(),
      note: 'Absent days are unobserved. Recovered provider coverage is listed by service; retention and the first or current live collection day can leave partial days.' },
    metricCoverage: { requestsWithKnownStatus: totals.statusKnownRequests, requestsWithHeaderLatency: totals.latencyKnownRequests,
      requestsWithKnownDuration: totals.durationKnownRequests, requestsWithKnownAbortOutcome: totals.abortedKnownRequests },
    history: { sources, liveFrom: REQUEST_HISTORY_CUTOFF, cutoffExclusive: REQUEST_HISTORY_CUTOFF },
  };
}
async function readRequestHistoryReport(db, { from, to, today }) {
  const [classifiedResult, providerResult] = await Promise.allSettled([
    Promise.resolve().then(() => db.query(CLASSIFIED_REQUEST_REPORT_SQL, [from, to])),
    Promise.resolve().then(() => db.query(PROVIDER_REQUEST_REPORT_SQL, [from, to])),
  ]);
  if (classifiedResult.status !== 'fulfilled') throw Error('Classified request snapshot unavailable');
  const classified = decode(classifiedResult.value.rows[0], { from, to, today }, 'render-request-logs');
  const base = { source: 'render-http-ingress', range: { from, to, timezone: 'UTC' },
    definition: 'Render platform public HTTP responses across the service. This all-route aggregate is independent of classified request history and Cloudflare traffic; do not add these measurements together.',
    measurement: 'Provider UTC day counts and HTTP statuses only. No latency, abort, route, account or visitor measurements are inferred.' };
  let providerHistory;
  try {
    if (providerResult.status !== 'fulfilled') throw Error('Provider snapshot unavailable');
    const provider = decode(providerResult.value.rows[0], { from, to, today }, 'render-http-metrics');
    providerHistory = { ...base, available: provider.daily.length > 0, ...provider };
  } catch {
    providerHistory = { ...base, available: false, error: 'Provider request history is temporarily unavailable.',
      daily: [], dailyByRole: [], byRole: [], byStatus: [], history: { sources: [], liveFrom: REQUEST_HISTORY_CUTOFF, cutoffExclusive: REQUEST_HISTORY_CUTOFF } };
  }
  return { ...classified, providerHistory };
}

module.exports = { readRequestHistoryReport, CLASSIFIED_REQUEST_REPORT_SQL, PROVIDER_REQUEST_REPORT_SQL };
