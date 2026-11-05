import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseEvidence,reusableVerification} from './verify-release-reuse.mjs';
const sha='a'.repeat(40),now=Date.parse('2026-11-05T04:35:00Z'),repository='UFIConnect/UFIConnect';
const run=()=>({id:123,status:'completed',conclusion:'success',head_sha:sha,event:'workflow_dispatch',path:'.github/workflows/verify.yml',
 head_branch:'office-ai/ed03b300-f345-4c86-8d57-b25ff70e4009',repository:{full_name:repository},head_repository:{full_name:repository},updated_at:new Date(now-60000).toISOString()});
const context={sha,repository,currentRunId:456,now};
test('only complete exact-source same-repository task verification can be reused',()=>{
 assert.equal(reusableVerification(run(),context),true);
 for(const change of [{head_sha:'b'.repeat(40)},{conclusion:'failure'},{status:'in_progress'},{event:'pull_request'},{event:'push'},
  {path:'.github/workflows/untrusted.yml'},{head_branch:'main'},{repository:{full_name:'foreign/repository'}},{head_repository:{full_name:'foreign/repository'}},
  {id:456},{id:'123'},{updated_at:new Date(now-7200001).toISOString()},{updated_at:new Date(now+10000).toISOString()}])
   assert.equal(reusableVerification({...run(),...change},context),false,JSON.stringify(change));
});
test('a failing native job represented by failed overall workflow cannot be reused',()=>{
 assert.equal(reusableVerification({...run(),conclusion:'failure'},context),false);
});
const env={GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_SHA:sha,GITHUB_REPOSITORY:repository,GITHUB_RUN_ID:'456',GH_TOKEN:'synthetic-token'};
test('candidate dispatches and pull requests always run the full suite without a request',async()=>{
 for(const patch of [{GITHUB_EVENT_NAME:'workflow_dispatch'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_REF:'refs/heads/other'},{GITHUB_SHA:'bad'},{GITHUB_REPOSITORY:'../../bad'}]){
  assert.deepEqual(await releaseEvidence({env:{...env,...patch},fetcher:()=>{throw Error('Must not request');},now}),{reuse:false});
 }
});
test('network, provider and malformed metadata failures fall back to full checks',async()=>{
 for(const fetcher of [async()=>{throw Error('network');},async()=>new Response('{}',{status:403}),async()=>new Response('invalid'),
  async()=>new Response('x'.repeat(2*1024*1024+1)),async()=>Response.json({workflow_runs:[{...run(),conclusion:'cancelled'}]})])
  assert.deepEqual(await releaseEvidence({env,fetcher,now}),{reuse:false});
});
test('selects a valid receipt after ignoring an unrelated success; never follows redirects',async()=>{
 const requests=[];
 const result=await releaseEvidence({env,now,fetcher:async(url,options)=>{requests.push({url,options});return Response.json(url.includes('/git/ref/')
  ?{ref:`refs/tags/${run().head_branch}`,object:{type:'commit',sha}}:{workflow_runs:[{...run(),head_sha:'b'.repeat(40)},run()]});}});
 assert.deepEqual(result,{reuse:true,runId:123});assert.equal(requests.length,2);assert.ok(requests.every(r=>r.options.redirect==='error'));
 assert.match(requests[0].url,/head_sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
 assert.match(requests[1].url,/\/git\/ref\/tags\/office-ai\//);
});
test('a missing, moved, annotated, or branch-only validation ref requires full checks',async()=>{
 for(const tag of [null,{ref:`refs/tags/${run().head_branch}`,object:{type:'commit',sha:'b'.repeat(40)}},
  {ref:`refs/tags/${run().head_branch}`,object:{type:'tag',sha}},{ref:`refs/heads/${run().head_branch}`,object:{type:'commit',sha}}]){
  const result=await releaseEvidence({env,now,fetcher:async url=>url.includes('/git/ref/')?(tag?Response.json(tag):new Response('{}',{status:404})):Response.json({workflow_runs:[run()]})});
  assert.deepEqual(result,{reuse:false});
 }
});
