import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exportRoot = process.env.EXPO_AUDIT_EXPORT_DIR ? path.resolve(process.env.EXPO_AUDIT_EXPORT_DIR) : path.join(mobileRoot, '.cache/export-sdk57');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(exportRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(exportRoot + path.sep)) throw new Error('Invalid path');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
    response.end(await fs.readFile(file));
  } catch { response.statusCode = 404; response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const localBase = `http://127.0.0.1:${server.address().port}`;
const base = 'https://app.uficonnect.org';
const profile = { id: 'private-member-id', name: 'Private Member Name', email: 'private@example.test', title: 'Private Title', onboardingComplete: true, joinedGroups: [], skills: [], connectedPlatforms: [] };
const group = { id: 'private-group-id', name: 'Private Group Name', category: 'Tech', members: 10, description: 'Private group description' };
const participant = { id: 'private-participant-id', name: 'Private Participant Name', title: 'Private Member Title' };
const password = 'Private synthetic password';
let browser;
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };
const allScreens = new Set();

async function closeAuditContext(context) {
  // Finish intercepted asset responses before disposing the context's request
  // client. Any request arriving during teardown remains network-isolated.
  await context.route('**/*', route => route.abort());
  await Promise.all(context.pages().map(page => page.unrouteAll({ behavior: 'wait' })));
  await context.close();
}

async function readEvents(page) {
  const frame = page.frames().find(value => value.url().includes('/analytics-bridge.html'));
  if (!frame) return [];
  return frame.evaluate(() => (window.dataLayer || []).map(value => Array.from(value))
    .filter(value => value[0] === 'event' && value[1] === 'page_view').map(value => value[2]));
}

async function expectScreen(page, pathname) {
  await page.frameLocator('iframe[title="Optional page analytics"]').locator('title').waitFor({ state: 'attached' });
  const frame = page.frames().find(value => value.url().includes('/analytics-bridge.html'));
  assert.ok(frame, 'Consented screen tracking must have a sandbox frame');
  try {
    await frame.waitForFunction(expected => (window.dataLayer || []).some(value => value[0] === 'event' && value[1] === 'page_view' && value[2]?.page_location === 'https://uficonnect.org' + expected), pathname, { timeout: 10000, polling: 50 });
  } catch (error) {
    console.error('Missing screen', pathname, 'events:', await readEvents(page));
    console.error((await page.locator('body').innerText()).slice(0, 1600));
    throw error;
  }
  const events = await readEvents(page);
  const event = events.at(-1);
  check(event.page_location === 'https://uficonnect.org' + pathname, `Expected fixed screen ${pathname}`);
  allScreens.add(pathname);
}

async function installRoutes(page, googleRequests, onboardingComplete = true) {
  await page.route(base + '/**', async route => {
    const requestUrl = new URL(route.request().url());
    const response = await route.fetch({ url: localBase + requestUrl.pathname + requestUrl.search });
    return route.fulfill({ response });
  });
  await page.route(/https:\/\/([^/]*\.)?(googletagmanager\.com|google-analytics\.com|analytics\.google\.com)\//, async route => {
    googleRequests.push({ url: route.request().url(), body: route.request().postData(), headers: route.request().headers() });
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* Network-isolated Google loader fixture. */' });
  });
  await page.route('https://api.uficonnect.org/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/analytics-bridge.html') return route.fulfill({
      status: 200, contentType: 'text/html', headers: { 'Referrer-Policy': 'no-referrer' },
      body: await fs.readFile(path.join(mobileRoot, '../backend/public/analytics-bridge.html'), 'utf8'),
    });
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const data = pathname === '/auth/login' ? { token: 'private-session-token', profile: { ...profile, onboardingComplete } }
      : pathname === '/profile' ? { profile: { ...profile, onboardingComplete } }
        : pathname === '/groups' ? { groups: [group] }
          : pathname === '/messages' ? { conversations: [{ id: 'private-conversation-id', participant, lastMessage: { content: 'Private Message Contents' }, unreadCount: 0 }] }
            : pathname.startsWith('/groups/') && pathname.endsWith('/members') ? { members: [], total: 10 }
              : { opportunities: [], groups: [], categories: [], posts: [], jobs: [], messages: [], platforms: [], conversations: [] };
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(data) });
  });
}

