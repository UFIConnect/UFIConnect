'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const { heldPostGroup } = require('./held-topic-groups');
const { createUnknownTopicReview,registerOfficeTopicReviewRoutes } = require('./unknown-topic-review');
const topics=['Python','JavaScript','Cybersecurity'];

async function fixture(t) {
  const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec(`CREATE TABLE feed_posts_cache(id TEXT PRIMARY KEY,title TEXT,content TEXT,topic TEXT,source TEXT,media_url TEXT);
    CREATE TABLE feed_posts_staging(LIKE feed_posts_cache INCLUDING ALL);
    CREATE TABLE office_unknown_topic_review(post_id TEXT PRIMARY KEY,post JSONB NOT NULL,reason TEXT DEFAULT 'ambiguous-topic',
      first_held_at TIMESTAMPTZ DEFAULT NOW(),last_held_at TIMESTAMPTZ DEFAULT NOW(),checked_at TIMESTAMPTZ,retry_at TIMESTAMPTZ DEFAULT NOW(),resolved_at TIMESTAMPTZ)`);
  let tail=Promise.resolve();
  const query=async(sql,args)=>{const result=await pg.query(sql,args);return {...result,rowCount:result.affectedRows};};
  const db={isConnected:()=>true,query,withClient:work=>{const result=tail.then(()=>work({query}));tail=result.catch(()=>{});return result;}};
  const service=createUnknownTopicReview({db,topics});await service.initialize();
  const hold=async(id,post={})=>query('INSERT INTO office_unknown_topic_review(post_id,post) VALUES($1,$2::jsonb)',[id,JSON.stringify({id,title:'Python Django tutorial',content:'Django web frameworks',source:'devto',...post})]);
  return {pg,db,service,hold};
}

test('groups separate content evidence, ambiguous topics, shared keywords and media-only sources',()=>{
  assert.equal(heldPostGroup({title:'Python Django tutorial'},topics).topic,'Python');
  const ambiguous=heldPostGroup({title:'Python and JavaScript'},topics);
  assert.equal(ambiguous.method,'ambiguous');assert.equal(ambiguous.topic,null);assert.match(ambiguous.label,/JavaScript.*Python/);
  assert.deepEqual(heldPostGroup({title:'Amazing #Astronomy photos'},topics),heldPostGroup({content:'#astronomy stargazing'},topics));
  assert.equal(heldPostGroup({title:'Amsterdam canal cruise'},topics).id,heldPostGroup({title:'Amsterdam spring guide'},topics).id);
  const media=heldPostGroup({source:'youtube',media_url:'https://example.test/Python.mp4'},topics);
  assert.equal(media.method,'source');assert.equal(media.topic,null);assert.equal(media.label,'No text: youtube');
});

test('index refresh covers the whole backlog in bounded500 batches and never changes original posts',async t=>{
  const f=await fixture(t);
  await f.pg.exec(`INSERT INTO office_unknown_topic_review(post_id,post)
    SELECT 'bulk-'||n,jsonb_build_object('id','bulk-'||n,'title','Python Django tutorial','content','Retained body','source','devto') FROM generate_series(1,507) n`);
  const before=await f.pg.query('SELECT post_id,post,resolved_at FROM office_unknown_topic_review ORDER BY post_id');
  assert.deepEqual(await f.service.refreshGroups(),{ok:true,processed:500,total:507,indexed:500,remaining:7});
  assert.equal((await f.service.groups()).groups[0].count,500);
  assert.deepEqual(await f.service.refreshGroups(),{ok:true,processed:7,total:507,indexed:507,remaining:0});
  assert.equal((await f.service.groups()).groups[0].count,507);
  assert.equal((await f.service.refreshGroups()).processed,0);
  assert.deepEqual((await f.pg.query('SELECT post_id,post,resolved_at FROM office_unknown_topic_review ORDER BY post_id')).rows,before.rows);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS count FROM feed_posts_staging')).rows[0].count,0);
});

