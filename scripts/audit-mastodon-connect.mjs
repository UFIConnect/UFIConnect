import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createServer} from '../web/node_modules/vite/dist/node/index.js';
import {installAuditMember,auditNavigate,auditReload} from './audit-session.mjs';
const require=createRequire(import.meta.url);
const {createAppHarness,member}=require('../backend/test-support/app-harness');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=await createAppHarness();app.seedUser(member('masto-ui'));
const server=await createServer({root:path.join(root,'web'),configFile:path.join(root,'web/vite.config.js'),envDir:false,define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},server:{host:'127.0.0.1',port:5243,strictPort:false,proxy:{'/api':{target:app.base,rewrite:p=>p.replace(/^\/api/,'')}}}});
let browser;
try{
 await server.listen();browser=await chromium.launch({channel:'msedge'});
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900}});const page=await context.newPage();const starts=[];let connected=false;
  await context.route('**/api/**',async route=>{
   const url=new URL(route.request().url());const endpoint=url.pathname.replace(/^\/api/,'');
   if(endpoint==='/social/platforms')return route.fulfill({json:{platforms:{mastodon:{name:'Mastodon',color:'#6364FF',configured:true,needsServer:true,siteUrl:connected?'https://social.example':undefined}},connected:{mastodon:connected}}});
   if(endpoint==='/auth/social/mastodon/start'){starts.push(url.searchParams.get('server'));return route.fulfill({status:400,json:{error:'Synthetic server response'}});}
   if(/events|stream/.test(endpoint))return route.abort();
   return route.continue();
  });
  await installAuditMember(page,app,'masto-ui');await auditNavigate(page,server.resolvedUrls.local[0]+'connected-accounts');
  await page.getByRole('button',{name:'Connect',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Connect Mastodon'});await dialog.waitFor();
  await dialog.getByLabel('Server or full handle').fill('@alice@social.example');
  await dialog.getByRole('button',{name:'Continue to Mastodon'}).click();
  await page.getByText('Synthetic server response',{exact:true}).waitFor();
  assert.deepEqual(starts,['@alice@social.example']);
  assert.equal(await page.getByRole('link',{name:'Open Mastodon website'}).getAttribute('href'),'https://joinmastodon.org/servers');
  connected=true;await auditReload(page);
  await page.getByRole('button',{name:'Disconnect',exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'Open Mastodon website'}).getAttribute('href'),'https://social.example');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  console.log('PASS Mastodon server selection and links '+width);await context.close();
 }
}finally{await browser?.close();await server.close();await app.close();}
