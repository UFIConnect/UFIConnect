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
app.seedUser(member('duration-member', { plan: 'pro' }));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5218, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
let browser;
try {
  await server.listen();
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width < 600, hasTouch: width <= 768 });
    let longFormConfigured = true, failOptions = false, narrated = false, refreshes = 0;
    const requests = [], errors = [];
    await context.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      if (/events|stream/.test(endpoint)) return route.abort();
      if (endpoint === '/generation/usage') return route.fulfill({ json: {
        period: { startsAt: '2026-10-01T00:00:00.000Z', resetsAt: '2099-11-01T00:00:00.000Z' },
        limits: { video: { limit: 20, used: 0, remaining: 20 }, image: { limit: 50, used: 0, remaining: 50 }, resume: { limit: 30, used: 0, remaining: 30 } },
      } });
      if (endpoint === '/command-center/media-options') return route.fulfill({ status: failOptions ? 503 : 200,
        json: failOptions ? { message: 'Temporarily unavailable' } : { video: { minSeconds: 4, maxSeconds: 300, plannedMaxSeconds: 1800, shortClipSeconds: [4, 8, 12], longFormConfigured } } });
      if (endpoint === '/command-center/history') return route.fulfill({ json: { items: [], hasMore: false } });
      if (endpoint === '/command-center/history/narrated-job/refresh') {
        refreshes += 1;
        return route.fulfill({ json: { item: { id: 'narrated-job', status: 'completed',
          output: { mediaType: 'video', mediaUrl: server.resolvedUrls.local[0] + 'media/preparation/professional-introduction.mp4' } } } });
      }
      if (endpoint === '/command-center/media-generate') {
        requests.push(route.request().postDataJSON());
        if (narrated) return route.fulfill({ status: 202, json: { provider: 'shotstack', mediaType: 'video',
          historyItem: { id: 'narrated-job', status: 'processing' } } });
        return route.fulfill({ json: { mediaType: 'video', mediaUrl: server.resolvedUrls.local[0] + 'media/preparation/professional-introduction.mp4' } });
      }
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await installAuditMember(page, app, 'duration-member');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=media');
    await page.getByRole('button', { name: /^video$/i }).click();
    await page.getByPlaceholder('Describe the video you want to create').fill('A narrated guide to city gardens, with images and captions.');
    const control = page.locator('.video-duration-control');
    assert.equal(await control.getAttribute('open'), null, 'Duration is one collapsed option rather than a list');
    await control.locator('summary').click();
    assert.equal(await control.getByRole('combobox').count(), 0);
    const length = page.getByLabel('Video length in seconds', { exact: true });
    const generate = page.getByRole('button', { name: 'Generate video', exact: true });
    await length.fill('300');
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Generate video')?.disabled);
    await generate.click();
    await page.getByRole('button', { name: 'Use in Cross-Post', exact: true }).waitFor();
    assert.equal(requests[0].durationSeconds, 300, 'Five minutes must not be silently truncated to 12 seconds');
    await length.fill('149'); await generate.click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Generate video')?.disabled);
    assert.equal(requests[1].durationSeconds, 149);
    narrated = true;
    await length.fill('300'); await generate.click();
    await page.getByRole('button', { name: 'Use in Cross-Post', exact: true }).waitFor();
    assert.equal(refreshes, 1, 'Asynchronous narrated videos poll their saved job and show the completed media');
    for (const invalid of ['301', '1800', '3', '8.5', '']) {
      await length.fill(invalid); assert.ok(await generate.isDisabled());
    }
    assert.equal(requests.length, 3, 'Locked or invalid lengths must not generate');
    await length.fill('300');
    assert.ok(await page.getByText('Longer videos, up to 30 minutes, are locked for now.', { exact: true }).isVisible());
    await control.screenshot({ path: path.join(root, `.cache/audit-ui/video-duration-${width}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    longFormConfigured = false;
    await page.getByRole('button', { name: /^image$/i }).click(); await page.getByRole('button', { name: /^video$/i }).click();
    await page.getByText(/This length needs a connected long-form video service/).waitFor();
    assert.ok(await generate.isDisabled());
    await page.locator('.video-duration-control summary').click();
    await length.fill('8'); assert.ok(await generate.isEnabled());
    failOptions = true;
    await page.getByRole('button', { name: /^image$/i }).click(); await page.getByRole('button', { name: /^video$/i }).click();
    const retry = page.getByRole('button', { name: 'Retry video availability', exact: true });
    await retry.waitFor(); assert.ok(await generate.isDisabled());
    failOptions = false; await retry.click();
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Generate video')?.disabled);
    assert.deepEqual(errors, []);
    console.log(`PASS: custom duration, exact 300-second request, five-minute lock, provider availability and retry at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
