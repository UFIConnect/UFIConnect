import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = path.join(root, 'web/__media-permission-fixture.jsx').replaceAll('\\', '/');
const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {MemoryRouter,Link} from 'react-router-dom';
import MediaPermissionPrompt from '/src/components/MediaPermissionPrompt.jsx'; import {configureNativeRuntime} from '/src/nativeRuntime.mjs';
import MediaPermissionSettings from '/src/components/MediaPermissionSettings.jsx'; import {readMediaPermissions,saveMediaPermission} from '/src/utils/mediaPermissions.mjs';
window.permissionCalls=[]; window.nativePermission = result => configureNativeRuntime({nativePlatform:'android', onApiRequest:async()=>{}, onRequestMediaPermission:async kind=>{window.permissionCalls.push(kind); if(result==='pending') return new Promise(resolve=>window.resolvePermission=resolve); return result;}});
window.mediaChoices=readMediaPermissions; window.saveChoice=saveMediaPermission;
function Fixture(){const [account,setAccount]=React.useState('member-a');window.chooseAccount=setAccount;return <main data-account={account}><button id="photos" onClick={()=>document.getElementById('library').click()}>Add photos</button><input id="library" type="file" accept="image/*,video/*" hidden/><button id="camera" onClick={()=>document.getElementById('capture').click()}>Take photo</button><input id="capture" type="file" accept="image/*" capture="environment" hidden/><button id="files" onClick={()=>document.getElementById('pdf').click()}>Add document</button><input id="pdf" type="file" accept="application/pdf" hidden/><Link to="/other" id="navigate">Other page</Link><MediaPermissionSettings accountId={account}/><MediaPermissionPrompt accountId={account}/></main>}
createRoot(document.getElementById('fixture')).render(<MemoryRouter><Fixture/></MemoryRouter>);`;
const server = await createServer({ root: path.join(root, 'web'), envDir: false, cacheDir: path.join(root, '.cache/media-permission-vite'),
  plugins: [{ name: 'media-permission-fixture', resolveId(value) { if(value==='/__media-permission-fixture.jsx')return id; }, load(value) { if(value===id)return fixture; },
    configureServer(vite) { vite.middlewares.use(async (req,res,next)=>{ if(req.url!=='/__media-permission-fixture')return next(); res.setHeader('Content-Type','text/html'); res.end(await vite.transformIndexHtml(req.url,'<div id="fixture"></div><script type="module" src="/__media-permission-fixture.jsx"></script>')); }); } }],
  server: { host:'127.0.0.1', port:0, hmr:false, watch:null } });
let browser;
try {
  await server.listen(); const origin=server.resolvedUrls.local[0];
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
  const page=await browser.newPage({viewport:{width:390,height:850}});
  let chooserCount=0; const errors=[]; page.on('filechooser',()=>chooserCount++); page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'__media-permission-fixture',{waitUntil:'domcontentloaded',timeout:120000});
  await page.locator('#photos').waitFor({timeout:120000});
  await page.locator('#photos').click(); await page.getByRole('heading',{name:'Allow photos and videos?'}).waitFor();
  assert.equal(chooserCount,0); await page.keyboard.press('Escape'); assert.equal(chooserCount,0);
  await page.locator('#photos').click();
  const photo=page.waitForEvent('filechooser'); await page.getByRole('button',{name:'Choose photos',exact:true}).click(); await (await photo).setFiles([]); assert.equal(chooserCount,1);
  await page.reload({waitUntil:'domcontentloaded'}); await page.locator('#photos').waitFor();
  const savedPhoto=page.waitForEvent('filechooser'); await page.locator('#photos').click(); await (await savedPhoto).setFiles([]); assert.equal(chooserCount,2); assert.equal(await page.locator('dialog[open]').count(),0,'Allowed photos do not ask again after a reload');
  await page.locator('#camera').click(); await page.getByRole('heading',{name:'Allow camera access?'}).waitFor();
  await page.getByRole('button',{name:/Don.t allow/}).click(); assert.equal(chooserCount,2);
  await page.reload({waitUntil:'domcontentloaded'}); await page.locator('#camera').click(); await page.getByRole('heading',{name:'Camera is turned off',exact:true}).waitFor(); assert.equal(await page.getByRole('heading',{name:'Allow camera access?'}).count(),0,'Declined camera choice persists without asking again');
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('combobox',{name:'Camera permission',exact:true}).selectOption('allow');
  const camera=page.waitForEvent('filechooser'); await page.locator('#camera').click(); await (await camera).setFiles([]); assert.equal(chooserCount,3);
  await page.evaluate(()=>window.chooseAccount('member-b')); await page.locator('[data-account="member-b"]').waitFor();
  await page.locator('#photos').click(); await page.getByRole('heading',{name:'Allow photos and videos?'}).waitFor(); await page.keyboard.press('Escape'); assert.equal(await page.locator('#photos').evaluate(button=>button===document.activeElement),true);
  await page.evaluate(()=>window.chooseAccount('member-a')); await page.locator('[data-account="member-a"]').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.mediaChoices('member-a')),{photos:'allow',camera:'allow'});
  await page.getByRole('combobox',{name:'Camera permission',exact:true}).selectOption('ask');
  await page.evaluate(()=>window.nativePermission(false)); await page.locator('#camera').click(); await page.getByRole('button',{name:'Allow camera',exact:true}).click();
  await page.getByRole('alert').waitFor(); assert.equal(chooserCount,3); assert.deepEqual(await page.evaluate(()=>window.permissionCalls),['camera']);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('combobox',{name:'Camera permission',exact:true}).selectOption('ask');
  await page.evaluate(()=>window.nativePermission('pending')); await page.locator('#camera').click(); await page.getByRole('button',{name:'Allow camera',exact:true}).click();
  await page.getByRole('button',{name:'Cancel',exact:true}).click(); await page.evaluate(()=>window.resolvePermission(true)); await page.waitForTimeout(100); assert.equal(chooserCount,3,'Cancel prevents a late permission response from opening the camera');
  assert.equal(await page.evaluate(()=>window.mediaChoices('member-a').camera),'ask');
  const document=page.waitForEvent('filechooser'); await page.locator('#files').click(); await (await document).setFiles([]); assert.equal(chooserCount,4);
  assert.equal(await page.evaluate(()=>{const saved=Storage.prototype.setItem;try{Storage.prototype.setItem=()=>{throw Error('Blocked fixture storage')};const persisted=window.saveChoice('session-only','photos','allow');return !persisted&&window.mediaChoices('session-only').photos==='allow'}finally{Storage.prototype.setItem=saved}}),true,'Unavailable storage retains the choice for the current session');
  assert.equal(await page.locator('dialog[open]').count(),0);
  assert.deepEqual(errors,[]);
  const files=await Promise.all(['web/src/App.jsx','web/src/components/MediaPermissionPrompt.jsx','web/src/components/MediaPermissionSettings.jsx','web/src/utils/mediaPermissions.mjs'].map(async file=>({path:file,sha256:createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')})));
  await fs.mkdir(path.join(root,'.cache/media-permission-audit'),{recursive:true}); await fs.writeFile(path.join(root,'.cache/media-permission-audit/results.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:true,files,rememberAllowedAcrossReload:true,rememberDeclinedAcrossReload:true,accountIsolation:true,settingsChanges:true,latePermissionCancelled:true,documentUploadUnchanged:true},null,2)+'\n');
  console.log('PASS: photo/camera choices persist across reloads, stay separate per account, can be changed in Settings, and preserve cancellation and device denial handling.');
} finally {await browser?.close(); await server.close();}
