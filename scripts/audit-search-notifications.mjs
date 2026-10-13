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
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  cacheDir: path.join(root, '.cache/vite-search-notifications'),
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
    let failMessageSources = false;
    const messageReads = [];
    const searches = [];
    await page.route('**/api/notifications', route => route.fulfill({ json: { notifications: [
      { id: 'like-1', type: 'like', user: { id: 'maya', name: 'Maya Chen' }, targetId: 'post-1', preview: 'A new perspective on building thoughtful products.', read, createdAt: new Date().toISOString() },
      { id: 'request-1', type: 'connection_request', user: { id: 'alex', name: 'Alex Morgan' }, read: true, createdAt: new Date().toISOString() },
      { id: 'system-1', type: 'system', user: null, read: true, createdAt: '2025-01-01T00:00:00Z' },
    ] } }));
    await page.route('**/api/notifications/mark-read', route => { if (!failRead) read = true; return route.fulfill({ status: failRead ? 503 : 200, json: { ok: !failRead } }); });
    await page.route('**/api/connected-inbox/notifications', route => route.fulfill({ json: { notifications: [], sources: [] } }));
    await page.route('**/api/notifications/badge-counts', route => route.fulfill({ json: { notificationCount: 1, unreadMessages: 3 } }));
    await page.route('**/api/messages', route => route.fulfill({ json: { conversations: [{ id: 'native-thread', participant: { id: 'maya', name: 'Maya Chen' }, unreadCount: 2, lastMessage: { text: 'Native inbox preview', createdAt: new Date().toISOString() } }] } }));
    await page.route('**/api/messages/maya', route => route.fulfill({ json: { participant: { id: 'maya', name: 'Maya Chen' }, messages: [{ id: 'native-message', senderId: 'maya', content: 'Native message body', createdAt: new Date().toISOString() }] } }));
    await page.route('**/api/connected-inbox/messages', route => route.fulfill({ status: failMessageSources ? 503 : 200, json: failMessageSources ? { error: 'Unavailable' } : { conversations: [{ id: 'connected-thread', source: 'reddit', title: 'Reddit community conversation', unreadCount: messageReads.length ? 0 : 1, lastMessage: { text: 'Connected inbox preview', createdAt: new Date().toISOString() } }], sources: [{ source: 'reddit', name: 'Reddit', status: 'ready' }] } }));
    await page.route('**/api/connected-inbox/messages/reddit/connected-thread', route => route.fulfill({ json: { messages: [{ id: 'connected-message', senderName: 'Alex Morgan', text: 'Connected message body', createdAt: new Date().toISOString() }] } }));
    await page.route('**/api/connected-inbox/messages/mark-read', route => { messageReads.push(route.request().postDataJSON()); return route.fulfill({ json: { markedIds: ['connected-thread'] } }); });
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
    await inbox.getByText('Could not save read status. Your unread updates are still available.').waitFor();
    assert.equal(await inbox.locator('.inbox-item.unread').count(), 1);
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
      assert.equal(await sources.getByRole('button', { name: 'All sources', exact: true }).count(), 0);
      const clearSources = sources.getByRole('button', { name: 'Clear sources', exact: true });
      if (await clearSources.isEnabled()) await Promise.all([feedResponse(mode, '', [], null), clearSources.click()]);
      assert.equal(await clearSources.isDisabled(), true);
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
        const searchNavigation = page.locator(width <= 768 ? '#mobile-account-drawer' : '.sidebar-nav').getByRole('link', { name: 'Search', exact: true, includeHidden: true });
        assert.equal(await searchNavigation.getAttribute('href'), '/search', 'Broader search opens the dedicated Search page');
        assert.equal(await headerInput.inputValue(), 'software engineer', 'The feed retains its own query');
      }
      const [clearedFeed] = await Promise.all([feedResponse(mode, ''), globalSearch.getByRole('button', { name: 'Clear feed search', exact: true }).click()]);
      assert.ok(clearedFeed.ok(), 'Clearing feed search removes only the query');
      assert.equal(await headerInput.inputValue(), '');
      assert.equal(page.url(), feedUrl);
    }
    const messages = page.locator(width <= 768 ? '#mobile-feed-drawer' : '.home-feed-rail-bottom').getByRole('button', { name: 'Messages', exact: true, includeHidden: true });
    const feedMenu = page.locator('button[aria-controls="mobile-feed-drawer"]');
    async function showMessagesButton() {
      if (width <= 768 && !await messages.isVisible()) await feedMenu.click();
      await messages.scrollIntoViewIfNeeded();
    }
    async function openMessages() { await showMessagesButton(); await messages.click(); }
    await showMessagesButton();
    assert.ok(await messages.evaluate(element => element.nextElementSibling?.textContent.includes('Discover groups')),
      'Messages appears immediately above Discover groups');
    assert.equal(await messages.getByLabel('3 unread messages').count(), 1);
    const originalUrl = page.url();
    const messagePopup = page.getByRole('dialog', { name: 'Messages', exact: true });
    await openMessages();
    await messagePopup.getByText('Native inbox preview', { exact: true }).waitFor();
    await messagePopup.getByText('Connected inbox preview', { exact: true }).waitFor();
    assert.equal(page.url(), originalUrl, 'Opening Messages preserves the current page');
    assert.equal(await messagePopup.getAttribute('aria-modal'), 'true');
    assert.equal(await messages.getAttribute('aria-expanded'), 'true');
    assert.equal(messageReads.length, 0, 'Opening the inbox leaves conversations unread');
    assert.equal(await page.locator('.shell').count(), 1, 'The embedded inbox does not create a nested app shell');
    await messagePopup.getByLabel('Message source').selectOption('reddit');
    assert.equal(await messagePopup.getByText('Native inbox preview', { exact: true }).count(), 0);
    await messagePopup.getByRole('button', { name: /Reddit community conversation/ }).click();
    await messagePopup.getByText('Connected message body', { exact: true }).waitFor();
    assert.equal(page.url(), originalUrl, 'Connected conversations stay inside the popup');
    await page.waitForFunction(() => !document.querySelector('.messages-popup .conv-unread-badge'));
    assert.deepEqual(messageReads, [{ ids: ['connected-thread'] }]);
    await messagePopup.getByRole('button', { name: 'Back to conversations', exact: true }).click();
    await messagePopup.getByLabel('Message source').selectOption('all');
    failMessageSources = true;
    await messagePopup.getByRole('button', { name: 'Refresh messages', exact: true }).click();
    const sourceDetails = messagePopup.locator('.connected-inbox-sources');
    await sourceDetails.locator('summary').click();
    const sourceError = sourceDetails.getByRole('alert').filter({ hasText: 'Could not refresh connected sources. Try again.' });
    await sourceError.waitFor();
    await messagePopup.getByText('Native inbox preview', { exact: true }).waitFor();
    failMessageSources = false;
    await messagePopup.getByRole('button', { name: 'Retry sources', exact: true }).click();
    await sourceError.waitFor({ state: 'detached' });
    await messagePopup.getByRole('button', { name: 'New Message', exact: true }).click();
    const newMessage = messagePopup.getByRole('dialog', { name: 'New message', exact: true });
    await newMessage.getByRole('textbox').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await newMessage.waitFor({ state: 'detached' });
    assert.equal(await messagePopup.isVisible(), true, 'Escape closes only the new-message search when it is open');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/messages-popup-${width}.png`) });
    await messagePopup.getByRole('button', { name: 'Close messages', exact: true }).click();
    await messagePopup.waitFor({ state: 'detached' });
    assert.equal(await (width <= 768 ? feedMenu : messages).evaluate(element => document.activeElement === element), true, 'Closing Messages returns focus to the visible opener');
    await openMessages();
    await messagePopup.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await messagePopup.waitFor({ state: 'detached' });
    assert.equal(await (width <= 768 ? feedMenu : messages).evaluate(element => document.activeElement === element), true, 'Escape returns focus to the visible Messages opener');
    await openMessages();
    await messagePopup.waitFor({ state: 'visible' });
    await page.locator('.messages-popup-backdrop').click({ position: { x: 1, y: 1 } });
    await messagePopup.waitFor({ state: 'detached' });
    assert.equal(page.url(), originalUrl, 'Dismissing Messages never changes the page');
    await openMessages();
    await messagePopup.getByRole('button', { name: /Maya Chen/ }).click();
    await page.waitForURL(url => url.pathname === '/messages/maya');
    await page.getByText('Native message body', { exact: true }).waitFor();
    await auditNavigate(page, originalUrl);
    await openMessages();
    await messagePopup.getByRole('link', { name: 'Open inbox', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/messages');
    await page.getByRole('heading', { name: 'Messages', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    assert.deepEqual(errors, []);
    console.log(`PASS: in-place Home/Following search, search and Messages popup keyboard/dismissal, native/connected inbox and notification actions at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
