import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officeWelcome } from './office-welcome.mjs';

test('login announcement reports observations and latest Work state', () => {
  const value = officeWelcome({ services: [
    { role: 'api', data: { server: { serviceRole: 'api', db: 'connected' }, feed: { postCount: 1234 } } },
    { role: 'pipeline', data: { server: { serviceRole: 'pipeline', db: 'fallback' }, sources: { degraded: 3, paused: 2 } } },
  ], tasks: [{ status: 'completed', updatedAt: '2026-11-03T10:00:00Z' }, { status: 'needs_confirmation', updatedAt: '2026-11-04T10:00:00Z', message: 'secret material never spoken' }] });
  assert.equal(value.observed, true);
  assert.ok(value.text.startsWith('Welcome back. I am Pip.'));
  assert.match(value.text, /1,234 posts/);
  assert.match(value.text, /3 sources are degraded and 2 are paused/);
  assert.match(value.text, /Pipeline database connection is not confirmed/);
  assert.match(value.text, /waiting for your approval/);
  assert.ok(!value.text.includes('secret material'));
  assert.ok(value.text.endsWith('Do you need anything?'));
});
test('wrong roles and failed reads never become healthy announcements', () => {
  const value = officeWelcome({ services: [{ role: 'pipeline', data: { server: { serviceRole: 'api', db: 'connected' } } }] });
  assert.equal(value.observed, false);
  assert.match(value.text, /Pipeline status could not be verified/);
  assert.ok(!value.text.includes('is connected'));
});
test('missing counts and unknown task states are never invented', () => {
  const value = officeWelcome({ services: [{ role: 'api', data: { server: { serviceRole: 'api' }, feed: { postCount: -1 } } }], tasks: [{ status: 'malicious words', updatedAt: '2026-11-04T10:00:00Z' }] });
  assert.ok(!value.text.includes('posts'));
  assert.ok(!value.text.includes('malicious'));
});

const checkedAt = '2026-11-04T19:23:47.000Z';
function summaryFixture() {
  return { schemaVersion: 1, asOf: '2026-11-04T19:23:00.000Z', timeZone: 'America/Los_Angeles',
    counts: { past24h: { posts: { memberCreated: 21, importedRetained: 32 }, newUsers: 7 },
      today: { posts: { memberCreated: 17, importedRetained: 29 }, newUsers: 6 },
      week: { posts: { memberCreated: 71, importedRetained: 97 }, newUsers: 22 } },
    analytics: { available: true, windows: { past24h: { complete: true, web: { views: 123 }, mobile: { views: 45 }, clientErrors: 3 } } },
    lastActivity: { available: true, complete: true, latest: { label: 'Refresh the feed', status: 'succeeded' }, sources: {} },
    warnings: { available: true, criticalActivityFindings: 1, serverErrors: 2, failedControls: 3, coverage: { exhaustive: false } } };
}
const services = [{ role: 'pipeline', data: { server: { serviceRole: 'pipeline', db: 'connected' },
  websiteOptimizer: { status: 'healthy', lastRun: checkedAt, subAgents: { web_pwa: { status: 'healthy', lastRun: checkedAt } } } } }];

test('welcome announces measured 24-hour analytics, local day/week counts, action and serious warning sources', () => {
  const value = officeWelcome({ summary: summaryFixture(), services, checkedAt });
  assert.equal(value.observed, true);
  assert.match(value.text, /123 recorded web opens and 45 app opens; 3 reported client errors/);
  assert.match(value.text, /Today: 17 member posts, 29 retained imported posts, and 6 new users/);
  assert.match(value.text, /This week: 71 member posts, 97 retained imported posts, and 22 new users/);
  assert.match(value.text, /Los Angeles time/);
  assert.match(value.text, /this week starts Monday/);
  assert.match(value.text, /Web health is healthy/);
  assert.match(value.text, /App web shell health is healthy/);
  assert.match(value.text, /Native installed-app health is not monitored/);
  assert.match(value.text, /Refresh the feed; completed/);
  assert.match(value.text, /1 critical activity findings, 2 recorded server errors, and 3 failed Office controls/);
  assert.match(value.text, /Only recorded warnings can be checked/);
});

