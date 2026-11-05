const test = require('node:test');
const assert = require('node:assert/strict');
const menu = import('../web/src/utils/sourcePostMenu.mjs');

test('YouTube menu preserves source likes and genuine channel while offering real provider pages', async () => {
  const { sourcePostMenuItems } = await menu;
  const channel = 'https://www.youtube.com/channel/UC1234567890123456789012';
  const original = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const items = sourcePostMenuItems({ source: 'youtube', sourceUrl: original, author: { profileUrl: channel } });
  assert.equal(items.find(item => item.label === 'Likes on YouTube').href, original);
  assert.equal(items.find(item => item.label === 'Go to profile').href, channel);
  assert.equal(items.find(item => item.key === 'playlists').href, channel + '/playlists');
  assert.equal(items.find(item => item.key === 'watch-later').href, 'https://www.youtube.com/playlist?list=WL');
  assert.ok(items.every(item => !item.onSelect), 'Provider-page links must not claim to submit provider actions');
});

test('Reddit menu uses the actual community and poster and can open existing comments', async () => {
  const { sourcePostMenuItems } = await menu;
  const onOpenComments = () => {};
  const post = { source: 'reddit', authorId: 'reddit_helpful_writer', sourceUrl: 'https://www.reddit.com/r/actual_community/comments/abc123/story' };
  const items = sourcePostMenuItems(post, { onOpenComments });
  assert.equal(items.find(item => item.key === 'community').href, 'https://www.reddit.com/r/actual_community/');
  assert.equal(items.find(item => item.label === 'Go to profile').href, 'https://www.reddit.com/user/helpful_writer/');
  assert.equal(items.find(item => item.key === 'comments').onSelect, onOpenComments);
  assert.equal(items.find(item => item.key === 'comments').href, undefined);
  assert.equal(sourcePostMenuItems(post, { includeComments: false }).some(item => item.key === 'comments'), false);
});

test('Mastodon menu retains the actual federated author and original status', async () => {
  const { sourcePostMenuItems } = await menu;
  const original = 'https://community.example/@writer/123';
  const items = sourcePostMenuItems({ source: 'mastodon', sourceUrl: original });
  assert.equal(items.find(item => item.label === 'Favourites on Mastodon').href, original);
  assert.equal(items.some(item => /likes?/i.test(item.label)), false);
  assert.equal(items.find(item => item.key === 'boost').href, original);
  assert.equal(items.find(item => item.key === 'source-bookmark').href, original);
  assert.equal(items.find(item => item.label === 'Go to profile').href, 'https://community.example/@writer');
  assert.equal(items.find(item => item.key === 'comments').href, original);
});

test('GitHub and GitLab menus navigate to their real repository or nested project', async () => {
  const { sourcePostMenuItems } = await menu;
  const github = sourcePostMenuItems({ source: 'github', sourceUrl: 'https://github.com/actual-org/actual-repo/issues/42', author: { profileUrl: 'https://github.com/actual-author' } });
  assert.equal(github.find(item => item.key === 'repository').href, 'https://github.com/actual-org/actual-repo');
  assert.equal(github.find(item => item.label === 'Go to profile').href, 'https://github.com/actual-author');
  const project = sourcePostMenuItems({ source: 'gitlab', sourceUrl: 'https://gitlab.com/team/subgroup/project/-/merge_requests/9' });
  assert.equal(project.find(item => item.key === 'project').href, 'https://gitlab.com/team/subgroup/project');
  assert.equal(project.find(item => item.key === 'comments').href, 'https://gitlab.com/team/subgroup/project/-/merge_requests/9');
  const repoOnly = sourcePostMenuItems({ source: 'github', sourceUrl: 'https://github.com/team/repo' });
  assert.equal(repoOnly.some(item => item.key === 'comments'), false, 'Repository stars do not imply an issue comment API');
});

test('Unsafe or missing originals never erase a valid supplied poster profile or produce unsafe links', async () => {
  const { sourcePostMenuItems } = await menu;
  for (const sourceUrl of [undefined, 'javascript:alert(1)', 'data:text/html,unsafe', 'https://user:password@youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com/\nwatch']) {
    const items = sourcePostMenuItems({ source: 'youtube', sourceUrl, author: { profileUrl: 'https://www.youtube.com/@actual-author' } });
    assert.equal(items.length, 1);
    assert.equal(items[0].label, 'Go to profile');
    assert.equal(items[0].href, 'https://www.youtube.com/@actual-author');
  }
  const unavailable = sourcePostMenuItems({ source: 'youtube', sourceUrl: 'javascript:alert(1)', author: { profileUrl: 'data:text/html,unsafe' } });
  assert.equal(unavailable[0].disabled, true);
  assert.equal(unavailable[0].href, undefined);
});

test('A mismatched provider host does not create provider-specific navigation or pretend to be a profile', async () => {
  const { sourcePostMenuItems } = await menu;
  const items = sourcePostMenuItems({ source: 'reddit', sourceUrl: 'https://example.invalid/r/fake/comments/abc123/story' });
  assert.equal(items.find(item => item.key === 'original').label, 'Open original post');
  assert.equal(items.some(item => item.key === 'community' || item.key === 'comments'), false);
  assert.equal(items.find(item => item.label === 'Go to profile').disabled, true);
});

test('Career-site menus retain application listing navigation without offering social writes', async () => {
  const { sourcePostMenuItems } = await menu;
  const items = sourcePostMenuItems({ source: 'remotive', type: 'job', sourceUrl: 'https://remotive.com/remote-jobs/software-dev/actual-role' });
  assert.equal(items.find(item => item.key === 'original').label, 'Open job listing on Remotive');
  assert.equal(items.some(item => item.key === 'comments' || item.onSelect), false);
});
