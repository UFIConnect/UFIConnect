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
const terminalId=randomUUID(),confirmationId=randomUUID(),continuationId=randomUUID();
const capabilities={repository:'fixture/office',editCode:true,publish:true,deploy:true,operate:true,deployTargets:['api','office'],limits:{modelTurns:128,toolCalls:512,lifetimeMinutes:90}};
const time=()=>new Date().toISOString();
let taskCreates=0,chatCalls=0,loseNextReceipt=false,stripTaskIds=false,server,browser;
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
  if(pathname==='/office/ai/tasks' && method==='GET')return reply({tasks:[...tasks.values()],capabilities});
  if(pathname==='/office/ai/tasks' && method==='POST') {
    let task=byRequest.get(body.clientRequestId);
    if(!task) {
      taskCreates++;
      task={id:randomUUID(),message:body.message,conversationId:body.conversationId,status:taskCreates===1?'needs_confirmation':'running',createdAt:time(),updatedAt:time(),events:[{id:randomUUID(),kind:'task',status:'succeeded',label:'Task accepted',at:time()}],limits:capabilities.limits,progress:{modelTurns:3,toolCalls:8,resumes:0},terminals:[],summary:'',confirmation:taskCreates===1?{id:confirmationId,label:'Confirm the requested operation',detail:'Synthetic command confirmation.'}:null};
      tasks.set(task.id,task);byRequest.set(body.clientRequestId,task);task.request=body;
    } else assert.deepEqual(task.request,body,'Uncertain submission retries preserve the exact body and request identity');
    if(loseNextReceipt){loseNextReceipt=false;return route.abort('failed');}
    return reply({task},202);
  }
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
    if(!conversation){conversation={id:body.clientRequestId,title:body.title,messages:body.messages,version:1,updatedAt:time()};if(stripTaskIds)conversation.messages=conversation.messages.map(({taskId,...message})=>message);conversations.set(conversation.id,conversation);}
    return reply({conversation});
  }
  const conversationMatch=pathname.match(/^\/office\/ai\/conversations\/([^/]+)$/);
  if(conversationMatch){
    const conversation=conversations.get(conversationMatch[1]);if(!conversation)return reply({error:'Conversation missing'},404);
    if(method==='PATCH'){assert.equal(body.expectedVersion,conversation.version);Object.assign(conversation,{title:body.title,messages:stripTaskIds?body.messages.map(({taskId,...message})=>message):body.messages,version:conversation.version+1,updatedAt:time()});}
    return reply({conversation});
  }
  if(pathname==='/office/ai/chat') {chatCalls++;return reply({reply:'This is an answer without starting a task.',generatedAt:time(),research:{status:'off'},model:'fixture-thinking'});}
  throw Error('Unexpected mock request '+method+' '+pathname);
}
try {
  server=await createServer({root,configFile:path.join(root,'vite.config.js'),envDir:false,server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{name:'conversation-execution-smoke',configureServer(dev){dev.middlewares.use('/__office_ai_smoke',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await dev.transformIndexHtml('/__office_ai_smoke',harness));});}}]});
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});
  page.on('pageerror',error=>report.errors.push(error.message));await page.route('**/mock/**',mock);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__office_ai_smoke`);
  await page.getByText('Thinking enabled',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Work',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.getByRole('checkbox',{name:'Run Office commands',exact:true}).isChecked(),true);
  const prompt=page.getByLabel('Message Office AI',{exact:true});
  await prompt.fill('Run the requested checks and show their results.');await page.getByRole('button',{name:'Send and work',exact:true}).click();
  await page.getByRole('button',{name:'Confirm this action',exact:true}).waitFor();
  const first=[...tasks.values()][0];assert.equal(taskCreates,1);assert.equal(first.request.permissions.operate,true);assert.deepEqual(first.request.history,[]);
  await page.getByText('Conversation saved in Office',{exact:true}).waitFor();
  await page.waitForTimeout(100);
  const saved=conversations.get(first.conversationId);assert.ok(saved);assert.equal(saved.messages[1].taskId,first.id);
  report.checks.push('default Work creates one durable task and saves its receipt under the same conversation');
  await page.getByRole('button',{name:'Confirm this action',exact:true}).click();await page.getByRole('button',{name:'Continue task',exact:true}).waitFor();
  assert.match(await page.getByLabel('Task execution',{exact:true}).innerText(),/Model turns: 128 \/ 128/);
  await page.getByRole('button',{name:'Continue task',exact:true}).click();await page.getByText('Checks passed and the requested work is complete.',{exact:true}).first().waitFor();
  await page.getByText('Command output',{exact:true}).click();await page.getByText('Synthetic terminal output: all 24 tests passed.',{exact:true}).waitFor();
  report.checks.push('confirmation and checkpoint continuation retain the task and show terminal output in conversation');
  await page.getByRole('button',{name:'Open in Terminal',exact:true}).click();await page.getByLabel('Command output',{exact:true}).filter({hasText:'Synthetic terminal output: all 24 tests passed.'}).waitFor();assert.match(await page.getByLabel('Command output',{exact:true}).innerText(),/all 24 tests passed/);
  await page.getByRole('button',{name:'Work',exact:true}).click();
  await page.reload();await page.locator('.office-ai-saved-chats').getByRole('button',{name:'Run the requested checks and show their results.',exact:true}).click();
  await page.getByLabel('Task execution',{exact:true}).waitFor();assert.equal(taskCreates,1);
  report.checks.push('saved chat reopens its existing task and selected terminal without replaying execution');
  await prompt.fill('Now inspect the next issue.');await page.getByRole('button',{name:'Send and work',exact:true}).click();await page.getByRole('button',{name:'Stop task',exact:true}).waitFor();
  const second=[...tasks.values()][1];assert.equal(second.request.conversationId,first.conversationId);assert.equal(second.request.history.length,2);assert.equal(second.request.history[0].content,first.message);
  await page.getByRole('button',{name:'Stop task',exact:true}).click();await page.getByText('Stopped this synthetic task.',{exact:true}).first().waitFor();
  report.checks.push('follow-up task receives conversation history and Stop cancels its durable execution');
  loseNextReceipt=true;await prompt.fill('Recover this request after its receipt is lost.');await page.getByRole('button',{name:'Send and work',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'recover its task without starting it twice'}).waitFor();
  await page.getByRole('button',{name:'Send and work',exact:true}).click();await page.getByRole('button',{name:'Stop task',exact:true}).waitFor();assert.equal(taskCreates,3);
  await page.getByRole('button',{name:'Stop task',exact:true}).click();
  report.checks.push('lost task receipt retries with the same idempotency key and starts no duplicate task');
  await page.getByRole('button',{name:'Ask',exact:true}).click();await prompt.fill('Explain the result.');await page.getByRole('button',{name:'Send',exact:true}).click();await page.getByText('This is an answer without starting a task.',{exact:true}).waitFor();assert.equal(chatCalls,1);assert.equal(taskCreates,3);
  report.checks.push('Ask remains available for an answer without execution');
  await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  await page.getByRole('button',{name:'Work',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  await page.screenshot({path:path.join(directory,'conversation-execution-mobile.png'),fullPage:true});report.checks.push('390px conversation and shared task controls fit without horizontal overflow');
  stripTaskIds=true;await page.getByRole('button',{name:'New chat',exact:true}).click();await prompt.fill('Verify saving against an older service.');await page.getByRole('button',{name:'Send and work',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'service did not retain the task link'}).waitFor();
  const writes=report.requests.filter(item=>item.pathname.includes('/conversations')&&item.method!=='GET').length;await page.waitForTimeout(500);assert.equal(report.requests.filter(item=>item.pathname.includes('/conversations')&&item.method!=='GET').length,writes);
  report.checks.push('older service that drops task links produces a visible save error without a write loop');
  assert.deepEqual(report.errors,[]);
} catch(error) {report.failure=error.message;throw error;}
finally {await browser?.close();await server?.close();await fs.writeFile(path.join(directory,'conversation-execution-smoke.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks,errors:report.errors,taskCreates,chatCalls},null,2));
