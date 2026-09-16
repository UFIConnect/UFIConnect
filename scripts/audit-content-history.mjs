import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { PGlite } = require('../backend/node_modules/@electric-sql/pglite');
const { HISTORY_SCHEMA, createGeneratedContentStore, publicHistoryItem } = require('../backend/generated-content');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-ui');
await fs.mkdir(output, { recursive: true });
const pg = new PGlite();
await pg.exec(HISTORY_SCHEMA);
const app = await createAppHarness({ connected: true, query: (sql, params) => /generated_content/.test(sql) ? pg.query(sql, params) : { rows: [] } });
const store = createGeneratedContentStore(app.db);
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5193, strictPort: false,
    proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
let browser;
let checks = 0;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    console.log(`Checking content history at ${viewport.width}px`);
    const userId = `history-${viewport.width}`;
    app.seedUser(member(userId, { plan: 'pro' }));
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 900 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: {
      async writeText(text) { window.copiedHistoryText = text; },
    } }));
    let failHistory = false;
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.replace(/^\/api/, '');
      if (/events|stream/.test(endpoint)) return route.abort();
      if (endpoint === '/social/platforms') return route.fulfill({ json: {
        connected: { bluesky: 'preview.bsky.social' },
        platforms: { bluesky: { configured: true, crossPost: { supported: true, media: 'native-image' } } },
      } });
      if (endpoint === '/command-center/history' && failHistory) return route.fulfill({ status: 503, json: { message: 'History is temporarily unavailable.' } });
      if (endpoint === '/command-center/media-generate') {
        const entry = await store.create(userId, { kind: 'image', prompt: route.request().postDataJSON().prompt,
          output: { mediaUrl: base + 'icon-512.png', mediaType: 'image' } });
        return route.fulfill({ json: { ...entry.output, historyItem: publicHistoryItem(entry) } });
      }
      return route.continue();
    });
    const page = await context.newPage();
    await installAuditMember(page, app, userId);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(20000);
    await auditNavigate(page, base + 'command-center?tab=content');
    await page.locator('textarea').first().fill('A practical design community launch');
    await page.getByRole('button', { name: 'Draft with AI', exact: true }).click();
    await page.locator('.generated-history-item').waitFor();
    await page.locator('textarea').nth(1).fill('City gardens');
    await page.getByRole('button', { name: 'Draft hashtags', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.generated-history-item').length === 2, null, { timeout: 20000 });
    await page.getByRole('tab', { name: 'Media Studio', exact: true }).click();
    await page.getByRole('heading', { name: 'Create media', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'AI Content Hub', exact: true }).click();
    await page.locator('.generated-history-item').first().waitFor();
    assert.equal(await page.locator('.generated-history-item').count(), 2);
    await auditReload(page);
    await page.locator('.generated-history-item').first().waitFor();
    assert.equal(await page.locator('.generated-history-item').count(), 2);
    checks += 3;

    await page.getByRole('combobox', { name: 'Content type' }).selectOption('draft');
    await page.locator('.generated-history-row', { hasText: 'A practical design community launch' }).click();
    await page.locator('.generated-history-detail').waitFor();
    assert.equal(await page.locator('.generated-history-detail .generated-history-text').count(), 3);
    await page.getByRole('button', { name: 'Copy all', exact: true }).click();
    assert.match(await page.evaluate(() => window.copiedHistoryText), /design community/i);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download saved content', exact: true }).click();
    assert.match((await download).suggestedFilename(), /\.txt$/);
    await page.getByRole('button', { name: 'Reuse prompt', exact: true }).click();
    assert.equal(await page.locator('textarea').first().inputValue(), 'A practical design community launch');
    checks += 4;
    await page.locator('.generated-history').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.screenshot({ path: path.join(output, `content-history-${viewport.width}.png`), fullPage: true });
    checks++;

    await page.getByRole('tab', { name: 'Media Studio', exact: true }).click();
    await page.getByRole('heading', { name: 'Create media', exact: true }).waitFor();
    await page.locator('textarea').fill('UFIconnect studio artwork');
    await page.getByRole('button', { name: 'Generate image', exact: true }).click();
    await page.locator('.generated-history-item').waitFor();
    await auditReload(page);
    await page.locator('.generated-history-row', { hasText: 'UFIconnect studio artwork' }).click();
    await page.locator('.generated-history-detail > img').evaluate(image => image.decode());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.locator('.generated-history').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `media-history-${viewport.width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Use in Cross-Post', exact: true }).click();
    await page.getByAltText('Selected for cross-posting').waitFor();
    checks += 3;

    const video = await store.create(userId, { kind: 'video', prompt: 'A short preparation video', output: { mediaUrl: base + 'media/preparation/professional-introduction.mp4', mediaType: 'video' } });
    assert.ok(video.id);
    app.users.find(user => user.id === userId).plan = 'free';
    await auditNavigate(page, base + 'command-center?tab=media');
    // The simulated server-side plan change requires a fresh profile. A
    // same-document tab change intentionally keeps the current UI session.
    await auditReload(page);
    await page.locator('.generated-history-row', { hasText: 'A short preparation video' }).click();
    await page.waitForFunction(() => document.querySelector('.generated-history-detail video')?.readyState >= 1, null, { timeout: 20000 });
    assert.equal(await page.getByRole('button', { name: 'Generate image', exact: true }).count(), 0);
    assert.ok(await page.getByRole('button', { name: 'Download saved content' }).isVisible());
    checks++;

    failHistory = true;
    await page.getByRole('button', { name: 'Refresh history', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'History is temporarily unavailable.' }).waitFor();
    assert.equal(await page.getByText('No saved content yet.', { exact: true }).count(), 0);
    failHistory = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.locator('.generated-history-row').first().waitFor();
    assert.deepEqual(errors, []);
    checks++;
    await context.close();
  }
  console.log(`PASS: ${checks} content-history browser checks across desktop, tablet and mobile`);
} catch (error) {
  console.error('History browser audit failed:', error);
  throw error;
} finally {
  await browser?.close(); await app.close(); await server.close(); await pg.close();
}
