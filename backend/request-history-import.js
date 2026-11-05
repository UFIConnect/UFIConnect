'use strict';
const { REQUEST_HISTORY_CUTOFF, REQUEST_HISTORY_FAMILIES } = require('./request-history-schema');
const SOURCES=['render-request-logs','render-http-metrics'];
const bad=()=>Object.assign(new Error('Invalid anonymous request-history snapshot.'),{code:'invalid_request_history'});
const narrowing=()=>Object.assign(new Error('The snapshot would narrow previously preserved request-history coverage.'),{code:'request_history_narrowing'});
function keys(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw bad();}
function day(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||value<'2026-05-01'||value>=REQUEST_HISTORY_CUTOFF)throw bad();return value;}
function instant(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value.slice(0,10))throw bad();
 // PostgreSQL persists microseconds. Truncate finer provider precision before
 // validation/storage so a near-midnight timestamp cannot round into a new day.
 return value.replace(/\.(\d{7,9})Z$/,(_match,digits)=>'.'+digits.slice(0,6)+'Z');
}
const time=value=>{instant(value);const[whole,fraction='']=value.slice(0,-1).split('.');return BigInt(Date.parse(whole+'Z'))*1000000n+BigInt(fraction.padEnd(9,'0'));};
const iso=value=>value instanceof Date?value.toISOString():String(value);
const calendar=value=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10);
const nextDay=value=>new Date(Date.parse(value)+86400000).toISOString();
const count=(value,zero=false)=>{if(!Number.isSafeInteger(value)||value<(zero?0:1))throw bad();return value;};
function validateRequestHistorySnapshot(input){
 keys(input,['source','role','requestedFrom','requestedToExclusive','firstObservedAt','lastObservedAt','complete','completeDays','partialDays','rows']);
 if(!SOURCES.includes(input.source)||!['api','pipeline'].includes(input.role)||input.complete!==true||!Array.isArray(input.rows)||input.rows.length>20000
  ||!Array.isArray(input.completeDays)||!Array.isArray(input.partialDays)||input.completeDays.length+input.partialDays.length>4000)throw bad();
 const from=instant(input.requestedFrom),to=instant(input.requestedToExclusive);
 if(time(from)<time('2026-05-01T00:00:00Z')||time(from)>=time(to)||time(to)>time(REQUEST_HISTORY_CUTOFF+'T00:00:00Z'))throw bad();
 if((input.firstObservedAt===null)!==(input.lastObservedAt===null))throw bad();
 const first=input.firstObservedAt===null?null:instant(input.firstObservedAt),last=input.lastObservedAt===null?null:instant(input.lastObservedAt);
 if(first&&(time(first)<time(from)||time(last)>time(to)||time(first)>time(last)))throw bad();
 const covered=new Set(),completeDays=input.completeDays.map(value=>{
  const d=day(value);if(covered.has(d)||time(d+'T00:00:00Z')<time(from)||time(nextDay(d))>time(to))throw bad();covered.add(d);return d;
 }).sort();
 const partialDays=input.partialDays.map(value=>{
  keys(value,['day','from','toExclusive','reason']);const d=day(value.day),a=instant(value.from),b=instant(value.toExclusive);
  if(covered.has(d)||value.reason!=='provider-retention'||time(a)<time(d+'T00:00:00Z')||time(b)>time(nextDay(d))||time(a)>=time(b)||time(a)<time(from)||time(b)>time(to))throw bad();
  covered.add(d);return{day:d,from:a,toExclusive:b,reason:'provider-retention'};
 }).sort((a,b)=>a.day.localeCompare(b.day));
 if(!covered.size)throw bad();
 const partial=new Map(partialDays.map(row=>[row.day,row])),identities=new Set();
 let total=0;
 const rows=input.rows.map(value=>{
  const provider=input.source==='render-http-metrics';
  keys(value,provider?['source','day','role','status_code','request_count','observed_at']:
   ['source','day','role','family','status_class','latency_bucket','request_count','duration_ms','first_observed_at','last_observed_at']);
  const d=day(value.day);if(value.source!==input.source||value.role!==input.role||!covered.has(d))throw bad();
  let row;
  if(provider){
   const status=typeof value.status_code==='string'&&/^[1-5][0-9]{2}$/.test(value.status_code)?Number(value.status_code):value.status_code;
   if(!Number.isInteger(status)||(status!==0&&(status<100||status>599)))throw bad();
   row={source:input.source,day:d,role:input.role,status_code:status,request_count:count(value.request_count,true),observed_at:instant(value.observed_at)};
  }else{
   if(!REQUEST_HISTORY_FAMILIES.includes(value.family)||!['1xx','2xx','3xx','4xx','5xx','unknown'].includes(value.status_class)||value.latency_bucket!=='unknown'||value.duration_ms!==null)throw bad();
   const a=instant(value.first_observed_at),b=instant(value.last_observed_at),window=partial.get(d);
   if(!first||a.slice(0,10)!==d||b.slice(0,10)!==d||time(a)>time(b)||time(a)<time(first)||time(b)>time(last)||time(a)<time(from)||time(b)>=time(to)
    ||(window&&(time(a)<time(window.from)||time(b)>=time(window.toExclusive))))throw bad();
   row={source:input.source,day:d,role:input.role,family:value.family,status_class:value.status_class,latency_bucket:'unknown',request_count:count(value.request_count),duration_ms:null,first_observed_at:a,last_observed_at:b};
  }
  total+=row.request_count;if(!Number.isSafeInteger(total))throw bad();
  const identity=JSON.stringify(provider?[d,row.status_code]:[d,row.family,row.status_class,row.latency_bucket]);if(identities.has(identity))throw bad();identities.add(identity);return row;
 });
 return{source:input.source,role:input.role,requestedFrom:from,requestedToExclusive:to,firstObservedAt:first,lastObservedAt:last,complete:true,completeDays,partialDays,rows};
}
function preserveCoverage(old,snapshot){
 if(!old)return;
 if(time(snapshot.requestedFrom)>time(iso(old.requested_from))||time(snapshot.requestedToExclusive)<time(iso(old.requested_to_exclusive)))throw narrowing();
 const complete=new Set(snapshot.completeDays),partial=new Map(snapshot.partialDays.map(row=>[row.day,row]));
 if((old.complete_days||[]).some(value=>!complete.has(calendar(value))))throw narrowing();
 for(const previous of old.partial_days||[]){if(complete.has(previous.day))continue;const next=partial.get(previous.day);
  if(!next||time(next.from)>time(previous.from)||time(next.toExclusive)<time(previous.toExclusive))throw narrowing();}
 if(old.first_observed_at&&(snapshot.firstObservedAt===null||time(snapshot.firstObservedAt)>time(iso(old.first_observed_at))
  ||time(snapshot.lastObservedAt)<time(iso(old.last_observed_at))))throw narrowing();
}
async function importRequestHistorySnapshot({db,snapshot:input,now=Date.now}){
 const snapshot=validateRequestHistorySnapshot(input);
 if(typeof db?.withClient!=='function')throw new TypeError('A transactional database adapter is required.');
 return db.withClient(async client=>{
  await client.query('BEGIN');
  try{
   await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`anonymous-request-history:${snapshot.source}:${snapshot.role}`]);
   const old=(await client.query(`SELECT to_char(requested_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS requested_from,
    to_char(requested_to_exclusive AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS requested_to_exclusive,
    to_char(first_observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS first_observed_at,
    to_char(last_observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS last_observed_at,complete_days,partial_days
    FROM request_analytics_history_coverage WHERE source=$1 AND role=$2 FOR UPDATE`,[snapshot.source,snapshot.role])).rows[0];
   preserveCoverage(old,snapshot);
   const provider=snapshot.source==='render-http-metrics',table=provider?'request_analytics_provider_daily_counts':'request_analytics_history_daily_counts';
   await client.query(`DELETE FROM ${table} WHERE source=$1 AND role=$2`,[snapshot.source,snapshot.role]);
   if(snapshot.rows.length){
    const columns=provider?'source,day,role,status_code,request_count,observed_at':'source,day,role,family,status_class,latency_bucket,request_count,duration_ms,first_observed_at,last_observed_at';
    const typed=provider?'source TEXT,day DATE,role TEXT,status_code INTEGER,request_count BIGINT,observed_at TIMESTAMPTZ':
     'source TEXT,day DATE,role TEXT,family TEXT,status_class TEXT,latency_bucket TEXT,request_count BIGINT,duration_ms BIGINT,first_observed_at TIMESTAMPTZ,last_observed_at TIMESTAMPTZ';
    await client.query(`INSERT INTO ${table}(${columns}) SELECT ${columns} FROM jsonb_to_recordset($1::jsonb) AS incoming(${typed})`,[JSON.stringify(snapshot.rows)]);
   }
   await client.query(`INSERT INTO request_analytics_history_coverage(source,role,requested_from,requested_to_exclusive,first_observed_at,last_observed_at,complete,complete_days,partial_days,imported_at)
    VALUES($1,$2,$3::timestamptz,$4::timestamptz,$5::timestamptz,$6::timestamptz,true,$7::date[],$8::jsonb,$9::timestamptz)
    ON CONFLICT(source,role) DO UPDATE SET requested_from=EXCLUDED.requested_from,requested_to_exclusive=EXCLUDED.requested_to_exclusive,
     first_observed_at=EXCLUDED.first_observed_at,last_observed_at=EXCLUDED.last_observed_at,complete_days=EXCLUDED.complete_days,partial_days=EXCLUDED.partial_days,imported_at=EXCLUDED.imported_at`,
   [snapshot.source,snapshot.role,snapshot.requestedFrom,snapshot.requestedToExclusive,snapshot.firstObservedAt,snapshot.lastObservedAt,snapshot.completeDays,JSON.stringify(snapshot.partialDays),new Date(now()).toISOString()]);
   await client.query('COMMIT');
   return{source:snapshot.source,role:snapshot.role,rows:snapshot.rows.length,requests:snapshot.rows.reduce((sum,row)=>sum+row.request_count,0),completeDays:snapshot.completeDays.length,partialDays:snapshot.partialDays.length};
  }catch(error){await client.query('ROLLBACK');throw error;}
 });
}
module.exports={validateRequestHistorySnapshot,importRequestHistorySnapshot};
