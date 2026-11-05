import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {createServer} from '../office/node_modules/vite/dist/node/index.js';
import {needsToolSupport} from '../office/src/office-ai-intent.mjs';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.join(workspace,'office'),directory=path.join(workspace,'.cache/office-ai-functions-smoke');await fs.mkdir(directory,{recursive:true});
const id=randomUUID(),versionId=randomUUID(),olderId=randomUUID(),oldestId=randomUUID(),taskId=randomUUID(),continuationId=randomUUID(),checkpointId=randomUUID(),originalId=randomUUID();
const time=new Date().toISOString(),report={checks:[],errors:[]};let restored=false,removed=false,draftRestored=false,server,browser,page;
const definition={id,versionId,name:'Compound growth',description:'Calculate savings after annual growth',revision:'a'.repeat(64),createdAt:time,value:{code:'return input.principal*Math.pow(1+input.rate,input.years);',parameters:{type:'object',properties:{principal:{type:'number'},rate:{type:'number'},years:{type:'integer'}},required:['principal','rate','years']}}};
const versions=[{id:versionId,revision:'a'.repeat(64),createdAt:time},{id:olderId,revision:'b'.repeat(64),createdAt:time},{id:oldestId,revision:'c'.repeat(64),createdAt:time}];
const task={id:taskId,message:'Fix the example',status:'needs_continuation',permissions:{editCode:true},resumable:true,continuation:{id:continuationId},events:[],plan:{steps:[{id:'read',title:'Read the existing file',status:'completed'},{id:'verify',title:'Verify the corrected change',status:'in_progress'}]},recovery:{currentAttempt:2,step:'code_execute'},backups:[{id:checkpointId,summary:'Latest draft',createdAt:time},{id:originalId,summary:'Original draft',createdAt:time}]};
const harness=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:12px;background:#080e18}.office-ai{max-width:1200px;margin:auto}</style></head><body><div id="root"></div><script type="module">import React from 'react';import {createRoot} from 'react-dom/client';import Functions from '/src/OfficeAIFunctions.jsx';import Detail from '/src/OfficeAITaskDetail.jsx';import '/src/OfficeAI.css';function App(){const [request,setRequest]=React.useState('');return React.createElement('main',{className:'office-ai'},React.createElement(Functions,{apiBase:'/mock',request:fetch,onRequest:setRequest}),React.createElement('p',{'data-testid':'request'},request),React.createElement(Detail,{task:${JSON.stringify(task)},apiBase:'/mock',request:fetch,mutate:async(suffix,body)=>{await fetch('/mock/office/ai/tasks'+suffix,{method:'POST',body:JSON.stringify(body)});}}));}createRoot(document.getElementById('root')).render(React.createElement(App));</script></body></html>`;
try{
 for(const message of ['Calculate 17 times 19','What is 17 * 19?','Analyze this CSV data','Do deep research on Cloudflare','Create a reusable function for tax'])assert.equal(needsToolSupport(message),true,message);
 for(const message of ['Hello','What can you do?','Explain what a function is'])assert.equal(needsToolSupport(message),false,message);
 assert.equal(needsToolSupport('Please look at this',[{name:'sales.csv'}]),true);
 server=await createServer({root,cacheDir:path.join(workspace,'.cache/audit-office-ai-functions-vite'),configFile:path.join(root,'vite.config.js'),envDir:false,server:{host:'127.0.0.1',port:0},plugins:[{name:'functions-smoke',configureServer(dev){dev.middlewares.use('/__functions',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await dev.transformIndexHtml('/__functions',harness));});}}]});await server.listen();browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1100},acceptDownloads:true});page.on('pageerror',error=>report.errors.push(error.message));
 await page.route('**/mock/**',async route=>{
  const req=route.request(),url=new URL(req.url()),body=req.postData()?JSON.parse(req.postData()):null,method=req.method(),reply=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(url.pathname==='/mock/office/ai/functions')return reply({functions:removed?[]:[definition],runtime:'Cloudflare'});
  if(url.pathname===`/mock/office/ai/functions/${id}`&&method==='GET')return reply({function:definition,versions});
  if(url.pathname.endsWith('/run')){assert.deepEqual(body.input,{principal:1000,rate:0.05,years:10});return reply({result:1628.894626777442,logs:['calculated'],runtime:'Cloudflare Dynamic Worker',network:false});}
  if(url.pathname===`/mock/office/ai/functions/${id}/restore`){assert.deepEqual(body,{confirmed:true,versionId:olderId,expectedRevision:'a'.repeat(64)});restored=true;return reply({restored:true});}
  if(url.pathname===`/mock/office/ai/functions/${id}`&&method==='DELETE'){assert.deepEqual(body,{confirmed:true,expectedRevision:'a'.repeat(64)});removed=true;return reply({deleted:true});}
  if(url.pathname===`/mock/office/ai/tasks/${taskId}/checkpoints/${originalId}/restore`){assert.deepEqual(body,{confirmed:true,continuationId});draftRestored=true;return reply({task});}
  if(url.pathname===`/mock/office/ai/tasks/${taskId}/checkpoints/${originalId}`)return reply({checkpoint:{id:originalId,value:{files:[]}}});
  throw Error('Unexpected request '+method+' '+url.pathname);
 });
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__functions`);await page.getByRole('button',{name:'Open function',exact:true}).click();await page.getByLabel('Function input (JSON)').fill('{"principal":1000,"rate":0.05,"years":10}');await page.getByRole('button',{name:'Run in Cloudflare',exact:true}).click();await page.getByText('1628.894626777442',{exact:true}).waitFor();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download result',exact:true}).click();assert.equal((await download).suggestedFilename(),'pip-function-result.json');report.checks.push('Saved Cloudflare function executes and its calculated result downloads');
 await page.getByRole('button',{name:'Restore version',exact:true}).first().click();assert.equal(restored,false);await Promise.all([page.waitForResponse(response=>response.url().endsWith('/restore')),page.getByRole('button',{name:'Confirm restore version',exact:true}).click()]);assert.equal(restored,true);report.checks.push('Two earlier function versions use explicit review and revision checking');
 await page.getByRole('list',{name:'Work plan'}).waitFor();await page.getByText('Recovery attempt 2 / 2 · code_execute',{exact:true}).waitFor();await page.getByText(/Draft rollback checkpoints \(1 \/ 2 earlier versions\)/).click();
 const backupDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download draft',exact:true}).last().click();assert.equal((await backupDownload).suggestedFilename(),`pip-draft-${originalId}.json`);
 await page.getByRole('button',{name:'Restore draft',exact:true}).click();assert.equal(draftRestored,false);await Promise.all([page.waitForResponse(response=>response.url().includes('/checkpoints/')&&response.url().endsWith('/restore')),page.getByRole('button',{name:'Confirm restore draft',exact:true}).click()]);assert.equal(draftRestored,true);report.checks.push('Work plan, bounded recovery status, draft download and paused restore are visible');
 await page.getByRole('button',{name:'Calculate accurately'}).click();await page.getByTestId('request').getByText(/Calculate compound growth/).waitFor();
 await page.setViewportSize({width:390,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:path.join(directory,'functions-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(directory,'functions-desktop.png'),fullPage:true});
 await page.getByRole('button',{name:'Remove function Compound growth',exact:true}).click();assert.equal(removed,false);await Promise.all([page.waitForResponse(response=>response.request().method()==='DELETE'),page.getByRole('button',{name:'Confirm remove function',exact:true}).click()]);assert.equal(removed,true);assert.deepEqual(report.errors,[]);
 report.checks.push('Mobile layout fits and library deletion requires review');
}catch(error){report.failure=error.message;if(page){report.failurePage=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:path.join(directory,'failure.png'),fullPage:true}).catch(()=>{});}throw error;}
finally{await browser?.close();await server?.close();await fs.writeFile(path.join(directory,'functions-smoke.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report));
