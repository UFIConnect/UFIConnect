const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { REPORT_SCHEMA, createContentReports, createReportVisibilityFilter, reportSuppressionPredicate } = require('./content-reports');
const { REPORT_TARGET_TEST_SCHEMA, REPORT_BASE_TEST_SCHEMA } = require('./test-support/report-db');
const { createAppHarness, member } = require('./test-support/app-harness');
const { OFFICE_TOPIC_SCHEMA } = require('./office-topic-transfer');
const { createTopicRoutingAgents } = require('./topic-routing-agents');
const { SCHEMA: DEVICE_SCHEMA } = require('./suspicious-devices');
const A = 'a0000000-0000-4000-8000-000000000001';
const sourceUrl = 'https://www.youtube.com/watch?v=abcdefghijk';
const external = id => ({ id, source:'youtube',sourceUrl,title:'A reported source post',content:'Content from an actual source fixture.',createdAt:new Date().toISOString(),isExternal:true,author:{name:'Source creator'},likesCount:12,commentsCount:3,videoDurationSeconds:30 });
const remove = note => ({action:'remove_uficonnect',confirmed:true,note,idempotencyKey:require('node:crypto').randomUUID()});
async function fixture(t) {
  const pg = new PGlite(); t.after(()=>pg.close());
  await pg.exec(REPORT_BASE_TEST_SCHEMA + REPORT_TARGET_TEST_SCHEMA);
  for(const sql of REPORT_SCHEMA) await pg.exec(sql);
  await pg.query("INSERT INTO users(id,name,email) VALUES($1,'Alice','synthetic@example.invalid')",[A]);
  const query=async(...args)=>{const result=await pg.query(...args);return{...result,rowCount:result.affectedRows};};
  const db={isConnected:()=>true,query,withClient:fn=>fn({query})};
  // The real save and authenticated comment paths now use these durable stores.
  for(const sql of [...OFFICE_TOPIC_SCHEMA,...DEVICE_SCHEMA]) await pg.exec(sql);
  await createTopicRoutingAgents({db,topics:[]}).initialize();
  const service=createContentReports({db});
  async function worker() {
    const app=await createAppHarness({connected:true,env:{OFFICE_TOKEN:'synthetic-office'},query:async(sql,params)=>{
      if(sql.startsWith('SELECT id FROM auth_sessions'))return{rows:[{id:params[0]}],rowCount:1};
      return query(sql,params);
    },withClient:fn=>fn({query})});
    t.after(()=>app.close()); app.seedUser(member(A));
    app.setContentScreening(async({content})=>({allowed:true,content}));
    return app;
  }
  return{pg,db,service,worker};
}
test('two API workers cannot return removed external cached content or a refetched ID through real feed routes',async t=>{
  const{pg,service,worker}=await fixture(t); const first=await worker(),second=await worker();
  const post=external('youtube-reported');
  assert.equal(await first.savePostsToDBFast([post],'feed_posts_cache',first.db,{skipTrim:true}),1);
  first.addAndBroadcast([post]); second.addAndBroadcast([post]);
  assert.equal((await second.request('/feed/'+post.id)).status,200);
  const report=await service.submit(A,{targetType:'post',targetId:post.id,source:'youtube',sourceUrl,reason:'copyright'});
  const removed=await first.request(`/office/reports/${report.id}/actions`,{method:'POST',headers:{'x-office-token':'synthetic-office'},body:remove('Verified source and authorized removal from UFIConnect.')});
  assert.equal(removed.status,200,JSON.stringify(removed.data));
  assert.equal((await second.request('/feed/'+post.id)).status,404,'The other worker retains its source cache but checks durable suppression');
  const refetched=external('youtube-reingested-alternate-id');
  second.addAndBroadcast([refetched]);
  assert.equal((await second.request('/feed/'+refetched.id)).status,404,'A changed ingestion ID remains suppressed by the original source URL');
  assert.equal((await pg.query('SELECT * FROM feed_posts_cache')).rows.length,0);
  const guest=await second.request('/feed/guest?source=youtube&limit=20');
  assert.equal(guest.status,200,JSON.stringify(guest.data));
  assert.equal((guest.data.posts||[]).some(p=>[post.id,refetched.id].includes(p.id)),false);
});
test('native post and comment removals remain authoritative over another worker memory and fail closed on lookup errors',async t=>{
  const{pg,service,worker}=await fixture(t);const first=await worker(),second=await worker();
  await pg.query("INSERT INTO community_posts(id,author_id,content,source) VALUES('native-post',$1,'A native discussion.','uficonnect')",[A]);
  assert.equal((await second.request('/feed/native-post')).status,200);
  const created=await second.request('/posts/native-post/comments',{method:'POST',userId:A,body:{content:'A comment cached on the second worker.'}});
  assert.equal(created.status,201,JSON.stringify(created.data));
  const commentId=created.data.comment.id;
  const surviving=await second.request('/posts/native-post/comments',{method:'POST',userId:A,body:{content:'The visible comment after the removed row.'}});
  assert.equal(surviving.status,201);
  const comment=await service.submit(A,{targetType:'comment',targetId:commentId,reason:'harassment'});
  assert.equal((await first.request(`/office/reports/${comment.id}/actions`,{method:'POST',headers:{'x-office-token':'synthetic-office'},body:remove('Reviewed and removed the stored comment.')})).status,200);
  let comments=await second.request('/feed/native-post/comments?limit=1');
  assert.equal(comments.status,200);assert.deepEqual(comments.data.comments.map(c=>c.id),[surviving.data.comment.id],'Filter deleted cache rows before pagination so the surviving comment fills the page');
  assert.equal(comments.data.commentsCount,1);
  const healthyQuery=second.db.query;
  second.db.query=async(sql,...params)=>{if(sql.includes('FROM report_content_suppressions'))throw new Error('synthetic comment moderation outage');return healthyQuery(sql,...params);};
  const commentOutage=await second.request('/feed/native-post/comments');
  assert.ok(commentOutage.status>=400);
  assert.equal(JSON.stringify(commentOutage.data).includes(created.data.comment.content),false,'A moderation outage cannot expose the stale removed comment');
  second.db.query=healthyQuery;
  const post=await service.submit(A,{targetType:'post',targetId:'native-post',reason:'spam'});
  assert.equal((await first.request(`/office/reports/${post.id}/actions`,{method:'POST',headers:{'x-office-token':'synthetic-office'},body:remove('Reviewed and removed the stored native post.')})).status,200);
  assert.equal((await second.request('/feed/native-post')).status,404);
  const stale=external('stale-during-outage');second.addAndBroadcast([stale]);
  const previous=second.db.query;second.db.query=async(sql,...params)=>{
    if(sql.includes('FROM report_content_suppressions'))throw new Error('synthetic primary moderation outage');return previous(sql,...params);
  };
  const outage=await second.request('/feed/'+stale.id);assert.ok(outage.status>=400);assert.equal(JSON.stringify(outage.data).includes(stale.title),false);
});
test('actual slow and bulk PostgreSQL ingestion omit tombstoned IDs and original URLs using production column types',async t=>{
  const{pg,service,worker}=await fixture(t);const app=await worker();const post=external('original-target');
  assert.equal(await app.savePostsToDB([post],'feed_posts_staging'),1,'INSERT SELECT still infers integer and timestamp parameter types');
  const report=await service.submit(A,{targetType:'post',targetId:post.id,source:'youtube',sourceUrl,reason:'copyright'});
  await service.act(report.id,remove('Verified source and removed cached content.'));
  for(const table of ['feed_posts_cache','feed_posts_staging']) {
    const sameId={...post,sourceUrl:'https://www.youtube.com/watch?v=zzzzzzzzzzz'};
    const changedId=external('changed-'+table);
    assert.equal(await app.savePostsToDB([sameId,changedId],table),0);
    const fast=await app.savePostsToDBFast([sameId,changedId],table,app.db,{skipTrim:true});
    assert.equal(fast,0,'Suppressed writes must return zero saved rows');
    assert.equal((await pg.query(`SELECT * FROM ${table}`)).rows.length,0);
  }
  const allowed={...external('allowed-target'),sourceUrl:'https://www.youtube.com/watch?v=xxxxxxxxxxx'};
  assert.equal(await app.savePostsToDBFast([allowed],'feed_posts_cache',app.db,{skipTrim:true}),1);
  assert.equal((await pg.query(`SELECT id FROM feed_posts_cache incoming WHERE ${reportSuppressionPredicate('incoming')}`)).rows[0].id,allowed.id);
});
test('comment tombstones do not suppress posts with the same ID and invalid visibility target types are rejected',async t=>{
  const{pg,db}=await fixture(t);await pg.query("INSERT INTO report_content_suppressions(target_type,target_id,kind,source) VALUES('comment','shared-id','native_comment','uficonnect')");
  const filter=createReportVisibilityFilter({db});const item={id:'shared-id'};
  assert.equal((await filter([item])).length,1);
  assert.equal((await filter([item],'comment')).length,0);
  await assert.rejects(filter([item],'user'),e=>e.status===400);
  assert.throws(()=>reportSuppressionPredicate('incoming.source'));
});

