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
  assert.equal(isFollowingSourceAllowed('uficonnect'), true);
  for (const source of ['medium', 'dribbble', 'threads', 'linkedin', 'discord', 'figma', 'weworkremotely', 'cntraveler', 'twitter', 'facebook', 'reuters', 'airbnb', 'unknown']) {
    assert.equal(isFollowingSourceAllowed(source), false, `${source} has no installed personal feed adapter`);
  }
});

test('public Home sources and connected Following sources share an explicit capability catalog', async () => {
  const { HOME_FEED_SOURCE_IDS, FOLLOWING_FEED_SOURCE_IDS, SOURCE_WEBSITE_IDS } = await import('../web/src/components/sourceMeta.js');
  const { home, following } = require('../shared/feed-source-catalog.json');
  const directory = require('./account-directory.json');
  assert.deepEqual(HOME_FEED_SOURCE_IDS, home);
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
  assert.ok(home.includes('twitter'));
  assert.ok(home.includes('facebook'));
  assert.equal(following.twitter, undefined);
  assert.equal(following.facebook, undefined);
  assert.deepEqual(Object.keys(following).sort(), ['youtube','github','gitlab','reddit','twitch','bluesky','mastodon'].sort());
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
  assert.deepEqual(catalog.data.platforms.twitter.feed, { home: true, following: null });
  assert.deepEqual(catalog.data.platforms.facebook.feed, { home: true, following: null });
  assert.deepEqual(catalog.data.platforms.reuters.feed, { home: false, following: null });
  assert.equal(catalog.data.connected.airbnb, false);
});

test('Following uses every supported personal adapter without shared public or other-account posts', async t => {
  const { createAppHarness, member } = require('./test-support/app-harness');
  const app=await createAppHarness(); t.after(()=>app.close());
  const sources=Object.keys(require('../shared/feed-source-catalog.json').following);
  const excluded=['weworkremotely','cntraveler','twitter','facebook'];
  const viewer=member('following-capability-reader',{preferences:{interests:['Science']},
    socialTokens:Object.fromEntries([...sources,...excluded].map(source=>[source,'synthetic-'+source]))});
  app.seedUser(viewer);
  app.seedUser(member('other-capability-reader',{socialTokens:{youtube:'other-account'}}));
  let unsupportedCalls=0;
  for(const source of excluded) app.setFollowingFetcher(source,async()=>{unsupportedCalls++;throw Error('Unsupported Following adapter called');});
  const post=(id,source,seconds=1200)=>({id,source,sourceUrl:source==='youtube'?'https://www.youtube.com/watch?v=abcdefghijk':'https://example.invalid/posts/'+id,authorId:'followed-'+source,
    title:'A followed account update',content:'A synthetic fixture for audience isolation.',createdAt:new Date(Date.now()-60000).toISOString(),
    mediaType:'video',mediaUrl:'https://example.invalid/media/'+id+(source==='bluesky'?'.m3u8':'.mp4'),videoDurationSeconds:seconds,isExternal:true});
  for(const source of sources) app.setFollowingFetcher(source,async(_token,options)=>[
    post(`${options.userId}-${source}-long`,source),post(`${options.userId}-${source}-short`,source,120),
  ]);
  app.followingSourceCache.set('other-capability-reader::youtube',{fetchedAt:Date.now(),posts:[post('private-other-account','youtube')]});
  app.addAndBroadcast(excluded.map(source=>post('shared-public-'+source,source)));
  for(const route of ['/office/feed?mode=following&passive=1','/office/feed/videos/following?']) {
    const result=await app.request(route+'&limit=100',{userId:viewer.id});
    assert.equal(result.status,200);
    assert.deepEqual(new Set(result.data.posts.map(post=>post.source)),new Set(sources),JSON.stringify({response:result.data,errors:app.errors}));
    assert.ok(result.data.posts.every(post=>post.id.startsWith(viewer.id+'-')),'Only the current account\'s followed-content adapters may contribute');
    assert.ok(result.data.posts.every(post=>post.videoDurationSeconds===(route.includes('/videos/')?120:1200)),'Each followed post retains its correct feed/video placement');
    assert.deepEqual(result.data.sourceErrors,{});
    for(const selection of [...excluded.map(source=>'source='+source),'sources='+excluded.join(',')]) {
      const selected=await app.request(route+'&'+selection,{userId:viewer.id});
      assert.equal(selected.status,200,selection);
      assert.deepEqual(selected.data.posts,[],'Public sources and interest searches cannot become Following through manual source filters: '+selection);
      assert.deepEqual(selected.data.sourceErrors,{});
    }
  }
  assert.equal(unsupportedCalls,0);
  const other=await app.request('/office/feed?mode=following&passive=1&source=youtube',{userId:'other-capability-reader'});
  assert.equal(other.status,200);
  assert.deepEqual(other.data.posts.map(post=>post.id),['private-other-account']);
});