test('partial coverage and unknown fields never sound like complete traffic or zero warnings', () => {
  const summary = summaryFixture();
  summary.analytics.windows.past24h.complete = false;
  summary.analytics.storage = { collector: { writeFailures: 2 } };
  summary.counts.today.posts.memberCreated = null;
  summary.counts.week.newUsers = -1;
  summary.warnings = { available: false, serverErrors: 4, failedControls: null, criticalActivityFindings: null };
  const value = officeWelcome({ summary, checkedAt });
  assert.match(value.text, /Partial history/);
  assert.match(value.text, /Earlier activity is unavailable/);
  assert.match(value.text, /collection failures/);
  assert.match(value.text, /Today: unavailable member posts/);
  assert.match(value.text, /97 retained imported posts, and unavailable new users/);
  assert.match(value.text, /4 recorded server errors/);
  assert.match(value.text, /warning history could not be fully verified/);
  assert.doesNotMatch(value.text, /No .*were recorded/);
});

test('zero warnings are scoped to verified records, never an all-clear for every serious event', () => {
  const summary = summaryFixture();
  summary.warnings = { available: true, criticalActivityFindings: 0, serverErrors: 0, failedControls: 0 };
  const value = officeWelcome({ summary, checkedAt });
  assert.match(value.text, /No critical activity findings, server errors, or failed Office controls were recorded/);
  assert.match(value.text, /Only recorded warnings can be checked/);
  assert.doesNotMatch(value.text, /no serious warnings occurred|everything is healthy/i);
});

test('old, future, and mismatched service health never receive healthy announcements', () => {
  for (const lastRun of ['2026-11-03T19:23:00Z', '2026-11-05T19:23:00Z', null, 'invalid']) {
    const stale = [{ role: 'pipeline', data: { server: { serviceRole: 'pipeline' },
      websiteOptimizer: { status: 'healthy', lastRun, subAgents: { web_pwa: { status: 'healthy', lastRun } } } } }];
    const value = officeWelcome({ summary: summaryFixture(), services: stale, checkedAt });
    assert.match(value.text, /Web health could not be verified from a recent check/);
    assert.match(value.text, /App web shell health could not be verified/);
    assert.doesNotMatch(value.text, /health is healthy/);
  }
  const wrong = services.map(service => ({ ...service, role: 'api' }));
  assert.doesNotMatch(officeWelcome({ services: wrong, checkedAt }).text, /health is healthy/);
});

test('stale summaries do not authenticate a welcome or reuse old statistics', () => {
  for (const asOf of ['2026-11-03T19:23:00Z', '2026-11-05T19:23:00Z', 'invalid']) {
    const summary = { ...summaryFixture(), asOf };
    const value = officeWelcome({ summary, checkedAt });
    assert.equal(value.observed, false);
    assert.doesNotMatch(value.text, /123 recorded web opens/);
    assert.match(value.text, /analytics, daily and weekly post and new-user counts, and warning history are unavailable/);
  }
});

test('available latest actions survive partial history with a clear caveat', () => {
  const summary = summaryFixture();
  summary.lastActivity.complete = false;
  summary.lastActivity.sources = { controls: 'available', memory: 'unavailable' };
  const value = officeWelcome({ summary, checkedAt });
  assert.match(value.text, /Refresh the feed; completed/);
  assert.match(value.text, /Some recent Office history could not be checked/);
  assert.match(value.text, /Activity history is shared/);
  summary.lastActivity.latest = null;
  const empty = officeWelcome({ summary, checkedAt });
  assert.match(empty.text, /in the available Office records/);
  assert.match(empty.text, /Some recent Office history could not be checked/);
});
