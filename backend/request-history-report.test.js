'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { REQUEST_ANALYTICS_SCHEMA } = require('./request-analytics');
const { REQUEST_ANALYTICS_HISTORY_SCHEMA } = require('./request-history-schema');
const { readRequestHistoryReport, PROVIDER_REQUEST_REPORT_SQL } = require('./request-history-report');

const input = { from: '2026-05-01', to: '2026-11-05', today: '2026-11-05' };
async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(REQUEST_ANALYTICS_SCHEMA); await pg.exec(REQUEST_ANALYTICS_HISTORY_SCHEMA);
  await pg.exec(`INSERT INTO request_analytics_daily_counts VALUES
    ('2026-11-05','api','feed','2xx','2_10s',3,6000,'2026-11-05T01:00:00Z','2026-11-05T02:00:00Z');
    INSERT INTO request_analytics_history_daily_counts VALUES
    ('render-request-logs','2026-10-22','api','feed','2xx','unknown',100,NULL,'2026-10-22T05:51:23Z','2026-10-22T23:00:00Z'),
    ('render-request-logs','2026-11-04','api','office','5xx','unknown',7,NULL,'2026-11-04T01:00:00Z','2026-11-04T23:00:00Z');
    INSERT INTO request_analytics_provider_daily_counts VALUES
    ('render-http-metrics','2026-10-07','api',200,1000,'2026-11-05T04:00:00Z'),
    ('render-http-metrics','2026-11-04','api',200,900,'2026-11-05T04:00:00Z'),
    ('render-http-metrics','2026-11-04','api',500,10,'2026-11-05T04:00:00Z');
    INSERT INTO request_analytics_history_coverage VALUES
    ('render-request-logs','api','2026-10-06T00:00:00Z','2026-11-05T00:00:00Z','2026-10-22T05:51:23Z','2026-11-04T23:00:00Z',TRUE,
      ARRAY(SELECT generate_series('2026-10-23'::date,'2026-11-04'::date,'1 day')::date),
      '[{"day":"2026-10-22","from":"2026-10-22T05:51:23Z","toExclusive":"2026-10-23T00:00:00Z","reason":"provider-retention"}]',
      '2026-11-05T04:00:00Z'),
    ('render-http-metrics','api','2026-10-07T00:00:00Z','2026-11-05T00:00:00Z','2026-10-07T00:00:00Z','2026-11-05T00:00:00Z',TRUE,
      ARRAY(SELECT generate_series('2026-10-07'::date,'2026-11-04'::date,'1 day')::date),'[]','2026-11-05T04:00:00Z');`);
  return { pg, db: { query: (...args) => pg.query(...args) } };
}

test('classified recovery adds closed historical days while timing and abort outcomes stay unknown', async t => {
  const { db } = await fixture(t);
  const result = await readRequestHistoryReport(db, input);
  assert.equal(result.totals.requests, 110); assert.equal(result.totals.errors, 7);
  assert.equal(result.totals.slowRequests, 3); assert.equal(result.totals.durationMs, 6000);
  assert.equal(result.totals.latencyKnownRequests, 3); assert.equal(result.totals.abortedKnownRequests, 3);
  const days = new Map(result.daily.map(row => [row.day, row]));
  assert.equal(days.get('2026-10-22').requests, 100);
  assert.equal(days.get('2026-10-22').slowRequests, null); assert.equal(days.get('2026-10-22').aborted, null);
  assert.equal(days.get('2026-11-04').durationMs, null); assert.equal(days.get('2026-11-05').slowRequests, 3);
  assert.equal(days.get('2026-10-23').requests, 0, 'a completed provider window can verify a zero-response closed day');
  assert.equal(days.get('2026-10-23').errors, 0); assert.equal(days.get('2026-10-23').aborted, null);
  assert.equal(days.has('2026-05-01'), false); assert.ok(result.coverage.missingDays.includes('2026-05-01'));
  assert.deepEqual(result.coverage.partialDays, ['2026-10-22', '2026-11-05']);
  assert.equal(result.byLatency.find(row => row.latencyBucket === 'unknown').requests, 107);
  assert.equal(result.history.liveFrom, '2026-11-05'); assert.equal(result.history.cutoffExclusive, '2026-11-05');
  assert.equal(result.history.sources[0].complete, false); assert.equal(result.history.sources[0].recoveredRequests, 107);
  assert.equal(result.history.sources[0].partialDays[0].reason, 'provider-retention');
});

