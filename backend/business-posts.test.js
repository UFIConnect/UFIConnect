'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { BUSINESS_POST_SCHEMA, normalizeDetails, compareJobs, createBusinessPosts } = require('./business-posts');
const { createAppHarness, member } = require('./test-support/app-harness');
const OWNER = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'a0000000-0000-4000-8000-000000000002';
const details = { title: 'Senior software engineer', company: 'Hiring company', location: 'Los Angeles, CA', pay: '$120,000–$160,000/year',
  description: 'Build software for recruiting teams and improve reliable delivery.', duties: 'Design APIs\nMaintain production services', requirements: 'JavaScript\nPostgreSQL', applyUrl: 'https://example.invalid/apply' };
let pg;
before(async () => {
  pg = new PGlite();
  await pg.exec('CREATE TABLE users(id UUID PRIMARY KEY); CREATE TABLE community_posts(id TEXT PRIMARY KEY,author_id TEXT,likes TEXT[]); CREATE TABLE post_comments(id TEXT,post_id TEXT)');
  for (const sql of BUSINESS_POST_SCHEMA) await pg.exec(sql);
});
after(async () => pg.close());
beforeEach(async () => {
  await pg.exec('TRUNCATE users,community_posts,post_comments CASCADE');
  await pg.query('INSERT INTO users(id) VALUES($1),($2)', [OWNER, OTHER]);
});
function fixture(options = {}) {
  let connected = true;
  const calls = [];
  const service = createBusinessPosts({
    db: { isConnected: () => connected, query: (sql, params) => pg.query(sql, params) },
    getUser: async id => ({ id, plan: id === OWNER || id === OTHER ? 'business' : 'pro', socialTokens: { linkedin: 'test-token' } }),
    screenContent: async ({ content }) => ({ allowed: true, content }),
    publishNative: async (user, post) => { calls.push('uficonnect'); await pg.query('INSERT INTO community_posts(id,author_id,likes) VALUES($1,$2,$3)', [post.id,user.id,[]]); return { status: 'posted', postedUrl: `https://uficonnect.org/p/${post.id}` }; },
    publishLinkedIn: async () => { calls.push('linkedin'); return { platform: 'linkedin', status: 'posted', postedUrl: 'https://www.linkedin.com/feed/update/urn:li:share:123' }; },
    loadJobs: async () => [{ id: 'remote-role', title: 'Software engineer', org: 'Other company', content: '<h2>Responsibilities</h2><ul><li>Build reliable software and APIs.</li></ul><h2>Requirements</h2><p>JavaScript and PostgreSQL.</p>' + '<p>Full description tail.</p>'.repeat(250), sourceUrl: 'https://remotive.com/remote-jobs/software-dev/test', likesCount: 900, commentsCount: 600 }],
    ...options,
  });
  return { service, calls, offline() { connected = false; } };
}
test('publishes each chosen destination once, saves per-destination outcomes and counts real native reactions', async () => {
  const { service, calls } = fixture();
  const request = { requestId: randomUUID(), details, targets: ['uficonnect','linkedin'] };
  const post = await service.create(OWNER, request);
  assert.equal(post.status, 'published'); assert.equal(post.targets.length, 2);
  assert.deepEqual(post.metrics, { likes: 0, comments: 0, views: null });
  assert.equal((await service.create(OWNER, request)).id, post.id);
  assert.deepEqual(calls, ['uficonnect','linkedin']);
  await pg.query('UPDATE community_posts SET likes=$1 WHERE id=$2', [[OWNER,OTHER],post.id]);
  await pg.query('INSERT INTO post_comments(id,post_id) VALUES($1,$2)', ['comment',post.id]);
  const current = (await service.posts(OWNER)).posts[0];
  assert.deepEqual(current.metrics, { likes: 2, comments: 1, views: null });
  await assert.rejects(service.create(OWNER, { ...request, details: { ...details, title: 'Different role' } }), { status: 409 });
});
test('parallel duplicate requests reserve only one delivery attempt', async () => {
  const { service, calls } = fixture();
  const input = { requestId: randomUUID(), details, targets: ['linkedin'] };
  const result = await Promise.all([service.create(OWNER,input),service.create(OWNER,input)]);
  assert.equal(result[0].id, result[1].id); assert.deepEqual(calls,['linkedin']);
  assert.equal((await pg.query('SELECT COUNT(*)::int AS n FROM business_posts')).rows[0].n,1);
});
test('drafts persist across service instances without invented counts or publication', async () => {
  const { service, calls } = fixture();
  await service.create(OWNER,{ requestId: randomUUID(),details,targets: [] });
  const saved = await fixture().service.posts(OWNER);
  assert.equal(saved.posts[0].status,'draft'); assert.deepEqual(calls,[]);
  assert.deepEqual(saved.posts[0].metrics,{ likes:null,comments:null,views:null });
  assert.equal((await service.posts(OTHER)).posts.length,0);
  await assert.rejects(service.similar(OTHER,saved.posts[0].id),{ status:404 });
  await assert.rejects(service.posts('not-business'),{ status:403 });
});
test('storage, validation and screening failures cannot send a post',async()=>{
  const first=fixture();first.offline();
  await assert.rejects(first.service.create(OWNER,{ requestId:randomUUID(),details,targets:['linkedin'] }),{ status:503 });
  assert.deepEqual(first.calls,[]);
  const second=fixture({screenContent:async()=>({allowed:false,reason:'screening_unavailable'})});
  await assert.rejects(second.service.create(OWNER,{ requestId:randomUUID(),details,targets:['linkedin'] }),{ status:503 });
  await assert.rejects(second.service.create(OWNER,{ requestId:randomUUID(),details,targets:['reddit'] }),{ status:400 });
  assert.deepEqual(second.calls,[]);
  const third=fixture({db:{isConnected:()=>true,query:async(sql,params)=>{if(sql.startsWith('INSERT INTO business_posts'))throw Error('write unavailable');return pg.query(sql,params);}}});
  await assert.rejects(third.service.create(OWNER,{requestId:randomUUID(),details,targets:['linkedin']}),/write unavailable/);
  assert.deepEqual(third.calls,[]);
});
test('partial delivery is reported for each source and a retry cannot duplicate successful destinations',async()=>{
  const {service,calls}=fixture({publishLinkedIn:async()=>({status:'failed',error:'Reconnect LinkedIn.'})});
  const input={requestId:randomUUID(),details,targets:['uficonnect','linkedin']};
  const post=await service.create(OWNER,input);
  assert.equal(post.status,'published');assert.equal(post.targets[1].status,'failed');
  await service.create(OWNER,input);assert.deepEqual(calls,['uficonnect']);
});
test('comparison reads the full description, explains matches, preserves source identity and unavailable metrics',async()=>{
  const {service}=fixture();
  const own=await service.create(OWNER,{requestId:randomUUID(),details,targets:[]});
  const result=await service.similar(OWNER,own.id);
  assert.equal(result.total,1);assert.equal(result.posts[0].source,'Remotive');
  assert.ok(result.posts[0].content.length>5000);assert.match(result.posts[0].content,/Full description tail/);
  assert.deepEqual(result.posts[0].metrics,{likes:null,comments:null,views:null});
  assert.ok(result.posts[0].match.titleTerms.includes('software'));
});
test('matching excludes shared seniority alone, duplicate URLs and unsafe links while retaining native counts',()=>{
  const own={details,content:normalizeDetails(details).content};
  const job={id:'valid',title:'Software engineer',content:'Build software and APIs',sourceUrl:'https://remotive.com/remote-jobs/123'};
  const result=compareJobs(own,[job,{...job,id:'duplicate'},{...job,id:'seniority',title:'Senior accountant',sourceUrl:'https://remotive.com/remote-jobs/456'},
    {...job,id:'unsafe',sourceUrl:'javascript:alert(1)'},{...job,id:'native',source:'uficonnect',sourceUrl:'https://uficonnect.org/p/native',likesCount:12,commentsCount:3}]);
  assert.equal(result.length,2);assert.deepEqual(result.find(post=>post.id==='native').metrics,{likes:12,comments:3,views:null});
});
test('source outages leave the saved post readable and explain the unavailable comparisons',async()=>{
  const {service}=fixture({loadJobs:async()=>{throw Error('source offline');}});
  const own=await service.create(OWNER,{requestId:randomUUID(),details,targets:[]});
  const result=await service.similar(OWNER,own.id);
  assert.equal(result.post.id,own.id);assert.equal(result.posts.length,0);assert.match(result.warning,/temporarily unavailable/);
});
test('post pagination stays scoped to the member and comparison pages do not repeat',async()=>{
  const {service}=fixture({loadJobs:async()=>Array.from({length:14},(_,i)=>({id:`job-${i}`,title:'Software engineer',content:'Build software APIs',org:'Example',sourceUrl:`https://remotive.com/remote-jobs/${i}`}))});
  for(let i=0;i<14;i++) await service.create(OWNER,{requestId:randomUUID(),details:{...details,title:`Software engineer ${i}`},targets:[]});
  const first=await service.posts(OWNER),second=await service.posts(OWNER,{page:2});
  assert.equal(first.posts.length,12);assert.equal(first.hasMore,true);assert.equal(second.posts.length,2);assert.equal(second.hasMore,false);
  const compare1=await service.similar(OWNER,first.posts[0].id),compare2=await service.similar(OWNER,first.posts[0].id,{page:2});
  assert.equal(compare1.posts.length,6);assert.equal(compare1.hasMore,true);
  assert.equal(compare1.posts.some(post=>compare2.posts.some(other=>other.id===post.id)),false);
});
test('composed content remains complete and unsafe application links or overlong posts are rejected',()=>{
  assert.match(normalizeDetails(details).content,/- JavaScript\n- PostgreSQL/);
  assert.throws(()=>normalizeDetails({...details,applyUrl:'javascript:alert(1)'}),{status:400});
  assert.throws(()=>normalizeDetails({...details,description:'a'.repeat(1500),duties:'b'.repeat(1500)}),{status:400});
});
test('real route registration protects storage and keeps Business account connections limited to recruiting',async t=>{
  const app=await createAppHarness({env:{LINKEDIN_CLIENT_ID:'fixture-id',LINKEDIN_CLIENT_SECRET:'fixture-secret'}});t.after(()=>app.close());
  app.seedUser(member('business-post-http',{plan:'business'}));app.seedUser(member('pro-post-http',{plan:'pro'}));
  assert.equal((await app.request('/business/posts')).status,401);
  assert.equal((await app.request('/business/posts',{userId:'business-post-http'})).status,503);
  assert.equal((await app.request('/business/posts',{userId:'pro-post-http'})).status,403);
  const catalog=(await app.request('/social/platforms',{userId:'business-post-http'})).data;
  assert.equal(catalog.platforms.linkedin.crossPost.supported,true);assert.equal(catalog.platforms.reddit,undefined);
  assert.equal((await app.request('/auth/social/reddit/start',{userId:'business-post-http'})).status,403);
  const linkedin=await app.request('/auth/social/linkedin/start',{userId:'business-post-http'});
  assert.equal(linkedin.status,200);assert.match(linkedin.data.url,/linkedin\.com/);
});
