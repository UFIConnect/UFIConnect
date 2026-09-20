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
const memberId = 'account-sidebar-audit';
app.seedUser(member(memberId, { name: 'Alexandra Montgomery Washington', avatarUrl: '/test-avatar.png' }));
const proxy = prefix => ({ target: app.base, rewrite: value => value.replace(prefix, '') });
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/fallback') },
  server: { host: '127.0.0.1', port: 5198, strictPort: false,
    proxy: { '/api': proxy(/^\/api/), '/fallback': proxy(/^\/fallback/) } },
});
let browser;
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 820, height: 1180 }, { width: 1440, height: 1000 }]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width <= 768, hasTouch: viewport.width <= 768 });
    const published = [];
    const routeApi = async route => {
      const endpoint = new URL(route.request().url()).pathname.replace(/^\/(api|fallback)/, '');
      if (route.request().method() === 'POST' && /^\/groups\/[^/]+\/posts$/.test(endpoint)) {
        published.push({ endpoint, body: route.request().postDataJSON() });
        return route.fulfill({ status: 201, json: { post: { id: 'sidebar-general-post' } } });
      }
      if (endpoint === '/office/feed') return route.fulfill({ json: { posts: [], hasMore: false, nativeUficonnectIncluded: true } });
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    };
    await context.route('**/api/**', routeApi);
    await context.route('**/fallback/**', routeApi);
    await context.route('**/test-avatar.png', route => route.fulfill({
      contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    }));
    const page = await context.newPage();
    await installAuditMember(page, app, memberId);
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const drawer = page.locator('#mobile-account-drawer');
    const opener = page.getByRole('button', { name: 'Open account menu', exact: true });
    const closeButton = drawer.getByRole('button', { name: 'Close account sidebar' });
    const rightOpener = page.getByRole('button', { name: 'Open menu', exact: true });
    const waitOpen = async () => {
      await page.waitForFunction(() => document.querySelector('#mobile-account-drawer')?.getAttribute('aria-hidden') === 'false');
      await page.waitForFunction(() => Math.abs(document.querySelector('#mobile-account-drawer').getBoundingClientRect().x) < 1);
    };
    const waitClosed = async () => {
      await page.waitForFunction(() => !document.querySelector('#mobile-account-drawer') || document.querySelector('#mobile-account-drawer').getAttribute('aria-hidden') === 'true');
      // The closing animation can still cover the next touch target after aria-hidden changes.
      await page.waitForFunction(() => {
        const element = document.querySelector('#mobile-account-drawer');
        return !element || !element.getClientRects().length || element.getBoundingClientRect().right <= 1;
      });
      check(await page.evaluate(() => document.body.style.overflow !== 'hidden'), 'Page scrolling must unlock after closing');
    };
    try {
      await auditNavigate(page, base);
      await page.locator('.home-feed-layout').waitFor();
      if (viewport.width > 768) {
        await page.locator('.sidebar-logout--danger').waitFor();
        check(!(await opener.isVisible()), 'Mobile opener leaked into desktop');
        check(!(await drawer.isVisible()), 'Mobile account drawer leaked into desktop');
        check(await page.locator('.sidebar-logout--danger').isVisible(), 'Desktop logout should stay in place');
      } else {
        await opener.waitFor();
        const brandBounds = await page.locator('.mobile-app-header-brand').boundingBox();
        const openerBounds = await opener.boundingBox();
        check(brandBounds.x < openerBounds.x, 'Home icon must precede the account sidebar button');
        await opener.click();
        await waitOpen();
        check(await page.evaluate(() => document.body.style.overflow === 'hidden'), 'Background must not scroll behind the drawer');
        const bounds = await drawer.boundingBox();
        const post = await drawer.getByRole('link', { name: 'Post', exact: true }).boundingBox();
        const createGroup = await drawer.getByRole('link', { name: 'Create a group', exact: true }).boundingBox();
        const shop = await drawer.getByRole('link', { name: 'Shop', exact: true }).boundingBox();
        const profile = await drawer.getByRole('link', { name: 'Profile', exact: true }).boundingBox();
        const logout = await drawer.getByRole('button', { name: 'Log out', exact: true }).boundingBox();
        check(Math.abs(bounds.x) < 1 && bounds.width <= viewport.width, 'Drawer must open on the left');
        check(post.y < 110 && post.y + post.height <= createGroup.y && createGroup.y + createGroup.height <= shop.y, 'The sidebar must start with Post, Create a group, then Shop');
        check(profile.y > viewport.height * 0.55 && logout.y > profile.y, 'Profile and account actions belong at the bottom');
        check(logout.y + logout.height <= viewport.height, 'Bottom actions must remain on screen');
        check(await drawer.locator('img').evaluate(img => img.complete && img.naturalWidth > 0), 'Saved avatar did not load');
        check(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Long profile name overflows the drawer');
        check(await closeButton.evaluate(el => el === document.activeElement), 'Opening should focus the drawer');
        await page.keyboard.press('Shift+Tab');
        check(await drawer.getByRole('button', { name: 'Log out', exact: true }).evaluate(el => el === document.activeElement), 'Reverse tab must stay inside the drawer');
        await page.keyboard.press('Tab');
        check(await closeButton.evaluate(el => el === document.activeElement), 'Tab must wrap inside the drawer');
        await page.screenshot({ path: path.join(output, `account-sidebar-${viewport.width}.png`) });
        await page.keyboard.press('Escape');
        await waitClosed();
        check(await opener.evaluate(el => el === document.activeElement), 'Closing should return focus to the opener');

        await opener.click();
        await waitOpen();
        await page.locator('.mobile-command-menu-scrim').click({ position: { x: viewport.width - 5, y: 150 } });
        await waitClosed();
        await opener.click();
        await waitOpen();
        await drawer.getByRole('link', { name: 'Shop', exact: true }).click();
        await page.waitForURL('**/?feed=ufi&channel=shop');
        await page.getByRole('button', { name: 'Create a Shop post', exact: true }).waitFor();
        await waitClosed();
        check(new URL(page.url()).searchParams.get('channel') === 'shop', 'Shop route is not connected');
        await opener.click();
        await waitOpen();
        await drawer.getByRole('link', { name: 'Post', exact: true }).click();
        const composer = page.getByRole('form', { name: 'Create UFI post', exact: true });
        await composer.waitFor();
        await waitClosed();
        check(new URL(page.url()).searchParams.get('channel') === null, 'Post must leave Shop and use General');
        await composer.getByRole('textbox').fill(`General sidebar post at ${viewport.width}px`);
        await composer.getByRole('button', { name: 'Publish', exact: true }).click();
        await composer.waitFor({ state: 'hidden' });
        check(published.length === 1 && published[0].endpoint === '/groups/ufi-general/posts', 'Post must publish to General');
        check(published[0].body.content === `General sidebar post at ${viewport.width}px`, 'The General post must preserve its content');
        await opener.click();
        await waitOpen();
        await drawer.getByRole('link', { name: 'Post', exact: true }).click();
        await composer.waitFor();
        await waitClosed();
        await composer.getByRole('button', { name: 'Cancel', exact: true }).click();
        await composer.waitFor({ state: 'hidden' });
        await opener.click();
        await waitOpen();
        await drawer.getByRole('link', { name: 'Create a group', exact: true }).click();
        await page.waitForURL('**/search?tab=groups&create=1');
        await page.getByRole('heading', { name: 'Create a group', exact: true }).waitFor();
        await waitClosed();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('heading', { name: 'Create a group', exact: true }).waitFor({ state: 'hidden' });
        await opener.click();
        await waitOpen();
        await drawer.getByRole('link', { name: 'Create a group', exact: true }).click();
        await page.getByRole('heading', { name: 'Create a group', exact: true }).waitFor();
        await waitClosed();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await opener.click();
        await waitOpen();
        await drawer.getByRole('link', { name: 'Roles', exact: true }).click();
        await page.waitForURL('**/profile?tab=saved&section=jobs');
        await waitClosed();
        const savedTabs = page.getByRole('tablist', { name: 'Saved items' });
        await savedTabs.waitFor();
        check(await savedTabs.getByRole('tab', { name: /^Jobs/ }).getAttribute('aria-selected') === 'true', 'Roles must open saved jobs');
        await auditReload(page);
        await savedTabs.waitFor();
        check(await savedTabs.getByRole('tab', { name: /^Jobs/ }).getAttribute('aria-selected') === 'true', 'Saved roles must survive reload');
        await opener.click();
        await waitOpen();
        await drawer.getByRole('link', { name: 'Posts', exact: true }).click();
        await page.waitForURL('**/profile?tab=saved&section=posts');
        await waitClosed();
        await savedTabs.getByRole('tab', { name: /^Posts/, selected: true }).waitFor();
        check(await savedTabs.getByRole('tab', { name: /^Posts/ }).getAttribute('aria-selected') === 'true', 'Posts must open saved posts');
        await page.goBack();
        await page.waitForURL('**/profile?tab=saved&section=jobs');
        await savedTabs.getByRole('tab', { name: /^Jobs/, selected: true }).waitFor();
        check(await savedTabs.getByRole('tab', { name: /^Jobs/ }).getAttribute('aria-selected') === 'true', 'Back must restore saved roles');
        await opener.click();
        await waitOpen();
        await drawer.getByRole('link', { name: 'Profile', exact: true }).click();
        await page.waitForURL('**/profile');
        await page.getByRole('button', { name: 'Edit profile', exact: true }).waitFor();
        await waitClosed();
        await opener.click();
        await waitOpen();
        await drawer.getByRole('link', { name: 'Settings', exact: true }).click();
        await page.waitForURL('**/settings');
        await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
        await waitClosed();

        for (const route of ['', 'opportunities']) {
          await auditNavigate(page, base + route);
          await page.locator(route ? '.jobs-page-layout' : '.home-feed-layout').waitFor();
          await rightOpener.click();
          const right = page.locator('#mobile-feed-drawer');
          await page.waitForFunction(() => document.querySelector('#mobile-feed-drawer').getAttribute('aria-hidden') === 'false');
          check(await right.getByRole('link', { name: 'Settings', exact: true }).count() === 0, 'Settings still duplicated in the right sidebar');
          check(await right.getByRole('button', { name: 'Log out', exact: true }).count() === 0, 'Logout still duplicated in the right sidebar');
          await page.keyboard.press('Escape');
          await opener.click();
          await waitOpen();
          check(await right.getAttribute('aria-hidden') === 'true', 'Both sidebars must not be open together');
          await closeButton.click();
          await waitClosed();
        }

        await auditNavigate(page, base);
        await page.locator('.home-feed-layout').waitFor();
        await waitClosed();
        await opener.waitFor();
        // Real touch input also exercises native scrolling and touchcancel.
        const session = await context.newCDPSession(page);
        const swipe = async (x1, y1, x2, y2) => {
          await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
          for (let i = 1; i <= 5; i++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * i / 5, y: y1 + (y2 - y1) * i / 5 }] });
          await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        await swipe(20, 200, 140, 200);
        await waitOpen();
        await swipe(180, 220, 65, 220);
        await waitClosed();
        await swipe(20, 280, 25, 180);
        await waitClosed();
        await swipe(viewport.width / 2, 200, viewport.width / 2 + 70, 200);
        await waitClosed();
        await session.detach();

        await opener.click();
        await waitOpen();
        await drawer.locator('img').dispatchEvent('error');
        check(await drawer.locator('img').count() === 0, 'Broken avatar should fall back to initials');
        check((await drawer.locator('.mobile-account-avatar').textContent()).trim().length > 0, 'Avatar fallback is empty');
        await page.setViewportSize({ width: 1024, height: 768 });
        await waitClosed();
        check(!(await drawer.isVisible()), 'Drawer must disappear on desktop resize');
        await page.setViewportSize(viewport);
        await opener.click();
        await waitOpen();
        await drawer.getByRole('button', { name: 'Log out', exact: true }).click();
        await page.waitForURL('**/login');
        check(await page.evaluate(() => !localStorage.getItem('pc_token')), 'Logout did not clear the synthetic member session');
        await waitClosed();
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Page overflows horizontally');
      check(errors.length === 0, `Browser errors: ${errors.join(', ')}`);
      console.log(`PASS: account sidebar at ${viewport.width}px`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `account-sidebar-failure-${viewport.width}.png`) });
      throw error;
    } finally {
      await context.close();
    }
  }
  console.log(`PASS: ${checks} mobile account sidebar checks`);
} finally {
  await browser?.close();
  await server.close();
  await app.close();
}
