import React from 'react';
import { createRoot } from 'react-dom/client';
import TopicTransfer from '../src/TopicTransfer.jsx';

const pythonGroup = 'a'.repeat(64), javascriptGroup = 'b'.repeat(64), cyberGroup = 'c'.repeat(64);
const taxonomy = [{topic:'Python',subtopics:['Data & automation','Web frameworks']}, {topic:'JavaScript',subtopics:['Language & packages']}, {topic:'Cybersecurity',subtopics:['Threat intelligence']}];
const rows = Array.from({length:241},(_,index) => {
  const cyber=index>=237,topic=cyber?'Cybersecurity':index<32?'Python':'JavaScript';
  return {id:`held-${String(index).padStart(2,'0')}`,version:(index+1).toString(16).padStart(64,'0'),title:`${topic==='Python'?'Python Django tutorial':topic==='JavaScript'?'JavaScript package':'Cybersecurity advisory'} ${index+1}`,
    excerpt:`Complete retained ${topic} content ${index+1}.`,source:index%2?'mastodon':'devto',heldAt:'2026-11-04T01:02:03Z',lastHeldAt:'2026-11-04T01:02:03Z',
    group:cyber?cyberGroup:index<32?pythonGroup:javascriptGroup,topic};
});
const state = window.topicReviewFixture = {rows,requests:[],batches:[],approvals:[],refreshes:0,refreshPending:[],batchPending:[],batchMode:'ok',groupingComplete:false,approvedGroups:0};
Object.defineProperty(state,'assigned',{get(){return rows.filter(row=>row.resolved).length;}});
const response = (body,status=200) => Response.json(body,{status});
function filtered(parameters) {
  const needle=(parameters.get('q')||'').toLowerCase(),source=parameters.get('source'),group=parameters.get('group');
  return rows.filter(row=>!row.resolved&&(!source||row.source===source)&&(!group||row.group===group)&&(!needle||`${row.title} ${row.excerpt} ${row.source} ${row.topic}`.toLowerCase().includes(needle)));
}
const sources = () => ['devto','mastodon'].map(source=>({source,count:rows.filter(row=>!row.resolved&&row.source===source).length}));
const progress = () => ({total:38000-state.assigned,indexed:(state.groupingComplete?38000:500)-state.assigned,remaining:state.groupingComplete?0:37500});
function groups(parameters) {
  const matching=filtered(parameters),all=[pythonGroup,javascriptGroup,cyberGroup].map(id=>{
    const members=matching.filter(row=>row.group===id),first=members[0];
    return first?{id,label:first.topic,topic:first.topic,method:'topic',count:members.length,samples:members.slice(0,3).map(({id,title})=>({id,title}))}:null;
  }).filter(Boolean).sort((left,right)=>right.count-left.count||left.label.localeCompare(right.label));
  const offset=Number(parameters.get('offset')||0),limit=Number(parameters.get('limit')||100);
  return {ok:true,taxonomy,...progress(),matchedTotal:matching.length,totalGroups:all.length,groups:all.slice(offset,offset+limit),sources:sources(),hasMore:offset+limit<all.length,nextOffset:offset+limit<all.length?offset+limit:null};
}
function completeBatch(body) {
  const results=body.items.map(item=>{
    const row=rows.find(row=>row.id===item.id);
    if(state.batchMode==='conflict'||!row||row.version!==item.expectedVersion)return {id:item.id,ok:false,status:409,message:'The held post changed since it was opened. Refresh its preview and review the latest content.'};
    row.resolved=true;return {id:item.id,ok:true,status:'queued',replayed:false};
  });
  const assigned=results.filter(row=>row.ok).length,conflicts=results.length-assigned;
  return response({ok:true,assigned,replayed:0,conflicts,failed:0,results,message:conflicts?`${conflicts} posts need a fresh review. No stale content was assigned.`:`Assigned ${assigned} posts to ${body.topic} and queued for normal screening and transfer.`});
}
function request(input,options={}) {
  const url=new URL(input,location.origin),path=url.pathname.replace('/fixture-api',''),parameters=url.searchParams,body=options.body?JSON.parse(options.body):null;
  state.requests.push({path,query:Object.fromEntries(parameters),method:options.method||'GET',body});
  if(path==='/office/topic-transfer')return Promise.resolve(response({ok:true,generatedAt:new Date().toISOString(),taxonomy,
    topics:taxonomy.map(({topic,subtopics})=>({topic,live:10,staged:2,subtopics:subtopics.map(name=>({name,live:5,staged:1}))})),
    unknown:{live:0,staged:0},guardian:{unknownLive:0,heldForReview:38000-state.assigned,target:0,maximum:500},agents:[],routing:{enabled:true}}));
  if(path==='/office/topic-review/groups/refresh') {
    state.refreshes++;
    if(state.refreshes===1)return Promise.resolve(response({ok:true,processed:500,...progress()}));
    if(!state.groupingComplete)return new Promise(resolve=>state.refreshPending.push(()=>{state.groupingComplete=true;resolve(response({ok:true,processed:500,...progress()}));}));
    return Promise.resolve(response({ok:true,processed:0,...progress()}));
  }
  if(path==='/office/topic-review/groups')return Promise.resolve(response(groups(parameters)));
  const members=path.match(/^\/office\/topic-review\/groups\/([a-f0-9]+)\/members$/);
  if(members) {
    const parametersWithGroup=new URLSearchParams(parameters);parametersWithGroup.set('group',members[1]);
    const all=filtered(parametersWithGroup),offset=Number((parameters.get('cursor')||'').replace('fixture-members-','')||0),limit=1000;
    return Promise.resolve(response({ok:true,items:all.slice(offset,offset+limit).map(({id,version})=>({id,expectedVersion:version})),total:all.length,nextCursor:offset+limit<all.length?`fixture-members-${offset+limit}`:null}));
  }
  if(path==='/office/topic-review/groups/approve') {
    state.approvals.push(body);
    const groupId=[pythonGroup,javascriptGroup,cyberGroup].includes(body?.group)?body.group:pythonGroup,topic=groupId===javascriptGroup?'JavaScript':groupId===cyberGroup?'Cybersecurity':'Python';
    const members=rows.filter(row=>!row.resolved&&row.group===groupId);
    const batch=members.slice(0,1000).map(({id,version})=>({id,expectedVersion:version}));
    if(!batch.length) {
      const remaining=rows.filter(row=>row.group===groupId&&!rows.find(row2=>row2.id===row.id)?.resolved).length;
      return Promise.resolve(response({ok:true,group:groupId,topic,assigned:0,replayed:0,conflicts:0,failed:0,remaining:0,results:[],message:`0 posts approved for ${topic}.`}));
    }
    const result=completeBatch({items:batch,topic,confirmed:true});
    return Promise.resolve(result).then(async body => {
      const json=await body.json();
      const remaining=rows.filter(row=>!row.resolved&&row.group===groupId).length;
      return Response.json({...json,group:groupId,topic,remaining,message:`${json.assigned} posts approved for ${topic}; ${json.conflicts} changed or resolved; ${json.failed} failed; ${remaining} still pending in this group.`});
    });
  }
  if(path==='/office/topic-review/batch-assign') {
    state.batches.push(body);
    if(state.batchMode==='hold')return new Promise(resolve=>state.batchPending.push(()=>{const result=completeBatch(body);resolve(result);}));
    return Promise.resolve(completeBatch(body));
  }
  if(path==='/office/topic-review') {
    const all=filtered(parameters),offset=Number((parameters.get('cursor')||'').replace('fixture-page-','')||0),limit=Number(parameters.get('limit')||25);
    return Promise.resolve(response({ok:true,taxonomy,items:all.slice(offset,offset+limit),sources:sources(),total:all.length,nextCursor:offset+limit<all.length?`fixture-page-${offset+limit}`:null}));
  }
  const detail=path.match(/^\/office\/topic-review\/([^/]+)$/);
  if(detail) {
    const row=rows.find(row=>row.id===decodeURIComponent(detail[1]));
    if(!row)return Promise.resolve(response({message:'Held post missing.'},404));
    return Promise.resolve(response({ok:true,item:{id:row.id,version:row.version,pending:!row.resolved,heldAt:row.heldAt,lastHeldAt:row.lastHeldAt,reason:'ambiguous-topic',
      post:{id:row.id,title:row.title,content:row.excerpt+' Full original body is preserved.',source:row.source,topic:row.topic,post_created_at:row.heldAt}},taxonomy,suggestions:[{topic:row.topic,evidence:['Django']}]}));
  }
  throw new Error(`Unexpected fixture request: ${options.method||'GET'} ${path}`);
}
const root=createRoot(document.getElementById('root'));
root.render(<TopicTransfer apiBase="/fixture-api" request={request} />);
window.unmountTopicReviewFixture=()=>root.unmount();
