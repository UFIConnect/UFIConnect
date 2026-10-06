const test = require('node:test');
const assert = require('node:assert/strict');
const { safePostLink, sourceAuthorProfileUrl, postProfileLink } = require('./post-links.mjs');

test('post links reject script schemes, credentials, controls, and ambiguous relative URLs', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,hi', '//example.com', '/u/alice', 'https://user:password@example.com', 'https://example.com/\nprofile']) assert.equal(safePostLink(value), null);
  assert.equal(safePostLink('https://example.com/@alice'), 'https://example.com/@alice');
});

test('profile routes distinguish UFI identities from verified external author identifiers', () => {
  assert.deepEqual(postProfileLink({ source: 'uficonnect', authorId: 'alice' }, 'alice'), { to: '/profile', fallback: false });
  assert.deepEqual(postProfileLink({ author: { id: 'a/b' } }), { to: '/u/a%2Fb', fallback: false });
  assert.equal(sourceAuthorProfileUrl({ source: 'youtube', author: { id: 'youtube_UCabcdefghijklmnopqrstuv', name: 'Display name' } }), 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv');
  assert.equal(sourceAuthorProfileUrl({ source: 'youtube', author: { name: 'Popular Channel' }, sourceUrl: 'https://youtube.com/watch?v=abcdefghijk' }), null);
  assert.equal(sourceAuthorProfileUrl({ source: 'bluesky', sourceUrl: 'https://bsky.app/profile/alice.example/post/abc' }), 'https://bsky.app/profile/alice.example');
  assert.equal(sourceAuthorProfileUrl({ source: 'mastodon', sourceUrl: 'https://social.example/@alice/123' }), 'https://social.example/@alice');
  assert.equal(sourceAuthorProfileUrl({ source: 'github', sourceUrl: 'https://github.com/alice/project/issues/1' }), null, 'repository owner is not necessarily the issue author');
  assert.equal(sourceAuthorProfileUrl({ source: 'twitter', sourceUrl: 'https://x.com/i/status/123' }), null);
  assert.equal(sourceAuthorProfileUrl({ source: 'devto', sourceUrl: 'https://dev.to.attacker.example/alice/article' }), null);
});

test('unknown source authors use an explicit original-post fallback without fabricated profile paths', () => {
  assert.deepEqual(postProfileLink({ source: 'youtube', author: { name: 'Display name' }, sourceUrl: 'https://youtube.com/watch?v=abcdefghijk' }), { href: 'https://youtube.com/watch?v=abcdefghijk', fallback: true });
  assert.equal(postProfileLink({ source: 'reddit', author: { name: '[deleted]' }, sourceUrl: 'javascript:alert(1)' }), null);
  assert.equal(sourceAuthorProfileUrl({ source: 'youtube', author: { profileUrl: 'https://youtube.com/@creator' } }), 'https://youtube.com/@creator');
});
