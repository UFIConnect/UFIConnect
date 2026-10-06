import { installAuditMember, auditNavigate } from './audit-session.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
const require=createRequire(import.meta.url);
const {createAppHarness,member}=require('../backend/test-support/app-harness');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=await createAppHarness(); app.seedUser(member('following-browser'));
const server=await createServer({root:path.join(root,'web'),configFile:path.join(root,'web/vite.config.js'),envDir:false,
  define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},
  server:{host:'127.0.0.1',port:5248,strictPort:false,proxy:{'/api':{target:app.base,rewrite:p=>p.replace(/^\/api/,'')}}}});
let browser;
try {
  await server.listen(); browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
  for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:850},isMobile:width<600,hasTouch:width<600});
    const page=await context.newPage(); page.setDefaultTimeout(20000); const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let recovered=false;
    await context.route('**/api/**',async route=>{
      const url=new URL(route.request().url()),endpoint=url.pathname.replace(/^\/api/,'');
      if(/events|stream/.test(endpoint))return route.abort();
      if(endpoint!=='/office/feed')return route.continue();
      return route.fulfill({json:{posts:recovered?[{id:'recovered-post',source:'github',title:'Recovered followed account update',content:'An update from a developer you follow.',author:{name:'Followed developer'},createdAt:new Date().toISOString(),sourceUrl:'https://github.com/UFIConnect/UFIConnect'}]:[],hasMore:false,nativeUficonnectIncluded:true,sourceErrors:recovered?{}:{github:'Reconnect this account.'}}});
    });
    await installAuditMember(page,app,'following-browser');
    await auditNavigate(page,server.resolvedUrls.local[0]+'?feed=following');
    const notice=page.getByRole('status').filter({hasText:'Some connected feeds could not sync'});
    await notice.waitFor();
    assert.equal(await notice.getByRole('link',{name:'Manage connected accounts'}).getAttribute('href'),'/connected-accounts');
    const bounds=await notice.boundingBox(); assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);
    recovered=true; await page.reload();
    await page.getByText('Recovered followed account update',{exact:true}).first().waitFor();
    assert.equal(await notice.count(),0); assert.deepEqual(errors,[]);
    console.log(`PASS Following failure and recovery at ${width}px`); await context.close();
  }
} finally {await browser?.close();await server.close();await app.close();}
