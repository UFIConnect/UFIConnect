import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {createServer} from '../web/node_modules/vite/dist/node/index.js';
import {installAuditMember,auditNavigate} from './audit-session.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.cache/audit-ui');
await fs.mkdir(output,{recursive:true});
const require=createRequire(import.meta.url);
const {createAppHarness,member}=require('../backend/test-support/app-harness');
const app=await createAppHarness();
app.seedUser(member('member-jobs-sidebar',{name:'Sidebar member'}));
const proxy=prefix=>({target:app.base,rewrite:value=>value.replace(prefix,'')});
const server=await createServer({root:path.join(root,'web'),configFile:path.join(root,'web/vite.config.js'),envDir:false,
 define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api'),'import.meta.env.VITE_API_FALLBACK_URL':JSON.stringify('/fallback')},
 server:{host:'127.0.0.1',port:5281,strictPort:false,proxy:{'/api':proxy(/^\/api/),'/fallback':proxy(/^\/fallback/)}}});
let browser,checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
try{
 await server.listen();
 const base=server.resolvedUrls.local[0];
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
 for(const width of [1440,820,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
  const common={type:'job',org:'Example employer',content:'Build useful products with an accessible engineering team.',description:'Build useful products with an accessible engineering team.',remote:true,location:'Remote',posted:new Date().toISOString(),isLive:true,tags:[]};
  const jobs=[{...common,id:'member-role',title:'Member engineer',source:'UFIConnect',nativeJob:true,authorId:'member-jobs-sidebar',sourceUrl:'https://example.invalid/member'},
   {...common,id:'external-role',title:'External engineer',source:'Remotive',sourceUrl:'https://example.invalid/external'}];
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
   const endpoint=url.pathname.replace(/^\/(api|fallback)/,'');
   if(endpoint==='/opportunities'){
    const params=url.searchParams;requests.push(Object.fromEntries(params));
    const selected=params.get('sources'),rows=selected?jobs.filter(job=>selected.split(',').includes(job.source)):jobs;
    return route.fulfill({json:{opportunities:rows,totalCount:rows.length,hasMore:false,availableSources:['UFIConnect','Remotive'],liveCount:rows.length}});
   }
   if(/events|stream/.test(endpoint)&&/^\/(api|fallback)\//.test(url.pathname))return route.abort();
   return route.continue();
  });
  await installAuditMember(page,app,'member-jobs-sidebar');
  await auditNavigate(page,base+'opportunities?q=engineer&sort=title');
  await page.locator('.job-result-tab').first().waitFor();
  const openTools=async()=>{
   if(width<=768){const drawer=page.locator('#mobile-feed-drawer');if(!await drawer.isVisible())await page.getByRole('button',{name:'Open menu',exact:true}).click();return drawer;}
   return page.locator('.jobs-page-right-tabs');
  };
  let tools=await openTools();
  let shortcut=tools.getByRole('button',{name:'Member jobs',exact:true});
  check(await shortcut.getAttribute('aria-pressed')==='false','Member shortcut starts inactive');
  check(await shortcut.getAttribute('aria-describedby')&&await shortcut.innerText().then(text=>text.includes('Posted directly on UFIConnect')),'Member shortcut explains that it is native listings');
  const choose=async(role,label,predicate)=>{
   tools=await openTools();
   const response=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname.endsWith('/opportunities')&&predicate(u.searchParams);});
   await tools.getByRole(role,{name:label,exact:true}).click();
   check((await response).ok(),'Filter API request succeeds: '+label);
  };
  await choose('button','Member jobs',p=>p.get('sources')==='UFIConnect');
  await page.getByRole('button',{name:'Open Member engineer at Example employer',exact:true}).waitFor();
  check(await page.getByRole('button',{name:'Open External engineer at Example employer',exact:true}).count()===0,'Member filter excludes imported listings');
  check(new URL(page.url()).searchParams.get('q')==='engineer'&&new URL(page.url()).searchParams.get('sort')==='title','Member shortcut preserves search and sort');
  tools=await openTools();
  check(await tools.getByRole('button',{name:'Member jobs',exact:true}).getAttribute('aria-pressed')==='true','Member shortcut reflects selected source');
  check(await tools.getByRole('radiogroup',{name:'Career sites',exact:true}).getByRole('radio',{name:'UFIConnect',exact:true}).getAttribute('aria-checked')==='true','Shortcut and native source radio stay synchronized');
  await choose('radio','Remote',p=>p.get('sources')==='UFIConnect'&&p.get('remote')==='true');
  await choose('radio','Today',p=>p.get('sources')==='UFIConnect'&&p.get('remote')==='true'&&p.get('postedWithin')==='1');
  await choose('radio','Remotive',p=>p.get('sources')==='Remotive'&&p.get('remote')==='true'&&p.get('postedWithin')==='1');
  tools=await openTools();
  check(await tools.getByRole('button',{name:'Member jobs',exact:true}).getAttribute('aria-pressed')==='false','Choosing an imported source clears Member shortcut state');
  // Returning to the member/date/remote scope can restore its successful cache.
  await tools.getByRole('button',{name:'Member jobs',exact:true}).click();
  await page.getByRole('button',{name:'Open Member engineer at Example employer',exact:true}).waitFor();
  check(new URL(page.url()).searchParams.get('sources')==='UFIConnect','Member shortcut restores a previously loaded native scope');
  await choose('button','Member jobs',p=>!p.has('sources')&&p.get('postedWithin')==='1'&&p.get('remote')==='true');
  tools=await openTools();
  const compact=await tools.getByRole('radiogroup',{name:'Sort jobs',exact:true}).evaluate(element=>({columns:getComputedStyle(element).gridTemplateColumns.split(' ').length,buttons:[...element.children].map(button=>({height:button.getBoundingClientRect().height,width:button.getBoundingClientRect().width}))}));
  check(compact.columns===2&&compact.buttons.every(b=>b.height>=40&&b.width>=60),'Sort buttons use a compact two-column layout with usable targets');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Jobs controls fit viewport');
  if(width>768){
   const footer=page.locator('.jobs-page-rail-bottom');
   const bounds=await footer.boundingBox();
   check(bounds.height<=200&&bounds.y+bounds.height<=900+1,'Bottom job tools are compact and remain within viewport');
   const skill=footer.getByRole('button',{name:'Skills',exact:true}),files=footer.getByRole('button',{name:'Attachments',exact:true});
   const [a,b]=await Promise.all([skill.boundingBox(),files.boundingBox()]);
   check(Math.abs(a.y-b.y)<1&&a.height>=40&&b.height>=40,'Skills and Attachments share one usable row');
   await skill.click();
   const panel=footer.locator('.profile-panel:has(.profile-panel-trigger[aria-expanded="true"])');
   check(await panel.evaluate(element=>getComputedStyle(element).gridColumn)==='1 / -1','Expanded bottom panel spans full width');
   await skill.click();
   check(await footer.getByRole('link',{name:'Resume Builder',exact:true}).evaluate(element=>element.getBoundingClientRect().height<=44),'Resume Builder uses a single compact row');
  }
  assert.deepEqual(errors,[]);checks++;
  await page.screenshot({path:path.join(output,`member-job-sidebar-${width}.png`),fullPage:true});
  await context.close();
  console.log('PASS: Member jobs and compact sidebar at '+width+'px');
 }
 await fs.writeFile(path.join(output,'member-job-sidebar-results.json'),JSON.stringify({passed:true,checks,widths:[1440,820,390,320],productionWrites:0},null,2)+'\n');
 console.log('PASS: '+checks+' member jobs/sidebar checks');
}catch(error){
 const page=browser?.contexts().at(-1)?.pages().at(-1);
 if(page)await page.screenshot({path:path.join(output,'member-job-sidebar-failure.png'),fullPage:true});
 throw error;
}finally{await browser?.close();await server.close();await app.close();}
