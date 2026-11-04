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
await fs.writeFile(fixturePath,`import React from 'react';
import {createRoot} from 'react-dom/client';
import OfficeAI from '../src/OfficeAI.jsx';
import App from '../src/App.jsx';
import OfficeAccessDialog from '../src/OfficeAccessDialog.jsx';
const query=new URL(location.href).searchParams;
const request=(url,options={})=>fetch(url,{...options,headers:{...options.headers,'x-office-token':'synthetic-office-sensors-token'}});
const welcome=query.has('welcome')?{id:'synthetic-first-login',text:'Welcome back. The API and pipeline are healthy. Your latest Office task finished successfully. Do you need anything?'}:null;
const view=createRoot(document.getElementById('root'));window.syntheticUnmount=()=>view.unmount();view.render(query.has('app')?<><OfficeAccessDialog/><App/></>:<main style={{padding:16,maxWidth:1400,margin:'auto'}}><OfficeAI apiBase='${API}' pipelineBase='${PIPELINE}' request={request} welcomeBriefing={welcome} onWelcomeConsumed={id=>window.syntheticWelcomeConsumed=id}/></main>);`);
const server=await createServer({root:path.join(root,'office'),configFile:path.join(root,'office/vite.config.js'),envDir:false,cacheDir:path.join(root,'office/.cache/sensors-vite'),
 define:{'import.meta.env.VITE_API_URL':JSON.stringify(API),'import.meta.env.VITE_PIPELINE_API_URL':JSON.stringify(PIPELINE)},
 server:{host:'127.0.0.1',port:5268,strictPort:false},plugins:[{name:'office-sensors-audit',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(req.url?.split('?')[0]!=='/office-sensors-audit')return next();
  const html=await vite.transformIndexHtml('/office-sensors-audit','<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#080f1c;color:#e2e8f0;font-family:Arial,sans-serif"><div id="root"></div><script type="module" src="/.cache/office-sensors-fixture.jsx"></script></body></html>');res.setHeader('Content-Type','text/html');res.end(html);
 });}}]});
let checks=0,browser,currentPage;
const check=(value,message)=>{assert.ok(value,message);checks++;};
const report={checks:0,widths:[],scenarios:[]};

