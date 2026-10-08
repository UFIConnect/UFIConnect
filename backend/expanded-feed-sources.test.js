'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createExpandedFeedSources} = require('./expanded-feed-sources');
const {createAppHarness, member} = require('./test-support/app-harness');
const directory = require('./account-directory.json');
test('external account directory is available without inventing connections, with Business restricted to careers', async t=>{
 const app=await createAppHarness();t.after(()=>app.close());
 app.seedUser(member('catalog-reader',{socialTokens:{weworkremotely:'legacy-not-an-authorization'}}));
 app.seedUser(member('catalog-business',{plan:'business'}));
 const general=await app.request('/social/platforms',{userId:'catalog-reader'});
 assert.equal(general.status,200);
 for(const [key,entry] of Object.entries(directory)) {
  assert.equal(general.data.platforms[key].connectionMode,'external');
  assert.equal(general.data.platforms[key].loginUrl,entry.loginUrl);
  assert.equal(general.data.platforms[key].crossPost.supported,false);
  assert.equal(general.data.connected[key],false);
  assert.equal(new URL(entry.loginUrl || entry.siteUrl).protocol,'https:');
 }
 const business=await app.request('/social/platforms',{userId:'catalog-business'});
 assert.equal(business.data.careerOnly,true);
 assert.equal(Object.keys(business.data.platforms).length,22);
 assert.ok(Object.entries(business.data.platforms).every(([key,entry])=>key==='linkedin'||entry.category==='career'));
 assert.equal(business.data.platforms.linkedin.crossPost.supported,true);
 assert.equal(business.data.platforms.airbnb,undefined);
 const connect=await app.request('/social/connect/weworkremotely',{userId:'catalog-reader',method:'POST',body:{}});
 assert.notEqual(connect.status,200,'Website sign-in cannot create a mock account authorization');
});

test('jobs retain full descriptions, posting dates and canonical source attribution',async t=>{
 const app=await createAppHarness();t.after(()=>app.close());
 let calls=0;
 const body='<p>Role description</p><ul><li>Own the release process</li><li>Work with the team</li></ul>'+'<p>Detailed requirements</p>'.repeat(200);
 const xml='<rss><channel><item><title>Engineer</title><link>https://weworkremotely.com/remote-jobs/test-engineer</link><description><![CDATA['+body+']]></description><pubDate>Sun, 15 Jun 2025 15:06:40 GMT</pubDate></item></channel></rss>';
 const sources=createExpandedFeedSources({fetchText:async()=>{calls++;return xml;},parseRSSItems:app.parseRSSItems,rssPost:app.rssPost});
 const [first,second]=await Promise.all([sources.weworkremotely(),sources.weworkremotely()]);
 assert.equal(calls,1);assert.deepEqual(first,second);assert.equal(first.length,1);
 const post=app.trimPostContent(app.normalizeFeedPost(first[0]));
 assert.ok(post.content.length>2000);assert.match(post.content,/- Own the release process/);
 assert.equal(post.sourceLabel,'We Work Remotely');assert.equal(post.sourceUrl,'https://weworkremotely.com/remote-jobs/test-engineer');
 assert.equal(post.createdAt,'2025-06-15T15:06:40.000Z');assert.equal(post.group.category,'Opportunities');
});

test('provider failures remain retryable and successful inventory is cached for one hour',async()=>{
 let now=0,calls=0;
 const sources=createExpandedFeedSources({now:()=>now,fetchText:async()=>{calls++;if(calls===1)throw Error('temporary outage');return '<rss><channel/></rss>';},parseRSSItems:()=>[],rssPost:()=>{throw Error('No items expected');}});
 await assert.rejects(sources.weworkremotely(),/temporary/);
 await sources.weworkremotely();await sources.weworkremotely();assert.equal(calls,2);
 now=3600001;await sources.weworkremotely();assert.equal(calls,3);
});

test('travel RSS preserves attribution and media with a short excerpt; HTML errors are rejected',async t=>{
 const app=await createAppHarness();t.after(()=>app.close());
 const sources=createExpandedFeedSources({fetchText:async()=>'<rss><channel/></rss>',parseRSSItems:()=>[{title:'A travel guide',link:'https://www.cntraveler.com/story/travel-guide',desc:'Travel details '.repeat(100),image:'https://media.cntraveler.com/photos/guide.jpg'}],rssPost:app.rssPost});
 const posts=await sources.cntraveler();
 assert.equal(posts[0].source,'cntraveler');assert.equal(posts[0].sourceLabel,'Condé Nast Traveler');
 assert.equal(posts[0].topic,'Travel');assert.equal(posts[0].group.category,'Travel');assert.ok(posts[0].content.length<=500);
 assert.equal(posts[0].mediaUrl,'https://media.cntraveler.com/photos/guide.jpg');
 const bad=createExpandedFeedSources({fetchText:async()=>'<html>Access denied</html>'});
 await assert.rejects(bad.weworkremotely(),/invalid feed/);
});
