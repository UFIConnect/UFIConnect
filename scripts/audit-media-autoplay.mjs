import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, transformWithOxc } from '../web/node_modules/vite/dist/node/index.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.cache/audit-ui/media-autoplay');await fs.mkdir(output,{recursive:true});
const media=await fs.readFile(path.join(root,'web/public/media/preparation/closing-questions.mp4'));
const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{HelmetProvider}from'react-helmet-async';import{AuthProvider}from'/src/contexts/AuthContext';import{SavedItemsProvider}from'/src/contexts/SavedItemsContext';import{ToastProvider}from'/src/contexts/ToastContext';import SnapRail from'/src/components/SnapRail';import TwitchClipPlayer from'/src/components/TwitchClipPlayer';import{InlineAutoplayVideo,useGlobalMuted}from'/src/components/videoMedia';import{PostCard}from'/src/pages/Feed';import VideoFeedView from'/src/components/VideoFeedView';import'/src/index.css';
const kind=new URLSearchParams(location.search).get('kind'),url='https://media.fixture.invalid/clip.mp4';
const source=kind==='youtube'?'youtube':kind==='twitch'?'twitch':kind==='mastodon'?'mastodon':'uficonnect';
const snaps=[0,1].map(i=>({id:'fixture'+i,source,mediaType:'video',mediaKind:kind==='twitch'?'source':undefined,mediaUrl:kind==='youtube'?'https://www.youtube.com/watch?v=fixture000'+i:kind==='twitch'?'https://clips.twitch.tv/FixtureClip'+i:kind==='hls'?'https://media.fixture.invalid/stream.m3u8':url,sourceUrl:kind==='youtube'?'https://www.youtube.com/watch?v=fixture000'+i:kind==='twitch'?'https://clips.twitch.tv/FixtureClip'+i:kind==='mastodon'?'https://mastodon.social/@fixture/123':'https://uficonnect.org/snaps/fixture'+i,directPlaybackAuthorized:true,videoDurationSeconds:30,caption:'Fixture video '+i,author:{id:'creator',name:'Creator'},createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()}));
function Fixture() {
  const [, toggleSound] = useGlobalMuted();
  if (kind.startsWith('videos-')) return <VideoFeedView />;
  if (kind.startsWith('feed-youtube')) {
    const mediaUrl = 'https://www.youtube.com/watch?v=fixture0000';
    const post = { ...snaps[0], source: 'youtube', isExternal: true, mediaUrl, sourceUrl: mediaUrl, title: 'YouTube feed fixture' };
    return <main style={{ maxWidth: 640, margin: '0 auto' }}>
      <button onClick={toggleSound}>Toggle saved sound</button>
      <div className="feed-continuous-results"><div data-feed-position="0"><PostCard post={post} /></div></div>
    </main>;
  }
  return <>
    {kind === 'vimeo' && <main style={{ maxWidth: 640, margin: '0 auto' }}>
      <PostCard post={{ ...snaps[0], source: 'devto', isExternal: true, mediaUrl: 'https://vimeo.com/123456', title: 'Vimeo feed fixture' }} />
    </main>}
    {kind === 'twitch' && <main style={{ maxWidth: 720, margin: '0 auto' }}><TwitchClipPlayer post={snaps[0]} /></main>}
    {kind === 'inline' && <InlineAutoplayVideo kind="file" src={url} post={snaps[0]} videoKey="inline-fixture" style={{ width: 600, maxWidth: '100%' }} />}
    {kind !== 'inline' && kind !== 'vimeo' && <SnapRail mode="ufi" items={snaps} profile={{ id: 'autoplay-audit' }} />}
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
};
const vimeoCases = {
  'videos-vimeo': { holdMuteAt: 1 },
  'videos-vimeo-mute': { holdMuteAt: 1 },
  'videos-vimeo-unmute': { holdMuteAt: 1, initiallyMuted: true },
  'videos-vimeo-fallback-scroll': { holdMuteAt: 2, policies: [true] },
  'videos-vimeo-scroll-play': { holdPlay: true, policies: [false] },
  'videos-vimeo-pause': { holdMuteAt: 1, policies: [false] },
  'videos-vimeo-switch': { holdMuteAt: 1, policies: [false] },
};
function makeVideoPost(kind, second = false) {
  return {
    id: second ? 'next-slide' : 'slide-fixture', source: 'uficonnect', mediaType: 'video',
    mediaUrl: slideMedia[kind] ?? (second ? 'https://vimeo.com/654321' : 'https://vimeo.com/123456'),
    title: second ? 'Next Videos fixture' : 'Videos fixture', videoDurationSeconds: 30, directPlaybackAuthorized: true,
    author: { id: 'creator', name: 'Creator' }, createdAt: new Date(Date.now() - (second ? 60000 : 0)).toISOString(),
  };
}

