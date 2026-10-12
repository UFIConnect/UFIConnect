import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

// Exercise the actual React hook with promises deliberately ignoring abort, so
// its generation checks are tested independently of Axios cancellation.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-ui/paged-results');
await fs.mkdir(output, {recursive:true});
const report = {checkedAt:new Date().toISOString(),fixturesOnly:true,checks:[]};
const check=(value,message)=>{assert.ok(value,message);report.checks.push(message);};
const fixture=String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import usePagedResults from './hooks/usePagedResults.js';
window.requests=[];
function Harness(){
  const [query,setQuery]=React.useState('original'),[enabled,setEnabled]=React.useState(true);
  const results=usePagedResults({queryKey:query,enabled,loadPage:({page,cursor,signal})=>new Promise((resolve,reject)=>window.requests.push({query,page,cursor,signal,resolve,reject}))});
  React.useLayoutEffect(()=>{window.subject={...results,setQuery,setEnabled};});
  return <output>{JSON.stringify({page:results.page,items:results.items,loading:results.loading,error:results.error})}</output>;
}
const mount=createRoot(document.getElementById('root'));
window.unmount=()=>mount.unmount();
mount.render(<React.StrictMode><Harness/></React.StrictMode>);
`;
const server=await createServer({root:path.join(root,'web'),envDir:false,configFile:false,
  plugins:[{name:'isolated-pagination-hook',resolveId(id){if(id.endsWith('/__paged_fixture.jsx'))return path.join(root,'web/src/__paged_fixture.jsx');},load(id){if(id.endsWith('__paged_fixture.jsx'))return fixture;},
    configureServer(server){server.middlewares.use('/hook',(req,res)=>{res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script type="module" src="/src/__paged_fixture.jsx"></script>');});}}],
  server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
await server.listen(); const origin=server.resolvedUrls.local[0].replace(/\/$/,'');
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage(); const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/hook');
  const request=async length=>{await page.waitForFunction(n=>window.requests.length===n,length);return page.evaluate(()=>window.requests.at(-1).page);};
  const resolve=async(index,value)=>{await page.evaluate(({index,value})=>window.requests[index].resolve(value),{index,value});await page.waitForTimeout(30);};
  const value=()=>page.evaluate(()=>({page:window.subject.page,items:window.subject.items,loading:window.subject.loading,hasNext:window.subject.hasNext,error:window.subject.error,total:window.subject.total}));
  const next=()=>page.evaluate(()=>{void window.subject.goToPage(window.subject.page+1);});
  await request(1); check(await page.evaluate(()=>window.requests[0].page===1),'Initial request starts at page 1 under React StrictMode');
  await resolve(0,{items:['a','b'],hasNext:true,nextCursor:'after-b'});
  check((await value()).page===1&&(await value()).total===null,'Unknown totals remain unknown');
  await next(); await request(2);
  check(await page.evaluate(()=>window.requests[1].cursor==='after-b'),'Next uses the previous successful cursor');
  await page.evaluate(()=>window.requests[1].reject(new Error('Fixture outage'))); await page.waitForFunction(()=>!!window.subject.error);
  check((await value()).page===1&&(await value()).items.join(',')==='a,b','Failed Next preserves the visible first page');
  await page.evaluate(()=>{void window.subject.retry();}); check(await request(3)===2,'Retry requests the failed destination page');
  await resolve(2,{items:['c','d'],hasNext:true,nextCursor:'after-d'});
  await page.evaluate(()=>{void window.subject.goToPage(1);}); await page.waitForFunction(()=>window.subject.page===1);
  check(await page.evaluate(()=>window.requests.length===3&&window.subject.items[0]==='a'),'Previous restores cached successful items without changing cursor history');
  await next(); await page.waitForFunction(()=>window.subject.page===2);
  check(await page.evaluate(()=>window.requests.length===3&&window.subject.items[0]==='c'),'Returning forward restores the existing page');
  await page.evaluate(()=>{void window.subject.goToPage(3);void window.subject.goToPage(3);}); await request(4);
  check(await page.evaluate(()=>window.requests.length===4),'Repeated Next while loading starts only one request');
  await resolve(3,{items:[],hasNext:false,total:4});
  check((await value()).page===2&&!(await value()).hasNext&&(await value()).items[0]==='c','An empty terminal response retains the populated page and disables Next');
  await page.evaluate(()=>{void window.subject.goToPage(1);}); await page.waitForFunction(()=>window.subject.page===1); await next(); await page.waitForFunction(()=>window.subject.page===2);
  check(!(await value()).hasNext,'Cached last page remembers the empty-next boundary');
  await page.evaluate(()=>{void window.subject.refresh();}); await request(5);
  check((await value()).loading&&(await value()).items.length===0,'Refresh resets to a fresh first page');
  await page.evaluate(()=>window.subject.setQuery('new-query')); await request(6);
  check(await page.evaluate(()=>window.requests[4].signal.aborted&&window.requests[5].page===1),'Query changes abort the previous request and reset to page 1');
  await resolve(5,{items:['new-result'],hasNext:false,total:1});
  await resolve(4,{items:['stale-result'],hasNext:true,total:99});
  check((await value()).items[0]==='new-result'&&(await value()).total===1,'An old response cannot replace newer query results even if its loader ignores abort');
  await page.evaluate(()=>window.subject.setQuery('tab-request')); await request(7);
  await page.evaluate(()=>window.subject.setEnabled(false)); await page.waitForFunction(()=>!window.subject.loading);
  await resolve(6,{items:['inactive-tab-result'],hasNext:true});
  check((await value()).items.length===0,'Responses from an inactive tab cannot commit');
  await page.evaluate(()=>window.subject.setEnabled(true)); await request(8);
  await resolve(7,{items:[],hasNext:false,total:0});
  check((await value()).page===1&&!(await value()).hasNext&&(await value()).total===0,'Empty searches expose a genuine empty first page');
  await page.evaluate(()=>window.subject.setQuery(JSON.stringify(['account-A','same-query']))); await request(9);
  await resolve(8,{items:['account-A-private'],hasNext:true,nextCursor:'account-A-cursor'});
  await next(); await request(10);
  await page.evaluate(()=>window.subject.setQuery(JSON.stringify(['account-B','same-query']))); await request(11);
  check(await page.evaluate(()=>window.subject.items.length===0&&window.requests[10].cursor===''),'Account changes clear prior items and cursor history before loading');
  await resolve(10,{items:['account-B-private'],hasNext:true,nextCursor:'account-B-cursor'});
  await resolve(9,{items:['account-A-stale-private'],hasNext:true});
  check((await value()).items[0]==='account-B-private'&&(await value()).page===1,'A late prior-account page cannot expose its items in the new account');
  await next(); await request(12); await page.evaluate(()=>window.unmount());
  check(await page.evaluate(()=>window.requests[11].signal.aborted),'Unmount aborts the active request');
  await resolve(11,{items:['too-late'],hasNext:true});
  check(errors.length===0,'All races complete without browser exceptions');
  report.passed=true; console.log(JSON.stringify({passed:true,checks:report.checks.length,output}));
}catch(error){report.passed=false;report.error=error.stack;throw error;}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();await server.close();}
