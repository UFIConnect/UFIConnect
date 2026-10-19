'use strict';
const { test,before,after,beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { BUSINESS_INDUSTRY_SCHEMA,catalog,safeHttps,createBusinessIndustries } = require('./business-industries');
const OWNER='a0000000-0000-4000-8000-000000000001', MEMBER='a0000000-0000-4000-8000-000000000002', OTHER='a0000000-0000-4000-8000-000000000003', FREE='a0000000-0000-4000-8000-000000000004';
let pg;
before(async()=>{pg=new PGlite();await pg.exec('CREATE TABLE users(id UUID PRIMARY KEY,plan TEXT,billing_closed BOOLEAN DEFAULT false)');for(const sql of BUSINESS_INDUSTRY_SCHEMA)await pg.exec(sql);});
after(async()=>pg.close());
beforeEach(async()=>{await pg.exec('TRUNCATE users CASCADE');await pg.query('INSERT INTO users(id,plan) VALUES($1,\'business\'),($2,\'free\'),($3,\'business\'),($4,\'free\')',[OWNER,MEMBER,OTHER,FREE]);});
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
