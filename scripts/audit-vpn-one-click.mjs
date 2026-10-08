// Synthetic browser audit: native launching is injected so this never opens
// a protocol handler, installs software, signs in, or changes a host VPN.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-vpn-one-click');
const fixture = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {BrowserRouter} from 'react-router-dom';
import {ManagedVpnPanel} from '/src/components/VaultVpnPanel.jsx';
import {setAccessToken, clearSession} from '/src/auth/session.js';
import '/src/index.css';
import '/src/pages/Vault.css';
setAccessToken('synthetic-account-a');
window.__vpnAudit = {launched:[], clearSession};
function Fixture(){
 const [state,setState]=useState({accountId:'account-a',active:false});
 window.__vpnAudit.update=patch=>{if(patch.accountId)setAccessToken('synthetic-'+patch.accountId);flushSync(()=>setState(old=>({...old,...patch})));};
 return React.createElement(BrowserRouter,null,React.createElement('main',{style:{maxWidth:480,padding:16,margin:'auto'}},React.createElement(ManagedVpnPanel,{
  accountId:state.accountId,billing:{active:state.active,checking:false,status:{vpnConnectorAddon:state.active,subscriptions:state.active?[{kind:'vpn_connector',status:'active',currentPeriodEnd:Math.floor(Date.now()/1000)+3600}]:[]}},
  openApp:url=>window.__vpnAudit.launched.push(url)})));
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));`;
const server = await createServer({root:path.join(root,'web'), configFile:path.join(root,'web/vite.config.js'), envDir:false,
 define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api'),'import.meta.env.VITE_API_FALLBACK_URL':JSON.stringify('/api')},
 plugins:[{name:'vpn-browser-fixture',
  resolveId(id){if(id==='virtual:vpn-audit.jsx')return '\0virtual:vpn-audit.jsx';},
  load(id){if(id==='\0virtual:vpn-audit.jsx')return fixture;},
  configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(req.url!=='/__vpn-audit')return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>VPN browser audit</title></head><body><div id="root"></div><script type="module" src="/@id/virtual:vpn-audit.jsx"></script></body></html>'));});},
 }], server:{host:'127.0.0.1',port:5249,strictPort:false}});
let browser, page, checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
try {
 await fs.mkdir(output,{recursive:true});
 await server.listen();
 const base=server.resolvedUrls.local[0];
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
 for(const device of [
  {platform:'windows',width:1440,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'},
  {platform:'android',width:390,userAgent:'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36'},
 ]){
  const context=await browser.newContext({viewport:{width:device.width,height:900},userAgent:device.userAgent,serviceWorkers:'block'});
  await context.addInitScript(platform => Object.defineProperty(navigator, 'platform', { get: () => platform }), device.platform === 'windows' ? 'Win32' : 'Linux armv8l');
  page=await context.newPage();page.setDefaultTimeout(10000);
  const errors=[],requests=[];
  let available=true,configFailure=false,launchFailure=false,badUrl=false,badNonce=false,expired=false,held=null,launches=0,configReads=0;
  page.on('pageerror',error=>{errors.push(error.message);console.error('Browser error: '+error.message);});
  await context.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname==='/api/vpn/config'){configReads++;return route.fulfill({status:configFailure?503:200,json:configFailure?{message:'Unavailable'}:{available,protocol:'wireguard',gateways:available?[{id:'test-us-1',label:'US'}]:[]}});}
   if(url.pathname==='/api/vpn/launch'){
    launches++;requests.push(request.postDataJSON());
    if(held)await held;
    return route.fulfill({status:launchFailure?503:200,json:launchFailure?{message:'Unavailable'}:{url:badUrl?'https://attacker.invalid/':`uficonnect-vpn://connect?code=${'c'.repeat(42)+(badNonce?'d':'c')}`,expiresAt:new Date(Date.now()+(expired?-1000:180000)).toISOString()}});
   }
   return route.fulfill({status:200,json:{status:'ok'}});
  });
  await page.goto(base+'__vpn-audit');
  const button=page.getByRole('button',{name:device.platform==='windows'?'Enable VPN':'Connect VPN',exact:true});
  const download=page.getByRole('link',{name:'Download Windows preview',exact:true});
  if(device.platform==='windows') {
   check(await download.getAttribute('href')==='/downloads/UFIConnect-VPN-Windows-x64-preview.zip','Windows download points to the packaged app');
   check(await download.getAttribute('download')!==null,'Windows package is offered as a download');
   const packageResponse=await context.request.get(base+'downloads/UFIConnect-VPN-Windows-x64-preview.zip');
   const packageBytes=await packageResponse.body();
   const manifest=JSON.parse(await fs.readFile(path.join(root,'web/public/downloads/windows-vpn-preview.json'),'utf8'));
   check(packageResponse.ok()&&packageBytes.subarray(0,2).toString()==='PK','Windows download serves a real ZIP, not the SPA fallback');
   check(packageBytes.length===manifest.bytes&&createHash('sha256').update(packageBytes).digest('hex')===manifest.sha256,'Windows package matches the published checksum and size');
   check(await page.getByText('This preview is unsigned',{exact:false}).isVisible(),'Windows preview limitations are visible before downloading');
  } else check(await download.count()===0,'Android does not receive a Windows installer');
  await page.getByRole('status').filter({hasText:'Subscription required'}).waitFor();
  check(await button.isDisabled(),'Unpaid member cannot launch');
  check(launches===0,'Locked state makes no launch request');
  check(configReads===0,'Unpaid member never requests member VPN configuration');
  check(await page.getByLabel('Check VPN availability').isDisabled(),'Unpaid availability control is locked');
  await page.evaluate(()=>window.__vpnAudit.update({active:true}));
  await button.waitFor();
  check(await button.isEnabled(),'Paid member with gateway can connect');
  available=false;
  await page.getByLabel('Check VPN availability').click();
  await page.locator('.vault-status').filter({hasText:'Unavailable'}).waitFor();
  check(await button.isDisabled(),'Missing gateway cannot launch');
  configFailure=true;
  await page.getByLabel('Check VPN availability').click();
  await page.getByRole('alert').filter({hasText:'availability could not be checked'}).waitFor();
  check(await button.isDisabled(),'Failed availability check remains closed');
  configFailure=false;available=true;
  await page.getByLabel('Check VPN availability').click();
  await page.locator('.vault-status').filter({hasText:'Ready to open app'}).waitFor();
  launchFailure=true;
  await button.click();
  await page.getByRole('alert').filter({hasText:'temporarily unavailable'}).waitFor();
  check(await button.isEnabled(),'Launch failure allows retry');
  check((await page.evaluate(()=>window.__vpnAudit.launched.length))===0,'Failed launch never opens a protocol');
  launchFailure=false;badUrl=true;
  await button.click();
  await page.getByRole('alert').filter({hasText:'could not be opened'}).waitFor();
  check((await page.evaluate(()=>window.__vpnAudit.launched.length))===0,'Untrusted handoff URL is rejected');
  badUrl=false;badNonce=true;
  await button.click();
  await page.getByRole('alert').filter({hasText:'could not be opened'}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.vault-vpn-quick-action button').disabled);
  check((await page.evaluate(()=>window.__vpnAudit.launched.length))===0,'Noncanonical nonce padding bits never reach the native app');
  badNonce=false;expired=true;
  await button.click();
  await page.getByRole('alert').filter({hasText:'could not be opened'}).waitFor();
  check((await page.evaluate(()=>window.__vpnAudit.launched.length))===0,'Expired ticket never opens an app');
  expired=false;
  let release;held=new Promise(resolve=>{release=resolve;});
  const before=launches;
  await button.evaluate(element=>{element.click();element.click();});
  await page.waitForFunction(()=>document.querySelector('.vault-vpn-quick-action button').disabled);
  await new Promise(resolve=>setTimeout(resolve,80));
  check(launches===before+1,'Duplicate click creates only one ticket');
  release();held=null;
  await page.getByRole('status').filter({hasText:'Opening UFIConnect. Confirm'}).waitFor();
  check((await page.evaluate(()=>window.__vpnAudit.launched.length))===1,'Successful ticket opens native app once');
  check((await page.locator('.vault-status').innerText())==='Opening UFIConnect','Browser reports opening instead of a connected tunnel');
  check(await page.locator('.vault-status.is-connected').count()===0,'Browser never asserts a connection from enrollment or launch');
  check(await page.getByText(`Use ${device.platform==='windows'?'Disable':'Disconnect'} in the app to stop VPN.`,{exact:false}).count()===1,'App owns real disconnection');
  let releaseOld;held=new Promise(resolve=>{releaseOld=resolve;});
  await button.click();
  await page.waitForFunction(()=>document.querySelector('.vault-vpn-quick-action button').disabled);
  await page.evaluate(()=>window.__vpnAudit.update({accountId:'account-b',active:true}));
  await page.locator('.vault-status').filter({hasText:'Ready to open app'}).waitFor();
  releaseOld();held=null;
  await new Promise(resolve=>setTimeout(resolve,100));
  check((await page.evaluate(()=>window.__vpnAudit.launched.length))===1,'Old account completion cannot open its ticket');
  check((await page.locator('.vault-status').innerText())==='Ready to open app','Old completion cannot change new account status');
  let releaseCanceled;held=new Promise(resolve=>{releaseCanceled=resolve;});
  const beforeCancellation=launches;
  await button.click();
  await page.waitForFunction(()=>document.querySelector('.vault-vpn-quick-action button').disabled);
  await new Promise(resolve=>setTimeout(resolve,80));
  check(launches===beforeCancellation+1,'Pending paid handoff was sent before membership changed');
  await page.evaluate(()=>window.__vpnAudit.update({active:false}));
  await page.locator('.vault-status').filter({hasText:'Subscription required'}).waitFor();
  releaseCanceled();held=null;
  await new Promise(resolve=>setTimeout(resolve,100));
  check((await page.evaluate(()=>window.__vpnAudit.launched.length))===1,'Membership loss blocks a late native app handoff');
  check(await button.isDisabled(),'VPN remains locked after canceled handoff');
  check(requests.every(body=>JSON.stringify(body)===JSON.stringify({platform:device.platform})),'Launch only sends the detected supported platform');
  const text=await page.locator('body').innerText();
  check(!/terminal|powershell|Proton|local companion|configured countries|setup pending|Open VPN controls/i.test(text),'Production UI contains no legacy terminal/provider/setup flow');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'VPN controls fit the viewport');
  check(errors.length===0,'No browser runtime errors: '+errors.join('; '));
  await page.screenshot({path:path.join(output,device.platform+'.png'),fullPage:true});
  await context.close();
 }
 console.log(`PASS: ${checks} VPN handoff browser checks across Windows desktop and Android; no native handler launched.`);
}catch(error){await page?.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();await server.close();}