test('platform public HTTP history is independently available earlier and is never added to classified totals', async t => {
  const { db } = await fixture(t);
  const result = await readRequestHistoryReport(db, input), provider = result.providerHistory;
  assert.equal(result.totals.requests, 110);
  assert.equal(provider.available, true); assert.equal(provider.source, 'render-http-ingress');
  assert.equal(provider.totals.requests, 1910); assert.equal(provider.totals.errors, 10);
  assert.equal(provider.totals.durationMs, null); assert.equal(provider.totals.slowRequests, null); assert.equal(provider.totals.aborted, null);
  assert.equal(provider.coverage.firstRecordedDay, '2026-10-07'); assert.equal(provider.coverage.observedDays, 29);
  assert.equal(provider.history.sources[0].complete, true); assert.equal(provider.history.sources[0].recoveredRequests, 1910);
  assert.equal(provider.dailyByRole.every(row => row.role === 'api'), true);
  assert.deepEqual(provider.byFamily, []); assert.deepEqual(provider.byLatency, [{ latencyBucket: 'unknown', requests: 1910 }]);
  assert.equal(provider.byStatus.find(row => row.statusClass === '2xx').requests, 1900);
  assert.match(provider.definition, /public HTTP/); assert.match(provider.definition, /do not add/);
  const selected = await readRequestHistoryReport(db, { ...input, from: '2026-10-07', to: '2026-10-08' });
  assert.deepEqual(selected.daily, []); assert.equal(selected.providerHistory.daily.length, 2);
  assert.equal(selected.providerHistory.totals.requests, 1000); assert.equal(selected.providerHistory.daily[1].requests, 0);
});

test('history cannot import the live collection day or invent equivalent header latency', async t => {
  const { pg } = await fixture(t);
  await assert.rejects(pg.exec(`INSERT INTO request_analytics_history_daily_counts VALUES
    ('render-request-logs','2026-11-05','pipeline','feed','2xx','unknown',1,NULL,'2026-11-05T01:00Z','2026-11-05T01:00Z')`));
  await assert.rejects(pg.exec(`INSERT INTO request_analytics_history_daily_counts VALUES
    ('render-request-logs','2026-11-04','pipeline','feed','2xx','2_10s',1,2400,'2026-11-04T01:00Z','2026-11-04T01:00Z')`));
  await assert.rejects(pg.exec(`INSERT INTO request_analytics_provider_daily_counts VALUES
    ('render-http-metrics','2026-11-05','pipeline',200,1,'2026-11-05T04:00Z')`));
});

test('defensive live-day precedence avoids double counting even if old classified rows overlap existing live data', async t => {
  const { pg, db } = await fixture(t);
  await pg.exec(`INSERT INTO request_analytics_daily_counts VALUES
    ('2026-10-22','api','feed','2xx','under_100ms',5,200,'2026-10-22T06:00Z','2026-10-22T06:00Z')`);
  const result = await readRequestHistoryReport(db, input);
  assert.equal(result.daily.find(row => row.day === '2026-10-22').requests, 5);
  assert.equal(result.totals.requests, 15); assert.equal(result.providerHistory.totals.requests, 1910);
});

test('a separate provider history read failure never hides classified requests or leaks storage details', async t => {
  const { pg } = await fixture(t);
  const result = await readRequestHistoryReport({ query: (sql, params) => {
    if (sql === PROVIDER_REQUEST_REPORT_SQL) throw Error('private-provider-table-host');
    return pg.query(sql, params);
  } }, input);
  assert.equal(result.totals.requests, 110); assert.equal(result.providerHistory.available, false);
  assert.equal(result.providerHistory.totals, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private-provider-table-host/);
});
