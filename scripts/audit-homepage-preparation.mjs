import { installAuditMember, auditNavigate } from './audit-session.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { PREPARATION_VIDEOS } from '../web/src/data/preparationVideos.js';

const require = createRequire(import.meta.url);
require('../backend/generated-media');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-ui');
await fs.mkdir(output, { recursive: true });
const app = await createAppHarness({ connected: true });
app.seedUser(member('prep-audit', { resumeBuilderAddon: true }));
const proxy = prefix => ({ target: app.base, rewrite: value => value.replace(prefix, '') });
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/fallback') },
  server: { host: '127.0.0.1', port: 5199, strictPort: false, proxy: { '/api': proxy(/^\/api/), '/fallback': proxy(/^\/fallback/) } },
});
let browser;
let checks = 0;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width <= 768 });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await auditNavigate(page, server.resolvedUrls.local[0]);
      await page.getByRole('heading', { name: 'UFIconnect', exact: true }).waitFor();
      assert.match(await page.locator('.landing-hero-copy p').textContent(), /Find your people/);
      assert.equal(await page.getByRole('link', { name: 'Explore the feed', exact: true }).first().getAttribute('href'), '/global');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      assert.ok(await page.locator('.landing-product-shot img').evaluate(img => img.complete && img.naturalWidth > 0));
      await page.screenshot({ path: path.join(output, `homepage-copy-${width}.png`), fullPage: true });
      checks += 4;
      await installAuditMember(page, app, 'prep-audit');
      await auditNavigate(page, server.resolvedUrls.local[0] + 'resume-builder?tab=preparation');
      await page.getByRole('heading', { name: 'Interview preparation', exact: true }).waitFor();
      for (const lesson of PREPARATION_VIDEOS) {
        await page.locator('.resume-preparation-card-media').filter({ has: page.locator(`img[src*="/${lesson.slug}.png"]`) }).click();
        await page.waitForFunction(() => {
          const v = document.querySelector('.resume-preparation-player video');
          return v && v.readyState >= 2 && v.duration > 120 && v.currentTime > 0.15;
        });
        const video = page.locator('.resume-preparation-player video');
        assert.equal(await video.evaluate(v => v.muted), false);
        assert.equal(await video.locator('track').getAttribute('kind'), 'captions');
        await video.evaluate(v => { v.pause(); v.currentTime = v.duration / 2; });
        assert.ok(await video.evaluate(v => v.paused && v.currentTime > 60));
        await page.getByRole('button', { name: 'Close player', exact: true }).click();
        assert.equal(await page.locator('.resume-preparation-player video').count(), 0);
        checks += 4;
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      assert.deepEqual(errors, []);
      checks += 2;
      await page.screenshot({ path: path.join(output, `narrated-preparation-${width}.png`), fullPage: true });
      console.log(`PASS: homepage and narrated lessons at ${width}px`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `release-failure-${width}.png`) });
      throw error;
    } finally { await context.close(); }
  }
  console.log(`PASS: ${checks} homepage and narrated preparation checks`);
} finally {
  await browser?.close(); await server.close(); await app.close();
}
