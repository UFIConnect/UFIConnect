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
const app = await createAppHarness({ connected: true });
const platforms = {
  reddit: { name: 'Reddit', configured: true }, youtube: { name: 'YouTube', configured: true },
  wired: { name: 'WIRED', configured: false, category: 'publication' },
  mittr: { name: 'MIT Technology Review', configured: false, category: 'publication' },
  instagram: { name: 'Instagram', configured: true, commandCenterOnly: true },
  linkedin: { name: 'LinkedIn', configured: true, forceComingSoon: true, commandCenterOnly: true },
  indeed: { name: 'Indeed', category: 'career', configured: false },
};
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5210, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    const id = `directory-${width}`;
    app.seedUser(member(id, { plan: 'pro', roleSettings: { feedSourceFavorites: { feed: ['youtube', 'reddit'], following: [] } } }));
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width <= 768, isMobile: width < 600 });
    await context.route('https://www.youtube.com/', route => route.fulfill({ contentType: 'text/html', body: '<title>YouTube test destination</title>' }));
    const page = await context.newPage();
    await installAuditMember(page, app, id);
    const errors = [];
    let authorizationRequests = 0;
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/office/feed?*', route => route.fulfill({ json: { posts: [], hasMore: false, nativeUficonnectIncluded: true } }));
    await page.route('**/api/social/platforms', route => route.fulfill({ json: { platforms, connected: { reddit: true } } }));
    await page.route('**/api/feed/sources?*', route => route.fulfill({ json: {
      sources: [{ id: 'reddit', postCount: 3, lastFetch: new Date().toISOString(), samplePosts: [] },
        { id: 'audit-source', postCount: 0, samplePosts: [] }],
    } }));
    await page.route('**/auth/social/youtube/start*', route => {
      authorizationRequests += 1;
      return route.fulfill({ status: 503, json: { error: 'Test provider unavailable' } });
    });
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=feed&all=1');
    if (width <= 768) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const tools = page.locator(width <= 768 ? '#mobile-feed-drawer .home-feed-side-tools' : '.home-feed-right-tabs .home-feed-side-tools');
    const sourceTrigger = tools.getByRole('button', { name: /Feed sources/ });
    if (await sourceTrigger.getAttribute('aria-expanded') !== 'true') await sourceTrigger.click();
    await tools.locator('.home-feed-source-name').first().waitFor();
    const names = await tools.locator('.home-feed-source-name').allTextContents();
    assert.equal(new Set(names).size, names.length, 'Each source appears once');
    assert.equal(names[0], 'Reddit');
    assert.ok(!names.includes('YouTube'), 'Default category shows only social sources');
    assert.equal(await tools.getByRole('combobox', { name: 'Filter feed sources' }).locator('option[value="all"]').count(), 0);
    assert.equal(await tools.getByRole('searchbox').count(), 0);
    assert.equal(await tools.getByRole('button', { name: 'Select favorites', exact: true }).count(), 0);
    await tools.getByRole('combobox', { name: 'Filter feed sources' }).selectOption('career');
    assert.ok((await tools.locator('.home-feed-source-name').allTextContents()).includes('USAJobs'));
    assert.ok(!(await tools.locator('.home-feed-source-name').allTextContents()).includes('Reddit'));
    await tools.getByRole('combobox', { name: 'Filter feed sources' }).selectOption('favorites');
    assert.deepEqual(await tools.locator('.home-feed-source-name').allTextContents(), ['Reddit', 'YouTube']);
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/source-directory-${width}.png`) });
    await tools.getByRole('button', { name: /Connected accounts/ }).click();
    await tools.getByRole('link', { name: 'Open Reddit website' }).waitFor();
    assert.equal(await tools.getByRole('searchbox').count(), 0, 'Connected accounts has no search bar');
    assert.equal(await tools.getByRole('link', { name: 'Open Instagram website' }).count(), 0);
    assert.equal(await tools.getByRole('link', { name: 'Open Indeed website' }).count(), 0);
    await tools.getByRole('combobox', { name: 'Filter accounts' }).selectOption('connected');
    assert.equal(await tools.locator('.home-connected-account-row').count(), 1);
    await tools.getByRole('combobox', { name: 'Filter accounts' }).selectOption('available');
    assert.equal(await tools.locator('.home-connected-account-row').count(), 1);
    const popupPromise = context.waitForEvent('page');
    await tools.getByRole('link', { name: 'Open YouTube website' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.equal(popup.url(), 'https://www.youtube.com/');
    assert.equal(await popup.evaluate(() => window.opener), null);
    await popup.close();
    assert.equal(authorizationRequests, 0, 'Opening a website must not start account authorization');
    await tools.getByRole('button', { name: 'Connect', exact: true }).click();
    await tools.getByRole('alert').getByText('Test provider unavailable').waitFor();
    assert.ok(authorizationRequests >= 1, 'Connect uses OAuth, including the API retry on a temporary outage');
    await tools.getByRole('button', { name: 'Retry', exact: true }).click();
    await tools.getByRole('link', { name: 'Open YouTube website' }).waitFor();
    await tools.getByRole('combobox', { name: 'Filter accounts' }).selectOption('all');
    if (width <= 768) {
      const row = tools.locator('.home-connected-account-row').filter({ has: page.getByRole('link', { name: 'Open YouTube website' }) });
      const rowBox = await row.boundingBox();
      const actionBox = await row.locator('.source-directory-account-actions').boundingBox();
      const nameBox = await row.locator('.home-connected-account-name').boundingBox();
      assert.ok(rowBox.height <= 80, 'Mobile account rows remain compact');
      assert.ok(nameBox.x + nameBox.width <= actionBox.x, 'Account names do not overlap actions');
      assert.ok(actionBox.x + actionBox.width <= rowBox.x + rowBox.width + 1, 'Account actions stay inside the row');
    }
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/account-directory-${width}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await auditNavigate(page, server.resolvedUrls.local[0] + 'sources');
    await page.getByRole('heading', { name: 'Feed Sources', exact: true }).waitFor();
    await page.getByRole('switch').first().waitFor();
    assert.equal(await page.getByPlaceholder(/Search sources/).count(), 0, 'Full Feed Sources page has no search bar');
    assert.equal(await page.getByRole('searchbox').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Select favorites', exact: true }).count(), 0);
    assert.ok(await page.getByRole('switch').count() > 30, 'Removing search does not hide sources');
    await page.getByText('audit-source', { exact: true }).waitFor();
    const sourceSave = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/profile'));
    await page.getByRole('switch').first().click();
    assert.equal((await sourceSave).status(), 200);
    await page.getByRole('button', { name: 'Enable all', exact: true }).waitFor();
    await auditReload(page);
    await page.getByRole('button', { name: 'Enable all', exact: true }).waitFor();
    assert.equal(await page.getByRole('switch').first().getAttribute('aria-checked'), 'false');
    await page.getByRole('button', { name: 'Enable all', exact: true }).click();
    await page.getByRole('button', { name: 'Enable all', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('switch', { checked: false }).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/sources-page-${width}.png`) });
    await auditNavigate(page, server.resolvedUrls.local[0] + 'connected-accounts');
    await page.getByRole('combobox', { name: 'Filter accounts' }).selectOption('available');
    assert.equal(await page.getByRole('searchbox', { name: 'Search accounts', exact: true }).count(), 0);
    await page.getByRole('link', { name: 'Open YouTube website' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open Reddit website' }).count(), 0);
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/accounts-page-${width}.png`) });
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=accounts');
    await page.getByRole('combobox', { name: 'Filter accounts' }).selectOption('available');
    assert.equal(await page.getByRole('searchbox', { name: 'Search accounts', exact: true }).count(), 0);
    await page.getByRole('link', { name: 'Open Instagram website' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open YouTube website' }).count(), 0);
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/member-accounts-${width}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    if (width === 390) {
      app.seedUser(member('business-directory', { plan: 'business' }));
      await installAuditMember(page, app, 'business-directory');
      await auditNavigate(page, server.resolvedUrls.local[0] + 'connected-accounts');
      await page.getByRole('link', { name: 'Open Indeed website' }).waitFor();
      assert.equal(await page.locator('.account-site-link').count(), 10, 'Business includes all career destinations');
      assert.equal(await page.getByRole('link', { name: 'Open Reddit website' }).count(), 0);
      await page.getByRole('combobox', { name: 'Filter accounts' }).selectOption('connected');
      await page.getByRole('status').getByText('No matching accounts', { exact: true }).waitFor();
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: Source categories, favorites, account filters and distinct site/OAuth actions at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
