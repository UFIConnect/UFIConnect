import { installAuditMember, auditNavigate } from './audit-session.mjs';
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
    const page = await context.newPage();
    await installAuditMember(page, app, 'social-audit');
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
    await page.route('**/api/office/feed?*', route => {
      const params = new URL(route.request().url()).searchParams;
      const query = params.get('q') || 'Recent';
      const sources = (params.get('sources') || params.get('source') || 'reddit,github').split(',');
      return route.fulfill({ json: { posts: sources.map((source, index) => ({
        id: `search-audit-${params.get('mode')}-${query}-${source}`, source, title: `${query} project ${index}`,
        content: 'An open source software engineer project with useful community discussion.', topic: 'Open Source',
        createdAt: new Date(Date.now() - index * 60000).toISOString(), sourceUrl: 'https://example.com/project',
        author: { id: 'author', name: 'Community member' },
      })), hasMore: false } });
    });
    await auditNavigate(page, server.resolvedUrls.local[0] + 'notifications');
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
    }
    const globalSearch = page.getByRole('search', { name: 'Search UFIconnect', exact: true });
    const headerInput = globalSearch.getByRole('searchbox', { name: 'Search UFIconnect', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Search UFIconnect', exact: true });
    const sourceIds = params => (params.get('sources') || params.get('source') || '').split(',').filter(Boolean).sort();
    const feedResponse = (mode, query, expectedSources = ['github', 'reddit'], topics = 'Open Source') => page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/office/feed') && url.searchParams.get('mode') === mode
        && (url.searchParams.get('q') || '') === query
        && sourceIds(url.searchParams).join(',') === expectedSources.join(',')
        && (topics === null || url.searchParams.get('topics') === topics);
    });
    for (const mode of ['feed', 'following']) {
      await auditNavigate(page, server.resolvedUrls.local[0] + `?feed=${mode}`);
      const sources = page.getByRole('group', { name: mode === 'feed' ? 'Home sources' : 'Following sources', exact: true });
      await sources.waitFor();
      await Promise.all([feedResponse(mode, '', [], null), sources.getByRole('button', { name: 'All sources', exact: true }).click()]);
      await Promise.all([feedResponse(mode, '', ['reddit'], null), sources.getByRole('button', { name: 'Reddit', exact: true }).click()]);
      await Promise.all([feedResponse(mode, '', ['github', 'reddit'], null), sources.getByRole('button', { name: 'GitHub', exact: true }).click()]);
      await page.getByRole('button', { name: 'Filter feed by topic', exact: true }).click();
      const openSourceTopic = page.getByRole('button', { name: 'Open Source', exact: true });
      if (await openSourceTopic.getAttribute('aria-pressed') !== 'true') await openSourceTopic.click();
      await Promise.all([feedResponse(mode, ''), page.getByRole('button', { name: 'Apply topics', exact: true }).click()]);
      const feedUrl = page.url();
      await headerInput.fill('software engineer');
      const [searchedFeed] = await Promise.all([feedResponse(mode, 'software engineer'), headerInput.press('Enter')]);
      assert.ok(searchedFeed.ok(), 'Header search keeps the selected source and topic request filters');
      assert.equal(page.url(), feedUrl, 'Header search updates the current feed without navigation');
      await page.getByText('software engineer project 0', { exact: true }).waitFor();
      assert.equal(await dialog.count(), 0, 'Submitting a feed query does not open broader search');
      for (const source of ['Reddit', 'GitHub']) assert.equal(await sources.getByRole('button', { name: source, exact: true }).getAttribute('aria-pressed'), 'true');

      if (mode === 'feed') {
        const opener = globalSearch.getByRole('button', { name: 'Open search', exact: true });
        await opener.click();
        await dialog.waitFor({ state: 'visible' });
        assert.equal(await dialog.getAttribute('aria-modal'), 'true');
        await dialog.getByRole('tab', { name: 'People', exact: true }).click();
        const peopleInput = dialog.getByRole('searchbox', { name: 'Search people', exact: true });
        await Promise.all([
          page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.pathname.endsWith('/users/search') && url.searchParams.get('q') === 'product designer';
          }),
          peopleInput.fill('product designer'),
        ]);
        await dialog.getByText('Maya Chen', { exact: true }).waitFor();
        assert.ok(searches.includes('product designer'));
        assert.equal(page.url(), feedUrl, 'Broader search results stay in the popup');
        await page.screenshot({ path: path.join(root, `.cache/audit-ui/search-${width}.png`) });
        await dialog.getByRole('button', { name: 'Close search', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        assert.equal(await opener.evaluate(element => document.activeElement === element), true, 'Closing search restores focus to its opener');
        assert.equal(await headerInput.inputValue(), 'software engineer', 'Closing broader search leaves the feed query intact');
        await opener.click();
        await dialog.waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert.equal(await opener.evaluate(element => document.activeElement === element), true, 'Escape closes search and restores focus');
        assert.equal(page.url(), feedUrl);

        await opener.click();
        await dialog.getByRole('tab', { name: 'People', exact: true }).click();
        await dialog.getByRole('searchbox', { name: 'Search people', exact: true }).fill('systems engineer');
        const [updatedFeed] = await Promise.all([
          feedResponse(mode, 'systems engineer'),
          dialog.getByRole('button', { name: 'Update feed', exact: true }).click(),
        ]);
        assert.ok(updatedFeed.ok(), 'Update feed applies the popup query with existing sources and topics');
        await dialog.waitFor({ state: 'detached' });
        assert.equal(await headerInput.inputValue(), 'systems engineer');
        assert.equal(page.url(), feedUrl);
      }
      const [clearedFeed] = await Promise.all([feedResponse(mode, ''), globalSearch.getByRole('button', { name: 'Clear feed search', exact: true }).click()]);
      assert.ok(clearedFeed.ok(), 'Clearing feed search removes only the query');
      assert.equal(await headerInput.inputValue(), '');
      assert.equal(page.url(), feedUrl);
    }
    const messages = page.locator('.global-search-center').getByRole('link', { name: 'Messages', exact: true });
    await messages.waitFor({ state: 'visible' });
    const searchBounds = await globalSearch.boundingBox();
    const messageBounds = await messages.boundingBox();
    assert.ok(searchBounds && messageBounds, 'Search and Messages remain visible in the header');
    assert.ok(searchBounds.x + searchBounds.width <= messageBounds.x + 1 || messageBounds.x + messageBounds.width <= searchBounds.x + 1,
      'Messages sits beside search without overlapping the input');
    assert.ok(Math.abs((searchBounds.y + searchBounds.height / 2) - (messageBounds.y + messageBounds.height / 2)) <= 20,
      'Messages shares the search row');
    await messages.click();
    await page.waitForURL(url => url.pathname === '/messages');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    assert.deepEqual(errors, []);
    console.log(`PASS: in-place Home/Following search, popup search/close/Escape/focus, Messages and notification actions at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
