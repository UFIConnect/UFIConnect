import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = { id: 'inbox-audit', name: 'Inbox Audit', email: 'inbox@example.invalid', plan: 'pro', onboardingComplete: true, onboardingCompleted: true, preferences: { sources: [], role: 'Engineer', skills: [], interests: [] } };
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') }, server: { host: '127.0.0.1', port: 5209, strictPort: false } });
let browser;
try {
  await server.listen();
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: width === 390 ? 'dark' : 'light', hasTouch: width < 600, isMobile: width < 600 });
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('uficonnect.analytics.consent.v1', 'denied');
      localStorage.setItem('uficonnect.ads.consent.v1', 'denied');
    });
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.log('Browser error:', error.message); });
    let nativeRead = false, connectedRead = false, messageRead = false, failRead = width !== 1440, failThread = true, failMessageRead = true, disconnected = false;
    let releaseSources;
    const slowSources = width === 1440 ? new Promise(resolve => { releaseSources = resolve; }) : Promise.resolve();
    let accepted = false, holdNextBadge = false, heldBadge, releaseBadge;
    const marks = [];
    const createdAt = new Date().toISOString();
    const connected = { id: 'connected:reddit:thread-1', source: 'reddit', title: 'Design review', participant: { id: 'remote-maya', name: 'Maya' }, lastMessage: { text: 'Please review the accessibility notes.', createdAt }, url: 'https://www.reddit.com/message/messages/thread-1', unreadCount: 1 };
    const sources = [
      { source: 'reddit', name: 'Reddit', status: 'ready', supported: true, url: 'https://www.reddit.com/message/inbox', message: 'Connected and synced' },
      { source: 'github', name: 'GitHub', status: 'ready', supported: true, url: 'https://github.com/notifications', message: 'Connected and synced' },
      { source: 'bluesky', name: 'Bluesky', status: 'reconnect_required', supported: true, message: 'Reconnect to grant chat access.' },
      { source: 'linkedin', name: 'LinkedIn', status: 'external', supported: false, url: 'https://www.linkedin.com/messaging/', message: 'Messages are available on LinkedIn.' },
    ];
    await page.route('**/api/**', async route => {
      if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue();
      const endpoint = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      const reply = (json, status = 200) => route.fulfill({ status, json });
      if (endpoint === '/auth/session') return reply({ token: 'inbox-audit-fixture', profile });
      if (endpoint === '/profile') return reply(profile);
      if (endpoint === '/notifications/badge-counts') {
        const notificationCount = (nativeRead ? 0 : 2) + (connectedRead ? 0 : 1);
        if (holdNextBadge) {
          holdNextBadge = false;
          heldBadge?.();
          await new Promise(resolve => { releaseBadge = resolve; });
        }
        return reply({ notificationCount, unreadNotifications: nativeRead ? 0 : 1, pendingConnections: 1 });
      }
      if (endpoint === '/notifications') return reply({ notifications: [
        { id: 'native-like', type: 'like', user: { id: 'maya', name: 'Maya Chen' }, targetId: 'post-1', read: nativeRead, createdAt },
        ...(!accepted ? [{ id: 'connreq_alex', type: 'connection_request', user: { id: 'alex', name: 'Alex Morgan' }, read: nativeRead, createdAt }] : []),
      ] });
      if (endpoint === '/connected-inbox/notifications') {
        await slowSources;
        return reply({ notifications: [{ id: 'connected:github:notice-1', source: 'github', type: 'connected_source', title: 'Review requested in UFIConnect', preview: 'Accessibility improvements are ready for review.', read: connectedRead, createdAt, url: 'https://github.com/example/project/pull/12', user: { name: 'GitHub' } }], sources });
      }
      if (endpoint.endsWith('/notifications/mark-read')) {
        const { ids } = route.request().postDataJSON();
        marks.push({ endpoint, ids });
        if (failRead) return reply({ error: 'Fixture read failure' }, 503);
        if (endpoint.startsWith('/connected-inbox')) connectedRead = true; else nativeRead = true;
        return reply({ ok: true, markedIds: ids });
      }
      if (endpoint === '/users/alex/connect') { accepted = true; return reply({ ok: true }); }
      if (endpoint === '/messages') return reply({ conversations: [{ id: 'native-chat', participant: { id: 'alex', name: 'Alex Morgan' }, lastMessage: { content: 'Our UFIConnect conversation', createdAt }, unreadCount: 0 }] });
      if (endpoint === '/connected-inbox/messages') return reply({ conversations: disconnected ? [] : [{ ...connected, unreadCount: messageRead ? 0 : 1 }], sources: disconnected ? sources.filter(source => source.source !== 'reddit') : sources });
      if (endpoint === '/connected-inbox/messages/mark-read') {
        assert.equal(failThread, false, 'A failed thread fetch must not mark the conversation read');
        if (failMessageRead) return reply({ error: 'Fixture read failure' }, 503);
        messageRead = true;
        return reply({ ok: true, markedIds: route.request().postDataJSON().ids });
      }
      if (endpoint.startsWith('/connected-inbox/messages/reddit/')) return failThread ? reply({ error: 'Fixture unavailable' }, 400) : reply({ conversation: connected, messages: [
        { id: 'message-1', senderName: 'Maya', text: 'Please review the accessibility notes.\nKeyboard navigation and contrast are covered.', createdAt },
        { id: 'message-2', senderName: 'You', text: 'I will review them this afternoon.', createdAt },
      ] });
      return reply({ ok: true, posts: [], sources: [], groups: [], notifications: [], requests: [], results: [], users: [], conversations: [], hasMore: false });
    });
    const origin = server.resolvedUrls.local[0];
    await page.goto(origin + 'notifications');
    const inbox = page.locator('.notification-inbox').first();
    await inbox.getByText('Maya Chen', { exact: true }).waitFor().catch(async error => { console.log(page.url(), await page.locator('body').innerText()); throw error; });
    if (width === 1440) {
      await page.waitForFunction(() => !document.querySelector('.inbox-item.unread'));
      assert.ok(nativeRead, 'Native notifications are acknowledged while a source request is still pending');
      assert.equal(await inbox.locator('.inbox-item').count(), 2);
      releaseSources();
      await inbox.getByText('Review requested in UFIConnect', { exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('.inbox-item.unread'));
      failRead = true; nativeRead = false; connectedRead = false;
      await page.reload();
    }
    await inbox.getByRole('button', { name: 'Retry read status' }).waitFor();
    await inbox.getByText('Review requested in UFIConnect', { exact: true }).waitFor();
    assert.equal(await inbox.locator('.inbox-item.unread').count(), 3, 'Failed acknowledgement retains unread items');
    await page.locator('.notification-nav-badge:visible').first().waitFor();
    const staleStarted = new Promise(resolve => { heldBadge = resolve; });
    holdNextBadge = true;
    await page.evaluate(() => window.dispatchEvent(new Event('ufi-notifications-updated')));
    await staleStarted;
    failRead = false;
    await inbox.getByRole('button', { name: 'Retry read status' }).click();
    await page.waitForFunction(() => !document.querySelector('.notification-nav-badge'));
    releaseBadge();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.notification-nav-badge').count(), 0, 'A stale count response cannot resurrect the badge');
    assert.equal(await inbox.locator('.inbox-item.unread').count(), 0);
    assert.ok(marks.filter(mark => mark.endpoint === '/notifications/mark-read').every(mark => mark.ids.sort().join(',') === 'connreq_alex,native-like'), 'Only loaded native IDs are acknowledged');
    assert.ok(marks.filter(mark => mark.endpoint.startsWith('/connected-inbox')).every(mark => mark.ids.join(',') === 'connected:github:notice-1'));
    await inbox.getByLabel('Notification source', { exact: true }).selectOption('github');
    assert.equal(await inbox.locator('.inbox-item').count(), 1);
    assert.equal(await inbox.locator('.inbox-item-link').getAttribute('href'), 'https://github.com/example/project/pull/12');
    await inbox.getByLabel('Notification source', { exact: true }).selectOption('all');
    await inbox.getByRole('button', { name: 'Requests', exact: true }).click();
    await inbox.getByRole('button', { name: 'Accept', exact: true }).waitFor();
    assert.equal(accepted, false, 'Reading a request never accepts or declines it');
    await page.reload();
    await page.locator('.notification-inbox').getByText('Alex Morgan', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.notification-nav-badge'));
    if (width < 600) {
      await page.getByRole('button', { name: 'Alerts', exact: true }).click();
      await page.locator('#mobile-alerts-popup').getByText('Review requested in UFIConnect').waitFor();
      assert.equal(await page.locator('#mobile-alerts-popup .inbox-item.unread').count(), 0);
      await page.getByRole('button', { name: 'Close alerts', exact: true }).click();
    }
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/connected-notifications-${width}.png`) });
    await page.getByRole('link', { name: 'Home', exact: true }).click();
    await page.locator('.home-feed-layout').waitFor();
    if (width <= 768) {
      await page.getByRole('button', { name: 'Open menu', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#mobile-feed-drawer')?.getAttribute('aria-hidden') === 'false');
    }
    const messages = page.locator(width <= 768 ? '#mobile-feed-drawer' : '.home-feed-rail-bottom')
      .getByRole('button', { name: 'Messages', exact: true });
    await messages.scrollIntoViewIfNeeded();
    assert.equal(await messages.evaluate(element => element.previousElementSibling?.textContent.trim()), 'Discover groups',
      'Messages remains directly below Discover groups');
    await messages.click();
    await page.getByRole('dialog', { name: 'Messages', exact: true }).getByRole('link', { name: 'Open inbox', exact: true }).click();
    await page.getByLabel('Message source', { exact: true }).waitFor();
    await page.getByLabel('Message source', { exact: true }).selectOption('reddit');
    assert.equal(await page.locator('.conv-item').count(), 1);
    await page.locator('.conv-item').click();
    await page.getByRole('button', { name: 'Retry conversation' }).waitFor();
    assert.equal(messageRead, false);
    failThread = false;
    await page.getByRole('button', { name: 'Retry conversation' }).click();
    await page.getByText('I will review them this afternoon.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Retry read status', exact: true }).waitFor();
    assert.equal(messageRead, false, 'Failed message receipt preserves the unread count');
    failMessageRead = false;
    await page.getByRole('button', { name: 'Retry read status', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.conv-item.unread'));
    assert.ok(messageRead);
    assert.equal(await page.locator('.connected-message-thread textarea').count(), 0, 'External threads use the provider reply flow');
    assert.equal(await page.getByRole('link', { name: 'Open Reddit', exact: true }).getAttribute('href'), connected.url);
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/connected-messages-${width}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No horizontal page overflow');
    disconnected = true;
    await page.getByRole('button', { name: 'Refresh messages' }).click();
    await page.locator('.connected-message-thread').waitFor({ state: 'detached' });
    assert.equal(await page.getByText('I will review them this afternoon.', { exact: true }).count(), 0, 'A disconnected source no longer leaves its thread displayed');
    await page.locator('.connected-inbox-sources summary').click();
    await page.getByRole('link', { name: 'Reconnect', exact: true }).waitFor();
    await page.getByText('Messages are available on LinkedIn.', { exact: true }).waitFor();
    await page.getByLabel('Message source', { exact: true }).selectOption('ufi');
    await page.getByRole('button', { name: /Alex Morgan/ }).click();
    await page.waitForURL(url => url.pathname === '/messages/alex');
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: automatic read, failed read retry, stale badge race, persistent request actions, source filters, thread retry and native conversation navigation`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); }
