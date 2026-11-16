// Real feed card and Snap viewer, synthetic media/provider responses only.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-twitch-player');
const photo = await fs.readFile(path.join(root, 'web/public/media/preparation/professional-introduction.png'));
const fixture = `import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {HelmetProvider} from 'react-helmet-async';
import {AuthProvider} from '/src/contexts/AuthContext.jsx';
import {ToastProvider} from '/src/contexts/ToastContext.jsx';
import {SavedItemsProvider} from '/src/contexts/SavedItemsContext.jsx';
import {setAccessToken} from '/src/auth/session.js';
import {PostCard} from '/src/pages/Feed.jsx';
import SnapViewer from '/src/components/SnapViewer.jsx';
import '/src/components/SnapRail.css';
import '/src/index.css';
setAccessToken('synthetic-twitch-reader');
const clip = slug => ({id:'twitch_clip_'+slug,source:'twitch',title:'Recent creator clip',caption:'Recent creator clip',content:'A creator shares a recent stream highlight.',
  sourceUrl:'https://clips.twitch.tv/'+slug,mediaUrl:'https://clips.twitch.tv/'+slug,sourceEmbedUrl:'https://untrusted.example/frame',mediaType:'video',mediaKind:'source',
  mediaPoster:'https://clips-media-assets2.twitch.tv/clip-preview.jpg',thumbnailUrl:'https://clips-media-assets2.twitch.tv/clip-preview.jpg',videoDurationSeconds:30,
  isExternal:true,createdAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),
  author:{id:'twitch_creator',name:'Clip creator',profileUrl:'https://www.twitch.tv/creator'},likesCount:0,commentsCount:0});
const post=clip('RealClip-Ab12'),snaps=[post,clip('SecondClip-Cd34'),{...post,id:'photo',source:'mastodon',
  sourceUrl:'https://mastodon.social/@creator/123',mediaType:'image',mediaUrl:post.thumbnailUrl}];
function Fixture(){const [index,setIndex]=useState(null),[paused,setPaused]=useState(true);
 return React.createElement(React.Fragment,null,React.createElement('div',{style:{display:'flex',gap:8,padding:16}},
   React.createElement('button',{onClick:()=>setIndex(0)},'Open clip snap'),React.createElement('button',{onClick:()=>setPaused(value=>!value)},'Toggle feed pause')),
   React.createElement('aside',{className:'mobile-feed-drawer mobile-account-drawer',role:'dialog','aria-modal':true,'aria-hidden':true,'aria-label':'Account and shop'}),
   React.createElement('main',{style:{width:'calc(100% - 32px)',maxWidth:720,margin:'0 auto'}},React.createElement(PostCard,{post,isMediaOpen:paused}),React.createElement('div',{style:{height:1600},'aria-hidden':true})),
   index!==null&&React.createElement(SnapViewer,{items:snaps,index,now:Date.now(),profile:{id:'twitch-reader'},onChange:snap=>setIndex(snaps.indexOf(snap)),onClose:()=>setIndex(null)}));}
createRoot(document.getElementById('root')).render(React.createElement(HelmetProvider,null,React.createElement(BrowserRouter,null,React.createElement(AuthProvider,null,React.createElement(SavedItemsProvider,null,React.createElement(ToastProvider,null,React.createElement(Fixture)))))));`;
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api'),
    'import.meta.env.VITE_AUTH0_DOMAIN': JSON.stringify(''), 'import.meta.env.VITE_AUTH0_CLIENT_ID': JSON.stringify('') },
  plugins: [{ name: 'twitch-player-fixture',
    resolveId(id) { if (id === 'virtual:twitch-player-audit.jsx') return '\0virtual:twitch-player-audit.jsx'; },
    load(id) { if (id === '\0virtual:twitch-player-audit.jsx') return fixture; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (new URL(req.url, 'http://fixture.invalid').pathname !== '/') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body><div id="root"></div><script type="module" src="/@id/virtual:twitch-player-audit.jsx"></script></body></html>'));
    }); },
  }], server: { host: '127.0.0.1', port: 5285, strictPort: false } });
