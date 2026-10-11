import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';
import assert from 'node:assert/strict';
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
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5208, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
async function assertEnabledFirst(panel) {
  const rows = await panel.getByRole('switch').evaluateAll(elements => elements.map(element => ({
    name: element.getAttribute('aria-label'),
    enabled: element.getAttribute('aria-checked') === 'true',
  })));
  assert.equal(new Set(rows.map(row => row.name)).size, rows.length, 'Each source appears once');
  assert.deepEqual(rows.map(row => row.enabled), rows.map(row => row.enabled).sort((a, b) => Number(b) - Number(a)),
    'Every enabled source precedes every disabled source across favorites and categories');
  return rows;
}
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 768, 390, 320]) {
    const id = `favorites-${width}`;
    const favorites = { feed: ['reddit', 'youtube'], following: ['uficonnect'] };
    app.seedUser(member(id, { roleSettings: { disabledSources: ['github', 'reddit'], feedSourceFavorites: favorites } }));
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width <= 768, isMobile: width < 600 });
    const page = await context.newPage();
    await installAuditMember(page, app, id);
    let failSave = false;
    let heldSave = null;
    await page.route('**/api/profile', async route => {
      if (route.request().method() !== 'PATCH') return route.continue();
      if (heldSave) await heldSave;
      return failSave ? route.fulfill({ status: 503, json: { error: 'Temporary outage' } }) : route.continue();
    });
    await page.route('**/api/office/feed?*', route => route.fulfill({ json: { posts: [], hasMore: false, nativeUficonnectIncluded: true } }));
    const open = async (mode = 'Home') => {
      // Same-document navigation can briefly retain the previous open panel.
      // Wait for the requested feed before opening its source controls.
      await page.getByRole('group', { name: `${mode} sources`, exact: true }).waitFor();
      if (width <= 768) {
        await page.waitForFunction(() => document.querySelector('#mobile-feed-drawer')?.getAttribute('aria-hidden') === 'true');
        await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      }
      const panel = page.locator(width <= 768 ? '#mobile-feed-drawer .home-feed-source-panel' : '.home-feed-right-tabs .home-feed-source-panel');
      const trigger = panel.getByRole('button', { name: /Feed sources/ });
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
      await panel.getByRole('switch').first().waitFor();
      assert.equal(await panel.getByRole('button', { name: 'Select favorites', exact: true }).count(), 0);
      assert.equal(await panel.getByRole('searchbox').count(), 0);
      return panel;
    };
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=feed&all=1');
    let panel = await open();
    await assertEnabledFirst(panel);
    assert.ok(!(await panel.locator('.home-feed-source-name').allTextContents()).includes('YouTube'), 'Default social category excludes video sources');
    await panel.getByRole('combobox', { name: 'Filter feed sources' }).selectOption('favorites');
    assert.deepEqual(await panel.locator('.home-feed-source-name').allTextContents(), ['YouTube', 'Reddit']);
    await assertEnabledFirst(panel);
    await panel.getByRole('combobox', { name: 'Filter feed sources' }).selectOption('developer');
    await assertEnabledFirst(panel);
    assert.equal((await panel.locator('.home-feed-source-name').allTextContents()).at(-1), 'GitHub');
    await panel.getByRole('combobox', { name: 'Filter feed sources' }).selectOption('social');
    let releaseSave;
    heldSave = new Promise(resolve => { releaseSave = resolve; });
    let response = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith('/profile'));
    await panel.getByRole('switch', { name: 'Turn on Reddit', exact: true }).click();
    await panel.getByRole('switch', { name: 'Turn off Reddit', exact: true }).waitFor();
    await assertEnabledFirst(panel);
    assert.equal((await panel.locator('.home-feed-source-name').allTextContents())[0], 'Reddit', 'A newly enabled favorite moves before the request completes');
    releaseSave();
    heldSave = null;
    assert.equal((await response).status(), 200);
    await panel.locator('[role="switch"]:disabled').first().waitFor({ state: 'detached' });
    await auditReload(page);
    panel = await open();
    await panel.getByRole('switch', { name: 'Turn off Reddit', exact: true }).waitFor();
    await assertEnabledFirst(panel);
    response = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith('/profile'));
    await panel.getByRole('switch', { name: 'Turn off Reddit', exact: true }).click();
    assert.equal((await response).status(), 200);
    await panel.getByRole('switch', { name: 'Turn on Reddit', exact: true }).waitFor();
    await panel.locator('[role="switch"]:disabled').first().waitFor({ state: 'detached' });
    const beforeFailedSave = await assertEnabledFirst(panel);
    failSave = true;
    response = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith('/profile'));
    await panel.getByRole('button', { name: 'Enable all', exact: true }).click();
    assert.equal((await response).status(), 503);
    await panel.getByRole('switch', { name: 'Turn on Reddit', exact: true }).waitFor();
    assert.deepEqual(await assertEnabledFirst(panel), beforeFailedSave, 'A failed save restores the previous source ordering');
    failSave = false;
    response = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith('/profile'));
    await panel.getByRole('button', { name: 'Enable all', exact: true }).click();
    assert.equal((await response).status(), 200);
    await panel.getByRole('switch', { name: 'Turn off Reddit', exact: true }).waitFor();
    await assertEnabledFirst(panel);
    let profile = (await app.request('/profile', { userId: id })).data;
    assert.deepEqual(profile.roleSettings.disabledSources, ['github'], 'Enabling social sources preserves disabled developer sources');
    assert.deepEqual(profile.roleSettings.feedSourceFavorites, favorites);
    response = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith('/profile'));
    await panel.getByRole('button', { name: 'Disable all', exact: true }).click();
    assert.equal((await response).status(), 200);
    await auditReload(page);
    panel = await open();
    assert.equal(await panel.getByRole('switch', { checked: true }).count(), 0);
    await assertEnabledFirst(panel);
    profile = (await app.request('/profile', { userId: id })).data;
    assert.ok(!profile.roleSettings.disabledSources.includes('hackernews'), 'Disabling social does not disable developer sources');
    assert.ok(profile.roleSettings.disabledSources.includes('github'), 'Existing disabled choices are preserved');
    const socialDisabled = profile.roleSettings.disabledSources.filter(source => source !== 'github');
    const category = panel.getByRole('combobox', { name: 'Filter feed sources' });
    await category.selectOption('developer');
    await panel.getByRole('switch', { name: 'Turn off Hacker News', exact: true }).waitFor();
    response = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith('/profile'));
    await panel.getByRole('button', { name: 'Enable all', exact: true }).click();
    assert.equal((await response).status(), 200);
    await panel.getByRole('switch', { name: 'Turn off GitHub', exact: true }).waitFor();
    profile = (await app.request('/profile', { userId: id })).data;
    assert.deepEqual(profile.roleSettings.disabledSources, socialDisabled, 'Enabling developer preserves every disabled social source');
    await category.selectOption('favorites');
    response = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith('/profile'));
    await panel.getByRole('button', { name: 'Enable all', exact: true }).click();
    assert.equal((await response).status(), 200);
    await panel.getByRole('switch', { name: 'Turn off Reddit', exact: true }).waitFor();
    profile = (await app.request('/profile', { userId: id })).data;
    assert.deepEqual(profile.roleSettings.disabledSources, socialDisabled.filter(source => source !== 'reddit'), 'Favorites bulk action affects only displayed favorites');
    assert.equal(await category.locator('option[value="career"]').count(), 0, 'Career sources moved to Jobs');
    // Wait for the destination feed request as well as its heading. React can
    // show the new source row before navigation has closed the previous drawer.
    const followingLoaded = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/office/feed') && url.searchParams.get('mode') === 'following';
    });
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=following');
    await followingLoaded;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    panel = await open('Following');
    await panel.getByRole('switch', { name: 'Turn off UFIconnect', exact: true }).waitFor();
    profile = (await app.request('/profile', { userId: id })).data;
    assert.deepEqual(profile.roleSettings.feedSourceFavorites, favorites);
    await panel.getByRole('button', { name: 'Enable all', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    console.log(`PASS: Enabled sources first, filters, individual and bulk controls, rollback, reload and saved favorites at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
