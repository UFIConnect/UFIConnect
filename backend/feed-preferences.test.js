const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalizePreferenceTopics, matchesPreferenceTopic } = require('./feed-preferences');

const topics = [
  'AI & Machine Learning',
  '3D & CGI',
  'Web3 / Crypto',
  'Photography',
];

test('preserves canonical database topic labels after preference normalization', () => {
  assert.deepEqual(
    canonicalizePreferenceTopics(['ai machine learning', '3d cgi', 'web3 crypto'], topics),
    ['AI & Machine Learning', '3D & CGI', 'Web3 / Crypto'],
  );
});

test('keeps every selected canonical topic and removes unknowns and duplicates', () => {
  assert.deepEqual(
    canonicalizePreferenceTopics([
      'Photography',
      'AI & Machine Learning',
      'photography',
      'Not a real topic',
      'Web3 / Crypto',
    ], topics),
    ['Photography', 'AI & Machine Learning', 'Web3 / Crypto'],
  );
});

test('matches normalized member terms against punctuation-bearing post topics', () => {
  assert.equal(matchesPreferenceTopic('AI & Machine Learning', ['ai machine learning']), true);
  assert.equal(matchesPreferenceTopic('Web3 / Crypto', ['web3 crypto']), true);
  assert.equal(matchesPreferenceTopic('Music Discovery', ['photography']), false);
});
