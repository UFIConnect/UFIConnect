const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PGlite} = require('@electric-sql/pglite');
const {CREATOR_ANALYTICS_SCHEMA,createCreatorAnalytics,collectYouTube,count,period} = require('./creator-analytics');
const {analyzeActivity} = require('./activity-learning');
const A='a0000000-0000-4000-8000-000000000001', B='b0000000-0000-4000-8000-000000000002';
const now=Date.parse('2026-09-30T12:00:00Z');
async function fixture(t, options={}) {
  const pg = new PGlite(); t.after(()=>pg.close());
  await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY); CREATE TABLE community_posts(id TEXT PRIMARY KEY,author_id TEXT,source TEXT,likes TEXT[],created_at TIMESTAMPTZ);
    CREATE TABLE post_comments(id TEXT,post_id TEXT,author_id TEXT,created_at TIMESTAMPTZ);`);
  await pg.query('INSERT INTO users VALUES($1),($2)',[A,B]);
  for (const sql of CREATOR_ANALYTICS_SCHEMA) await pg.exec(sql);
  const users={[A]:{id:A,plan:'pro',socialTokens:{},createdAt:'2026-08-01'},[B]:{id:B,plan:'free',socialTokens:{}}};
  const db={isConnected:()=>true,query:(...args)=>pg.query(...args)};
  const service=createCreatorAnalytics({db,getUser:async id=>users[id],now:()=>now,env:{},...options});
  return {pg,users,db,service};
}
test('native metrics and copyright reports are account scoped, external metrics remain unknown',async t=>{
  const {pg,service}=await fixture(t);
  await pg.query(`INSERT INTO community_posts VALUES ('own',$1,'uficonnect',ARRAY['x','y'],'2026-09-29'),('other',$2,'uficonnect',ARRAY['z'],'2026-09-29'),('import',$1,'youtube',ARRAY['z'],'2026-09-29')`,[A,B]);
  await pg.query(`INSERT INTO post_comments VALUES('c','own',$1,'2026-09-29')`,[B]);
  const claim=await service.copyrightReport(A,{source:'youtube',sourceUrl:'https://www.youtube.com/watch?v=abcdefghijk',reason:'This is my work and I request review.'});
  const report=await service.report(A,7);
  assert.equal(report.uficonnect.posts,1);assert.equal(report.uficonnect.likesReceived,2);assert.equal(report.uficonnect.commentsReceived,1);
  assert.equal(report.copyright.reports[0].id,claim.id);assert.equal((await service.report(B,7)).copyright.reports.length,0);
  assert.ok(report.sources.length>=16);assert.ok(report.sources.every(source=>source.metrics.views===null));
  assert.equal(report.monetization.sourceRevenueAvailable,false);assert.equal(JSON.stringify(report).includes('socialTokens'),false);
  await assert.rejects(service.copyrightReport(A,{source:'youtube',sourceUrl:'https://evil.example/watch?v=abcdefghijk',reason:'A legitimate explanation.'}),error=>error.status===400);
});
test('source reports retain provenance, deny redirects and never manufacture metrics or revenue',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});
    if(url.includes('/channels?'))return Response.json({items:[{id:'UC'+'a'.repeat(22),statistics:{viewCount:'1800000',videoCount:'23'}}]});
    if(url.includes('estimatedRevenue'))return Response.json({columnHeaders:[{name:'estimatedRevenue'}],rows:[[12.34]]});
    return Response.json({columnHeaders:[{name:'comments'},{name:'views'},{name:'likes'}],rows:[[7,100,9]]});
  };
  const result=await collectYouTube({user:{socialTokens:{youtube:'private-token'}},days:7,now,fetchImpl,features:{creatorAnalytics:true,sourceMonetization:true}});
  assert.deepEqual(result.metrics,{views:1800000,likes:null,comments:null,posts:23});
  assert.deepEqual(result.periodMetrics,{views:100,likes:9,comments:7});assert.equal(result.revenue.amount,12.34);
  assert.equal(result.revenue.endDate,'2026-09-29');assert.ok(calls.every(call=>call.options.redirect==='error'));
  assert.ok(calls.every(call=>!call.url.includes('private-token')));assert.ok(!JSON.stringify(result).includes('private-token'));
  const noScope=await collectYouTube({user:{socialTokens:{youtube:'private-token'}},days:30,now,features:{creatorAnalytics:true,sourceMonetization:true},fetchImpl:async(url)=>url.includes('/channels?')?Response.json({items:[{id:'UC'+'b'.repeat(22),statistics:{videoCount:'0'}}]}):new Response('',{status:403})});
  assert.equal(noScope.metrics.views,null);assert.equal(noScope.metrics.posts,0);assert.equal(noScope.periodMetrics,null);assert.equal(noScope.revenue.amount,null);
});
test('snapshots disappear on disconnect, expire, and do not cross accounts',async t=>{
  let requests=0;
  const {service,users,pg}=await fixture(t,{fetchImpl:async url=>{requests++;return url.includes('/channels?')?Response.json({items:[{id:'UC'+'a'.repeat(22),statistics:{viewCount:'18',videoCount:'4'}}]}):new Response('',{status:403});}});
  users[A].socialTokens.youtube='secret';await service.refresh(A,30);
  assert.equal((await service.report(A,30)).sources.find(source=>source.id==='youtube').metrics.views,18);
  assert.equal((await service.report(B,30)).sources.find(source=>source.id==='youtube').metrics.views,null);
  await service.refresh(A,30);assert.equal(requests,3);
  delete users[A].socialTokens.youtube;
  assert.equal((await service.report(A,30)).sources.find(source=>source.id==='youtube').metrics.views,null);
  assert.equal((await pg.query('SELECT * FROM creator_source_snapshots')).rows.length,0);
});
test('audit omits secrets, retention prunes history, and account deletion cascades',async t=>{
  const {service,pg}=await fixture(t);
  await service.auditInteraction({memberId:A,interactionRequestId:'request-id',sourcePlatform:'youtube',sourcePostId:'abcdefghijk',actionType:'like',status:'succeeded',timestamp:'2026-09-29',token:'must-not-store',content:'private comment'});
  await service.auditInteraction({memberId:B,interactionRequestId:'old-request',sourcePlatform:'youtube',sourcePostId:'abcdefghijk',actionType:'like',status:'denied',timestamp:'2026-08-01'});
  await service.prune();const rows=(await pg.query('SELECT * FROM source_interaction_audit')).rows;
  assert.equal(rows.length,1);assert.ok(!JSON.stringify(rows).includes('must-not-store'));assert.ok(!JSON.stringify(rows).includes('private comment'));
  await pg.query('DELETE FROM users WHERE id=$1',[A]);assert.equal((await pg.query('SELECT * FROM source_interaction_audit')).rows.length,0);
});
test('runtime policy switches prevent collector calls and redact previously fetched metrics',async t=>{
  const env={};const urls=[];
  const {service,users}=await fixture(t,{env,fetchImpl:async url=>{urls.push(url);
    if(url.includes('/channels?'))return Response.json({items:[{id:'UC'+'a'.repeat(22),statistics:{viewCount:'1',videoCount:'2'}}]});
    return url.includes('estimatedRevenue')?Response.json({columnHeaders:[{name:'estimatedRevenue'}],rows:[[15]]}):Response.json({columnHeaders:[{name:'views'},{name:'likes'},{name:'comments'}],rows:[[1,2,3]]});
  }});
  users[A].socialTokens.youtube='secret';await service.refresh(A,7);assert.equal(urls.length,3);
  env.SOURCE_YOUTUBE_CREATOR_ANALYTICS_ENABLED='false';env.SOURCE_YOUTUBE_SOURCE_MONETIZATION_ENABLED='false';
  const youtube=(await service.report(A,7)).sources.find(source=>source.id==='youtube');
  assert.equal(youtube.periodMetrics,null);assert.equal(youtube.revenue.amount,null);
  urls.length=0;
  await collectYouTube({user:users[A],days:7,now,features:{},fetchImpl:async url=>{urls.push(url);return Response.json({items:[{id:'UC'+'a'.repeat(22),statistics:{viewCount:'1'}}]});}});
  assert.equal(urls.length,1);
});
test('storage failures and unknown counts are not presented as zero',async()=>{
  assert.equal(count(null),null);assert.equal(count(''),null);assert.equal(count('9007199254740993'),null);assert.equal(count('0'),0);
  assert.throws(()=>period('365'),error=>error.status===400);
  const service=createCreatorAnalytics({db:{isConnected:()=>false},getUser:async()=>({id:A}),env:{}});
  assert.equal((await service.report(A,30)).uficonnect.posts,null);
  await assert.rejects(service.copyrightReport(A,{source:'youtube',sourceUrl:'https://youtu.be/abcdefghijk',reason:'Please review this video.'}),error=>error.status===503);
});
test('durable request claims block concurrent duplicate writes and survive service restarts',async t=>{
  const {service,db,users}=await fixture(t);
  const claim={memberId:A,requestId:'one-action',fingerprint:'source + action + content'};
  const results=await Promise.all([service.reserveInteraction(claim),service.reserveInteraction(claim)]);
  assert.equal(results.filter(result=>result===null).length,1);
  assert.equal(results.find(Boolean).status,409);
  const result={status:200,body:{published:true,liked:true}};
  await service.completeInteraction({...claim,result});
  const restarted=createCreatorAnalytics({db,getUser:async id=>users[id],now:()=>now});
  assert.deepEqual(await restarted.reserveInteraction(claim),result);
  assert.equal((await restarted.reserveInteraction({...claim,fingerprint:'different content'})).status,409);
  assert.equal(await restarted.reserveInteraction({...claim,memberId:B}),null);
});
test('deep learning trains only on complete first-party aggregates and evaluates a held-out day',()=>{
  const daily=Array.from({length:30},(_,i)=>({day:new Date(now-(30-i)*86400000).toISOString().slice(0,10),posts:2+i%3,comments:4+i%2,actions:1+i%3}));
  assert.equal(analyzeActivity(daily,{now}).status,'disabled');
  assert.equal(analyzeActivity([],{enabled:true,now}).status,'insufficient_data');
  const result=analyzeActivity(daily,{enabled:true,now});assert.equal(result.status,'ready');assert.equal(result.evaluatedDay,'2026-09-29');assert.equal(result.trainedDays,29);
  assert.deepEqual(analyzeActivity(daily,{enabled:true,now}),result);
  const extraFields=daily.map(row=>({...row,sourceViews:999999,secret:'never-learn'}));assert.deepEqual(analyzeActivity(extraFields,{enabled:true,now}),result);
  daily[1].day=daily[0].day;assert.equal(analyzeActivity(daily,{enabled:true,now}).status,'insufficient_data');
});
