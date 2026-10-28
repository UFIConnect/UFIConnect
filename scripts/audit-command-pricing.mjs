import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
const require=createRequire(import.meta.url),{createAppHarness,member}=require('../backend/test-support/app-harness');
const app=await createAppHarness();app.seedUser(member('command-price',{accountType:'personal',onboardingComplete:true}));
const server=await startBuiltServer({port:0});let browser,checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),page=await context.newPage();
  const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
  let release;const waiting=new Promise(resolve=>{release=resolve;});let hold=true,ready=true;
  const price={active:true,display:'€27.50',unitAmount:2750,currency:'EUR',interval:'year',intervalCount:2};
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':server.origin,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'*'};
   if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
   if(!['fetch','xhr'].includes(req.resourceType()))return url.origin===server.origin?route.continue():route.abort();
   const endpoint=url.pathname.replace(/^\/(api|fallback)/,'');const reply=json=>route.fulfill({json,headers});
   if(endpoint==='/profile')return reply({...app.fullProfile(app.users[0]),accountType:'personal',plan:'free',onboardingComplete:true});
   if(endpoint==='/billing/status')return reply({plan:'free',subscriptions:[],hasBillingAccount:false});
   if(endpoint==='/billing/config'){if(hold)await waiting;return reply({paymentsReady:ready,tiers:{pro:ready},pricing:{pro:price}});}
   if(req.method()!=='GET'){if(!endpoint.startsWith('/analytics/'))writes.push(endpoint);return reply({});}
   return reply({posts:[],sources:[],items:[],groups:[],connected:{},notifications:[],unreadCount:0});
  });
  await installAuditMember(page,app,'command-price');await auditNavigate(page,server.origin+'/command-center');
  const card=page.locator('.command-center-pricing');await card.getByText('Loading price…',{exact:true}).waitFor();
  check(!(await card.innerText()).includes('$19.94'),'No hard-coded quote while billing loads');
  hold=false;release();await card.getByText('€27.50',{exact:false}).waitFor();
  check((await card.innerText()).includes('every 2 years'),'Command Center uses live currency and billing interval');
  check(await card.locator('.command-center-price').count()===1,'Personal Command Center offers only Pro');
  await page.getByRole('button',{name:'Upgrade to unlock',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'Upgrade UFIconnect'});await modal.getByText('€27.50',{exact:true}).waitFor();
  check(await modal.getByText('every 2 years',{exact:true}).isVisible(),'Checkout chooser agrees with the displayed price');
  await modal.getByRole('button',{name:'Close',exact:true}).click();
  ready=false;await auditNavigate(page,server.origin+'/settings');await card.waitFor({state:'detached'});await auditNavigate(page,server.origin+'/command-center?tab=jobs');
  await card.getByText('Price unavailable',{exact:true}).waitFor();
  check(!(await card.innerText()).includes('€27.50'),'Unavailable prices cannot look purchasable');
  ready=true;await page.getByRole('button',{name:'Retry pricing',exact:true}).click();await card.getByText('€27.50',{exact:false}).waitFor();
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Pricing fits the viewport');
  check(writes.length===0,'Pricing verification never creates checkout or changes an account');check(errors.length===0,'No uncaught pricing error');
  await fs.mkdir('.cache/audit-ui',{recursive:true});await page.screenshot({path:`.cache/audit-ui/command-pricing-${width}.png`,fullPage:true});await context.close();
 }
 console.log(`PASS ${checks} Command Center live-price, loading, unavailable, retry and responsive checks`);
}finally{await browser?.close();await server.close();await app.close();}
