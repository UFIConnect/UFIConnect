const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createAppHarness } = require('./test-support/app-harness');

test('stored author photos return on feed posts and only safe HTTPS URLs are kept', async t => {
  const app = await createAppHarness();
  t.after(() => app.close());
  const row = { id: 'mastodon_1', source: 'mastodon', title: 'Hello', content: 'Hello', author_name: 'Traveller',
    source_url: 'https://mastodon.social/@t/1', post_created_at: new Date().toISOString(), fetched_at: new Date().toISOString() };
  assert.equal(app.dbRowToFeedPost({ ...row, author_avatar_url: 'https://files.mastodon.social/avatar.png' }).author.avatarUrl,
    'https://files.mastodon.social/avatar.png');
  for (const unsafe of ['javascript:alert(1)', 'http://example.com/a.png', 'https://user:pass@example.com/a.png', '', null]) {
    assert.equal(app.dbRowToFeedPost({ ...row, author_avatar_url: unsafe }).author.avatarUrl, undefined, String(unsafe));
  }
  assert.equal(app.dbRowToFeedPost(row).author.name, 'Traveller');
});
