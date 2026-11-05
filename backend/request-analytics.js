'use strict';
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const START = '2026-05-01', DAY = 86400000;
const FAMILIES = ['health','analytics','office','feed','auth','profile','community','messaging','connections','careers','billing','travel','media','other'];
const STATUSES = ['1xx','2xx','3xx','4xx','5xx','aborted'];
const LATENCIES = ['under_100ms','100_499ms','500_1999ms','2_10s','over_10s'];
const sqlList = values => values.map(value => `'${value}'`).join(',');
const REQUEST_ANALYTICS_SCHEMA = `CREATE TABLE IF NOT EXISTS request_analytics_daily_counts (
  day DATE NOT NULL CHECK(day >= DATE '2026-05-01'),
  role TEXT NOT NULL CHECK(role IN ('api','pipeline')),
  family TEXT NOT NULL CHECK(family IN (${sqlList(FAMILIES)})),
  status_class TEXT NOT NULL CHECK(status_class IN (${sqlList(STATUSES)})),
  latency_bucket TEXT NOT NULL CHECK(latency_bucket IN (${sqlList(LATENCIES)})),
  request_count BIGINT NOT NULL CHECK(request_count > 0),
  duration_ms BIGINT NOT NULL CHECK(duration_ms >= 0),
  first_observed_at TIMESTAMPTZ NOT NULL, last_observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(day,role,family,status_class,latency_bucket)
);
CREATE TABLE IF NOT EXISTS request_analytics_checkpoints (
  instance_id UUID PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('api','pipeline')),
  sequence BIGINT NOT NULL CHECK(sequence > 0), last_observed_at TIMESTAMPTZ NOT NULL
)`;
const FLUSH_SQL = `WITH accepted AS (
  INSERT INTO request_analytics_checkpoints AS checkpoint(instance_id,role,sequence,last_observed_at)
  VALUES($1::uuid,$2,$3::bigint,$5::timestamptz)
  ON CONFLICT(instance_id) DO UPDATE SET sequence=EXCLUDED.sequence,last_observed_at=EXCLUDED.last_observed_at
  WHERE checkpoint.role=EXCLUDED.role AND checkpoint.sequence < EXCLUDED.sequence
  RETURNING instance_id
), incoming AS (
  SELECT * FROM jsonb_to_recordset($4::jsonb)
  AS row(day DATE,family TEXT,status_class TEXT,latency_bucket TEXT,request_count BIGINT,duration_ms BIGINT)
), saved AS (
  INSERT INTO request_analytics_daily_counts AS existing
    (day,role,family,status_class,latency_bucket,request_count,duration_ms,first_observed_at,last_observed_at)
  SELECT day,$2,family,status_class,latency_bucket,request_count,duration_ms,$5::timestamptz,$5::timestamptz
  FROM incoming WHERE EXISTS(SELECT 1 FROM accepted)
  ON CONFLICT(day,role,family,status_class,latency_bucket) DO UPDATE
  SET request_count=existing.request_count+EXCLUDED.request_count,duration_ms=existing.duration_ms+EXCLUDED.duration_ms,
    last_observed_at=GREATEST(existing.last_observed_at,EXCLUDED.last_observed_at)
  RETURNING day
) SELECT COUNT(*)::int AS saved_buckets FROM saved`;
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
function endpointFamily(path) {
  if (typeof path !== 'string' || path.length > 8192) return 'other';
  try { path=decodeURIComponent(path); } catch { return 'other'; }
  // Private activity is excluded before aggregation. Only constants selected
  // below survive this function; no route, query, identity or body is stored.
  if (/^\/(?:vault|vpn|oauth|security|app\/vpn|auth\/(?:callback|devices?|phone|qr))(?:\/|$)/i.test(path)
    || /^\/auth(?:\/[^/]+)*\/callback(?:\/|$)/i.test(path)) return null;
  if (/^\/(?:health|readyz)(?:\/|$)/.test(path)) return 'health';
  if (/^\/(?:analytics|client-error|negative-signal)(?:\/|$)/.test(path)) return 'analytics';
  if (/^\/(?:office|hq)(?:\/|$)/.test(path)) return 'office';
  if (/^\/(?:feed|source|sources|posts\/engagement-signal)(?:\/|$)/.test(path)) return 'feed';
  if (/^\/(?:auth|login|logout|register|password|forgot-password|reset-password|verify-email)(?:\/|$)/.test(path)) return 'auth';
  if (/^\/(?:profile|users|members|settings|notifications|account)(?:\/|$)/.test(path)) return 'profile';
  if (/^\/(?:groups|posts|comments|reports|snaps)(?:\/|$)/.test(path)) return 'community';
  if (/^\/(?:messages|conversations|inbox|chat)(?:\/|$)/.test(path)) return 'messaging';
  if (/^\/(?:connections|following|social|connected)(?:\/|$)/.test(path)) return 'connections';
  if (/^\/(?:jobs|opportunities|resume|business|career)(?:\/|$)/.test(path)) return 'careers';
  if (/^\/(?:billing|payments|stripe|webhooks)(?:\/|$)/.test(path)) return 'billing';
  if (/^\/(?:travel|maps|countries|city|cameras)(?:\/|$)/.test(path)) return 'travel';
  if (/^\/(?:media|uploads|generate|videos|music|images)(?:\/|$)/.test(path)) return 'media';
  return 'other';
}
const bucket = ms => ms < 100 ? LATENCIES[0] : ms < 500 ? LATENCIES[1] : ms < 2000 ? LATENCIES[2] : ms < 10000 ? LATENCIES[3] : LATENCIES[4];
const SUMMARIES=`COALESCE(SUM(request_count),0)::bigint AS requests,
  COALESCE(SUM(request_count) FILTER(WHERE status_class='5xx'),0)::bigint AS errors,
  COALESCE(SUM(request_count) FILTER(WHERE status_class='4xx'),0)::bigint AS "clientErrors",
  COALESCE(SUM(request_count) FILTER(WHERE latency_bucket IN ('2_10s','over_10s')),0)::bigint AS "slowRequests",
  COALESCE(SUM(request_count) FILTER(WHERE status_class='aborted'),0)::bigint AS aborted,
  COALESCE(SUM(duration_ms),0)::bigint AS "durationMs"`;
