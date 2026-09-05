const test = require('node:test');
const assert = require('node:assert/strict');
const { inferPublicGroupId } = require('./group-feed');

const groups = [
  { id: 'ext_r_webdev', subreddit: 'webdev', isPrivate: false },
  { id: 'ext_hn', isPrivate: false },
  { id: 'private-group', isPrivate: true },
];

test('preserves an explicit group id for transferred feed posts', () => {
  assert.equal(inferPublicGroupId({ group_id: 'ext_r_webdev', source: 'reddit' }, groups), 'ext_r_webdev');
});

test('normalizes older source-wide group ids to the public directory ids', () => {
  const sourceGroups = [
    ...groups,
    { id: 'ext_gh_oss', isPrivate: false },
    { id: 'ext_devhunt', isPrivate: false },
  ];
  assert.equal(inferPublicGroupId({ group_id: 'ext_github', source: 'github' }, sourceGroups), 'ext_gh_oss');
  assert.equal(inferPublicGroupId({ group_id: 'ext_producthunt', source: 'producthunt' }, sourceGroups), 'ext_devhunt');
});

test('recovers a Reddit community from a legacy cached source URL', () => {
  assert.equal(inferPublicGroupId({
    source: 'reddit',
    source_url: 'https://www.reddit.com/r/webdev/comments/example/post',
  }, groups), 'ext_r_webdev');
});

test('maps legacy source-wide communities only when the public group exists', () => {
  assert.equal(inferPublicGroupId({ source: 'hackernews' }, groups), 'ext_hn');
  assert.equal(inferPublicGroupId({ source: 'github' }, groups), null);
});

test('does not infer private or unknown communities', () => {
  assert.equal(inferPublicGroupId({ source: 'reddit', source_url: 'https://reddit.com/r/private' }, groups), null);
  assert.equal(inferPublicGroupId({ source: 'medium' }, groups), null);
});
