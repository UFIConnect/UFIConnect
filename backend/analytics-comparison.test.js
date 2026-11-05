'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createAnalyticsComparison}=require('./analytics-comparison');
const {createAppHarness}=require('./test-support/app-harness');
const start=Date.parse('2026-11-05T04:00:00Z');
const child=(value,inspect=()=>{})=>({report:async(req,res)=>{inspect(req);res.json(value);}});
async function read(service,query={}){const res={statusCode:200,set(){return this;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};await service.report({query},res);return res;}
const first={available:true,generatedAt:new Date(start).toISOString(),history:{firstRecordedDay:'2026-08-11'},verification:{status:'verified'},
 daily:[{day:'2026-08-11',errors:0},{day:'2026-09-17',errors:0},{day:'2026-09-18',errors:1},{day:'2026-09-19',errors:0},{day:'2026-11-04',errors:0}],
 categories:[{viewType:'page',daily:[{day:'2026-08-11',views:2},{day:'2026-09-18',views:3}]},{viewType:'tab',daily:[{day:'2026-09-17',views:5}]}]};
const edge={available:true,status:'fresh',generatedAt:new Date(start-10000).toISOString(),coverage:{firstRecordedDay:'2026-05-25'},
 daily:[{day:'2026-05-25',requests:100,pageViews:20},{day:'2026-11-04',requests:200,pageViews:50}]};
test('comparison preserves independent coverage, nulls and corrected anonymous registration dates without unique or conversion claims',async t=>{
 const pg=new PGlite();t.after(()=>pg.close());await pg.exec(`CREATE TABLE users(id UUID,created_at TIMESTAMPTZ,email TEXT,name TEXT);
 CREATE TABLE registration_history_date_corrections(user_id UUID,registered_day DATE);
 CREATE TABLE registration_history_daily_counts(day DATE,event_count BIGINT);
 INSERT INTO users VALUES('a0000000-0000-4000-8000-000000000001','2026-10-08','private-email@example.invalid','private-name'),
 ('b0000000-0000-4000-8000-000000000002','2026-08-20','other-private-email@example.invalid','other-private-name');
 INSERT INTO registration_history_date_corrections VALUES('a0000000-0000-4000-8000-000000000001','2026-05-31');
 INSERT INTO registration_history_daily_counts VALUES('2026-08-12',1);`);
 let reads=0;const service=createAnalyticsComparison({db:{isConnected:()=>true,query:(...args)=>pg.query(...args)},now:()=>start,
 trafficAnalytics:child(edge),aggregateAnalytics:child(first,req=>{reads++;assert.equal(req.query.detail,'compact');})});
 const result=await read(service);assert.equal(result.statusCode,200);const byDay=new Map(result.body.daily.map(row=>[row.day,row]));
 assert.equal(byDay.get('2026-05-01').edgeRequests,null);assert.equal(byDay.get('2026-05-25').edgeRequests,100);
 assert.equal(byDay.get('2026-05-25').webPageOpens,null);assert.equal(byDay.get('2026-08-11').webPageOpens,2);
 assert.equal(byDay.get('2026-09-19').webPageOpens,0);assert.equal(byDay.get('2026-09-19').tabOpens,0);
 assert.equal(byDay.get('2026-11-04').mobileScreenOpens,null);assert.equal(byDay.get('2026-09-17').diagnostics,null);
 assert.equal(byDay.get('2026-09-18').diagnostics,1);assert.equal(byDay.get('2026-09-19').diagnostics,0);
 assert.equal(byDay.get('2026-05-31').registrations,1);assert.equal(byDay.get('2026-08-12').registrations,1);
 assert.equal(byDay.get('2026-08-20').registrations,1);assert.equal(byDay.get('2026-10-08').registrations,0,'Earlier correction is not a second registration.');
 assert.doesNotMatch(JSON.stringify(result.body),/private-email|private-name|a0000000/);assert.match(result.body.definitions.comparison,/Do not add/);
 assert.equal(reads,1);
});
test('concurrent comparison readers share small canonical snapshots and partial providers keep other metrics usable',async()=>{
 let clock=start,calls=0,release;const gate=new Promise(resolve=>{release=resolve;});
 const service=createAnalyticsComparison({db:{isConnected:()=>false},now:()=>clock,
 trafficAnalytics:{report:async()=>{throw Error('private-provider-credential');}},aggregateAnalytics:{report:async(req,res)=>{calls++;await gate;res.json(first);}}});
 const jobs=Array.from({length:12},()=>read(service));assert.equal(calls,1);release();
 const values=await Promise.all(jobs);assert.ok(values.every(value=>value.statusCode===200));
 const report=values[0].body;assert.equal(report.sources.edge.status,'unavailable');assert.equal(report.sources.registrations.status,'unavailable');
 assert.equal(report.daily.find(row=>row.day==='2026-08-11').webPageOpens,2);
 assert.equal(report.daily.every(row=>row.edgeRequests===null&&row.registrations===null),true);assert.doesNotMatch(JSON.stringify(report),/private-provider/);
 await read(service);assert.equal(calls,1);clock+=15001;await read(service);assert.equal(calls,2);
 assert.equal((await read(service,{url:'https://unrelated.example'})).statusCode,400);
});
test('unavailable comparisons remain unavailable on cached reads and analytics routes require Office access',async t=>{
 const broken={report:async()=>{throw Error('private-error');}};
 const service=createAnalyticsComparison({db:{isConnected:()=>false},now:()=>start,trafficAnalytics:broken,aggregateAnalytics:broken});
 assert.equal((await read(service)).statusCode,503);assert.equal((await read(service)).statusCode,503);
 const app=await createAppHarness({env:{OFFICE_TOKEN:'requests-test-office'}});t.after(()=>app.close());
 for(const path of ['/office/analytics/requests','/office/analytics/comparison']){
   assert.equal((await app.request(path)).status,401);assert.equal((await app.request(path,{headers:{'x-office-token':'incorrect'}})).status,401);
   const authorized=await app.request(path,{headers:{'x-office-token':'requests-test-office'}});assert.equal(authorized.status,503);assert.equal(authorized.data.available,false);
 }
});
