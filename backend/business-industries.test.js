'use strict';
const { test,before,after,beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { BUSINESS_INDUSTRY_SCHEMA,catalog,safeHttps,createBusinessIndustries } = require('./business-industries');
const OWNER='a0000000-0000-4000-8000-000000000001', MEMBER='a0000000-0000-4000-8000-000000000002', OTHER='a0000000-0000-4000-8000-000000000003', FREE='a0000000-0000-4000-8000-000000000004';
let pg;
before(async()=>{pg=new PGlite();await pg.exec("CREATE TABLE users(id UUID PRIMARY KEY,name TEXT DEFAULT 'Team member',plan TEXT,account_type TEXT,billing_closed BOOLEAN DEFAULT false)");for(const sql of BUSINESS_INDUSTRY_SCHEMA)await pg.exec(sql);});
after(async()=>pg.close());
beforeEach(async()=>{await pg.exec('TRUNCATE users CASCADE');await pg.query('INSERT INTO users(id,plan,account_type) VALUES($1,\'business\',\'business\'),($2,\'free\',\'business\'),($3,\'business\',\'business\'),($4,\'free\',\'personal\')',[OWNER,MEMBER,OTHER,FREE]);});
function fixture(options={}){
  const calls=[];let active=true,connected=true;
  const service=createBusinessIndustries({db:{isConnected:()=>connected,query:(...args)=>pg.query(...args)},
    getUser:async id=>({id,name:'Signed-in member',plan:'business',socialTokens:{linkedin:'PRIVATE_TOKEN'}}),
    getMembership:async id=>id===MEMBER?{ownerId:OWNER,active}:null,
    screenContent:async({content})=>({allowed:true,content}),
    publishNative:async(user,post)=>{calls.push({platform:'uficonnect',user:user.id,post});return{status:'posted',postedUrl:'https://uficonnect.org/p/'+post.id};},
    publishLinkedIn:async(user,post)=>{calls.push({platform:'linkedin',user:user.id,post});return{status:'posted',postedUrl:'https://www.linkedin.com/feed/update/test',accessToken:'PRIVATE_TOKEN'};},
    validatePhoto:url=>url==='https://res.cloudinary.com/ufi/image/upload/crossposts/test.jpg',...options});
  return{service,calls,revoke(){active=false;},offline(){connected=false;}};
}
const space=async service=>(await service.save(OWNER,{industryId:'technology',name:'Product team',sourceIds:['github']})).workspace;
const input=(targets=[])=>({requestId:randomUUID(),title:'Product update',content:'Our team has completed a new product release for our customers.',targets,publicConfirmed:targets.includes('uficonnect')});

test('catalog has 12 distinct industries and 24 fixed HTTPS resources without publishing claims',()=>{
  assert.equal(catalog.length,12);assert.equal(new Set(catalog.map(item=>item.id)).size,12);
  for(const industry of catalog){assert.equal(industry.sources.length,2);for(const source of industry.sources){assert.ok(safeHttps(source.url));assert.equal(source.kind,'resource');assert.equal(source.publishing,false);assert.ok(source.id);}}
  for(const url of ['javascript:alert(1)','http://example.org','https://user:secret@example.org','https:\\example.org','https://example.org/\nfoo'])assert.equal(safeHttps(url),null);
});
test('owner persists separate industry preferences and teammates cannot change organization settings',async()=>{
  const {service}=fixture();const current=await space(service);
  const saved=await fixture().service.list(MEMBER);assert.equal(saved.canManage,false);assert.deepEqual(saved.workspaces[0].sourceIds,['github']);
  assert.equal((await service.list(OTHER)).workspaces.length,0);
  await assert.rejects(service.save(MEMBER,{industryId:'technology',name:'Hijack',sourceIds:[]}),{status:403});
  const updated=(await service.save(OWNER,{industryId:'technology',name:'Renamed',sourceIds:['stackoverflow']})).workspace;
  assert.equal(updated.id,current.id);assert.deepEqual(updated.sourceIds,['stackoverflow']);
  await service.save(OWNER,{industryId:'healthcare',name:'Health research',sourceIds:['nih']});assert.equal((await service.list(OWNER)).workspaces.length,2);
  await assert.rejects(service.save(OWNER,{industryId:'healthcare',name:'Health',sourceIds:['github']}),{status:400});
  await assert.rejects(service.save(OWNER,{industryId:'technology',name:'Team',sourceIds:[],ownerId:OTHER}),{status:400});
});
test('membership cancellation, seat revocation and storage failure remove access immediately',async()=>{
  const f=fixture(),current=await space(f.service);await f.service.list(MEMBER);f.revoke();
  await assert.rejects(f.service.posts(MEMBER,current.id),{status:403});await assert.rejects(f.service.list(FREE),{status:403});
  await pg.query('UPDATE users SET billing_closed=true WHERE id=$1',[OWNER]);await assert.rejects(f.service.list(OWNER),{status:403});
  f.offline();await assert.rejects(f.service.list(OWNER),{status:503});
});

test('an explicit personal account cannot enter through a contradictory paid plan or team membership',async()=>{
  const {service}=fixture();await space(service);
  await pg.query("UPDATE users SET account_type='personal' WHERE id=ANY($1::uuid[])",[[OWNER,MEMBER]]);
  await assert.rejects(service.list(OWNER),{status:403});await assert.rejects(service.list(MEMBER),{status:403});
});
test('space authorization blocks cross-organization reads and publishing even with a valid post ID',async()=>{
  const {service,calls}=fixture(),current=await space(service);
  await assert.rejects(service.posts(OTHER,current.id),{status:404});
  await assert.rejects(service.createPost(OTHER,current.id,input(['uficonnect'])),{status:404});assert.deepEqual(calls,[]);
});
test('native publication requires explicit public consent and uses the actual signed-in author',async()=>{
  const {service,calls}=fixture(),current=await space(service),request=input(['uficonnect','linkedin']);
  await assert.rejects(service.createPost(MEMBER,current.id,{...request,publicConfirmed:false}),{status:400});
  await assert.rejects(service.createPost(MEMBER,current.id,{...request,authorId:OWNER}),{status:400});
  const result=await service.createPost(MEMBER,current.id,request);assert.equal(result.status,'published');assert.equal(result.authorId,MEMBER);
  assert.deepEqual(calls.map(call=>call.user),[MEMBER,MEMBER]);assert.equal(JSON.stringify(result).includes('PRIVATE_TOKEN'),false);
  assert.equal((await service.posts(OWNER,current.id)).posts[0].id,result.id);
});
test('durable reservations prevent duplicate external posts on concurrent requests and retries',async()=>{
  const {service,calls}=fixture(),current=await space(service),request=input(['linkedin']);
  const results=await Promise.all([service.createPost(OWNER,current.id,request),service.createPost(OWNER,current.id,request)]);
  assert.equal(results[0].id,results[1].id);assert.equal(calls.length,1);await service.createPost(OWNER,current.id,request);assert.equal(calls.length,1);
  await assert.rejects(service.createPost(OWNER,current.id,{...request,title:'Changed title'}),{status:409});
});
test('drafts are private to the author, survive service reload, and history paginates',async()=>{
  const {service,calls}=fixture(),current=await space(service);await service.createPost(MEMBER,current.id,input());
  assert.equal((await service.posts(OWNER,current.id)).posts.length,0);
  assert.equal((await fixture().service.posts(MEMBER,current.id)).posts[0].status,'draft');assert.deepEqual(calls,[]);
  for(let i=0;i<13;i++)await service.createPost(OWNER,current.id,input());
  const first=await service.posts(OWNER,current.id);assert.equal(first.posts.length,12);assert.equal(first.hasMore,true);
  const second=await service.posts(OWNER,current.id,{page:2});assert.equal(second.posts.length,1);assert.equal(second.hasMore,false);
  assert.equal(new Set([...first.posts,...second.posts].map(post=>post.id)).size,13);
});
test('screening, unsupported sources, missing connections and invalid media cannot publish',async()=>{
  const f=fixture(),current=await space(f.service);
  await assert.rejects(f.service.createPost(OWNER,current.id,input(['github'])),{status:400});
  await assert.rejects(f.service.createPost(OWNER,current.id,{...input(),mediaUrl:'https://example.org/image.jpg'}),{status:400});
  const blocked=fixture({screenContent:async()=>({allowed:false,reason:'screening_unavailable'})});
  await assert.rejects(blocked.service.createPost(OWNER,current.id,input(['linkedin'])),{status:503});assert.deepEqual(blocked.calls,[]);
  const unconnected=fixture({getUser:async id=>({id})});await assert.rejects(unconnected.service.createPost(OWNER,current.id,input(['linkedin'])),{status:400});
  assert.deepEqual(f.calls,[]);
});
test('unknown delivery outcomes remain unconfirmed and safe retries never publish another copy',async()=>{
  let attempts=0;const f=fixture({publishLinkedIn:async()=>{attempts++;throw Error('SECRET_REMOTE_ERROR');}}),current=await space(f.service),request=input(['linkedin']);
  const post=await f.service.createPost(OWNER,current.id,request);assert.equal(post.status,'unconfirmed');assert.equal(post.targets[0].status,'unconfirmed');
  assert.equal(JSON.stringify(post).includes('SECRET_REMOTE_ERROR'),false);await f.service.createPost(OWNER,current.id,request);assert.equal(attempts,1);
});
test('privacy deletion cascades owned spaces and authored records without removing another owner’s space',async()=>{
  const {service}=fixture(),current=await space(service);await service.createPost(MEMBER,current.id,input());
  const other=(await service.save(OTHER,{industryId:'technology',name:'Other company',sourceIds:[]})).workspace;
  await pg.query('DELETE FROM users WHERE id=$1',[MEMBER]);assert.equal((await pg.query('SELECT * FROM business_industry_posts')).rows.length,0);
  await service.createPost(OWNER,current.id,input());await pg.query('DELETE FROM users WHERE id=$1',[OWNER]);
  assert.equal((await pg.query('SELECT * FROM business_industry_posts')).rows.length,0);
  assert.deepEqual((await pg.query('SELECT id FROM business_industry_workspaces')).rows.map(row=>row.id),[other.id]);
});

test('authors edit and delete a saved draft in place with version checks',async()=>{
  const {service,calls}=fixture(),current=await space(service),draft=await service.createPost(MEMBER,current.id,input());
  const update={version:draft.version,title:'Updated draft',content:'A changed private update that remains in this saved draft.',mediaUrl:''};
  const edited=await service.updateDraft(MEMBER,current.id,draft.id,update);
  assert.equal(edited.id,draft.id);assert.equal(edited.version,draft.version+1);assert.equal(edited.canEdit,true);
  assert.equal((await service.posts(MEMBER,current.id,{status:'draft'})).posts.length,1);assert.deepEqual(calls,[]);
  await assert.rejects(service.updateDraft(MEMBER,current.id,draft.id,update),{status:409});
  await assert.rejects(service.updateDraft(OWNER,current.id,draft.id,{...update,version:edited.version}),{status:404});
  await assert.rejects(service.deleteDraft(OWNER,current.id,draft.id,{version:edited.version}),{status:404});
  await assert.rejects(service.deleteDraft(MEMBER,current.id,draft.id,{version:draft.version}),{status:409});
  assert.equal((await service.deleteDraft(MEMBER,current.id,draft.id,{version:edited.version})).deleted,true);
  assert.equal((await service.posts(MEMBER,current.id)).posts.length,0);
});

test('publishing a saved draft keeps its record and prevents duplicate delivery on concurrent or lost responses',async()=>{
  const {service,calls}=fixture(),current=await space(service),draft=await service.createPost(MEMBER,current.id,input());
  const publish={version:draft.version,requestId:randomUUID(),targets:['uficonnect','linkedin'],publicConfirmed:true};
  await assert.rejects(service.publishDraft(OWNER,current.id,draft.id,publish),{status:404});
  const results=await Promise.all([service.publishDraft(MEMBER,current.id,draft.id,publish),service.publishDraft(MEMBER,current.id,draft.id,publish)]);
  assert.ok(results.every(row=>row.id===draft.id));assert.equal(calls.length,2);
  const retry=await service.publishDraft(MEMBER,current.id,draft.id,publish);
  assert.equal(retry.status,'published');assert.equal(retry.canEdit,false);assert.equal(calls.length,2);
  assert.equal((await service.posts(MEMBER,current.id)).posts.length,1);
  assert.equal((await service.posts(MEMBER,current.id,{status:'draft'})).posts.length,0);
  await assert.rejects(service.publishDraft(MEMBER,current.id,draft.id,{...publish,requestId:randomUUID()}),{status:409});
  await assert.rejects(service.deleteDraft(MEMBER,current.id,draft.id,{version:retry.version}),{status:409});
});

test('archiving preserves history, stops new changes, and only the owner can restore the same space',async()=>{
  const {service,calls}=fixture(),current=await space(service),draft=await service.createPost(MEMBER,current.id,input());
  await assert.rejects(service.setArchived(MEMBER,current.id,{archived:true}),{status:403});
  const archived=(await service.setArchived(OWNER,current.id,{archived:true})).workspace;assert.ok(archived.archivedAt);
  assert.equal((await service.posts(MEMBER,current.id)).posts[0].id,draft.id);
  await assert.rejects(service.createPost(OWNER,current.id,input(['uficonnect'])),{status:409});
  await assert.rejects(service.save(OWNER,{industryId:'technology',name:'Replacement',sourceIds:[]}),{status:409});
  await assert.rejects(service.updateDraft(MEMBER,current.id,draft.id,{version:draft.version,title:draft.title,content:'This draft cannot change until its space has been restored.'}),{status:409});
  await assert.rejects(service.publishDraft(MEMBER,current.id,draft.id,{version:draft.version,requestId:randomUUID(),targets:['uficonnect'],publicConfirmed:true}),{status:409});
  assert.deepEqual(calls,[]);
  const restored=(await service.setArchived(OWNER,current.id,{archived:false})).workspace;
  assert.equal(restored.id,current.id);assert.equal(restored.archivedAt,null);assert.deepEqual(restored.sourceIds,['github']);
  await service.publishDraft(MEMBER,current.id,draft.id,{version:draft.version,requestId:randomUUID(),targets:['uficonnect'],publicConfirmed:true});assert.equal(calls.length,1);
});

test('draft publication races with editing and archiving never send an outdated or newly archived post',async()=>{
  const setup=fixture(),current=await space(setup.service),draft=await setup.service.createPost(MEMBER,current.id,input());
  let release,started;const pending=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
  const f=fixture({screenContent:async({content})=>{started();await pending;return{allowed:true,content};}});
  const publication=f.service.publishDraft(MEMBER,current.id,draft.id,{version:draft.version,requestId:randomUUID(),targets:['uficonnect'],publicConfirmed:true});
  await entered;
  await setup.service.updateDraft(MEMBER,current.id,draft.id,{version:draft.version,title:'New version',content:'A newer draft saved while moderation of the prior version was pending.'});
  release();await assert.rejects(publication,{status:409});assert.deepEqual(f.calls,[]);
  const archivedFixture=fixture({screenContent:async({content})=>{await setup.service.setArchived(OWNER,current.id,{archived:true});return{allowed:true,content};}});
  await assert.rejects(archivedFixture.service.createPost(MEMBER,current.id,input(['uficonnect'])),{status:409});assert.deepEqual(archivedFixture.calls,[]);
});

test('post filters retain private draft ownership and expose only public author metadata',async()=>{
  const {service}=fixture(),current=await space(service);
  await pg.query('UPDATE users SET name=$1 WHERE id=$2',['Named teammate',MEMBER]);
  await service.createPost(MEMBER,current.id,input());await service.createPost(MEMBER,current.id,input(['uficonnect']));
  assert.equal((await service.posts(OWNER,current.id,{status:'draft'})).posts.length,0);
  const published=(await service.posts(OWNER,current.id,{status:'published'})).posts;
  assert.equal(published.length,1);assert.equal(published[0].authorName,'Named teammate');assert.equal(published[0].canEdit,false);
  await assert.rejects(service.posts(OWNER,current.id,{status:'unknown'}),{status:400});
  assert.equal(JSON.stringify(published).includes('PRIVATE_TOKEN'),false);
});

test('an uncertain saved-draft publication remains non-retryable and immutable',async()=>{
  let sends=0;const {service}=fixture({publishLinkedIn:async()=>{sends++;throw Error('uncertain');}}),current=await space(service),draft=await service.createPost(OWNER,current.id,input());
  const publish={version:draft.version,requestId:randomUUID(),targets:['linkedin']};
  const result=await service.publishDraft(OWNER,current.id,draft.id,publish);assert.equal(result.status,'unconfirmed');
  await service.publishDraft(OWNER,current.id,draft.id,publish);assert.equal(sends,1);
  await assert.rejects(service.publishDraft(OWNER,current.id,draft.id,{...publish,requestId:randomUUID()}),{status:409});
  await assert.rejects(service.updateDraft(OWNER,current.id,draft.id,{version:result.version,title:'Another title',content:'Do not change a post that may already exist on a source platform.'}),{status:409});
});
