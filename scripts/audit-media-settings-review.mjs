// Actual components/hooks; isolated provider fixtures. Never contacts a real account/provider.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, transformWithOxc } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/media-clean-review-20261011/settings');
const fixture = `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import YouTubeSettingsDialog from '/src/components/YouTubeSettingsDialog.jsx';
import MediaPlaybackControls from '/src/components/MediaPlaybackControls.jsx';
import useYouTubeSnapPlayback from '/src/hooks/useYouTubeSnapPlayback.js';
import '/src/index.css';
window.__calls=[];
function HookFixture(){const[which,setWhich]=useState(1),[account,setAccount]=useState('a'),[enabled,setEnabled]=useState(true),[forcePause,setForcePause]=useState(false);
 const controls=useYouTubeSnapPlayback({enabled,forcePause,mediaKey:account+':'+which,videoId:which===1?'settings001':'settings002',title:'Fixture clip'});
 window.__controls=controls; window.__setWhich=setWhich; window.__setAccount=setAccount; window.__setEnabled=setEnabled; window.__forcePause=setForcePause;
 return <section><div ref={controls.hostRef} style={{width:320,height:320}}/><output id="hook-state">{JSON.stringify({...controls,hostRef:undefined})}</output></section>;}
function Fixture(){const[open,setOpen]=useState(false),[variant,setVariant]=useState('full'),[settings,setSettings]=useState({ready:true,rates:[2,1,1.5,1,-1,NaN],rate:1,captionFontSize:0,captionTracks:[{value:'en',label:'English'}],captionTrack:'off',qualities:[{value:'auto',label:'Auto'},{value:'720p',label:'720p'}],quality:'auto'}),[media,setMedia]=useState('one');
 window.__variant=value=>{setVariant(value);setOpen(true)}; window.__media=setMedia;
 const command=(field)=>value=>{window.__calls.push([field,value]);if(variant==='reject')return false;if(variant==='throw')throw new Error('fixture rejection');if(variant==='pending')return new Promise(resolve=>window.__resolveSetting=()=>{setSettings(old=>({...old,[field]:value}));resolve(true)});setSettings(old=>({...old,[field]:value}));return true};
 return <main style={{padding:16,maxWidth:720}}><button id="open" onClick={()=>setOpen(true)}>Open player settings</button>
 <MediaPlaybackControls mediaKey={media} currentTime={0} duration={30} paused={true} muted={true} onTogglePlay={()=>{}} onToggleMute={()=>{}} onSeek={value=>window.__calls.push(['seek',value])}/>
 <HookFixture/>{open&&<YouTubeSettingsDialog title="Player settings" provider={variant==='source'?'source':variant==='youtube'?'youtube':'native'} sourceLabel={variant==='source'?'Twitch':'Vimeo'} settings={variant==='loading'?{...settings,ready:false}:settings}
 onRateChange={variant==='missing'||variant==='source'?undefined:command('rate')} onCaptionSizeChange={variant==='missing'||variant==='source'?undefined:command('captionFontSize')}
 onCaptionTrackChange={variant==='missing'||variant==='source'||variant==='youtube'?undefined:command('captionTrack')} onQualityChange={variant==='missing'||variant==='source'||variant==='youtube'?undefined:command('quality')}
 onOpenSource={()=>window.__calls.push(['source'])} onClose={()=>setOpen(false)}/>}</main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);`;
