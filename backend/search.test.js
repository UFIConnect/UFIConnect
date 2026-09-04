const test = require('node:test');
const assert = require('node:assert/strict');
const {
  databaseSearchTerms,
  matchesRelatedSearch,
  relatedSearchScore,
  splitSearchWords,
} = require('./search');

test('normalizes and deduplicates typed search words', () => {
  assert.deepEqual(splitSearchWords('  Design. design, UX  '), ['design', 'ux']);
});

test('matches related career words without requiring the full phrase', () => {
  assert.equal(matchesRelatedSearch('A company is hiring a software engineer', 'developer jobs'), true);
  assert.equal(matchesRelatedSearch('Fresh restaurant opening downtown', 'dining'), true);
  assert.equal(matchesRelatedSearch('Quarterly accounting report', 'vacation'), false);
  assert.equal(matchesRelatedSearch('New career opportunity', 'hiring'), true);
});

test('builds safe OR and prefix queries for PostgreSQL full-text search', () => {
  const search = databaseSearchTerms('designer jobs');
  assert.match(search.webQuery, /"designer"/);
  assert.match(search.webQuery, / OR /);
  assert.match(search.prefixQuery, /designer:\*/);
  assert.equal(search.webQuery.includes('%'), false);
  assert.match(databaseSearchTerms('C++').webQuery, /"cpp"/);
});

test('scores an exact phrase above a merely related result', () => {
  assert.ok(
    relatedSearchScore('Senior product designer jobs', 'designer jobs')
      > relatedSearchScore('A creative career opportunity', 'designer jobs')
  );
});
