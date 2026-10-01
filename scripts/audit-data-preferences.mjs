import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';

const require = createRequire(import.meta.url);
require('../backend/generated-media');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await createAppHarness();
app.seedUser(member('data-preferences-audit'));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5238, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 600, isMobile: width < 600 });
    await context.addInitScript(() => {
      window.__previewPlayers = [];
      window.YT = { Player: class {
        constructor(host, options) {
          this.frame = document.createElement('iframe'); this.frame.title = 'Preview player fixture'; this.frame.srcdoc = '<body>Preview</body>';
          host.replaceWith(this.frame); this.options = options; this.playing = false;
          window.__previewPlayers.push(this); setTimeout(() => options.events.onReady({ target: this }), 0);
        }
        getIframe() { return this.frame; }
        playVideo() { this.playing = true; }
        pauseVideo() { this.playing = false; }
        mute() {} unMute() {}
        destroy() { this.playing = false; this.frame.remove(); }
      } };
    });
    const page = await context.newPage();
    await installAuditMember(page, app, 'data-preferences-audit');
    const metrics = [];
    const google = [];
    const mediaRequests = [];
    let previewKind = 'file';
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (/googletagmanager|google-analytics/.test(url.hostname)) { google.push(url.href); return route.abort(); }
      if (url.pathname.startsWith('/api/analytics/')) {
        metrics.push({ path: url.pathname, body: request.postDataJSON(), headers: await request.allHeaders() });
        return route.fulfill({ status: 204 });
      }
      if (url.pathname === '/api/office/feed') return route.fulfill({ json: { posts: [{
        id: 'data-preview-' + previewKind, source: previewKind === 'youtube' ? 'youtube' : 'reddit', title: 'Synthetic preview ' + previewKind,
        content: 'A synthetic preview for preference checks.', mediaType: 'video',
        // The direct-file case uses our repository fixture with explicit playback rights.
        directPlaybackAuthorized: previewKind === 'file',
        mediaUrl: previewKind === 'youtube' ? 'https://www.youtube.com/watch?v=abcdefghijk' : previewKind === 'vimeo' ? 'https://vimeo.com/123456789' : base + 'media/preparation/tailored-resume.mp4',
        sourceUrl: previewKind === 'youtube' ? 'https://www.youtube.com/watch?v=abcdefghijk' : 'https://example.invalid/video', isExternal: true, createdAt: new Date().toISOString(),
      }], hasMore: false } });
      if (url.pathname.includes('/media/preparation/')) mediaRequests.push(url.href);
      if (url.hostname === 'player.vimeo.com') return route.fulfill({ contentType: 'text/html', body: '<body>Vimeo fixture</body>' });
      if (/stream|events/.test(url.pathname)) return route.abort();
      return route.fallback();
    });
    await auditNavigate(page, base + 'settings');
    await page.getByRole('button', { name: 'Data and privacy', exact: true }).click();
    const dataSaver = page.getByRole('switch', { name: 'Data saver for feed previews', exact: true });
    const autoplay = page.getByRole('switch', { name: 'Autoplay feed previews', exact: true });
    const diagnostics = page.getByRole('switch', { name: 'Optional performance diagnostics', exact: true });
    const googleToggle = page.getByRole('switch', { name: 'Optional Google Analytics', exact: true });
    check(await dataSaver.getAttribute('aria-checked') === 'false', 'Data saver starts off');
    check(await autoplay.getAttribute('aria-checked') === 'true', 'Preview autoplay starts on');
    check(await diagnostics.getAttribute('aria-checked') === 'false' && await googleToggle.getAttribute('aria-checked') === 'false', 'Optional diagnostics and Google start off');
    check(await page.getByText('Always active', { exact: true }).isVisible(), 'Core metrics disclose their always-active behavior');
    await page.evaluate(() => dispatchEvent(new ErrorEvent('error', { message: 'PRIVATE_PASSWORD_SENTINEL', error: new Error('PRIVATE_PASSWORD_SENTINEL') })));
    await page.waitForTimeout(80);
    check(!metrics.some(metric => metric.path.endsWith('/performance')), 'Diagnostics submit nothing before opt-in');
    check(google.length === 0, 'Required service metrics do not enable Google');
    await diagnostics.click();
    await page.evaluate(() => dispatchEvent(new ErrorEvent('error', { message: 'PRIVATE_PASSWORD_SENTINEL', error: new Error('PRIVATE_PASSWORD_SENTINEL') })));
    await waitUntil(() => metrics.some(metric => metric.path.endsWith('/performance')));
    const diagnostic = metrics.find(metric => metric.path.endsWith('/performance'));
    check(JSON.stringify(diagnostic.body) === JSON.stringify({ category: 'settings', kind: 'client_error', code: 'script_error' }), 'Diagnostics contain only approved categories');
    await diagnostics.click();
    const beforeRevoke = metrics.filter(metric => metric.path.endsWith('/performance')).length;
    await page.evaluate(() => dispatchEvent(new Event('unhandledrejection')));
    await page.waitForTimeout(80);
    check(metrics.filter(metric => metric.path.endsWith('/performance')).length === beforeRevoke, 'Turning diagnostics off stops subsequent reports');

    await autoplay.click();
    await dataSaver.click();
    check(await autoplay.isDisabled() && await autoplay.getAttribute('aria-checked') === 'false', 'Data saver overrides preview autoplay');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/data-preferences-${width}.png`) });
    await auditReload(page);
    await page.getByRole('button', { name: 'Data and privacy', exact: true }).click();
    check(await dataSaver.getAttribute('aria-checked') === 'true' && await autoplay.isDisabled(), 'Local choices survive reload and sign-in');

    const beforeMedia = mediaRequests.length;
    await auditNavigate(page, base + '?feed=feed&all=1');
    const card = page.locator('.post-card').filter({ hasText: 'Synthetic preview file' });
    await card.waitFor(); await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    check(await card.locator('video').count() === 0 && mediaRequests.length === beforeMedia, 'Data saver prevents automatic file-video download');
    await card.getByText('Open video to play', { exact: false }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('video')].some(video => !video.paused && video.currentTime > 0));
    check(mediaRequests.length > beforeMedia, 'Explicitly opening a video still downloads and plays it');
    await page.keyboard.press('Escape');

    await auditNavigate(page, base + 'settings');
    await page.getByRole('button', { name: 'Data and privacy', exact: true }).click();
    await dataSaver.click();
    check(await autoplay.getAttribute('aria-checked') === 'false' && !await autoplay.isDisabled(), 'Data saver preserves the user’s separate autoplay choice');
    await auditNavigate(page, base + '?feed=feed&all=1');
    await card.waitFor(); await card.scrollIntoViewIfNeeded(); await card.hover();
    await page.waitForTimeout(150);
    check(await card.locator('video').evaluate(video => video.paused), 'Disabling autoplay keeps visible feed previews paused');
    await page.evaluate(async () => { const prefs = await import('/src/preferences/dataPreferences.js'); prefs.setDataPreferences({ autoplayPreviews: true }); });
    await page.waitForFunction(() => { const video = [...document.querySelectorAll('.post-card')].find(card => card.textContent.includes('Synthetic preview file'))?.querySelector('video'); return video && !video.paused && video.currentTime > 0; });
    check(true, 'Enabling autoplay takes effect on an already mounted feed preview');

    for (const kind of ['youtube', 'vimeo']) {
      previewKind = kind;
      await page.evaluate(async () => { const prefs = await import('/src/preferences/dataPreferences.js'); prefs.setDataPreferences({ dataSaver: true }); });
      await auditReload(page);
      const embedCard = page.locator('.post-card').filter({ hasText: 'Synthetic preview ' + kind });
      await embedCard.waitFor(); await embedCard.scrollIntoViewIfNeeded(); await embedCard.hover();
      check(await embedCard.locator('iframe').count() === 0, `Data saver defers ${kind} player loading`);
      await embedCard.getByRole('button', { name: 'Play feed video preview', exact: true }).click();
      await embedCard.locator('iframe').waitFor();
      check(true, `An explicit tap starts the ${kind} preview`);
    }
    check(metrics.some(metric => metric.path.endsWith('/pageview')), 'Aggregate page counts remain active independently of optional choices');
    for (const metric of metrics) {
      check(!metric.headers.authorization && !metric.headers.referer && !metric.headers.cookie, 'Metrics omit account credentials and referrers');
      if (metric.path.endsWith('/pageview')) check(Object.keys(metric.body).join() === 'category', 'Required page counts have only a page category');
    }
    check(!JSON.stringify(metrics).includes('PRIVATE_PASSWORD_SENTINEL'), 'No error secrets reach metric requests');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Controls and feed fit the viewport');
    await auditNavigate(page, base + 'settings');
    await page.getByRole('button', { name: 'Data and privacy', exact: true }).click();
    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('uficonnect.analytics.')) throw new DOMException('Storage blocked', 'QuotaExceededError');
        return originalSetItem.call(this, key, value);
      };
    });
    await googleToggle.click();
    check(await googleToggle.getAttribute('aria-checked') === 'false', 'A Google choice that cannot be saved stays off');
    check(await page.locator('.data-privacy-settings [role="status"]').filter({ hasText: 'could not save your choice' }).isVisible(), 'Settings renders save errors independently of the unchanged consent value');
    console.log(`PASS: data preferences, optional diagnostics and real feed preview behavior at ${width}px`);
    await context.close();
  }
  console.log(`${checks} data preference browser checks passed.`);
} finally { await browser?.close(); await server.close(); await app.close(); }

async function waitUntil(condition) {
  for (let index = 0; index < 100; index++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  assert.ok(condition(), 'Expected metric did not arrive');
}
