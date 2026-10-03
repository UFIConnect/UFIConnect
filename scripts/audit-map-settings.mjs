import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const require = createRequire(import.meta.url);
require('../backend/generated-media');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-map-settings');
await fs.mkdir(output, { recursive: true });
const app = await createAppHarness();
const userId = 'maps-settings-audit';
app.seedUser(member(userId, { plan: 'pro' }));
const workspaceKey = 'ufi:local-workspace:' + userId + ':city';
const baseline = {
  enabled: ['community', 'technology'],
  sourceSelections: { community: ['uficonnect', 'reddit'], technology: ['github'] },
  topicSelections: {},
  selected: [{ key: 'legacy:1', id: '1', source: 'uficonnect', title: 'Previously saved map post' }],
};
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  plugins: [{
    name: 'map-account-audit-fixture', enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/contexts/AuthContext.jsx')) return null;
      // Exercise a profile change without remounting Maps. This hook exists only
      // in this audit's Vite server; the production provider remains unchanged.
      return code.replace('  function updateProfileLocally(updated) {', '  globalThis.__mapAuditUpdateProfile = updateProfileLocally;\n  function updateProfileLocally(updated) {');
    },
  }],
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5233, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390]) {
    // This audit exercises settings and real pointer clicks. Keep the 3D city
    // paused through its supported preference so software-rendered CI frames
    // do not compete with scrolling/actionability checks.
    const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 600, hasTouch: width < 600, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], requests = [];
    let feedAccount = userId, holdNext = false, releaseHeld = null;
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ key, initial }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(initial));
    }, { key: workspaceKey, initial: baseline });
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (/events|stream/.test(url.pathname)) return route.abort();
      if (url.pathname === '/api/office/feed') {
        requests.push(Object.fromEntries(url.searchParams));
        const sources = (url.searchParams.get('sources') || '').split(',').filter(Boolean);
        const account = feedAccount;
        if (holdNext) { holdNext = false; await new Promise(resolve => { releaseHeld = resolve; }); }
        return route.fulfill({ json: { posts: sources.map(source => ({
          id: account + '-' + source + '-map-post', source, title: (account === userId ? '' : 'Second account ') + source + ' map post', content: 'A source result fixture.',
          topic: 'Community', sourceUrl: 'https://example.com/' + source,
        })), hasMore: false, cursor: '' } }).catch(() => {});
      }
      return route.continue();
    });
    await installAuditMember(page, app, userId);
    await auditNavigate(page, server.resolvedUrls.local[0] + 'maps');
    const actions = page.getByRole('group', { name: 'Map actions', exact: true });
    const state = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), workspaceKey);
    const openTools = async () => {
      if (width < 600 && !await page.locator('#map-mobile-menu').count()) await page.getByRole('button', { name: 'Open map menu', exact: true }).click();
      return width < 600 ? page.locator('#map-mobile-menu') : page.locator('.map-customization-rail');
    };
    const closeTools = async () => {
      if (width < 600 && await page.locator('#map-mobile-menu').count()) await page.getByRole('button', { name: 'Close map menu', exact: true }).click();
    };
    const apply = async tools => {
      await (width < 600 ? tools : actions).getByRole('button', { name: 'Apply changes', exact: true }).click();
    };
    try {
      await page.getByRole('heading', { name: 'reddit map post', exact: true }).waitFor();
      assert.equal(await actions.locator('xpath=ancestor::*[contains(@class,"map-city-card")]').count(), 1, 'Apply, Source feed and Refresh belong inside the map');
      assert.equal(await page.getByRole('button', { name: /^Your selection/ }).count(), 0);
      assert.equal(await page.locator('.city-post input[type="checkbox"]').count(), 0);
      assert.equal(await actions.getByRole('button', { name: 'Apply changes', exact: true }).isDisabled(), true);

      let tools = await openTools();
      const before = JSON.stringify(await state()), beforeRequests = requests.length;
      await tools.getByRole('group', { name: 'Community sources', exact: true }).getByRole('button', { name: 'Reddit', exact: true }).click();
      await page.waitForTimeout(350);
      assert.equal(JSON.stringify(await state()), before, 'Draft source edits must not save');
      assert.equal(requests.length, beforeRequests, 'Draft source edits must not refetch');
      await closeTools();
      assert.ok((await actions.getByRole('link', { name: 'Source feed', exact: true }).getAttribute('href')).includes('reddit'), 'Source feed uses applied sources');
      await Promise.all([
        page.waitForResponse(response => response.url().includes('/office/feed?')),
        actions.getByRole('button', { name: 'Refresh', exact: true }).click(),
      ]);
      assert.ok(requests.at(-1).sources.includes('reddit'), 'Refresh must not apply drafts');
      assert.equal(JSON.stringify(await state()), before);
      tools = await openTools();
      assert.equal(await tools.getByRole('group', { name: 'Community sources', exact: true }).getByRole('button', { name: 'Reddit', exact: true }).getAttribute('aria-pressed'), 'false', 'Closing the menu retains the draft');
      const sourceResponse = page.waitForResponse(response => response.url().includes('/office/feed?') && new URL(response.url()).searchParams.get('sources') === 'uficonnect');
      await apply(tools);
      await sourceResponse;
      await closeTools();
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).sourceSelections.community.length === 1, workspaceKey);
      await page.waitForFunction(() => !document.querySelector('.city-post-grid')?.textContent.includes('reddit map post'));
      assert.deepEqual((await state()).selected, baseline.selected, 'Removing collection UI must preserve existing stored posts');
      assert.equal(requests.at(-1).sources, 'uficonnect');

      tools = await openTools();
      await tools.getByRole('button', { name: '+ Community', exact: true }).click();
      await page.waitForTimeout(300);
      assert.equal(requests.at(-1).topics, undefined, 'Draft topic edits must not filter applied posts');
      const topicResponse = page.waitForResponse(response => response.url().includes('/office/feed?') && new URL(response.url()).searchParams.get('topics') === 'Community');
      await apply(tools);
      await topicResponse;
      await closeTools();
      assert.deepEqual((await state()).topicSelections['community:city'], ['Community']);

      tools = await openTools();
      await tools.getByRole('button', { name: 'Clear topics', exact: true }).click();
      await (width < 600 ? tools : actions).getByRole('button', { name: 'Discard changes', exact: true }).click();
      assert.equal(await tools.getByRole('heading', { name: 'Selected topics (1)', exact: true }).count(), 1);
      assert.deepEqual((await state()).topicSelections['community:city'], ['Community']);

      await tools.getByRole('button', { name: 'Clear topics', exact: true }).click();
      await page.evaluate(key => {
        const original = Storage.prototype.setItem;
        window.restoreMapStorage = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function (name, value) { if (name === key) throw new DOMException('Storage unavailable', 'QuotaExceededError'); return original.call(this, name, value); };
      }, workspaceKey);
      await apply(tools);
      if (width < 600) assert.equal(await tools.getByRole('alert').isVisible(), true, 'Storage errors must be visible inside the mobile dialog');
      assert.deepEqual((await state()).topicSelections['community:city'], ['Community'], 'Failed saves must not change applied settings');
      assert.equal(await (width < 600 ? tools : actions).getByRole('button', { name: 'Apply changes', exact: true }).isEnabled(), true, 'Failed saves retain the draft for retry');
      await page.evaluate(() => window.restoreMapStorage());
      await (width < 600 ? tools : actions).getByRole('button', { name: 'Discard changes', exact: true }).click();
      await closeTools();

      await page.reload();
      await page.getByRole('heading', { name: 'uficonnect map post', exact: true }).waitFor();
      assert.deepEqual((await state()).sourceSelections.community, ['uficonnect']);
      assert.deepEqual((await state()).topicSelections['community:city'], ['Community']);

      tools = await openTools();
      await tools.getByRole('button', { name: 'Clear topics', exact: true }).click();
      await closeTools();
      holdNext = true;
      await Promise.all([
        page.waitForRequest(request => request.url().includes('/office/feed?')),
        actions.getByRole('button', { name: 'Refresh', exact: true }).click(),
      ]);
      for (let attempt = 0; !releaseHeld && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(releaseHeld, 'The previous account request must be held before switching accounts');
      const secondKey = 'ufi:local-workspace:maps-second-account:city';
      const sameSettings = await state();
      feedAccount = 'maps-second-account';
      await page.evaluate(({ key, settings }) => {
        localStorage.setItem(key, JSON.stringify(settings));
        window.__mapAuditUpdateProfile({ id: 'maps-second-account' });
      }, { key: secondKey, settings: sameSettings });
      await page.getByRole('heading', { name: 'uficonnect map post', exact: true }).waitFor({ state: 'hidden' });
      await page.getByRole('heading', { name: 'Second account uficonnect map post', exact: true }).waitFor();
      releaseHeld();
      releaseHeld = null;
      await page.waitForTimeout(250);
      assert.equal(await page.getByRole('heading', { name: 'uficonnect map post', exact: true }).count(), 0, 'Old account requests cannot replace new account posts');
      assert.equal(await actions.getByRole('button', { name: 'Apply changes', exact: true }).isDisabled(), true, 'Account changes discard the previous account draft');
      assert.equal(requests.at(-1).topics, 'Community', 'Matching account filters still load a fresh account scope');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Map controls must fit the viewport');
      await page.screenshot({ path: path.join(output, `map-settings-${width}.png`), fullPage: true });
      if (width < 600) {
        tools = await openTools();
        await tools.getByRole('button', { name: 'Clear topics', exact: true }).click();
        const applyBox = await tools.getByRole('button', { name: 'Apply changes', exact: true }).boundingBox();
        assert.ok(applyBox.height >= 44 && applyBox.y + applyBox.height <= 1000, 'Mobile Apply remains visible and has a usable touch target');
        await page.screenshot({ path: path.join(output, 'map-settings-mobile-menu.png') });
      }
      assert.deepEqual(errors, []);
      console.log(`PASS: Maps Apply, Refresh, Discard, storage failure, saved settings and responsive controls at ${width}px`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `map-settings-failure-${width}.png`), fullPage: true });
      throw error;
    } finally { releaseHeld?.(); await context.close(); }
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
