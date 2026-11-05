import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {createServer} from '../office/node_modules/vite/dist/node/index.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const API='https://api.office-sensors.invalid',PIPELINE='https://pipeline.office-sensors.invalid';
const fixturePath=path.join(root,'office/.cache/office-sensors-fixture.jsx');
await fs.mkdir(path.dirname(fixturePath),{recursive:true});
await fs.mkdir(path.join(root,'.cache/audit-ui'),{recursive:true});
await fs.writeFile(fixturePath,`import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import OfficeAI from '../src/OfficeAI.jsx';
import App from '../src/App.jsx';
import OfficeAccessDialog from '../src/OfficeAccessDialog.jsx';
import PipDock from '../src/PipDock.jsx';
const query=new URL(location.href).searchParams;
const request=(url,options={})=>fetch(url,{...options,headers:{...options.headers,'x-office-token':'synthetic-office-sensors-token'}});
const welcome=query.has('welcome')?{id:'synthetic-first-login',text:'Welcome back. The API and pipeline are healthy. Your latest Office task finished successfully. Do you need anything?'}:null;
function Fixture(){const [open,setOpen]=useState(true),[workspace,setWorkspace]=useState(false);return <main style={{padding:16,maxWidth:1400,margin:'auto'}}><h1>Synthetic Office page</h1><button style={{position:'fixed',top:0,left:0,height:18,padding:0,fontSize:9,lineHeight:'12px'}} onClick={()=>window.syntheticOutsideClicks=(window.syntheticOutsideClicks||0)+1}>Use Office page</button><PipDock open={open} workspace={workspace} welcomeBriefing={welcome} onOpenChange={value=>{setOpen(value);if(!value)setWorkspace(false);}} onOpenWorkspace={()=>setWorkspace(true)}><OfficeAI apiBase='${API}' pipelineBase='${PIPELINE}' request={request} compact={!workspace} active={open} welcomeBriefing={open?welcome:null} onWelcomeConsumed={id=>window.syntheticWelcomeConsumed=id}/></PipDock></main>}
const view=createRoot(document.getElementById('root'));window.syntheticUnmount=()=>view.unmount();view.render(query.has('app')?<><OfficeAccessDialog/><App/></>:<Fixture/>);`);
const server=await createServer({root:path.join(root,'office'),configFile:path.join(root,'office/vite.config.js'),envDir:false,cacheDir:path.join(root,'office/.cache/sensors-vite'),
 define:{'import.meta.env.MODE':JSON.stringify('release-local'),'import.meta.env.VITE_API_URL':JSON.stringify(API),'import.meta.env.VITE_PIPELINE_API_URL':JSON.stringify(PIPELINE)},
 server:{host:'127.0.0.1',port:5268,strictPort:false},plugins:[{name:'office-sensors-audit',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/office-sensors-audit')return next();
  const html=await vite.transformIndexHtml('/office-sensors-audit','<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#080f1c;color:#e2e8f0;font-family:Arial,sans-serif"><div id="root"></div><script type="module" src="/.cache/office-sensors-fixture.jsx"></script></body></html>');res.setHeader('Content-Type','text/html');res.end(html);
 });}}]});
let checks=0,browser,currentPage;
const check=(value,message)=>{assert.ok(value,message);checks++;};
const report={checks:0,widths:[],scenarios:[]};

