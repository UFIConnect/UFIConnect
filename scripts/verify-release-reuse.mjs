import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const SHA=/^[a-f0-9]{40}$/;
async function boundedJson(response){
  if(!response.ok)return null;
  const reader=response.body?.getReader();if(!reader)return null;
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();return null;}chunks.push(value);}}
  finally{reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function reusableVerification(run,{sha,repository,currentRunId,now=Date.now()}={}){
  const completed=Date.parse(run?.updated_at);
  return SHA.test(sha||'') && run?.head_sha===sha && run.id!==Number(currentRunId)
    && Number.isSafeInteger(run.id) && run.id>0 && run.status==='completed' && run.conclusion==='success'
    && run.event==='workflow_dispatch' && run.path?.split('@')[0]==='.github/workflows/verify.yml'
    && /^office-ai\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(run.head_branch||'')
    && run.repository?.full_name===repository && run.head_repository?.full_name===repository
    && Number.isFinite(completed) && completed<=now+5000 && now-completed<=2*60*60*1000;
}
export async function releaseEvidence({env=process.env,fetcher=fetch,now=Date.now()}={}){
  if(env.GITHUB_EVENT_NAME!=='push'||env.GITHUB_REF!=='refs/heads/main'||!SHA.test(env.GITHUB_SHA||'')
    ||!/^[-\w.]+\/[-\w.]+$/.test(env.GITHUB_REPOSITORY||''))return{reuse:false};
  try{
    const response=await fetcher(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/verify.yml/runs?head_sha=${env.GITHUB_SHA}&event=workflow_dispatch&status=completed&per_page=30`,
      {redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${env.GH_TOKEN}`,'X-GitHub-Api-Version':'2026-03-10'}});
    const data=await boundedJson(response);
    const run=Array.isArray(data?.workflow_runs)&&data.workflow_runs.find(run=>reusableVerification(run,{sha:env.GITHUB_SHA,repository:env.GITHUB_REPOSITORY,currentRunId:env.GITHUB_RUN_ID,now}));
    if(!run)return{reuse:false};
    const tag=await boundedJson(await fetcher(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/git/ref/tags/${run.head_branch}`,
      {redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${env.GH_TOKEN}`,'X-GitHub-Api-Version':'2026-03-10'}}));
    return tag?.ref===`refs/tags/${run.head_branch}`&&tag.object?.type==='commit'&&tag.object.sha===env.GITHUB_SHA
      ?{reuse:true,runId:run.id}:{reuse:false};
  }catch{return{reuse:false};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const result=await releaseEvidence();
  if(!process.env.GITHUB_OUTPUT)throw Error('This command requires a GitHub Actions output file.');
  await fs.appendFile(process.env.GITHUB_OUTPUT,`reuse=${result.reuse}\n`);
  console.log(result.reuse?`Exact-source full verification already passed in run ${result.runId}.`:'Running the complete verification suite.');
}