const grouped=(columns,group,order)=>`COALESCE((SELECT jsonb_agg(to_jsonb(summary) ORDER BY ${order}) FROM
  (SELECT ${columns},${SUMMARIES} FROM matching GROUP BY ${group}) summary),'[]'::jsonb)`;
const REPORT_SQL=`WITH matching AS MATERIALIZED (
  SELECT * FROM request_analytics_daily_counts WHERE day >= $1::date AND day <= $2::date
) SELECT (SELECT to_jsonb(summary) FROM (SELECT ${SUMMARIES} FROM matching) summary) AS totals,
  ${grouped('day::text AS day','day','day')} AS daily,
  ${grouped('day::text AS day,role','day,role','day,role')} AS daily_roles,
  ${grouped('role','role','role')} AS by_role,
  ${grouped('family','family','family')} AS by_family,
  COALESCE((SELECT jsonb_agg(to_jsonb(summary) ORDER BY "statusClass") FROM
    (SELECT status_class AS "statusClass",SUM(request_count)::bigint AS requests FROM matching GROUP BY status_class) summary),'[]'::jsonb) AS by_status,
  COALESCE((SELECT jsonb_agg(to_jsonb(summary) ORDER BY "latencyBucket") FROM
    (SELECT latency_bucket AS "latencyBucket",SUM(request_count)::bigint AS requests FROM matching GROUP BY latency_bucket) summary),'[]'::jsonb) AS by_latency`;