function vimeoFixture({ blocked, holdMuteAt, holdPlay }) {
  return `<!doctype html><button>Vimeo controls</button><button id="fullscreen">Full screen</button><script>
    document.getElementById('fullscreen').onclick = () => document.documentElement.requestFullscreen();
    const url = new URL(location.href);
    const state = window.state = {
      playing: false, muted: url.searchParams.get('muted') === '1', blockAudio: ${blocked},
      attempts: [], muteRequests: [], pauses: 0, awaitingMute: false, acknowledgedMute: false,
    };
    addEventListener('message', event => {
      let command;
      try { command = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch { return; }
      if (!command || typeof command !== 'object') return;
      const { method, value } = command;
      const emit = message => parent.postMessage(JSON.stringify(message), event.origin);
      const reply = value => emit({ method, value });
      if (method === 'ping') reply(true);
      else if (method === 'getVideoId') reply(Number(url.pathname.split('/').pop()));
      else if (method === 'getPaused') reply(!state.playing);
      else if (method === 'getMuted') reply(state.muted);
      else if (method === 'getVolume') reply(1);
      else if (method === 'getDuration') reply(30);
      else if (method === 'getCurrentTime') reply(0);
      else if (method === 'setMuted') {
        state.muteRequests.push(value);
        const applyMute = () => {
          state.muted = value;
          reply(value);
          emit({ event: 'volumechange', data: { volume: 1, muted: value } });
        };
        if (state.muteRequests.length === ${holdMuteAt ?? 0}) {
          state.awaitingMute = true;
          window.releaseMute = () => {
            window.releaseMute = undefined;
            state.awaitingMute = false;
            state.acknowledgedMute = true;
            applyMute();
          };
        } else applyMute();
      } else if (method === 'play') {
        state.attempts.push(state.muted);
        const applyPlay = () => {
          if (state.blockAudio && !state.muted) emit({ event: 'error', data: { method, name: 'NotAllowedError' } });
          else {
            state.playing = true;
            reply(true);
            emit({ event: 'play' });
          }
        };
        if (${Boolean(holdPlay)} && state.attempts.length === 1) {
          window.releasePlay = () => {
            window.releasePlay = undefined;
            applyPlay();
          };
        } else {
          applyPlay();
        }
      } else if (method === 'pause') {
        state.pauses++;
        state.playing = false;
        reply(true);
        emit({ event: 'pause' });
        if (state.releaseMuteOnPause) window.releaseMute?.();
      }
    });
    parent.postMessage(JSON.stringify({ event: 'ready' }), '*');
  </script>`;
}

function holdVideoScroll(scroll) {
  return scroll.evaluate(box => {
    const dispatch = () => box.dispatchEvent(new Event('scroll'));
    dispatch();
    return window.setInterval(dispatch, 30);
  });
}

let browser, checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const checkAttempts = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };

