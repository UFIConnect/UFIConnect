import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';
const require=createRequire(import.meta.url);
const {buildOfficeSetup}=require('../backend/office-setup.js');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const API='https://setup-api.invalid',PIPELINE='https://setup-pipeline.invalid',TOKEN='synthetic-setup-token';
const server=await createServer({root:path.join(root,'office'),configFile:path.join(root,'office/vite.config.js'),envDir:false,
 define:{'import.meta.env.VITE_API_URL':JSON.stringify(API),'import.meta.env.VITE_PIPELINE_API_URL':JSON.stringify(PIPELINE)},
 server:{host:'127.0.0.1',port:5235,strictPort:false}});
let browser;
try {
 await server.listen();
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
 await fs.mkdir(path.join(root,'.cache/audit-ui'),{recursive:true});
 for(const width of [1440,768,390,320]){
  const page=await browser.newPage({viewport:{width,height:900}});
  let mismatch=false,calls=0,deployTest=false,activationTest=false,activationMode='success';
  const activationWrites=[];
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(![API,PIPELINE].includes(url.origin))return route.continue();
   const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'x-office-token,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(req.headers()['x-office-token']!==TOKEN)return route.fulfill({status:401,headers,json:{error:'Unauthorized'}});
   if(deployTest){
    if(url.pathname==='/office/deploy/api')return route.fulfill({headers,json:{ok:false,msg:'Deployment configuration is missing.'}});
    if(url.pathname.endsWith('/stream'))return route.fulfill({headers,contentType:'text/event-stream',body:'data: {"backlog":[]}\n\n'});
    return route.fulfill({headers,json:{server:{serviceRole:url.origin===API?'api':'pipeline'},agents:{},versions:[]}});
   }
   if(activationTest&&url.pathname!=='/office/setup'){
    const role=url.origin===API?'api':'pipeline';
    if(url.pathname==='/office/controls')return route.fulfill({headers,json:{role:activationMode==='wrong-role'&&role==='pipeline'?'api':role,controls:[{id:'agents.activate-configured',target:'both',available:true,requiresConfirmation:false}]}});
    if(url.pathname==='/office/controls/agents.activate-configured/execute'){
     assert.equal(req.method(),'POST');
     assert.equal(req.postDataJSON().contextId,'office-configured-activation');
     activationWrites.push({role,mode:activationMode});
     await new Promise(resolve=>setTimeout(resolve,150));
     if(activationMode==='failed'&&role==='pipeline')return route.fulfill({status:503,headers,json:{error:'synthetic-provider-error-that-must-stay-private'}});
     return route.fulfill({headers,json:{ok:true,runId:`fixture-${role}`,result:{role,queued:role==='pipeline'?1:0,checked:role==='api'?1:0,skipped:1,failed:0,items:[
      {id:role==='api'?'data':'source-youtube',label:role==='api'?'Data check':'YouTube source',status:role==='api'?'checked':'queued',reason:role==='api'?'Database check completed.':'The rate-limited worker refresh was queued.'},
      {id:'account-only',label:'Account connection',status:'skipped',reason:'Requires the member to connect their own account.'},
     ]}}});
    }
    assert.ok(['/office/status','/office/agents'].includes(url.pathname),'Activation only refreshes service and agent observations');
    return route.fulfill({headers,json:{server:{serviceRole:role},serviceRole:role,agents:{}}});
   }
   assert.equal(url.pathname,'/office/setup','Setup does not start unrelated telemetry polling');
   calls++;
   const role=url.origin===API?'api':mismatch?'api':'pipeline';
   return route.fulfill({headers,json:buildOfficeSetup({role,database:true,env:{OPENAI_API_KEY:'synthetic-secret'}})});
  });
  await page.goto(`${server.resolvedUrls.local[0]}#setup`);
  await page.getByLabel('Access token',{exact:true}).fill(TOKEN);
  await page.getByRole('button',{name:'Unlock Office',exact:true}).click();
  await page.getByRole('button',{name:'Refresh setup',exact:true}).waitFor();
  assert.equal(calls,2);
  assert.ok(await page.locator('[data-setup-id]').count()>15);
  assert.ok(!(await page.locator('main').innerText()).includes('synthetic-secret'));
  await page.getByRole('button',{name:'Needs attention',exact:true}).click();
  assert.equal(await page.locator('.setup-ready,.setup-configured').count(),0);
  await page.getByRole('group',{name:'Setup filters'}).getByRole('button',{name:'Pipeline',exact:true}).click();
  assert.equal(await page.locator('[data-setup-id="email"]').count(),0);
  assert.equal(await page.locator('[data-setup-id="database"]').count(),1);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(root,`.cache/audit-ui/office-setup-${width}.png`),fullPage:true});
  activationTest=true;
  const connect=page.locator('.setup-connect-button');
  await connect.evaluate(element=>{element.click();element.click();});
  await page.waitForFunction(()=>document.querySelector('.setup-connect-button')?.disabled===true);
  await page.getByRole('status').filter({hasText:'Activation requests completed.'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.setup-connect-button')?.disabled===false);
  assert.deepEqual(activationWrites,[{role:'api',mode:'success'},{role:'pipeline',mode:'success'}],'A repeated activation click executes exactly once per owning service');
  assert.ok(calls>=4,'Setup inventory refreshes after activation');
  const activation=page.getByRole('region',{name:'Configured agent activation results'});
  assert.equal(await activation.locator('.office-activation-service').count(),2);
  assert.ok((await activation.innerText()).includes('1 queued'),'Queued work stays labelled queued');
  await activation.locator('summary').first().click();
  await activation.locator('summary').last().click();
  assert.equal(await activation.locator('[data-activation-state="skipped"]').count(),2,'Personal account connections are shown as skipped');
  assert.ok(!(await activation.innerText()).includes('synthetic-secret'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(root,`.cache/audit-ui/office-activation-${width}.png`),fullPage:true});
  for(const mode of ['failed','wrong-role','success']){
   activationMode=mode;
   const before=activationWrites.length;
   await connect.click();
   await page.waitForFunction(()=>document.querySelector('.setup-connect-button')?.disabled===true);
   await page.waitForFunction(()=>document.querySelector('.setup-connect-button')?.disabled===false);
   const writes=activationWrites.slice(before);
   assert.deepEqual(writes.map(item=>item.role),mode==='wrong-role'?['api']:['api','pipeline'],'A contradictory service role cannot execute the pipeline action');
   if(mode==='success')assert.equal(await activation.getByRole('alert').count(),0,'A successful retry clears the previous activation error');
   else assert.equal(await activation.getByRole('alert').count(),1,'Failed or mismatched service activation stays visible');
   assert.ok(!(await activation.innerText()).includes('synthetic-provider-error-that-must-stay-private'),'Provider error payloads are not rendered');
  }
  mismatch=true;
  await page.getByRole('button',{name:'Refresh setup',exact:true}).click();
  await page.getByText('PIPELINE unavailable',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-setup-id="database"]').count(),0,'Stale successful checks are cleared on role mismatch');
  deployTest=true;
  await page.getByRole('navigation',{name:'Office sections'}).getByRole('button',{name:'Deploy Center',exact:true}).click();
  await page.getByRole('button',{name:'Deploy Now',exact:true}).first().click();
  await page.getByRole('alert').filter({hasText:'Deployment configuration is missing.'}).waitFor();
  const nav=page.getByRole('navigation',{name:'Office sections'});
  await nav.getByRole('button',{name:'Overview',exact:true}).click();
  assert.equal(await nav.getByRole('button').count(),6,'Five primary destinations and More tools keep navigation compact');
  const moreTools=nav.getByRole('button',{name:'More tools',exact:true});
  if(width<=760){
   const bounds=await moreTools.boundingBox();
   assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=900,'More tools is fully visible without scrolling');
   assert.ok(bounds.height>=44,'Mobile More tools has a full touch target');
   await nav.locator('.office-nav-primary').evaluate(element=>{element.scrollLeft=element.scrollWidth;});
   const afterScroll=await moreTools.boundingBox();
   assert.equal(afterScroll.x,bounds.x,'More tools stays fixed while primary destinations scroll');
  }
  await moreTools.click();
  assert.equal(await moreTools.getAttribute('aria-expanded'),'true');
  assert.equal(await nav.getByRole('button').count(),20,'Nineteen Office destinations and More tools remain available');
  for(const name of ['Reports','Feed Audit','Topic Transfer','Users']){
   assert.equal(await nav.getByRole('button',{name,exact:true}).count(),1,`${name} remains accessible from More tools`);
  }
  await nav.getByRole('button',{name:'Agents',exact:true}).click();
  await page.getByRole('heading',{name:'Agent Control',exact:true}).waitFor();
  await nav.getByRole('button',{name:'Overview',exact:true}).click();
  await moreTools.click();
  assert.equal(await moreTools.getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('.office-overview-detail[open]').count(),0,'Detailed panels start collapsed');
  const details=page.locator('.office-overview-detail summary');
  await details.nth(1).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.office-overview-detail[open]').count(),1,'Keyboard users can open diagnostics');
  await page.keyboard.press('Enter');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(root,`.cache/audit-ui/office-clean-overview-${width}.png`),fullPage:true});
  await page.close();
  console.log(`Office setup: ${width}px passed`);
 }
}finally{await browser?.close();await server.close();}
