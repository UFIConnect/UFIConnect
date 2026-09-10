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
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5208, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    const id = `favorites-${width}`;
    app.seedUser(member(id, { roleSettings: { disabledSources: ['github'], feedSourceFavorites: { feed: ['reddit'], following: ['uficonnect'] } } }));
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width <= 768, isMobile: width < 600 });
    await context.addInitScript(t => localStorage.setItem('pc_token', t), app.token(id));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let failSave = false;
    await page.route('**/api/profile', route => failSave && route.request().method() === 'PATCH' ? route.fulfill({ status: 503, json: { error: 'Temporary outage' } }) : route.continue());
    await page.route('**/api/office/feed?*', route => route.fulfill({ json: { posts: [], hasMore: false, nativeUficonnectIncluded: true } }));
    const open = async () => {
      if (width <= 768) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      const panel = page.locator(width <= 768 ? '#mobile-feed-drawer .home-feed-source-panel' : '.home-feed-right-tabs .home-feed-source-panel');
      const trigger = panel.getByRole('button', { name: /Feed sources/ });
      await trigger.waitFor();
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
      await panel.getByRole('button', { name: 'Select favorites', exact: true }).click();
      return panel;
    };
    await page.goto(server.resolvedUrls.local[0] + '?feed=feed&all=1');
    let panel = await open();
    await panel.getByRole('checkbox', { name: 'Favorite YouTube', exact: true }).check();
    failSave = true;
    await panel.getByRole('button', { name: 'Save favorites', exact: true }).click();
    await panel.getByRole('alert').waitFor();
    assert.equal(await panel.getByRole('checkbox', { name: 'Favorite YouTube', exact: true }).isChecked(), true);
    failSave = false;
    await panel.getByRole('button', { name: 'Save favorites', exact: true }).click();
    await panel.getByRole('switch').first().waitFor();
    let profile = (await app.request('/profile', { userId: id })).data;
    assert.deepEqual(profile.roleSettings.feedSourceFavorites.feed, ['reddit', 'youtube']);
    assert.deepEqual(profile.roleSettings.feedSourceFavorites.following, ['uficonnect']);
    assert.deepEqual(profile.roleSettings.disabledSources, ['github']);
    await page.reload();
    panel = await open();
    assert.equal(await panel.getByRole('checkbox', { name: 'Favorite YouTube', exact: true }).isChecked(), true);
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/source-favorites-${width}.png`) });
    await page.goto(server.resolvedUrls.local[0] + '?feed=following');
    panel = await open();
    await panel.getByRole('button', { name: 'Clear favorites', exact: true }).click();
    await panel.getByRole('button', { name: 'Save favorites', exact: true }).click();
    await panel.getByRole('switch').first().waitFor();
    profile = (await app.request('/profile', { userId: id })).data;
    assert.deepEqual(profile.roleSettings.feedSourceFavorites.following, []);
    assert.deepEqual(profile.roleSettings.feedSourceFavorites.feed, ['reddit', 'youtube']);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    assert.deepEqual(errors, []);
    console.log(`PASS: Favorites persistence, retry and separate feeds at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
