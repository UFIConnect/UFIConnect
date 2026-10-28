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
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await createAppHarness();
app.seedUser(member('music-audit'));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5206, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, hasTouch: width < 1000, isMobile: width < 600 });
    const page = await context.newPage();
    await installAuditMember(page, app, 'music-audit');
    const calls = [];
    await page.route('**/api/office/feed/music?*', async route => {
      calls.push(new URL(route.request().url()).searchParams);
      const prefix = calls.at(-1).get('genre') ? 'genre-' : 'music-';
      // This is our local fixture asset; source labels exercise filter behavior only.
      await route.fulfill({ json: { posts: Array.from({ length: 4 }, (_, i) => ({ id: prefix + i, source: 'reddit', title: 'Acoustic song ' + i, content: 'Original test media', mediaType: 'video', directPlaybackAuthorized: true, mediaUrl: server.resolvedUrls.local[0] + 'media/preparation/tailored-resume.mp4', sourceUrl: 'https://example.com/song', isExternal: true, createdAt: '2026-09-01T12:00:00Z' })), hasMore: false } });
    });
    await auditNavigate(page, server.resolvedUrls.local[0] + 'music');
    await page.getByRole('button', { name: 'Music', exact: true }).waitFor();
    await page.locator('[data-post-id="music-0"]').waitFor();
    const firstVideo = page.locator('[data-post-id="music-0"] video');
    const firstSlide = page.locator('[data-post-id="music-0"] [data-video-media]');
    await page.waitForFunction(() => {
      const video = document.querySelector('[data-post-id="music-0"] video');
      return video && !video.paused && video.currentTime > 0;
    });
    await firstSlide.hover();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    assert.equal(await firstVideo.evaluate(video => video.paused), false, 'Music keeps playing after the pointer leaves');
    await page.locator('[data-post-id="music-0"]').getByRole('button', { name: 'Pause video', exact: true }).click();
    assert.equal(await firstVideo.evaluate(video => video.paused), true, 'Music can still be paused manually');
    await page.mouse.move(0, 0);
    await firstSlide.hover();
    assert.equal(await firstVideo.evaluate(video => video.paused), true, 'Hovering does not undo a manual pause');
    await page.locator('[data-post-id="music-0"]').getByRole('button', { name: 'Play video', exact: true }).click();
    const scroll = page.locator('[data-video-feed-scroll]');
    await scroll.evaluate(el => el.scrollTo(0, el.clientHeight));
    await page.waitForFunction(() => document.querySelector('[data-video-feed-scroll]').scrollTop > 0);
    await page.mouse.move(0, 0);
    await page.waitForFunction(() => {
      const first = document.querySelector('[data-post-id="music-0"] video');
      const next = document.querySelector('[data-post-id="music-1"] video');
      return first?.paused && next && !next.paused && next.currentTime > 0;
    });
    await page.waitForTimeout(250);
    await scroll.evaluate(el => el.scrollTo(0, 0));
    await page.waitForTimeout(500);
    assert.equal(calls.some(p => p.get('bust') === '1'), false, 'Returning to the first song does not refresh the queue');
    // A deliberate wheel pull at the top refreshes. Find visible feed chrome
    // outside controls, media, and independently scrolling caption panels.
    const pullPoint = await scroll.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      for (let y = bounds.y + 4; y < Math.min(bounds.bottom, innerHeight) - 4; y += 16) {
        for (const x of [bounds.x + 4, bounds.right - 4, bounds.x + bounds.width / 2]) {
          const target = document.elementFromPoint(x, y);
          if (!target || !el.contains(target) || target.closest('button,a,input,textarea,select,video,audio,iframe,[role="slider"],[role="button"]')) continue;
          let nested = false;
          for (let node = target; node && node !== el; node = node.parentElement) {
            if (/^(auto|scroll|overlay)$/.test(getComputedStyle(node).overflowY)) { nested = true; break; }
          }
          if (!nested) return { x, y };
        }
      }
      return null;
    });
    assert.ok(pullPoint, 'Music exposes feed chrome for an intentional refresh gesture');
    await page.mouse.move(pullPoint.x, pullPoint.y);
    const refreshResponse = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/office/feed/music') && url.searchParams.get('bust') === '1';
    });
    await page.mouse.wheel(0, -140);
    assert.equal((await refreshResponse).status(), 200, 'The explicit refresh receives its new feed page');
    assert.equal(calls.filter(p => p.get('bust') === '1').length, 1, 'One explicit pull submits one refresh request');
    await page.getByRole('button', { name: 'Filter videos', exact: true }).click();
    await page.getByRole('button', { name: 'Acoustic', exact: true }).click();
    await page.waitForTimeout(300);
    assert.ok(calls.some(p => p.get('genre') === 'Acoustic'));
    await page.getByRole('button', { name: 'Done', exact: true }).first().click();
    await page.locator('[data-post-id="genre-0"]').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/music-${width}.png`) });
    await page.getByRole('button', { name: 'Filter videos', exact: true }).click();
    const selectAndRead = async (name) => {
      const [request] = await Promise.all([
        page.waitForRequest(request => {
          if (!request.url().includes('/office/feed/music?')) return false;
          const params = new URL(request.url()).searchParams;
          if (name === 'Clear platforms') return !params.has('source') && !params.has('sources');
          if (name === 'Clear genres') return !params.has('genre');
          if (name === 'Clear video topics') return !params.has('topics');
          if (name === 'YouTube') return params.get('source') === 'youtube';
          return params.get('topics') === 'Open Source';
        }),
        page.getByRole('button', { name, exact: true }).click(),
      ]);
      return new URL(request.url()).searchParams;
    };
    await selectAndRead('YouTube');
    await selectAndRead('Open Source');
    const clearedPlatforms = await selectAndRead('Clear platforms');
    assert.equal(clearedPlatforms.has('source') || clearedPlatforms.has('sources'), false);
    assert.equal(clearedPlatforms.get('genre'), 'Acoustic');
    assert.equal(clearedPlatforms.get('topics'), 'Open Source');
    const clearedGenres = await selectAndRead('Clear genres');
    assert.equal(clearedGenres.has('genre'), false);
    assert.equal(clearedGenres.get('topics'), 'Open Source');
    const clearedTopics = await selectAndRead('Clear video topics');
    assert.equal(clearedTopics.has('topics'), false);
    assert.ok(await page.getByRole('button', { name: 'Clear platforms', exact: true }).isDisabled());
    assert.ok(await page.getByRole('button', { name: 'Clear genres', exact: true }).isDisabled());
    assert.ok(await page.getByRole('button', { name: 'Clear video topics', exact: true }).isDisabled());
    console.log(`PASS: Music playback without hover, manual pause, filters, ordinary return without refresh and explicit wheel refresh at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
