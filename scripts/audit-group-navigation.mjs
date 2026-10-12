import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-ui');
await fs.mkdir(output, { recursive: true });
const app = await createAppHarness();
app.seedUser(member('group-audit', { joinedGroups: ['joined-group'] }));
const proxy = prefix => ({ target: app.base, rewrite: value => value.replace(prefix, '') });
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/fallback') },
  server: { host: '127.0.0.1', port: 5197, strictPort: false,
    proxy: { '/api': proxy(/^\/api/), '/fallback': proxy(/^\/fallback/) } },
});
const post = (scope, index) => ({
  id: `${scope}-${index}`, title: `${scope.toUpperCase()}_POST_${index}`,
  content: `A conversation from the ${scope} feed.`, source: scope === 'joined' ? 'uficonnect' : ['reddit', 'devto', 'bluesky'][index % 3],
  sourceUrl: `https://example.org/${scope}/${index}`, author: 'Community member',
  createdAt: new Date(Date.now() - index * 60000).toISOString(), likesCount: 0, commentsCount: 0,
  ...(scope !== 'home' ? { groupId: `${scope}-group`, group: { id: `${scope}-group`, name: `${scope} community` } } : {}),
});
let browser;
let releasePending = () => {};
let checks = 0;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 900 });
    let heldScope = 'joined';
    let emptyJoined = false;
    const pending = [];
    const errors = [];
    releasePending = () => { heldScope = null; pending.splice(0).forEach(item => item.resolve()); };
    await context.addInitScript(({ token, cached }) => {
      localStorage.setItem('ufi_feed_v1:group-audit', JSON.stringify({ posts: [cached], ts: Date.now() }));
    }, { token: app.token('group-audit'), cached: post('home', 0) });
    const routeApi = async route => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
      if (endpoint === '/office/feed') {
        const mode = url.searchParams.get('mode');
        const scope = mode === 'groups' ? (url.searchParams.get('groupScope') || 'joined') : 'home';
        const nextPage = url.searchParams.has('cursor') || Number(url.searchParams.get('page')) > 1;
        const empty = emptyJoined && scope === 'joined';
        if (heldScope === scope) await new Promise(resolve => pending.push({ scope, resolve }));
        return route.fulfill({ json: {
          mode, nativeUficonnectIncluded: true, hasMore: !empty && !nextPage,
          cursor: !empty && !nextPage ? `${scope}:next` : '',
          posts: empty ? [] : Array.from({ length: 20 }, (_, i) => post(scope, i + (nextPage ? 20 : 0))),
        } });
      }
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    };
    await context.route('**/api/**', routeApi);
    await context.route('**/fallback/**', routeApi);
    const page = await context.newPage();
    await installAuditMember(page, app, 'group-audit');
    page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    const groupTab = name => page.getByRole('tab', { name, exact: true });
    const waitForHeldRequest = async () => {
      for (let i = 0; i < 120 && !pending.some(item => item.scope === heldScope); i++) await page.waitForTimeout(50);
      assert.ok(pending.some(item => item.scope === heldScope), 'Expected a delayed group request');
    };
    const visiblePost = scope => page.getByText(`${scope.toUpperCase()}_POST_0`, { exact: true });
    try {
      await auditNavigate(page, base + '?feed=groups');
      await groupTab('Your groups').waitFor();
      await waitForHeldRequest();
      assert.equal(await visiblePost('home').count(), 0, 'Home cache leaked into Your groups');
      checks++;
      releasePending();
      await visiblePost('joined').waitFor();
      assert.equal(await visiblePost('home').count(), 0);
      checks++;

      const groupToolbar = page.locator('.feed-group-filter-row');
      const createGroup = groupToolbar.getByRole('link', { name: 'Create a group', exact: true });
      const postToGroup = groupToolbar.getByRole('link', { name: 'Post to your group', exact: true });
      assert.equal(await postToGroup.getAttribute('href'), '/groups/post');
      const createBounds = await createGroup.boundingBox();
      const postBounds = await postToGroup.boundingBox();
      assert.ok(Math.abs(createBounds.y - postBounds.y) < 2 && postBounds.x > createBounds.x, 'Post to your group belongs beside Create a group');
      const actionsRow = groupToolbar.locator('.feed-group-primary-actions');
      const rowBounds = await actionsRow.boundingBox();
      assert.ok(rowBounds.x >= 0 && rowBounds.x + rowBounds.width <= viewport.width, 'The group action row stays inside the viewport');
      for (const control of [groupTab('Your groups'), groupTab('Public posts'), createGroup, postToGroup]) {
        await control.scrollIntoViewIfNeeded();
        await control.click({ trial: true });
        const bounds = await control.boundingBox();
        assert.ok(bounds.x >= rowBounds.x - 1 && bounds.x + bounds.width <= rowBounds.x + rowBounds.width + 1,
          'Each group control can be reached completely by scrolling its single row');
        assert.ok(Math.abs(bounds.y - createBounds.y) < 5, 'Group controls stay on one row');
      }
      checks += 11;

      heldScope = 'public';
      await groupTab('Public posts').click();
      await waitForHeldRequest();
      assert.equal(await visiblePost('joined').count(), 0, 'Previous group scope is still visible while switching');
      checks++;
      releasePending();
      await visiblePost('public').waitFor();
      assert.equal(await visiblePost('home').count(), 0);
      checks++;

      const menu = page.getByRole('button', { name: 'Open menu', exact: true });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole('button', { name: 'Your groups', exact: true }).filter({ visible: true }).click();
      await visiblePost('joined').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('groupScope'), null);
      assert.equal(await visiblePost('public').count(), 0);
      checks += 2;

      for (let i = 0; i < 2; i++) {
        if (await menu.isVisible()) await menu.click();
        await page.getByRole('link', { name: 'Discover groups', exact: true }).filter({ visible: true }).click();
        await page.getByRole('heading', { name: 'Discover Groups', exact: true }).waitFor();
        assert.equal(new URL(page.url()).pathname, '/groups');
        assert.equal(await visiblePost('joined').count(), 0);
        await page.goBack();
        await visiblePost('joined').waitFor();
        assert.equal(await visiblePost('home').count(), 0);
        checks += 3;
      }

      heldScope = 'public';
      await groupTab('Public posts').click();
      await waitForHeldRequest();
      await groupTab('Your groups').click();
      await visiblePost('joined').waitFor();
      releasePending();
      await page.waitForTimeout(500);
      assert.equal(await visiblePost('public').count(), 0, 'Late public response replaced joined posts');
      assert.equal(await groupTab('Your groups').getAttribute('aria-selected'), 'true');
      checks += 2;

      heldScope = 'joined';
      await page.getByRole('navigation', { name: 'Feed pages', exact: true }).getByRole('button', { name: 'Next', exact: true }).click();
      await waitForHeldRequest();
      await groupTab('Public posts').click();
      await visiblePost('public').waitFor();
      heldScope = 'public';
      await page.getByRole('navigation', { name: 'Feed pages', exact: true }).getByRole('button', { name: 'Next', exact: true }).click();
      await waitForHeldRequest();
      pending.splice(pending.findIndex(item => item.scope === 'joined'), 1)[0].resolve();
      await page.waitForTimeout(100);
      assert.equal(await page.locator('[data-feed-loading-more]').getAttribute('data-feed-loading-more'), 'true', 'Older page request cleared the new request loading state');
      assert.equal(await visiblePost('joined').count(), 0);
      releasePending();
      await page.locator('[data-feed-loading-more="false"]').waitFor();
      checks += 3;

      await page.getByText('PUBLIC_POST_20', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-feed-page]').getAttribute('data-feed-page'), '2', 'The newer public page remains active after the older joined response');
      checks++;
      emptyJoined = true;
      await groupTab('Your groups').click();
      await page.getByText('No group posts yet', { exact: true }).waitFor();
      assert.equal(await visiblePost('public').count(), 0);
      assert.equal(await page.getByText('PUBLIC_POST_20', { exact: true }).count(), 0, 'The last public page does not leak into the empty joined scope');
      assert.equal(await visiblePost('home').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      assert.deepEqual(errors, []);
      checks += 5;
      await page.screenshot({ path: path.join(output, `group-navigation-${viewport.width}.png`) });
      console.log(`PASS: group navigation at ${viewport.width}px`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `group-navigation-failure-${viewport.width}.png`) });
      throw error;
    } finally {
      releasePending();
      await context.close();
    }
  }
  console.log(`PASS: ${checks} group navigation checks`);
} finally {
  releasePending();
  await browser?.close();
  await server.close();
  await app.close();
}
