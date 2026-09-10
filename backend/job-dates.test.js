'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { jobPostedDate } = require('./job-dates');
require('./generated-media');
const { createAppHarness } = require('./test-support/app-harness');

test('posting dates preserve source timestamps and never substitute collection time', () => {
  const now = Date.parse('2026-09-09T12:00:00Z');
  for (const missing of [null, undefined, '', 'invalid', '2027-01-01', NaN]) assert.equal(jobPostedDate(missing, now), null);
  assert.equal(jobPostedDate('2026-08-02', now), '2026-08-02T00:00:00.000Z');
  assert.equal(jobPostedDate('2026-08-02 05:30:00', now), '2026-08-02T05:30:00.000Z');
  assert.equal(jobPostedDate('2026-08-02T05:30:00-07:00', now), '2026-08-02T12:30:00.000Z');
  assert.equal(jobPostedDate(1750000000, now), jobPostedDate(1750000000000, now));
});

test('job dates survive normalization, database hydration and opportunity mapping', async () => {
  const app = await createAppHarness();
  try {
    for (const source of ['indeed', 'usajobs', 'remoteok', 'remotive', 'muse']) {
      const row = { id: 'date-test', source, title: 'Engineer', author_name: 'Example', post_created_at: null, fetched_at: new Date().toISOString() };
      const hydrated = app.dbRowToFeedPost(row);
      assert.equal(app.normalizeFeedPost(hydrated).createdAt, null);
      assert.equal(app.mapSharedJobPost(hydrated, source).posted, null);
      row.post_created_at = '2025-02-03T00:00:00Z';
      assert.equal(app.mapSharedJobPost(app.dbRowToFeedPost(row), source).posted, '2025-02-03T00:00:00.000Z');
    }
  } finally { await app.close(); }
});
