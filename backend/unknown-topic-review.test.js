'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { createUnknownTopicReview, registerOfficeTopicReviewRoutes, pendingManualAssignmentIds } = require('./unknown-topic-review');
const topics = ['Python','JavaScript','Cybersecurity'];
async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`CREATE TABLE feed_posts_cache(id TEXT PRIMARY KEY,title TEXT,content TEXT,topic TEXT,source TEXT,source_url TEXT,
    author_name TEXT,media_url TEXT,media_type TEXT,media_poster TEXT,likes_count INTEGER,comments_count INTEGER,
    post_created_at TIMESTAMPTZ DEFAULT NOW(),fetched_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE feed_posts_staging(LIKE feed_posts_cache INCLUDING ALL);
    CREATE TABLE office_unknown_topic_review(post_id TEXT PRIMARY KEY,post JSONB NOT NULL,reason TEXT DEFAULT 'ambiguous-topic',
      first_held_at TIMESTAMPTZ DEFAULT NOW(),last_held_at TIMESTAMPTZ DEFAULT NOW(),checked_at TIMESTAMPTZ,retry_at TIMESTAMPTZ DEFAULT NOW(),resolved_at TIMESTAMPTZ)`);
  let tail = Promise.resolve(), reject = null;
  const query = async (sql, params) => { if (reject?.(sql)) throw Object.assign(new Error('Synthetic failure'), { code: reject.code }); const result = await pg.query(sql,params); return { ...result,rowCount:result.affectedRows }; };
  const db = { isConnected: () => true, query, withClient: work => { const result = tail.then(() => work({query})); tail = result.catch(() => {}); return result; } };
  const service = createUnknownTopicReview({ db,topics }); await service.initialize();
  return { pg,db,service,fail: fn => { reject=fn; } };
}
async function hold(f,id,extra={}) {
  const post = { id,title:'A plain update',content:'Some retained content.',topic:null,source:'mastodon',source_url:'https://example.test/post',
    media_url:'https://example.test/photo.png',media_type:'image',likes_count:17,comments_count:4,
    post_created_at:'2026-11-01T01:02:03Z',fetched_at:'2026-11-04T01:02:03Z',...extra };
  await f.db.query('INSERT INTO office_unknown_topic_review(post_id,post) VALUES($1,$2::jsonb)',[id,JSON.stringify(post)]); return post;
}
const assignment = async (f,id,topic='Python') => ({ topic,confirmed:true,expectedVersion:(await f.service.detail(id)).item.version });
const count = async (f,table) => (await f.pg.query(`SELECT COUNT(*)::int AS count FROM ${table}`)).rows[0].count;

test('review search has bounded stable pagination, literal search and source filters including microsecond timestamps', async t => {
  const f=await fixture(t);
  for(let n=0;n<53;n++)await hold(f,`p-${String(n).padStart(2,'0')}`,{source:n%2?'devto':'mastodon',title:n===0?'100% original':'Plain post'});
  await f.db.query("UPDATE office_unknown_topic_review SET first_held_at='2026-11-04T01:02:03.123456Z'");
  const first=await f.service.list({limit:50});assert.equal(first.items.length,50);assert.equal(first.total,53);assert.ok(first.nextCursor);
  const next=await f.service.list({limit:50,cursor:first.nextCursor});assert.equal(next.items.length,3);assert.equal(next.nextCursor,null);
  assert.equal(new Set([...first.items,...next.items].map(row=>row.id)).size,53);
  assert.equal((await f.service.list({q:'%'})).total,1);
  assert.equal((await f.service.list({source:'devto'})).total,26);
  await assert.rejects(f.service.list({source:'devto',cursor:first.nextCursor}),{status:400});
  for(const input of [{limit:51},{q:['invalid']},{cursor:'invalid@@'},{q:'a'.repeat(201)}])await assert.rejects(f.service.list(input),{status:400});
});

test('detail returns full public content and suggestions but excludes arbitrary stored private fields', async t => {
  const f=await fixture(t),id='mastodon/server?post#part';
  await hold(f,id,{title:'Python Django tutorial',content:'Complete retained text\n'+ 'x'.repeat(5000),private_token:'never expose',secret:{token:'no'}});
  const detail=await f.service.detail(id);assert.equal(detail.item.post.content.length,5023);assert.equal(detail.item.post.private_token,undefined);assert.equal(detail.item.post.secret,undefined);
  assert.match(detail.item.version,/^[a-f0-9]{64}$/);assert.equal(detail.item.pending,true);assert.equal(detail.suggestions[0].topic,'Python');assert.deepEqual(detail.taxonomy.map(row=>row.topic),['Cybersecurity','JavaScript','Python']);
  await assert.rejects(f.service.detail('absent'),{status:404});await assert.rejects(f.service.detail('a\0b'),{status:400});
});

