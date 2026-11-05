import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),directory=path.join(workspace,'.cache/office-ai-execution-smoke'),root=path.join(workspace,'office');
await fs.mkdir(directory,{recursive:true});
const report={checks:[],errors:[],requests:[]},tasks=new Map(),byRequest=new Map(),conversations=new Map();
const memoryId=randomUUID();let memoryEntries=[{id:memoryId,title:'Recorded release decision',kind:'execution',mode:'task',status:'succeeded',referenceId:'recorded-task-receipt',content:'The hosted website draft stayed in memory; publication had its own recorded request.',createdAt:new Date().toISOString()}];
const terminalId=randomUUID(),confirmationId=randomUUID(),continuationId=randomUUID();
const artifactMemoryId=randomUUID(),artifactContent='<!doctype html><html><body><h1>Hosted verification draft</h1><script>document.body.dataset.ready="yes";try{parent.document.body.dataset.previewEscaped="yes"}catch{document.body.dataset.isolated="yes"}</script></body></html>';
const capabilities={repository:'fixture/office',deploymentApprovalRequired:true,editCode:true,publish:true,deploy:true,operate:true,deployTargets:['api','office'],limits:{modelTurns:128,toolCalls:512,lifetimeMinutes:90}};
const time=()=>new Date().toISOString();
let taskCreates=0,chatCalls=0,deploymentApprovals=0,loseNextReceipt=false,server,browser,page;
const harness=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#080e18}</style></head><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import OfficeAI from '/src/OfficeAI.jsx';createRoot(document.getElementById('root')).render(React.createElement(OfficeAI,{apiBase:'/mock',request:fetch}));</script></body></html>`;
async function section(label) {
  const primary=page.getByRole('navigation',{name:'Pip main navigation',exact:true});
  if(['Chat','Studio'].includes(label))return primary.getByRole('button',{name:label,exact:true}).click();
  const more=primary.getByRole('button',{name:'More',exact:true});
  if(await more.getAttribute('aria-expanded')!=='true')await more.click();
  await page.getByRole('navigation',{name:'More Pip tools',exact:true}).getByRole('button',{name:label,exact:true}).click();
}
async function mock(route) {
  const req=route.request(),url=new URL(req.url()),pathname=url.pathname.replace('/mock',''),method=req.method();
  const body=req.postData()?JSON.parse(req.postData()):null;
  report.requests.push({pathname,method,...(body?.clientRequestId?{clientRequestId:body.clientRequestId}:{})});
  const reply=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(pathname==='/office/ai')return reply({configured:true,provider:'Cloudflare',model:'fixture-thinking',reasoning:{enabled:true,mode:'thinking'}});
  if(pathname==='/office/ai/tools')return reply({tools:[]});
  if(pathname==='/office/controls')return reply({controls:[]});
  if(pathname==='/office/connections')return reply({connections:[]});
  if(pathname==='/office/ai/memory' && method==='GET')return reply({entries:memoryEntries.filter(entry=>!url.searchParams.get('query')||entry.content.includes(url.searchParams.get('query'))),storageStats:{records:memoryEntries.length,artifacts:1,storedBytes:4096}});
  if(pathname==='/office/ai/activity' && method==='GET')return reply({status:'checked',checkedAt:time(),baselineCount:25,scope:'Office recorded activity',coverage:{baselineSufficient:true},findings:[{id:'novel-action-fixture',rule:'new-action',severity:'info',reason:'This action and destination did not appear in the prior activity baseline.',eventReferenceId:'novel-receipt-001',referenceId:'anomaly:novel-action-fixture:new-action',observedAt:time(),evidence:{action:'new-maintenance-check',referenceId:'novel-receipt-001',previousObservations:0}}]});
  if(pathname===`/office/ai/memory/${memoryId}` && method==='DELETE'){memoryEntries=[];return reply({deleted:true});}
  if(pathname==='/office/ai/tasks' && method==='GET')return reply({tasks:[...tasks.values()],capabilities});
  if(pathname==='/office/ai/tasks' && method==='POST') {
    let task=byRequest.get(body.clientRequestId);
    if(!task) {
      taskCreates++;
      task={id:randomUUID(),message:body.message,route:{target:body.target,reason:'This request uses its selected destination.'},status:taskCreates===1?'needs_confirmation':'running',createdAt:time(),updatedAt:time(),events:[{id:randomUUID(),kind:'task',status:'succeeded',label:'Task accepted',at:time()}],limits:capabilities.limits,progress:{modelTurns:3,toolCalls:8,resumes:0},terminals:[],summary:'',confirmation:taskCreates===1?{id:confirmationId,label:'Confirm the requested operation',detail:'Synthetic command confirmation.'}:null};
      if(body.target==='hosted-web'){task.status='succeeded';task.summary='The requested website draft is saved in memory.';task.artifacts=[{path:'index.html',revision:'a'.repeat(64),memoryId:artifactMemoryId,storage:'memory'}];}
      tasks.set(task.id,task);byRequest.set(body.clientRequestId,task);task.request=body;
    } else assert.deepEqual(task.request,body,'Uncertain submission retries preserve the exact body and request identity');
    if(loseNextReceipt){loseNextReceipt=false;return route.abort('failed');}
    return reply({task},202);
  }
  const workspaceMatch=pathname.match(/^\/office\/ai\/workspace\/([^/]+)\/file$/);
  if(workspaceMatch){assert.ok(tasks.get(workspaceMatch[1])?.artifacts?.length);assert.equal(url.searchParams.get('path'),'index.html');return reply({file:{path:'index.html',revision:'a'.repeat(64),memoryId:artifactMemoryId,content:artifactContent}});}
  const taskMatch=pathname.match(/^\/office\/ai\/tasks\/([^/]+)(?:\/(confirm|resume|cancel))?$/);
  if(taskMatch) {
    const task=tasks.get(taskMatch[1]);if(!task)return reply({error:'Task missing'},404);
    if(taskMatch[2]==='confirm') {
      if(task.confirmation?.kind==='deployment') {
        assert.deepEqual(body,{confirmationId:task.confirmation.id,confirmed:true});
        assert.equal(task.confirmation.sha,task.commit.sha);deploymentApprovals++;
        task.status='working';task.confirmation=null;task.summary='Deployment approval recorded. Waiting for the deployment receipt.';
      } else {
        assert.deepEqual(body,{confirmationId,confirmed:true});task.status='needs_continuation';task.confirmation=null;task.continuation={id:continuationId,reason:'model-turns',message:'The task reached its model-turn limit. Continue from this checkpoint.'};task.resumable=true;task.progress={modelTurns:128,toolCalls:512,resumes:0};
      }
    }
    if(taskMatch[2]==='resume') {
      assert.deepEqual(body,{confirmed:true,continuationId});task.status='succeeded';task.summary='Checks passed and the requested work is complete.';task.resumable=false;task.progress={modelTurns:1,toolCalls:1,resumes:1};task.terminals=[{id:terminalId,status:'completed',exitCode:0,url:'https://example.test/run/1'}];task.checks=[{name:'Tests',status:'completed',conclusion:'success',url:'https://example.test/check/1'}];
    }
    if(taskMatch[2]==='cancel'){task.status='cancelled';task.summary='Stopped this synthetic task.';}
    return reply({task});
  }
  if(pathname==='/office/ai/terminal')return reply({sessions:[{id:terminalId,status:'completed',command:'npm test',createdAt:time()}],capabilities:{available:true,repository:'fixture/office'}});
  if(pathname===`/office/ai/terminal/${terminalId}`){await new Promise(resolve=>setTimeout(resolve,100));return reply({session:{id:terminalId,status:'completed',command:'npm test',exitCode:0,ref:'main',runUrl:'https://example.test/run/1'},output:'Synthetic terminal output: all 24 tests passed.',outputTruncated:false});}
  if(pathname==='/office/ai/conversations' && method==='GET')return reply({conversations:[...conversations.values()].map(({id,title,version,updatedAt})=>({id,title,version,updatedAt}))});
  if(pathname==='/office/ai/conversations' && method==='POST') {
    let conversation=conversations.get(body.clientRequestId);
    if(!conversation){conversation={id:body.clientRequestId,title:body.title,messages:body.messages,version:1,updatedAt:time()};conversations.set(conversation.id,conversation);}
    return reply({conversation});
  }
  const conversationMatch=pathname.match(/^\/office\/ai\/conversations\/([^/]+)$/);
  if(conversationMatch){
    const conversation=conversations.get(conversationMatch[1]);if(!conversation)return reply({error:'Conversation missing'},404);
    if(method==='PATCH'){assert.equal(body.expectedVersion,conversation.version);Object.assign(conversation,{title:body.title,messages:body.messages,version:conversation.version+1,updatedAt:time()});}
    return reply({conversation});
  }
  if(pathname==='/office/ai/chat') {assert.equal(body.mode,'chat');chatCalls++;return reply({reply:'This is an answer without starting a task.',generatedAt:time(),research:{status:'off'},model:'fixture-thinking',memory:{status:'retrieved',entries:memoryEntries}});}
  throw Error('Unexpected mock request '+method+' '+pathname);
}
try {
  server=await createServer({cacheDir:path.join(workspace,'.cache/audit-office-ai-execution-vite'),root,configFile:path.join(root,'vite.config.js'),envDir:false,server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{name:'conversation-execution-smoke',configureServer(dev){dev.middlewares.use('/__office_ai_smoke',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await dev.transformIndexHtml('/__office_ai_smoke',harness));});}}]});
  await server.listen();browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1100}});
  page.on('pageerror',error=>report.errors.push(error.message));await page.route('**/mock/**',mock);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__office_ai_smoke`);
  const primary=page.getByRole('navigation',{name:'Pip main navigation',exact:true});
  for(const label of ['Chat','Studio','More'])assert.equal(await primary.getByRole('button',{name:label,exact:true}).isVisible(),true,`${label} is accessible before settings open`);
  await primary.getByRole('button',{name:'More',exact:true}).click();
  for(const label of ['Tasks','Upgrade Pip','Office controls','Memory','Activity','Terminal','Functions','My tools','Connections'])assert.equal(await page.getByRole('navigation',{name:'More Pip tools',exact:true}).getByRole('button',{name:label,exact:true}).isVisible(),true,`${label} remains available through More`);
  report.checks.push('All Pip sections remain accessible through Chat, Studio, and More while conversation settings stay closed');
  await section('Settings & history');
  await page.getByText('Thinking enabled',{exact:true}).waitFor();await section('Chat');
  assert.equal(await primary.getByRole('button',{name:'Chat',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByRole('heading',{name:'Ask once. Review before it goes live.',exact:true}).isVisible(),true);
  assert.equal(await page.getByText('Work and checks happen automatically. You approve before publishing or deployment.',{exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Work',exact:true}).count(),0);
  assert.equal(taskCreates,0);
  const prompt=page.getByLabel('Message Pip',{exact:true});
  await prompt.fill('Hello');await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByText('This is an answer without starting a task.',{exact:true}).waitFor();assert.equal(chatCalls,1);assert.equal(taskCreates,0);
  await page.getByText('Conversation saved in Office',{exact:true}).waitFor();
  await prompt.fill('Preserve my discussion draft.');
  report.checks.push('Conversation is the default; greetings and ordinary replies never create a task');
  await section('Tasks');
  const taskPrompt=page.getByRole('textbox',{name:/^Task instructions/}),startTask=page.getByRole('button',{name:'Send',exact:true});
  assert.equal(await page.getByRole('button',{name:'Work settings',exact:true}).getAttribute('aria-expanded'),'false');
  assert.equal(await page.getByRole('button',{name:'Recent tasks',exact:true}).getAttribute('aria-expanded'),'false');
  assert.equal(await page.getByRole('combobox',{name:/^Request destination/}).count(),0);
  assert.equal(await taskPrompt.getAttribute('maxlength'),null);
  assert.equal(await startTask.isDisabled(),true);assert.equal(taskCreates,0);
  await taskPrompt.fill('Hi!');await startTask.click();
  await page.getByRole('log',{name:'Task agent conversation',exact:true}).getByText('This is an answer without starting a task.',{exact:true}).waitFor();assert.equal(taskCreates,0);
  await page.getByRole('button',{name:'Ask',exact:true}).click();await taskPrompt.fill('Fix the button.');await startTask.click();
  await page.getByRole('log',{name:'Task agent conversation',exact:true}).getByText('This is an answer without starting a task.',{exact:true}).last().waitFor();assert.equal(taskCreates,0);
  await page.getByRole('button',{name:'Work',exact:true}).click();await page.getByRole('button',{name:'New agent chat',exact:true}).click();
  report.checks.push('Task agent answers greetings and Ask messages without creating a run');
  await page.getByRole('button',{name:'Work settings',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:/^Request destination/}).inputValue(),'full-access');
  assert.equal(await page.getByRole('checkbox',{name:'API service',exact:true}).isChecked(),true);
  assert.equal(await page.getByRole('checkbox',{name:'Office',exact:true}).isChecked(),true);
  await page.getByRole('region',{name:'Coding tasks',exact:true}).getByText('Full access uses the checked actions and selected deployment targets',{exact:false}).waitFor();
  report.checks.push('New task agents default to Full access with selected actions and deployment targets disclosed');
  await page.getByRole('combobox',{name:/^Request destination/}).selectOption('office');
  assert.equal(await page.getByRole('checkbox',{name:'Run Office commands',exact:true}).isChecked(),true);
  await page.getByRole('button',{name:'Work settings',exact:true}).click();
  const longTask=`Run the requested checks and show their results. ${'Check context. '.repeat(1000)}End of full instructions.`;
  await taskPrompt.fill(longTask);
  await section('Office controls');
  assert.equal(taskCreates,0);
  await section('Tasks');
  assert.equal(await taskPrompt.inputValue(),longTask);
  await startTask.click();
  await page.getByRole('button',{name:'Confirm this action',exact:true}).waitFor();
  const first=[...tasks.values()][0];assert.equal(taskCreates,1);assert.equal(first.request.permissions.operate,true);assert.equal(first.request.target,'office');assert.equal(first.request.memory,true);assert.deepEqual(first.request.history,[]);
  assert.equal(first.request.message,longTask);report.checks.push('Tasks accept and send complete instructions longer than 12,000 characters');
  report.checks.push('Tasks require an explicit outcome and Start task; control navigation preserves the draft without executing it');
  await page.getByRole('button',{name:'Confirm this action',exact:true}).click();await page.getByRole('button',{name:'Continue task',exact:true}).waitFor();
  await page.getByLabel('Task execution',{exact:true}).getByText('Task details',{exact:true}).click();
  assert.match(await page.getByLabel('Task execution',{exact:true}).innerText(),/Model turns: 128 \/ 128/);
  await page.getByRole('button',{name:'Continue task',exact:true}).click();await page.getByText('Checks passed and the requested work is complete.',{exact:true}).first().waitFor();
  await page.getByText('Command output',{exact:true}).click();await page.getByText('Synthetic terminal output: all 24 tests passed.',{exact:true}).waitFor();
  report.checks.push('confirmation and checkpoint continuation retain the task and show real terminal receipts');
  await page.getByRole('button',{name:'Open in Terminal',exact:true}).click();await page.getByLabel('Command output',{exact:true}).filter({hasText:'Synthetic terminal output: all 24 tests passed.'}).waitFor();assert.match(await page.getByLabel('Command output',{exact:true}).innerText(),/all 24 tests passed/);
  await section('Tasks');
  await page.reload();await section('Settings & history');await section('Tasks');
  await page.getByLabel('Task execution',{exact:true}).waitFor();assert.equal(taskCreates,1);
  report.checks.push('Reloading Tasks reopens durable work and receipts without replaying execution');
  await section('Upgrade Pip');
  const upgradePrompt=page.getByRole('textbox',{name:'Upgrade instructions',exact:true}),startUpgrade=page.getByRole('button',{name:'Send',exact:true});
  assert.equal(await upgradePrompt.getAttribute('maxlength'),null);
  assert.equal(await startUpgrade.isDisabled(),true);assert.equal(taskCreates,1);
  await upgradePrompt.fill('What can you improve?');await startUpgrade.click();
  await page.getByRole('log',{name:'Upgrade Pip agent conversation',exact:true}).getByText('This is an answer without starting a task.',{exact:true}).waitFor();assert.equal(taskCreates,1);
  await page.getByRole('button',{name:'New agent chat',exact:true}).click();
  report.checks.push('Upgrade Pip is a chat agent and questions cannot start an upgrade');
  await page.getByRole('button',{name:'Work settings',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:/^Request destination/}).inputValue(),'self-update');assert.equal(await page.getByRole('combobox',{name:/^Request destination/}).isDisabled(),true);
  await page.getByRole('button',{name:'Work settings',exact:true}).click();
  await upgradePrompt.fill('Improve Pip itself.');
  await section('Office controls');await section('Upgrade Pip');
  assert.equal(await upgradePrompt.inputValue(),'Improve Pip itself.');assert.equal(taskCreates,1);
  await startUpgrade.click();await page.getByRole('button',{name:'Stop task',exact:true}).waitFor();
  const second=[...tasks.values()][1];assert.equal(second.request.target,'self-update');assert.equal(second.request.conversationId,undefined);assert.deepEqual(second.request.history,[]);
  await page.getByRole('button',{name:'Stop task',exact:true}).click();await page.getByText('Stopped this synthetic task.',{exact:true}).first().waitFor();
  report.checks.push('Upgrade Pip preserves its own draft, requires Start upgrade, forces self-update, and supports cancellation');
  await section('Tasks');
  loseNextReceipt=true;await taskPrompt.fill('Recover this request after its receipt is lost.');await startTask.click();
  await page.getByRole('alert').filter({hasText:'The connection ended.'}).waitFor();
  const uncertain=[...tasks.values()][2];uncertain.summary='A new server observation arrived while the receipt was missing.';
  await page.getByRole('button',{name:'Recent tasks',exact:true}).click();
  await page.getByRole('button',{name:'Refresh tasks',exact:true}).click();
  await page.getByRole('button',{name:'Refresh tasks',exact:true}).waitFor({state:'visible'});
  await page.getByRole('button',{name:'Recent tasks',exact:true}).click();
  await startTask.click();await page.getByRole('button',{name:'Stop task',exact:true}).waitFor();assert.equal(taskCreates,3);
  await page.getByRole('button',{name:'Stop task',exact:true}).click();
  report.checks.push('lost task receipt retries with the same idempotency key and starts no duplicate task');
  await page.getByRole('button',{name:'Work settings',exact:true}).click();
  await page.getByRole('combobox',{name:/^Request destination/}).selectOption('hosted-web');await taskPrompt.fill('Save a website draft in memory on uficonnect.ai.');
  await section('Chat');
  await prompt.fill('Keep the conversation separate.');
  await section('Tasks');assert.equal(await taskPrompt.inputValue(),'Save a website draft in memory on uficonnect.ai.');assert.equal(await page.getByRole('combobox',{name:/^Request destination/}).inputValue(),'hosted-web');
  await section('Chat');assert.equal(await prompt.inputValue(),'Keep the conversation separate.');assert.equal(taskCreates,3);
  report.checks.push('Conversation and hosted website task drafts stay separate across tab changes');
  await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  await section('Tasks');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  await startTask.click();await page.getByRole('button',{name:'Open index.html',exact:true}).waitFor();assert.equal(taskCreates,4);assert.equal([...tasks.values()][3].request.target,'hosted-web');
  await page.getByRole('button',{name:'Open index.html',exact:true}).click();await page.getByRole('button',{name:'Download file',exact:true}).waitFor();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download file',exact:true}).click();const download=await downloaded;assert.equal(download.suggestedFilename(),'index.html');assert.equal(await fs.readFile(await download.path(),'utf8'),artifactContent);
  await page.getByRole('button',{name:'Preview HTML draft',exact:true}).click();
  const preview=page.frameLocator('iframe[title="Private HTML draft preview"]');await preview.getByRole('heading',{name:'Hosted verification draft',exact:true}).waitFor();
  assert.equal(await page.locator('iframe[title="Private HTML draft preview"]').getAttribute('sandbox'),'allow-scripts');
  await preview.locator('body[data-ready="yes"][data-isolated="yes"]').waitFor();assert.equal(await page.locator('body').getAttribute('data-preview-escaped'),null);
  report.checks.push('Hosted website files reopen from memory, download exactly, and preview scripts stay isolated from Office');
  await page.screenshot({path:path.join(directory,'conversation-execution-mobile.png'),fullPage:true});report.checks.push('390px conversation and shared task controls fit without horizontal overflow');
  await section('Memory');
  await page.getByRole('heading',{name:'Recorded release decision',exact:true}).waitFor();
  await page.getByText('Persistent knowledge storage',{exact:false}).waitFor();
  await page.getByText('Trace this memory',{exact:true}).click();await page.getByText('Original record: recorded-task-receipt',{exact:true}).waitFor();
  await page.getByLabel('Search memory',{exact:true}).fill('hosted website');await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('heading',{name:'Recorded release decision',exact:true}).waitFor();
  assert.equal(taskCreates,4);
  await page.getByRole('button',{name:'Forget Recorded release decision',exact:true}).click();await page.getByText('Memory entry forgotten.',{exact:true}).waitFor();
  assert.equal(conversations.size,1);report.checks.push('Memory can be searched and traced to its receipt; forgetting a memory leaves saved conversations intact');
  const writesBeforeActivity=report.requests.filter(item=>item.method!=='GET').length;
  await section('Activity');
  const novelObservation=page.getByText('Observation · New recorded action',{exact:true});await novelObservation.waitFor({state:'attached'});assert.equal(await novelObservation.isVisible(),false,'Informational patterns start collapsed');
  await page.getByText('Recent observations (1)',{exact:true}).click();await novelObservation.waitFor();
  await page.getByText('This action and destination did not appear in the prior activity baseline.',{exact:true}).waitFor();await page.getByText('Execution record: novel-receipt-001',{exact:true}).waitFor();
  await page.getByText('Observation record: anomaly:novel-action-fixture:new-action',{exact:true}).waitFor();
  await page.getByText('Evidence',{exact:true}).click();await page.getByText('"previousObservations": 0',{exact:false}).waitFor();
  assert.equal(report.requests.filter(item=>item.method!=='GET').length,writesBeforeActivity);assert.equal(taskCreates,4);
  report.checks.push('Activity explains previously unseen patterns and traces their source without executing an action');
  const legacyId=randomUUID();conversations.set(legacyId,{id:legacyId,title:'Previously recorded task',version:1,updatedAt:time(),messages:[{role:'user',content:first.message},{role:'assistant',content:'This is the previously recorded task.',taskId:first.id,generatedAt:time()}]});
  await section('Chat');
  await section('Settings & history');await page.getByRole('button',{name:'Refresh saved conversations',exact:true}).click();
  await page.locator('.office-ai-saved-chats').getByRole('button',{name:'Previously recorded task',exact:true}).click();await section('Chat');
  await page.getByRole('log',{name:'Pip conversation',exact:true}).locator('.office-ai-conversation-task').getByLabel('Task execution',{exact:true}).waitFor();assert.equal(taskCreates,4);
  report.checks.push('Previously saved task links reopen their existing receipt without replaying work');
  await page.getByRole('button',{name:'New chat',exact:true}).click();
  await primary.getByRole('button',{name:'More',exact:true}).click();
  assert.equal(await page.getByRole('navigation',{name:'More Pip tools',exact:true}).getByRole('button',{name:'Tasks',exact:true}).isVisible(),true);await section('Chat');
  await prompt.fill('How does deploying a fix work?'); await prompt.press('Enter');
  await page.getByText('This is an answer without starting a task.',{exact:true}).waitFor(); assert.equal(taskCreates,4);
  await prompt.fill('Fix the broken website button and deploy the fix.'); await prompt.press('Shift+Enter');
  assert.ok((await prompt.inputValue()).includes('\n')); assert.equal(taskCreates,4);
  await prompt.press('Enter');
  await page.getByRole('button',{name:'Stop task',exact:true}).waitFor(); assert.equal(taskCreates,5);
  const typed=[...tasks.values()].at(-1); assert.equal(typed.request.target,'full-access');
  assert.equal(typed.request.permissions.publish,true); assert.equal(typed.request.permissions.deploy,true);
  assert.ok(typed.request.deployTargets.includes('web')); assert.ok(typed.request.history.some(item=>item.content.includes('How does deploying')));
  typed.status='needs_confirmation';typed.summary='The button is fixed and its checks passed. Review the prepared deployment.';
  typed.commit={sha:'a'.repeat(40),published:false,url:'https://example.test/commit'};
  typed.changedFiles=[{path:'web/src/button.jsx',status:'modified',diff:'- Broken button\n+ Working button'}];
  typed.checks=[{id:'deployment-check',name:'Website checks',status:'completed',conclusion:'success',sha:typed.commit.sha,url:'https://example.test/check/website'}];
  typed.confirmation={id:randomUUID(),kind:'deployment',label:'Approve deployment',detail:'Checks passed for the prepared website change.',action:{name:'repo_publish'},sha:typed.commit.sha,targets:['web','office'],checks:typed.checks};
  const review=page.getByRole('region',{name:'Review deployment',exact:true});
  await review.waitFor();
  assert.equal(deploymentApprovals,0,'Natural requests never approve their own deployment');
  assert.equal(typed.commit.published,false);assert.equal(typed.deployments,undefined);
  assert.match(await review.innerText(),/Website, Office/);
  assert.equal(await review.getByText(typed.commit.sha,{exact:true}).count(),1);
  assert.equal(await review.getByRole('link',{name:'Website checks',exact:true}).isVisible(),true);
  assert.match(await review.innerText(),/Approval publishes this checked version to the repository and starts production deployment/);
  assert.equal(await review.getByRole('button',{name:'Confirm this action',exact:true}).count(),0);
  await page.getByRole('button',{name:'Review deployment',exact:true}).click();
  assert.equal(await review.getByRole('button',{name:'Approve deployment',exact:true}).evaluate(button=>document.activeElement===button),true,'Review shortcut focuses the actual deployment approval');
  assert.equal(await review.getByRole('button',{name:'Approve deployment',exact:true}).evaluate(button=>{const bounds=button.getBoundingClientRect(),log=button.closest('[role="log"]').getBoundingClientRect();return bounds.top>=log.top&&bounds.bottom<=log.bottom;}),true,'Mobile review shortcut reveals the approval inside the transcript');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:path.join(directory,'deployment-review-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Review deployment',exact:true}).click();
  assert.equal(await review.getByRole('button',{name:'Approve deployment',exact:true}).evaluate(button=>{const bounds=button.getBoundingClientRect(),log=button.closest('[role="log"]').getBoundingClientRect();return document.activeElement===button&&bounds.top>=log.top&&bounds.bottom<=log.bottom;}),true,'Desktop review shortcut reveals and focuses the approval');
  await page.screenshot({path:path.join(directory,'deployment-review-desktop.png'),fullPage:true});
  await review.getByRole('button',{name:'Approve deployment',exact:true}).click();
  await page.getByText('Deployment approval recorded. Waiting for the deployment receipt.',{exact:true}).first().waitFor();
  assert.equal(deploymentApprovals,1);assert.equal(typed.commit.published,false);
  assert.equal(await page.getByRole('heading',{name:'Deployments',exact:true}).count(),0,'Approval does not claim a deployment is already live');
  typed.status='succeeded'; typed.summary='The button is fixed. Checks passed and deployment is confirmed live.';
  typed.commit.published=true;
  typed.deployments=[{service:'web',status:'live',sha:typed.commit.sha,url:'https://example.test/deploy'}];
  await page.getByText(typed.summary,{exact:true}).first().waitFor();
  await page.getByRole('heading',{name:'Deployments',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:path.join(directory,'simple-chat-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(directory,'simple-chat-desktop.png'),fullPage:true});
  report.checks.push('Main chat automatically executes typed fix requests, preserves context, and shows the final commit and deployment in the same conversation');
  report.checks.push('Settings stay collapsed without hiding capabilities; Enter sends and Shift+Enter adds a line without executing a task');
  await page.getByText('Task settings · Review before deployment',{exact:true}).click();
  const scope=page.locator('.office-ai-voice-scope');
  await scope.getByRole('checkbox',{name:'Edit code',exact:true}).uncheck();
  await scope.getByRole('checkbox',{name:'Run Office commands',exact:true}).uncheck();
  await scope.getByRole('checkbox',{name:'Office',exact:true}).uncheck();
  await prompt.fill('Enable configured agents.');await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByRole('heading',{name:'Enable configured agents.',exact:true}).waitFor();
  const restricted=[...tasks.values()].at(-1);assert.equal(restricted.request.target,'full-access');
  assert.deepEqual(restricted.request.permissions,{editCode:false,publish:false,deploy:true,operate:false});
  assert.equal(restricted.request.deployTargets.includes('office'),false);assert.ok(restricted.request.deployTargets.includes('api'));
  assert.equal(await page.getByRole('button',{name:'Confirm this action',exact:true}).count(),0);
  restricted.status='succeeded';restricted.summary='The selected task permissions were preserved.';
  await page.getByText(restricted.summary,{exact:true}).first().waitFor();
  await scope.getByRole('checkbox',{name:'Publish after approval',exact:true}).check();
  await scope.getByRole('checkbox',{name:'Run Office commands',exact:true}).check();
  await scope.getByRole('checkbox',{name:'Office',exact:true}).check();
  report.checks.push('Operational enable requests start Full access tasks without a frontend confirmation; unchecked actions and targets remain excluded');
  const beforeTools={tasks:taskCreates,chats:chatCalls};
  await prompt.fill('Calculate 17 times 19 using Cloudflare code execution.');await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByRole('heading',{name:'Calculate 17 times 19 using Cloudflare code execution.',exact:true}).waitFor();
  assert.equal(taskCreates,beforeTools.tasks+1);assert.equal(chatCalls,beforeTools.chats);
  const calculation=[...tasks.values()].find(item=>item.message.startsWith('Calculate 17 times 19'));assert.ok(calculation);calculation.status='succeeded';calculation.summary='Cloudflare executed the calculation: 323.';
  await page.getByText(calculation.summary,{exact:true}).first().waitFor();
  report.checks.push('A typed calculation uses the tool task executor and shows its result in the same chat');
  const beforeReads={tasks:taskCreates,chats:chatCalls};
  await prompt.fill('How do I read backend/index.js?');await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.office-ai-message-user')].some(element=>element.textContent.includes('How do I read backend/index.js?')));
  await page.getByRole('button',{name:'Send',exact:true}).waitFor();
  assert.equal(taskCreates,beforeReads.tasks);assert.equal(chatCalls,beforeReads.chats+1);
  await prompt.fill('Can you read backend/index.js?');await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByRole('heading',{name:'Can you read backend/index.js?',exact:true}).waitFor();
  assert.equal(taskCreates,beforeReads.tasks+1);assert.equal(chatCalls,beforeReads.chats+1);
  const readTask=[...tasks.values()].at(-1);assert.equal(readTask.request.target,'full-access');readTask.status='succeeded';readTask.summary='The requested file was read using repository tools.';
  await page.getByText(readTask.summary,{exact:true}).first().waitFor();
  report.checks.push('Concrete repository read requests use Full access tools; how-to questions remain conversational');
  const beforeNatural = { tasks: taskCreates, chats: chatCalls };
  for (const message of [
    "make sure theres 10 recovery attemps, tasks aren't running properly or they're taking too long to execute",
    'Can you help me fix tasks that need multiple attempts to finish a job?',
    'I want you to increase recovery attempts to 10.',
  ]) {
    await prompt.fill(message); await page.getByRole('button',{name:'Send',exact:true}).click();
    await page.getByRole('heading',{name:message,exact:true}).waitFor();
    const task = [...tasks.values()].at(-1);
    assert.equal(task.request.message,message); assert.equal(task.request.target,'full-access');
    assert.equal(task.request.permissions.publish,true); assert.equal(task.request.permissions.deploy,true);
    assert.equal(await page.getByRole('button',{name:'Confirm this action',exact:true}).count(),0);
    task.status='succeeded'; task.summary=`Confirmed natural request ${taskCreates}: the requested work is complete.`;
    await page.getByText(task.summary,{exact:true}).first().waitFor();
  }
  assert.equal(taskCreates,beforeNatural.tasks+3); assert.equal(chatCalls,beforeNatural.chats);
  report.checks.push('Natural requests and slow-task reports execute directly with the selected permissions and finish in the same conversation');
  await prompt.fill('Fix the website footer and prepare it for review.');await prompt.press('Enter');
  await page.getByRole('heading',{name:'Fix the website footer and prepare it for review.',exact:true}).waitFor();
  const unpublished=[...tasks.values()].at(-1);
  unpublished.status='needs_confirmation';unpublished.commit={sha:'b'.repeat(40),published:false};
  unpublished.confirmation={id:randomUUID(),kind:'deployment',label:'Approve deployment',detail:'Footer fix prepared.',action:{name:'repo_publish'},sha:'unverified',targets:['web']};
  await review.waitFor();assert.equal(await review.getByRole('button',{name:'Approve deployment',exact:true}).isDisabled(),true);
  assert.equal(deploymentApprovals,1,'An unverified version cannot be approved from the interface');
  unpublished.confirmation.sha=unpublished.commit.sha;
  await review.getByRole('button',{name:'Approve deployment',exact:true}).waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('section[aria-label="Review deployment"] code')].some(element=>element.textContent==='b'.repeat(40)));
  await review.getByRole('button',{name:'Keep unpublished and stop',exact:true}).click();
  await page.getByText('Stopped this synthetic task.',{exact:true}).first().waitFor();
  assert.equal(unpublished.commit.published,false);assert.equal(unpublished.status,'cancelled');assert.equal(deploymentApprovals,1);
  report.checks.push('Deployment review shows exact version, targets, and check receipts on desktop and mobile; approval precedes live receipts, missing source disables approval, and cancellation keeps the candidate unpublished');
  delete capabilities.deploymentApprovalRequired;
  await page.getByRole('button',{name:'Refresh Pip connection',exact:true}).click();
  await page.locator('.office-ai-approval-note').filter({hasText:'Preparation mode: the server is updating.'}).waitFor();
  assert.equal(await scope.getByRole('checkbox',{name:'Publish after approval',exact:true}).isChecked(),false);
  assert.equal(await scope.getByRole('checkbox',{name:'Publish after approval',exact:true}).isDisabled(),true);
  assert.equal(await scope.getByRole('checkbox',{name:'Run Office commands',exact:true}).isDisabled(),true);
  loseNextReceipt=true;
  const beforeLegacy=taskCreates;
  await prompt.fill('Fix the website footer, publish it, and deploy it after review.');await prompt.press('Enter');
  await page.getByRole('alert').filter({hasText:'The connection ended before the task receipt arrived.'}).waitFor();
  const legacyChat=[...tasks.values()].at(-1);
  assert.deepEqual(legacyChat.request.permissions,{editCode:true,publish:false,deploy:false,operate:false});assert.deepEqual(legacyChat.request.deployTargets,[]);
  capabilities.deploymentApprovalRequired=true;
  await page.getByRole('button',{name:'Check server update',exact:true}).click();
  await page.locator('.office-ai-approval-note').filter({hasText:'Preparation mode:'}).waitFor({state:'hidden'});
  await prompt.press('Enter');
  await page.getByRole('heading',{name:'Fix the website footer, publish it, and deploy it after review.',exact:true}).waitFor();
  assert.equal(taskCreates,beforeLegacy+1,'Upgrading the backend during a lost receipt must recover the same task');
  assert.deepEqual(legacyChat.request.permissions,{editCode:true,publish:false,deploy:false,operate:false},'A receipt retry cannot widen its original preparation-only authorization');
  legacyChat.status='succeeded';legacyChat.summary='The requested change is prepared without publication.';
  await page.getByText(legacyChat.summary,{exact:true}).first().waitFor();
  delete capabilities.deploymentApprovalRequired;
  await section('Tasks');await page.getByRole('button',{name:'New agent chat',exact:true}).click();
  await page.getByRole('button',{name:'Recent tasks',exact:true}).click();await page.getByRole('button',{name:'Refresh tasks',exact:true}).click();
  await page.getByRole('region',{name:'Coding tasks',exact:true}).getByText('Preparation mode: the server is updating.',{exact:false}).first().waitFor();
  await taskPrompt.fill('Prepare a safe website update while deployment approval is unavailable.');await startTask.click();
  await page.getByRole('heading',{name:'Prepare a safe website update while deployment approval is unavailable.',exact:true}).waitFor();
  const legacyTask=[...tasks.values()].at(-1);
  assert.deepEqual(legacyTask.request.permissions,{editCode:true,publish:false,deploy:false,operate:false});assert.deepEqual(legacyTask.request.deployTargets,[]);
  legacyTask.status='succeeded';legacyTask.summary='The task workspace preserved preparation-only authorization.';
  capabilities.deploymentApprovalRequired=true;
  await section('Chat');await page.getByRole('button',{name:'Refresh Pip connection',exact:true}).click();
  await page.locator('.office-ai-approval-note').filter({hasText:'Preparation mode:'}).waitFor({state:'hidden'});
  assert.equal(await scope.getByRole('checkbox',{name:'Publish after approval',exact:true}).isChecked(),true);
  assert.equal(await scope.getByRole('checkbox',{name:'Run Office commands',exact:true}).isChecked(),true);
  report.checks.push('Missing server approval support limits both main chat and Tasks to code preparation, masks publication/deployment/Office-command permissions and targets, disables unsafe checkboxes, and restores user preferences after upgrade');
  assert.deepEqual(report.errors,[]);
} catch(error) {report.failure=error.message;if(page){report.failurePage=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:path.join(directory,'execution-failure.png'),fullPage:true}).catch(()=>{});}throw error;}
finally {await browser?.close();await server?.close();await fs.writeFile(path.join(directory,'conversation-execution-smoke.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks,errors:report.errors,taskCreates,chatCalls},null,2));
