const test = require('node:test');
const assert = require('node:assert/strict');
const { GENERAL_UFI_GROUP_ID, isGeneralUfiFollowingPost, isFollowingSourceAllowed } = require('./following-scope');

test('Following accepts only general UFI posts from the native post pool', () => {
  assert.equal(isGeneralUfiFollowingPost({ source: 'uficonnect', groupId: GENERAL_UFI_GROUP_ID }), true);
  assert.equal(isGeneralUfiFollowingPost({ source: 'uficonnect', groupId: 'ufi-tech' }), false);
  assert.equal(isGeneralUfiFollowingPost({ source: 'reddit', groupId: GENERAL_UFI_GROUP_ID }), false);
});

test('Following supports Mastodon home timelines and excludes own-post-only integrations', () => {
  assert.equal(isFollowingSourceAllowed('instagram'), false);
  assert.equal(isFollowingSourceAllowed('TikTok'), false);
  assert.equal(isFollowingSourceAllowed('mastodon'), true);
  assert.equal(isFollowingSourceAllowed('youtube'), true);
  assert.equal(isFollowingSourceAllowed('twitter'), true);
  assert.equal(isFollowingSourceAllowed('facebook'), false);
  assert.equal(isFollowingSourceAllowed('uficonnect'), true);
  for (const source of ['medium', 'dribbble', 'threads', 'linkedin', 'discord', 'figma', 'weworkremotely', 'reuters', 'airbnb', 'unknown']) {
    assert.equal(isFollowingSourceAllowed(source), false, `${source} has no installed personal feed adapter`);
  }
});

test('public Home sources and connected Following sources share an explicit capability catalog', async () => {
  const { HOME_FEED_SOURCE_IDS, FOLLOWING_FEED_SOURCE_IDS, SOURCE_WEBSITE_IDS } = await import('../web/src/components/sourceMeta.js');
  const { home, following } = require('../shared/feed-source-catalog.json');
  const directory = require('./account-directory.json');
  const supportedDirectory = Object.keys(directory).filter(source => directory[source].feedSupported === true);
  assert.deepEqual(HOME_FEED_SOURCE_IDS, [...new Set([...home, ...supportedDirectory])]);
  assert.ok(HOME_FEED_SOURCE_IDS.includes('weworkremotely'));
  assert.ok(HOME_FEED_SOURCE_IDS.includes('cntraveler'));
  assert.deepEqual(FOLLOWING_FEED_SOURCE_IDS, ['uficonnect', ...Object.keys(following)]);
  for (const source of FOLLOWING_FEED_SOURCE_IDS) assert.equal(isFollowingSourceAllowed(source), true);
  for (const source of SOURCE_WEBSITE_IDS) {
    assert.equal(HOME_FEED_SOURCE_IDS.includes(source), false);
    assert.equal(isFollowingSourceAllowed(source), false);
    assert.equal(new URL(directory[source].loginUrl || directory[source].siteUrl).protocol, 'https:');
  }
  assert.ok(SOURCE_WEBSITE_IDS.includes('reuters'));
  assert.ok(SOURCE_WEBSITE_IDS.includes('spotify'));
  assert.equal(following.twitter, 'following');
  assert.equal(following.facebook, undefined);
  assert.ok(Object.values(following).every(capability => capability === 'following'));
});

test('external website sign-in and identity-only tokens never become Following post sources', async t => {
  const { createAppHarness, member } = require('./test-support/app-harness');
  const app = await createAppHarness();
  t.after(() => app.close());
  const sources = ['airbnb', 'spotify', 'reuters', 'threads', 'medium', 'dribbble'];
  app.seedUser(member('directory-following', { socialTokens: Object.fromEntries(sources.map(source => [source, 'legacy-fixture'])) }));
  for (const source of sources) app.setFollowingFetcher(source, async () => {
    throw new Error(`Unsupported ${source} fetch must not run`);
  });
  const result = await app.request('/office/feed?mode=following&passive=1&sources=' + sources.join(','), { userId: 'directory-following' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.posts, []);
  assert.deepEqual(result.data.sourceErrors, {});
  const catalog = await app.request('/social/platforms', { userId: 'directory-following' });
  assert.equal(catalog.status, 200);
  assert.deepEqual(catalog.data.platforms.weworkremotely.feed, { home: true, following: null });
  assert.deepEqual(catalog.data.platforms.cntraveler.feed, { home: true, following: null });
  assert.deepEqual(catalog.data.platforms.youtube.feed, { home: true, following: 'following' });
  assert.deepEqual(catalog.data.platforms.twitter.feed, { home: true, following: 'following' });
  assert.deepEqual(catalog.data.platforms.facebook.feed, { home: true, following: null });
  assert.deepEqual(catalog.data.platforms.reuters.feed, { home: false, following: null });
  assert.equal(catalog.data.connected.airbnb, false);
});