async function setup(width,options={}){
 const context=await browser.newContext({viewport:{width,height:options.height||1000},reducedMotion:options.reducedMotion||'no-preference'}),page=await context.newPage();
 currentPage=page;
 const requests=[],errors=[],tasks=new Map(),conversations=new Map();
 const local={path:'web/src/SyntheticPipLocal.jsx',content:"export const label = 'Synthetic local editor';\n",revision:'a'.repeat(64),saves:[],requests:[]};
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const state=window.syntheticSensors={recognitions:[],active:null,spoken:[],speechProfiles:[],aborts:0,trackStops:0,streams:[],denyMic:false,denyCamera:false};
  class Recognition{
   start(){this.running=true;state.recognitions.push(this);state.active=this;queueMicrotask(()=>{if(state.denyMic){this.onerror?.({error:'not-allowed'});return;}this.onstart?.();});}
   abort(){this.running=false;state.aborts++;if(state.active===this)state.active=null;}
   stop(){this.running=false;if(state.active===this)state.active=null;this.onend?.();}
  }
  window.SpeechRecognition=Recognition;
  window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  const synthesis={cancel(){},speak(utterance){state.spoken.push(utterance.text);state.speechProfiles.push({rate:utterance.rate,pitch:utterance.pitch});queueMicrotask(()=>{utterance.onstart?.();setTimeout(()=>utterance.onend?.(),20);});}};
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:synthesis});
  window.emitSyntheticSpeech=text=>{const current=state.active;if(!current?.running)throw Error('No active synthetic microphone');current.onspeechstart?.();current.onresult?.({results:[{isFinal:true,0:{transcript:text}}]});current.running=false;state.active=null;current.onend?.();};
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{async getUserMedia(constraints){
   if(state.denyCamera)throw new DOMException('Synthetic denied','NotAllowedError');
   if(constraints.audio!==false)throw Error('Camera unexpectedly requested audio');
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');ctx.fillStyle='#3b82f6';ctx.fillRect(0,0,320,240);
   const stream=canvas.captureStream(5),frames=setInterval(()=>ctx.fillRect(0,0,320,240),100);for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{state.trackStops++;clearInterval(frames);stop();};}
   state.streams.push({canvas,stream});return stream;
  }}});
 });
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin==='http://127.0.0.1:4173')return route.fulfill({contentType:'text/html',body:'<h1>Synthetic local website preview</h1>'});
  if(url.pathname.startsWith('/__local-web/')){
   local.requests.push({path:url.pathname,token:req.headers()['x-office-token']});
   if(url.pathname.endsWith('/status'))return route.fulfill({json:{previewUrl:'http://127.0.0.1:4173',phone:{state:'off'},github:{state:'unavailable'},writeHeader:'X-Local-Web-Editor'}});
   if(url.pathname.endsWith('/files'))return route.fulfill({json:{files:[{path:local.path}]}});
   if(url.pathname.endsWith('/file')){
    if(req.method()==='PUT'){const body=req.postDataJSON();local.saves.push(body);local.content=body.content;}
    return route.fulfill({json:{path:local.path,content:local.content,revision:local.revision}});
   }
   return route.fulfill({json:{state:'unavailable'}});
  }
  if(options.dedicated && url.origin==='https://uficonnect.ai'){const pathname=url.pathname==='/'?'office-sensors-audit?app=1':url.pathname.slice(1)+url.search;return route.fulfill({response:await context.request.get(server.resolvedUrls.local[0]+pathname)});}
  if(![API,PIPELINE].includes(url.origin))return route.continue();
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'x-office-token,content-type','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'};
  const reply=(json,status=200)=>route.fulfill({headers,json,status});
  if(req.method()==='OPTIONS')return route.fulfill({headers,status:204});
  const body=req.postData()?req.postDataJSON():null;requests.push({method:req.method(),path:url.pathname,body,origin:url.origin});
  if(!req.headers()['x-office-token'])return reply({error:'Office access required.'},401);
  if(url.pathname==='/office/status')return reply({server:{serviceRole:url.origin===PIPELINE?'pipeline':'api',uptime:3600,version:'synthetic'},agents:{feed:{status:'healthy',lastSuccess:new Date().toISOString()}},workerHealth:{},sourceGuard:{}});
  if(url.pathname==='/office/agents')return reply({agents:[]});
  if(url.pathname==='/office/ai')return reply({configured:!options.connectionUnavailable,provider:'Cloudflare',model:'@cf/synthetic/vision',researchAvailable:true,tonesAvailable:true});
  if(url.pathname==='/office/connections')return reply({connections:[]});
  if(url.pathname==='/office/controls')return reply({controls:[],history:[]});
  if(url.pathname==='/office/ai/tools')return reply({tools:[]});
  if(url.pathname==='/office/ai/tasks'){
   if(req.method()==='GET')return reply({tasks:[...tasks.values()],capabilities:{repository:'synthetic/office',tonesAvailable:true,editCode:true,publish:true,deploy:true,operate:true,deployTargets:[{id:'office',label:'Office'}]}});
   const task={...body,id:'sensor-task-'+(tasks.size+1),status:'succeeded',summary:'I checked the synthetic Office request and attached context successfully.',createdAt:new Date().toISOString(),events:[],changedFiles:[],checks:[],deployments:[]};tasks.set(task.id,task);return reply({task},202);
  }
  if(url.pathname.startsWith('/office/ai/tasks/'))return reply({task:tasks.get(url.pathname.split('/').at(-1))});
  if(url.pathname==='/office/ai/conversations'){
   if(req.method()==='GET')return reply({conversations:[...conversations.values()],storage:'encrypted-database'});
   const conversation={id:body.clientRequestId,title:body.title,messages:body.messages,version:1,updatedAt:new Date().toISOString()};conversations.set(conversation.id,conversation);return reply({conversation});
  }
  if(url.pathname.startsWith('/office/ai/conversations/')){
   const id=url.pathname.split('/').at(-1),previous=conversations.get(id);if(req.method()==='GET')return reply({conversation:previous});
   const conversation={...previous,...body,version:(previous?.version||0)+1,updatedAt:new Date().toISOString()};conversations.set(id,conversation);return reply({conversation});
  }
  if(url.pathname==='/office/ai/chat')return reply({reply:'Synthetic Ask reply.',research:{status:'off'},generatedAt:new Date().toISOString()});
  return reply({});
 });
 await page.goto(options.dedicated?'https://uficonnect.ai/?app=1'+(options.hash?'#'+options.hash:''):server.resolvedUrls.local[0]+'office-sensors-audit'+(options.app?'?app=1#'+(options.hash||'agents'):options.welcome?'?welcome=1':''),{waitUntil:'networkidle'});
 if(options.unauthenticated)return{page,context,requests,errors,tasks,local};
 if(options.app){try{await page.getByLabel('Access token',{exact:true}).fill('synthetic-office-sensors-token');await page.getByRole('button',{name:'Unlock Office',exact:true}).click();}catch(error){console.error(JSON.stringify({step:'synthetic-unlock',errors,requests:requests.map(({method,path})=>({method,path})),body:(await page.locator('body').innerText()).slice(0,1200)}));throw error;}}
 await page.locator('.office-ai').waitFor();
 await page.getByRole('button',{name:'Start voice',exact:true}).or(page.locator('.office-ai-call[role=region]')).first().waitFor({timeout:15000});
 return{page,context,requests,errors,tasks,local};
}
const listening=page=>page.waitForFunction(()=>Boolean(window.syntheticSensors.active?.running));
const idle=page=>page.waitForFunction(()=>!window.syntheticSensors.active?.running);
const call=page=>page.locator('.office-ai-sensors').getByRole('region',{name:'Pip',exact:true});
const dock=page=>page.getByRole('dialog',{name:'Pip',exact:true});
const loginDock=page=>page.getByRole('region',{name:'Pip call',exact:true});
const taskPosts=requests=>requests.filter(x=>x.method==='POST'&&x.path==='/office/ai/tasks');
const fitsViewport=locator=>locator.evaluate(element=>{const box=element.getBoundingClientRect();return box.width>0&&box.height>0&&box.x>=0&&box.y>=0&&box.right<=innerWidth+1&&box.bottom<=innerHeight+1;});
const isCornerDock=locator=>locator.evaluate(async element=>{await Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{})));const box=element.getBoundingClientRect();return element.closest('.pip-dock-floating')&&box.width<=401&&innerWidth-box.right>=0&&innerWidth-box.right<=24&&innerHeight-box.bottom>=70&&innerHeight-box.bottom<=100;});
async function activateCamera(page){
 await call(page).getByRole('button',{name:'Turn camera off',exact:true}).waitFor();
 await page.waitForFunction(()=>{const video=document.querySelector('video[aria-label="Live camera preview"]');return video?.videoWidth>0&&video.readyState>=2;});
}
async function checkLoginCallOnly(page,width){
 await loginDock(page).waitFor();await listening(page);await activateCamera(page);
 check(await call(page).isVisible(),'Authenticated login opens the phone call at '+width);
 check(!await dock(page).isVisible(),'Authenticated login does not open the chatbot dialog at '+width);
 check(await page.getByLabel('Message Pip',{exact:true}).count()===0||!await page.getByLabel('Message Pip',{exact:true}).isVisible(),'Login call hides the message composer at '+width);
 check(await page.locator('.office-ai-header:visible,.office-ai-quick-options:visible,.office-ai-tabs:visible,.office-ai-welcome:visible,.office-ai-composer:visible').count()===0,'Login call hides chatbot navigation, tone controls, and welcome at '+width);
 check(await page.locator('.pip-dock-header:visible,.pip-dock-welcome:visible,.pip-dock-footer:visible').count()===0,'Login call hides chatbot dock chrome at '+width);
 check(await fitsViewport(loginDock(page))&&await fitsViewport(call(page)),'Login call stays inside the viewport at '+width);
}
async function checkCallReleased(page,message){
 await idle(page);
 check(await page.evaluate(()=>window.syntheticSensors.active===null&&window.syntheticSensors.streams.every(item=>item.stream.getTracks().every(track=>track.readyState==='ended'))),message);
}

