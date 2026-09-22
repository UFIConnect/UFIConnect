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
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
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
      await route.fulfill({ json: { posts: Array.from({ length: 4 }, (_, i) => ({ id: prefix + i, source: 'reddit', title: 'Acoustic song ' + i, content: 'Original test media', mediaType: 'video', mediaUrl: server.resolvedUrls.local[0] + 'media/preparation/tailored-resume.mp4', sourceUrl: 'https://example.com/song', isExternal: true, createdAt: '2026-09-01T12:00:00Z' })), hasMore: false } });
    });
    await auditNavigate(page, server.resolvedUrls.local[0] + 'music');
    await page.getByRole('button', { name: 'Music', exact: true }).waitFor();
    await page.locator('[data-post-id="music-0"]').waitFor();
    const firstVideo = page.locator('[data-post-id="music-0"] video');
    const firstSlide = page.locator('[data-post-id="music-0"] .video-feed-slide');
    await page.waitForFunction(() => {
      const video = document.querySelector('[data-post-id="music-0"] video');
      return video && !video.paused && video.currentTime > 0;
    });
    await firstSlide.hover();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(400);
    assert.equal(await firstVideo.evaluate(video => video.paused), false, 'Music keeps playing after the pointer leaves');
    await firstSlide.click();
    assert.equal(await firstVideo.evaluate(video => video.paused), true, 'Music can still be paused manually');
    await page.mouse.move(0, 0);
    await firstSlide.hover();
    assert.equal(await firstVideo.evaluate(video => video.paused), true, 'Hovering does not undo a manual pause');
    await firstSlide.click();
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
    assert.ok(calls.some(p => p.get('bust') === '1'));
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
      const [response] = await Promise.all([
        page.waitForResponse(response => response.url().includes('/office/feed/music?')),
        page.getByRole('button', { name, exact: true }).click(),
      ]);
      return new URL(response.url()).searchParams;
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
    console.log(`PASS: Music playback without hover, manual pause, filter and scroll refresh at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