try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  const googleRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await installRoutes(page, googleRequests);
  await page.goto(`${base}/?token=private-url-token#private-fragment`);
  await page.getByRole('button', { name: 'Decline analytics', exact: true }).waitFor();
  check(googleRequests.length === 0 && page.frames().length === 1, 'No Google request or analytics frame before consent');
  check(await page.evaluate(() => localStorage.getItem('uficonnect.analytics.client.v1')) === null, 'No analytics identifier is stored before consent');
  await page.screenshot({ path: path.join(mobileRoot, '.cache/analytics-consent-390.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Decline analytics', exact: true }).click();
  await page.getByText('Create one', { exact: true }).click();
  await page.getByLabel('New password', { exact: true }).fill(password);
  check(googleRequests.length === 0 && page.frames().length === 1, 'Declining also prevents analytics on later screens');
  await page.getByRole('button', { name: 'Analytics preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('iframe[title="Optional page analytics"]'));
  await expectScreen(page, '/app/register');
  const frame = page.frames().find(value => value.url().includes('/analytics-bridge.html'));
  check(await page.locator('iframe').getAttribute('sandbox') === 'allow-scripts allow-same-origin', 'Google runs in a restricted sandbox on a different origin');
  check(await frame.evaluate(() => { try { return window.parent.document.body === null; } catch { return true; } }), 'Analytics cannot read the app document');
  check(await frame.evaluate(() => { try { window.parent.localStorage.getItem('token'); return false; } catch { return true; } }), 'Analytics cannot read app storage');
  await page.getByText('Sign in', { exact: true }).last().click();
  await expectScreen(page, '/app/login');
  await page.getByPlaceholder('you@example.com').fill(profile.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByText('Sign in', { exact: true }).click();
  await page.getByPlaceholder('Search jobs, gigs, grants, events...').waitFor();
  await expectScreen(page, '/app/opportunities');
  await page.getByPlaceholder('Search jobs, gigs, grants, events...').fill('Private Search Terms');
  await page.getByRole('tab', { name: 'Groups' }).click();
  await page.getByText(group.name, { exact: true }).click();
  await expectScreen(page, '/app/group');
  allScreens.add('/app/groups');
  check((await readEvents(page)).some(event => event.page_location === 'https://uficonnect.org/app/groups'), 'Groups list is tracked before group details');
  await page.getByRole('tab', { name: 'Feed' }).click();
  await expectScreen(page, '/app/feed');
  await page.getByRole('tab', { name: 'Messages' }).click();
  await expectScreen(page, '/app/messages');
  await page.getByText(participant.name, { exact: true }).click();
  await page.getByPlaceholder('Message...').fill('Private Message Draft');
  await expectScreen(page, '/app/conversation');
  await page.getByRole('tab', { name: 'Profile' }).click();
  await expectScreen(page, '/app/profile');
  await page.getByText('Connected accounts', { exact: true }).click();
  await expectScreen(page, '/app/connected-accounts');
  // Pressing the active tab returns its nested navigator to its first screen.
  await page.getByRole('tab', { name: 'Profile' }).click();
  await page.getByText('Security', { exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill(password);
  await expectScreen(page, '/app/security');
  await page.getByRole('tab', { name: 'Profile' }).click();
  await page.getByRole('button', { name: 'Data & privacy', exact: true }).click();
  await expectScreen(page, '/app/privacy');
  await page.getByRole('link', { name: /Go back|, back/i }).first().click();
  const events = await readEvents(page);
  const commands = await frame.evaluate(() => (window.dataLayer || []).map(value => Array.from(value)));
  const serialized = JSON.stringify({ events, commands, googleRequests });
  for (const secret of [profile.id, profile.name, profile.email, password, group.id, group.name, participant.id, participant.name, 'private-session-token', 'Private Message Contents', 'Private Message Draft', 'Private Search Terms', 'private-url-token', 'private-fragment']) {
    check(!serialized.includes(secret), `No private value in analytics: ${secret}`);
  }
  check(googleRequests.every(request => !request.headers.referer), 'Google requests omit the source-page referrer');
  await page.getByRole('button', { name: 'Analytics preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Decline analytics', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('iframe[title="Optional page analytics"]'));
  check(page.frames().length === 1, 'Withdrawing consent destroys the Google execution context');
  check(await page.evaluate(() => localStorage.getItem('uficonnect.analytics.client.v1')) === null, 'Withdrawing consent removes the analytics identifier');
  const countBefore = googleRequests.length;
  await page.getByRole('tab', { name: 'Feed' }).click();
  await page.reload();
  await page.getByLabel('Password', { exact: true }).waitFor();
  check(googleRequests.length === countBefore && page.frames().length === 1, 'Withdrawing consent persists across navigation and reload');
  check(errors.length === 0, `No app runtime errors: ${errors.join('; ')}`);
  await closeAuditContext(context);

  const onboardingContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const onboardingPage = await onboardingContext.newPage();
  await installRoutes(onboardingPage, [], false);
  await onboardingPage.goto(base);
  await onboardingPage.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await onboardingPage.getByPlaceholder('you@example.com').fill(profile.email);
  await onboardingPage.getByLabel('Password', { exact: true }).fill(password);
  await onboardingPage.getByText('Sign in', { exact: true }).click();
  await expectScreen(onboardingPage, '/app/onboarding');
  await closeAuditContext(onboardingContext);
  check(allScreens.size === 13, 'All thirteen rendered screens are counted with fixed names');

  const blockedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const blockedPage = await blockedContext.newPage();
  const blockedGoogle = [];
  await installRoutes(blockedPage, blockedGoogle);
  await blockedPage.goto(base);
  await blockedPage.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expectScreen(blockedPage, '/app/login');
  function blockAnalyticsStorage() {
    const set = window.Storage.prototype.setItem, remove = window.Storage.prototype.removeItem;
    window.Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('uficonnect.analytics.')) throw new Error('Synthetic blocked analytics storage');
      return set.call(this, key, value);
    };
    window.Storage.prototype.removeItem = function(key) {
      if (key.startsWith('uficonnect.analytics.')) throw new Error('Synthetic blocked analytics storage');
      return remove.call(this, key);
    };
  }
  await blockedPage.addInitScript(blockAnalyticsStorage);
  await blockedPage.evaluate(blockAnalyticsStorage);
  await blockedPage.getByRole('button', { name: 'Analytics preferences', exact: true }).click();
  await blockedPage.getByRole('button', { name: 'Decline analytics', exact: true }).click();
  await blockedPage.waitForFunction(() => !document.querySelector('iframe[title="Optional page analytics"]'));
  check(await blockedPage.getByRole('alert').filter({hasText:'This browser could not save your choice'}).first().isVisible(), 'Failed consent persistence is visibly reported');
  const googleBeforeReload = blockedGoogle.length;
  await blockedPage.reload();
  await blockedPage.getByLabel('Password', { exact: true }).waitFor();
  check(blockedPage.frames().length === 1 && blockedGoogle.length === googleBeforeReload, 'A saved grant cannot restart Google while storage is blocked');
  check(await blockedPage.getByRole('alert').filter({hasText:'This browser could not save your choice'}).first().isVisible(), 'Reload reports unavailable persistence instead of a saved choice');
  await closeAuditContext(blockedContext);

  for (const platform of ['android', 'ios']) {
    const directory = path.join(exportRoot, '_expo/static/js', platform);
    const bundle = (await fs.readdir(directory)).find(file => file.endsWith('.hbc'));
    assert.ok(bundle, `Missing ${platform} Hermes export`);
    const data = await fs.readFile(path.join(directory, bundle));
    check(!data.includes(Buffer.from('G-F68DRQ6CC5')) && !data.includes(Buffer.from('googletagmanager.com')), `${platform} excludes the web collector and web measurement ID`);
  }
  console.log(`Expo analytics export audit: ${checks} checks passed, all 13 screens covered.`);
} finally {
  if (browser) await Promise.all(browser.contexts().map(closeAuditContext));
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
