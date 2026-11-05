import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), root=path.join(workspace,'office'), directory=path.join(workspace,'.cache/office-ai-locks-smoke');
await fs.mkdir(directory,{recursive:true});
const report={checks:[],errors:[],requests:[]}, checkpoints=Array.from({length:121},(_,i)=>({id:`checkpoint-${i}`,summary:`Saved draft ${i}`,createdAt:new Date(Date.now()-i*1000).toISOString()}));
const task={id:'task-fixture',message:'Adjust the project settings.',status:'working',recoveryAvailable:true,executionLock:{protected:true,held:true,scope:'project edits'},events:[],backups:[checkpoints[0]],progress:{modelTurns:2,toolCalls:3,automaticContinuations:25},limits:{modelTurns:128,toolCalls:512,automaticContinuations:'unlimited'},recovery:{currentAttempt:21,limit:'unlimited',step:'Checking the saved operation'}};
const appHarness=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import App from '/src/App.jsx';import OfficeAccessDialog from '/src/OfficeAccessDialog.jsx';createRoot(document.getElementById('root')).render(React.createElement(React.Fragment,null,React.createElement(OfficeAccessDialog),React.createElement(App)));</script></body></html>`;
const taskHarness=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#1b1826;color:#eee"><div id="root"></div><script type="module">import React,{useState}from'react';import{createRoot}from'react-dom/client';import OfficeAITaskDetail from '/src/OfficeAITaskDetail.jsx';import '/src/OfficeAI.css';import '/src/OfficeAITasks.css';window.mutations=[];function Harness(){const[task,setTask]=useState(${JSON.stringify(task)});window.setTestTask=setTask;return React.createElement('div',{className:'office-ai'},React.createElement(OfficeAITaskDetail,{task,busy:false,apiBase:'/mock',request:fetch,mutate:(suffix,body)=>{window.mutations.push({suffix,body});if(suffix.endsWith('/recover'))setTask(previous=>({...previous,status:'recovery_requested'}));}}));}createRoot(document.getElementById('root')).render(React.createElement(Harness));</script></body></html>`;
let server,browser,page;
async function mock(route) {
  const req=route.request(),url=new URL(req.url()),pathname=url.pathname.replace(/^\/mock/,''),headers=req.headers();
  report.requests.push({pathname,method:req.method()});
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(pathname==='/office/ai/tasks/task-fixture/checkpoints') {
    const start=Number(url.searchParams.get('before')||0),limit=Number(url.searchParams.get('limit')||50),end=start+limit;
    return reply({checkpoints:checkpoints.slice(start,end),nextBefore:end<checkpoints.length?String(end):null,hasMore:end<checkpoints.length,total:checkpoints.length,retention:'unlimited'});
  }
  if(headers['x-office-token']!=='fixture-access')return reply({error:'Access required'},401);
  if(pathname==='/office/status')return reply({server:{}});
  if(pathname==='/office/ai')return reply({configured:true,provider:'Cloudflare',model:'fixture'});
  if(pathname==='/office/ai/tools')return reply({tools:[]});
  if(pathname==='/office/controls')return reply({controls:[]});
  if(pathname==='/office/connections')return reply({connections:[]});
  if(pathname==='/office/ai/tasks')return reply({tasks:[],capabilities:{deploymentApprovalRequired:true,recoveryAttempts:'unlimited',rollbackCopies:'unlimited',taskRecoveryAvailable:true}});
  if(pathname==='/office/ai/conversations')return reply({conversations:[]});
  if(pathname==='/office/agents')return reply({agents:[]});
  if(pathname==='/office/versions')return reply({versions:[]});
  return reply({});
}
try {
  server=await createServer({cacheDir:path.join(directory,'vite'),root,configFile:path.join(root,'vite.config.js'),envDir:false,server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{name:'office-lock-smoke',configureServer(dev){for(const[url,harness]of[['/__office_locks',appHarness],['/__office_task_locks',taskHarness]])dev.middlewares.use(url,async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await dev.transformIndexHtml(url,harness));});}}]});
  await server.listen(); browser=await chromium.launch({headless:true}); page=await browser.newPage({viewport:{width:1440,height:1100}});
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.route(url=>/^(?:\/mock)?\/office\//.test(url.pathname),mock); await page.addInitScript(()=>sessionStorage.setItem('ufi_office_locked','1'));
  const base=`http://127.0.0.1:${server.httpServer.address().port}/__office_locks`;
  await page.goto(base+'#office-ai'); await page.getByRole('heading',{name:'Pip is locked',exact:true}).waitFor();
  assert.equal(await page.getByRole('navigation',{name:'Pip main navigation',exact:true}).count(),0);
  assert.equal(report.requests.length,0,'Locked page sends no Office request');
  await page.getByRole('button',{name:'Unlock Office',exact:true}).click();
  await page.getByLabel('Access token',{exact:true}).fill('wrong-access'); await page.getByRole('dialog').getByRole('button',{name:'Unlock Office',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'remains locked'}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'Pip is locked',exact:true}).isVisible(),true);
  report.checks.push('Lock survives reload, hides all workspace content, sends no background requests, and rejects an incorrect unlock token');
  await page.getByRole('button',{name:'Unlock Office',exact:true}).click(); await page.getByLabel('Access token',{exact:true}).fill('fixture-access'); await page.getByRole('dialog').getByRole('button',{name:'Unlock Office',exact:true}).click();
  await page.getByRole('heading',{name:'Pip is locked',exact:true}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Open Pip',exact:true}).click();
  await page.getByRole('button',{name:'Lock assistant',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('ufi_office_locked')),null);
  for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});const lock=page.getByRole('button',{name:'Lock assistant',exact:true});assert.equal(await lock.isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px lock controls fit`);}
  await page.getByRole('button',{name:'Lock assistant',exact:true}).click(); await page.getByRole('heading',{name:'Pip is locked',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Message Pip',exact:true}).count(),0);
  await page.screenshot({path:path.join(directory,'locked-phone.png'),fullPage:true});
  report.checks.push('Fresh verified access unlocks Office; the visible assistant lock works at desktop, phone and 320px widths and removes the private interface');
  await page.goto(base.replace('/__office_locks','/__office_task_locks'));
  await page.getByText('Project edits are locked to this task while it works.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Recover task',exact:true}).click();
  await page.getByRole('button',{name:'Recovery requested',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Recovery requested',exact:true}).isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>window.mutations),[{suffix:'/task-fixture/recover',body:{confirmed:true}}]);
  await page.getByText('Task details',{exact:true}).click();
  assert.match(await page.getByLabel('Task execution',{exact:true}).innerText(),/25 times · no fixed attempt limit/);
  assert.match(await page.getByLabel('Task execution',{exact:true}).innerText(),/Recovery attempt 21 · no fixed attempt limit/);
  report.checks.push('Task lock is visible; Recover sends the saved task identity once and disables duplicate recovery while requested; unlimited attempts display correctly beyond ten');
  await page.evaluate(value=>window.setTestTask({...value,status:'needs_continuation',continuation:{id:'continue-fixture'},resumable:true}),task);
  await page.getByText('Draft rollback checkpoints',{exact:true}).click();
  await page.getByText('121 saved checkpoints.',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Load older checkpoints',exact:true}).click();
  await page.getByText('Rollback version 99 · Saved draft 99',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Load older checkpoints',exact:true}).click();
  await page.getByText('Rollback version 120 · Saved draft 120',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Load older checkpoints',exact:true}).count(),0);
  await page.locator('.office-ai-receipt').filter({hasText:'Rollback version 120 · Saved draft 120'}).getByRole('button',{name:'Restore draft',exact:true}).click();
  await page.getByRole('button',{name:'Confirm restore draft',exact:true}).click();
  assert.deepEqual((await page.evaluate(()=>window.mutations)).at(-1),{suffix:'/task-fixture/checkpoints/checkpoint-120/restore',body:{confirmed:true,continuationId:'continue-fixture'}});
  report.checks.push('Rollback history loads all 121 checkpoint receipts across pages, reaches and restores the oldest saved version, and retains the continuation identity');
  assert.deepEqual(report.errors,[]);
} catch(error) {report.failure=error.message;if(page){report.failurePage=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{});}throw error;}
finally {await browser?.close();await server?.close();await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({checks:report.checks.length,errors:report.errors.length,directory}));
