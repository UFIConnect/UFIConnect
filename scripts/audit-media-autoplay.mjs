import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, transformWithOxc } from '../web/node_modules/vite/dist/node/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.cache/audit-ui/media-autoplay');await fs.mkdir(output,{recursive:true});
const media=await fs.readFile(path.join(root,'web/public/media/preparation/closing-questions.mp4'));
const fixture=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{HelmetProvider}from'react-helmet-async';import{AuthProvider}from'/src/contexts/AuthContext';import{SavedItemsProvider}from'/src/contexts/SavedItemsContext';import{ToastProvider}from'/src/contexts/ToastContext';import SnapViewer from'/src/components/SnapViewer';import TwitchClipPlayer from'/src/components/TwitchClipPlayer';import{InlineAutoplayVideo,useGlobalMuted}from'/src/components/videoMedia';import{PostCard,VimeoEmbedBlock}from'/src/pages/Feed';import VideoFeedView from'/src/components/VideoFeedView';import'/src/index.css';import'/src/components/SnapRail.css';
const kind=new URLSearchParams(location.search).get('kind'),url='https://media.fixture.invalid/clip.mp4';
const source=kind==='youtube'?'youtube':kind==='twitch'?'twitch':kind==='mastodon'?'mastodon':'uficonnect';
const snaps=[0,1].map(i=>({id:'fixture'+i,source,mediaType:'video',mediaKind:kind==='twitch'?'source':undefined,mediaUrl:kind==='youtube'?'https://www.youtube.com/watch?v=fixture000'+i:kind==='twitch'?'https://clips.twitch.tv/FixtureClip'+i:kind==='hls'?'https://media.fixture.invalid/stream.m3u8':url,sourceUrl:kind==='youtube'?'https://www.youtube.com/watch?v=fixture000'+i:kind==='twitch'?'https://clips.twitch.tv/FixtureClip'+i:kind==='mastodon'?'https://mastodon.social/@fixture/123':'https://uficonnect.org/snaps/fixture'+i,directPlaybackAuthorized:true,videoDurationSeconds:30,caption:'Fixture video '+i,author:{id:'creator',name:'Creator'},createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}));
function Fixture() {
  const [index, setIndex] = useState(null);
  const [, toggleSound] = useGlobalMuted();
  if (kind.startsWith('videos-')) return <VideoFeedView />;
  if (kind.startsWith('feed-youtube')) {
    const mediaUrl = 'https://www.youtube.com/watch?v=fixture0000';
    const post = { ...snaps[0], source: 'youtube', isExternal: true, mediaUrl, sourceUrl: mediaUrl, title: 'YouTube feed fixture' };
    return <main style={{ maxWidth: 640, margin: '0 auto' }}>
      <button onClick={toggleSound}>Toggle saved sound</button>
      <PostCard post={post} />
    </main>;
  }
  return <>
    <button onClick={() => setIndex(0)}>Open snap</button>
    {kind === 'vimeo' && <VimeoEmbedBlock embedId="123456" title="Vimeo fixture" />}
    {kind === 'twitch' && <main style={{ maxWidth: 720, margin: '0 auto' }}><TwitchClipPlayer post={snaps[0]} /></main>}
    {kind === 'inline' && <InlineAutoplayVideo kind="file" src={url} post={snaps[0]} videoKey="inline-fixture" style={{ width: 600, maxWidth: '100%' }} />}
    {index !== null && <SnapViewer items={snaps} index={index} profile={{ id: 'autoplay-audit' }} now={Date.now()}
      onChange={snap => setIndex(snaps.indexOf(snap))} onClose={() => setIndex(null)} />}
  </>;
}
createRoot(document.getElementById('root')).render(<HelmetProvider><BrowserRouter><AuthProvider><SavedItemsProvider><ToastProvider><Fixture/></ToastProvider></SavedItemsProvider></AuthProvider></BrowserRouter></HelmetProvider>);`;
const server=await createServer({root:path.join(root,'web'),envDir:false,optimizeDeps:{exclude:['hls.js']},cacheDir:path.join(output,'vite'),define:{'import.meta.env.VITE_API_URL':JSON.stringify('/api')},plugins:[{
 name:'autoplay-fixture',enforce:'pre',resolveId(id){if(id==='virtual:autoplay.jsx')return '\0autoplay';if(id==='hls.js')return '\0hls-fixture';},async load(id){
  if(id==='\0autoplay')return(await transformWithOxc(fixture,'autoplay.jsx',{jsx:{runtime:'automatic'}})).code;
  if(id==='\0hls-fixture')return `export default class Hls{static Events={MANIFEST_PARSED:'manifest',ERROR:'error'};static isSupported(){return true}loadSource(){}attachMedia(video){this.video=video;video.src='https://media.fixture.invalid/clip.mp4'}on(name,callback){if(name==='manifest')setTimeout(()=>callback(),20)}destroy(){this.video?.pause()}}`;
 },configureServer(vite){vite.middlewares.use(async(req,res,next)=>{if(new URL(req.url,'http://fixture.invalid').pathname!=='/')return next();res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/@id/virtual:autoplay.jsx"></script>'));});}
}],server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
const memberProfile = { id: 'autoplay-audit', name: 'Autoplay audit member', plan: 'pro' };
const slideMedia = {
  'videos-file': 'https://media.fixture.invalid/clip.mp4',
  'videos-hls': 'https://media.fixture.invalid/stream.m3u8',
  'videos-vimeo': 'https://vimeo.com/123456',
};
function makeVideoPost(kind) {
  return {
    id: 'slide-fixture', source: 'uficonnect', mediaType: 'video', mediaUrl: slideMedia[kind],
    title: 'Videos fixture', videoDurationSeconds: 30, directPlaybackAuthorized: true,
    author: { id: 'creator', name: 'Creator' }, createdAt: new Date().toISOString(),
  };
}

function vimeoFixture({ blocked, holdMute }) {
  return `<!doctype html><button>Vimeo controls</button><script>
    const state = window.state = { playing: false, muted: true, attempts: [], awaitingMute: false, acknowledgedMute: false };
    let finishMute;
    addEventListener('message', event => {
      let command;
      try { command = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (!command || typeof command !== 'object') return;
      const { method, value } = command;
      const emit = message => parent.postMessage(JSON.stringify(message), event.origin);
      const reply = value => emit({ method, value });
      if (method === 'ping') reply(true);
      else if (method === 'getVideoId') reply(123456);
      else if (method === 'getPaused') reply(!state.playing);
      else if (method === 'getMuted') reply(state.muted);
      else if (method === 'getVolume') reply(1);
      else if (method === 'getDuration') reply(30);
      else if (method === 'getCurrentTime') reply(0);
      else if (method === 'setMuted') {
        state.muted = value;
        if (${holdMute} && !state.acknowledgedMute) {
          state.awaitingMute = true;
          finishMute = () => {
            state.awaitingMute = false;
            state.acknowledgedMute = true;
            reply(state.muted);
          };
        } else reply(state.muted);
      } else if (method === 'play') {
        state.attempts.push(state.muted);
        if (${blocked} && !state.muted) emit({ event: 'error', data: { method, name: 'NotAllowedError' } });
        else {
          state.playing = true;
          reply(true);
          emit({ event: 'play' });
        }
      } else if (method === 'pause') {
        state.playing = false;
        reply(true);
        emit({ event: 'pause' });
        if (state.releaseMuteOnPause && finishMute) {
          finishMute();
          finishMute = undefined;
        }
      }
    });
    parent.postMessage(JSON.stringify({ event: 'ready' }), '*');
  </script>`;
}

let browser, checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const checkAttempts = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
try{
 await server.listen();const origin=server.resolvedUrls.local[0];browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,args:['--autoplay-policy=no-user-gesture-required']});
 const kinds = ['file', 'mastodon', 'hls', 'youtube', 'twitch', 'inline', 'vimeo',
   'feed-youtube', 'feed-youtube-muted', 'feed-youtube-blocked', ...Object.keys(slideMedia)];
 for (const kind of kinds) for (const blocked of ['twitch', 'feed-youtube-muted', 'feed-youtube-blocked'].includes(kind) ? [false] : [false, true]) {
  console.log('Checking autoplay',kind,{blocked});
  const isSlide = Object.hasOwn(slideMedia, kind);
  const delayMetadata = isSlide && kind !== 'videos-vimeo';
  const metadata = Promise.withResolvers();
  const profile = isSlide ? memberProfile : null;
  const delayYouTube = kind.startsWith('feed-youtube');
  const blockAllYouTube = kind === 'feed-youtube-blocked';
  const context=await browser.newContext({viewport:{width:860,height:900},serviceWorkers:'block'});const errors=[],writes=[];
  await context.addInitScript(({ blocked, delayYouTube, blockAllYouTube, initiallyMuted }) => {
   if (window !== window.top) return;
   localStorage.setItem('uficonnect.analytics.consent.v1','denied');localStorage.setItem('uficonnect.ads.consent.v1','denied');window.__players=[];window.__plays=[];
   if (initiallyMuted) localStorage.setItem('ufc_wants_sound', '0');
   const play=HTMLMediaElement.prototype.play;
   const canPlayType=HTMLMediaElement.prototype.canPlayType;HTMLMediaElement.prototype.canPlayType=function(type){return type==='application/vnd.apple.mpegurl'?'':canPlayType.call(this,type);};
   HTMLMediaElement.prototype.play=function(){window.__plays.push({muted:this.muted});if(blocked&&!this.muted)return Promise.reject(new DOMException('Fixture audio policy','NotAllowedError'));return play.call(this);};
   window.YT={PlayerState:{PLAYING:1,PAUSED:2,ENDED:0},Player:class{
    constructor(frame, config) {
      this.frame = frame;
      this.config = config;
      this.id = new URL(frame.src).pathname.split('/').pop();
      this.state = -1;
      this.muted = true;
      this.volume = 100;
      this.attempts = [];
      window.__players.push(this);
      if (!delayYouTube) setTimeout(() => this.ready(), 20);
    }
    ready() { this.config.events.onReady({ target: this }); }
    autoplayBlocked() { this.config.events.onAutoplayBlocked?.({ target: this }); }
    playVideo() {
      this.attempts.push(this.muted);
      if (blockAllYouTube || (blocked && !this.muted)) { this.autoplayBlocked(); return; }
      this.state = 1;
      this.config.events.onStateChange?.({ target: this, data: 1 });
    }
    getIframe(){return this.frame}getVideoData(){return{video_id:this.id}}getDuration(){return 30}getCurrentTime(){return 1}getPlayerState(){return this.state}isMuted(){return this.muted}getVolume(){return this.volume}setVolume(value){this.volume=value}getAvailablePlaybackRates(){return[1]}getPlaybackRate(){return 1}getOptions(){return[]}mute(){this.muted=true}unMute(){this.muted=false}pauseVideo(){this.state=2;this.config.events.onStateChange?.({target:this,data:2})}destroy(){this.state=2;this.frame.remove()}
   }};
  }, { blocked, delayYouTube, blockAllYouTube, initiallyMuted: delayMetadata && blocked });
  await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());
   if (url.hostname === 'media.fixture.invalid') {
    if (delayMetadata) await metadata.promise;
    return route.fulfill({ body: media, contentType: 'video/mp4' });
   }
   if (url.hostname === 'vimeo.com' && url.pathname === '/api/oembed.json') return route.fulfill({ json: { duration: 30 } });
   if (url.hostname === 'player.vimeo.com') return route.fulfill({
    contentType: 'text/html', body: vimeoFixture({ blocked, holdMute: kind === 'videos-vimeo' }),
   });
   if(['www.youtube.com','www.youtube-nocookie.com','clips.twitch.tv'].includes(url.hostname)&&req.resourceType()==='document')return route.fulfill({body:'<!doctype html><p>Official player fixture</p>',contentType:'text/html'});
   if(url.origin!==new URL(origin).origin)return route.abort();
   if(!url.pathname.startsWith('/api/'))return route.continue();const endpoint=url.pathname.slice(4);
   if(req.method()!=='GET'){
    if (!endpoint.startsWith('/analytics/') && !['/posts/engagement-signal', '/posts/engaged'].includes(endpoint)) writes.push(endpoint);
    return route.fulfill({status:204});
   }
   if (endpoint === '/auth/session') return profile
     ? route.fulfill({ json: { token: 'synthetic-autoplay-session', profile } })
     : route.fulfill({ status: 401, json: { message: 'Synthetic session only' } });
   if (profile && endpoint === '/profile') return route.fulfill({ json: profile });
   if (isSlide && endpoint === '/office/feed/videos') return route.fulfill({
    json: { posts: [makeVideoPost(kind)], hasMore: false, waitingForNew: true },
   });
   return route.fulfill({json:{posts:[],postIds:[],jobs:[],sources:{},notifications:[],items:[]}});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'?kind='+kind,{waitUntil:'domcontentloaded'});
  if (delayYouTube) {
   await page.waitForFunction(() => window.__players.length === 1);
   const muted = kind === 'feed-youtube-muted';
   const expected = muted ? [true] : blocked || blockAllYouTube ? [false, true] : [false];
   checkAttempts(await page.evaluate(() => window.__players[0].attempts), [], 'Feed waits for YouTube readiness');
   if (muted) await page.getByRole('button', { name: 'Toggle saved sound', exact: true }).click();
   await page.evaluate(() => window.__players[0].ready());
   const button = name => page.getByRole('button', { name, exact: true });
   await button(blockAllYouTube ? 'Play video' : 'Pause video').waitFor();
   checkAttempts(await page.evaluate(() => window.__players[0].attempts), expected, 'Feed uses the latest sound choice and a single policy fallback');
   if (!blockAllYouTube) {
    await button('Pause video').click();
    await button('Play video').waitFor();
   }
   await page.evaluate(() => window.__players[0].autoplayBlocked());
   checkAttempts(await page.evaluate(() => window.__players[0].attempts), expected, 'A late blocked event cannot restart a paused or failed card');
  } else if (delayMetadata) {
   const slide = page.locator('[data-post-id="slide-fixture"]');
   const video = slide.locator('video');
   try {
    await video.waitFor({ state: 'visible' });
    check(await video.evaluate(element => element.readyState === 0), 'Videos exposes sound while metadata is loading');
    await slide.getByRole('button', { name: /^(?:Mute|Unmute) video$/ }).click();
    check(await video.evaluate(element => element.muted) === !blocked, 'Sound changes while metadata is still pending');
    checkAttempts(await page.evaluate(() => window.__plays), [], 'Loading media has no earlier play attempt');
   } finally {
    metadata.resolve();
   }
   await slide.getByRole('button', { name: 'Pause video', exact: true }).waitFor();
   checkAttempts(await page.evaluate(() => window.__plays.map(attempt => attempt.muted)),
    blocked ? [false, true] : [true], 'Videos starts once after metadata using the updated preference');
  } else if (kind === 'videos-vimeo') {
   const slide = page.locator('[data-post-id="slide-fixture"]');
   await slide.frameLocator('iframe').getByRole('button', { name: 'Vimeo controls' }).waitFor();
   const provider = page.frames().find(frame => frame.url().startsWith('https://player.vimeo.com/'));
   await provider.waitForFunction(() => window.state.awaitingMute);
   await provider.evaluate(() => { window.state.releaseMuteOnPause = true; });
   const scroll = page.locator('[data-video-feed-scroll]');
   const hold = await scroll.evaluate(box => {
    const dispatch = () => box.dispatchEvent(new Event('scroll'));
    dispatch();
    return window.setInterval(dispatch, 30);
   });
   try {
    await provider.waitForFunction(() => window.state.acknowledgedMute);
    checkAttempts(await provider.evaluate(() => window.state.attempts), [], 'Vimeo cannot start while scrolling');
   } finally {
    await page.evaluate(timer => clearInterval(timer), hold);
   }
   await slide.getByRole('button', { name: 'Pause video', exact: true }).waitFor();
   const expected = blocked ? [false, true] : [false];
   checkAttempts(await provider.evaluate(() => window.state.attempts), expected, 'Vimeo re-arms a startup interrupted before play');
   await slide.getByRole('button', { name: 'Pause video', exact: true }).click();
   await slide.getByRole('button', { name: 'Play video', exact: true }).waitFor();
   await scroll.dispatchEvent('scroll');
   await page.waitForTimeout(250); // Pass the Videos scroll-settle window.
   checkAttempts(await provider.evaluate(() => window.state.attempts), expected, 'Settling after Pause keeps Vimeo paused');
  } else if(kind==='twitch'){
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
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,checks,scope:'Real components and MP4 decoding; simulated YouTube, Vimeo, HLS transport and Twitch embed responses. Audio policy simulated deterministically.'},null,2));console.log('PASS '+checks+' autoplay, sound, pause, source-credit and lifecycle checks');
}catch(error){const page=browser?.contexts().at(-1)?.pages().at(-1);if(page){await page.screenshot({path:path.join(output,'failure.png')});console.error(await page.evaluate(()=>({url:location.href,text:document.body.innerText,plays:window.__plays,videos:[...document.querySelectorAll('video')].map(v=>({src:v.currentSrc,paused:v.paused,muted:v.muted,ready:v.readyState,error:v.error?.message}))})));}throw error;}finally{await browser?.close();await server.close();}
