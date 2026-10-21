// Focused regression audit. Provider settings and a delayed fullscreen promise
// are synthetic; audit-video-layout exercises the browser's real fullscreen API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
app.seedUser(member('video-settings-audit'));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5259, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
const posts = [
  ...['settings001', 'settings002'].map((embedId, index) => ({ id: `settings-${index}`, source: 'youtube', embedId,
    sourceUrl: `https://www.youtube.com/watch?v=${embedId}`, author: { name: 'Audit channel', channelId: 'UCabcdefghijklmnopqrstuv' } })),
  ...[0, 1].map(index => ({ id: `native-${index}`, source: 'reddit', mediaUrl: `https://media.example.invalid/settings-${index}.mp4`,
    sourceUrl: 'https://www.reddit.com/r/audit/comments/abcd/fixture/', directPlaybackAuthorized: true, author: { name: 'audit_author' } })),
].map(post => ({ title: 'Settings regression fixture', content: 'Synthetic video for browser checks.', mediaType: 'video',
  videoDurationSeconds: 30, isExternal: true, commentsCount: 0, createdAt: '2026-10-08T10:00:00Z', ...post }));
let browser;
try {
  await server.listen();
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  const context = await browser.newContext({ viewport: { width: 390, height: 850 }, hasTouch: true, isMobile: true });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installAuditMember(page, app, 'video-settings-audit');
  await page.addInitScript(() => {
    const audit = window.__videoSettingsAudit = { players: new Set(), captionWrites: [], holdSettingsPoll: false, fullscreenRequests: 0, fullscreenExits: 0 };
    const realSetInterval = window.setInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => realSetInterval(
      delay === 250 && typeof callback === 'function' ? () => { if (!audit.holdSettingsPoll) callback(...args); } : callback, delay, ...args);
    // Resolve after navigation to reproduce a browser fullscreen request that
    // succeeds after the view which requested it has already unmounted.
    let fullscreenElement = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
    Element.prototype.requestFullscreen = function () {
      const target = this;
      return new Promise(resolve => {
      audit.fullscreenRequests++;
      audit.resolveFullscreen = () => { fullscreenElement = target; document.dispatchEvent(new Event('fullscreenchange')); resolve(); };
      });
    };
    document.exitFullscreen = async () => { audit.fullscreenExits++; fullscreenElement = null; document.dispatchEvent(new Event('fullscreenchange')); };
    window.YT = { PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 }, Player: class {
      constructor(frame, config) {
        this.frame = frame; this.config = config; this.state = 1; this.rate = 1; this.captionFontSize = 0; this.captionModule = false;
        this.muted = true; this.volume = 100;
        this.id = new URL(frame.src).pathname.split('/').pop(); audit.players.add(this);
        setTimeout(() => { if (frame.isConnected) config.events?.onReady?.({ target: this }); }, 20);
      }
      getIframe() { return this.frame; }
      getVideoData() { return { video_id: this.id }; }
      getDuration() { return 30; }
      getCurrentTime() { return 1; }
      getPlayerState() { return this.state; }
      getAvailablePlaybackRates() { return [0.5, 1, 1.5, 2]; }
      getPlaybackRate() { return this.rate; }
      setPlaybackRate(rate) { this.rate = rate; this.config.events?.onPlaybackRateChange?.({ target: this, data: rate }); }
      getOptions(module) { return module === 'captions' && this.captionModule ? ['fontSize'] : []; }
      getOption(module, option) { return module === 'captions' && option === 'fontSize' ? this.captionFontSize : undefined; }
      setOption(module, option, value) {
        audit.captionWrites.push({ module, option, value });
        audit.confirmCaption = () => { this.captionFontSize = value; this.config.events?.onApiChange?.({ target: this }); };
      }
      loadVideoById(id) {
        this.id = id; this.rate = 1; this.captionFontSize = 0; this.captionModule = false;
        const url = new URL(this.frame.src); url.pathname = `/embed/${id}`; this.frame.src = url.href;
      }
      cueVideoById(id) { this.loadVideoById(id); this.pauseVideo(); }
      playVideo() { this.state = 1; this.config.events?.onStateChange?.({ target: this, data: 1 }); }
      pauseVideo() { this.state = 2; this.config.events?.onStateChange?.({ target: this, data: 2 }); }
      isMuted() { return this.muted; }
      getVolume() { return this.volume; }
      setVolume(value) { this.volume = Number(value); }
      mute() { this.muted = true; } unMute() { this.muted = false; } seekTo() {}
      destroy() { audit.players.delete(this); this.frame.remove(); }
    } };
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.youtube.com' && url.pathname.startsWith('/embed/')) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><button>Provider controls</button>' });
    if (url.origin !== new URL(origin).origin) return route.fulfill({ status: 404, body: '' });
    const endpoint = url.pathname.replace(/^\/api/, '');
    if (/^\/office\/feed\/(videos|music)/.test(endpoint)) return route.fulfill({ json: { posts, hasMore: false, waitingForNew: true } });
    if (endpoint === '/office/feed') return route.fulfill({ json: { posts: [], hasMore: false } });
    if (/^\/feed\/(settings|native)-\d\/comments$/.test(endpoint)) return route.fulfill({ json: { comments: [], hasMore: false, live: false } });
    if (endpoint === '/social/interaction-capabilities') return route.fulfill({ json: { sources: {} } });
    if (/(?:events|stream)/.test(endpoint)) return route.abort();
    return route.continue();
  });
  await auditNavigate(page, origin + 'videos');
  const scroll = page.locator('[data-video-feed-scroll]');
  const first = page.locator('[data-post-id="settings-0"]');
  await first.waitFor();
  await page.waitForFunction(() => [...window.__videoSettingsAudit.players].some(player => player.id === 'settings001'));
  const openSettings = async slide => {
    await slide.getByRole('button', { name: 'More options', exact: true }).click();
    await page.getByRole('menuitem', { name: /^YouTube settings\b/ }).click();
    const dialog = page.getByRole('dialog', { name: 'YouTube settings', exact: true });
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('radiogroup', { name: 'Playback speed', exact: true }).waitFor();
    return dialog;
  };
  let settings = await openSettings(first);
  assert.equal(await settings.getByRole('radiogroup', { name: 'Caption size', exact: true }).count(), 0,
    'Caption sizes are not offered before the provider exposes its captions module');
  await page.evaluate(() => {
    const player = [...window.__videoSettingsAudit.players][0];
    player.captionModule = true; player.config.events.onApiChange({ target: player });
  });
  const captionSizes = settings.getByRole('radiogroup', { name: 'Caption size', exact: true });
  await captionSizes.waitFor();
  await captionSizes.getByRole('radio', { name: 'Large', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__videoSettingsAudit.captionWrites), [{ module: 'captions', option: 'fontSize', value: 1 }]);
  assert.equal(await captionSizes.getByRole('radio', { name: 'Large', exact: true }).getAttribute('aria-checked'), 'false');
  assert.equal(await captionSizes.getByRole('radio', { name: 'Default', exact: true }).getAttribute('aria-checked'), 'true',
    'Caption UI retains the confirmed value while the provider request is pending');
  await page.evaluate(() => window.__videoSettingsAudit.confirmCaption());
  await page.waitForFunction(() => document.querySelector('[role="radio"][aria-label="Large"]')?.getAttribute('aria-checked') === 'true');
  await page.evaluate(() => {
    const player = [...window.__videoSettingsAudit.players][0];
    player.captionModule = false; player.config.events.onApiChange({ target: player });
  });
  await captionSizes.waitFor({ state: 'detached' });
  assert.equal((await page.evaluate(() => window.__videoSettingsAudit.captionWrites)).length, 1,
    'An unavailable captions module never receives additional writes');
  await settings.getByRole('radio', { name: '1.5×', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role="radio"][aria-label="1.5×"]')?.getAttribute('aria-checked') === 'true');
  await settings.screenshot({ path: path.join(root, '.cache/audit-ui/youtube-settings-390.png') });
  await settings.getByRole('button', { name: 'Close YouTube settings', exact: true }).click();

  await scroll.focus(); await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => [...window.__videoSettingsAudit.players].some(player => player.id === 'settings002'));
  const second = page.locator('[data-post-id="settings-1"]');
  settings = await openSettings(second);
  await page.waitForFunction(() => document.querySelector('[role="radio"][aria-label="1×"]')?.getAttribute('aria-checked') === 'true');
  await page.evaluate(async () => {
    const audit = window.__videoSettingsAudit; audit.holdSettingsPoll = true;
    const player = [...audit.players][0];
    // A delayed event from the previous clip can carry a stale payload even
    // after getVideoData and getPlaybackRate describe the new clip.
    player.config.events.onPlaybackRateChange({ target: player, data: 2 });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.equal(await settings.getByRole('radio', { name: '1×', exact: true }).getAttribute('aria-checked'), 'true');
  assert.equal(await settings.getByRole('radio', { name: '2×', exact: true }).getAttribute('aria-checked'), 'false',
    'A stale prior-clip event cannot overwrite the new clip’s actual playback rate');
  await page.evaluate(() => { window.__videoSettingsAudit.holdSettingsPoll = false; });
  await page.keyboard.press('Escape');
  await settings.waitFor({ state: 'detached' });

  const commentsButton = second.getByRole('button', { name: /^Comments/ });
  await commentsButton.click();
  const comments = page.getByRole('dialog', { name: 'Comments', exact: true });
  await comments.getByRole('link', { name: /View the original post/ }).waitFor();
  const controls = comments.locator('a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])').filter({ visible: true });
  assert.ok(await controls.count() >= 2, 'The comments sheet contains a real focus cycle');
  await controls.first().focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await controls.last().evaluate(el => document.activeElement === el), true, 'Shift+Tab wraps to the last comment control');
  await page.keyboard.press('Tab');
  assert.equal(await controls.first().evaluate(el => document.activeElement === el), true, 'Tab wraps to the first comment control');
  for (let index = 0; index < await controls.count() + 1; index++) {
    await page.keyboard.press('Tab');
    assert.equal(await comments.evaluate(el => el.contains(document.activeElement)), true, 'Keyboard focus remains in Comments');
  }
  await page.keyboard.press('Escape'); await comments.waitFor({ state: 'detached' });
  assert.equal(new URL(page.url()).pathname, '/videos', 'Escape closes only Comments');
  assert.equal(await commentsButton.evaluate(el => document.activeElement === el), true, 'Comment dismissal restores its trigger');
  await second.getByRole('button', { name: 'More options', exact: true }).click();
  await page.getByRole('menu').waitFor({ state: 'visible' });
  await page.keyboard.press('Tab'); await page.getByRole('menu').waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => document.activeElement?.isConnected && document.activeElement !== document.body), true,
    'Tab out of the menu leaves focus on a real connected control');

  // Tab can legitimately focus the next slide's native player and scroll it
  // into view. Position this fixture explicitly instead of advancing again.
  const nativeSlide = page.locator('[data-post-id="native-0"]');
  await nativeSlide.evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  const native = page.locator('[data-post-id="native-0"] video'); await native.waitFor();
  await page.waitForFunction(() => {
    const container = document.querySelector('[data-video-feed-scroll]');
    const slide = document.querySelector('[data-post-id="native-0"]');
    return slide && Math.abs(slide.getBoundingClientRect().top - container.getBoundingClientRect().top) <= 2;
  });
  assert.equal(await native.evaluate(video => video.controls), false, 'The native picture has no duplicate browser controls');
  const nativeProgress = nativeSlide.getByRole('slider', { name: 'Video progress', exact: true });
  assert.ok(await nativeProgress.evaluate(control => {
    const rect = control.getBoundingClientRect(), container = control.closest('[data-video-feed-scroll]').getBoundingClientRect();
    const video = control.closest('.video-feed-slide').querySelector('video').getBoundingClientRect();
    return rect.top >= video.bottom && rect.top >= container.top && rect.bottom <= Math.min(container.bottom, innerHeight);
  }), 'The app progress control sits below the native picture inside the visible feed');
  await scroll.evaluate(container => {
    container.focus({ preventScroll: true });
    const original = container.scrollTo.bind(container);
    window.__videoSettingsAudit.controlScrollCalls = [];
    container.scrollTo = (...args) => { window.__videoSettingsAudit.controlScrollCalls.push(args); return original(...args); };
  });
  const beforeTouch = await scroll.evaluate(el => el.scrollTop);
  await nativeProgress.evaluate(control => {
    const rect = control.getBoundingClientRect(), startY = rect.y + rect.height / 2;
    const dispatch = (name, y) => {
      const event = new Event(name, { bubbles: true });
      const touch = { clientX: rect.x + rect.width / 2, clientY: y };
      Object.defineProperties(event, { touches: { value: name === 'touchstart' ? [touch] : [] }, changedTouches: { value: [touch] } });
      control.dispatchEvent(event);
    };
    dispatch('touchstart', startY); dispatch('touchend', startY - 120);
  });
  await page.waitForTimeout(450);
  const afterTouch = await scroll.evaluate(el => el.scrollTop);
  assert.ok(Math.abs(afterTouch - beforeTouch) <= 1,
    `A gesture on the app progress control does not activate the feed swipe fallback (${beforeTouch} -> ${afterTouch})`);
  assert.deepEqual(await page.evaluate(() => window.__videoSettingsAudit.controlScrollCalls), [],
    'App progress-control touches never schedule fallback scrolling');
  await scroll.evaluate(container => { delete container.scrollTo; });

  await nativeSlide.locator('.media-playback-controls').getByRole('button', { name: 'Full screen', exact: true }).click();
  await page.waitForFunction(() => window.__videoSettingsAudit.fullscreenRequests === 1);
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false, 'Fullscreen request remains pending');
  await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
  await page.locator('.video-feed-view').waitFor({ state: 'detached' });
  await page.waitForURL(url => url.pathname === '/');
  await page.evaluate(() => window.__videoSettingsAudit.resolveFullscreen());
  await page.waitForFunction(() => window.__videoSettingsAudit.fullscreenExits === 1 && !document.fullscreenElement);
  assert.equal(new URL(page.url()).pathname, '/', 'A late fullscreen resolution does not restore the departed feed');
  assert.equal(await page.locator('.video-feed-view').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: confirmed/gated captions, stale rate events, comment/menu focus, native control gestures and late fullscreen cleanup at 390px');
  await context.close();
} finally { await browser?.close(); await server.close(); await app.close(); }