async function auditVimeoSlide(page, kind, blocked) {
  const slide = page.locator('[data-post-id="slide-fixture"]');
  const button = name => slide.getByRole('button', { name: `${name} video`, exact: true });
  const scroll = page.locator('[data-video-feed-scroll]');
  await slide.frameLocator('iframe').getByRole('button', { name: 'Vimeo controls' }).waitFor();
  const provider = page.frames().find(frame => frame.url().startsWith('https://player.vimeo.com/video/123456?'));
  const attempts = () => provider.evaluate(() => window.state.attempts);
  const savedSound = () => page.evaluate(() => localStorage.getItem('ufc_wants_sound'));
  const releaseMute = () => provider.evaluate(() => window.releaseMute());

  if (kind === 'videos-vimeo-scroll-play') {
    await provider.waitForFunction(() => typeof window.releasePlay === 'function');
    const previousPauses = await provider.evaluate(() => window.state.pauses);
    const hold = await holdVideoScroll(scroll);
    try {
      await provider.waitForFunction(previous => window.state.pauses > previous, previousPauses);
      const scrollPauses = await provider.evaluate(() => window.state.pauses);
      await provider.evaluate(() => window.releasePlay());
      await provider.waitForFunction(previous => window.state.pauses > previous && !window.state.playing, scrollPauses);
      checkAttempts(await attempts(), [false], 'A late Vimeo play is paused during the scroll hold');
    } finally {
      await page.evaluate(timer => clearInterval(timer), hold);
    }
    await button('Pause').waitFor();
    checkAttempts(await attempts(), [false, false], 'A Vimeo play interrupted by scrolling resumes once');
    return;
  }

  await provider.waitForFunction(() => window.state.awaitingMute);
  if (kind === 'videos-vimeo-mute' || kind === 'videos-vimeo-unmute') {
    const initiallyMuted = kind === 'videos-vimeo-unmute';
    const first = initiallyMuted ? 'Unmute' : 'Mute';
    const second = initiallyMuted ? 'Mute' : 'Unmute';
    await button(first).click();
    check(await savedSound() === (initiallyMuted ? '1' : '0'), 'Vimeo saves a sound choice before the pending mute reply');
    await button(second).click();
    await button(first).click();
    checkAttempts(await provider.evaluate(() => window.state.muteRequests), [initiallyMuted], 'Rapid sound clicks leave only one Vimeo mute request in flight');
    checkAttempts(await attempts(), [], 'Vimeo waits for the delayed mute reply before autoplay');
    await releaseMute();
    await button('Pause').waitFor();

    const expected = initiallyMuted ? (blocked ? [false, true] : [false]) : [true];
    checkAttempts(await attempts(), expected, 'Vimeo starts with the final sound choice and uses one muted retry if required');
    checkAttempts(await provider.evaluate(() => window.state.muteRequests),
      [initiallyMuted, ...expected], 'Vimeo applies the latest queued mute setting without replaying intermediate clicks');
    check(await savedSound() === (initiallyMuted ? '1' : '0'), 'Vimeo autoplay preserves the final saved sound choice');
    const actualMute = !initiallyMuted || blocked;
    await button(actualMute ? 'Unmute' : 'Mute').waitFor();
    check(await provider.evaluate(() => window.state.muted) === actualMute, 'The Vimeo sound control shows the confirmed playback state');
    if (initiallyMuted && blocked) {
      await provider.evaluate(() => { window.state.blockAudio = false; });
      await button('Unmute').click();
      await provider.waitForFunction(() => window.state.playing && !window.state.muted);
      checkAttempts(await attempts(), expected, 'Unmuting a running Vimeo fallback does not issue another play request');
    }
    return;
  }

  if (kind === 'videos-vimeo-pause') {
    await button('Play').click();
    await button('Pause').click();
    await button('Play').waitFor();
    await button('Mute').click();
    await releaseMute();
    await provider.waitForFunction(() => window.state.muted && !window.state.playing);
    await scroll.dispatchEvent('scroll');
    await page.waitForTimeout(250); // Pass the Videos scroll-settle window.
    checkAttempts(await attempts(), [false], 'Manual Pause prevents a pending Vimeo start from resuming');
    check(await savedSound() === '0', 'An explicit sound change is applied and saved while Vimeo is paused');
    await button('Play').click();
    await button('Pause').waitFor();
    checkAttempts(await attempts(), [false, true], 'Manual Play uses the final sound choice after interruption');
    return;
  }

  if (kind === 'videos-vimeo-switch') {
    await button('Mute').click();
    checkAttempts(await attempts(), [], 'The original slide is still awaiting its initial mute reply');
    await scroll.press('PageDown');
    await slide.locator('iframe').waitFor({ state: 'detached' });
    const nextSlide = page.locator('[data-post-id="next-slide"]');
    await nextSlide.getByRole('button', { name: 'Pause video', exact: true }).waitFor();
    const nextProvider = page.frames().find(frame => frame.url().startsWith('https://player.vimeo.com/video/654321?'));
    checkAttempts(await nextProvider.evaluate(() => window.state.attempts), [true], 'Scrolling to a new Vimeo slide carries the saved choice');
    check(provider.isDetached() && await savedSound() === '0', 'The previous iframe is discarded and the new player owns playback');
    return;
  }

  const duringScroll = kind === 'videos-vimeo-fallback-scroll' ? [false] : [];
  await provider.evaluate(() => { window.state.releaseMuteOnPause = true; });
  const hold = await holdVideoScroll(scroll);
  try {
    await provider.waitForFunction(() => window.state.acknowledgedMute);
    checkAttempts(await attempts(), duringScroll, 'Vimeo cannot start or retry while scrolling');
  } finally {
    await page.evaluate(timer => clearInterval(timer), hold);
  }
  await button('Pause').waitFor();
  const expected = [...duringScroll, ...(blocked ? [false, true] : [false])];
  checkAttempts(await attempts(), expected, 'Vimeo re-arms a startup interrupted before play');
  await button('Pause').click();
  await button('Play').waitFor();
  await scroll.dispatchEvent('scroll');
  await page.waitForTimeout(250); // Pass the Videos scroll-settle window.
  checkAttempts(await attempts(), expected, 'Settling after Pause keeps Vimeo paused');
}

