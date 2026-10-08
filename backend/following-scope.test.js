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
  for (const source of ['medium', 'dribbble', 'threads', 'linkedin', 'discord', 'figma', 'weworkremotely', 'cntraveler', 'facebook', 'hackernews', 'hn', 'reuters', 'airbnb', 'unknown']) {
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
  assert.ok(HOME_FEED_SOURCE_IDS.includes('hackernews'));
  assert.equal(following.hackernews, undefined);
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
  assert.equal(following.twitter, 'following');
  assert.equal(following.facebook, undefined);
  assert.deepEqual(Object.keys(following).sort(), ['youtube','github','gitlab','reddit','twitch','bluesky','mastodon','twitter'].sort());
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

test('Following uses every supported personal adapter without shared public or other-account posts', async t => {
  const { createAppHarness, member } = require('./test-support/app-harness');
  const app=await createAppHarness(); t.after(()=>app.close());
  const sources=Object.keys(require('../shared/feed-source-catalog.json').following);
  const excluded=['weworkremotely','cntraveler','facebook'];
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

test('Hacker News public posts stay in Home for single and mixed sources and cannot enter Following', async t => {
  const { createAppHarness, member } = require('./test-support/app-harness');
  const publicRows=[], homeReads=[];
  const app=await createAppHarness({connected:true,query:async(sql,params)=>{
    if(!sql.includes('WITH c(source, before_ts, before_id)')) return {rows:[],rowCount:0};
    const sources=[...sql.matchAll(/\(\$(\d+), \$\d+::timestamptz, \$\d+::text\)/g)].map(match=>params[Number(match[1])-1]);
    homeReads.push(sources);
    const rows=publicRows.filter(row=>sources.includes(row.source));
    return {rows,rowCount:rows.length};
  }}); t.after(()=>app.close());
  const viewer=member('hn-scope-reader',{socialTokens:{hackernews:'unsupported-legacy-token',hn:'unsupported-alias-token',youtube:'followed-fixture'}});
  app.seedUser(viewer);
  const createdAt=new Date(Date.now()-60000).toISOString();
  const publicHn={id:'hn_87654321',source:'hackernews',groupId:'ext_hn',authorId:'hn_public-author',
    title:'A public Hacker News discussion',content:'An ordinary public story.',topic:'Science',createdAt,
    sourceUrl:'https://news.ycombinator.com/item?id=87654321',isExternal:true};
  const publicGitHub={...publicHn,id:'github_public_story',source:'github',groupId:'ext_github',
    sourceUrl:'https://github.com/example/project',authorId:'github_public-author'};
  publicRows.push(...[publicHn,publicGitHub].map(post=>({id:post.id,source:post.source,title:post.title,content:post.content,
    topic:post.topic,source_url:post.sourceUrl,author_name:'Public story author',post_created_at:post.createdAt})));
  assert.equal(app.addAndBroadcast([publicHn,publicGitHub]),2);
  for(const [selection,expected] of [
    ['source=hn',['hackernews']],['sources=hackernews',['hackernews']],['sources=hn,github',['hackernews','github']],
  ]) {
    const result=await app.request('/office/feed?mode=feed&sort=newest&passive=1&limit=20&'+selection,{userId:viewer.id});
    assert.equal(result.status,200,selection);
    assert.deepEqual(new Set(result.data.posts.map(post=>post.source)),new Set(expected),selection);
    assert.ok(result.data.posts.every(post=>['hn_87654321','github_public_story'].includes(post.id)));
  }
  assert.ok(homeReads.some(sources=>sources.includes('hackernews')&&sources.includes('github')),'Mixed Home selection enters the indexed read with canonical source IDs');
  let forbiddenCalls=0;
  for(const source of ['hackernews','hn']) {
    app.setFollowingFetcher(source,async()=>{forbiddenCalls++;throw Error('Hacker News has no connected Following adapter');});
    app.followingSourceCache.set(viewer.id+'::'+source,{fetchedAt:Date.now(),posts:[{...publicHn,matchedByInterest:true}]});
  }
  app.followingSourceCache.set(viewer.id+'::youtube',{fetchedAt:Date.now(),posts:[120,1200].map(seconds=>({
    ...publicHn,id:'youtube_followed_'+seconds,source:'youtube',groupId:'ext_youtube',authorId:'youtube_followed-author',
    sourceUrl:'https://www.youtube.com/watch?v=abcdefghijk',mediaType:'video',mediaUrl:'https://www.youtube.com/watch?v=abcdefghijk',videoDurationSeconds:seconds,
  }))});
  for(const route of ['/office/feed?mode=following&passive=1','/office/feed/videos/following?']) {
    for(const selection of ['source=hn','sources=hackernews','sources=hn,hackernews']) {
      const result=await app.request(route+'&'+selection,{userId:viewer.id});
      assert.equal(result.status,200,selection);
      assert.deepEqual(result.data.posts,[],selection+' cannot expose global or stale interest posts in Following');
      assert.deepEqual(result.data.sourceErrors,{});
    }
    for(const selection of ['sources=hn,youtube','sources=hackernews&sources=youtube']) {
      const result=await app.request(route+'&'+selection,{userId:viewer.id});
      assert.equal(result.status,200,selection);
      assert.ok(result.data.posts.length>0,selection+' retains the genuine followed source');
      assert.ok(result.data.posts.every(post=>post.source==='youtube'&&post.id.startsWith('youtube_followed_')));
      assert.deepEqual(result.data.sourceErrors,{});
    }
  }
  assert.equal(forbiddenCalls,0,'Neither the HN name nor its worker alias can start a personal Following fetch');
});