test('topic-name search finds aliases, group filters bind cursors and stale content disappears until reindexed',async t=>{
  const f=await fixture(t);await f.hold('django-only',{title:'Django deployment guide',content:'Flask and FastAPI',private_token:'excluded'});
  await f.hold('second',{source:'mastodon'});await f.service.refreshGroups();
  const searched=await f.service.groups({q:'python',source:'devto'});
  assert.equal(searched.groups.length,1);assert.equal(searched.groups[0].count,1);
  const id=searched.groups[0].id;
  const page=await f.service.list({q:'Python',group:id,limit:1});assert.equal(page.total,2);assert.equal(page.items.length,1);assert.ok(page.nextCursor);
  assert.equal(page.items[0].version,(await f.service.detail(page.items[0].id)).item.version);assert.equal(page.items[0].private_token,undefined);
  await assert.rejects(f.service.list({limit:1,cursor:page.nextCursor}),{status:400});
  // Invalidation also catches a body change whose timestamp was not updated.
  await f.pg.query("UPDATE office_unknown_topic_review SET post=post || '{\"title\":\"Phishing ransomware report\",\"content\":\"Malware response\"}'::jsonb WHERE post_id='django-only'");
  assert.equal((await f.service.groups({q:'python',source:'devto'})).groups.length,0);
  assert.equal((await f.service.groups()).remaining,1);
  await f.service.refreshGroups();
  assert.equal((await f.service.groups({q:'cybersecurity'})).groups[0].count,1);
  assert.equal((await f.service.list({group:id})).total,1);
});

test('groups paginate independently with honest total counts and literal searches',async t=>{
  const f=await fixture(t);for(const [id,title] of [['p','Python'],['j','JavaScript'],['k','Astronomy observing'],['l','100% Astronomy viewing']])await f.hold(id,{title,content:''});
  await f.service.refreshGroups();
  const first=await f.service.groups({limit:1});assert.equal(first.groups.length,1);assert.ok(first.hasMore);assert.equal(first.totalGroups,3);assert.equal(first.matchedTotal,4);
  const second=await f.service.groups({limit:1,offset:first.nextOffset});assert.notEqual(second.groups[0].id,first.groups[0].id);
  assert.equal((await f.service.groups({q:'%'})).matchedTotal,1);
  for(const filters of [{limit:201},{offset:-1},{q:['x']},{unknown:'x'}])await assert.rejects(f.service.groups(filters),{status:400});
  await assert.rejects(f.service.refreshGroups({confirmed:true}),{status:400});
});

test('a38k group exposes bounded version-only snapshots and excludes newly indexed posts',async t=>{
  const f=await fixture(t);
  // Seed derived metadata after indexing a real member so aggregate scale and
  // snapshot pagination exercise SQL without38k redundant classifier calls.
  await f.hold('seed');await f.service.refreshGroups();
  await f.pg.exec(`INSERT INTO office_unknown_topic_review(post_id,post)
    SELECT 'large-'||lpad(n::text,5,'0'),jsonb_build_object('id','large-'||lpad(n::text,5,'0'),'title','Python Django tutorial','source','devto') FROM generate_series(1,37999) n;
    INSERT INTO office_unknown_topic_review_groups(post_id,review_version,last_held_at,post_hash,catalog_version,group_id,label,suggested_topic,method)
    SELECT r.post_id,repeat('a',64),r.last_held_at,md5(r.post::text),g.catalog_version,g.group_id,g.label,g.suggested_topic,g.method
    FROM office_unknown_topic_review r CROSS JOIN office_unknown_topic_review_groups g WHERE g.post_id='seed' AND r.post_id<>'seed'`);
  const groups=await f.service.groups();assert.equal(groups.total,38000);assert.equal(groups.indexed,38000);assert.equal(groups.groups[0].count,38000);
  const group=groups.groups[0].id;
  const first=await f.service.groupMembers(group);assert.equal(first.items.length,1000);assert.equal(first.total,38000);assert.ok(first.nextCursor);
  assert.deepEqual(Object.keys(first.items[0]).sort(),['expectedVersion','id']);
  await f.hold('zz-new');await f.service.refreshGroups();
  // Simulate an indexing transaction whose timestamp predates selection but
  // whose commit became visible later. Generation, not its clock, must bind it.
  await f.pg.query("UPDATE office_unknown_topic_review_groups SET indexed_at='2000-01-01' WHERE post_id='zz-new'");
  const second=await f.service.groupMembers(group,{cursor:first.nextCursor});assert.equal(second.items.length,1000);assert.equal(second.total,38000);
  assert.equal(new Set([...first.items,...second.items].map(item=>item.id)).size,2000);
  assert.equal((await f.service.groupMembers(group)).total,38001);
  await assert.rejects(f.service.groupMembers(group,{q:'python',cursor:first.nextCursor}),{status:400});
});