async function setup(width,options={}){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
 currentPage=page;
 const requests=[],errors=[],tasks=new Map(),conversations=new Map();
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const state=window.syntheticSensors={recognitions:[],active:null,spoken:[],aborts:0,trackStops:0,streams:[],denyMic:false,denyCamera:false};
  class Recognition{
   start(){this.running=true;state.recognitions.push(this);state.active=this;queueMicrotask(()=>{if(state.denyMic){this.onerror?.({error:'not-allowed'});return;}this.onstart?.();});}
   abort(){this.running=false;state.aborts++;if(state.active===this)state.active=null;}
   stop(){this.running=false;if(state.active===this)state.active=null;this.onend?.();}
  }
  window.SpeechRecognition=Recognition;
  window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  const synthesis={cancel(){},speak(utterance){state.spoken.push(utterance.text);queueMicrotask(()=>{utterance.onstart?.();setTimeout(()=>utterance.onend?.(),20);});}};
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
  const req=route.request(),url=new URL(req.url());if(![API,PIPELINE].includes(url.origin))return route.continue();
  const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'x-office-token,content-type','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'};
  const reply=(json,status=200)=>route.fulfill({headers,json,status});
  if(req.method()==='OPTIONS')return route.fulfill({headers,status:204});
  const body=req.postData()?req.postDataJSON():null;requests.push({method:req.method(),path:url.pathname,body,origin:url.origin});
  if(!req.headers()['x-office-token'])return reply({error:'Office access required.'},401);
  if(url.pathname==='/office/status')return reply({server:{serviceRole:url.origin===PIPELINE?'pipeline':'api',uptime:3600,version:'synthetic'},agents:{feed:{status:'healthy',lastSuccess:new Date().toISOString()}},workerHealth:{},sourceGuard:{}});
  if(url.pathname==='/office/agents')return reply({agents:[]});
  if(url.pathname==='/office/ai')return reply({configured:true,provider:'Cloudflare',model:'@cf/synthetic/vision',researchAvailable:true});
  if(url.pathname==='/office/connections')return reply({connections:[]});
  if(url.pathname==='/office/controls')return reply({controls:[],history:[]});
  if(url.pathname==='/office/ai/tools')return reply({tools:[]});
  if(url.pathname==='/office/ai/tasks'){
   if(req.method()==='GET')return reply({tasks:[...tasks.values()],capabilities:{repository:'synthetic/office',editCode:true,publish:true,deploy:true,operate:true,deployTargets:[{id:'office',label:'Office'}]}});
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
 await page.goto(server.resolvedUrls.local[0]+'office-sensors-audit'+(options.app?'?app=1#office-ai':options.welcome?'?welcome=1':''),{waitUntil:'networkidle'});
 if(options.app){try{await page.getByLabel('Access token',{exact:true}).fill('synthetic-office-sensors-token');await page.getByRole('button',{name:'Unlock Office',exact:true}).click();}catch(error){console.error(JSON.stringify({step:'synthetic-unlock',errors,requests:requests.map(({method,path})=>({method,path})),body:(await page.locator('body').innerText()).slice(0,1200)}));throw error;}}
 await page.locator('.office-ai-header h1').waitFor();
 await page.getByRole('button',{name:'Start voice',exact:true}).or(page.getByRole('button',{name:'End voice',exact:true})).first().waitFor({timeout:15000});
 return{page,context,requests,errors,tasks};
}
const listening=page=>page.waitForFunction(()=>Boolean(window.syntheticSensors.active?.running));
const idle=page=>page.waitForFunction(()=>!window.syntheticSensors.active?.running);
async function activateCamera(page){
 await page.getByRole('dialog',{name:'Office AI',exact:true}).getByRole('button',{name:'Turn camera off',exact:true}).waitFor();
 await page.waitForFunction(()=>{const video=document.querySelector('video[aria-label="Live camera preview"]');return video?.videoWidth>0&&video.readyState>=2;});
}

