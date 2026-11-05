'use strict';

const REQUEST_HISTORY_CUTOFF = '2026-11-05';
const REQUEST_HISTORY_FAMILIES = ['health','analytics','office','feed','auth','profile','community','messaging','connections','careers','billing','travel','media','other'];
const list = values => values.map(value => `'${value}'`).join(',');
// Retained provider request logs cover the period before live instrumentation.
// Their full-response timing is not equivalent to time to response headers.
const REQUEST_ANALYTICS_HISTORY_SCHEMA = `CREATE TABLE IF NOT EXISTS request_analytics_history_daily_counts (
  source TEXT NOT NULL CHECK(source='render-request-logs'),
  day DATE NOT NULL CHECK(day >= DATE '2026-05-01' AND day < DATE '${REQUEST_HISTORY_CUTOFF}'),
  role TEXT NOT NULL CHECK(role IN ('api','pipeline')),
  family TEXT NOT NULL CHECK(family IN (${list(REQUEST_HISTORY_FAMILIES)})),
  status_class TEXT NOT NULL CHECK(status_class IN ('1xx','2xx','3xx','4xx','5xx','unknown')),
  latency_bucket TEXT NOT NULL CHECK(latency_bucket='unknown'),
  request_count BIGINT NOT NULL CHECK(request_count BETWEEN 1 AND 9007199254740991),
  duration_ms BIGINT CHECK(duration_ms IS NULL),
  first_observed_at TIMESTAMPTZ NOT NULL,
  last_observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(source,day,role,family,status_class,latency_bucket),
  CHECK(first_observed_at <= last_observed_at),
  CHECK((first_observed_at AT TIME ZONE 'UTC')::date=day AND (last_observed_at AT TIME ZONE 'UTC')::date=day)
);
CREATE TABLE IF NOT EXISTS request_analytics_provider_daily_counts (
  source TEXT NOT NULL CHECK(source='render-http-metrics'),
  day DATE NOT NULL CHECK(day >= DATE '2026-05-01' AND day < DATE '${REQUEST_HISTORY_CUTOFF}'),
  role TEXT NOT NULL CHECK(role IN ('api','pipeline')),
  status_code INTEGER NOT NULL CHECK(status_code=0 OR status_code BETWEEN 100 AND 599),
  request_count BIGINT NOT NULL CHECK(request_count BETWEEN 0 AND 9007199254740991),
  observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(source,day,role,status_code)
);
CREATE TABLE IF NOT EXISTS request_analytics_history_coverage (
  source TEXT NOT NULL CHECK(source IN ('render-request-logs','render-http-metrics')),
  role TEXT NOT NULL CHECK(role IN ('api','pipeline')),
  requested_from TIMESTAMPTZ NOT NULL,
  requested_to_exclusive TIMESTAMPTZ NOT NULL,
  first_observed_at TIMESTAMPTZ,
  last_observed_at TIMESTAMPTZ,
  complete BOOLEAN NOT NULL CHECK(complete),
  complete_days DATE[] NOT NULL DEFAULT '{}',
  partial_days JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(partial_days)='array'),
  imported_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(source,role),
  CHECK(requested_from >= TIMESTAMPTZ '2026-05-01T00:00:00Z'),
  CHECK(requested_from < requested_to_exclusive),
  CHECK(requested_to_exclusive <= TIMESTAMPTZ '${REQUEST_HISTORY_CUTOFF}T00:00:00Z'),
  CHECK((first_observed_at IS NULL)=(last_observed_at IS NULL)),
  CHECK(first_observed_at IS NULL OR (first_observed_at >= requested_from AND last_observed_at <= requested_to_exclusive AND first_observed_at <= last_observed_at))
)`;

module.exports = { REQUEST_ANALYTICS_HISTORY_SCHEMA, REQUEST_HISTORY_CUTOFF, REQUEST_HISTORY_FAMILIES };
