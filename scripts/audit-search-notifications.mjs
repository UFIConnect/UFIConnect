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
app.seedUser(member('social-audit'));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5207, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, hasTouch: width <= 768, isMobile: width < 600 });
    await context.addInitScript(t => localStorage.setItem('pc_token', t), app.token('social-audit'));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let failRead = true;
    let read = false;
    let accepted = false;
    const searches = [];
    await page.route('**/api/notifications', route => route.fulfill({ json: { notifications: [
      { id: 'like-1', type: 'like', user: { id: 'maya', name: 'Maya Chen' }, targetId: 'post-1', preview: 'A new perspective on building thoughtful products.', read, createdAt: new Date().toISOString() },
      { id: 'request-1', type: 'connection_request', user: { id: 'alex', name: 'Alex Morgan' }, read: true, createdAt: new Date().toISOString() },
      { id: 'system-1', type: 'system', user: null, read: true, createdAt: '2025-01-01T00:00:00Z' },
    ] } }));
    await page.route('**/api/notifications/mark-read', route => { if (!failRead) read = true; return route.fulfill({ status: failRead ? 503 : 200, json: { ok: !failRead } }); });
    await page.route('**/api/users/alex/connect', route => { accepted = true; return route.fulfill({ json: { ok: true } }); });
    await page.route('**/api/users/search?*', route => { searches.push(new URL(route.request().url()).searchParams.get('q')); return route.fulfill({ json: { users: [{ id: 'maya', name: 'Maya Chen', title: 'Software engineer', role: 'Developer', skills: [], interests: [] }], totalCount: 1, registeredCount: 1, hasMore: false, countSource: 'database' } }); });
    await page.goto(server.resolvedUrls.local[0] + 'notifications');
    await page.locator('.notification-inbox').getByText('Maya Chen').waitFor();
    let inbox = page.locator('.notification-inbox').first();
    if (width <= 768) {
      await page.getByRole('button', { name: 'Alerts', exact: true }).click();
      inbox = page.locator('#mobile-alerts-popup .notification-inbox');
      await inbox.getByText('Maya Chen').waitFor();
    }
    await inbox.getByRole('button', { name: 'Unread', exact: true }).click();
    assert.equal(await inbox.locator('.inbox-item').count(), 1);
    await inbox.getByRole('button', { name: 'Mark all as read' }).click();
    await page.getByText('Could not mark notifications read. Please try again.').waitFor();
    assert.equal(await inbox.locator('.inbox-item.unread').count(), 1);
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    failRead = false;
    await inbox.getByRole('button', { name: 'Mark all as read' }).click();
    await inbox.getByText('You are all caught up').waitFor();
    await inbox.getByRole('button', { name: 'Requests', exact: true }).click();
    await inbox.getByRole('button', { name: 'Accept', exact: true }).click();
    await inbox.getByText('No pending requests').waitFor();
    assert.ok(accepted);
    await inbox.getByRole('button', { name: 'All', exact: true }).click();
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/notifications-${width}.png`) });
    if (width <= 768) {
      await page.getByRole('button', { name: 'Close alerts', exact: true }).click();
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.locator('#mobile-search-popup').getByRole('tab', { name: 'People', exact: true }).click();
      await page.locator('#mobile-search-popup').getByRole('searchbox').fill('software engineer');
      await page.locator('#mobile-search-popup').getByRole('button', { name: 'Search', exact: true }).click();
    } else await page.goto(server.resolvedUrls.local[0] + 'search?tab=people&q=software%20engineer');
    await page.getByRole('searchbox', { name: 'Search people', exact: true }).waitFor();
    await page.locator('.search-page-shell').getByText('Maya Chen', { exact: true }).waitFor();
    assert.ok(searches.includes('software engineer'));
    assert.equal(await page.getByRole('searchbox', { name: 'Search people', exact: true }).inputValue(), 'software engineer');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/search-${width}.png`) });
    assert.deepEqual(errors, []);
    console.log(`PASS: Search and notification actions at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