function numericRow(row,identity=[]){
  const result={};for(const[key,value]of Object.entries(row)){if(identity.includes(key))result[key]=value;
    else{const count=Number(value);if(!Number.isSafeInteger(count)||count<0)throw Error('Invalid aggregate count');result[key]=count;}}return result;
}
function createRequestAnalytics({ db, role = 'api', now = Date.now, monotonic = () => performance.now(), schedule = setInterval,
  maxPendingKeys = 4096, maxPendingEvents = 1000000 } = {}) {
  if (!['api','pipeline'].includes(role)) throw Error('Invalid telemetry role');
  const instance = randomUUID(), since = new Date(now()).toISOString();
  let pending = new Map(), pendingCount = 0, batch = null, sequence = 0, flushing = null, cache = null, reportPending = null, revision = 0;
  let observed = 0, dropped = 0, writeFailures = 0, lastPersistedAt = null, lastFlushFailed = false;
  const pendingEvents = () => pendingCount;
  const status = () => ({ scope:'current-process', since, role, pendingKeys:pending.size+(batch?.rows.length||0),
    pendingEvents:pendingEvents()+(batch?.events||0), observed,dropped,writeFailures,lastPersistedAt,
    connected:Boolean(db?.isConnected?.()), status:!db?.isConnected?.()?'unavailable':lastFlushFailed?'retrying':'ready',
    persistence:'batched-after-response', flushIntervalMs:30000,
    acknowledgement:'User responses do not wait for metrics storage. Only flushed aggregates are durable; a restart can lose buffered requests.' });
  function middleware(req,res,next) {
    const family = endpointFamily(req.path || ''); if (!family) return next();
    const started = monotonic(); let recorded = false;
    function record(aborted = false) {
      if (recorded) return; recorded = true; observed++;
      const day = new Date(now()).toISOString().slice(0,10);
      const ms = Math.round(Math.max(0,Math.min(300000,monotonic()-started)));
      const statusClass = aborted ? 'aborted' : `${Math.max(1,Math.min(5,Math.floor(Number(res.statusCode||500)/100)))}xx`;
      const latency = bucket(ms), key = JSON.stringify([day,family,statusClass,latency]);
      if (day < START || (!pending.has(key) && pending.size >= maxPendingKeys) || pendingEvents() >= maxPendingEvents) { dropped++; return; }
      const row = pending.get(key) || {day,family,status_class:statusClass,latency_bucket:latency,request_count:0,duration_ms:0};
      row.request_count++; row.duration_ms+=ms; pending.set(key,row); pendingCount++;
    }
    const original = res.writeHead;
    if (typeof original === 'function') res.writeHead = function(...args) { const result=original.apply(this,args); record(); return result; };
    res.once('finish',()=>record()); res.once('close',()=>record(!res.headersSent));
    next();
  }
  function flush() {
    if (flushing) return flushing;
    if (!db?.isConnected?.()) return Promise.resolve(false);
    if (!batch && !pending.size) return Promise.resolve(true);
    if (!batch) { const rows=[...pending.values()]; pending=new Map(); pendingCount=0; batch={rows,sequence:++sequence,events:rows.reduce((sum,row)=>sum+row.request_count,0),at:new Date(now()).toISOString()}; }
    const writing=batch;
    flushing=(async()=>{
      try {
        await db.query(FLUSH_SQL,[instance,role,writing.sequence,JSON.stringify(writing.rows),writing.at]);
        if (batch===writing) batch=null;
        lastPersistedAt=new Date(now()).toISOString(); lastFlushFailed=false; revision++; cache=null; return true;
      } catch { writeFailures++; lastFlushFailed=true; return false; }
    })().finally(()=>{flushing=null;});
    return flushing;
  }
  const timer=schedule(()=>{void flush();},30000); timer?.unref?.();
  async function load(from,to) {
    const key=JSON.stringify([from,to]);
    if(cache?.key===key && now()-cache.at<15000)return cache.value;
    if(reportPending?.key===key)return reportPending.promise;
    const operation={key,revision};
    operation.promise=(async()=>{
      const {rows:[snapshot]}=await db.query(REPORT_SQL,[from,to]);
      const totals=numericRow(snapshot.totals),daily=snapshot.daily.map(row=>numericRow(row,['day']));
      const observedDays=new Set(daily.map(row=>row.day));
      const missingDays=[];for(let day=Date.parse(from);day<=Date.parse(to);day+=DAY){const value=new Date(day).toISOString().slice(0,10);if(!observedDays.has(value))missingDays.push(value);}
      const result={available:true,source:'durable-incoming-http',range:{from,to,timezone:'UTC'},generatedAt:new Date(now()).toISOString(),
        totals,daily,dailyByRole:snapshot.daily_roles.map(row=>numericRow(row,['day','role'])),byRole:snapshot.by_role.map(row=>numericRow(row,['role'])),
        byFamily:snapshot.by_family.map(row=>numericRow(row,['family'])),byStatus:snapshot.by_status.map(row=>numericRow(row,['statusClass'])),
        byLatency:snapshot.by_latency.map(row=>numericRow(row,['latencyBucket'])),
        coverage:{firstRecordedDay:daily[0]?.day||null,lastRecordedDay:daily.at(-1)?.day||null,observedDays:daily.length,missingDays,
          note:'Collection begins with this release. Absent days are unobserved, not historical zero requests. The first and current collection days may be partial.'},
        definition:'One incoming request is counted when response headers are sent, or as aborted if disconnected first. API and pipeline requests include bots, probes and Office polling, not unique people.',
        measurement:'Server time to response headers; excludes client transit and response streaming. Latency buckets are not exact percentiles.',
        exclusions:['Vault requests','VPN requests','OAuth callbacks','Device authorization'],bytes:{available:false,reason:'Bodies and raw headers are not inspected or retained.'}};
      if(reportPending===operation&&operation.revision===revision)cache={key,value:result,at:now()};return result;
    })(); reportPending=operation;
    try{return await operation.promise;}finally{if(reportPending===operation)reportPending=null;}
  }
  async function report(req,res){
    res.set('Cache-Control','private, no-store');
    const today=new Date(now()).toISOString().slice(0,10),from=req.query?.from||START,to=req.query?.to||today;
    if(!validDay(from)||!validDay(to)||from<START||to>today||from>to||(Date.parse(to)-Date.parse(from))/DAY>4000
      ||Object.keys(req.query||{}).some(key=>!['from','to'].includes(key)))return res.status(400).json({available:false,error:'Choose valid UTC dates since May 2026.'});
    if(!db?.isConnected?.())return res.status(503).json({available:false,error:'Request analytics storage is unavailable.',storage:status()});
    try{const persisted=await flush();const result=await load(from,to);return res.json({...result,storage:{...status(),flushSucceeded:persisted}});}
    catch{return res.status(503).json({available:false,error:'Request analytics storage is unavailable.',storage:status()});}
  }
  return{middleware,flush,report,status};
}
module.exports={createRequestAnalytics,REQUEST_ANALYTICS_SCHEMA,endpointFamily};