try{
 await server.listen();browser=await chromium.launch({headless:true});
 // Exercise the real authentication dialog, App hook, and welcome prop together.
 {
  const {page,context,requests,errors}=await setup(1280,{app:true});
  await listening(page);const spoken=await page.evaluate(()=>window.syntheticSensors.spoken.join(' '));
  check(/welcome|office/i.test(spoken)&&/need anything/i.test(spoken),'Authenticated entry speaks an Office update and asks for a request');
  check(requests.some(x=>x.path==='/office/status'&&x.origin===API)&&requests.some(x=>x.path==='/office/status'&&x.origin===PIPELINE),'Welcome reads fresh API and pipeline observations');
  await page.getByRole('button',{name:'Start voice',exact:true}).waitFor({timeout:7000});
  check(!requests.some(x=>x.method==='POST'&&x.path==='/office/ai/tasks'),'Five seconds of login silence does not create a task');
  check(await page.evaluate(()=>window.syntheticSensors.active===null),'Silent greeting closes microphone');
  check(await page.evaluate(()=>window.syntheticSensors.trackStops>0),'Silent greeting releases camera tracks');
  check(await page.getByRole('dialog',{name:'Office AI',exact:true}).count()===0,'Silent greeting closes video call popup');
  check(errors.length===0,'Actual App login has no browser errors');report.scenarios.push('real-login-briefing-and-silence');await context.close();
 }
 for(const width of [1280,390,320]){
  const {page,context,requests,errors}=await setup(width);
  const input=page.locator('.office-ai-sensors input[type=file]');
  const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;canvas.getContext('2d').fillRect(0,0,8,8);return canvas.toDataURL('image/png').split(',')[1];});
  await input.setInputFiles([{name:'office-notes.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic Office context: check this item.')},{name:'office-photo.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')}]);
  await page.getByLabel('Files for your next message',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Start voice',exact:true}).click();await listening(page);await activateCamera(page);
  check(await page.getByRole('dialog',{name:'Office AI',exact:true}).isVisible(),'Voice opens a video call popup');
  check(await page.getByRole('dialog',{name:'Office AI',exact:true}).evaluate(dialog=>{const box=dialog.getBoundingClientRect();return box.x>=0&&box.y>=0&&box.right<=innerWidth+1&&box.bottom<=innerHeight+1;}),'Call popup fits the visible viewport');
  await page.screenshot({path:path.join(root,`.cache/audit-ui/office-ai-call-${width}.png`)});
  await page.evaluate(()=>window.emitSyntheticSpeech('Check the Office item I am showing you and explain what to do.'));
  await page.waitForFunction(()=>window.syntheticSensors.spoken.some(text=>text.includes('checked the synthetic')));await listening(page);
  const first=requests.find(x=>x.method==='POST'&&x.path==='/office/ai/tasks');
  check(first?.body.message.includes('showing'),'Spoken request creates a Work task');
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
  check(await page.getByRole('dialog',{name:'Office AI',exact:true}).count()===0,'Spoken stop closes the call popup');
  check(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2)),'Sensor controls fit viewport '+width);
  check(errors.length===0,'No sensor browser errors at '+width);report.widths.push(width);await context.close();
 }
 {
  const {page,context,requests}=await setup(390);
  await page.evaluate(()=>{window.syntheticSensors.denyMic=true;});await page.getByRole('button',{name:'Start voice',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Microphone access was denied'}).first().waitFor();check(!requests.some(x=>x.method==='POST'&&x.path==='/office/ai/tasks'),'Denied microphone cannot execute a request');
  if(await page.getByRole('dialog',{name:'Office AI',exact:true}).isVisible())await page.getByRole('dialog',{name:'Office AI',exact:true}).getByRole('button',{name:'End call',exact:true}).click();
  await page.evaluate(()=>{window.syntheticSensors.denyCamera=true;});await page.getByRole('button',{name:'Share camera',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Camera access was denied'}).first().waitFor();check(await page.getByRole('button',{name:'Share camera',exact:true}).isVisible(),'Denied camera remains visibly off');report.scenarios.push('denied-microphone-and-camera');await context.close();
 }
 for(const reason of ['token','hidden','navigation']){
  const {page,context}=await setup(390);await page.getByRole('button',{name:'Start voice',exact:true}).click();await listening(page);await activateCamera(page);
  if(reason==='token')await page.evaluate(()=>window.dispatchEvent(new Event('office-token-changed')));
  if(reason==='hidden')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
  if(reason==='navigation')await page.evaluate(()=>window.syntheticUnmount());
  await idle(page);check(await page.evaluate(()=>window.syntheticSensors.trackStops>0),'Camera stream released on '+reason);report.scenarios.push('cleanup-'+reason);await context.close();
 }
 report.checks=checks;report.passed=true;await fs.mkdir(path.join(root,'.cache/audit-ui'),{recursive:true});await fs.writeFile(path.join(root,'.cache/audit-ui/office-ai-sensors.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}catch(error){
 if(currentPage&&!currentPage.isClosed()){
  console.error(JSON.stringify({step:'sensor-audit-failure',checks,scenarios:report.scenarios,body:(await currentPage.locator('body').innerText()).slice(-2500),state:await currentPage.evaluate(()=>({active:!!window.syntheticSensors?.active?.running,spoken:window.syntheticSensors?.spoken,trackStops:window.syntheticSensors?.trackStops,streams:window.syntheticSensors?.streams.map(item=>item.stream.getTracks().map(track=>track.readyState))}))}));
  await fs.mkdir(path.join(root,'.cache/audit-ui'),{recursive:true});await currentPage.screenshot({path:path.join(root,'.cache/audit-ui/office-ai-sensors-failure.png'),fullPage:true}).catch(()=>{});
 }
 throw error;
}finally{await browser?.close();await server.close();await fs.unlink(fixturePath).catch(()=>{});}
