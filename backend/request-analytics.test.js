'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {PGlite}=require('@electric-sql/pglite');
const {createRequestAnalytics,REQUEST_ANALYTICS_SCHEMA,endpointFamily}=require('./request-analytics');
const {REQUEST_ANALYTICS_HISTORY_SCHEMA}=require('./request-history-schema');
const start=Date.parse('2026-11-05T04:00:00Z');
function visit(service,path,status=200,{before=()=>{},abort=false}={}){
  const res=new EventEmitter();res.statusCode=status;res.headersSent=false;res.writeHead=function(){this.headersSent=true;};
  let called=false;service.middleware({path,originalUrl:path+'?secret=never-retain',body:{password:'private-credential'}},res,()=>{called=true;});
  assert.equal(called,true);before();if(abort)res.emit('close');else{res.writeHead();res.emit('finish');res.emit('close');}
}
async function read(service,query={}){const res={statusCode:200,set(){return this;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};await service.report({query},res);return res;}
async function fixture(t){const pg=new PGlite();t.after(()=>pg.close());await pg.exec(REQUEST_ANALYTICS_SCHEMA);await pg.exec(REQUEST_ANALYTICS_HISTORY_SCHEMA);return pg;}
test('fixed endpoint families discard private activity and never retain request-specific values',async t=>{
 const pg=await fixture(t);let elapsed=0;const writes=[];
 const service=createRequestAnalytics({db:{isConnected:()=>true,query:(sql,params)=>{writes.push({sql,params});return pg.query(sql,params);}},now:()=>start,monotonic:()=>elapsed,schedule(){}});
 for(const path of ['/vault/personal','/%76ault/personal','/vpn/connect','/auth/social/google/callback','/auth/device/secret','/security/vault-connection']){assert.equal(endpointFamily(path),null);visit(service,path);}
 visit(service,'/messages/private-conversation-id',503,{before:()=>{elapsed+=2500;}});
 visit(service,'/office/analytics/requests');visit(service,'/health');visit(service,'/unknown/private-person-id',404);
 assert.equal(service.status().observed,4);assert.equal(await service.flush(),true);
 const result=await read(service);assert.equal(result.body.totals.requests,4);assert.equal(result.body.totals.errors,1);assert.equal(result.body.totals.clientErrors,1);assert.equal(result.body.totals.slowRequests,1);
 assert.deepEqual(result.body.byFamily.map(row=>row.family).sort(),['health','messaging','office','other']);
 assert.doesNotMatch(JSON.stringify(writes)+JSON.stringify(result.body),/private-conversation|private-person|private-credential|never-retain/);
 assert.equal(result.body.bytes.available,false);assert.equal(result.body.coverage.firstRecordedDay,'2026-11-05');assert.ok(result.body.coverage.missingDays.includes('2026-05-01'));
});
test('lost commit acknowledgement retries the same batch idempotently before newer requests flush',async t=>{
 const pg=await fixture(t);let failAfterCommit=true,flushCalls=0;
 const db={isConnected:()=>true,query:async(sql,params)=>{const result=await pg.query(sql,params);if(sql.startsWith('WITH accepted')){flushCalls++;if(failAfterCommit){failAfterCommit=false;throw Error('connection lost after durable commit');}}return result;}};
 const service=createRequestAnalytics({db,now:()=>start,monotonic:()=>0,schedule(){}});
 visit(service,'/feed');visit(service,'/feed');assert.equal(await service.flush(),false);assert.equal(service.status().pendingEvents,2);assert.equal(service.status().status,'retrying');
 visit(service,'/office/status');assert.equal(await service.flush(),true);assert.equal(service.status().pendingEvents,1);
 assert.equal(await service.flush(),true);assert.equal(service.status().pendingEvents,0);assert.equal(service.status().status,'ready');
 const rows=await pg.query('SELECT SUM(request_count)::int AS total FROM request_analytics_daily_counts');assert.equal(rows.rows[0].total,3);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS total FROM request_analytics_checkpoints')).rows[0].total,1,'One anonymous checkpoint per process, not one receipt per batch.');
 assert.equal(flushCalls,3);
});
test('shared flushes are single-flight, aborts count once and role totals remain separate',async t=>{
 const pg=await fixture(t);let calls=0,release;
 const db={isConnected:()=>true,query:async(sql,params)=>{if(sql.startsWith('WITH accepted')){calls++;if(release)await release;}return pg.query(sql,params);}};
 const api=createRequestAnalytics({db,role:'api',now:()=>start,monotonic:()=>0,schedule(){}});
 const pipeline=createRequestAnalytics({db,role:'pipeline',now:()=>start,monotonic:()=>0,schedule(){}});
 visit(api,'/feed',200,{abort:true});visit(pipeline,'/health');
 let unblock;release=new Promise(resolve=>{unblock=resolve;});const jobs=Array.from({length:20},()=>api.flush());assert.equal(calls,1);unblock();await Promise.all(jobs);release=null;
 await pipeline.flush();const result=await read(api);assert.equal(result.body.totals.requests,2);assert.equal(result.body.totals.aborted,1);
 assert.deepEqual(result.body.byRole.map(row=>row.role).sort(),['api','pipeline']);assert.equal(result.body.byStatus.find(row=>row.statusClass==='aborted').requests,1);
});
test('buffers stay bounded during outages and storage failures are never reported as durable success',async()=>{
 let connected=false,queries=0;
 const service=createRequestAnalytics({db:{isConnected:()=>connected,query:async()=>{queries++;throw Error('private-database-host');}},now:()=>start,monotonic:()=>0,schedule(){},maxPendingKeys:1,maxPendingEvents:2});
 visit(service,'/feed');visit(service,'/feed');visit(service,'/feed');visit(service,'/office/status');
 assert.equal(service.status().pendingKeys,1);assert.equal(service.status().pendingEvents,2);assert.equal(service.status().dropped,2);
 assert.equal(await service.flush(),false);assert.equal(queries,0);assert.equal(service.status().status,'unavailable');connected=true;assert.equal(await service.flush(),false);assert.equal(service.status().pendingEvents,2);assert.equal(service.status().status,'retrying');
 const result=await read(service);assert.equal(result.statusCode,503);assert.doesNotMatch(JSON.stringify(result.body),/private-database-host/);
 assert.match(result.body.storage.acknowledgement,/restart can lose buffered/);
});
test('invalid report date inputs and arbitrary dimensions are rejected before storage reads',async()=>{
 let calls=0;const service=createRequestAnalytics({db:{isConnected:()=>true,query:()=>{calls++;throw Error();}},now:()=>start,schedule(){}});
 for(const query of [{from:'2026-02-30'},{from:'2026-04-30'},{to:'2027-01-01'},{from:['2026-05-01']},{path:'/messages/private'}])assert.equal((await read(service,query)).statusCode,400);
 assert.equal(calls,0);
});
