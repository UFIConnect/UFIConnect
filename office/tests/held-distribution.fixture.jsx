import React from 'react';
import { createRoot } from 'react-dom/client';
import UnknownTopicReview from '../src/UnknownTopicReview.jsx';
import '../src/office-operations.css';

const taxonomy = [{topic:'Python',subtopics:['Automation']}];
const state = window.distributionFixture = {pending:0,assigned:false,returned:false,mode:'ok',requests:[],posts:[],waiting:[],statusReads:0,statusError:false};
const response = (body,status=200) => Response.json(body,{status});
function complete(body) {
  if(state.mode==='error')return response({message:'Temporary distribution outage.'},503);
  if(state.mode==='busy')return response({message:'Another transfer is already running. Try again shortly.'},409);
  if(state.mode==='no-progress')return response({ok:true,transferred:0,drained:0,screenedOut:0,heldForReview:0,remaining:state.pending,through:body.through,status:'running'});
  if(state.mode==='return-review') {
    const drained=state.pending;state.pending=0;state.returned=true;
    return response({ok:true,transferred:0,drained,screenedOut:0,heldForReview:drained,remaining:0,through:body.through,status:'complete'});
  }
  const drained=Math.min(state.pending,2),screenedOut=drained>1?1:0,transferred=drained-screenedOut;
  state.pending-=drained;
  return response({ok:true,transferred,drained,screenedOut,heldForReview:0,remaining:state.pending,through:body.through,
    status:state.mode==='partial'?'failed':state.pending?'running':'complete',message:state.mode==='partial'?'A later batch failed; unprocessed posts were retained.':'Batch complete.'});
}
function request(input,options={}) {
  const url=new URL(input,location.origin),path=url.pathname.replace(/^\/(?:fixture-api|changed-api)/,''),body=options.body?JSON.parse(options.body):null;
  state.requests.push({path,method:options.method||'GET',query:Object.fromEntries(url.searchParams),body});
  if(path==='/office/topic-review/distribution') {
    state.statusReads++;
    if(state.statusError)return Promise.resolve(response({message:'Assigned count unavailable.'},503));
    return Promise.resolve(response({ok:true,pending:state.pending,through:`2026-11-05T15:00:${String(state.statusReads%60).padStart(2,'0')}.123456Z`}));
  }
  if(path==='/office/topic-review/distribute') {
    state.posts.push(body);
    if(state.mode==='hold')return new Promise(resolve=>state.waiting.push(()=>resolve(complete(body))));
    return Promise.resolve(complete(body));
  }
  if(path==='/office/topic-review/groups/refresh')return Promise.resolve(response({ok:true,processed:0,total:state.assigned?0:1,indexed:0,remaining:0}));
  if(path==='/office/topic-review/groups')return Promise.resolve(response({ok:true,taxonomy,total:state.assigned?0:1,indexed:0,remaining:0,totalGroups:0,groups:[],sources:[],hasMore:false}));
  if(path==='/office/topic-review')return Promise.resolve(response({ok:true,taxonomy,total:state.assigned&&!state.returned?0:1,sources:[],items:state.assigned&&!state.returned?[]:[{id:'held-one',title:'Retained Python post',version:'a'.repeat(64),excerpt:'Original content',heldAt:'2026-11-05T01:00:00Z'}]}));
  if(path==='/office/topic-review/held-one')return Promise.resolve(response({ok:true,taxonomy,suggestions:[{topic:'Python'}],item:{id:'held-one',pending:true,version:'a'.repeat(64),post:{id:'held-one',title:'Retained Python post',content:'Original full body',topic:null}}}));
  if(path==='/office/topic-review/held-one/assign') {state.assigned=true;state.pending++;return Promise.resolve(response({ok:true,topic:'Python',message:'Assigned and queued for normal screening.'}));}
  throw new Error(`Unexpected fixture request: ${options.method||'GET'} ${path}`);
}
const root=createRoot(document.getElementById('root'));
const render=(apiBase='/fixture-api')=>root.render(<div className="office-ops"><UnknownTopicReview apiBase={apiBase} request={request} pendingCount={state.assigned?0:1} /></div>);
render();
window.switchDistributionApi=()=>render('/changed-api');
window.unmountDistributionFixture=()=>root.unmount();
