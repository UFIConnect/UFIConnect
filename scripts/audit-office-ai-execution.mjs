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
const capabilities={repository:'fixture/office',editCode:true,publish:true,deploy:true,operate:true,deployTargets:['api','office'],limits:{modelTurns:128,toolCalls:512,lifetimeMinutes:90}};
const time=()=>new Date().toISOString();
let taskCreates=0,chatCalls=0,loseNextReceipt=false,server,browser,page;
const harness=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#080e18}</style></head><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import OfficeAI from '/src/OfficeAI.jsx';createRoot(document.getElementById('root')).render(React.createElement(OfficeAI,{apiBase:'/mock',request:fetch}));</script></body></html>`;
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
  if(pathname==='/office/ai/activity' && method==='GET')return reply({checkedAt:time(),baselineCount:25,scope:'Office recorded activity',findings:[{id:'novel-action-fixture',rule:'new-action',severity:'notice',title:'A previously unseen maintenance action',reason:'This action and destination did not appear in the prior activity baseline.',referenceId:'novel-receipt-001',createdAt:time(),evidence:{action:'new-maintenance-check',previousObservations:0}}]});
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
      assert.deepEqual(body,{confirmationId,confirmed:true});task.status='needs_continuation';task.confirmation=null;task.continuation={id:continuationId,reason:'model-turns',message:'The task reached its model-turn limit. Continue from this checkpoint.'};task.resumable=true;task.progress={modelTurns:128,toolCalls:512,resumes:0};
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
  server=await createServer({root,configFile:path.join(root,'vite.config.js'),envDir:false,server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{name:'conversation-execution-smoke',configureServer(dev){dev.middlewares.use('/__office_ai_smoke',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await dev.transformIndexHtml('/__office_ai_smoke',harness));});}}]});
  await server.listen();browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1100}});
  page.on('pageerror',error=>report.errors.push(error.message));await page.route('**/mock/**',mock);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__office_ai_smoke`);
  await page.getByText('Thinking enabled',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Conversation',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByRole('button',{name:'Work',exact:true}).count(),0);
  assert.equal(taskCreates,0);
  const prompt=page.getByLabel('Message Office AI',{exact:true});
  await prompt.fill('Hello');await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByText('This is an answer without starting a task.',{exact:true}).waitFor();assert.equal(chatCalls,1);assert.equal(taskCreates,0);
  await page.getByText('Conversation saved in Office',{exact:true}).waitFor();
  await prompt.fill('Preserve my discussion draft.');
  report.checks.push('Conversation is the default; greetings and ordinary replies never create a task');
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  const taskPrompt=page.getByRole('textbox',{name:/^Task instructions/}),startTask=page.getByRole('button',{name:'Start task',exact:true});
  assert.equal(await startTask.isDisabled(),true);assert.equal(taskCreates,0);
  await page.getByRole('combobox',{name:/^Request destination/}).selectOption('office');
  assert.equal(await page.getByRole('checkbox',{name:'Run Office commands',exact:true}).isChecked(),true);
  await taskPrompt.fill('Run the requested checks and show their results.');
  await page.getByRole('button',{name:'Office controls',exact:true}).click();
  assert.equal(taskCreates,0);
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  assert.equal(await taskPrompt.inputValue(),'Run the requested checks and show their results.');
  await startTask.click();
  await page.getByRole('button',{name:'Confirm this action',exact:true}).waitFor();
  const first=[...tasks.values()][0];assert.equal(taskCreates,1);assert.equal(first.request.permissions.operate,true);assert.equal(first.request.target,'office');assert.equal(first.request.memory,true);assert.equal(first.request.history,undefined);
  report.checks.push('Tasks require an explicit outcome and Start task; control navigation preserves the draft without executing it');
  await page.getByRole('button',{name:'Confirm this action',exact:true}).click();await page.getByRole('button',{name:'Continue task',exact:true}).waitFor();
  assert.match(await page.getByLabel('Task execution',{exact:true}).innerText(),/Model turns: 128 \/ 128/);
  await page.getByRole('button',{name:'Continue task',exact:true}).click();await page.getByText('Checks passed and the requested work is complete.',{exact:true}).first().waitFor();
  await page.getByText('Command output',{exact:true}).click();await page.getByText('Synthetic terminal output: all 24 tests passed.',{exact:true}).waitFor();
  report.checks.push('confirmation and checkpoint continuation retain the task and show real terminal receipts');
  await page.getByRole('button',{name:'Open in Terminal',exact:true}).click();await page.getByLabel('Command output',{exact:true}).filter({hasText:'Synthetic terminal output: all 24 tests passed.'}).waitFor();assert.match(await page.getByLabel('Command output',{exact:true}).innerText(),/all 24 tests passed/);
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await page.reload();await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await page.getByLabel('Task execution',{exact:true}).waitFor();assert.equal(taskCreates,1);
  report.checks.push('Reloading Tasks reopens durable work and receipts without replaying execution');
  await page.getByRole('button',{name:'Upgrade AI',exact:true}).click();
  const upgradePrompt=page.getByRole('textbox',{name:'Upgrade instructions',exact:true}),startUpgrade=page.getByRole('button',{name:'Start upgrade',exact:true});
  assert.equal(await startUpgrade.isDisabled(),true);assert.equal(taskCreates,1);
  assert.equal(await page.getByRole('combobox',{name:/^Request destination/}).inputValue(),'self-update');assert.equal(await page.getByRole('combobox',{name:/^Request destination/}).isDisabled(),true);
  await upgradePrompt.fill('Improve Office AI itself.');
  await page.getByRole('button',{name:'Office controls',exact:true}).click();await page.getByRole('button',{name:'Upgrade AI',exact:true}).click();
  assert.equal(await upgradePrompt.inputValue(),'Improve Office AI itself.');assert.equal(taskCreates,1);
  await startUpgrade.click();await page.getByRole('button',{name:'Stop task',exact:true}).waitFor();
  const second=[...tasks.values()][1];assert.equal(second.request.target,'self-update');assert.equal(second.request.conversationId,undefined);assert.equal(second.request.history,undefined);
  await page.getByRole('button',{name:'Stop task',exact:true}).click();await page.getByText('Stopped this synthetic task.',{exact:true}).first().waitFor();
  report.checks.push('Upgrade AI preserves its own draft, requires Start upgrade, forces self-update, and supports cancellation');
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  loseNextReceipt=true;await taskPrompt.fill('Recover this request after its receipt is lost.');await startTask.click();
  await page.getByRole('alert').filter({hasText:'The connection ended.'}).waitFor();
  await startTask.click();await page.getByRole('button',{name:'Stop task',exact:true}).waitFor();assert.equal(taskCreates,3);
  await page.getByRole('button',{name:'Stop task',exact:true}).click();
  report.checks.push('lost task receipt retries with the same idempotency key and starts no duplicate task');
  await page.getByRole('combobox',{name:/^Request destination/}).selectOption('hosted-web');await taskPrompt.fill('Save a website draft in memory on uficonnect.ai.');
  await page.getByRole('button',{name:'Conversation',exact:true}).click();
  await prompt.fill('Keep the conversation separate.');
  await page.getByRole('button',{name:'Tasks',exact:true}).click();assert.equal(await taskPrompt.inputValue(),'Save a website draft in memory on uficonnect.ai.');assert.equal(await page.getByRole('combobox',{name:/^Request destination/}).inputValue(),'hosted-web');
  await page.getByRole('button',{name:'Conversation',exact:true}).click();assert.equal(await prompt.inputValue(),'Keep the conversation separate.');assert.equal(taskCreates,3);
  report.checks.push('Conversation and hosted website task drafts stay separate across tab changes');
  await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  await page.getByRole('button',{name:'Tasks',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  await startTask.click();await page.getByRole('button',{name:'Open index.html',exact:true}).waitFor();assert.equal(taskCreates,4);assert.equal([...tasks.values()][3].request.target,'hosted-web');
  await page.getByRole('button',{name:'Open index.html',exact:true}).click();await page.getByRole('button',{name:'Download file',exact:true}).waitFor();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download file',exact:true}).click();const download=await downloaded;assert.equal(download.suggestedFilename(),'index.html');assert.equal(await fs.readFile(await download.path(),'utf8'),artifactContent);
  await page.getByRole('button',{name:'Preview HTML draft',exact:true}).click();
  const preview=page.frameLocator('iframe[title="Private HTML draft preview"]');await preview.getByRole('heading',{name:'Hosted verification draft',exact:true}).waitFor();
  assert.equal(await page.locator('iframe[title="Private HTML draft preview"]').getAttribute('sandbox'),'allow-scripts');
  await preview.locator('body[data-ready="yes"][data-isolated="yes"]').waitFor();assert.equal(await page.locator('body').getAttribute('data-preview-escaped'),null);
  report.checks.push('Hosted website files reopen from memory, download exactly, and preview scripts stay isolated from Office');
  await page.screenshot({path:path.join(directory,'conversation-execution-mobile.png'),fullPage:true});report.checks.push('390px conversation and shared task controls fit without horizontal overflow');
  await page.getByRole('button',{name:'Memory',exact:true}).click();
  await page.getByRole('heading',{name:'Recorded release decision',exact:true}).waitFor();
  await page.getByText('Persistent knowledge storage',{exact:false}).waitFor();
  await page.getByText('Trace this memory',{exact:true}).click();await page.getByText('Original record: recorded-task-receipt',{exact:true}).waitFor();
  await page.getByLabel('Search memory',{exact:true}).fill('hosted website');await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.getByRole('heading',{name:'Recorded release decision',exact:true}).waitFor();
  assert.equal(taskCreates,4);
  await page.getByRole('button',{name:'Forget Recorded release decision',exact:true}).click();await page.getByText('Memory entry forgotten.',{exact:true}).waitFor();
  assert.equal(conversations.size,1);report.checks.push('Memory can be searched and traced to its receipt; forgetting a memory leaves saved conversations intact');
  const writesBeforeActivity=report.requests.filter(item=>item.method!=='GET').length;
  await page.getByRole('button',{name:'Activity',exact:true}).click();
  await page.getByRole('heading',{name:'A previously unseen maintenance action',exact:true}).waitFor();
  await page.getByText('This action and destination did not appear in the prior activity baseline.',{exact:true}).waitFor();await page.getByText('Original record: novel-receipt-001',{exact:true}).waitFor();
  await page.getByText('Evidence',{exact:true}).click();await page.getByText('"previousObservations": 0',{exact:false}).waitFor();
  assert.equal(report.requests.filter(item=>item.method!=='GET').length,writesBeforeActivity);assert.equal(taskCreates,4);
  report.checks.push('Activity explains previously unseen patterns and traces their source without executing an action');
  const legacyId=randomUUID();conversations.set(legacyId,{id:legacyId,title:'Previously recorded task',version:1,updatedAt:time(),messages:[{role:'user',content:first.message},{role:'assistant',content:'This is the previously recorded task.',taskId:first.id,generatedAt:time()}]});
  await page.getByRole('button',{name:'Conversation',exact:true}).click();
  await page.getByRole('button',{name:'Refresh saved conversations',exact:true}).click();
  await page.locator('.office-ai-saved-chats').getByRole('button',{name:'Previously recorded task',exact:true}).click();
  await page.locator('.office-ai-conversation-task').getByLabel('Task execution',{exact:true}).waitFor();assert.equal(taskCreates,4);
  report.checks.push('Previously saved task links reopen their existing receipt without replaying work');
  assert.deepEqual(report.errors,[]);
} catch(error) {report.failure=error.message;if(page){report.failurePage=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:path.join(directory,'execution-failure.png'),fullPage:true}).catch(()=>{});}throw error;}
finally {await browser?.close();await server?.close();await fs.writeFile(path.join(directory,'conversation-execution-smoke.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks,errors:report.errors,taskCreates,chatCalls},null,2));
