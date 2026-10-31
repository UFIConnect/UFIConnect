import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, transformWithOxc } from '../web/node_modules/vite/dist/node/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.cache/audit-ui/media-autoplay');await fs.mkdir(output,{recursive:true});
const media=await fs.readFile(path.join(root,'web/public/media/preparation/closing-questions.mp4'));
const fixture=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{HelmetProvider}from'react-helmet-async';import{AuthProvider}from'/src/contexts/AuthContext';import{SavedItemsProvider}from'/src/contexts/SavedItemsContext';import{ToastProvider}from'/src/contexts/ToastContext';import SnapViewer from'/src/components/SnapViewer';import TwitchClipPlayer from'/src/components/TwitchClipPlayer';import{InlineAutoplayVideo}from'/src/components/videoMedia';import{VimeoEmbedBlock}from'/src/pages/Feed';import'/src/index.css';import'/src/components/SnapRail.css';
const kind=new URLSearchParams(location.search).get('kind'),url='https://media.fixture.invalid/clip.mp4';
const source=kind==='youtube'?'youtube':kind==='twitch'?'twitch':kind==='mastodon'?'mastodon':'uficonnect';
const snaps=[0,1].map(i=>({id:'fixture'+i,source,mediaType:'video',mediaKind:kind==='twitch'?'source':undefined,mediaUrl:kind==='youtube'?'https://www.youtube.com/watch?v=fixture000'+i:kind==='twitch'?'https://clips.twitch.tv/FixtureClip'+i:kind==='hls'?'https://media.fixture.invalid/stream.m3u8':url,sourceUrl:kind==='youtube'?'https://www.youtube.com/watch?v=fixture000'+i:kind==='twitch'?'https://clips.twitch.tv/FixtureClip'+i:kind==='mastodon'?'https://mastodon.social/@fixture/123':'https://uficonnect.org/snaps/fixture'+i,directPlaybackAuthorized:true,videoDurationSeconds:30,caption:'Fixture video '+i,author:{id:'creator',name:'Creator'},createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}));
function Fixture(){const[index,setIndex]=useState(null);return <><button onClick={()=>setIndex(0)}>Open snap</button>{kind==='vimeo'&&<VimeoEmbedBlock embedId="123456" title="Vimeo fixture"/>}{kind==='twitch'&&<main style={{maxWidth:720,margin:'0 auto'}}><TwitchClipPlayer post={snaps[0]}/></main>}{kind==='inline'&&<InlineAutoplayVideo kind="file" src={url} post={snaps[0]} videoKey="inline-fixture" style={{width:600,maxWidth:'100%'}}/>}{index!==null&&<SnapViewer items={snaps} index={index} profile={{id:'autoplay-audit'}} now={Date.now()} onChange={snap=>setIndex(snaps.indexOf(snap))} onClose={()=>setIndex(null)}/>}</>}
createRoot(document.getElementById('root')).render(<HelmetProvider><BrowserRouter><AuthProvider><SavedItemsProvider><ToastProvider><Fixture/></ToastProvider></SavedItemsProvider></AuthProvider></BrowserRouter></HelmetProvider>);`;
const server=await createServer({root:path.join(root,'web'),envDir:false,optimizeDeps:{exclude:['hls.js']},cacheDir:path.join(output,'vite'),define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},plugins:[{
 name:'autoplay-fixture',enforce:'pre',resolveId(id){if(id==='virtual:autoplay.jsx')return '\0autoplay';if(id==='hls.js')return '\0hls-fixture';},async load(id){
  if(id==='\0autoplay')return(await transformWithOxc(fixture,'autoplay.jsx',{jsx:{runtime:'automatic'}})).code;
  if(id==='\0hls-fixture')return `export default class Hls{static Events={MANIFEST_PARSED:'manifest',ERROR:'error'};static isSupported(){return true}loadSource(){}attachMedia(video){this.video=video;video.src='https://media.fixture.invalid/clip.mp4'}on(name,callback){if(name==='manifest')setTimeout(()=>callback(),20)}destroy(){this.video?.pause()}}`;
 },configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(new URL(req.url,'http://fixture.invalid').pathname!=='/')return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/@id/virtual:autoplay.jsx"></script>'));});}
}],server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
let browser,checks=0;const check=(condition,label)=>{assert.ok(condition,label);checks++;};
try{
 await server.listen();const origin=server.resolvedUrls.local[0];browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,args:['--autoplay-policy=no-user-gesture-required']});
 for(const kind of ['file','mastodon','hls','youtube','twitch','inline','vimeo'])for(const blocked of kind==='twitch'?[false]:[false,true]){
  console.log('Checking autoplay',kind,{blocked});
  const context=await browser.newContext({viewport:{width:860,height:900},serviceWorkers:'block'});const errors=[],writes=[];
  await context.addInitScript(({blocked})=>{
   localStorage.setItem('uficonnect.analytics.consent.v1','denied');localStorage.setItem('uficonnect.ads.consent.v1','denied');window.__players=[];window.__plays=[];
   const play=HTMLMediaElement.prototype.play;
   const canPlayType=HTMLMediaElement.prototype.canPlayType;HTMLMediaElement.prototype.canPlayType=function(type){return type==='application/vnd.apple.mpegurl'?'':canPlayType.call(this,type);};
   HTMLMediaElement.prototype.play=function(){window.__plays.push({muted:this.muted});if(blocked&&!this.muted)return Promise.reject(new DOMException('Fixture audio policy','NotAllowedError'));return play.call(this);};
   window.YT={PlayerState:{PLAYING:1,PAUSED:2,ENDED:0},Player:class{
    constructor(frame,config){this.frame=frame;this.config=config;this.id=new URL(frame.src).pathname.split('/').pop();this.state=-1;this.muted=true;this.volume=100;window.__players.push(this);setTimeout(()=>config.events.onReady({target:this}),20);}
    getIframe(){return this.frame}getVideoData(){return{video_id:this.id}}getDuration(){return 30}getCurrentTime(){return 1}getPlayerState(){return this.state}isMuted(){return this.muted}getVolume(){return this.volume}setVolume(value){this.volume=value}getAvailablePlaybackRates(){return[1]}getPlaybackRate(){return 1}getOptions(){return[]}mute(){this.muted=true}unMute(){this.muted=false}pauseVideo(){this.state=2;this.config.events.onStateChange?.({target:this,data:2})}playVideo(){if(blocked&&!this.muted){this.config.events.onAutoplayBlocked?.({target:this});return;}this.state=1;this.config.events.onStateChange?.({target:this,data:1})}destroy(){this.state=2;this.frame.remove()}
   }};
  },{blocked});
  await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());
   if(url.hostname==='media.fixture.invalid')return route.fulfill({body:media,contentType:'video/mp4'});
   if(url.hostname==='player.vimeo.com')return route.fulfill({contentType:'text/html',body:`<!doctype html><button>Vimeo controls</button><script>window.state={playing:false,muted:true,attempts:[]};addEventListener('message',e=>{let d;try{d=typeof e.data==='string'?JSON.parse(e.data):e.data}catch{return}const reply=value=>parent.postMessage(JSON.stringify({method:d.method,value}),e.origin);if(d.method==='ping')reply(true);else if(d.method==='getVideoId')reply(123456);else if(d.method==='setMuted'){state.muted=d.value;reply(d.value)}else if(d.method==='play'){state.attempts.push(state.muted);if(${blocked}&&!state.muted)parent.postMessage(JSON.stringify({event:'error',data:{method:'play',name:'NotAllowedError'}}),e.origin);else{state.playing=true;reply(true)}}else if(d.method==='pause'){state.playing=false;reply(true)}});parent.postMessage(JSON.stringify({event:'ready'}),'*');</script>`});
   if(['www.youtube.com','www.youtube-nocookie.com','clips.twitch.tv'].includes(url.hostname)&&req.resourceType()==='document')return route.fulfill({body:'<!doctype html><p>Official player fixture</p>',contentType:'text/html'});
   if(url.origin!==new URL(origin).origin)return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();const endpoint=url.pathname.slice(4);
   if(req.method()!=='GET'){if(!endpoint.startsWith('/analytics/'))writes.push(endpoint);return route.fulfill({status:204});}
   if(endpoint==='/auth/session')return route.fulfill({status:401,json:{message:'Synthetic session only'}});
   return route.fulfill({json:{posts:[],postIds:[],jobs:[],sources:{},notifications:[],items:[]}});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'?kind='+kind);
  if(kind==='twitch'){
   const feed=page.locator('main .twitch-clip-player');await feed.locator('iframe').waitFor();let url=new URL(await feed.locator('iframe').getAttribute('src'));
   check(url.searchParams.get('autoplay')==='true'&&url.searchParams.get('muted')==='false','Visible Twitch clip requests autoplay with sound');
   check(await feed.getByRole('link',{name:'Watch on Twitch',exact:true}).isVisible(),'Twitch credit remains visible');
   await feed.getByRole('button',{name:'Close Twitch player',exact:true}).click();await feed.locator('iframe').waitFor({state:'detached'});await page.waitForTimeout(200);check(await feed.locator('iframe').count()===0,'Explicit Close is not overridden by autoplay');
   await page.getByRole('button',{name:'Open snap',exact:true}).click();const snap=page.locator('.snap-viewer .twitch-clip-player');await snap.locator('iframe').waitFor();check(new URL(await snap.locator('iframe').getAttribute('src')).searchParams.get('muted')==='false','Opened Twitch snap requests sound');
  }else if(kind==='vimeo'){
   const frame=page.frameLocator('iframe');await frame.getByRole('button',{name:'Vimeo controls'}).waitFor();
   await page.waitForFunction(()=>document.querySelector('iframe'));
   const provider=page.frames().find(frame=>frame.url().startsWith('https://player.vimeo.com'));
   await provider.waitForFunction(()=>window.state.playing);
   check(await provider.evaluate(()=>window.state.muted)===blocked,'Vimeo starts with sound or retries a blocked request silently');
   check(JSON.stringify(await provider.evaluate(()=>window.state.attempts))===JSON.stringify(blocked?[false,true]:[false]),'Vimeo uses one audio attempt and at most one silent retry');
  }else if(kind==='inline'){
   await page.locator('video').hover();
   await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.readyState>=2;});check(await page.locator('video').evaluate(v=>v.muted)===blocked,'Inline video starts audibly or falls back when blocked');
  }else{
   await page.getByRole('button',{name:'Open snap',exact:true}).click();const viewer=page.getByRole('dialog');
   await viewer.getByRole('button',{name:'Pause video',exact:true}).waitFor();await viewer.getByRole('button',{name:blocked?'Unmute video':'Mute video',exact:true}).waitFor();
   check(true,kind+': autoplay and confirmed sound state');
   if(kind!=='youtube')check(await viewer.locator('video').evaluate((v,expected)=>!v.paused&&v.muted===expected,blocked),'Native player state agrees with controls');
   if(!blocked){await viewer.getByRole('button',{name:'Mute video',exact:true}).click();await viewer.getByRole('button',{name:'Next snap',exact:true}).click();await viewer.getByRole('button',{name:'Pause video',exact:true}).waitFor();await viewer.getByRole('button',{name:'Unmute video',exact:true}).waitFor();check(await page.evaluate(()=>localStorage.getItem('ufc_wants_sound'))==='0','Explicit mute persists into the next snap');}
   await viewer.getByRole('button',{name:'Pause video',exact:true}).click();await viewer.getByRole('button',{name:'Play video',exact:true}).waitFor();await page.waitForTimeout(350);check(await viewer.getByRole('button',{name:'Play video',exact:true}).isVisible(),'Explicit pause stays paused');
   await viewer.getByRole('button',{name:'Play video',exact:true}).click();await viewer.getByRole('button',{name:'Pause video',exact:true}).waitFor();
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await viewer.getByRole('button',{name:'Play video',exact:true}).waitFor();check(true,'Backgrounding stops the active snap');
  }
  check(errors.length===0,'No application errors: '+errors.join('; '));check(writes.length===0,'No publication or account write');await context.close();
 }
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,checks,scope:'Real components and MP4 decoding; simulated YouTube, HLS transport and Twitch embed responses. Audio policy simulated deterministically.'},null,2));console.log('PASS '+checks+' autoplay, sound, pause, source-credit and lifecycle checks');
}catch(error){const page=browser?.contexts().at(-1)?.pages().at(-1);if(page){await page.screenshot({path:path.join(output,'failure.png')});console.error(await page.evaluate(()=>({url:location.href,text:document.body.innerText,plays:window.__plays,videos:[...document.querySelectorAll('video')].map(v=>({src:v.currentSrc,paused:v.paused,muted:v.muted,ready:v.readyState,error:v.error?.message}))})));}throw error;}finally{await browser?.close();await server.close();}