test('batch assignment preserves each original version, reports conflicts and replays without duplicates',async t=>{
  const f=await fixture(t);for(const id of ['one','two','changed'])await f.hold(id,{media_url:'https://example.test/image.jpg'});
  const items=(await f.service.list()).items.map(({id,version})=>({id,expectedVersion:version}));
  await f.pg.query("UPDATE office_unknown_topic_review SET post=post || '{\"content\":\"Changed after selection\"}'::jsonb WHERE post_id='changed'");
  const result=await f.service.batchAssign({items,topic:'Python',confirmed:true});
  assert.equal(result.assigned,2);assert.equal(result.conflicts,1);assert.equal(result.failed,0);assert.equal(result.results.filter(row=>!row.ok)[0].id,'changed');
  const staged=(await f.pg.query('SELECT * FROM feed_posts_staging ORDER BY id')).rows;assert.equal(staged.length,2);assert.equal(staged[0].media_url,'https://example.test/image.jpg');
  assert.equal((await f.service.detail('changed')).item.pending,true);
  const replay=await f.service.batchAssign({items,topic:'Python',confirmed:true});assert.equal(replay.assigned,0);assert.equal(replay.replayed,2);assert.equal(replay.conflicts,1);
  assert.equal((await f.pg.query('SELECT COUNT(*)::int AS count FROM office_unknown_topic_manual_assignments')).rows[0].count,2);
  const body={items:[items[0]],topic:'Python',confirmed:true};
  for(const patch of [{items:[]},{items:[...items,...items]},{items:[{id:'one',expectedVersion:'bad'}]},{items:Array(101).fill(items[0])},{topic:'Unknown'},{confirmed:false},{all:true}])await assert.rejects(f.service.batchAssign({...body,...patch}),{status:400});
});

test('batch reports storage failures separately and continues remaining selected posts',async t=>{
  const f=await fixture(t);await f.hold('failure');await f.hold('success');
  const items=(await f.service.list()).items.map(({id,version})=>({id,expectedVersion:version}));
  await f.pg.exec(`CREATE FUNCTION fail_one_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.post_id='failure' THEN RAISE EXCEPTION 'storage unavailable'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_one_receipt BEFORE INSERT ON office_unknown_topic_manual_assignments FOR EACH ROW EXECUTE FUNCTION fail_one_receipt()`);
  const result=await f.service.batchAssign({items,topic:'Python',confirmed:true});assert.equal(result.assigned,1);assert.equal(result.failed,1);assert.equal(result.conflicts,0);
  assert.equal((await f.service.detail('failure')).item.pending,true);assert.equal((await f.pg.query("SELECT * FROM feed_posts_staging WHERE id='failure'")).rows.length,0);
});

test('group endpoints are authenticated private routes before opaque post IDs',async t=>{
  const f=await fixture(t);await f.hold('post');
  const app=express();app.use(express.json());const service=registerOfficeTopicReviewRoutes(app,{db:f.db,topics,requireOfficeToken:(req,res,next)=>req.get('x-office-token')==='fixture'?next():res.status(401).json({message:'Unauthorized'})});await service.initialize();
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}/office/topic-review`,headers={'x-office-token':'fixture','Content-Type':'application/json'};
  for(const [path,method]of[['/groups','GET'],['/groups/refresh','POST'],['/groups/approve','POST'],['/batch-assign','POST'],[`/groups/${'a'.repeat(64)}/members`,'GET']]) {
    const denied=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});assert.equal(denied.status,401);assert.match(denied.headers.get('cache-control'),/private.*no-store/);
  }
  const refresh=await fetch(base+'/groups/refresh',{method:'POST',headers,body:'{}'});assert.equal(refresh.status,200);
  const response=await fetch(base+'/groups',{headers});assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  const group=(await response.json()).groups[0];const members=await fetch(base+`/groups/${group.id}/members`,{headers});assert.equal(members.status,200);
  const saved=await fetch(base+'/batch-assign',{method:'POST',headers,body:JSON.stringify({items:(await members.json()).items,topic:'Python',confirmed:true})});assert.equal(saved.status,200);assert.equal((await saved.json()).assigned,1);
});
