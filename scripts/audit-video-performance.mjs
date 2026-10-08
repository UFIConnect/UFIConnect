// Controlled client regression, not a production concurrency benchmark.
// Native decoding uses a local MP4; long pagination uses tiny provider fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await createAppHarness();
app.seedUser(member('video-performance-audit'));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5248, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
const MAX_RETAINED_POSTS = 60;
const MAX_MOUNTED_SLIDES = 5;
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  const results = [];
  for (const surface of ['videos', 'music']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 850 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], calls = [], nativeRequests = [], providerRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await installAuditMember(page, app, 'video-performance-audit');
    await page.addInitScript(() => {
      let hidden = false;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
      window.__videoAuditVisibility = value => { hidden = value; document.dispatchEvent(new Event('visibilitychange')); };
      // Invoke the currently registered long-interval callbacks explicitly,
      // so hidden-poll assertions exercise their guards without a two-minute wait.
      const pollingCallbacks = new Map();
      const realSetInterval = window.setInterval.bind(window), realClearInterval = window.clearInterval.bind(window);
      window.setInterval = (callback, delay, ...args) => {
        const id = realSetInterval(callback, delay, ...args);
        if (typeof callback === 'function' && delay >= 10000) pollingCallbacks.set(id, () => callback(...args));
        return id;
      };
      window.clearInterval = id => { pollingCallbacks.delete(id); return realClearInterval(id); };
      window.__videoAuditRunPolls = () => { for (const callback of pollingCallbacks.values()) callback(); };
      window.__videoAuditPlayers = new Set();
      window.YT = { PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 }, Player: class {
        constructor(frame, config) {
          this.frame = frame; this.config = config; this.state = 2;
          this.id = new URL(frame.src).pathname.split('/').pop();
          this.providerControl = event => {
            if (event.origin === 'https://www.youtube.com' && event.source === this.frame.contentWindow && event.data === 'audit-video-toggle') {
              if (this.state === 1) this.pauseVideo(); else this.playVideo();
            }
          };
          window.addEventListener('message', this.providerControl);
          window.__videoAuditPlayers.add(this);
          setTimeout(() => { if (frame.isConnected) config.events?.onReady?.({ target: this }); }, 20);
        }
        getIframe() { return this.frame; }
        getVideoData() { return { video_id: this.id }; }
        getDuration() { return 30; }
        getCurrentTime() { return this.state === 1 ? 1 : 0; }
        getPlayerState() { return this.state; }
        loadVideoById(id) { this.id = id; const url = new URL(this.frame.src); url.pathname = `/embed/${id}`; this.frame.src = url.href; }
        cueVideoById(id) { this.loadVideoById(id); this.pauseVideo(); }
        playVideo() { this.state = 1; this.config.events?.onStateChange?.({ target: this, data: 1 }); }
        pauseVideo() { this.state = 2; this.config.events?.onStateChange?.({ target: this, data: 2 }); }
        mute() {} unMute() {} seekTo() {}
        destroy() { window.removeEventListener('message', this.providerControl); this.pauseVideo(); this.frame.remove(); window.__videoAuditPlayers.delete(this); }
      } };
    });
    await page.route('https://www.youtube.com/embed/**', async route => {
      providerRequests.push(route.request().url());
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><button onclick="parent.postMessage(\'audit-video-toggle\', \'*\')">Provider controls</button>' });
    });
    await page.route('https://i.ytimg.com/**', route => route.fulfill({ status: 404, body: '' }));
    const origin = server.resolvedUrls.local[0];
    page.on('request', request => { if (request.url().includes('/media/preparation/tailored-resume.mp4')) nativeRequests.push(request.url()); });
    let phase = 'native';
    let backgroundClip = false;
    let overloadFailureAt = 0;
    const makePost = (index) => ({ id: `${phase}-${index}`, source: phase === 'native' ? 'reddit' : 'youtube',
      title: `Controlled video ${index}`, content: 'Local playback and scheduling fixture.', mediaType: 'video', videoDurationSeconds: 30,
      // The native phase plays the repository's own fixture, with explicit playback rights.
      directPlaybackAuthorized: phase === 'native',
      ...(phase === 'native' ? { mediaUrl: `${origin}media/preparation/tailored-resume.mp4?audit=${index}` }
        : { embedId: `audit${String(index).padStart(6, '0')}`, mediaUrl: `https://www.youtube.com/watch?v=audit${String(index).padStart(6, '0')}` }),
      sourceUrl: 'https://example.com/original', isExternal: true, createdAt: new Date(Date.UTC(2026, 8, 22) - index * 1000).toISOString() });
    await page.route(/\/api\/office\/feed\/(?:videos|music)\?/, async route => {
      const params = new URL(route.request().url()).searchParams;
      const offset = Number(params.get('cursor') || 0);
      calls.push({ phase, offset, source: params.get('source'), at: Date.now() });
      if (phase === 'native' && backgroundClip && offset === 0) return route.fulfill({ json: { posts: [{ ...makePost(500), id: 'new-background-clip' }], hasMore: false, waitingForNew: true } });
      if (phase === 'overload' && offset === 10 && !params.get('source') && !overloadFailureAt) {
        overloadFailureAt = Date.now();
        return route.fulfill({ status: 503, headers: { 'Retry-After': '2' }, json: { message: 'Controlled temporary overload.' } });
      }
      if (phase === 'overload' && params.get('source') === 'youtube') {
        return route.fulfill({ json: { posts: [{ ...makePost(1000), id: 'overload-filtered' }], hasMore: false, waitingForNew: true } });
      }
      const limit = phase === 'native' ? 10 : 240;
      const end = Math.min(offset + 10, limit);
      await route.fulfill({ json: { posts: Array.from({ length: Math.max(0, end - offset) }, (_, i) => makePost(offset + i)),
        cursor: end < limit ? String(end) : null, hasMore: end < limit, waitingForNew: end >= limit } });
    });
    const openFeed = async () => {
      await auditNavigate(page, origin + 'saved');
      await page.locator('.video-feed-view').waitFor({ state: 'detached' });
      await auditNavigate(page, origin + surface);
      await page.locator(`[data-post-id="${phase}-0"]`).waitFor();
    };
    const activeId = () => page.evaluate(() => {
      const scroll = document.querySelector('[data-video-feed-scroll]');
      const midpoint = scroll.getBoundingClientRect().top + scroll.clientHeight / 2;
      return [...scroll.querySelectorAll('[data-post-id]')].find(el => { const r = el.getBoundingClientRect(); return r.top <= midpoint && r.bottom > midpoint; })?.dataset.postId;
    });
    const awaitActive = async id => page.waitForFunction(target => {
      const scroll = document.querySelector('[data-video-feed-scroll]');
      const post = scroll?.querySelector(`[data-post-id="${target}"]`);
      return post && Math.abs(post.getBoundingClientRect().top - scroll.getBoundingClientRect().top) <= 2;
    }, id);
    const soundAction = async (id, label) => {
      const slide = page.locator(`[data-post-id="${id}"]`);
      await slide.getByRole('group', { name: 'Playback controls', exact: true }).getByRole('button', { name: label, exact: true }).click();
    };
    const nativePlayback = async paused => {
      const video = page.locator('[data-post-id="native-0"] video');
      assert.equal(await video.evaluate(element => element.controls), false, 'Native toolbar stays hidden while scrolling');
      await page.locator('[data-post-id="native-0"]').getByRole('button', { name: paused ? 'Pause video' : 'Play video', exact: true }).click();
      await page.waitForFunction(expected => document.querySelector('[data-post-id="native-0"] video')?.paused === expected, paused);
    };
    const providerPlayback = async paused => {
      await page.frameLocator('.video-feed-youtube-player iframe').getByRole('button', { name: 'Provider controls', exact: true }).click();
      await page.waitForFunction(expected => [...window.__videoAuditPlayers].some(player => player.state === (expected ? 2 : 1)), paused);
    };
    await openFeed();
    await page.waitForFunction(() => { const video = document.querySelector('[data-post-id="native-0"] video'); return video && !video.paused && video.currentTime > .1; });
    assert.ok(await page.locator('.video-feed-slide').count() <= MAX_MOUNTED_SLIDES);
    assert.ok(new Set(nativeRequests).size <= MAX_MOUNTED_SLIDES, 'Initial feed does not fetch every queued video');
    backgroundClip = true;
    const refreshResponse = page.waitForResponse(response => /\/office\/feed\/(videos|music)\?/.test(response.url()));
    await page.evaluate(() => {
      const now = Date.now.bind(Date);
      Date.now = () => now() + 60000;
      window.dispatchEvent(new Event('focus'));
    });
    await refreshResponse;
    await page.waitForFunction(() => document.querySelector('[data-post-id="new-background-clip"]'));
    assert.equal(await activeId(), 'native-0', 'New background clips must not replace the playing video');
    await page.waitForFunction(() => { const video = document.querySelector('[data-post-id="native-0"] video'); return video && !video.paused; });
    backgroundClip = false;
    await page.evaluate(() => window.__videoAuditVisibility(true));
    await page.waitForFunction(() => [...document.querySelectorAll('.video-feed-media video')].every(video => video.paused));
    const hiddenCalls = calls.length;
    await page.evaluate(() => window.__videoAuditRunPolls());
    await page.waitForTimeout(800);
    assert.equal(calls.length, hiddenCalls, 'Hidden idle feed does not issue extra feed requests');
    await page.evaluate(() => window.__videoAuditVisibility(false));
    await page.waitForFunction(() => { const video = document.querySelector('[data-post-id="native-0"] video'); return video && !video.paused; });
    await nativePlayback(true);
    await page.evaluate(() => { window.__videoAuditVisibility(true); window.__videoAuditVisibility(false); });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-post-id="native-0"] video').evaluate(video => video.paused), true, 'Visibility changes preserve a manual pause');
    await nativePlayback(false);
    const previouslyMuted = await page.locator('[data-post-id="native-0"] video').evaluate(video => video.muted);
    await soundAction('native-0', previouslyMuted ? 'Unmute video' : 'Mute video');
    assert.equal(await page.locator('[data-post-id="native-0"] video').evaluate(video => video.muted), !previouslyMuted,
      'The visible sound control changes the native player sound state');
    await soundAction('native-0', previouslyMuted ? 'Mute video' : 'Unmute video');
    // Focus the feed before testing its navigation shortcuts.
    await page.locator('[data-video-feed-scroll]').focus();
    await page.keyboard.press('ArrowDown');
    await awaitActive('native-1');
    await page.waitForFunction(() => { const videos = [...document.querySelectorAll('.video-feed-media video')]; return videos.filter(video => !video.paused).length === 1 && !document.querySelector('[data-post-id="native-1"] video')?.paused; });
    await page.locator('[data-video-feed-scroll]').focus();
    await page.keyboard.press('ArrowUp');
    await awaitActive('native-0');
    const cdp = await context.newCDPSession(page);
    const bounds = await page.locator('[data-post-id="native-0"] [data-video-media]').boundingBox();
    const x = bounds.x + bounds.width / 2, startY = bounds.y + bounds.height * .8, endY = bounds.y + bounds.height * .2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
    for (let i = 1; i <= 6; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY + (endY - startY) * i / 6 }] });
      await page.waitForTimeout(25);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => { const scroll = document.querySelector('[data-video-feed-scroll]'); return scroll.scrollTop >= scroll.clientHeight * .9; });
    await cdp.detach();
    assert.notEqual(await activeId(), 'native-0', 'A real touch swipe advances the video');

    phase = 'provider';
    await openFeed();
    await page.waitForFunction(() => [...window.__videoAuditPlayers].some(player => player.state === 1));
    await providerPlayback(true);
    await page.waitForTimeout(650);
    assert.ok(await page.evaluate(() => [...window.__videoAuditPlayers].every(player => player.state !== 1)), 'An early explicit YouTube pause is not undone by autoplay retry');
    await providerPlayback(false);
    await page.evaluate(() => window.__videoAuditVisibility(true));
    await page.waitForFunction(() => [...window.__videoAuditPlayers].every(player => player.state !== 1));
    await page.evaluate(() => window.__videoAuditVisibility(false));
    await page.waitForFunction(() => [...window.__videoAuditPlayers].some(player => player.state === 1));
    await providerPlayback(true);
    await page.evaluate(() => { window.__videoAuditVisibility(true); window.__videoAuditVisibility(false); });
    await page.waitForTimeout(650);
    assert.ok(await page.evaluate(() => [...window.__videoAuditPlayers].every(player => player.state !== 1)), 'YouTube visibility and autoplay retry preserve an explicit pause');
    await providerPlayback(false);
    let maxPosts = 0, maxSlides = 0, maxFrames = 0;
    for (let pageNumber = 1; pageNumber < 24; pageNumber += 1) {
      const target = `provider-${pageNumber * 10 - 3}`;
      await page.locator(`[data-post-id="${target}"]`).waitFor();
      await page.locator(`[data-post-id="${target}"]`).evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await awaitActive(target);
      await page.locator(`[data-post-id="provider-${pageNumber * 10}"]`).waitFor();
      const state = await page.evaluate(() => ({ posts: document.querySelectorAll('[data-video-feed-scroll] [data-post-id]').length,
        slides: document.querySelectorAll('.video-feed-slide').length, frames: document.querySelectorAll('.video-feed-youtube-player iframe').length,
        players: [...window.__videoAuditPlayers].filter(player => player.state === 1).length }));
      maxPosts = Math.max(maxPosts, state.posts); maxSlides = Math.max(maxSlides, state.slides); maxFrames = Math.max(maxFrames, state.frames);
      assert.ok(state.posts <= MAX_RETAINED_POSTS, `Pagination retains bounded DOM (${state.posts} posts after ${pageNumber + 1} pages)`);
      assert.ok(state.slides <= MAX_MOUNTED_SLIDES, 'Long scrolling mounts only nearby video slides');
      assert.equal(state.frames, 1, 'One YouTube iframe survives long scrolling');
      assert.ok(state.players <= 1, 'Offscreen players never keep playing');
    }
    const providerCalls = calls.filter(call => call.phase === 'provider');
    assert.ok(providerCalls.length <= 26, 'Pagination does not create duplicate request bursts');
    assert.ok(providerRequests.length <= 60, 'Provider requests grow with viewed items, not every queued post');
    assert.ok(new Set(providerCalls.map(call => call.offset)).size >= 24, 'At least 240 distinct posts traversed');
    const settledCalls = calls.length;
    await page.waitForTimeout(1200);
    assert.equal(calls.length, settledCalls, 'Idle completed pagination does not spin');
    await page.locator('[data-post-id="provider-239"]').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await awaitActive('provider-239');
    await page.evaluate(() => window.__videoAuditVisibility(true));
    const hiddenTailCalls = calls.length;
    await page.evaluate(() => window.__videoAuditRunPolls());
    await page.waitForTimeout(300);
    assert.equal(calls.length, hiddenTailCalls, 'An exhausted hidden feed skips its tail poll');
    assert.deepEqual(errors, []);
    const result = { surface, logicalPosts: 240, maxPosts, maxSlides, maxFrames, feedRequests: providerCalls.length, providerRequests: providerRequests.length };
    // Preserve the playable queue during overload, honor Retry-After, and
    // replay a newer filter as a reset instead of mixing it into the old cursor.
    await page.evaluate(() => window.__videoAuditVisibility(false));
    phase = 'overload';
    await openFeed();
    const failedPage = page.waitForResponse(response => response.url().includes(`/office/feed/${surface}?`) && response.status() === 503);
    await page.locator('[data-post-id="overload-7"]').evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await failedPage;
    await page.getByRole('button', { name: 'Filter videos', exact: true }).click();
    await page.getByRole('button', { name: 'YouTube', exact: true }).click();
    await page.getByRole('button', { name: 'Done', exact: true }).first().click();
    await page.waitForTimeout(800);
    assert.equal(calls.filter(call => call.phase === 'overload').length, 2, 'Backoff suppresses generic retries and immediate filter retries');
    assert.ok(await page.locator('[data-post-id="overload-0"]').count(), 'Existing playable queue stays available during overload');
    await page.locator('[data-post-id="overload-filtered"]').waitFor();
    const overloadCalls = calls.filter(call => call.phase === 'overload');
    assert.equal(overloadCalls.length, 3, 'Exactly one recovery request follows the initial page and failure');
    assert.ok(overloadCalls[2].at - overloadFailureAt >= 1950, 'Recovery honors the two-second Retry-After window');
    assert.equal(overloadCalls[2].source, 'youtube', 'Recovery honors the latest source filter');
    assert.equal(overloadCalls[2].offset, 0, 'A filter change resets the prior pagination cursor');
    assert.equal(await page.locator('[data-post-id^="overload-"]:not([data-post-id="overload-filtered"])').count(), 0, 'Recovery replaces the old filter queue');
    assert.deepEqual(errors, []);
    result.overloadRecoveryDelayMs = overloadCalls[2].at - overloadFailureAt;
    results.push(result); console.log('PASS: controlled video performance ' + JSON.stringify(result));
    await context.close();
  }
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  await fs.writeFile(path.join(root, '.cache/audit-ui/video-performance.json'), JSON.stringify({ kind: 'controlled-client-regression', productionLoadTest: false, results }, null, 2));
} finally { await browser?.close(); await server.close(); await app.close(); }
