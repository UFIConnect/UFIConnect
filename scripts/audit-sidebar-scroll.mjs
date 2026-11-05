// Built application with synthetic member/media responses; all external requests intercepted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.env.SIDEBAR_SCROLL_QA_OUTPUT||path.join(root,'.cache/sidebar-scroll-qa'));
const dist=path.join(root,'web/dist');await fs.mkdir(output,{recursive:true});
const origin=new URL(process.env.SIDEBAR_SCROLL_QA_ORIGIN||'https://uficonnect.org').origin;
const liveAssets=process.env.SIDEBAR_SCROLL_QA_LIVE==='1';
const profile={id:'sidebar-scroll-audit',name:'Alexandra Montgomery Washington',email:'sidebar@example.invalid',phone:'+15555550100',title:'',bio:'',organization:'',skills:[],joinedGroups:[],onboardingComplete:true,preferences:{role:'',goals:[],interests:[],experience:''},roleSettings:{},socialAccounts:{},socialTokens:{},socialRefreshTokens:{},socialConnectedAt:{},links:{},plan:'free'};
const app={request:async()=>({data:profile,status:200}),token:()=> 'synthetic-sidebar-session'};
const media=await fs.readFile(path.join(root,'web/public/media/preparation/closing-questions.mp4'));
const posts=Array.from({length:5},(_,i)=>({id:`scroll-fixture-${i}`,source:'uficonnect',isExternal:false,title:`Video ${i+1}`,content:'A synthetic clip for navigation checks.',authorId:'fixture-author',author:{id:'fixture-author',name:'Fixture creator'},mediaType:'video',mediaUrl:'https://fixture.invalid/clip.mp4',videoDurationSeconds:30,likesCount:0,commentsCount:0,createdAt:new Date().toISOString()}));
const types={'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.mp4':'video/mp4'};
const results=[],screenshots=[],errors=[];let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
const rect=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height};});
async function serve(route){
 const url=new URL(route.request().url());
 if(url.hostname==='fixture.invalid'){
  const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
  if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),media.length-1):media.length-1;return route.fulfill({status:206,contentType:'video/mp4',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${media.length}`},body:media.subarray(start,end+1)});}
  return route.fulfill({contentType:'video/mp4',headers:{'accept-ranges':'bytes'},body:media});
 }
 if(['api.uficonnect.org','uficonnect-api-708r.onrender.com'].includes(url.hostname)||/^\/(api|fallback)\//.test(url.pathname)){
  const endpoint=url.pathname.replace(/^\/(api|fallback)/,'');let json={};
  if(endpoint==='/auth/session')return route.fulfill({status:401,json:{message:'No saved fixture session'}});
  if(endpoint==='/profile')json=profile;
  else if(/feed\/(videos|music)/.test(endpoint))json={posts,hasMore:false,waitingForNew:true};
  else if(/feed\/location/.test(endpoint))json={automaticLocationAvailable:true,countryCode:'US',city:'San Francisco'};
  else if(/notifications/.test(endpoint))json={notifications:[],unreadCount:0};
  else if(/messages/.test(endpoint))json={conversations:[],messages:[],unreadCount:0};
  else if(/feed/.test(endpoint))json={posts:[],hasMore:false,nativeUficonnectIncluded:true};
  else if(/groups/.test(endpoint))json={groups:[]};
  else if(/attachments/.test(endpoint))json={attachments:[]};
  else if(/saved/.test(endpoint))json={posts:[],jobs:[]};
  else if(/opportunities|jobs/.test(endpoint))json={opportunities:[],jobs:[],hasMore:false};
  else if(/accounts/.test(endpoint))json={accounts:[],platforms:[]};
  return route.fulfill({status:200,json});
 }
 if(url.origin!==origin)return route.abort();
 // Live checks only read deployed assets; all auth/API requests above remain synthetic.
 if(liveAssets)return ['GET','HEAD'].includes(route.request().method())?route.continue():route.abort();
 let file=path.resolve(dist,'.'+decodeURIComponent(url.pathname));assert.ok(file===dist||file.startsWith(dist+path.sep));
 if(!path.extname(file)||url.pathname.endsWith('/'))file=path.join(dist,'index.html');
 try{return route.fulfill({status:200,body:await fs.readFile(file),contentType:types[path.extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
}
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
async function capture(page,name){const file=path.join(output,name+'.png');await page.screenshot({path:file});screenshots.push(path.basename(file));}
async function bottomPinned(page,footer,height,label){const box=await rect(footer);check(box.bottom<=height+1&&box.bottom>=height-24,label+' reaches safe bottom '+JSON.stringify({box,height,scrollY:await page.evaluate(()=>scrollY)}));return box.bottom;}
async function scrollAndKeep(page,scroller,footer,height,label){const before=await bottomPinned(page,footer,height,label);await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});await page.waitForTimeout(80);check(Math.abs((await rect(footer)).bottom-before)<2,label+' remains pinned while list scrolls');check(await scroller.evaluate(el=>getComputedStyle(el).overflowY==='auto'&&el.clientHeight>0&&Math.abs(el.scrollTop-(el.scrollHeight-el.clientHeight))<2),label+' has an independent scroller that reaches the last item');}
try{
 const viewports=[{width:1440,height:900},{width:1024,height:600},{width:820,height:360},{width:390,height:844},{width:320,height:500},{width:760,height:360}].filter(v=>!process.env.SIDEBAR_SCROLL_QA_WIDTHS||process.env.SIDEBAR_SCROLL_QA_WIDTHS.split(',').includes(String(v.width)));
 for(const viewport of viewports){
  const context=await browser.newContext({viewport,hasTouch:viewport.width<=768,serviceWorkers:'block'});await context.route('**/*',serve);
  const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.__feedScrollCalls=[];const original=Element.prototype.scrollTo;Element.prototype.scrollTo=function(options,...rest){const result=original.call(this,options,...rest);if(this.matches('[data-video-feed-scroll]'))window.__feedScrollCalls.push({behavior:options?.behavior,target:options?.top,actual:this.scrollTop});return result;};});
  try{
   await installAuditMember(page,app,profile.id);await auditNavigate(page,origin+'/');await page.locator('.home-feed-layout').waitFor();
   if(viewport.width>768){
    const account=page.locator('.sidebar-user');await bottomPinned(page,account,viewport.height,'Desktop account');
    await page.locator('.sidebar-nav').getByRole('button',{name:'Saved',exact:true}).click();await scrollAndKeep(page,page.locator('.sidebar-nav'),account,viewport.height,'Desktop account');
    const rail=page.locator('.home-feed-right-tabs'),command=rail.locator('.home-feed-command-center-link');
    await scrollAndKeep(page,rail.locator('.home-feed-view-tabs'),command,viewport.height,'Home feed');
    await rail.locator('.profile-panel-trigger').first().click();await scrollAndKeep(page,rail.locator('.home-feed-side-tools'),command,viewport.height,'Home tools');
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(80);await bottomPinned(page,command,viewport.height,'Home after page scroll');
    await capture(page,`home-${viewport.width}`);
    await auditNavigate(page,origin+'/opportunities');await page.locator('.jobs-page-layout').waitFor();
    const jobs=page.locator('.jobs-page-right-tabs'),resume=jobs.locator('.jobs-page-resume-builder');
    await scrollAndKeep(page,jobs.locator('.jobs-page-rail-options'),resume,viewport.height,'Jobs options');
    await jobs.locator('.profile-panel-trigger').first().click();await scrollAndKeep(page,jobs.locator('.home-feed-side-tools'),resume,viewport.height,'Jobs tools');
    check((await rect(jobs.locator('.home-feed-side-tools'))).height>=40,'Jobs tools retain a usable scroll window');
    await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await page.waitForTimeout(80);await bottomPinned(page,resume,viewport.height,'Jobs after page scroll');
    await capture(page,`jobs-${viewport.width}`);
   }else{
    await page.getByRole('button',{name:'Open account menu',exact:true}).click();const left=page.locator('#mobile-account-drawer');
    await page.waitForFunction(()=>Math.abs(document.querySelector('#mobile-account-drawer').getBoundingClientRect().x)<1);
    await left.getByRole('button',{name:'Saved',exact:true}).click();await scrollAndKeep(page,left.locator('.mobile-account-drawer-links'),left.locator('.mobile-account-drawer-bottom'),viewport.height,'Mobile account');
    await capture(page,`account-${viewport.width}`);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#mobile-account-drawer').getBoundingClientRect().right<=1);
    await page.getByRole('button',{name:'Open menu',exact:true}).click();const right=page.locator('#mobile-feed-drawer');
    await page.waitForFunction(()=>document.querySelector('#mobile-feed-drawer').getBoundingClientRect().right<=innerWidth+1);
    const feeds=right.getByRole('navigation',{name:'Feeds',exact:true}),command=right.getByRole('link',{name:'Command Center',exact:true});
    check(await feeds.locator(':scope > button,:scope > a').count()===8,'All eight feed destinations share one list');
    check(await right.locator('.paged-list-navigation,[hidden]').count()===0,'Feed sidebar has no Next/Previous pages or hidden destinations');
    await scrollAndKeep(page,feeds,command,viewport.height,'Mobile feeds');
    await feeds.locator(':scope > button').first().focus();for(let i=0;i<7;i++)await page.keyboard.press('Tab');
    check(await feeds.getByRole('link',{name:'Your Vault',exact:true}).evaluate(el=>el===document.activeElement),'Keyboard reaches final destination without paging');
    check(await feeds.getByRole('link',{name:'Your Vault',exact:true}).evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement.getBoundingClientRect();return a.top>=b.top-1&&a.bottom<=b.bottom+1;}),'Focused destination scrolls into view');
    await right.locator('.profile-panel-trigger').first().click();await scrollAndKeep(page,right.locator('.home-feed-side-tools'),command,viewport.height,'Mobile feed tools');
    await capture(page,`feeds-${viewport.width}`);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#mobile-feed-drawer').getBoundingClientRect().left>=innerWidth-1);
    await auditNavigate(page,origin+'/opportunities');await page.locator('.jobs-page-layout').waitFor();await page.getByRole('button',{name:'Open menu',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#mobile-feed-drawer').getBoundingClientRect().right<=innerWidth+1);
    await scrollAndKeep(page,right.locator('.mobile-feed-drawer-options'),right.getByRole('link',{name:'Resume Builder',exact:true}),viewport.height,'Mobile jobs');
    await capture(page,`jobs-${viewport.width}`);await page.keyboard.press('Escape');
   }
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Sidebar route has no horizontal overflow');
   if([1440,390,320].includes(viewport.width))for(const surface of ['videos','music']){
    await auditNavigate(page,origin+'/'+surface);const scroll=page.locator('[data-video-feed-scroll]');await scroll.waitFor();await scroll.locator('[data-post-id="scroll-fixture-1"]').waitFor({state:'attached'});
    check(await scroll.evaluate(el=>getComputedStyle(el).scrollBehavior==='auto'&&getComputedStyle(el).scrollSnapType==='y mandatory'&&getComputedStyle(el.querySelector('.video-feed-snap-item')).scrollSnapAlign==='start'),surface+' snaps to each video without smooth CSS scrolling');
    await scroll.focus();await page.keyboard.press('PageDown');
    const keyboard=await page.evaluate(()=>window.__feedScrollCalls.at(-1));check(keyboard?.behavior==='instant'&&Math.abs(keyboard.actual-keyboard.target)<2,surface+' keyboard advances immediately');
    await scroll.evaluate(el=>{el.scrollTop=el.clientHeight*.75;});
    await page.waitForFunction(()=>{const el=document.querySelector('[data-video-feed-scroll]');return el.scrollTop>20&&Math.abs(el.scrollTop-el.clientHeight)<2;});
    check(await scroll.evaluate(el=>Math.abs(el.scrollTop-el.clientHeight)<2),surface+' partial scroll settles at a video boundary');
    await scroll.evaluate(el=>{el.scrollTop=0;});await page.waitForTimeout(200);
    // Feed cohorts may reorder IDs; interact with the first actual slide after resetting scroll.
    const first=scroll.locator('[data-post-id]').first(),video=first.locator('video');await video.waitFor();
    for(const name of [/^(?:Play|Pause) video$/,/^(?:Mute|Unmute) video$/])check(await first.getByRole('button',{name}).isVisible(),surface+' retains visible '+name+' controls');
    check(await first.getByRole('slider',{name:'Video progress',exact:true}).isVisible(),surface+' retains the progress control');
    check(await page.locator('.video-feed-top-controls').getByRole('button',{name:'Full screen',exact:true}).isVisible(),surface+' retains its header expand control');
    check(await first.locator('.media-playback-controls').getByRole('button',{name:/full screen/i}).count()===0,surface+' has no duplicate bottom fullscreen control');
    const muted=await video.evaluate(el=>el.muted);await first.getByRole('button',{name:/^(?:Mute|Unmute) video$/}).click();check(await video.evaluate(el=>el.muted)!==muted,surface+' mute control remains interactive');
    await first.getByRole('slider',{name:'Video progress',exact:true}).focus();await page.keyboard.press('Home');await page.keyboard.press('PageUp');
    const seek=await video.evaluate(el=>({time:el.currentTime,duration:el.duration,ready:el.readyState,seekable:[...Array(el.seekable.length)].map((_,i)=>[el.seekable.start(i),el.seekable.end(i)])}));
    check(seek.time>=.8,surface+' keyboard seeking still controls playback '+JSON.stringify(seek));
    if(viewport.width<=768){
     const bounds=await video.boundingBox();const cdp=await context.newCDPSession(page);const y=bounds.y+bounds.height*.2;const x=bounds.x+bounds.width*.82;
     await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
     for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-bounds.width*.65*i/6,y}]});
     await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
     const swipe=await page.evaluate(()=>window.__feedScrollCalls.at(-1));check(swipe?.behavior==='instant'&&swipe.target>0&&Math.abs(swipe.actual-swipe.target)<2,surface+' horizontal swipe advances immediately');
     await scroll.evaluate(el=>{el.scrollTop=0;});await page.waitForTimeout(200);
     const vertical=await context.newCDPSession(page);const area=await video.boundingBox(),startY=area.y+area.height*.9,verticalX=area.x+area.width*.5;
     await vertical.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:verticalX,y:startY}]});
     for(let i=1;i<=8;i++){await vertical.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:verticalX,y:startY-area.height*.8*i/8}]});await page.waitForTimeout(20);}
     await vertical.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await vertical.detach();
     await page.waitForFunction(()=>{const el=document.querySelector('[data-video-feed-scroll]');return el.scrollTop>20&&Math.abs(el.scrollTop/el.clientHeight-Math.round(el.scrollTop/el.clientHeight))<.002;});
     check(await scroll.evaluate(el=>el.scrollTop>20&&Math.abs(el.scrollTop/el.clientHeight-Math.round(el.scrollTop/el.clientHeight))<.002),surface+' vertical touch advances and settles at a video boundary');
    }else{
     const bounds=await video.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height*.3);
     // Deliberately cross the next clip's midpoint; a small wheel delta may
     // correctly settle back to the current clip under mandatory snapping.
     await page.mouse.wheel(0,await scroll.evaluate(el=>el.clientHeight*.8));
     await page.waitForFunction(()=>{const el=document.querySelector('[data-video-feed-scroll]');return el.scrollTop>20&&Math.abs(el.scrollTop/el.clientHeight-Math.round(el.scrollTop/el.clientHeight))<.002;});
     check(await scroll.evaluate(el=>el.scrollTop>20&&Math.abs(el.scrollTop/el.clientHeight-Math.round(el.scrollTop/el.clientHeight))<.002),surface+' wheel advances and settles at a video boundary');
    }
    await capture(page,`${surface}-${viewport.width}`);
   }
   results.push({...viewport,appChrome:await page.evaluate(()=>document.documentElement.getAttribute('data-ufi-app')),passed:true});console.log(`PASS sidebar and media scrolling ${viewport.width}x${viewport.height}`);
  }catch(error){await capture(page,`failure-${viewport.width}`);await fs.writeFile(path.join(output,`failure-${viewport.width}.html`),await page.content());console.error(await page.locator('.jobs-page-right-tabs,.jobs-page-rail-options,.jobs-page-rail-bottom,.jobs-page-resume-builder').evaluateAll(els=>els.map(el=>({className:el.className,rect:el.getBoundingClientRect().toJSON(),scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}))));throw error;}finally{await context.close();}
 }
 check(errors.length===0,'No browser exceptions: '+errors.join('; '));
 const sourceHashes={};for(const file of ['web/src/components/Layout.jsx','web/src/components/VideoFeedView.jsx','web/src/components/VideoFeedView.css','web/src/index.css','web/src/pages/Opportunities.jsx','web/src/main.jsx','mobile/current-site/Website.jsx','mobile/current-site/website.css','web/package-lock.json','scripts/audit-sidebar-scroll.mjs'])sourceHashes[file]=crypto.createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
 await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),sourceRoot:root,origin,liveAssets,passed:true,checks,results,screenshots,sourceHashes},null,2)+'\n');console.log(`PASS ${checks} targeted scrolling checks`);
}finally{await browser.close();}