try{
 await server.listen();const origin=server.resolvedUrls.local[0];browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,args:['--autoplay-policy=no-user-gesture-required']});
 const kinds = ['file', 'mastodon', 'hls', 'youtube', 'twitch', 'inline', 'vimeo',
   'feed-youtube', 'feed-youtube-muted', 'feed-youtube-blocked', ...Object.keys(slideMedia), ...Object.keys(vimeoCases)];
 for (const kind of kinds) for (const blocked of vimeoCases[kind]?.policies
   ?? (['twitch', 'feed-youtube-muted', 'feed-youtube-blocked'].includes(kind) ? [false] : [false, true])) {
  console.log('Checking autoplay',kind,{blocked});
  const vimeoCase = vimeoCases[kind];
  const delayMetadata = Object.hasOwn(slideMedia, kind);
  const isSlide = delayMetadata || Boolean(vimeoCase);
  const holdSnapMedia = kind === 'file' && !blocked;
  const snapWithFeedMuted = ['file', 'mastodon', 'hls', 'youtube'].includes(kind);
  const metadata = Promise.withResolvers();
  const profile = isSlide ? memberProfile : null;
  const delayYouTube = kind.startsWith('feed-youtube');
  const blockAllYouTube = kind === 'feed-youtube-blocked';
  const viewport = kind === 'feed-youtube-muted' ? { width: 390, height: 844 } : { width: 860, height: 900 };
  const context=await browser.newContext({viewport,serviceWorkers:'block'});const errors=[],writes=[];
  await context.addInitScript(({ blocked, delayYouTube, blockAllYouTube, initiallyMuted }) => {
   if (window !== window.top) return;
   localStorage.setItem('uficonnect.analytics.consent.v1','denied');localStorage.setItem('uficonnect.ads.consent.v1','denied');window.__players=[];window.__plays=[];
   if (initiallyMuted) localStorage.setItem('ufc_wants_sound', '0');
   const play=HTMLMediaElement.prototype.play;
   const canPlayType=HTMLMediaElement.prototype.canPlayType;HTMLMediaElement.prototype.canPlayType=function(type){return type==='application/vnd.apple.mpegurl'?'':canPlayType.call(this,type);};
   HTMLMediaElement.prototype.play=function(){window.__plays.push({muted:this.muted,readyState:this.readyState});if(blocked&&!this.muted&&!window.__allowSnapAudio)return Promise.reject(new DOMException('Fixture audio policy','NotAllowedError'));return play.call(this);};
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
      if (blockAllYouTube || (blocked && !this.muted && !window.__allowSnapAudio)) { this.autoplayBlocked(); return; }
      this.state = 1;
      this.config.events.onStateChange?.({ target: this, data: 1 });
    }
    getIframe(){return this.frame}getVideoData(){return{video_id:this.id}}getDuration(){return 30}getCurrentTime(){return 1}getPlayerState(){return this.state}isMuted(){return this.muted}getVolume(){return this.volume}setVolume(value){this.volume=value}getAvailablePlaybackRates(){return[1]}getPlaybackRate(){return 1}getOptions(){return[]}mute(){this.muted=true}unMute(){this.muted=false}pauseVideo(){this.state=2;this.config.events.onStateChange?.({target:this,data:2})}destroy(){this.state=2;this.frame.remove()}
   }};
  }, { blocked, delayYouTube, blockAllYouTube, initiallyMuted: vimeoCase?.initiallyMuted || (delayMetadata && blocked) || snapWithFeedMuted });
  await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());
   if (url.hostname === 'media.fixture.invalid') {
    if (delayMetadata || holdSnapMedia) await metadata.promise;
    return route.fulfill({ body: media, contentType: 'video/mp4' });
   }
   if (url.hostname === 'vimeo.com' && url.pathname === '/api/oembed.json') return route.fulfill({ json: { duration: 30 } });
   if (url.hostname === 'player.vimeo.com') return route.fulfill({
    contentType: 'text/html', body: vimeoFixture({ blocked, ...(url.pathname === '/video/123456' ? vimeoCase : {}) }),
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
    json: {
     posts: kind === 'videos-vimeo-switch' ? [makeVideoPost(kind), makeVideoPost(kind, true)] : [makeVideoPost(kind)],
     hasMore: false, waitingForNew: true,
    },
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
    const card = page.locator('.post-card');
    const controls = card.getByRole('group', { name: 'Playback controls' });
    const enter = controls.getByRole('button', { name: 'Full screen', exact: true });
    const exit = controls.getByRole('button', { name: 'Exit full screen', exact: true });
    check(await card.getByRole('button', { name: /^(?:View fullscreen|Full screen)$/ }).count() === 1, 'The feed card has one fullscreen button');
    const useFallback = kind === 'feed-youtube-muted';
    if (useFallback) await page.evaluate(() => Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false }));
    await enter.click();
    await exit.waitFor();
    check(await card.locator('iframe').evaluate((frame, fallback) => {
      const player = frame.closest('.feed-youtube-player');
      const { top, height } = frame.getBoundingClientRect();
      const expanded = fallback ? player.dataset.ufiFullscreen === 'true' : document.fullscreenElement === player;
      return expanded && top <= 1 && height >= innerHeight - 60 && window.__players.length === 1;
    }, useFallback), 'Fullscreen expands the existing player and keeps its controls visible');
    await exit.click();
    await enter.waitFor();
    check(await card.locator('iframe').evaluate(frame => !document.fullscreenElement && frame.getBoundingClientRect().height <= 360),
      'Exiting fullscreen restores the feed player size');
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
  } else if (vimeoCase) {
   await auditVimeoSlide(page, kind, blocked);
  } else if(kind==='twitch'){
   const feed=page.locator('main .twitch-clip-player');await feed.locator('iframe').waitFor();let url=new URL(await feed.locator('iframe').getAttribute('src'));
   check(url.searchParams.get('autoplay')==='true'&&url.searchParams.get('muted')==='false','Visible Twitch clip requests autoplay with sound');
   check(await feed.getByRole('link',{name:'Watch on Twitch',exact:true}).isVisible(),'Twitch credit remains visible');
   await feed.getByRole('button',{name:'Close Twitch player',exact:true}).click();await feed.locator('iframe').waitFor({state:'detached'});await page.waitForTimeout(200);check(await feed.locator('iframe').count()===0,'Explicit Close is not overridden by autoplay');
   await page.evaluate(() => localStorage.setItem('ufc_wants_sound', '0'));
   await page.getByRole('button',{name:"View Creator's 2 snaps",exact:true}).click();const snap=page.locator('.snap-viewer .twitch-clip-player');await snap.locator('iframe').waitFor();check(new URL(await snap.locator('iframe').getAttribute('src')).searchParams.get('muted')==='false','Opened Twitch snap requests sound even with the feed muted');
  }else if(kind==='vimeo'){
   const frame=page.frameLocator('iframe');await frame.getByRole('button',{name:'Vimeo controls'}).waitFor();
   await page.waitForFunction(()=>document.querySelector('iframe'));
   const provider=page.frames().find(frame=>frame.url().startsWith('https://player.vimeo.com'));
   await provider.waitForFunction(()=>window.state.playing);
   check(await provider.evaluate(()=>window.state.muted)===blocked,'Vimeo starts with sound or retries a blocked request silently');
   check(JSON.stringify(await provider.evaluate(()=>window.state.attempts))===JSON.stringify(blocked?[false,true]:[false]),'Vimeo uses one audio attempt and at most one silent retry');
   check(await page.locator('.post-card').getByRole('button', { name: /full\s?screen/i }).count() === 0, 'Vimeo has no separate fullscreen button on the card');
   await frame.getByRole('button', { name: 'Full screen', exact: true }).click();
   await page.waitForFunction(() => document.fullscreenElement === document.querySelector('.post-card iframe'));
   await provider.evaluate(() => document.exitFullscreen());
   check(true, 'Vimeo can enter and exit fullscreen within the embedded player');
  }else if(kind==='inline'){
   await page.locator('video').hover();
   await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.readyState>=2;});check(await page.locator('video').evaluate(v=>v.muted)===blocked,'Inline video starts audibly or falls back when blocked');
  }else{
   await page.getByRole('button', { name: "View Creator's 2 snaps", exact: true }).click();
   const viewer = page.getByRole('dialog');
   const play = viewer.getByRole('button', { name: 'Play video', exact: true });
   const pause = viewer.getByRole('button', { name: 'Pause video', exact: true });
   const mute = viewer.getByRole('button', { name: 'Mute video', exact: true });
   const unmute = viewer.getByRole('button', { name: 'Unmute video', exact: true });
   if (holdSnapMedia) {
    await page.waitForFunction(() => window.__plays.length);
    check(await page.evaluate(() => window.__plays[0].readyState) === 0, 'Opening a file Snap requests sound before metadata is available');
    metadata.resolve();
   }
   await page.waitForFunction(provider => (provider === 'youtube' ? window.__players[0]?.attempts : window.__plays)?.length, kind);
   checkAttempts(await page.evaluate(provider => provider === 'youtube' ? window.__players[0].attempts : window.__plays.map(item => item.muted), kind),
    [false], 'Snap autoplay starts with sound even with the feed muted, without a silent retry');
   if (blocked) {
    await play.click({ trial: true });
    check(await mute.isEnabled(), 'Policy-blocked Snap offers Play with sound still selected');
    await page.evaluate(() => { window.__allowSnapAudio = true; });
    await play.click();
   }
   await pause.waitFor();
   await mute.waitFor();
   if (kind !== 'youtube') {
    check(await viewer.locator('video').evaluate(video => !video.paused && !video.muted && video.volume > 0), 'Native player starts with audible output selected');
   }
   if (!blocked) {
    await mute.click();
    await viewer.getByRole('button', { name: 'Next snap', exact: true }).click();
    await pause.waitFor();
    await unmute.waitFor();
    check(await page.evaluate(() => localStorage.getItem('ufc_snap_wants_sound')) === '0', 'An explicit Snap mute carries into the next clip');
    await unmute.click();
    check(await page.evaluate(() => localStorage.getItem('ufc_wants_sound')) === '0', 'Unmuting a Snap keeps the feed muted');
   }
   await viewer.getByRole('button',{name:'Pause video',exact:true}).click();await viewer.getByRole('button',{name:'Play video',exact:true}).waitFor();await page.waitForTimeout(350);check(await viewer.getByRole('button',{name:'Play video',exact:true}).isVisible(),'Explicit pause stays paused');
   await viewer.getByRole('button',{name:'Play video',exact:true}).click();await viewer.getByRole('button',{name:'Pause video',exact:true}).waitFor();
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await viewer.getByRole('button',{name:'Play video',exact:true}).waitFor();check(true,'Backgrounding stops the active snap');
  }
  check(errors.length===0,'No application errors: '+errors.join('; '));check(writes.length===0,'No publication or account write');await context.close();
 }
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify({passed:true,checks,scope:'Real components and MP4 decoding; simulated YouTube, Vimeo, HLS transport and Twitch embed responses. Audio policy simulated deterministically.'},null,2));console.log('PASS '+checks+' autoplay, sound, fullscreen, pause, source-credit and lifecycle checks');
}catch(error){const page=browser?.contexts().at(-1)?.pages().at(-1);if(page){await page.screenshot({path:path.join(output,'failure.png')});console.error(await page.evaluate(()=>({url:location.href,text:document.body.innerText,plays:window.__plays,videos:[...document.querySelectorAll('video')].map(v=>({src:v.currentSrc,paused:v.paused,muted:v.muted,ready:v.readyState,error:v.error?.message}))})));}throw error;}finally{await browser?.close();await server.close();}
