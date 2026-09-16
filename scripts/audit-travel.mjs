import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
const require = createRequire(import.meta.url);
require('../backend/generated-media');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const providers = require('../backend/travel-providers');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let app;
app = await createAppHarness({ env: { YOUTUBE_API_KEY: 'travel-ui-test' }, modules: { './travel-providers': {
  ...providers,
  fetchTravelResource: async (url, options) => {
    if (url.includes('/videos?')) {
      app.setYouTubeCallReady();
      return { items: ['rnXIjl_Rzy4', 'j9Sa4uBGGQ0', 'r74OyneNmg8'].map(id => ({
        id, liveStreamingDetails: { actualStartTime: '2026-09-01T00:00:00Z' }, status: { privacyStatus: 'public', embeddable: true },
      })) };
    }
    if (options?.json === false) return '<rss><channel></channel></rss>';
    throw new Error('Guide provider unavailable in UI fixture');
  },
} } });
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5214, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    const id = `travel-${width}`;
    app.seedUser(member(id));
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width <= 768, isMobile: width < 600 });
    await context.addInitScript(token => {
      window.__travelPlayers = [];
      // Exercise the real player lifecycle without depending on third-party
      // ads, region restrictions, or autoplay permissions in CI.
      window.YT = { Player: class {
        constructor(mount, options) {
          this.frame = document.createElement('iframe');
          this.frame.title = 'Camera provider fixture';
          this.frame.style.cssText = 'width:100%;height:100%;min-height:180px;border:0;position:absolute;inset:0';
          this.frame.srcdoc = '<body style="margin:0;background:#244b3d;color:white;display:grid;place-items:center;height:100vh;font:16px sans-serif">Camera provider fixture</body>';
          mount.replaceWith(this.frame);
          this.id = options.videoId;
          this.playing = false;
          this.options = options;
          window.__travelPlayers.push(this);
          setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        getIframe() { return this.frame; }
        playVideo() { this.playing = true; }
        pauseVideo() { this.playing = false; }
        mute() {}
        unMute() {}
        destroy() { this.playing = false; this.frame.remove(); }
      } };
    }, app.token(id));
    const page = await context.newPage();
    await installAuditMember(page, app, id);
    const errors = [];
    let failSave = false;
    let failFeed = false;
    let failPagination = false;
    let hideCameras = false;
    let profileWrites = 0;
    let feedRequests = 0;
    const feedPages = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/profile', async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      profileWrites++;
      if (failSave) return route.fulfill({ status: 503, json: { error: 'Test save failure' } });
      await new Promise(resolve => setTimeout(resolve, 120));
      return route.continue();
    });
    await page.route('**/api/office/feed?*', async route => {
      feedRequests++;
      if (failFeed) return route.fulfill({ status: 503, json: { error: 'Test feed failure' } });
      const query = new URL(route.request().url()).searchParams;
      if (failPagination && (query.has('cursor') || Number(query.get('page')) > 1)) return route.fulfill({ status: 503, json: { error: 'Test pagination failure' } });
      if (!hideCameras) return route.continue();
      const response = await route.fetch();
      const data = await response.json();
      const params = new URL(route.request().url()).searchParams;
      feedPages.push({ page: params.get('page'), cursor: Boolean(params.get('cursor')), count: data.posts?.length, hasMore: data.hasMore });
      await route.fulfill({ json: { ...data, liveFeeds: [], travel: { ...data.travel, cameraStatus: 'degraded', camerasChecking: false } } });
    });
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=countries');
    const picker = page.getByRole('combobox', { name: 'Travel destination', exact: true });
    await picker.locator('option[value="US:Seattle"]').waitFor({ state: 'attached' });
    assert.equal(await picker.locator('option').count(), 92);
    const rail = page.getByRole('region', { name: 'Live travel cameras' });
    await rail.locator('.travel-live-loop-choice').first().waitFor();
    assert.equal(await rail.locator('.travel-live-loop-choice').count(), 3);
    await rail.scrollIntoViewIfNeeded();
    await rail.locator('.travel-live-loop-stage').hover();
    await page.waitForFunction(() => window.__travelPlayers.some(player => player.playing));
    const frameBox = await rail.locator('iframe').boundingBox();
    const copyBox = await rail.locator('.travel-live-loop-overlay').boundingBox();
    assert.ok(copyBox.y >= frameBox.y + frameBox.height - 2, 'camera controls and description stay below the picture');
    for (const city of ['New York', 'Tokyo', 'London']) {
      await rail.getByRole('button', { name: 'Next live camera', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="Travel destination"]').disabled);
      await page.waitForFunction(city => document.querySelector('.travel-live-loop-choice.active')?.textContent.includes(city), city);
      assert.equal(await page.getByRole('searchbox', { name: 'Travel city', exact: true }).inputValue(), city);
      assert.match(await rail.locator('.travel-live-loop-choice.active').textContent(), new RegExp(city));
    }
    assert.equal(profileWrites, 3, 'one save per camera selection');
    await picker.selectOption('US:Seattle');
    await page.waitForFunction(() => !document.querySelector('[aria-label="Travel destination"]').disabled);
    await rail.getByText('No verified camera in Seattle, United States. Showing worldwide views.').waitFor();
    assert.match(await page.getByRole('link', { name: 'City guide', exact: true }).getAttribute('href'), /\/Seattle$/);
    const heading = page.locator('.travel-content-heading');
    await page.getByRole('searchbox', { name: 'Travel city', exact: true }).fill('Not saved yet');
    assert.match(await heading.textContent(), /Seattle/);
    assert.doesNotMatch(await heading.textContent(), /Not saved yet/);
    await auditReload(page);
    await picker.locator('option[value="US:Seattle"]').waitFor({ state: 'attached' });
    await page.waitForFunction(() => document.querySelector('[aria-label="Travel destination"]').value === 'US:Seattle');
    failSave = true;
    await picker.selectOption('JP:Osaka');
    await page.getByText('Could not save this location. Your previous feed location is still active.').waitFor();
    assert.equal(await picker.inputValue(), 'US:Seattle');
    failSave = false;
    await picker.selectOption('JP:Tokyo');
    await page.waitForFunction(() => !document.querySelector('[aria-label="Travel destination"]').disabled);
    await rail.scrollIntoViewIfNeeded();
    await rail.locator('.travel-live-loop-stage').hover();
    await page.waitForFunction(() => window.__travelPlayers.some(player => player.frame.isConnected && player.playing));
    await page.evaluate(() => window.__travelPlayers.find(player => player.frame.isConnected).options.events.onError({ data: 100 }));
    await rail.getByText('This stream cannot play here.').waitFor();
    await rail.getByText('Playback unavailable', { exact: true }).waitFor();
    assert.equal(await rail.getByRole('link', { name: 'Open on YouTube', exact: true }).getAttribute('href'), 'https://www.youtube.com/watch?v=r74OyneNmg8');
    await picker.selectOption('GB:London');
    await page.waitForFunction(() => !document.querySelector('[aria-label="Travel destination"]').disabled);
    await rail.scrollIntoViewIfNeeded();
    await rail.locator('.travel-live-loop-stage').hover();
    await page.waitForFunction(() => window.__travelPlayers.filter(player => player.frame.isConnected).length === 1).catch(async error => {
      console.log(await page.evaluate(() => ({ players: window.__travelPlayers.map(player => ({ id: player.id, connected: player.frame.isConnected, playing: player.playing })), active: document.querySelector('.travel-live-loop-choice.active')?.textContent, frames: document.querySelectorAll('iframe').length, rail: document.querySelector('.travel-live-loop')?.textContent })));
      await page.screenshot({ path: path.join(root, '.cache/audit-ui/travel-failure.png') });
      throw error;
    });
    assert.equal(await rail.getByText('This stream cannot play here.').count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'no horizontal overflow');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/travel-${width}.png`) });
    hideCameras = true;
    failPagination = true;
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await rail.getByText('Live camera checks are temporarily unavailable.').waitFor();
    assert.equal(await picker.inputValue(), '');
    assert.equal(await rail.locator('iframe').count(), 0);
    await page.locator('[data-feed-has-more]').first().evaluate(element => element.scrollIntoView({ block: 'end' }));
    await page.getByText('More destinations could not load.').waitFor();
    const failedPageRequests = feedRequests;
    await page.waitForTimeout(700);
    assert.equal(feedRequests, failedPageRequests, 'paging failures do not cause an automatic retry loop');
    assert.ok(await page.locator('.post-card').count() > 0, 'loaded posts survive a paging outage');
    failPagination = false;
    await page.getByRole('button', { name: 'Retry more destinations', exact: true }).click();
    // Exhaust the actual API pagination and make sure the UI stops asking.
    for (let attempt = 0; attempt < 15; attempt++) {
      const feed = page.locator('[data-feed-has-more]').first();
      if (await feed.getAttribute('data-feed-has-more') === 'false') break;
      await feed.evaluate(element => element.scrollIntoView({ block: 'end' }));
      await page.waitForTimeout(500);
    }
    if (await page.locator('[data-feed-has-more]').first().getAttribute('data-feed-has-more') !== 'false') {
      console.log(JSON.stringify({ feedPages, state: await page.locator('[data-feed-has-more]').evaluate(el => ({ dataset: { ...el.dataset }, rect: el.getBoundingClientRect().toJSON(), scroll: document.scrollingElement.scrollTop, height: document.scrollingElement.scrollHeight, innerHeight })) }));
    }
    assert.equal(await page.locator('[data-feed-has-more]').first().getAttribute('data-feed-has-more'), 'false');
    const before = feedRequests;
    await page.waitForTimeout(700);
    assert.equal(feedRequests, before, 'no repeated exhausted-page requests');
    failFeed = true;
    await picker.selectOption('US:Seattle');
    await page.getByText('The feed request failed with HTTP 503.').waitFor();
    assert.equal(await page.locator('.travel-live-loop-choice').count(), 0, 'a failed location change cannot leave old cameras under the new location');
    failFeed = false;
    await page.getByRole('button', { name: /Try again|Retry/i }).first().click();
    await rail.getByText('Live camera checks are temporarily unavailable.').waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS: Travel city catalog, playback, selection, save failure, reload, clear, pagination and retry at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