test('manual assignment preserves the original body and history and queues a copy for regular screening', async t => {
  const f=await fixture(t),original=await hold(f,'assign');const body=await assignment(f,'assign');
  const result=await f.service.assign('assign',body);assert.equal(result.status,'queued');assert.equal(result.topic,'Python');assert.equal(result.replayed,false);
  const staged=(await f.pg.query("SELECT * FROM feed_posts_staging WHERE id='assign'")).rows[0];assert.equal(staged.topic,'Python');assert.equal(staged.content,original.content);assert.equal(staged.media_url,original.media_url);assert.equal(staged.likes_count,17);
  assert.equal(await count(f,'feed_posts_cache'),0);const review=(await f.pg.query("SELECT * FROM office_unknown_topic_review WHERE post_id='assign'")).rows[0];assert.deepEqual(review.post,original);assert.ok(review.resolved_at);
  const receipt=(await f.pg.query('SELECT original_post FROM office_unknown_topic_manual_assignments')).rows[0];assert.deepEqual(receipt.original_post,original);assert.equal((await f.service.list()).total,0);assert.equal((await f.service.detail('assign')).item.pending,false);
  const repeated=await f.service.assign('assign',body);assert.equal(repeated.replayed,true);assert.equal(await count(f,'feed_posts_staging'),1);assert.equal(await count(f,'office_unknown_topic_manual_assignments'),1);
});

test('invalid topics and stale previews cannot change held posts', async t => {
  const f=await fixture(t);await hold(f,'invalid');const body=await assignment(f,'invalid');
  for(const change of [{topic:'Made up'},{topic:'Unknown'},{confirmed:false},{expectedVersion:''},{subtopic:'Not a subtopic'},{subtopic:''},{subtopic:null},{extra:true}])await assert.rejects(f.service.assign('invalid',{...body,...change}),{status:400});
  await f.pg.query("UPDATE office_unknown_topic_review SET post=post || '{\"content\":\"Newer complete text\"}'::jsonb WHERE post_id='invalid'");
  await assert.rejects(f.service.assign('invalid',body),{status:409});assert.equal(await count(f,'feed_posts_staging'),0);assert.equal((await f.service.detail('invalid')).item.pending,true);
});

test('racing assignments serialize and identical retries reuse one receipt without overwriting another decision', async t => {
  const f=await fixture(t);await hold(f,'race');const body=await assignment(f,'race');
  const results=await Promise.all([f.service.assign('race',body),f.service.assign('race',body)]);assert.deepEqual(results.map(row=>row.replayed).sort(),[false,true]);
  await assert.rejects(f.service.assign('race',{...body,topic:'JavaScript'}),{status:409});assert.equal(await count(f,'office_unknown_topic_manual_assignments'),1);
  await f.pg.query("UPDATE office_unknown_topic_review SET resolved_at=NULL,post=post || '{\"content\":\"Newer review item\"}'::jsonb WHERE post_id='race'");
  const retry=await f.service.assign('race',body);assert.equal(retry.replayed,true);assert.equal(retry.newerReviewPending,true);assert.equal((await f.service.detail('race')).item.pending,true);
});

test('failed receipt writes and lock conflicts roll back staging and preserve the review for a safe retry', async t => {
  const f=await fixture(t);await hold(f,'rollback');const body=await assignment(f,'rollback');
  f.fail(sql=>sql.startsWith('INSERT INTO office_unknown_topic_manual_assignments'));
  await assert.rejects(f.service.assign('rollback',body));assert.equal(await count(f,'feed_posts_staging'),0);assert.equal((await f.service.detail('rollback')).item.pending,true);
  const lock=sql=>sql.startsWith('INSERT INTO feed_posts_staging');lock.code='55P03';f.fail(lock);
  await assert.rejects(f.service.assign('rollback',body),{status:409});assert.equal(await count(f,'feed_posts_staging'),0);assert.equal((await f.service.detail('rollback')).item.pending,true);
  f.fail(null);assert.equal((await f.service.assign('rollback',body)).ok,true);
});

test('existing staged or live copies remain unchanged and conflicts remain visible', async t => {
  const f=await fixture(t);
  for(const [id,table]of[['staged','feed_posts_staging'],['live','feed_posts_cache']]){
    await hold(f,id);const body=await assignment(f,id);await f.pg.query(`INSERT INTO ${table}(id,title,content,topic) VALUES($1,'Newer title','Newer body','Cybersecurity')`,[id]);
    await assert.rejects(f.service.assign(id,body),{status:409});assert.equal((await f.pg.query(`SELECT content FROM ${table} WHERE id=$1`,[id])).rows[0].content,'Newer body');assert.equal((await f.service.detail(id)).item.pending,true);
  }
  assert.equal(await count(f,'office_unknown_topic_manual_assignments'),0);
});

