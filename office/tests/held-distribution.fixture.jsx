import React from 'react';
import { createRoot } from 'react-dom/client';
import UnknownTopicReview from '../src/UnknownTopicReview.jsx';
import '../src/office-operations.css';

const taxonomy = [{topic:'Python',subtopics:['Automation']}];
const state = window.distributionFixture = {pending:0,assigned:false,returned:false,mode:'ok',requests:[],job:null,authorized:true};
const response = (body,status=200) => Response.json(body,{status});

state.step = () => {
  const job = state.job;
  if (job?.status !== 'running') return;
  if (job.stopRequested) { job.status = 'stopped'; return; }
  job.waiting = state.mode === 'busy';
  if (job.waiting) return;
  const returned = state.mode === 'return-review';
  const drained = Math.min(state.pending,2), screenedOut = drained > 1 && !returned ? 1 : 0;
  job.progress.drained += drained;
  job.progress.screenedOut += screenedOut;
  job.progress.transferred += returned ? 0 : drained - screenedOut;
  job.progress.heldForReview += returned ? drained : 0;
  state.returned ||= returned;
  state.pending -= drained;
  job.remaining -= drained;
  if (!job.remaining) job.status = 'complete';
};

async function request(input,options={}) {
  const url = new URL(input,location.origin), path = url.pathname.replace(/^\/(?:fixture-api|changed-api)/,'');
  const body = options.body ? JSON.parse(options.body) : null;
  state.requests.push({path,method:options.method||'GET',query:Object.fromEntries(url.searchParams),body});
  if (!state.authorized) return response({message:'Office access required.'},401);
  if (path === '/office/topic-review/jobs' && url.pathname.startsWith('/changed-api')) return response({pending:0});
  if (path === '/office/topic-review/jobs') return response({pending:state.pending,distribution:state.job});
  if (path === '/office/topic-review/jobs/distribution') {
    state.job = {id:body.id,kind:'distribution',status:'running',total:state.pending,remaining:state.pending,
      progress:{drained:0,transferred:0,screenedOut:0,heldForReview:0}};
    return response(state.job);
  }
  if (path === '/office/topic-review/jobs/'+state.job?.id+'/stop') {
    state.job.stopRequested = true;
    return response(state.job);
  }
  if (path === '/office/topic-review/groups/progress') return response({total:state.assigned?0:1,indexed:0,remaining:0});
  if (path === '/office/topic-review/groups') return response({ok:true,taxonomy,total:state.assigned?0:1,indexed:0,remaining:0,totalGroups:0,groups:[],sources:[],hasMore:false});
  if (path === '/office/topic-review') {
    const items = state.assigned&&!state.returned ? [] : [{id:'held-one',title:'Retained Python post',version:'a'.repeat(64),excerpt:'Original content',heldAt:'2026-11-05T01:00:00Z'}];
    return response({ok:true,taxonomy,total:items.length,sources:[],items});
  }
  if (path === '/office/topic-review/held-one') return response({ok:true,taxonomy,suggestions:[{topic:'Python'}],item:{id:'held-one',pending:true,version:'a'.repeat(64),post:{id:'held-one',title:'Retained Python post',content:'Original full body',topic:null}}});
  if (path === '/office/topic-review/held-one/assign') {
    state.assigned = true; state.pending++;
    return response({ok:true,topic:'Python',message:'Assigned and queued for normal screening.'});
  }
  throw new Error('Unexpected fixture request: '+(options.method||'GET')+' '+path);
}
const root = createRoot(document.getElementById('root'));
const render = (apiBase='/fixture-api') => root.render(<div className="office-ops"><UnknownTopicReview apiBase={apiBase} request={request} pendingCount={state.assigned?0:1} /></div>);
render();
window.switchDistributionApi = () => render('/changed-api');
window.mountDistributionFixture = render;
window.unmountDistributionFixture = () => root.render(null);
