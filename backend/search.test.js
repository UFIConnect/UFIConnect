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

test('matches separate words and complete prefixes, not interior substrings or truncated stems', () => {
  assert.equal(matchesRelatedSearch('Architecture discussion', 'art'), false);
  assert.equal(matchesRelatedSearch('Accountants meeting', 'accountability'), false);
  assert.equal(matchesRelatedSearch('Designing a garden', 'garden space'), false);
  assert.equal(matchesRelatedSearch('Gardening together', 'garden'), true);
  assert.equal(matchesRelatedSearch('UX, design and C++', 'c++'), true);
});

test('matches related career words without requiring the full phrase', () => {
  assert.equal(matchesRelatedSearch('A company is hiring a software engineer', 'developer jobs'), true);
  assert.equal(matchesRelatedSearch('Fresh restaurant opening downtown', 'dining'), true);
  assert.equal(matchesRelatedSearch('Quarterly accounting report', 'vacation'), false);
  assert.equal(matchesRelatedSearch('New career opportunity', 'hiring'), true);
});

test('requires every query concept and ignores conversational stop words', () => {
  assert.equal(matchesRelatedSearch('Python developer hiring', 'find jobs for python'), true);
  assert.equal(matchesRelatedSearch('JavaScript developer hiring', 'python jobs'), false);
  assert.equal(matchesRelatedSearch('Jordan Jones', 'Jordan Smith'), false);
  assert.equal(matchesRelatedSearch('C# developer', 'C++'), false);
  assert.equal(matchesRelatedSearch('An unrelated post', 'the'), false);
});

test('builds grouped AND queries with related terms inside each group', () => {
  const search = databaseSearchTerms('designer jobs');
  assert.match(search.webQuery, /"designer"/);
  assert.equal(search.webQuery, '"designer" "jobs"');
  assert.match(search.prefixQuery, /designer:\*/);
  assert.match(search.prefixQuery, / & /);
  assert.equal(search.webQuery.includes('%'), false);
  assert.match(databaseSearchTerms('C++').prefixQuery, /cpp:\*/);
});

test('scores an exact phrase above a merely related result', () => {
  assert.ok(
    relatedSearchScore('Senior product designer jobs', 'designer jobs')
      > relatedSearchScore('A creative career opportunity', 'designer jobs')
  );
});

test('PostgreSQL search requires all concepts while accepting related career wording', async t => {
  const { PGlite } = require('@electric-sql/pglite');
  const pg = new PGlite(); t.after(() => pg.close());
  const search = databaseSearchTerms('find python jobs');
  const { rows } = await pg.query(`SELECT body FROM (VALUES
    ('Python engineer hiring'), ('JavaScript engineer hiring'), ('Python tutorial')) AS posts(body)
    WHERE to_tsvector('english', body) @@ (websearch_to_tsquery('english', $1) || to_tsquery('english', $2))`, [search.webQuery, search.prefixQuery]);
  assert.deepEqual(rows.map(row => row.body), ['Python engineer hiring']);
});