test('review routes require Office authentication, use private responses and accept URL-encoded opaque IDs', async t => {
  const f=await fixture(t),id='opaque/server?post#part';await hold(f,id);
  const app=express();app.use(express.json());const service=registerOfficeTopicReviewRoutes(app,{db:f.db,topics,requireOfficeToken:(req,res,next)=>req.get('x-office-token')==='fixture'?next():res.status(401).json({message:'Unauthorized'})});await service.initialize();
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base='http://127.0.0.1:'+server.address().port;
  const denied=await fetch(base+'/office/topic-review');assert.equal(denied.status,401);assert.match(denied.headers.get('cache-control'),/private.*no-store/);
  const response=await fetch(base+'/office/topic-review/'+encodeURIComponent(id),{headers:{'x-office-token':'fixture'}});assert.equal(response.status,200);const detail=await response.json();assert.equal(detail.item.id,id);
  const saved=await fetch(base+'/office/topic-review/'+encodeURIComponent(id)+'/assign',{method:'POST',headers:{'x-office-token':'fixture','Content-Type':'application/json'},body:JSON.stringify({topic:'Python',confirmed:true,expectedVersion:detail.item.version})});assert.equal(saved.status,200);assert.match(saved.headers.get('cache-control'),/no-store/);
});

test('group approval assigns only the suggested topic through bounded batches and reports conflicts',async t=>{
  const f=await fixture(t);
  await hold(f,'approve-1',{title:'Python Django tutorial',content:'Django web frameworks'});
  await hold(f,'approve-2',{title:'Python Django tutorial',content:'Django web frameworks'});
  await f.service.refreshGroups();
  // Change approve-2 only after the group snapshot, so its indexed review
  // version is stale and approval must report it as a conflict.
  await f.db.query("UPDATE office_unknown_topic_review SET post=post || '{\"content\":\"Changed after selection\"}'::jsonb WHERE post_id='approve-2'");
  const groups=await f.service.groups();assert.equal(groups.groups.length,1);assert.equal(groups.groups[0].topic,'Python');
  const result=await f.service.approveGroup({group:groups.groups[0].id,confirmed:true});
  assert.equal(result.ok,true);assert.equal(result.topic,'Python');assert.equal(result.assigned,1);assert.equal(result.conflicts,1);assert.equal(result.replayed,0);assert.equal(result.failed,0);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS count FROM feed_posts_staging')).rows[0].count,1);
  assert.equal((await f.pg.query("SELECT topic FROM feed_posts_staging WHERE id='approve-1'")).rows[0].topic,'Python');
  const replay=await f.service.approveGroup({group:groups.groups[0].id,confirmed:true});
  assert.equal(replay.assigned,0);assert.equal(replay.replayed,1);assert.equal(replay.conflicts,1);assert.equal(replay.remaining,1);
  for(const body of [{group:groups.groups[0].id},{confirmed:false},{},{group:'short'},{group:'a'.repeat(64),confirmed:true,topic:'JavaScript'}])await assert.rejects(f.service.approveGroup(body),{status:400});
  await f.db.query('DELETE FROM office_unknown_topic_review_groups');
  await assert.rejects(f.service.approveGroup({group:'a'.repeat(64),confirmed:true}),{status:409});
});

test('promotion protection shares the caller transaction and clears only processed manual receipts', async t => {
  const f=await fixture(t);await f.service.initialize();
  await hold(f,'first');await hold(f,'second');
  await f.service.assign('first',await assignment(f,'first'));await f.service.assign('second',await assignment(f,'second'));
  const uninitialized=createUnknownTopicReview({db:f.db,topics});
  assert.deepEqual((await uninitialized.pendingAssignments(['first','second','ordinary'])).sort(),['first','second']);
  await f.db.withClient(async client=>{
    await client.query('BEGIN');
    assert.deepEqual(await uninitialized.pendingAssignments(['first'],{queryRunner:client}),['first']);
    await uninitialized.markProcessed(['first'],{queryRunner:client});
    assert.deepEqual(await uninitialized.pendingAssignments(['first'],{queryRunner:client}),[]);
    await client.query('ROLLBACK');
  });
  assert.deepEqual(await uninitialized.pendingAssignments(['first']),['first']);
  await f.db.withClient(async client=>{await client.query('BEGIN');await uninitialized.markProcessed(['first'],{queryRunner:client});await client.query('COMMIT');});
  assert.deepEqual(await uninitialized.pendingAssignments(['first','second']),['second']);
  const receipt=(await f.pg.query("SELECT original_post,processed_at FROM office_unknown_topic_manual_assignments WHERE post_id='first'")).rows[0];
  assert.ok(receipt.processed_at);assert.equal(receipt.original_post.id,'first');
  const empty=new PGlite();t.after(()=>empty.close());assert.deepEqual(await pendingManualAssignmentIds(empty,['absent']),[]);
});
