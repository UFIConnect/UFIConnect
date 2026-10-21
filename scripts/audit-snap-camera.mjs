// Isolated real Snap UI, real Chromium fake-device capture, and intercepted APIs.
// No account, upload service, or production API is contacted by this audit.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer, transformWithOxc } from '../web/node_modules/vite/dist/node/index.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.env.SNAP_QA_ROOT || repository);
const output = path.resolve(process.env.SNAP_QA_OUTPUT || path.join(root, '.cache/snap-camera-qa'));
const photoFile = path.join(root, 'web/public/media/preparation/professional-introduction.png');
const videoFile = path.join(root, 'web/public/media/preparation/closing-questions.mp4');
const photo = await fs.readFile(photoFile), video = await fs.readFile(videoFile);
const sourceHashes = Object.fromEntries(await Promise.all(['web/src/utils/mediaPermissions.mjs', 'web/src/components/MediaPermissionPrompt.jsx', 'web/src/components/MediaPermissionPrompt.css', 'web/src/hooks/useSnapCamera.js', 'web/src/components/SnapComposer.jsx', 'web/src/components/SnapRail.jsx', 'web/src/components/SnapRail.css', 'scripts/audit-snap-camera.mjs'].map(async file => [file, crypto.createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex')])));
const fixture = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{BrowserRouter}from'react-router-dom';import{ToastProvider}from'/src/contexts/ToastContext';
import{SavedItemsProvider}from'/src/contexts/SavedItemsContext';import SnapRail from'/src/components/SnapRail.jsx';
import client from'/src/api/client';import{configureNativeRuntime}from'/src/nativeRuntime.mjs';
import MediaPermissionPrompt from'/src/components/MediaPermissionPrompt.jsx';import{saveMediaPermission,readMediaPermissions}from'/src/utils/mediaPermissions.mjs';
import'/src/index.css';import'/src/PublicTheme.css';
window.__profile={id:'fixture-member',name:'Fixture Member'};
window.__saveChoice=saveMediaPermission;window.__readChoices=readMediaPermissions;
if(new URLSearchParams(location.search).has('native'))configureNativeRuntime({nativePlatform:new URLSearchParams(location.search).get('native'),onApiRequest:async()=>({status:200,data:{postIds:[],jobs:[]},headers:{}})});
function Fixture(){const[items,setItems]=useState(Array.from({length:7},(_,i)=>({id:'fixture-'+i,source:'uficonnect',mediaType:'image',mediaUrl:'https://media.fixture.invalid/photo.png',author:{id:'creator-'+i,name:'Creator '+i},caption:'An existing snap',createdAt:new Date(Date.now()-i*1000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()})));const[mounted,setMounted]=useState(true),[profile,setProfile]=useState(window.__profile);
window.__changeAccount=id=>{window.__profile={id,name:id};setProfile(window.__profile)};
window.__unmountRail=()=>setMounted(false);window.__reloadSnaps=async()=>setItems((await client.get('/snaps')).data.snaps);
return <ToastProvider><SavedItemsProvider><main style={{maxWidth:720,margin:'0 auto',padding:12}}>{mounted&&<SnapRail mode="ufi" items={items} profile={profile} onRefresh={async()=>{}} onPostSnap={async payload=>{const{data}=await client.post('/snaps',payload);setItems(rows=>[data.snap,...rows]);return data.snap}}/>}<MediaPermissionPrompt accountId={profile.id}/></main></SavedItemsProvider></ToastProvider>}
createRoot(document.getElementById('root')).render(<BrowserRouter><Fixture/></BrowserRouter>);`;

const server = await createServer({ root: path.join(root, 'web'), envDir: false,
  cacheDir: path.join(output, 'vite'),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  plugins: [{ name: 'snap-camera-fixture', enforce: 'pre', resolveId(id) {
    if (/contexts\/AuthContext(?:\.jsx)?$/.test(id) || id === './AuthContext') return '\0fixture-auth';
    if (id === 'virtual:snap-camera.jsx') return '\0virtual:snap-camera.jsx';
  }, async load(id) {
    if (id === '\0fixture-auth') return `export function useAuth(){return{profile:window.__profile,token:'fixture'}}`;
    if (id === '\0virtual:snap-camera.jsx') return (await transformWithOxc(fixture, 'snap-camera.jsx', { jsx: { runtime: 'automatic' } })).code;
  }, configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (new URL(req.url, 'http://fixture.invalid').pathname !== '/') return next();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)');
    res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/appearance.css"></head><body class="guest-shell"><div id="root"></div><script type="module" src="/@id/virtual:snap-camera.jsx"></script></body></html>'));
  }); } }], server: { host: '127.0.0.1', port: 0, hmr: false, watch: null,
    headers: { 'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(self)' } } });
const checks = [], screenshots = [], failures = [];
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };
let browser, origin;

async function openFixture({ width = 390, theme = 'light', native = '', denied = false, cameraChoice = 'allow', photosChoice = 'allow' } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', colorScheme: theme });
  // Chromium's permission override denies permissions outside this list.
  await context.grantPermissions(denied ? [] : ['camera', 'microphone'], { origin });
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  const state = { context, page, errors: [], blocked: [], writes: [], uploads: [], signatures: 0, published: [], failPublish: false };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(({ theme, cameraChoice, photosChoice }) => {
    if (!localStorage.getItem('ufi:media-permissions:v1:fixture-member')) localStorage.setItem('ufi:media-permissions:v1:fixture-member', JSON.stringify({ camera: cameraChoice, photos: photosChoice }));
    window.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.theme = theme; });
    window.__permissionRequests = [];
    window.addEventListener('ufi-media-permission-request', event => window.__permissionRequests.push(event.detail));
    window.__cameraStreams = []; window.__cameraRequests = []; window.__nativeClicks = []; window.__trackStops = [];
    const stopTrack = MediaStreamTrack.prototype.stop;
    MediaStreamTrack.prototype.stop = function () { window.__trackStops.push({ kind: this.kind, stack: new Error().stack }); return stopTrack.call(this); };
    window.__createdUrls = []; window.__revokedUrls = []; window.__pendingCapture = false;
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.__cameraRequests.push(constraints);
      const capture = await getUserMedia(constraints);
      window.__cameraStreams.push(capture);
      if (window.__pendingCapture) await new Promise(resolve => { window.__releaseCapture = resolve; });
      return capture;
    };
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = value => { const url = create(value); window.__createdUrls.push({ url, size: value.size, type: value.type }); return url; };
    URL.revokeObjectURL = url => { window.__revokedUrls.push(url); return revoke(url); };
    // The original trusted event must still be dispatching when input.click runs.
    // A microtask marker is unsuitable: browsers checkpoint between DOM listeners.
    let trustedEvent = null;
    document.addEventListener('click', event => { if (event.isTrusted) trustedEvent = event; }, true);
    const click = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') window.__nativeClicks.push({ accept: this.accept, capture: this.getAttribute('capture'), trustedClick: !!trustedEvent?.eventPhase, active: navigator.userActivation.isActive });
      return click.call(this);
    };
    window.__setHidden = value => {
      Object.defineProperty(document, 'hidden', { configurable: true, value });
      document.dispatchEvent(new Event('visibilitychange'));
    };
  }, { theme, cameraChoice, photosChoice });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data), headers: { 'access-control-allow-origin': '*' } });
    if (url.hostname === 'api.cloudinary.com') {
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': '*' } });
      const bytes = request.postDataBuffer();
      const isVideo = /Content-Type: video\//i.test(bytes.toString('latin1'));
      state.uploads.push({ bytes: bytes.length, isVideo });
      return json({ secure_url: `https://media.fixture.invalid/${isVideo ? 'clip.mp4' : 'photo.png'}`, resource_type: isVideo ? 'video' : 'image', public_id: 'snaps/fixture', version: 1, signature: 'fixture-proof' });
    }
    if (url.hostname === 'media.fixture.invalid') return route.fulfill({ contentType: url.pathname.endsWith('.mp4') ? 'video/mp4' : 'image/png', body: url.pathname.endsWith('.mp4') ? video : photo });
    if (url.hostname === 'thirdparty.fixture.invalid') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Third party policy fixture</title><p>Isolated frame</p>' });
    if (url.origin === new URL(origin).origin && url.pathname.startsWith('/api/')) {
      const endpoint = url.pathname.slice(4);
      if (!['GET', 'HEAD'].includes(method)) state.writes.push({ endpoint, method, body: request.postDataJSON() });
      if (endpoint === '/media/upload-signature') { state.signatures++; return json({ cloudName: 'fixture', apiKey: 'fixture', timestamp: 1, signature: 'fixture', folder: 'snaps', publicId: 'snaps/fixture' }); }
      if (endpoint === '/snaps' && method === 'POST') {
        if (state.failPublish) return json({ message: 'Fixture post failed; your draft is retained.' }, 503);
        const snap = { ...request.postDataJSON(), id: `snap_00000000-0000-4000-8000-${String(state.published.length + 1).padStart(12, '0')}`, source: 'uficonnect', author: { id: 'fixture-member', name: 'Fixture Member' }, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
        state.published.push(snap); return json({ snap });
      }
      if (endpoint === '/snaps') return json({ snaps: state.published });
      if (endpoint === '/saved/posts') return json({ postIds: [] });
      if (endpoint === '/jobs/tracking') return json({ jobs: [] });
      if (endpoint.endsWith('/engagement')) return json({ likesCount: 0, commentsCount: 0, likedByMe: false });
      if (endpoint === '/social/interaction-capabilities') return json({ sources: {} });
      if (endpoint.includes('playback-status')) return json({});
      state.blocked.push(method + ' ' + endpoint); return json({}, 403);
    }
    if (url.origin === new URL(origin).origin) return route.continue();
    state.blocked.push(method + ' ' + url.origin + url.pathname);
    return route.fulfill({ status: 403, body: 'External call blocked by Snap audit' });
  });
  await page.goto(origin + (native ? `?native=${native}` : ''), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.getByRole('button', { name: /Post snap.*open camera/ }).waitFor();
  return state;
}
const composer = page => page.getByRole('dialog', { name: 'Post a snap', exact: true });
const button = (page, name) => composer(page).getByRole('button', { name, exact: true });
async function assertFullscreenCamera(page) {
  const dimensions = await composer(page).evaluate(element => {
    const frame = element.querySelector('.snap-composer-media').getBoundingClientRect();
    const dialog = element.getBoundingClientRect();
    const controls = element.querySelector('.snap-camera-actions').getBoundingClientRect();
    return { frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
      dialog: { x: dialog.x, y: dialog.y, width: dialog.width, height: dialog.height },
      controls: { top: controls.top, bottom: controls.bottom, left: controls.left, right: controls.right },
      width: innerWidth, height: innerHeight, fullscreen: Boolean(document.fullscreenElement) };
  });
  for (const [name, box] of [['dialog', dimensions.dialog], ['camera preview', dimensions.frame]]) {
    check(Math.abs(box.x) <= 1 && Math.abs(box.y) <= 1 && Math.abs(box.width - dimensions.width) <= 1
      && Math.abs(box.height - dimensions.height) <= 1, 'camera fullscreen: ' + name + ' fills the viewport');
  }
  check(!dimensions.fullscreen, 'camera fullscreen: opening capture does not require the browser Fullscreen API');
  check(dimensions.controls.top >= 0 && dimensions.controls.bottom <= dimensions.height + 1
    && dimensions.controls.left >= 0 && dimensions.controls.right <= dimensions.width + 1,
  'camera fullscreen: capture and exit controls stay within the viewport');
  check(await button(page, 'Close camera').isVisible() && await button(page, 'Close snap composer').isVisible(),
    'camera fullscreen: camera exit and composer close remain available');
  check(await button(page, 'Photo').isVisible() && await button(page, 'Video').isVisible() && await button(page, 'Gallery').isVisible(),
    'camera fullscreen: capture mode and gallery remain available');
  check(!await composer(page).getByLabel('Description (optional)', { exact: true }).isVisible(),
    'camera fullscreen: draft editing does not shrink the live preview');
}
async function openCamera(page) {
  await page.getByRole('button', { name: /Post snap.*open camera/ }).click();
  await page.waitForFunction(() => document.querySelector('.snap-camera-preview')?.readyState >= 2 && ![...document.querySelectorAll('.snap-camera-actions button')][0]?.disabled);
  await assertFullscreenCamera(page);
}
async function allStopped(page) { await page.waitForFunction(() => window.__cameraStreams.length && window.__cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))); }
async function noLeaks(state, label) {
  await state.page.evaluate(() => window.__unmountRail());
  await state.page.waitForFunction(() => window.__createdUrls.every(({ url }) => window.__revokedUrls.includes(url)) && window.__cameraStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')));
  check(state.errors.length === 0, `${label}: no uncaught browser errors (${state.errors.join('; ')})`);
  check(state.blocked.length === 0, `${label}: no unexpected network requests (${state.blocked.join('; ')})`);
  check(true, `${label}: all media tracks stopped and draft object URLs revoked`);
  await state.context.close();
}
async function scenario(name, run, { denyCamera = false } = {}) {
  if (process.env.SNAP_QA_MATCH && !name.includes(process.env.SNAP_QA_MATCH)) return;
  browser = await chromium.launch({ channel: process.env.SNAP_QA_BROWSER || undefined,
    args: ['--use-fake-device-for-media-stream', `--use-fake-ui-for-media-stream${denyCamera ? '=deny' : ''}`, '--autoplay-policy=no-user-gesture-required'] });
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) {
    const page = browser.contexts().at(-1)?.pages().at(-1);
    const diagnostic = await page?.evaluate(() => ({ text: document.body.innerText, cameraRequests: window.__cameraRequests,
      streams: window.__cameraStreams?.map(stream => stream.getTracks().map(track => ({ kind: track.kind, state: track.readyState }))),
      urls: window.__createdUrls, revoked: window.__revokedUrls, trackStops: window.__trackStops, nativeClicks: window.__nativeClicks,
      preview: [...document.querySelectorAll('video')].map(video => ({ width: video.videoWidth, height: video.videoHeight, readyState: video.readyState, paused: video.paused, error: video.error?.message })) })).catch(() => null);
    failures.push({ scenario: name, error: error.stack, diagnostic }); console.error(`FAIL ${name}: ${error.stack}`);
    if (page) await page.screenshot({ path: path.join(output, `failure-${failures.length}.png`) }).catch(() => {});
  }
  finally { await browser.close(); }
}

try {
  await fs.mkdir(output, { recursive: true }); await server.listen(); origin = server.resolvedUrls.local[0];

  await scenario('camera permissions policy allows self and excludes third parties', async () => {
    const state = await openFixture(), { page } = state;
    check(await page.evaluate(() => document.featurePolicy.allowsFeature('camera') && document.featurePolicy.allowsFeature('microphone')), 'policy: top-level camera and microphone are available');
    const frameReady = page.waitForEvent('framenavigated', { predicate: frame => frame.url().startsWith('https://thirdparty.fixture.invalid/') });
    await page.evaluate(() => { const iframe = document.createElement('iframe'); iframe.allow = 'camera *; microphone *'; iframe.src = 'https://thirdparty.fixture.invalid/'; document.body.append(iframe); });
    const frame = await frameReady;
    check(await frame.evaluate(() => !document.featurePolicy.allowsFeature('camera') && !document.featurePolicy.allowsFeature('microphone')), 'policy: cross-origin frame cannot acquire camera or microphone even with iframe allow');
    await noLeaks(state, 'permissions policy');
  });

  await scenario('saved camera choices gate browser photo and video capture', async () => {
    const state = await openFixture({ cameraChoice: 'ask' }), { page } = state;
    await page.getByRole('button', { name: /Post snap.*open camera/ }).click();
    await page.getByRole('heading', { name: 'Allow camera access?', exact: true }).waitFor();
    check(await page.evaluate(() => window.__cameraRequests.length === 0), 'camera choice: first-use prompt precedes browser device access');
    await page.getByRole('button', { name: /Don.t allow/, exact: true }).click();
    await page.locator('.media-permission-dialog').waitFor({ state: 'detached' });
    check(await page.evaluate(() => window.__readChoices('fixture-member').camera === 'block' && window.__cameraRequests.length === 0), 'camera choice: denial is saved without device access');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Post snap.*open camera/ }).click();
    await page.getByRole('heading', { name: 'Camera is turned off', exact: true }).waitFor();
    check(await page.evaluate(() => window.__cameraRequests.length === 0), 'camera choice: saved denial still blocks capture after reload');
    await page.getByRole('button', { name: 'Change choice', exact: true }).click();
    await page.getByRole('button', { name: 'Allow camera', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.snap-camera-preview')?.readyState >= 2);
    check(await page.evaluate(() => window.__readChoices('fixture-member').camera === 'allow' && window.__cameraRequests.length === 1), 'camera choice: explicit allow starts one browser camera request');
    await button(page, 'Close snap composer').click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openCamera(page);
    check(await page.locator('.media-permission-dialog').count() === 0, 'camera choice: saved allow opens directly after reload');
    await page.evaluate(() => window.__saveChoice('fixture-member', 'camera', 'block'));
    await allStopped(page);
    check(await page.locator('.snap-camera-preview').count() === 0, 'camera choice: changing to block stops active media tracks');
    await button(page, 'Video').click();
    await page.getByRole('heading', { name: 'Camera is turned off', exact: true }).waitFor();
    check(await page.evaluate(() => window.__cameraRequests.length === 1), 'camera choice: saved denial also blocks video and microphone requests');
    await page.getByRole('button', { name: 'Change choice', exact: true }).click();
    await page.getByRole('button', { name: 'Allow camera', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.snap-camera-preview')?.readyState >= 2);
    check(await page.evaluate(() => window.__cameraRequests.at(-1).audio === true), 'camera choice: video requests microphone only after the shared camera allow');
    await noLeaks(state, 'saved camera choices');
  });

  for (const action of ['cancel', 'unmount', 'background', 'account']) await scenario(`saved camera choice pending: ${action}`, async () => {
    const state = await openFixture({ cameraChoice: 'ask' }), { page } = state;
    await page.getByRole('button', { name: /Post snap.*open camera/ }).click();
    await page.getByRole('heading', { name: 'Allow camera access?', exact: true }).waitFor();
    if (action === 'cancel') {
      const allow = page.getByRole('button', { name: 'Allow camera', exact: true });
      check(await allow.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), 'camera choice: permission controls are above the Snap composer');
      await allow.focus();
      for (const key of ['Tab', 'Shift+Tab', 'Shift+Tab', 'Tab']) {
        await page.keyboard.press(key);
        check(await page.evaluate(() => Boolean(document.activeElement.closest('.media-permission-dialog'))), `camera choice: ${key} stays within the top permission dialog`);
      }
      await page.keyboard.press('Escape');
    }
    if (action === 'unmount') await page.evaluate(() => window.__unmountRail());
    if (action === 'background') await page.evaluate(() => window.__setHidden(true));
    if (action === 'account') await page.evaluate(() => window.__changeAccount('another-member'));
    await page.locator('.media-permission-dialog').waitFor({ state: 'detached' });
    if (action === 'cancel') check(await composer(page).isVisible() && await page.evaluate(() => Boolean(document.activeElement.closest('.snap-composer'))), 'camera choice: Escape closes only the top dialog and restores composer focus');
    await page.evaluate(() => { window.__saveChoice('fixture-member', 'camera', 'allow'); window.__permissionRequests.at(-1).respond(true); });
    check(await page.evaluate(() => window.__cameraRequests.length === 0), `pending saved choice ${action}: late allow cannot acquire devices`);
    check(await page.locator('.snap-camera-preview').count() === 0, `pending saved choice ${action}: preview does not revive`);
    if (action === 'account') {
      await page.getByRole('button', { name: /Post snap.*open camera/ }).click();
      await page.getByRole('heading', { name: 'Allow camera access?', exact: true }).waitFor();
      check(await page.evaluate(() => window.__readChoices('another-member').camera === 'ask' && window.__cameraRequests.length === 0), 'camera choice: a new account does not inherit the previous account allow');
      await page.keyboard.press('Escape');
    }
    if (action === 'background') await page.evaluate(() => window.__setHidden(false));
    await noLeaks(state, `pending saved choice ${action}`);
  });

  for (const native of ['ios', 'android']) await scenario(`${native} saved camera and gallery choices preserve trusted capture`, async () => {
    const state = await openFixture({ native, cameraChoice: 'ask', photosChoice: 'ask' }), { page } = state;
    let opened = 0; page.on('filechooser', () => opened++);
    await page.getByRole('button', { name: /Post snap.*open camera/ }).click();
    await page.getByRole('heading', { name: 'Allow camera access?', exact: true }).waitFor();
    check(opened === 0, `${native} choice: first-use consent precedes system capture`);
    let chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Allow camera', exact: true }).click();
    await (await chooser).setFiles(photoFile);
    await composer(page).getByAltText('Your snap preview').waitFor();
    check(await page.evaluate(() => window.__nativeClicks.at(-1).trustedClick && window.__nativeClicks.at(-1).active), `${native} choice: allowing camera preserves trusted-click capture`);
    chooser = page.waitForEvent('filechooser'); await button(page, 'Retake').click(); await (await chooser).setFiles(photoFile);
    check(await page.locator('.media-permission-dialog').count() === 0 && opened === 2, `${native} choice: saved allow opens retake directly`);
    await page.evaluate(() => window.__saveChoice('fixture-member', 'camera', 'block'));
    await button(page, 'Video').click();
    await page.getByRole('heading', { name: 'Camera is turned off', exact: true }).waitFor();
    check(opened === 2, `${native} choice: saved camera denial prevents video chooser`);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await button(page, 'Gallery').click();
    await page.getByRole('heading', { name: 'Allow photos and videos?', exact: true }).waitFor();
    chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Choose photos', exact: true }).click(); await (await chooser).setFiles(photoFile);
    check(opened === 3 && await page.evaluate(() => window.__nativeClicks.at(-1).trustedClick && window.__cameraRequests.length === 0), `${native} choice: gallery permission is independent and never uses WebView capture`);
    await noLeaks(state, `${native} saved choices`);
  });

  await scenario('browser photo, editing, deferred upload, retry and viewer roundtrip', async () => {
    const state = await openFixture(), { page } = state;
    await openCamera(page);
    check(await page.locator('.snap-camera-preview').evaluate(element => element.videoWidth > 0 && element.srcObject.getVideoTracks()[0].readyState === 'live'), 'photo: real fake-device stream renders live pixels');
    await button(page, 'Take photo').click(); await composer(page).getByAltText('Your snap preview').waitFor(); await allStopped(page);
    check(await page.evaluate(() => window.__createdUrls.at(-1).type === 'image/jpeg' && window.__createdUrls.at(-1).size > 100), 'photo: canvas capture produces a nonempty JPEG');
    await button(page, 'Vivid').click(); await composer(page).getByLabel('Text on your snap').fill('Draft text');
    await composer(page).getByLabel('Description (optional)', { exact: true }).fill('Draft description');
    await button(page, 'Retake').click(); await page.waitForFunction(() => document.querySelector('.snap-camera-preview')?.readyState >= 2);
    await button(page, 'Take photo').click(); await composer(page).getByAltText('Your snap preview').waitFor();
    await button(page, 'Delete draft').click(); await composer(page).getByText('Share a moment', { exact: true }).waitFor();
    check(await composer(page).getByLabel('Text on your snap').inputValue() === '' && await composer(page).getByLabel('Description (optional)', { exact: true }).inputValue() === '' && await button(page, 'Original').getAttribute('aria-pressed') === 'true', 'photo: Delete draft clears caption, overlay and filter');
    check(state.signatures === 0 && state.uploads.length === 0 && state.writes.length === 0, 'photo: capture, retake and delete never upload or publish');
    const chooser = page.waitForEvent('filechooser'); await button(page, 'Gallery').click(); await (await chooser).setFiles(photoFile);
    await composer(page).getByAltText('Your snap preview').waitFor();
    await button(page, 'Mono').click(); await composer(page).getByLabel('Text on your snap').fill('A caption <b>stays text</b>');
    await composer(page).getByLabel('Description (optional)', { exact: true }).fill('Edited gallery photo');
    check(await composer(page).getByAltText('Your snap preview').evaluate(element => getComputedStyle(element).filter === 'grayscale(1)'), 'effects: filter changes the preview');
    check(await composer(page).locator('.snap-text-overlay').textContent() === 'A caption <b>stays text</b>', 'effects: text overlay is rendered as literal text');
    state.failPublish = true; await button(page, 'Post snap').click();
    await composer(page).getByRole('alert').filter({ hasText: 'Fixture post failed' }).waitFor();
    check(state.uploads.length === 1 && state.signatures === 1, 'publish: first submit uploads one selected file');
    check(await composer(page).getByAltText('Your snap preview').isVisible(), 'publish: failed post retains the editable draft');
    state.failPublish = false; await button(page, 'Post snap').click(); await composer(page).waitFor({ state: 'detached' });
    check(state.uploads.length === 1 && state.signatures === 1 && state.published.length === 1, 'publish: retry reuses upload proof without uploading again');
    check(state.published[0].filter === 'mono' && state.published[0].overlayText === 'A caption <b>stays text</b>' && state.published[0].caption === 'Edited gallery photo', 'effects: API JSON payload preserves filter, overlay and description');
    await page.evaluate(() => window.__reloadSnaps());
    await page.getByRole('button', { name: "View Fixture Member's snap", exact: true }).click();
    const viewer = page.locator('dialog.snap-viewer'); await viewer.locator('.snap-text-overlay').waitFor();
    check(await viewer.locator('.snap-text-overlay').textContent() === state.published[0].overlayText && await viewer.locator('.snap-text-overlay b').count() === 0, 'effects: reloaded viewer preserves literal overlay');
    check(await viewer.locator('.snap-viewer-media img').evaluate(element => getComputedStyle(element).filter === 'grayscale(1)'), 'effects: reloaded viewer preserves the filter');
    const file = 'photo-effects-viewer.png'; await page.screenshot({ path: path.join(output, file) }); screenshots.push(file);
    await noLeaks(state, 'photo flow');
  });

  await scenario('fullscreen camera resizes and returns to the editable draft', async () => {
    for (const width of [320, 390, 820, 1440]) {
      const state = await openFixture({ width }), { page } = state;
      await openCamera(page);
      await page.setViewportSize({ width: 900, height: 390 });
      await assertFullscreenCamera(page);
      await button(page, 'Close camera').click(); await allStopped(page);
      check(await page.locator('.snap-composer-camera').count() === 0, 'camera exit: immersive capture ends');
      check(await composer(page).getByLabel('Description (optional)', { exact: true }).isVisible(), 'camera exit: editable draft returns');
      await button(page, 'Close snap composer').click(); await composer(page).waitFor({ state: 'detached' });
      check(await page.getByRole('button', { name: /Post snap.*open camera/ }).evaluate(element => element === document.activeElement),
        'camera exit: closing composer restores the initiating tile focus');
      await noLeaks(state, 'fullscreen camera at ' + width + 'px');
    }
  });

  await scenario('real browser video recording and draft validation', async () => {
    const state = await openFixture(), { page } = state;
    await openCamera(page); await button(page, 'Video').click();
    await page.waitForFunction(() => ![...document.querySelectorAll('.snap-camera-actions button')][0]?.disabled);
    await button(page, 'Record video').click(); await button(page, 'Stop recording').waitFor();
    await page.waitForFunction(() => document.querySelector('.snap-camera-status')?.textContent.includes('2s /'));
    await button(page, 'Stop recording').click();
    await composer(page).getByLabel('Description (required for videos)', { exact: true }).waitFor(); await allStopped(page);
    check(await page.evaluate(() => window.__createdUrls.at(-1).type.startsWith('video/') && window.__createdUrls.at(-1).size > 100), 'video: actual MediaRecorder produces a nonempty video');
    check(await button(page, 'Post snap').isDisabled(), 'video: description required before publishing');
    check(state.uploads.length === 0 && state.signatures === 0, 'video: recording is local until Post');
    await composer(page).getByLabel('Description (required for videos)', { exact: true }).fill('Recorded test moment');
    await button(page, 'Warm').click(); await composer(page).getByLabel('Text on your snap').fill('Recorded with the browser');
    await button(page, 'Post snap').click(); await composer(page).waitFor({ state: 'detached' });
    check(state.uploads.length === 1 && state.uploads[0].isVideo && state.published[0].mediaType === 'video', 'video: publish uploads recorded video with video metadata');
    await page.getByRole('button', { name: "View Fixture Member's snap", exact: true }).click();
    await page.locator('dialog.snap-viewer video').waitFor();
    check(await page.locator('dialog.snap-viewer video').evaluate(element => getComputedStyle(element).filter.includes('sepia')), 'video: viewer renders the saved video filter');
    check(await page.locator('dialog.snap-viewer .snap-text-overlay').textContent() === 'Recorded with the browser', 'video: viewer renders saved text caption');
    await noLeaks(state, 'video flow');
  });

  await scenario('denied camera permission keeps gallery usable', async () => {
    const state = await openFixture({ denied: true }), { page } = state;
    await page.getByRole('button', { name: /Post snap.*open camera/ }).click();
    await composer(page).getByRole('alert').filter({ hasText: 'Camera permission was not granted' }).waitFor();
    const chooser = page.waitForEvent('filechooser'); await button(page, 'Gallery').click(); await (await chooser).setFiles(photoFile);
    await composer(page).getByAltText('Your snap preview').waitFor();
    check(await button(page, 'Post snap').isEnabled(), 'denied permission: gallery still creates a valid draft');
    check(state.uploads.length === 0 && state.signatures === 0, 'denied permission: gallery selection does not upload');
    await noLeaks(state, 'denied permission');
  }, { denyCamera: true });

  for (const action of ['unmount', 'close', 'background']) await scenario(`pending camera permission: ${action}`, async () => {
    const state = await openFixture(), { page } = state;
    await page.evaluate(() => { window.__pendingCapture = true; });
    await page.getByRole('button', { name: /Post snap.*open camera/ }).click();
    await page.waitForFunction(() => typeof window.__releaseCapture === 'function');
    if (action === 'unmount') await page.evaluate(() => window.__unmountRail());
    if (action === 'close') await button(page, 'Close snap composer').click();
    if (action === 'background') await page.evaluate(() => window.__setHidden(true));
    await page.evaluate(() => { window.__pendingCapture = false; window.__releaseCapture(); });
    await allStopped(page);
    check(await page.locator('.snap-camera-preview').count() === 0, `pending ${action}: late stream cannot attach or revive the camera`);
    check(state.uploads.length === 0 && state.writes.length === 0, `pending ${action}: late permission never publishes`);
    if (action === 'background') await page.evaluate(() => window.__setHidden(false));
    await noLeaks(state, `pending ${action}`);
  });

  await scenario('camera device disconnect stops the preview and offers fallback', async () => {
    const state = await openFixture(), { page } = state;
    await openCamera(page);
    await page.evaluate(() => window.__cameraStreams.at(-1).getVideoTracks()[0].dispatchEvent(new Event('ended')));
    await composer(page).getByRole('alert').waitFor(); await allStopped(page);
    check(await page.locator('.snap-camera-preview').count() === 0, 'disconnected camera: stale live preview is removed');
    check(await button(page, 'Gallery').isEnabled() && state.signatures === 0 && state.uploads.length === 0, 'disconnected camera: gallery remains available without uploading');
    await noLeaks(state, 'disconnected camera');
  });

  await scenario('background or unmount during recording releases devices and drafts', async () => {
    for (const action of ['background', 'unmount']) {
      const state = await openFixture(), { page } = state;
      await openCamera(page); await button(page, 'Video').click();
      await page.waitForFunction(() => ![...document.querySelectorAll('.snap-camera-actions button')][0]?.disabled);
      await button(page, 'Record video').click(); await button(page, 'Stop recording').waitFor();
      await page.evaluate(action => action === 'background' ? window.__setHidden(true) : window.__unmountRail(), action);
      await allStopped(page);
      check(await page.evaluate(() => window.__createdUrls.length === 0), `recording ${action}: interrupted recording is discarded`);
      check(state.uploads.length === 0 && state.writes.length === 0, `recording ${action}: no upload or post`);
      if (action === 'background') await page.evaluate(() => window.__setHidden(false));
      await noLeaks(state, `recording ${action}`);
    }
  });

  for (const theme of ['light', 'dark']) await scenario(`square rail and composer at 320px, ${theme}`, async () => {
    const state = await openFixture({ width: 320, theme }), { page } = state;
    const rail = page.locator('[data-snap-source="uficonnect"]');
    check(await rail.evaluate(element => getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(element).boxShadow === 'none'), `${theme}: UFI source has no solid black container`);
    const rings = await rail.locator('.snap-profile-ring').evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { width: r.width, height: r.height, radius: parseFloat(getComputedStyle(element).borderRadius) }; }));
    check(rings.length === 8 && rings.every(r => Math.abs(r.width - r.height) < 1 && r.radius < r.width / 3), `${theme}: camera and creator tiles are square`);
    check(await rail.locator('.snap-source-items').evaluate(element => {
      const tiles = [...element.querySelectorAll('.snap-profile-item')].map(tile => tile.getBoundingClientRect());
      return new Set(tiles.map(tile => Math.round(tile.y))).size === 1 && element.scrollWidth > element.clientWidth
        && element.scrollHeight <= element.clientHeight + 1 && element.firstElementChild.querySelector('.snap-create-button');
    }), `${theme}: camera-first UFI tiles stay in one horizontal scrolling row`);
    await rail.locator('.snap-profile-item').last().scrollIntoViewIfNeeded();
    check(await rail.locator('.snap-source-items').evaluate(element => {
      const tile = element.lastElementChild.getBoundingClientRect(), bounds = element.getBoundingClientRect();
      return element.scrollLeft > 0 && tile.left >= bounds.left && tile.right <= bounds.right + 1;
    }), `${theme}: last UFI tile is reachable without wrapping`);
    await rail.locator('.snap-source-items').evaluate(element => { element.scrollLeft = 0; });
    check(await rail.locator('.snap-create-button svg').count() === 1, `${theme}: create tile has a camera icon`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${theme}: 320px rail has no document horizontal overflow`);
    let file = `rail-320-${theme}.png`; await page.screenshot({ path: path.join(output, file) }); screenshots.push(file);
    await openCamera(page); await button(page, 'Take photo').click(); await composer(page).getByAltText('Your snap preview').waitFor();
    const bounds = await composer(page).boundingBox();
    check(bounds.x >= 0 && bounds.x + bounds.width <= 321 && bounds.height <= 901, `${theme}: composer fits narrow viewport`);
    check(await composer(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${theme}: composer has no horizontal clipping`);
    await button(page, 'Post snap').scrollIntoViewIfNeeded();
    check(await button(page, 'Post snap').isVisible(), `${theme}: composer footer remains reachable by scrolling`);
    await composer(page).evaluate(element => { element.scrollTop = 0; });
    file = `composer-320-${theme}.png`; await page.screenshot({ path: path.join(output, file) }); screenshots.push(file);
    await noLeaks(state, `${theme} 320px layout`);
  });

  for (const native of ['ios', 'android']) await scenario(`${native} input capture stays in trusted click`, async () => {
    const state = await openFixture({ native }), { page } = state;
    let chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Post snap.*open camera/ }).click(); await (await chooser).setFiles(photoFile);
    await composer(page).getByAltText('Your snap preview').waitFor();
    chooser = page.waitForEvent('filechooser'); await button(page, 'Retake').click(); await (await chooser).setFiles(photoFile);
    chooser = page.waitForEvent('filechooser'); await button(page, 'Video').click(); await (await chooser).setFiles(videoFile);
    await composer(page).getByLabel('Description (required for videos)', { exact: true }).waitFor();
    chooser = page.waitForEvent('filechooser'); await button(page, 'Gallery').click(); await (await chooser).setFiles(photoFile);
    const clicks = await page.evaluate(() => window.__nativeClicks);
    check(clicks.length === 4 && clicks.every(click => click.trustedClick && click.active), `${native}: tile, retake, video and gallery synchronously click input during user activation`);
    check(clicks[0].accept === 'image/*' && clicks[0].capture === 'environment' && clicks[1].capture === 'environment' && clicks[2].accept === 'video/*' && clicks[2].capture === 'environment' && clicks[3].capture === null, `${native}: photo/video capture inputs are separate from gallery`);
    check(await page.evaluate(() => window.__cameraRequests.length === 0), `${native}: system capture does not request WebView getUserMedia`);
    check(state.signatures === 0 && state.uploads.length === 0 && state.writes.length === 0, `${native}: file returns and retakes stay local`);
    await noLeaks(state, `${native} input capture`);
  });
} finally {
  await browser?.close(); await server.close();
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ passed: failures.length === 0, root, sourceHashes, checkedAt: new Date().toISOString(), checks, failures, screenshots,
    scope: 'Real shared components; Chromium fake camera and microphone; all remote services intercepted. Native tests verify browser-side input and trusted-click contracts, not physical camera apps.' }, null, 2));
}
console.log(JSON.stringify({ passed: failures.length === 0, checks: checks.length, failures: failures.map(item => item.scenario), output }, null, 2));
if (failures.length) process.exitCode = 1;