let browser, checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
async function checkCompactPlayer(frame, label) {
  const size = await frame.evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    const stage = element.parentElement.getBoundingClientRect();
    return { x, y, width, height, stageWidth: stage.width, stageHeight: stage.height, layoutWidth: element.clientWidth, layoutHeight: element.clientHeight };
  });
  check(size.width >= 399 && size.height >= 299 && Math.abs(size.width - size.stageWidth) <= 1 && Math.abs(size.height - size.stageHeight) <= 1,
    `${label} fills the stage at the Twitch minimum size: ${JSON.stringify(size)}`);
  check(Math.abs(size.width / size.layoutWidth - 0.8) < 0.01, `${label} draws the embedded controls at 80%: ${JSON.stringify(size)}`);
  return size;
}
try {
  await fs.mkdir(output, { recursive: true });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const [width, height] of [[1440, 950], [390, 844], [320, 568]]) {
    const phone = width < 400;
    const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], embeds = [], prohibited = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname === 'clips-media-assets2.twitch.tv') return route.fulfill({ body: photo, contentType: 'image/png' });
      if (url.hostname === 'clips.twitch.tv' && url.pathname === '/embed' && request.resourceType() === 'document') {
        embeds.push(Object.fromEntries(url.searchParams));
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Twitch clip fixture</title><div style="position:absolute;inset:auto 0 0;display:flex;justify-content:space-between"><button>Play source clip</button><button onclick="document.documentElement.requestFullscreen()">Fullscreen</button></div>' });
      }
      if (url.origin !== new URL(base).origin) {
        if (request.resourceType() !== 'image') prohibited.push({ url: url.href, type: request.resourceType() });
        return route.fulfill({ status: 403, body: 'External requests are disabled.' });
      }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.slice(4);
      if (endpoint === '/profile') return route.fulfill({ json: { id: 'twitch-reader', name: 'Twitch audit', email: 'audit@example.invalid', plan: 'pro', onboardingComplete: false, interests: [], preferences: {}, roleSettings: {} } });
      if (endpoint === '/social/interaction-capabilities') return route.fulfill({ json: { sources: { twitch: { connected: true, like: false, comment: false } } } });
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.fulfill({ json: { posts: [], postIds: [], notifications: [], items: [], sources: {}, hasMore: false } });
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    const feed = page.locator('main .twitch-clip-player');
    const viewport = page.locator('meta[name="viewport"]');
    const originalViewport = await viewport.getAttribute('content');
    await feed.getByRole('link', { name: 'Watch on Twitch', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.twitch-clip-stage img')?.naturalWidth > 0);
    check(await feed.locator('iframe,video').count() === 0 && embeds.length === 0, 'Feed clip starts as a poster without provider or direct media playback');
    check(await feed.locator('.twitch-clip-watermark').innerText() === 'Twitch', 'Feed preserves the source watermark');
    check(await feed.getByRole('link', { name: 'Watch on Twitch', exact: true }).getAttribute('href') === 'https://clips.twitch.tv/RealClip-Ab12', 'Feed source link keeps the canonical clip destination');
    if (!phone) {
      const play = feed.getByRole('button', { name: 'Play Twitch clip', exact: true });
      const start = async () => { await play.click(); await feed.locator('iframe').waitFor(); await page.frameLocator('main .twitch-clip-player iframe').getByRole('button', { name: 'Play source clip', exact: true }).waitFor(); };
      await page.getByRole('button', { name: 'Toggle feed pause', exact: true }).click();
      await feed.locator('iframe').waitFor();
      const frame = feed.locator('iframe'), url = new URL(await frame.getAttribute('src')), bounds = await frame.boundingBox();
      check(url.origin === 'https://clips.twitch.tv' && url.pathname === '/embed' && url.searchParams.get('clip') === 'RealClip-Ab12'
        && url.searchParams.get('parent') === new URL(base).hostname, 'Feed constructs the official embed with the current parent');
      check(bounds.width >= 400 && bounds.height >= 300 && await frame.evaluate(element => getComputedStyle(element).transform) === 'none',
        'Feed iframe keeps its normal controls and satisfies the Twitch minimum player size');
      await page.evaluate(() => window.scrollTo(0, 1400));
      await frame.waitFor({ state: 'detached' });
      await page.evaluate(() => window.scrollTo(0, 0)); await play.waitFor();
      check(await feed.locator('iframe').count() === 0, 'Returning from offscreen requires another play click');
      await start();
      await page.getByRole('button', { name: 'Toggle feed pause', exact: true }).click();
      await frame.waitFor({ state: 'detached' });
      check(await play.isDisabled(), 'Opening or pausing media stops the feed iframe');
      await page.getByRole('button', { name: 'Toggle feed pause', exact: true }).click();
      await start();
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
      await frame.waitFor({ state: 'detached' });
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
      check(await feed.locator('iframe').count() === 0, 'Returning to the page does not restart a hidden-page clip');
      await start();
    } else {
      check(await feed.getByRole('link', { name: 'Play Twitch clip', exact: true }).count() === 1, 'Narrow feed cards link to the hosted official player');
    }
    await page.getByRole('button', { name: 'Open clip snap', exact: true }).click();
    const viewer = page.getByRole('dialog'), snapPlayer = viewer.locator('.twitch-clip-player');
    await viewer.getByRole('link', { name: 'Watch on Twitch', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('main .twitch-clip-player iframe') === null);
    check(await viewer.locator('.snap-viewer-source-details').innerText().then(value => value.includes('Twitch') && value.includes('Recent source clip') && !value.includes('left')), 'External Snap metadata retains source and duration/date semantics');
    const frame = snapPlayer.locator('iframe');
    if (phone) {
      check(await page.locator('.mobile-feed-drawer').evaluate(drawer => drawer.getAttribute('aria-hidden') === 'true' && drawer.getClientRects().length > 0),
        'The closed mobile account drawer stays mounted with a layout box');
    }
    await frame.waitFor();
    if (phone) {
      const commands = viewer.getByRole('group', { name: 'Twitch clip controls', exact: true });
      const drawer = page.locator('.mobile-account-drawer');
      await drawer.evaluate(element => element.setAttribute('aria-hidden', 'false'));
      await frame.waitFor({ state: 'detached' });
      const play = commands.getByRole('button', { name: 'Play Twitch clip', exact: true });
      check(await play.isDisabled(), 'An active dialog stops inline Twitch playback');
      await drawer.evaluate(element => element.setAttribute('aria-hidden', 'true'));
      await page.waitForFunction(() => [...document.querySelectorAll('.snap-viewer-source-controls button')]
        .some(button => button.textContent === 'Play Twitch clip' && !button.disabled));
      check(await frame.count() === 0, 'Dismissing a dialog restores Play without restarting the clip');
      await play.click();
      await frame.waitFor();
      check(await frame.count() === 1, 'Clicking Play Twitch clip reopens the player inside Snaps');
    }
    const provider = page.frameLocator('.snap-viewer .twitch-clip-player iframe');
    const screen = await page.evaluate(() => ({ width: visualViewport.width, height: visualViewport.height }));
    const size = await checkCompactPlayer(frame, `Snap iframe at ${width}px`);
    const scaleX = size.width / size.layoutWidth, scaleY = size.height / size.layoutHeight;
    // Frame-local rectangles are in Twitch's layout pixels. Map them to the rendered Snap.
    const renderedBounds = async name => {
      const bounds = await provider.getByRole('button', { name, exact: true }).evaluate(element => element.getBoundingClientRect().toJSON());
      return { x: size.x + bounds.x * scaleX, y: size.y + bounds.y * scaleY, width: bounds.width * scaleX, height: bounds.height * scaleY };
    };
    const playBounds = await renderedBounds('Play source clip');
    const fullscreenBounds = await renderedBounds('Fullscreen');
    const fits = bounds => bounds && bounds.x >= -1 && bounds.y >= -1
      && bounds.x + bounds.width <= screen.width + 1 && bounds.y + bounds.height <= screen.height + 1;
    check(fits(playBounds) && fits(fullscreenBounds), `Both ends of Twitch’s controls fit at ${width}px: ${JSON.stringify({ playBounds, fullscreenBounds, screen })}`);
    const fittedViewport = await viewport.getAttribute('content');
    check(fittedViewport.includes('viewport-fit=cover') && (phone ? fittedViewport.startsWith('width=400,') : fittedViewport === originalViewport),
      'Only narrow phone Snaps use a wider CSS viewport and retain safe areas');
    const close = viewer.getByRole('button', { name: 'Close snap', exact: true });
    const exitSize = await close.evaluate(button => ({ width: button.offsetWidth, height: button.offsetHeight,
      iconWidth: button.querySelector('.snap-viewer-close-icon').offsetWidth }));
    check(exitSize.width === 44 && exitSize.height === 44 && exitSize.iconWidth === 28, 'The exit X has a compact visual and a full tap area');
    if (!phone) {
      await page.mouse.click(fullscreenBounds.x + fullscreenBounds.width / 2, fullscreenBounds.y + fullscreenBounds.height / 2);
      await page.waitForFunction(() => document.fullscreenElement?.matches('.twitch-clip-stage > iframe'));
      check(await frame.evaluate(element => getComputedStyle(element).transform) === 'none', 'Twitch controls use their normal size in fullscreen');
      await page.evaluate(() => document.exitFullscreen());
      await checkCompactPlayer(frame, 'Snap iframe after exiting fullscreen');
    }
    await page.screenshot({ path: path.join(output, `snap-${width}.png`) });
    await viewer.getByRole('button', { name: 'Next snap', exact: true }).dispatchEvent('click');
    await page.waitForFunction(() => document.querySelector('.snap-viewer .twitch-clip-stage > iframe')?.src.includes('SecondClip-Cd34'));
    check(await frame.count() === 1 && await viewport.getAttribute('content') === fittedViewport, 'Another Twitch clip keeps the viewport and loads only its own iframe');
    await viewer.getByRole('button', { name: 'Next snap', exact: true }).dispatchEvent('click');
    await frame.waitFor({ state: 'detached' });
    check(await viewport.getAttribute('content') === originalViewport, 'Leaving Twitch restores the original viewport');
    await close.click();
    await viewer.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Open clip snap', exact: true }).click();
    await frame.waitFor();
    await close.click();
    await viewer.waitFor({ state: 'detached' });
    check(await viewport.getAttribute('content') === originalViewport && await page.locator('.twitch-clip-player iframe').count() === 0, 'Closing the Snap restores the viewport and stops its playback');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Feed and Snap layout fit the viewport');

    await page.goto(base + 'twitch-player.html?clip=RealClip-Ab12', { waitUntil: 'domcontentloaded' });
    const hosted = page.locator('#player > iframe');
    await hosted.waitFor();
    await checkCompactPlayer(hosted, `Hosted iframe at ${width}px`);
    async function changeVisibility(hidden) {
      await page.evaluate(value => {
        Object.defineProperty(document, 'hidden', { configurable: true, value });
        document.dispatchEvent(new Event('visibilitychange'));
      }, hidden);
    }
    await changeVisibility(true);
    await hosted.waitFor({ state: 'detached' });
    await changeVisibility(false);
    await hosted.waitFor();
    check(new URL(await hosted.getAttribute('src')).searchParams.get('autoplay') === 'false', 'The hosted player restores its controls on return with playback ready for a tap');
    check(prohibited.length === 0, `No arbitrary frame, media or provider requests: ${JSON.stringify(prohibited)}`);
    check(errors.length === 0, `No browser errors: ${errors.join(', ')}`);
    await context.close();
  }
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify({ checks, widths: [1440, 390, 320], passed: true }, null, 2));
  console.log(JSON.stringify({ checks, passed: true, output: path.relative(root, output) }));
} finally { await browser?.close(); await server.close(); }
