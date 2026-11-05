'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { BUSINESS_POST_SCHEMA, createBusinessPosts, normalizeDetails } = require('./business-posts');
const { REPORT_SCHEMA, reportSuppressionPredicate } = require('./content-reports');
const { nativeGroupVisibilityPredicate } = require('./community-post-visibility');
const { createJobPosts, registerJobPostRoutes, nativeJob } = require('./job-posts');
const { createJobPublishing } = require('./job-publishing');
const OWNER='a1000000-0000-4000-8000-000000000001',VIEWER='a1000000-0000-4000-8000-000000000002';
const details={title:'Accessibility engineer',company:'Example employer',location:'Remote',pay:'Published pay range',description:'Build accessible interfaces and review inclusive product design.',duties:'Review components\nImprove keyboard support',requirements:'Accessible web development',applyUrl:'https://example.invalid/careers/role'};
let pg;
before(async()=>{
 pg=new PGlite();
 await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY,name TEXT,joined_groups TEXT[] DEFAULT '{}');
 CREATE TABLE community_groups(id TEXT PRIMARY KEY,is_private BOOLEAN,created_by TEXT);
 CREATE TABLE community_posts(id TEXT PRIMARY KEY,author_id TEXT,author_name TEXT,group_id TEXT,title TEXT,content TEXT,source TEXT,source_label TEXT,url TEXT,likes TEXT[] DEFAULT '{}',created_at TIMESTAMPTZ DEFAULT NOW());
 CREATE TABLE post_comments(id TEXT,post_id TEXT); CREATE TABLE reports(id TEXT PRIMARY KEY);
 CREATE TABLE blocks(id TEXT PRIMARY KEY,blocker_id TEXT,blocked_id TEXT);`);
 for(const sql of [...BUSINESS_POST_SCHEMA,...REPORT_SCHEMA])await pg.exec(sql);
});
after(async()=>pg.close());
beforeEach(async()=>{
 await pg.exec('TRUNCATE users,community_posts,community_groups,post_comments,blocks,report_content_suppressions CASCADE');
 await pg.query('INSERT INTO users(id,name) VALUES($1,$2),($3,$4)',[OWNER,'Actual publisher',VIEWER,'Reader']);
 await pg.query("INSERT INTO community_groups(id,is_private,created_by) VALUES('ufi-general',false,NULL),('private-team',true,$1)",[OWNER]);
});
function fixture(options={}){
 const deliveries=[];
 const db={isConnected:()=>true,query:(sql,params)=>pg.query(sql,params)};
 const users=new Map([[OWNER,{id:OWNER,name:'Actual publisher',plan:'business',socialTokens:{linkedin:'synthetic-linkedin'}}],[VIEWER,{id:VIEWER,name:'Reader',plan:'free',socialTokens:{}}]]);
 const getUser=options.getUser|| (async id=>users.get(id));
 const jobPublishing=createJobPublishing({getUser,known:key=>['linkedin','reddit','discord','mastodon'].includes(key),ready:()=>true,
  capability:()=>({supported:true,allowedMedia:['text']}),publishTarget:options.external|| (async(_user,platform,payload)=>{
   deliveries.push({platform,...payload});return{status:'posted',postedUrl:'https://example.invalid/'+platform+'/receipt'};
  })});
 const publishing=createBusinessPosts({db,getUser,
  screenContent:async({content})=>({allowed:true,content}),loadJobs:async()=>[],
  publishNative:async(user,post)=>{deliveries.push('uficonnect');await pg.query("INSERT INTO community_posts(id,author_id,author_name,group_id,title,content,source,source_label) VALUES($1,$2,$3,'ufi-general',$4,$5,'uficonnect','Hiring')",[post.id,user.id,user.name,post.title,post.content]);await options.afterNative?.(users,user);return{status:'posted',postedUrl:'https://uficonnect.org/p/'+post.id};},
  publishLinkedIn:async()=>{deliveries.push('linkedin');throw Error('Business LinkedIn delivery is isolated from member Jobs.');},
  validateJobTargets:jobPublishing.validate,publishJobTarget:jobPublishing.publish,...options});
 const service=createJobPosts({db,businessPosts:publishing,visibilitySql:nativeGroupVisibilityPredicate('p','$1'),suppressionSql:reportSuppressionPredicate('p')});
 return{service,publishing,deliveries,db,users};
}
test('native publish preserves identified ownership, moderation and durable idempotency without external delivery',async()=>{
 const f=fixture(),input={requestId:randomUUID(),details,userId:VIEWER};
 const result=await f.service.create(OWNER,input);
 assert.equal(result.post.status,'published');assert.equal(result.job.source,'UFIConnect');assert.equal(result.job.org,'Example employer');
 assert.equal(result.job.author.id,OWNER);assert.equal(result.job.author.name,'Actual publisher');assert.equal(result.job.applyUrl,details.applyUrl);assert.equal(result.job.remote,true);
 assert.match(result.job.sourceUrl,/^https:\/\/uficonnect\.org\/opportunities\/bp_/);
 assert.deepEqual(f.deliveries,['uficonnect']);
 assert.equal((await f.service.create(OWNER,input)).job.id,result.job.id);assert.deepEqual(f.deliveries,['uficonnect']);
 const restarted=fixture();assert.equal((await restarted.service.get(VIEWER,result.job.id)).id,result.job.id,'Detail survives a fresh service instance');
 await assert.rejects(f.service.create(OWNER,{...input,details:{...details,title:'Changed opening'}}),{status:409});
});

test('personal members can publish native Jobs while all Business tools remain restricted',async()=>{
 const f=fixture(),input={requestId:randomUUID(),details,userId:OWNER,plan:'business'};
 const result=await f.service.create(VIEWER,input);
 assert.equal(result.job.authorId,VIEWER);assert.equal(result.job.author.name,'Reader');
 assert.deepEqual(result.post.targets.map(target=>target.platform),['uficonnect']);
 assert.deepEqual(f.deliveries,['uficonnect']);
 const restarted=fixture();
 assert.equal((await restarted.service.create(VIEWER,input)).job.id,result.job.id);
 assert.deepEqual(restarted.deliveries,[],'An account-local durable retry does not deliver again');
 for(const operation of [()=>f.publishing.create(VIEWER,input),()=>f.publishing.posts(VIEWER),()=>f.publishing.similar(VIEWER,result.post.id)]) {
  await assert.rejects(operation(),{status:403});
 }
 await assert.rejects(f.service.create('missing-member',input),{status:403});
 await assert.rejects(f.service.create(VIEWER,{...input,details:{...details,title:'Changed opening'}}),{status:409});
 assert.deepEqual(f.deliveries,['uficonnect']);
});

test('personal native publication remains screened, validated and reserved once under parallel retries',async()=>{
 const rejected=fixture({screenContent:async()=>({allowed:false,reason:'blocked'})});
 await assert.rejects(rejected.service.create(VIEWER,{requestId:randomUUID(),details}),{status:422});
 assert.deepEqual(rejected.deliveries,[]);
 const f=fixture(),input={requestId:randomUUID(),details};
 await assert.rejects(f.service.create(VIEWER,{...input,details:{...details,applyUrl:'javascript:alert(1)'}}),{status:400});
 const results=await Promise.all([f.service.create(VIEWER,input),f.service.create(VIEWER,input)]);
 assert.equal(results[0].post.id,results[1].post.id);assert.deepEqual(f.deliveries,['uficonnect']);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM business_posts WHERE user_id=$1',[VIEWER])).rows[0].count,1);
 const offline=fixture({db:{isConnected:()=>false,query:(sql,params)=>pg.query(sql,params)}});
 await assert.rejects(offline.service.create(VIEWER,{requestId:randomUUID(),details}),{status:503});
 assert.deepEqual(offline.deliveries,[]);
});

test('native-only Jobs retain their original durable request fingerprint',async()=>{
 const f=fixture(),input={requestId:randomUUID(),details};
 const result=await f.service.create(VIEWER,input);
 const oldFingerprint=createHash('sha256').update(JSON.stringify({details:normalizeDetails(details).details,targets:['uficonnect']})).digest('hex');
 const stored=(await pg.query('SELECT fingerprint FROM business_posts WHERE id=$1',[result.post.id])).rows[0];
 assert.equal(stored.fingerprint,oldFingerprint);
 assert.equal((await f.service.create(VIEWER,{...input,targets:['uficonnect'],publisherSettings:{}})).job.id,result.job.id);
 assert.deepEqual(f.deliveries,['uficonnect']);
});

test('member Jobs persist native first and retain it when another selected source fails',async()=>{
 const calls=[];
 const f=fixture({external:async(user,platform,payload)=>{
  calls.push({platform,userId:user.id,...payload});
  if(platform==='reddit')throw Error('Synthetic provider token must not be returned');
  return{status:'posted',postedUrl:'https://example.invalid/discord/receipt',destinationId:payload.settings.destinationId};
 }});
 f.users.set(VIEWER,{id:VIEWER,name:'Reader',plan:'pro',socialTokens:{discord:'synthetic-discord',reddit:'synthetic-reddit'}});
 const input={requestId:randomUUID(),details,targets:['discord','uficonnect','reddit'],publisherSettings:{discord:{title:' Hiring ',destinationId:' room '}}};
 const result=await f.service.create(VIEWER,input);
 assert.equal(result.job.authorId,VIEWER);assert.equal(result.post.status,'published');
 assert.deepEqual(result.post.targets.map(target=>[target.platform,target.status]),[['uficonnect','posted'],['discord','posted'],['reddit','unconfirmed']]);
 assert.equal(result.post.targets[2].deliveryUncertain,true);assert.doesNotMatch(result.post.targets[2].error,/Synthetic provider token/);
 assert.deepEqual(f.deliveries,['uficonnect']);
 assert.deepEqual(calls.map(call=>call.platform),['discord','reddit']);
 assert.ok(calls.every(call=>call.crossPostId===result.post.id&&call.userId===VIEWER));
 assert.equal(calls[0].settings.destinationId,'room');
 assert.equal((await f.service.get(OWNER,result.job.id)).id,result.job.id);
 assert.equal((await f.service.list(OWNER)).length,1);
});

test('unchanged source sharing status checks survive disconnects and downgrades without resending',async()=>{
 const f=fixture();
 f.users.set(VIEWER,{id:VIEWER,name:'Reader',plan:'pro',socialTokens:{discord:'synthetic-discord'}});
 const input={requestId:randomUUID(),details,targets:['discord'],publisherSettings:{discord:{destinationId:'room',title:'Hiring'}}};
 const published=await f.service.create(VIEWER,input);
 f.users.set(VIEWER,{id:VIEWER,name:'Reader',plan:'free',socialTokens:{}});
 const retry=await f.service.create(VIEWER,{...input,targets:['uficonnect','discord'],publisherSettings:{discord:{title:' Hiring ',destinationId:' room '}}});
 assert.deepEqual(retry.post.targets,published.post.targets);assert.equal(retry.job.id,published.job.id);
 assert.equal(f.deliveries.length,2);
 await assert.rejects(f.service.create(VIEWER,{...input,publisherSettings:{discord:{destinationId:'other-room',title:'Hiring'}}}),{status:409});
 await assert.rejects(f.service.create(VIEWER,{...input,targets:[]}),{status:409});
 await assert.rejects(f.service.create(OWNER,input),{status:403},'One owner cannot read another member request through a retry');
 assert.equal(f.deliveries.length,2);
});

test('parallel equivalent source requests deliver every selected destination at most once',async()=>{
 const f=fixture();
 f.users.set(VIEWER,{id:VIEWER,name:'Reader',plan:'pro',socialTokens:{discord:'synthetic-discord',reddit:'synthetic-reddit'}});
 const input={requestId:randomUUID(),details,targets:['reddit','discord'],publisherSettings:{discord:{title:'Hiring',destinationId:'room'}}};
 const reordered={...input,targets:['discord','uficonnect','reddit'],publisherSettings:{discord:{destinationId:'room',title:'Hiring'}}};
 const results=await Promise.all([f.service.create(VIEWER,input),f.service.create(VIEWER,reordered)]);
 assert.equal(results[0].post.id,results[1].post.id);
 assert.equal(f.deliveries.filter(call=>call==='uficonnect').length,1);
 assert.deepEqual(f.deliveries.filter(call=>typeof call==='object').map(call=>call.platform).sort(),['discord','reddit']);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM business_posts WHERE user_id=$1',[VIEWER])).rows[0].count,1);
});

test('a native listing remains visible while an external source is pending and status reads cannot resend',async()=>{
 let entered,release;
 const enteredProvider=new Promise(resolve=>{entered=resolve;}),pendingProvider=new Promise(resolve=>{release=resolve;});
 let externalCalls=0;
 const f=fixture({external:async()=>{externalCalls++;entered();await pendingProvider;return{status:'posted',postedUrl:'https://example.invalid/shared-job'};}});
 f.users.set(VIEWER,{id:VIEWER,name:'Reader',plan:'pro',socialTokens:{discord:'synthetic-discord'}});
 const input={requestId:randomUUID(),details,targets:['discord'],publisherSettings:{discord:{destinationId:'room'}}};
 const original=f.service.create(VIEWER,input);
 try {
  await enteredProvider;
  const status=await f.service.create(VIEWER,input);
  assert.ok(status.job);assert.equal(status.post.status,'published');
  assert.deepEqual(status.post.targets.map(target=>[target.platform,target.status]),[['uficonnect','posted'],['discord','processing']]);
  assert.equal((await f.service.list(OWNER)).filter(job=>job.id===status.job.id).length,1);
  assert.equal((await f.service.get(OWNER,status.job.id)).id,status.job.id);
  assert.equal(externalCalls,1);assert.deepEqual(f.deliveries,['uficonnect']);
 } finally { release(); }
 const completed=await original;
 assert.deepEqual(completed.post.targets.map(target=>[target.platform,target.status]),[['uficonnect','posted'],['discord','posted']]);
 assert.equal(externalCalls,1);
 assert.equal((await f.service.create(VIEWER,input)).job.id,completed.job.id);
 assert.equal(externalCalls,1);
});

test('a progress-storage outage stops later sources while retaining the durable native listing',async()=>{
 let updates=0;
 const external=[];
 const f=fixture({db:{isConnected:()=>true,query:async(sql,params)=>{
  if(sql.startsWith('UPDATE business_posts SET targets=')&&++updates===2)throw Error('Synthetic progress storage unavailable');
  return pg.query(sql,params);
 }},external:async(_user,platform)=>{external.push(platform);return{status:'posted',postedUrl:'https://example.invalid/'+platform};}});
 f.users.set(VIEWER,{id:VIEWER,name:'Reader',plan:'pro',socialTokens:{discord:'synthetic-discord',reddit:'synthetic-reddit'}});
 const input={requestId:randomUUID(),details,targets:['discord','reddit']};
 await assert.rejects(f.service.create(VIEWER,input),/Synthetic progress storage unavailable/);
 const status=await f.service.create(VIEWER,input);
 assert.ok(status.job);assert.equal(status.post.status,'published');
 assert.deepEqual(status.post.targets.map(target=>[target.platform,target.status]),[['uficonnect','posted'],['discord','processing'],['reddit','processing']]);
 assert.deepEqual(external,['discord'],'A source without a durable receipt is not retried, and later sources are stopped');
 assert.deepEqual(f.deliveries,['uficonnect']);
});

test('new unauthorized source requests cannot forge membership or send any publication',async()=>{
 const f=fixture(),input={requestId:randomUUID(),details,targets:['linkedin'],plan:'business',userId:OWNER};
 await assert.rejects(f.service.create(VIEWER,input),{status:403});
 await assert.rejects(f.service.create(OWNER,{...input,targets:['reddit']}),{status:403});
 f.users.set(VIEWER,{id:VIEWER,name:'Reader',plan:'pro',socialTokens:{}});
 await assert.rejects(f.service.create(VIEWER,input),{status:409});
 await assert.rejects(f.service.create(VIEWER,{...input,targets:['indeed']}),{status:400});
 assert.deepEqual(f.deliveries,[]);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS count FROM business_posts')).rows[0].count,0);
});

test('native failures and unconfirmed results skip every external source',async()=>{
 for(const status of ['failed','unconfirmed']){
  const external=[];
  const f=fixture({publishNative:async()=>({status}),external:async(...args)=>{external.push(args);return{status:'posted'};}});
  const result=await f.service.create(OWNER,{requestId:randomUUID(),details,targets:['linkedin']});
  assert.equal(result.job,null);assert.equal(result.post.status,'failed');
  assert.deepEqual(result.post.targets.map(target=>[target.platform,target.status]),[['uficonnect',status],['linkedin','skipped']]);
  assert.deepEqual(external,[]);
 }
});

test('a plan, connection or account change during native delivery stops subsequent source sends',async()=>{
 for(const replacement of [
  {id:VIEWER,name:'Reader',plan:'free',socialTokens:{discord:'synthetic-original'}},
  {id:VIEWER,name:'Reader',plan:'pro',socialTokens:{}},
  {id:VIEWER,name:'Reader',plan:'pro',socialTokens:{discord:'synthetic-different-account'}},
 ]){
  const external=[];
  const f=fixture({afterNative:async users=>{Object.assign(users.get(VIEWER),replacement);},external:async(...args)=>{external.push(args);return{status:'posted'};}});
  f.users.set(VIEWER,{id:VIEWER,name:'Reader',plan:'pro',socialTokens:{discord:'synthetic-original'}});
  const result=await f.service.create(VIEWER,{requestId:randomUUID(),details,targets:['discord']});
  assert.ok(result.job);assert.equal(result.post.status,'published');assert.equal(result.post.targets[1].status,'failed');
  assert.deepEqual(external,[]);assert.equal(result.post.targets[1].deliveryUncertain,undefined);
 }
});

test('a renewed token for the same verified actor does not change the selected publishing account',async()=>{
 const token=accessToken=>JSON.stringify({origin:'https://social.example.invalid',accountId:'123',accessToken});
 const f=fixture({afterNative:async users=>{users.get(VIEWER).socialTokens.mastodon=token('synthetic-renewed');}});
 f.users.set(VIEWER,{id:VIEWER,name:'Reader',plan:'pro',socialTokens:{mastodon:token('synthetic-original')}});
 const result=await f.service.create(VIEWER,{requestId:randomUUID(),details,targets:['mastodon']});
 assert.ok(result.job);assert.equal(result.post.targets[1].status,'posted');assert.equal(f.deliveries.length,2);
 assert.equal(f.deliveries[1].authorizationIdentity,undefined,'Provider callbacks do not receive the internal authorization snapshot');
 const stored=(await pg.query('SELECT details,targets FROM business_posts WHERE id=$1',[result.post.id])).rows[0];
 assert.doesNotMatch(JSON.stringify(stored),/synthetic-original|synthetic-renewed|authorizationIdentity/);
});
test('drafts, unconfirmed native deliveries and LinkedIn-only publications never enter Jobs',async()=>{
 const f=fixture();
 await f.publishing.create(OWNER,{requestId:randomUUID(),details,targets:[]});
 const pending=fixture({publishNative:async()=>({status:'unconfirmed'})});
 assert.equal((await pending.service.create(OWNER,{requestId:randomUUID(),details})).job,null);
 const good=await f.service.create(OWNER,{requestId:randomUUID(),details});
 await pg.query("UPDATE business_posts SET targets='[{\"platform\":\"linkedin\",\"status\":\"posted\"}]'::jsonb WHERE id=$1",[good.post.id]);
 assert.deepEqual(await f.service.list(VIEWER),[]);await assert.rejects(f.service.get(VIEWER,good.post.id),{status:404});
});
test('suppressed, private, orphaned and blocked listings cannot leak through list or durable detail',async()=>{
 const f=fixture(),ids=[];
 for(let i=0;i<5;i++)ids.push((await f.service.create(OWNER,{requestId:randomUUID(),details:{...details,title:'Engineer '+i}})).job.id);
 await pg.query("INSERT INTO report_content_suppressions(target_type,target_id,source,kind) VALUES('post',$1,'uficonnect','native_post')",[ids[1]]);
 await pg.query("UPDATE community_posts SET group_id='private-team' WHERE id=$1",[ids[2]]);
 await pg.query("UPDATE community_posts SET group_id='missing-group' WHERE id=$1",[ids[3]]);
 await pg.query("UPDATE community_posts SET source='linkedin' WHERE id=$1",[ids[4]]);
 assert.deepEqual((await f.service.list(VIEWER)).map(v=>v.id),[ids[0]]);
 for(const id of ids.slice(1))await assert.rejects(f.service.get(VIEWER,id),{status:404});
 await assert.rejects(f.service.get(OWNER,ids[2]),{status:404},'A private-group owner cannot expose that post through public Jobs');
 await pg.query("INSERT INTO blocks VALUES('block',$1,$2)",[VIEWER,OWNER]);
 assert.deepEqual(await f.service.list(VIEWER),[]);await assert.rejects(f.service.get(VIEWER,ids[0]),{status:404});
});
test('screening and database failures fail closed before any native delivery',async()=>{
 const f=fixture({screenContent:async()=>({allowed:false,reason:'blocked'})});
 await assert.rejects(f.service.create(OWNER,{requestId:randomUUID(),details}),{status:422});assert.deepEqual(f.deliveries,[]);
 const offline=createJobPosts({db:{isConnected:()=>false},businessPosts:f.publishing,visibilitySql:'true',suppressionSql:'true'});
 await assert.rejects(offline.list(VIEWER),{status:503});await assert.rejects(offline.get(VIEWER,'bp_fixture'),{status:503});
 const mapped=nativeJob({id:'bp_fixture',details:{applyUrl:'javascript:alert(1)',location:'Not remote'},author_id:OWNER,author_name:'Publisher',content:'A role.'});
 assert.equal(mapped.applyUrl,null);assert.equal(mapped.remote,false);
});
test('HTTP routes require authentication and use authenticated ownership',async t=>{
 const f=fixture(),app=express();app.use(express.json());let rateChecks=0;
 registerJobPostRoutes(app,{service:f.service,authenticate:(req,res,next)=>{const id=req.get('x-fixture-user');if(![OWNER,VIEWER].includes(id))return res.status(401).json({message:'Sign in'});req.user={id};next();},limiter:(_req,_res,next)=>{rateChecks++;next();}});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
 const post=(user,body)=>fetch(base+'/jobs/posts',{method:'POST',headers:{'content-type':'application/json',...(user?{'x-fixture-user':user}:{})},body:JSON.stringify(body)});
 const input={requestId:randomUUID(),details,userId:OWNER};
 assert.equal((await post(null,input)).status,401);
 assert.equal((await post(VIEWER,{...input,targets:['linkedin'],plan:'business'})).status,403);
 assert.equal((await post(OWNER,{...input,targets:['reddit']})).status,403);
 const personal=await post(VIEWER,input);assert.equal(personal.status,200);assert.equal((await personal.json()).job.authorId,VIEWER);
 const created=await post(OWNER,input);assert.equal(created.status,200);const result=await created.json();assert.deepEqual(f.deliveries,['uficonnect','uficonnect']);assert.equal(rateChecks,4);
 f.users.set(VIEWER,{id:VIEWER,name:'Reader',plan:'pro',socialTokens:{discord:'synthetic-discord'}});
 const shared=await post(VIEWER,{...input,requestId:randomUUID(),targets:['discord'],publisherSettings:{discord:{destinationId:'room'}}});
 assert.equal(shared.status,200);const sharedResult=await shared.json();assert.equal(sharedResult.job.authorId,VIEWER);
 assert.deepEqual(sharedResult.post.targets.map(target=>target.platform),['uficonnect','discord']);
 assert.equal(f.deliveries.at(-1).settings.destinationId,'room');
 const detail=await fetch(base+'/opportunities/'+result.job.id,{headers:{'x-fixture-user':VIEWER}});assert.equal(detail.status,200);assert.match(detail.headers.get('cache-control'),/private, no-store/);assert.equal((await detail.json()).job.authorId,OWNER);
 assert.equal((await fetch(base+'/opportunities/'+result.job.id)).status,401);
});
