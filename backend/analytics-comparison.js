'use strict';
const DAY=86400000,START='2026-05-01';
const REGISTRATIONS_QUERY=`WITH retained AS (
  SELECT LEAST((u.created_at AT TIME ZONE 'UTC')::date,c.registered_day) AS day
  FROM users u LEFT JOIN registration_history_date_corrections c ON c.user_id=u.id
  WHERE u.created_at <= $3::timestamptz
), counts AS (
  SELECT day,COUNT(*)::bigint AS registrations FROM retained
  WHERE day >= $1::date AND day <= $2::date GROUP BY day
  UNION ALL
  SELECT day,event_count AS registrations FROM registration_history_daily_counts
  WHERE day >= $1::date AND day <= $2::date
) SELECT day::text,SUM(registrations)::bigint AS registrations FROM counts GROUP BY day ORDER BY day`;
const safeCount=value=>{const number=Number(value);if(!Number.isSafeInteger(number)||number<0)throw Error('Invalid anonymous count');return number;};
async function capture(service,query={}){
 const res={statusCode:200,set(){return this;},status(value){this.statusCode=value;return this;},json(body){this.body=body;return this;}};
 await service.report({query},res);if(res.statusCode!==200||res.body?.available!==true)throw Error('Report unavailable');return res.body;
}
function createAnalyticsComparison({db,trafficAnalytics,aggregateAnalytics,now=Date.now}={}){
 let cache=null,pending=null;
 async function build(){
  const checkedAt=new Date(now()).toISOString(),to=checkedAt.slice(0,10),from=new Date(Math.max(Date.parse(START),Date.parse(to)-3999*DAY)).toISOString().slice(0,10);
  const registrations=async()=>{if(!db?.isConnected?.())throw Error('Storage unavailable');return(await db.query(REGISTRATIONS_QUERY,[from,to,checkedAt])).rows;};
  const [edgeResult,firstResult,registrationResult]=await Promise.allSettled([capture(trafficAnalytics),capture(aggregateAnalytics,{detail:'compact'}),registrations()]);
  const edge=edgeResult.status==='fulfilled'?edgeResult.value:null,first=firstResult.status==='fulfilled'?firstResult.value:null;
  const source=(data,scope)=>({status:data?(data.status||'ready'):'unavailable',firstRecordedDay:data?.coverage?.firstRecordedDay||data?.history?.firstRecordedDay||null,
    checkedAt:data?.lastSuccessAt||data?.generatedAt||null,scope});
  const sources={edge:source(edge,'Cloudflare zone HTTP traffic, including bots and assets; HTML views differ from in-app opens.'),
    firstParty:source(first,'Retained anonymous page, screen and tab opens. Repeat opens count. Collection gaps may exist.'),
    registrations:{status:registrationResult.status==='fulfilled'?'ready':'unavailable',firstRecordedDay:null,checkedAt:registrationResult.status==='fulfilled'?checkedAt:null,
      scope:'Retained account registration dates plus recovered-only registration counts. Includes earlier date corrections; excludes deleted or unrecovered registrations.'}};
  if(first?.verification?.status&&first.verification.status!=='verified')sources.firstParty.status=first.verification.status;
  const edges=new Map((edge?.daily||[]).map(row=>[row.day,row]));
  const firstDays=new Map((first?.daily||[]).map(row=>[row.day,row]));
  const opens=new Map(),metricStarts={webPageOpens:null,mobileScreenOpens:null,tabOpens:null,diagnostics:null};
  for(const category of first?.categories||[]){
    const metric=category.viewType==='tab'?'tabOpens':category.viewType==='screen'?'mobileScreenOpens':category.viewType==='page'?'webPageOpens':null;
    if(!metric)continue;
    for(const point of category.daily||[]){
      const n=safeCount(point.views);if(!n)continue;
      const row=opens.get(point.day)||{webPageOpens:0,mobileScreenOpens:0,tabOpens:0};row[metric]+=n;opens.set(point.day,row);
      if(!metricStarts[metric]||point.day<metricStarts[metric])metricStarts[metric]=point.day;
    }
  }
  for(const row of first?.daily||[])if(safeCount(row.errors)>0&&(!metricStarts.diagnostics||row.day<metricStarts.diagnostics))metricStarts.diagnostics=row.day;
  sources.firstParty.metricFirstRecordedDay=metricStarts;
  const registrationDays=new Map();
  if(registrationResult.status==='fulfilled')for(const row of registrationResult.value)registrationDays.set(row.day,safeCount(row.registrations));
  sources.registrations.firstRecordedDay=[...registrationDays.keys()].sort()[0]||null;
  const daily=[];
  for(let date=Date.parse(from);date<=Date.parse(to);date+=DAY){
    const day=new Date(date).toISOString().slice(0,10),edgeDay=edges.get(day),firstDay=firstDays.get(day),openDay=opens.get(day);
    const row={day,edgeRequests:edgeDay?safeCount(edgeDay.requests):null,htmlPageViews:edgeDay?safeCount(edgeDay.pageViews):null};
    for(const metric of ['webPageOpens','mobileScreenOpens','tabOpens'])row[metric]=firstDay&&metricStarts[metric]&&day>=metricStarts[metric]?openDay?.[metric]||0:null;
    row.diagnostics=firstDay&&metricStarts.diagnostics&&day>=metricStarts.diagnostics?safeCount(firstDay.errors):null;
    row.registrations=sources.registrations.firstRecordedDay&&day>=sources.registrations.firstRecordedDay?registrationDays.get(day)||0:null;
    daily.push(row);
  }
  return{available:Boolean(edge||first||registrationResult.status==='fulfilled'),range:{from,to,timezone:'UTC'},generatedAt:checkedAt,sources,daily,
    definitions:{comparison:'These are independent observations with different scopes. Do not add them together or interpret their ratios as conversion rates.',
      unknown:'Null means unobserved or unavailable for that metric. Zero means zero retained events on or after its first recorded day, not proof that collection was uninterrupted.',
      visitors:'No source in this report establishes unique people. Daily unique IP counts are not summed.',
      time:'UTC calendar days; today and first collection days may be partial.'}};
 }
 async function report(req,res){
  res.set('Cache-Control','private, no-store');
  if(Object.keys(req.query||{}).length)return res.status(400).json({available:false,error:'Comparison dates are selected from the shared report in Office.'});
  try{
    const today=new Date(now()).toISOString().slice(0,10);
    if(cache&&cache.day===today&&now()-cache.at<15000)return res.status(cache.value.available?200:503).json(cache.value);
    if(!pending)pending=build().then(value=>{cache={value,day:today,at:now()};return value;}).finally(()=>{pending=null;});
    const value=await pending;return res.status(value.available?200:503).json(value);
  }catch{return res.status(503).json({available:false,error:'Analytics comparison is temporarily unavailable.'});}
 }
 return{report};
}
module.exports={createAnalyticsComparison,REGISTRATIONS_QUERY};
