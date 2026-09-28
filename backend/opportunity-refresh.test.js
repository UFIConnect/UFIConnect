'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { reorderOpportunitiesForRefresh } = require('./opportunity-refresh');

test('refresh prioritizes unseen jobs with source-balanced order and stable pagination', () => {
  const jobs = Array.from({ length: 8 }, (_, index) => ({ id: `job-${index}`, source: index % 2 ? 'B' : 'A' }));
  const shown = new Set(jobs.slice(0, 4).map(job => job.id));
  const first = reorderOpportunitiesForRefresh(jobs, shown, 'refresh-1');
  assert.equal(first.mode, 'unseen');
  assert.deepEqual(first.results.slice(0, 4), jobs.slice(4));
  assert.deepEqual(first.results.slice(4), jobs.slice(0, 4));
  assert.deepEqual(reorderOpportunitiesForRefresh(jobs, shown, 'refresh-1').results.slice(3, 6), first.results.slice(3, 6));
  assert.deepEqual(reorderOpportunitiesForRefresh(jobs, shown, '').results, jobs);
});

test('an exhausted refresh preserves real listings and reports no new content', () => {
  const jobs = [{ id: 'one' }, { id: 'two' }];
  const result = reorderOpportunitiesForRefresh(jobs, new Set(['one', 'two']), 'refresh-2');
  assert.equal(result.mode, 'unchanged');
  assert.deepEqual(result.results, jobs);
  assert.equal(reorderOpportunitiesForRefresh([], new Set(), 'refresh-3').mode, 'unchanged');
});
