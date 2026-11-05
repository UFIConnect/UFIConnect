import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureRecoveryHistory } from './office-ai-recovery-history.mjs';

const env = {RENDER_API_KEY:'fixture-only',RENDER_SERVICE_API_ID:'srv-api',RENDER_SERVICE_PIPELINE_ID:'srv-pipeline',RENDER_SERVICE_OFFICE_ID:'srv-office',RENDER_SERVICE_WEB_ID:'srv-web'};
const sha = number => number.toString(16).padStart(40,'0');
async function directory(t) {
  const target=await fs.mkdtemp(path.join(os.tmpdir(),'ufi-recovery-history-'));
  t.after(async()=>{
    for(const name of ['production-recovery-points.json','production-recovery-points.sha256'])await fs.unlink(path.join(target,name)).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await fs.rmdir(target);
  });
  return target;
}
function provider(count) {
  const requests=[];
  const deploys=Array.from({length:count},(_,index)=>({deploy:{id:'deploy-'+index,status:'deactivated',commit:{id:sha(index+1)},createdAt:new Date(1700000000000-index*1000).toISOString()},cursor:index===99?'next-page':undefined}));
  return {requests,fetcher:async input=>{
    const url=new URL(input);requests.push(url.pathname+url.search);
    if(url.hostname==='api.render.com')return Response.json(url.searchParams.has('cursor')?deploys.slice(100):deploys.slice(0,100));
    const commit=/\/git\/commits\/([a-f0-9]{40})$/.exec(url.pathname);
    if(commit)return Response.json({sha:commit[1],tree:{sha:'f'.repeat(40)}});
    const source=url.searchParams.get('head_sha');
    return Response.json({workflow_runs:[{id:1,head_sha:source,status:'completed',conclusion:'success',event:'push',path:'.github/workflows/verify.yml',updated_at:'2026-11-05T10:00:00Z',html_url:'https://github.com/example/check'}]});
  }};
}

test('production recovery history includes every verified source across provider pages beyond ten points',async t=>{
  const fake=provider(101),output=await directory(t);
  const result=await captureRecoveryHistory(env,output,{fetcher:fake.fetcher});
  assert.equal(result.points.length,101);assert.equal(result.retentionCapacity,'unlimited');
  assert.equal(result.points.at(-1).sha,sha(101));
  assert.equal(fake.requests.filter(url=>url.includes('cursor=next-page')).length,4);
  assert.ok(result.deploymentHistoryCoverage.every(service=>service.providerPaginationComplete&&service.returnedDeployments===101));
  const saved=JSON.parse(await fs.readFile(path.join(output,'production-recovery-points.json'),'utf8'));
  assert.equal(saved.points.length,101);assert.equal(saved.providerArtifactRetentionVerified,false);
});

test('a useful history with fewer than ten verified points no longer fails an artificial minimum',async t=>{
  const fake=provider(3),output=await directory(t);
  assert.equal((await captureRecoveryHistory(env,output,{fetcher:fake.fetcher})).points.length,3);
});

test('repeated history cursors fail without looping and cancellation stops pagination',async t=>{
  const fake=provider(100),output=await directory(t);
  await assert.rejects(captureRecoveryHistory(env,output,{fetcher:async input=>fake.fetcher(String(input).replace(/&cursor=[^&]+/,''))}),/repeated pagination cursor/);
  const controller=new AbortController();controller.abort();let reads=0;
  await assert.rejects(captureRecoveryHistory(env,output,{signal:controller.signal,fetcher:async()=>{reads++;return Response.json([]);}}),error=>error.name==='AbortError');
  assert.equal(reads,0);
});
