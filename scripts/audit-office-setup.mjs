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
const server=await createServer({root:path.join(root,'office'),configFile:path.join(root,'office/vite.config.js'),envFile:false,
 define:{'import.meta.env.VITE_API_URL':JSON.stringify(API),'import.meta.env.VITE_PIPELINE_API_URL':JSON.stringify(PIPELINE)},
 server:{host:'127.0.0.1',port:5235,strictPort:false}});
let browser;
try {
 await server.listen();
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
 await fs.mkdir(path.join(root,'.cache/audit-ui'),{recursive:true});
 for(const width of [1440,768,390,320]){
  const page=await browser.newPage({viewport:{width,height:900}});
  let mismatch=false,calls=0,deployTest=false;
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
  mismatch=true;
  await page.getByRole('button',{name:'Refresh setup',exact:true}).click();
  await page.getByText('PIPELINE unavailable',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-setup-id="database"]').count(),0,'Stale successful checks are cleared on role mismatch');
  deployTest=true;
  await page.getByRole('navigation',{name:'Office sections'}).getByRole('button',{name:'Deploy Center',exact:true}).click();
  await page.getByRole('button',{name:'Deploy Now',exact:true}).first().click();
  await page.getByRole('alert').filter({hasText:'Deployment configuration is missing.'}).waitFor();
  await page.close();
  console.log(`Office setup: ${width}px passed`);
 }
}finally{await browser?.close();await server.close();}
