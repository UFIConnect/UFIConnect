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
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5208, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 768, 390, 320]) {
    const id = `favorites-${width}`;
    const favorites = { feed: ['reddit'], following: ['uficonnect'] };
    app.seedUser(member(id, { roleSettings: { disabledSources: ['github'], feedSourceFavorites: favorites } }));
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width <= 768, isMobile: width < 600 });
    const page = await context.newPage();
    await installAuditMember(page, app, id);
    let failSave = false;
    await page.route('**/api/profile', route => failSave && route.request().method() === 'PATCH' ? route.fulfill({ status: 503, json: { error: 'Temporary outage' } }) : route.continue());
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
    failSave = true;
    let response = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith('/profile'));
    await panel.getByRole('button', { name: 'Enable all', exact: true }).click();
    assert.equal((await response).status(), 503);
    await panel.getByRole('switch', { name: 'Turn on GitHub', exact: true }).waitFor();
    failSave = false;
    response = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith('/profile'));
    await panel.getByRole('button', { name: 'Enable all', exact: true }).click();
    assert.equal((await response).status(), 200);
    await panel.getByRole('switch', { name: 'Turn off GitHub', exact: true }).waitFor();
    let profile = (await app.request('/profile', { userId: id })).data;
    assert.deepEqual(profile.roleSettings.disabledSources, []);
    assert.deepEqual(profile.roleSettings.feedSourceFavorites, favorites);
    response = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().endsWith('/profile'));
    await panel.getByRole('button', { name: 'Disable all', exact: true }).click();
    assert.equal((await response).status(), 200);
    await auditReload(page);
    panel = await open();
    assert.equal(await panel.getByRole('switch', { checked: true }).count(), 0);
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=following');
    panel = await open('Following');
    await panel.getByRole('switch', { name: 'Turn off UFIconnect', exact: true }).waitFor();
    profile = (await app.request('/profile', { userId: id })).data;
    assert.deepEqual(profile.roleSettings.feedSourceFavorites, favorites);
    assert.ok(await panel.getByRole('button', { name: 'Enable all', exact: true }).isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    console.log(`PASS: Source bulk controls, rollback, reload and saved favorites preservation at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
