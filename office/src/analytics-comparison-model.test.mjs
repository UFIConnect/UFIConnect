import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonDaily, selectComparison, selectRequestDays } from './analytics-comparison-model.mjs';

const report = { range: { from: '2026-05-30', to: '2026-06-02' }, daily: [
  { day: '2026-05-30', edgeRequests: 1000, htmlPageViews: 500, webPageOpens: null, mobileScreenOpens: null, tabOpens: null, diagnostics: null, registrations: 2 },
  { day: '2026-05-31', edgeRequests: 100, htmlPageViews: 50, webPageOpens: 10, mobileScreenOpens: 3, tabOpens: 2, diagnostics: 0, registrations: null },
  { day: '2026-06-01', edgeRequests: 300, htmlPageViews: 120, webPageOpens: 0, mobileScreenOpens: 0, tabOpens: 0, diagnostics: 2, registrations: 1 },
] };

test('comparison matches observed UTC dates without treating absent app counts as zero or filtering for registrations', () => {
  const selected = selectComparison(report);
  assert.equal(selected.requestedDays, 4); assert.equal(selected.matchedDays, 2); assert.equal(selected.selectedDays, 2);
  assert.deepEqual(selected.daily.map(row => row.day), ['2026-05-31', '2026-06-01']);
  assert.equal(selected.totals.edgeRequests, 400); assert.equal(selected.totals.htmlPageViews, 170);
  assert.equal(selected.totals.webPageOpens, 10); assert.equal(selected.totals.registrations, 1);
  assert.deepEqual(selected.totals.coverage.registrations, { observedDays: 1, missingDays: 1 });
  assert.equal('uniqueVisitors' in selected.totals, false); assert.equal('conversionRate' in selected.totals, false);
});

test('all-date month groups preserve missing-day coverage and genuine recorded zeros', () => {
  const selected = selectComparison(report, { matched: false });
  assert.equal(selected.selectedDays, 4); assert.equal(selected.totals.edgeRequests, 1400);
  assert.deepEqual(selected.totals.coverage.edgeRequests, { observedDays: 3, missingDays: 1 });
  assert.equal(selected.rows[0].period, '2026-05'); assert.equal(selected.rows[0].webPageOpens, 10);
  assert.deepEqual(selected.rows[0].coverage.webPageOpens, { observedDays: 1, missingDays: 1 });
  const june = selectComparison(report, { start: '2026-06-01', end: '2026-06-01', group: 'day' });
  assert.equal(june.totals.webPageOpens, 0); assert.equal(june.totals.diagnostics, 2);
  const gap = selectComparison(report, { start: '2026-06-02', end: '2026-06-02', matched: false });
  assert.equal(gap.totals.edgeRequests, null); assert.equal(gap.totals.registrations, null);
  assert.deepEqual(gap.totals.coverage.registrations, { observedDays: 0, missingDays: 1 });
});

test('shared-date matching follows the selected pair without discarding web history when mobile collection has never recorded an event', () => {
  const noMobile = { ...report, daily: report.daily.map(row => ({ ...row, mobileScreenOpens: null, diagnostics: null })) };
  assert.equal(selectComparison(noMobile).selectedDays, 2);
  assert.equal(selectComparison(noMobile, { rightKey: 'mobileScreenOpens' }).selectedDays, 0);
  const registrations = selectComparison(noMobile, { rightKey: 'registrations' });
  assert.deepEqual(registrations.daily.map(row => row.day), ['2026-05-30', '2026-06-01']);
});

test('invalid or unsafe measurements stay unavailable and unsupported dates cannot allocate unbounded history', () => {
  assert.deepEqual(comparisonDaily({ range: { from: '2026-02-30', to: '2026-03-02' } }), []);
  assert.deepEqual(comparisonDaily({ range: { from: '1900-01-01', to: '2100-01-01' } }), []);
  const result = selectComparison({ range: { from: '2026-05-30', to: '2026-05-30' }, daily: [
    { day: '2026-05-30', edgeRequests: -1, htmlPageViews: '900', webPageOpens: Number.MAX_SAFE_INTEGER + 1, mobileScreenOpens: true },
  ] }, { matched: false });
  for (const key of ['edgeRequests', 'htmlPageViews', 'webPageOpens', 'mobileScreenOpens']) assert.equal(result.totals[key], null);
});

test('request service and date filtering uses durable daily rows and keeps unobserved history unavailable', () => {
  const requests = { daily: [
    { day: '2026-06-01', requests: 10, errors: 1, clientErrors: 2, slowRequests: 3, aborted: 0 },
    { day: '2026-06-02', requests: 20, errors: 0, clientErrors: 4, slowRequests: 1, aborted: 2 },
  ], dailyByRole: [
    { day: '2026-06-01', role: 'api', requests: 7, errors: 1, clientErrors: 2, slowRequests: 3, aborted: 0 },
    { day: '2026-06-01', role: 'pipeline', requests: 3, errors: 0, clientErrors: 0, slowRequests: 0, aborted: 0 },
  ] };
  assert.equal(selectRequestDays(requests).totals.requests, 30);
  assert.equal(selectRequestDays(requests, { role: 'api' }).totals.requests, 7);
  assert.equal(selectRequestDays(requests, { end: '2026-06-01' }).totals.requests, 10);
  assert.equal(selectRequestDays(requests, { end: '2026-05-31' }).totals.requests, null);
});

test('recovered request totals retain unknown timings and do not absorb overlapping provider totals', () => {
  const requests = { daily: [
    { day: '2026-10-22', requests: 100, errors: 2, clientErrors: 4, slowRequests: null, aborted: null },
    { day: '2026-11-05', requests: 10, errors: 0, clientErrors: 1, slowRequests: 1, aborted: 0 },
  ], providerHistory: { daily: [{ day: '2026-10-22', requests: 120, errors: 3, clientErrors: 5 }] } };
  const historic = selectRequestDays(requests, { end: '2026-10-22' });
  assert.equal(historic.totals.requests, 100);
  assert.equal(historic.totals.slowRequests, null);
  assert.equal(historic.totals.aborted, null);
  const combined = selectRequestDays(requests);
  assert.equal(combined.totals.requests, 110);
  assert.equal(combined.totals.slowRequests, 1);
  assert.deepEqual(combined.totals.coverage.slowRequests, { observedDays: 1, missingDays: 1 });
  assert.equal(selectRequestDays(requests.providerHistory).totals.requests, 120);
});