try{
 await server.listen();browser=await chromium.launch({headless:true});
 if(!process.argv.includes('--dedicated-only')){
 // Exercise the real authentication dialog, App hook, and welcome prop together.
 {
  const {page,context,requests,errors}=await setup(1280,{app:true,hash:'agents'});
  await checkLoginCallOnly(page,1280);
  check(new URL(page.url()).hash==='#agents','Login welcome preserves the requested Office page hash');
  check(await page.getByRole('heading',{name:'Agent Control',exact:true}).isVisible(),'Office page remains visible behind the welcome');
  check(await loginDock(page).getAttribute('aria-modal')===null,'Login call leaves the Office page available');
  await listening(page);const spoken=await page.evaluate(()=>window.syntheticSensors.spoken.join(' '));
  check(/welcome|office/i.test(spoken)&&/need anything/i.test(spoken),'Authenticated entry speaks an Office update and asks for a request');
  check(requests.some(x=>x.path==='/office/status'&&x.origin===API)&&requests.some(x=>x.path==='/office/status'&&x.origin===PIPELINE),'Welcome reads fresh API and pipeline observations');
  await loginDock(page).waitFor({state:'hidden',timeout:7000});
  check(!requests.some(x=>x.method==='POST'&&x.path==='/office/ai/tasks'),'Five seconds of login silence does not create a task');
  check(await page.evaluate(()=>window.syntheticSensors.active===null),'Silent greeting closes microphone');
  check(await page.evaluate(()=>window.syntheticSensors.trackStops>0),'Silent greeting releases camera tracks');
  check(await call(page).count()===0,'Silent greeting closes the inline voice call');
  check(!await dock(page).isVisible()&&!await page.getByLabel('Message Pip',{exact:true}).isVisible(),'Silent greeting closes without opening the chatbot');
  await checkCallReleased(page,'Silent greeting releases all microphone and camera resources');
  check(new URL(page.url()).hash==='#agents','Silent greeting does not navigate away from the Office page');
  await page.getByRole('navigation',{name:'Office sections',exact:true}).getByRole('button',{name:'Office AI',exact:true}).click();
  check(await dock(page).isVisible()&&await isCornerDock(dock(page)),'Sidebar Pip opens the bottom-right mini window');
  check(new URL(page.url()).hash==='#agents'&&await page.getByRole('heading',{name:'Agent Control',exact:true}).isVisible(),'Sidebar Pip preserves the selected Office page and hash');
  check(await page.evaluate(()=>window.syntheticSensors.active===null&&window.syntheticSensors.streams.every(item=>item.stream.getTracks().every(track=>track.readyState==='ended'))),'Sidebar Pip does not reactivate voice or camera');
  await page.getByLabel('Message Pip',{exact:true}).fill('Keep this unsent Office question.');
  await page.getByRole('button',{name:'Open Pip workspace',exact:true}).click();
  check(new URL(page.url()).hash==='#office-ai','Explicit workspace control opens the full Pip workspace');
  check(await page.getByLabel('Message Pip',{exact:true}).inputValue()==='Keep this unsent Office question.','Moving to the workspace preserves the same draft');
  check(await page.locator('.office-ai').count()===1,'Popup and workspace share one mounted OfficeAI instance');
  await page.getByRole('button',{name:'Minimize Pip',exact:true}).click();
  await page.getByRole('button',{name:'Open Pip',exact:true}).click();
  check(await page.getByLabel('Message Pip',{exact:true}).inputValue()==='Keep this unsent Office question.','Returning from the full workspace preserves the draft');
  check(taskPosts(requests).length===0,'Welcome and workspace navigation never start tasks');
  check(errors.length===0,'Actual App login has no browser errors');report.scenarios.push('real-login-preserved-page-and-silent-welcome');await context.close();
 }
 {
  const {page,context,requests,errors}=await setup(390,{app:true,hash:'agents',unauthenticated:true,connectionUnavailable:true});
  await page.getByLabel('Access token',{exact:true}).fill('synthetic-office-sensors-token');
  await page.getByRole('button',{name:'Unlock Office',exact:true}).click();
  await loginDock(page).waitFor();
  await page.getByRole('status').filter({hasText:'The call could not connect.'}).waitFor();
  check(!await dock(page).isVisible()&&!await page.getByLabel('Message Pip',{exact:true}).isVisible(),'An unavailable connection shows its call fallback without opening the chatbot');
  check(await page.getByRole('button',{name:'Close call',exact:true}).isVisible(),'An unavailable login call has an explicit close control');
  await page.getByRole('button',{name:'Close call',exact:true}).click();
  await loginDock(page).waitFor({state:'hidden'});
  check(!await dock(page).isVisible()&&new URL(page.url()).hash==='#agents'&&await page.getByRole('heading',{name:'Agent Control',exact:true}).isVisible(),'Closing an unavailable login call preserves the Office page and keeps chat closed');
  check(await page.evaluate(()=>window.syntheticSensors.active===null&&window.syntheticSensors.recognitions.length===0&&window.syntheticSensors.streams.length===0),'An unavailable login call never starts the microphone or camera');
  await page.getByRole('button',{name:'Open Pip',exact:true}).click();
  await dock(page).waitFor();
  check(await page.getByLabel('Message Pip',{exact:true}).isVisible(),'The launcher can manually open Pip after an unavailable login call');
  check(taskPosts(requests).length===0,'An unavailable login call and manual reopening create no tasks');
  check(errors.length===0,'An unavailable login call has no browser errors');
  report.scenarios.push('real-login-unavailable-call-can-close');await context.close();
 }
 for(const width of [390,320])for(const action of ['end','continue-text','escape']){
  const {page,context,requests,errors}=await setup(width,{height:width===320?568:844,app:true,hash:'agents'});
  await checkLoginCallOnly(page,width);
  check(new URL(page.url()).hash==='#agents'&&await page.getByRole('heading',{name:'Agent Control',exact:true}).isVisible(),'Mobile login call preserves the selected page and hash '+width+' '+action);
  await page.screenshot({path:path.join(root,`.cache/audit-ui/office-login-call-${width}-${action}.png`)});
  if(action==='end')await call(page).getByRole('button',{name:'End call',exact:true}).click();
  if(action==='continue-text')await call(page).getByRole('button',{name:'Continue with text',exact:true}).click();
  if(action==='escape')await page.keyboard.press('Escape');
  await loginDock(page).waitFor({state:'hidden'});
  await checkCallReleased(page,'Login call releases microphone and camera after '+action+' at '+width);
  check(!await call(page).isVisible(),'Login call closes after '+action+' at '+width);
  if(action==='continue-text'){
   await page.getByLabel('Message Pip',{exact:true}).waitFor();
   check(await dock(page).isVisible(),'Continue with text explicitly opens the chatbot at '+width);
   await page.getByLabel('Message Pip',{exact:true}).fill('Manual text after the login call at '+width);
  }else{
   check(!await dock(page).isVisible()&&!await page.getByLabel('Message Pip',{exact:true}).isVisible(),'Ending the login call does not expose the chatbot '+width+' '+action);
   await page.getByRole('button',{name:'Open Pip',exact:true}).click();
   await page.getByLabel('Message Pip',{exact:true}).waitFor();
   check(await dock(page).isVisible(),'The launcher manually opens the chatbot after '+action+' at '+width);
  }
  check(await page.evaluate(()=>window.syntheticSensors.active===null),'Opening text does not restart the microphone '+width+' '+action);
  check(new URL(page.url()).hash==='#agents'&&taskPosts(requests).length===0,'Login call controls preserve navigation and create no tasks '+width+' '+action);
  check(errors.length===0,'Mobile login call has no browser errors '+width+' '+action);
  report.scenarios.push('real-login-call-only-'+width+'-'+action);await context.close();
 }
 {
  const {page,context,requests,errors}=await setup(1280,{app:true,hash:'office-ai'});
  await checkLoginCallOnly(page,1280);
  await call(page).getByRole('button',{name:'Continue with text',exact:true}).click();
  await dock(page).waitFor({state:'visible'});
  check(await dock(page).isVisible()&&await isCornerDock(dock(page)),'A bookmarked Pip URL opens the bottom-right popup');
  check(await page.getByRole('heading',{name:'Command Center',exact:true}).isVisible(),'A bookmarked Pip URL keeps Overview underneath the popup');
  check(await page.locator('.office-ai').getAttribute('data-compact')==='true','A bookmarked Pip URL keeps the compact conversation');
  await page.getByRole('button',{name:'Open Pip workspace',exact:true}).click();
  check(await page.getByRole('region',{name:'Pip workspace',exact:true}).isVisible()&&await page.locator('.office-ai').getAttribute('data-compact')==='false','Only explicit expansion opens the full Pip workspace from a bookmarked popup');
  check(taskPosts(requests).length===0,'Opening a bookmarked Pip popup and expanding never starts a task');
  check(errors.length===0,'Bookmarked Pip entry has no browser errors');
  report.scenarios.push('real-bookmarked-pip-opens-corner-popup');await context.close();
 }
 {
  const {page,context,requests,errors,local}=await setup(1280,{app:true,hash:'local-web',unauthenticated:true});
  await page.getByRole('heading',{name:'Local web',exact:true}).waitFor();
  await page.getByLabel('Website file',{exact:true}).waitFor();
  check(!await page.getByLabel('Access token',{exact:true}).isVisible(),'Unauthenticated local editing opens without an Office sign-in prompt');
  check(await page.locator('.office-ai').count()===0,'Unused Pip stays unmounted on unauthenticated local editing');
  check(!requests.some(entry=>entry.path.startsWith('/office/ai')),'Unused Pip makes no background OfficeAI requests');
  await page.getByLabel('Website file',{exact:true}).selectOption(local.path);
  await page.getByLabel(local.path,{exact:true}).fill("export const label = 'Saved through the synthetic local editor';\n");
  await page.getByRole('button',{name:'Save locally',exact:true}).click();
  await page.getByText('Saved locally',{exact:true}).first().waitFor();
  check(local.saves.length===1&&local.saves[0].content.includes('Saved through the synthetic'),'Local files remain editable and save through the mocked local editor without Office access');
  check(local.requests.every(entry=>entry.token===undefined),'Local editor requests never include an Office access token');
  check(!await page.getByLabel('Access token',{exact:true}).isVisible()&&!requests.some(entry=>entry.path.startsWith('/office/ai')),'Local editing and saving do not initialize Pip or request Office sign-in');
  await page.getByRole('navigation',{name:'Office sections',exact:true}).getByRole('button',{name:'Office AI',exact:true}).click();
  await page.getByLabel('Access token',{exact:true}).waitFor();
  check(await page.getByLabel('Access token',{exact:true}).isVisible(),'Explicitly opening Pip requests Office access');
  await page.getByLabel('Access token',{exact:true}).fill('synthetic-office-sensors-token');
  await page.getByRole('button',{name:'Unlock Office',exact:true}).click();
  await checkLoginCallOnly(page,1280);
  check(new URL(page.url()).hash==='#local-web','Unlocking Pip opens only the call while preserving the local editor page');
  await call(page).getByRole('button',{name:'End call',exact:true}).click();
  await loginDock(page).waitFor({state:'hidden'});
  check(!await dock(page).isVisible(),'Ending the local editor login call leaves the chatbot closed');
  await page.getByRole('navigation',{name:'Office sections',exact:true}).getByRole('button',{name:'Office AI',exact:true}).click();
  await dock(page).waitFor();
  check(await isCornerDock(dock(page))&&new URL(page.url()).hash==='#local-web','Explicit Pip entry after the call opens the corner chatbot while preserving the local editor page');
  check(requests.some(entry=>entry.path==='/office/ai'),'OfficeAI connects after explicit Pip entry and authentication');
  check(taskPosts(requests).length===0,'Local editing and authenticated Pip entry never start a task');
  check(errors.length===0,'Unauthenticated local editing and explicit Pip entry have no browser errors');
  report.scenarios.push('unauthenticated-local-editor-and-explicit-pip-entry');await context.close();
 }
 for(const width of [1280,390,320]){
  const {page,context,requests,errors}=await setup(width,{height:width===320?568:1000});
  check(await fitsViewport(dock(page)),'Pip dock fits the viewport '+width);
  check((await dock(page).boundingBox()).width<=401,'Pip stays a mini window at '+width);
  check(await fitsViewport(page.getByRole('button',{name:'Hide Pip',exact:true})),'Pip launcher remains inside the viewport '+width);
  await page.getByRole('button',{name:'Use Office page',exact:true}).click();
  check(await page.evaluate(()=>window.syntheticOutsideClicks===1),'Pip leaves the underlying Office page interactive '+width);
  await page.getByRole('combobox',{name:'Pip tone',exact:true}).first().selectOption('calm');
  check(await page.evaluate(()=>localStorage.getItem('uficonnect.pip.tone'))==='calm','Chosen tone is saved as a preset '+width);
  await page.screenshot({path:path.join(root,`.cache/audit-ui/office-pip-text-${width}.png`)});
  const input=page.locator('.office-ai-sensors input[type=file]');
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;canvas.getContext('2d').fillRect(0,0,8,8);return canvas.toDataURL('image/png').split(',')[1];});
  await input.setInputFiles([{name:'office-notes.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic Office context: check this item.')},{name:'office-photo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')}]);
  await page.getByLabel('Files for your next message',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Start voice',exact:true}).click();await listening(page);await activateCamera(page);
  check(await call(page).isVisible(),'Voice opens an inline Pip call region');
  check(await call(page).getAttribute('aria-modal')===null,'Voice call does not introduce a modal dialog');
  check(await page.locator('.office-ai-call-backdrop').evaluate(element=>getComputedStyle(element).position)==='relative','Compact voice stays inside the Pip dock');
  check(await fitsViewport(dock(page)),'Active call keeps the dock inside the viewport');
  await page.screenshot({path:path.join(root,`.cache/audit-ui/office-ai-call-${width}.png`)});
  await page.evaluate(()=>window.emitSyntheticSpeech('Check the Office item I am showing you and explain what to do.'));
  await page.waitForFunction(()=>window.syntheticSensors.spoken.some(text=>text.includes('checked the synthetic')));await listening(page);
  const first=requests.find(x=>x.method==='POST'&&x.path==='/office/ai/tasks');
  check(first?.body.message.includes('showing'),'Spoken request creates a Work task');
  check(first.body.tone==='calm','Chosen tone accompanies voice Work requests');
  check(await page.evaluate(()=>window.syntheticSensors.speechProfiles.some(profile=>profile.rate===.9&&profile.pitch===.96)),'Selected tone applies to spoken responses');
  check(first.body.attachments?.length===3,'Work request includes text file, photo, and current camera frame');
  check(first.body.attachments.some(file=>file.type==='text/plain'&&file.data.includes('Synthetic Office')),'Attached file content reaches Work');
  check(first.body.attachments.filter(file=>file.type==='image/jpeg').length===2,'Uploaded photo and live camera frame reach Work as images');
  check(!requests.some(x=>x.method==='POST'&&x.path==='/office/ai/chat'),'Voice runs through Work execution');
  await page.evaluate(()=>window.emitSyntheticSpeech('Now check the next item.'));
  await page.waitForFunction(()=>window.syntheticSensors.spoken.length>=2);await listening(page);
  check(requests.filter(x=>x.method==='POST'&&x.path==='/office/ai/tasks').length===2,'Voice remains open for a follow-up Work request');
  await page.evaluate(()=>window.emitSyntheticSpeech('stop listening'));await page.getByRole('button',{name:'Start voice',exact:true}).waitFor();
  check(requests.filter(x=>x.method==='POST'&&x.path==='/office/ai/tasks').length===2,'Spoken stop ends voice without creating a task');
  check(await page.evaluate(()=>window.syntheticSensors.trackStops>0),'Ending the call releases its camera stream');
  check(await call(page).count()===0,'Spoken stop closes the inline call');
  const draft=page.getByLabel('Message Pip',{exact:true});
  await draft.fill('Unsent draft to keep at '+width);await draft.evaluate(element=>element.syntheticDraftIdentity=true);
  await page.getByRole('button',{name:'Minimize Pip',exact:true}).click();
  check(await page.getByRole('button',{name:'Open Pip',exact:true}).isVisible(),'Minimized Pip always has a reopen button '+width);
  check(await page.locator('.office-ai').count()===1,'Minimizing keeps the OfficeAI instance mounted '+width);
  await page.getByRole('button',{name:'Open Pip',exact:true}).click();
  check(await draft.inputValue()==='Unsent draft to keep at '+width&&await draft.evaluate(element=>element.syntheticDraftIdentity===true),'Reopening preserves the draft and composer DOM '+width);
  await draft.focus();await page.keyboard.press('Escape');
  check(await page.getByRole('button',{name:'Open Pip',exact:true}).evaluate(element=>element===document.activeElement),'Escape minimizes Pip and returns focus to the launcher '+width);
  await page.getByRole('button',{name:'Open Pip',exact:true}).click();
  check(taskPosts(requests).length===2,'Minimize, reopen, and Escape create no extra tasks '+width);
  check(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)),'Sensor controls fit viewport '+width);
  check(errors.length===0,'No sensor browser errors at '+width);report.widths.push(width);await context.close();
 }
 {
  const {page,context,requests}=await setup(390);
  await page.evaluate(()=>{window.syntheticSensors.denyMic=true;});await page.getByRole('button',{name:'Start voice',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Microphone access was denied'}).first().waitFor();check(!requests.some(x=>x.method==='POST'&&x.path==='/office/ai/tasks'),'Denied microphone cannot execute a request');
  if(await call(page).isVisible())await call(page).getByRole('button',{name:'End call',exact:true}).click();
  await page.evaluate(()=>{window.syntheticSensors.denyCamera=true;});await page.getByRole('button',{name:'Share camera',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Camera access was denied'}).first().waitFor();check(await page.getByRole('button',{name:'Share camera',exact:true}).isVisible(),'Denied camera remains visibly off');report.scenarios.push('denied-microphone-and-camera');await context.close();
 }
 for(const reason of ['minimize','token','hidden','navigation']){
  const {page,context,requests}=await setup(390);await page.getByRole('button',{name:'Start voice',exact:true}).click();await listening(page);await activateCamera(page);
  if(reason==='minimize')await page.getByRole('button',{name:'Minimize Pip',exact:true}).click();
  if(reason==='token')await page.evaluate(()=>window.dispatchEvent(new Event('office-token-changed')));
  if(reason==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  if(reason==='navigation')await page.evaluate(()=>window.syntheticUnmount());
  await idle(page);check(await page.evaluate(()=>window.syntheticSensors.trackStops>0),'Camera stream released on '+reason);
  check(await page.evaluate(()=>window.syntheticSensors.streams.every(item=>item.stream.getTracks().every(track=>track.readyState==='ended'))),'All camera tracks end on '+reason);
  check(taskPosts(requests).length===0,'Cleanup creates no task on '+reason);
  if(reason==='minimize'){
   await page.getByRole('button',{name:'Open Pip',exact:true}).click();
   check(await page.evaluate(()=>window.syntheticSensors.active===null&&window.syntheticSensors.streams.length===1),'Reopening Pip does not reactivate microphone or camera');
  }
  report.scenarios.push('cleanup-'+reason);await context.close();
 }
 {
  const {page,context,requests,errors}=await setup(390,{height:680,reducedMotion:'reduce'});
  check(await page.locator('.pip-character').first().evaluate(element=>element.getAnimations({subtree:true}).every(animation=>animation.playState!=='running')),'Reduced motion stops character animations');
  await page.getByRole('combobox',{name:'Pip tone',exact:true}).first().selectOption('professional');
  await page.reload({waitUntil:'networkidle'});
  check(await page.getByRole('combobox',{name:'Pip tone',exact:true}).first().inputValue()==='professional','Tone preference survives a page reload');
  await page.getByLabel('Message Pip',{exact:true}).fill('Explain this synthetic item.');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByText('Synthetic Ask reply.',{exact:true}).waitFor();
  check(requests.find(x=>x.method==='POST'&&x.path==='/office/ai/chat')?.body.tone==='professional','Persisted tone accompanies typed chat requests');
  check(taskPosts(requests).length===0,'Typed questions remain chat without starting tasks');
  check(errors.length===0,'Reduced-motion and persisted-tone flow has no browser errors');
  report.scenarios.push('reduced-motion-and-persisted-tone');await context.close();
 }
 }
 {
  const {page,context,requests,errors}=await setup(1280,{app:true,dedicated:true});
  await checkLoginCallOnly(page,1280);
  await call(page).getByRole('button',{name:'Continue with text',exact:true}).click();
  await dock(page).waitFor();
  check(await isCornerDock(dock(page))&&await fitsViewport(dock(page)),'The dedicated AI domain opens Pip in the bottom-right corner');
  check(await page.getByRole('heading',{name:'Command Center',exact:true}).isVisible(),'The dedicated AI domain keeps Overview behind the popup');
  check(await page.locator('.office-ai').getAttribute('data-compact')==='true','Dedicated homepage entry keeps the conversation compact');
  check(await dock(page).getAttribute('aria-modal')==='false','The dedicated homepage popup leaves the Office page available');
  if(await call(page).isVisible())await call(page).getByRole('button',{name:'End call',exact:true}).click();
  await page.getByLabel('Message Pip',{exact:true}).fill('Keep this dedicated-domain draft.');
  await page.screenshot({path:path.join(root,'.cache/audit-ui/office-ai-home.png'),fullPage:true});
  await page.getByRole('button',{name:'Open Pip workspace',exact:true}).click();
  check(await page.locator('.office-ai-home .office-ai[data-compact=false]').isVisible(),'Only explicit expansion opens the dedicated full conversation');
  check(await page.getByLabel('Message Pip',{exact:true}).inputValue()==='Keep this dedicated-domain draft.','Explicit expansion preserves the dedicated-domain draft');
  check(await page.getByRole('link',{name:'Office dashboard',exact:true}).isVisible(),'The explicitly expanded dedicated workspace retains its dashboard link');
  check(taskPosts(requests).length===0,'Opening the dedicated AI domain does not create work');
  check(errors.length===0,'The dedicated popup and authentication have no browser errors');
  report.scenarios.push('dedicated-ai-domain-opens-corner-until-explicit-expansion');await context.close();
 }
 {
  const {page,context,requests,errors,local}=await setup(1280,{app:true,dedicated:true,hash:'local-web',unauthenticated:true});
  await page.getByRole('heading',{name:'Local web',exact:true}).waitFor();
  await page.getByLabel('Website file',{exact:true}).waitFor();
  check(!await page.getByLabel('Access token',{exact:true}).isVisible(),'Dedicated-domain local editing needs no Office sign-in');
  check(await page.locator('.office-ai').count()===0&&!requests.some(entry=>entry.path.startsWith('/office/ai')),'Dedicated-domain local editing keeps unused Pip unmounted without background AI requests');
  check(!await dock(page).isVisible()&&new URL(page.url()).hash==='#local-web','An explicit dedicated-domain local editor URL stays on its selected page without opening Pip');
  await page.getByLabel('Website file',{exact:true}).selectOption(local.path);
  await page.getByLabel(local.path,{exact:true}).fill("export const label = 'Dedicated local work without authentication';\n");
  await page.getByRole('button',{name:'Save locally',exact:true}).click();
  await page.getByText('Saved locally',{exact:true}).first().waitFor();
  check(local.saves.length===1&&local.requests.every(entry=>entry.token===undefined),'Dedicated-domain local files save through synthetic endpoints without Office credentials');
  check(!await page.getByLabel('Access token',{exact:true}).isVisible()&&taskPosts(requests).length===0,'Dedicated-domain local edits never prompt for Office access or create tasks');
  check(errors.length===0,'Dedicated-domain unauthenticated local editing has no browser errors');
  report.scenarios.push('dedicated-ai-domain-local-editor-remains-anonymous');await context.close();
 }
 report.checks=checks;report.passed=true;await fs.mkdir(path.join(root,'.cache/audit-ui'),{recursive:true});await fs.writeFile(path.join(root,'.cache/audit-ui/office-ai-sensors.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){
 if(currentPage&&!currentPage.isClosed()){
  console.error(JSON.stringify({step:'sensor-audit-failure',checks,scenarios:report.scenarios,body:(await currentPage.locator('body').innerText()).slice(-2500),state:await currentPage.evaluate(()=>({active:!!window.syntheticSensors?.active?.running,spoken:window.syntheticSensors?.spoken,trackStops:window.syntheticSensors?.trackStops,streams:window.syntheticSensors?.streams.map(item=>item.stream.getTracks().map(track=>track.readyState))}))}));
  await fs.mkdir(path.join(root,'.cache/audit-ui'),{recursive:true});await currentPage.screenshot({path:path.join(root,'.cache/audit-ui/office-ai-sensors-failure.png'),fullPage:true}).catch(()=>{});
 }
 throw error;
}finally{await browser?.close();await server.close();await fs.unlink(fixturePath).catch(()=>{});}
