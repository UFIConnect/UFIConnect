'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {REQUEST_ANALYTICS_HISTORY_SCHEMA}=require('./request-history-schema');
const {validateRequestHistorySnapshot,importRequestHistorySnapshot}=require('./request-history-import');
const first='2026-10-22T05:51:23.688724865Z',last='2026-10-23T23:59:59.999999999Z';
function logs(role='api'){
 return{source:'render-request-logs',role,requestedFrom:first,requestedToExclusive:'2026-10-24T00:00:00Z',firstObservedAt:first,lastObservedAt:last,complete:true,
  completeDays:['2026-10-23'],partialDays:[{day:'2026-10-22',from:first,toExclusive:'2026-10-23T00:00:00Z',reason:'provider-retention'}],
  rows:[{source:'render-request-logs',day:'2026-10-22',role,family:'feed',status_class:'2xx',latency_bucket:'unknown',request_count:10,duration_ms:null,first_observed_at:first,last_observed_at:'2026-10-22T23:59:59.999999999Z'},
   {source:'render-request-logs',day:'2026-10-23',role,family:'office',status_class:'4xx',latency_bucket:'unknown',request_count:5,duration_ms:null,first_observed_at:'2026-10-23T10:00:00Z',last_observed_at:last}]};
}
function provider(role='api'){
 return{source:'render-http-metrics',role,requestedFrom:'2026-10-23T00:00:00Z',requestedToExclusive:'2026-10-24T00:00:00Z',firstObservedAt:'2026-10-23T00:00:00Z',lastObservedAt:'2026-10-24T00:00:00Z',
  complete:true,completeDays:['2026-10-23'],partialDays:[],rows:[{source:'render-http-metrics',day:'2026-10-23',role,status_code:'200',request_count:20,observed_at:'2026-11-05T06:30:00Z'}]};
}
async function fixture(t){
 const pg=new PGlite();t.after(()=>pg.close());await pg.exec(REQUEST_ANALYTICS_HISTORY_SCHEMA);const queries=[];
 const db={withClient:async fn=>fn({query:async(sql,params)=>{queries.push(sql);
  // PGlite is single-process; real PostgreSQL supplies the transaction-scoped
  // advisory lock. Exercise every data/coverage statement against real SQL.
  if(sql.startsWith('SELECT pg_advisory_xact_lock'))return{rows:[]};return pg.query(sql,params);
 }})};return{pg,db,queries};
}
test('strict snapshots reject raw fields, duplicates, Nov5 overlap, incomplete or inferred timing before opening a transaction',async()=>{
 const invalid=[];
 let value=logs();value.rawPath='/vault/private';invalid.push(value);
 value=logs();value.rows[0].requestId='private-id';invalid.push(value);
 value=logs();value.rows[0].family='/users/private-id';invalid.push(value);
 value=logs();value.rows[0].latency_bucket='under_100ms';value.rows[0].duration_ms=10;invalid.push(value);
 value=logs();value.rows[0].status_class='aborted';invalid.push(value);
 value=logs();value.rows.push({...value.rows[0]});invalid.push(value);
 value=logs();value.complete=false;invalid.push(value);
 value=logs();value.requestedToExclusive='2026-11-05T00:00:01Z';invalid.push(value);
 value=logs();value.rows[0].day='2026-11-05';invalid.push(value);
 value=logs();value.completeDays.push('2026-10-22');invalid.push(value);
 value=logs();value.firstObservedAt='2026-10-22T07:00:00Z';invalid.push(value);
 value=provider();value.rows[0].request_count=-1;invalid.push(value);
 value=provider();value.rows[0].status_code=999;invalid.push(value);
 let opened=0;for(const snapshot of invalid)await assert.rejects(importRequestHistorySnapshot({db:{withClient(){opened++;}},snapshot}),{code:'invalid_request_history'});
 assert.equal(opened,0);
});
test('exact reimports preserve totals, replace stale buckets and isolate roles and provider scopes',async t=>{
 const{pg,db,queries}=await fixture(t);
 await importRequestHistorySnapshot({db,snapshot:logs()});await importRequestHistorySnapshot({db,snapshot:logs()});
 await importRequestHistorySnapshot({db,snapshot:logs('pipeline')});await importRequestHistorySnapshot({db,snapshot:provider()});
 assert.equal((await pg.query('SELECT SUM(request_count)::int AS total FROM request_analytics_history_daily_counts')).rows[0].total,30);
 assert.equal((await pg.query('SELECT SUM(request_count)::int AS total FROM request_analytics_provider_daily_counts')).rows[0].total,20);
 const replacement=logs();replacement.rows=[{...replacement.rows[0],request_count:7}];
 await importRequestHistorySnapshot({db,snapshot:replacement});
 const counts=(await pg.query('SELECT role,SUM(request_count)::int AS total FROM request_analytics_history_daily_counts GROUP BY role ORDER BY role')).rows;
 assert.deepEqual(counts,[{role:'api',total:7},{role:'pipeline',total:15}]);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS total FROM request_analytics_history_coverage')).rows[0].total,3);
 assert.ok(queries.some(sql=>sql.startsWith('SELECT pg_advisory_xact_lock')));assert.ok(queries.some(sql=>sql.includes('FOR UPDATE')));
 assert.equal((await pg.query("SELECT MIN(day)::text AS day FROM request_analytics_history_daily_counts")).rows[0].day,'2026-10-22','Nanosecond timestamps do not round into the following UTC day.');
});
test('narrower retention windows or loss of complete days cannot delete previously preserved history',async t=>{
 const{pg,db}=await fixture(t);await importRequestHistorySnapshot({db,snapshot:logs()});
 for(const mutate of [snapshot=>{snapshot.requestedFrom='2026-10-22T06:00:00Z';snapshot.firstObservedAt=snapshot.requestedFrom;snapshot.partialDays[0].from=snapshot.requestedFrom;snapshot.rows[0].first_observed_at=snapshot.requestedFrom;},
  snapshot=>{snapshot.completeDays=[];snapshot.rows=snapshot.rows.filter(row=>row.day==='2026-10-22');},
  snapshot=>{snapshot.firstObservedAt='2026-10-22T06:00:00Z';snapshot.rows[0].first_observed_at=snapshot.firstObservedAt;},
  snapshot=>{snapshot.partialDays[0].from='2026-10-22T06:00:00Z';snapshot.rows[0].first_observed_at=snapshot.partialDays[0].from;}]){
  const snapshot=logs();mutate(snapshot);await assert.rejects(importRequestHistorySnapshot({db,snapshot}),{code:'request_history_narrowing'});
 }
 assert.equal((await pg.query('SELECT SUM(request_count)::int AS total FROM request_analytics_history_daily_counts')).rows[0].total,15);
});
test('coverage write failure rolls data and metadata back together without exposing partial replacement',async t=>{
 const{pg,db}=await fixture(t);await importRequestHistorySnapshot({db,snapshot:logs()});
 const failing={withClient:fn=>db.withClient(client=>fn({query:(sql,params)=>{if(sql.startsWith('INSERT INTO request_analytics_history_coverage'))throw Error('Synthetic storage failure');return client.query(sql,params);}}))};
 const snapshot=logs();snapshot.rows[0].request_count=99;await assert.rejects(importRequestHistorySnapshot({db:failing,snapshot}),/Synthetic storage failure/);
 assert.equal((await pg.query('SELECT SUM(request_count)::int AS total FROM request_analytics_history_daily_counts')).rows[0].total,15);
 assert.equal((await pg.query('SELECT COUNT(*)::int AS total FROM request_analytics_history_coverage')).rows[0].total,1);
});
test('zero provider observations are exact observations rather than invented classified events',()=>{
 const snapshot=provider();snapshot.rows[0].request_count=0;const result=validateRequestHistorySnapshot(snapshot);
 assert.equal(result.rows[0].status_code,200);assert.equal(result.rows[0].request_count,0);
 assert.equal(result.lastObservedAt,'2026-10-24T00:00:00Z');
});
