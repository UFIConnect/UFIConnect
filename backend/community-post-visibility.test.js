'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
require('./generated-media');
const {PGlite}=require('@electric-sql/pglite');
const {createAppHarness,member}=require('./test-support/app-harness');
const {REPORT_SCHEMA}=require('./content-reports');
const {SCHEMA:DEVICE_SCHEMA}=require('./suspicious-devices');
const {REPORT_TARGET_TEST_SCHEMA,REPORT_BASE_TEST_SCHEMA}=require('./test-support/report-db');
const VIEWER='b0000000-0000-4000-8000-000000000001';
const AUTHOR='b0000000-0000-4000-8000-000000000002';
const post=(id,groupId,createdAt)=>({id,groupId,authorId:AUTHOR,source:'uficonnect',title:'Community update',content:'A useful community update.',createdAt,likes:[],commentsCount:0});
test('post lists keep private and missing groups out of stranger profiles and paginate visible rows',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec(REPORT_BASE_TEST_SCHEMA+REPORT_TARGET_TEST_SCHEMA+`ALTER TABLE users ADD COLUMN joined_groups TEXT[] DEFAULT '{}'; CREATE TABLE community_groups(id TEXT PRIMARY KEY,is_private BOOLEAN DEFAULT false,created_by TEXT);`);
  for(const sql of [...REPORT_SCHEMA,...DEVICE_SCHEMA])await pg.exec(sql);
  await pg.query("INSERT INTO users(id,name,email) VALUES($1,'Viewer','viewer@example.invalid'),($2,'Author','author@example.invalid')",[VIEWER,AUTHOR]);
  await pg.query("INSERT INTO community_groups(id,is_private,created_by) VALUES('ufi-general',false,NULL),('public-community',false,$1),('private-community',true,$1)",[AUTHOR]);
  const items=[post('private-newest','private-community','2026-10-07T10:00:00Z'),post('orphan-next','deleted-group','2026-10-07T09:00:00Z'),post('public-next','public-community','2026-10-07T08:00:00Z'),post('general-last','ufi-general','2026-10-07T07:00:00Z')];
  for(const item of items)await pg.query('INSERT INTO community_posts(id,group_id,author_id,title,content,source,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[item.id,item.groupId,AUTHOR,item.title,item.content,item.source,item.createdAt]);
  const app=await createAppHarness({connected:true,query:(sql,params)=>sql.startsWith('SELECT id FROM auth_sessions')?Promise.resolve({rows:[{id:params[0]}],rowCount:1}):pg.query(sql,params)});
  t.after(()=>app.close());app.seedUser(member(VIEWER));app.seedUser(member(AUTHOR));
  app.groups.push({id:'public-community',isPrivate:false},{id:'private-community',isPrivate:true,createdBy:AUTHOR});app.posts.push(...items);
  const first=await app.request('/posts?limit=1',{userId:VIEWER});assert.equal(first.status,200,JSON.stringify(first.data));assert.deepEqual(first.data.posts.map(p=>p.id),['public-next']);assert.equal(first.data.hasMore,true);
  const second=await app.request('/posts?limit=1&offset=1',{userId:VIEWER});assert.deepEqual(second.data.posts.map(p=>p.id),['general-last']);assert.equal(second.data.hasMore,false);
  const profile=await app.request('/users/'+AUTHOR+'/posts',{userId:VIEWER});assert.equal(profile.status,200,JSON.stringify(profile.data));assert.deepEqual(profile.data.posts.map(p=>p.id),['public-next','general-last']);
  const denied=await app.request('/groups/private-community/posts',{userId:VIEWER});assert.equal(denied.status,404);
  await pg.query("INSERT INTO post_comments(id,post_id,author_id,content) VALUES('private-reply','private-newest',$1,'A private discussion reply.')",[AUTHOR]);
  for(const route of ['/feed/private-newest','/feed/private-newest/comments','/posts/private-newest/comments','/posts/private-newest/likes']) {
    const response=await app.request(route,{userId:VIEWER});assert.equal(response.status,404,route+' '+JSON.stringify(response.data));
  }
  assert.equal((await app.request('/posts/private-newest/comments',{method:'POST',userId:VIEWER,body:{content:'A forbidden comment.'}})).status,404);
  assert.equal((await app.request('/posts/private-newest/like',{method:'POST',userId:VIEWER,body:{liked:true}})).status,404);
  assert.equal((await app.request('/feed/private-newest/comments')).status,404,'A public comments URL must respect the parent private group');
  await pg.query("UPDATE users SET joined_groups=ARRAY['private-community'] WHERE id=$1",[VIEWER]);
  const memberList=await app.request('/posts',{userId:VIEWER});assert.deepEqual(memberList.data.posts.map(p=>p.id),['private-newest','public-next','general-last'],'Stored membership remains authoritative when worker user memory is stale');
  const creatorList=await app.request('/posts',{userId:AUTHOR});assert.deepEqual(creatorList.data.posts.map(p=>p.id),['private-newest','public-next','general-last']);
  assert.equal((await app.request('/feed/private-newest',{userId:VIEWER})).status,200,'Direct post access also reads stored membership rather than stale worker state');
  app.users.find(user=>user.id===VIEWER).joinedGroups=['private-community'];
  await pg.query("UPDATE users SET joined_groups='{}' WHERE id=$1",[VIEWER]);
  assert.equal((await app.request('/feed/private-newest/comments',{userId:VIEWER})).status,404,'Leaving the group on another worker invalidates cached access');
  assert.equal((await app.request('/posts/private-newest/like',{method:'POST',userId:VIEWER,body:{liked:true}})).status,404);
  const strangerFrames=[],creatorFrames=[];
  app.sseClients.set('stranger',{feedViewerId:VIEWER,write:frame=>strangerFrames.push(frame)});
  app.sseClients.set('creator',{feedViewerId:AUTHOR,write:frame=>creatorFrames.push(frame)});
  app.broadcastSSE(items.filter(item=>item.id!=='orphan-next'));
  await app.flushSSEBatch();
  assert.deepEqual(JSON.parse(strangerFrames[0].slice(6)).posts.map(p=>p.id),['public-next','general-last']);
  assert.deepEqual(JSON.parse(creatorFrames[0].slice(6)).posts.map(p=>p.id),['private-newest','public-next','general-last']);
  const healthy=app.db.query;
  app.db.query=async(sql,...args)=>{if(sql.includes('FROM community_groups visible_group'))throw new Error('Synthetic group permissions outage');return healthy(sql,...args);};
  app.broadcastSSE([items[0]]);await app.flushSSEBatch();assert.equal(creatorFrames.length,1,'A database outage must withhold private stream content');
  app.db.query=healthy;
});
test('offline post lists apply the same private group visibility rule to memory',async t=>{
  const app=await createAppHarness();t.after(()=>app.close());app.seedUser(member(VIEWER));app.seedUser(member(AUTHOR));
  app.groups.push({id:'private-community',isPrivate:true,createdBy:AUTHOR},{id:'public-community',isPrivate:false});
  app.posts.push(post('private','private-community','2026-10-08T10:00:00Z'),post('public','public-community','2026-10-08T09:00:00Z'),post('orphan','deleted-group','2026-10-08T08:00:00Z'));
  const response=await app.getCommunityPosts({viewerId:VIEWER});assert.deepEqual(Array.from(response.posts,p=>p.id),['public']);
});
test('native publishing persists to UFI and group feeds across API workers without relying on the composer cache',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec(REPORT_BASE_TEST_SCHEMA+REPORT_TARGET_TEST_SCHEMA+`ALTER TABLE users ADD COLUMN joined_groups TEXT[] DEFAULT '{}'; CREATE TABLE community_groups(id TEXT PRIMARY KEY,is_private BOOLEAN DEFAULT false,created_by TEXT);`);
  for(const sql of [...REPORT_SCHEMA,...DEVICE_SCHEMA])await pg.exec(sql);
  await pg.query("INSERT INTO users(id,name,email,joined_groups) VALUES($1,'Synthetic author','author@example.invalid',ARRAY['public-community'])",[AUTHOR]);
  await pg.query("INSERT INTO community_groups(id,is_private,created_by) VALUES('ufi-general',false,NULL),('public-community',false,$1)",[AUTHOR]);
  const worker=async()=>{
    const app=await createAppHarness({connected:true,query:(sql,params)=>sql.startsWith('SELECT id FROM auth_sessions')?Promise.resolve({rows:[{id:params[0]}],rowCount:1}):pg.query(sql,params)});
    t.after(()=>app.close());app.seedUser(member(AUTHOR,{joinedGroups:['public-community']}));app.groups.push({id:'public-community',name:'Synthetic community',isPrivate:false,isExternal:false,createdBy:AUTHOR});
    app.setContentScreening(async({content})=>({allowed:true,content}));return app;
  };
  const composer=await worker(),reader=await worker();
  const ids=[];
  for(const groupId of ['ufi-general','public-community']) {
    const created=await composer.request('/groups/'+groupId+'/posts',{method:'POST',userId:AUTHOR,body:{content:'A synthetic persistence and feed visibility check.'}});
    assert.equal(created.status,201,JSON.stringify(created.data));ids.push(created.data.post.id);
    const stored=await pg.query('SELECT group_id,author_id,source FROM community_posts WHERE id=$1',[created.data.post.id]);assert.deepEqual(stored.rows,[{group_id:groupId,author_id:AUTHOR,source:'uficonnect'}]);
  }
  assert.equal(reader.posts.some(post=>ids.includes(post.id)),false,'The second worker never receives the composer memory update');
  const ufi=await reader.request('/posts?scope=ufi',{userId:AUTHOR});assert.equal(ufi.status,200,JSON.stringify(ufi.data));assert.deepEqual(ufi.data.posts.map(p=>p.id).sort(),ids.slice().sort());
  const general=await reader.request('/groups/ufi-general/posts',{userId:AUTHOR});assert.deepEqual(general.data.posts.map(p=>p.id),[ids[0]]);
  const group=await reader.request('/groups/public-community/posts',{userId:AUTHOR});assert.deepEqual(group.data.posts.map(p=>p.id),[ids[1]]);
  const joined=await reader.request('/posts?scope=joined',{userId:AUTHOR});assert.deepEqual(joined.data.posts.map(p=>p.id),[ids[1]]);
  const groupFeed=await reader.request('/office/feed?mode=groups&passive=1',{userId:AUTHOR});assert.equal(groupFeed.status,200,JSON.stringify(groupFeed.data));assert.deepEqual(groupFeed.data.posts.map(p=>p.id),[ids[1]]);
  for(const id of ids)assert.equal((await reader.request('/feed/'+id)).status,200);
});