test('Office user cache clearing preserves stored accounts and restores native post and comment authors from PostgreSQL',async t=>{
  const { pg, worker } = await fixture(t);
  const commentAuthor='b0000000-0000-4000-8000-000000000002';
  await pg.exec('CREATE TABLE office_user_cache_epoch(id INTEGER PRIMARY KEY CHECK(id=1),version BIGINT NOT NULL DEFAULT 0); INSERT INTO office_user_cache_epoch VALUES(1,0)');
  await pg.query("INSERT INTO users(id,name,email) VALUES($1,'Bob','bob-synthetic@example.invalid')",[commentAuthor]);
  await pg.query("INSERT INTO community_posts(id,author_id,content,source) VALUES('author-hydration-post',$1,'A stored native discussion.','uficonnect')",[A]);
  await pg.query("INSERT INTO post_comments(id,post_id,author_id,content) VALUES('author-hydration-comment','author-hydration-post',$1,'A stored reply with its own author.')",[commentAuthor]);
  const app=await worker();
  app.seedUser(member(commentAuthor,{name:'Cached name before clear'}));
  const cleared=await app.request('/office/users/cache/clear',{method:'POST',headers:{'x-office-token':'synthetic-office'},body:{confirmed:true}});
  assert.equal(cleared.status,200,JSON.stringify(cleared.data));
  assert.equal(cleared.data.cleared,2);
  assert.equal(cleared.data.cached,0);
  assert.deepEqual((await pg.query('SELECT id,name FROM users ORDER BY name')).rows,[{id:A,name:'Alice'},{id:commentAuthor,name:'Bob'}],'Clearing the application cache must preserve both database accounts');
  const post=await app.request('/feed/author-hydration-post');
  assert.equal(post.status,200,JSON.stringify(post.data));
  assert.equal(post.data.post.author.id,A);
  assert.equal(post.data.post.author.name,'Alice','A native post must reload its stored author after the cache is emptied');
  const comments=await app.request('/feed/author-hydration-post/comments');
  assert.equal(comments.status,200,JSON.stringify(comments.data));
  assert.equal(comments.data.comments[0].id,'author-hydration-comment');
  assert.equal(comments.data.comments[0].author,'Bob','The comment author differs from the post author and must be hydrated independently');
  assert.ok(app.queries.some(query=>query.sql.includes('SELECT * FROM users WHERE id = ANY')&&query.params[0].includes(commentAuthor)));
  assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM users')).rows[0].count,2);
});