const server = await createServer({ root: path.join(root, 'web'), envDir: false,
  cacheDir: path.join(root, '.cache/audit-vite-media-settings'),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  plugins: [{ name: 'media-settings-audit', resolveId(id) { if (id === 'virtual:media-settings-audit.jsx') return '\0virtual:media-settings-audit.jsx'; },
    async load(id) { if (id === '\0virtual:media-settings-audit.jsx') return (await transformWithOxc(fixture,'media-settings-audit.jsx',{jsx:{runtime:'automatic'}})).code; },
    configureServer(vite) { vite.middlewares.use(async (req,res,next) => {
      if (new URL(req.url,'http://fixture.invalid').pathname !== '/') return next();
      res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(req.url,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:media-settings-audit.jsx"></script></body></html>'));
    }); },
  }], server: { host:'127.0.0.1',port:0,hmr:false,watch:null } });
let browser;
const checks=[];
function check(value,label){assert.ok(value,label);checks.push(label);}
try {
  await fs.mkdir(output,{recursive:true});await server.listen();const origin=server.resolvedUrls.local[0];
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined});
  for (const width of [320,390,820,1440]) {
    const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(12000);
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.__players=[];
      window.YT={Player:class{
        constructor(frame,config){this.frame=frame;this.config=config;this.id=new URL(frame.src).pathname.split('/').pop();this.rate=1;this.caption=0;this.state=-1;this.calls=[];window.__players.push(this);if(!window.__delayReady)setTimeout(()=>this.ready(),10);}
        ready(){this.config.events?.onReady?.({target:this})}getVideoData(){return{video_id:this.id}}getPlayerState(){return this.state}getCurrentTime(){return 0}getDuration(){return 30}isMuted(){return true}getVolume(){return 100}
        getAvailablePlaybackRates(){return[1,1.5,2]}getPlaybackRate(){return this.rate}getOptions(){return this.captionAvailable===false?[]:['fontSize']}getOption(){return this.caption}
        setPlaybackRate(rate){this.calls.push(['rate',rate]);if(this.reject)throw new Error('fixture rejected');this.rate=rate;this.config.events?.onPlaybackRateChange?.({target:this})}
        setOption(module,name,size){this.calls.push(['caption',size]);if(this.reject)throw new Error('fixture rejected');this.caption=size;this.config.events?.onApiChange?.({target:this})}
        pauseVideo(){this.calls.push(['pause']);this.state=2}playVideo(){this.calls.push(['play']);this.state=1}mute(){this.calls.push(['mute'])}unMute(){this.calls.push(['unmute'])}setVolume(v){this.calls.push(['volume',v])}seekTo(v){this.calls.push(['seek',v])}cueVideoById(v){this.calls.push(['cue',v])}destroy(){this.destroyed=true;this.frame.remove()}
      }};
    });
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin===new URL(origin).origin)return route.continue();
      if(['www.youtube.com','www.youtube-nocookie.com'].includes(url.hostname)&&route.request().resourceType()==='document')return route.fulfill({contentType:'text/html',body:'<!doctype html><button>Required provider UI</button>'});
      return route.fulfill({status:403,body:'External calls blocked'});
    });
    await page.goto(origin);await page.waitForFunction(()=>window.__controls?.ready);
    await page.locator('#open').click();let dialog=page.getByRole('dialog',{name:'Player settings',exact:true});await dialog.waitFor();
    check(await dialog.getByRole('radiogroup',{name:'Playback speed',exact:true}).getByRole('radio').count()===3,`${width}: supported rates are unique and valid`);
    await dialog.getByRole('radiogroup',{name:'Playback speed',exact:true}).getByRole('radio',{name:'1.5×',exact:true}).click();
    await page.waitForFunction(()=>window.__calls.some(c=>c[0]==='rate'&&c[1]===1.5));
    check(await dialog.getByRole('radio',{name:'1.5×',exact:true}).getAttribute('aria-checked')==='true',`${width}: rate reflects accepted callback state`);
    await dialog.getByRole('radiogroup',{name:'Captions',exact:true}).getByRole('radio',{name:'English',exact:true}).click();
    await dialog.getByRole('radiogroup',{name:'Video quality',exact:true}).getByRole('radio',{name:'720p',exact:true}).click();
    check(await page.evaluate(()=>window.__calls.some(c=>c[0]==='captionTrack'&&c[1]==='en')&&window.__calls.some(c=>c[0]==='quality'&&c[1]==='720p')),`${width}: captions and quality use actual callbacks`);
    const bounds=await dialog.boundingBox();check(bounds.x>=-1&&bounds.x+bounds.width<=width+1,`${width}: settings fit viewport`);
    check(await dialog.getByRole('radio',{name:'Default',exact:true}).evaluate(e=>{const r=document.createRange();r.selectNodeContents(e);return r.getClientRects().length===1&&e.scrollWidth<=e.clientWidth}),`${width}: short caption-size labels stay on one line without clipping`);
    await page.screenshot({path:path.join(output,`settings-${width}.png`)});
    await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});check(await page.locator('#open').evaluate(e=>e===document.activeElement),`${width}: Escape restores trigger focus`);
    await page.evaluate(()=>window.__variant('missing'));await dialog.waitFor();check(await dialog.getByRole('radiogroup').count()===0,`${width}: no callback means no unsupported setting control`);await page.keyboard.press('Escape');
    await page.evaluate(()=>window.__variant('source'));await dialog.waitFor();check(await dialog.getByRole('radiogroup').count()===0,`${width}: source-only provider has no fake player settings`);await dialog.getByRole('button',{name:'Open on Twitch',exact:true}).click();check(await page.evaluate(()=>window.__calls.some(c=>c[0]==='source')),`${width}: source action works`);await page.keyboard.press('Escape');
    for(const variant of ['reject','throw']){await page.evaluate(value=>window.__variant(value),variant);await dialog.waitFor();await dialog.getByRole('radio',{name:'2×',exact:true}).click();await dialog.getByRole('alert').waitFor();check(await dialog.getByRole('radio',{name:'1.5×',exact:true}).getAttribute('aria-checked')==='true',`${width}: ${variant} reports failure without optimistic success`);await page.keyboard.press('Escape');}
    await page.evaluate(()=>window.__variant('pending'));await dialog.waitFor();await dialog.getByRole('radio',{name:'2×',exact:true}).click();check(await dialog.getByRole('radio',{name:'1×',exact:true}).isDisabled(),`${width}: pending operation disables concurrent setting commands`);await page.evaluate(()=>window.__resolveSetting());await page.waitForFunction(()=>document.querySelector('[role="radio"][aria-label="2×"]')?.getAttribute('aria-checked')==='true');await page.keyboard.press('Escape');
    await page.evaluate(()=>window.__variant('loading'));await dialog.waitFor();check(await dialog.getByRole('radio',{name:'1×',exact:true}).isDisabled(),`${width}: unready player cannot receive setting commands`);await page.keyboard.press('Escape');
    await page.evaluate(()=>window.__variant('youtube'));await dialog.waitFor();check(await dialog.getByRole('radiogroup',{name:'Video quality',exact:true}).count()===0&&await dialog.getByRole('radiogroup',{name:'Captions',exact:true}).count()===0,`${width}: YouTube does not invent unsupported quality/caption-track controls`);await page.keyboard.press('Escape');
    check(await page.evaluate(()=>window.__controls.setPlaybackRate(1.5)&&window.__controls.setCaptionFontSize(2)),`${width}: ready YouTube Snap supports advertised speed and caption size`);
    await page.waitForFunction(()=>window.__controls.settings.rate===1.5&&window.__controls.settings.captionFontSize===2);
    await page.evaluate(()=>window.__controls.togglePlay());await page.waitForFunction(()=>window.__players.at(-1).state===1);
    await page.evaluate(()=>window.__forcePause(true));await page.waitForFunction(()=>window.__players.at(-1).state===2);
    check(await page.evaluate(()=>{const p=window.__players.at(-1),n=p.calls.length;window.__controls.togglePlay();window.__controls.seek(5);return p.calls.length===n}),`${width}: open settings/options pause Snap and block playback/seek behind modal`);
    await page.evaluate(()=>window.__forcePause(false));await page.waitForTimeout(50);check(await page.evaluate(()=>window.__players.at(-1).state===2),`${width}: closing settings does not auto-resume external Snap`);
    await page.evaluate(()=>{window.__controls.togglePlay();Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
    await page.waitForFunction(()=>window.__players.at(-1).state===2);
    check(await page.evaluate(()=>{const p=window.__players.at(-1),n=p.calls.length;window.__controls.togglePlay();window.__controls.seek(5);return p.calls.length===n}),`${width}: hidden document pauses and blocks external Snap playback`);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});check(await page.evaluate(()=>window.__players.at(-1).state===2),`${width}: visibility restoration does not autoplay external Snap`);
    check(await page.evaluate(()=>!window.__controls.setPlaybackRate(4)&&!window.__controls.setCaptionFontSize(20)),`${width}: unsupported YouTube settings rejected`);
    await page.evaluate(()=>{window.__oldControls=window.__controls;window.__oldPlayer=window.__players.at(-1);window.__delayReady=true;window.__setWhich(2)});
    await page.waitForFunction(()=>window.__players.length===2);
    check(await page.evaluate(()=>!window.__controls.ready&&!window.__oldControls.setPlaybackRate(2)&&!window.__oldControls.setCaptionFontSize(1)&&window.__oldPlayer.destroyed),`${width}: changed Snap rejects stale callbacks and destroys old owner`);
    check(await page.evaluate(()=>{const p=window.__players.at(-1),n=p.calls.length;window.__oldControls.togglePlay();window.__oldControls.toggleMute();window.__oldControls.seek(5);return p.calls.length===n}),`${width}: stale play/mute/seek cannot reach a replacement Snap`);
    await page.evaluate(()=>{window.__oldPlayer.ready();window.__oldPlayer.config.events.onApiChange()});
    check(await page.evaluate(()=>!window.__controls.ready),`${width}: delayed previous-player events cannot restore old state`);
    await page.evaluate(()=>window.__players.at(-1).ready());await page.waitForFunction(()=>window.__controls.ready);
    await page.evaluate(()=>{const p=window.__players.at(-1);p.captionAvailable=false;p.config.events.onApiChange()});await page.waitForFunction(()=>window.__controls.settings.captionFontSize===null);check(await page.evaluate(()=>!window.__controls.setCaptionFontSize(1)),`${width}: absent caption module exposes no caption-size command`);
    await page.evaluate(()=>{const p=window.__players.at(-1);p.captionAvailable=true;p.config.events.onApiChange()});
    await page.evaluate(()=>{window.__oldControls=window.__controls;window.__setAccount('b')});await page.waitForFunction(()=>window.__players.length===3);
    check(await page.evaluate(()=>!window.__controls.ready&&!window.__oldControls.setPlaybackRate(2)),`${width}: account change invalidates cached settings commands`);
    await page.evaluate(()=>window.__players.at(-1).ready());await page.waitForFunction(()=>window.__controls.ready);
    await page.evaluate(()=>{window.__players.at(-1).reject=true});check(await page.evaluate(()=>!window.__controls.setPlaybackRate(2)&&!window.__controls.setCaptionFontSize(1)),`${width}: provider rejection is returned to settings UI`);
    await page.evaluate(()=>{window.__players.at(-1).id='otherclip01'});check(await page.evaluate(()=>!window.__controls.setPlaybackRate(2)),`${width}: wrong provider video identity is rejected`);
    const progress=page.getByRole('slider',{name:'Video progress',exact:true});await progress.evaluate(e=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'20');e.dispatchEvent(new Event('input',{bubbles:true}))});await page.waitForFunction(()=>document.querySelector('input[type="range"]').value==='20');await page.evaluate(()=>window.__media('two'));await page.waitForFunction(()=>document.querySelector('input[type="range"]').value==='0');check(true,`${width}: new media clears the previous optimistic seek value`);
    check(errors.length===0,`${width}: no browser exceptions`);await context.close();
  }
  await fs.writeFile(path.join(output,'summary.json'),JSON.stringify({passed:true,checks,widths:[320,390,820,1440],provenance:'Current actual React components/hooks with synthetic callbacks and YouTube API; no live provider playback or physical-device claim.'},null,2));
  console.log(JSON.stringify({passed:true,checks:checks.length,output}));
}finally{await browser?.close();await server.close();}
