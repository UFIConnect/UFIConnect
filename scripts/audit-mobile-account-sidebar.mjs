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
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  // BrowserRouter may publish a URL before its transition commits. The compose
  // command's removal has no distinct DOM content, so observe the real route
  // effect in this audit build without changing or bypassing its behavior.
  plugins: [{ name: 'audit-layout-route-ready', enforce: 'pre', transform(source, id) {
    if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/components/Layout.jsx')) return;
    const pattern = /(useEffect\(\(\) => \{)(\s*const previous = overlayRouteRef\.current;)/;
    assert.ok(pattern.test(source), 'The Layout route-close effect must be instrumented');
    return source.replace(pattern, '$1\n    window.__sidebarAuditRoute = location.pathname + location.search;$2');
  } }],
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/fallback') },
  server: { host: '127.0.0.1', port: 5198, strictPort: false,
    proxy: { '/api': proxy(/^\/api/), '/fallback': proxy(/^\/fallback/) } },
});
let browser;
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
async function checkMessagesPlacement(navigation, label) {
  const messages = navigation.getByRole('link', { name: 'Messages', exact: true });
  const groups = navigation.getByRole('link', { name: 'Discover groups', exact: true });
  await messages.scrollIntoViewIfNeeded();
  check(await messages.isVisible(), `${label} keeps Messages visible`);
  check(await messages.evaluate(element => element.nextElementSibling?.getAttribute('href') === '/groups'
    && element.nextElementSibling?.textContent.trim() === 'Discover groups'), `${label} places Messages immediately before Discover groups in keyboard order`);
  const [messagesBounds, groupsBounds] = await Promise.all([messages.boundingBox(), groups.boundingBox()]);
  check(messagesBounds && groupsBounds && Math.abs(messagesBounds.y - groupsBounds.y) <= 1
    && groupsBounds.x >= messagesBounds.x + messagesBounds.width - 1,
    `${label} places Messages and Discover groups on the same row`);
  await messages.focus();
  await messages.page().keyboard.press('Tab');
  check(await groups.evaluate(element => document.activeElement === element), `${label} tabs from Messages to Discover groups`);
  await messages.page().screenshot({ path: path.join(output, `messages-${label.toLowerCase().replaceAll(' ', '-')}-${messages.page().viewportSize().width}.png`) });
}
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 820, height: 1180 }, { width: 1440, height: 1000 }].filter(viewport => !process.env.ACCOUNT_SIDEBAR_WIDTHS || process.env.ACCOUNT_SIDEBAR_WIDTHS.split(',').includes(String(viewport.width)))) {
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
    await page.addInitScript(() => {
      window.__sidebarAuditEvents=[];
      const record=value=>{window.__sidebarAuditEvents.push({at:performance.now(),path:location.pathname+location.search,...value});window.__sidebarAuditEvents=window.__sidebarAuditEvents.slice(-30);};
      document.addEventListener('click',event=>{if(event.target.closest?.('[aria-label="Open account menu"]'))record({event:'account-click'});},true);
      new MutationObserver(records=>{for(const entry of records)if(entry.target.id==='mobile-account-drawer'&&entry.attributeName==='aria-hidden')record({event:'drawer',hidden:entry.target.getAttribute('aria-hidden')});}).observe(document,{subtree:true,attributes:true,attributeFilter:['aria-hidden']});
    });
    await installAuditMember(page, app, memberId);
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const drawer = page.locator('#mobile-account-drawer');
    const opener = page.getByRole('button', { name: 'Open account menu', exact: true });
    const closeButton = drawer.getByRole('button', { name: 'Close account sidebar' });
    const rightOpener = page.getByRole('button', { name: 'Open menu', exact: true });
    const waitOpen = async () => {
      const waitForOpenState = timeout => page.waitForFunction(
        () => document.querySelector('#mobile-account-drawer')?.getAttribute('aria-hidden') === 'false',
        undefined, { timeout },
      );
      try {
        await waitForOpenState(4000);
      } catch {
        // A dialog scrim can finish leaving just after its heading becomes hidden,
        // swallowing the first synthetic tap. Retry only while the drawer is closed.
        if (await drawer.getAttribute('aria-hidden') !== 'false') await opener.click();
        await waitForOpenState(12000);
      }
      await page.waitForFunction(() => Math.abs(document.querySelector('#mobile-account-drawer').getBoundingClientRect().x) < 1);
    };
    const waitClosed = async () => {
      await page.waitForFunction(() => !document.querySelector('#mobile-account-drawer')
        || window.__sidebarAuditRoute === location.pathname + location.search);
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
        const saved = page.locator('.sidebar').getByRole('button', { name: 'Saved', exact: true });
        await saved.click();
        check(await page.locator('#sidebar-saved-links').getByRole('link', { name: 'Saved jobs', exact: true }).isVisible(), 'Desktop Saved must expand its child pages');
        await saved.click();
        check(!(await page.locator('#sidebar-saved-links').isVisible()), 'Desktop Saved must hide its child pages');
        check(await page.locator('.sidebar').getByRole('link', { name: 'Cross post', exact: true }).getAttribute('href') === '/command-center?tab=crosspost', 'Cross post must open Command Center publishing');
        check(await page.locator('.sidebar').getByRole('link', { name: 'Post to a group', exact: true }).getAttribute('href') === '/groups/post', 'Desktop group posting opens the group composer');
        check(await page.locator('.sidebar nav').evaluate(nav => {
          const labels = [...nav.querySelectorAll('a')].map(link => link.getAttribute('aria-label'));
          return labels.indexOf('Create a group') === labels.indexOf('Post to a group') + 1;
        }), 'Create a group sits directly under Post to a group');
        const headerNav = page.getByRole('navigation', { name: 'Main navigation', exact: true });
        for (const label of ['Home', 'Videos', 'Jobs', 'Profile']) {
          check(await headerNav.getByRole('link', { name: label, exact: true }).isVisible(), `${label} must appear beside desktop search`);
          check(await page.locator('.sidebar-nav').getByRole('link', { name: label, exact: true }).count() === 0, `${label} must not be duplicated in the left bar`);
        }
        check(await page.locator('.sidebar').getByRole('link', { name: 'Notifications', exact: true }).count() === 0, 'Notifications must leave the desktop left bar');
        check(await page.locator('.global-desktop-alerts').isVisible(), 'Alerts remain accessible beside search');
        const searchBounds = await page.locator('.global-search-bar').boundingBox();
        const navBounds = await headerNav.boundingBox();
        const alertsBounds = await page.locator('.global-desktop-alerts').boundingBox();
        check(Math.abs(searchBounds.y - navBounds.y) < 2 && navBounds.x + navBounds.width <= searchBounds.x, 'Main destinations must sit left of search in the same row');
        check(alertsBounds.x >= searchBounds.x + searchBounds.width, 'Alerts remain right of search');
        check(await page.locator('.home-feed-rail-bottom').getByRole('link', { name: 'Messages', exact: true }).isVisible(), 'Messages remains visible in the Home left rail');
        await checkMessagesPlacement(page.locator('.home-feed-rail-bottom'), 'Home rail');
        check(await page.locator('.global-search-center').getByRole('link', { name: 'Messages', exact: true }).count() === 0, 'Messages is not duplicated beside search');
        await headerNav.getByRole('link', { name: 'Jobs', exact: true }).click();
        await page.waitForURL('**/opportunities');
        await page.locator('.jobs-page-layout').waitFor();
        await checkMessagesPlacement(page.locator('.jobs-page-rail-bottom'), 'Jobs rail');
        const jobsSearch = page.getByRole('search', { name: 'Search UFIconnect', exact: true });
        await jobsSearch.getByRole('searchbox').fill('community engineer');
        await jobsSearch.getByRole('button', { name: 'Search jobs', exact: true }).click();
        await page.waitForURL(url => url.pathname === '/opportunities' && url.searchParams.get('q') === 'community engineer');
        check(await jobsSearch.getByRole('searchbox').inputValue() === 'community engineer', 'Jobs header search preserves the current job context and query');
        check(await page.getByRole('dialog', { name: 'Search UFIconnect', exact: true }).count() === 0, 'Jobs header search updates the page without a duplicate search dialog');
      } else {
        await opener.waitFor();
        const openerBounds = await opener.boundingBox();
        check(openerBounds.x < 30 && openerBounds.width >= 44, 'UFI menu must stay on the left with a usable touch target');
        check(await opener.locator('img').getAttribute('src') === '/uficonnect-google-verification-icon.svg', 'Left sidebar button must show the original UFI mark');
        await opener.click();
        await waitOpen();
        check(await page.evaluate(() => document.body.style.overflow === 'hidden'), 'Background must not scroll behind the drawer');
        const bounds = await drawer.boundingBox();
        const search = await drawer.getByRole('link', { name: 'Search', exact: true }).boundingBox();
        const people = await drawer.getByRole('link', { name: 'People', exact: true }).boundingBox();
        const post = await drawer.getByRole('link', { name: 'Post', exact: true }).boundingBox();
        const createGroup = await drawer.getByRole('link', { name: 'Create a group', exact: true }).boundingBox();
        const postToGroup = await drawer.getByRole('link', { name: 'Post to a group', exact: true }).boundingBox();
        check(Math.abs(createGroup.y - (postToGroup.y + postToGroup.height)) < 12, 'The mobile menu lists Create a group directly under Post to a group');
        const shop = await drawer.getByRole('link', { name: 'Shop', exact: true }).boundingBox();
        const profile = await drawer.getByRole('link', { name: 'Profile', exact: true }).boundingBox();
        const logout = await drawer.getByRole('button', { name: 'Log out', exact: true }).boundingBox();
        check(Math.abs(bounds.x) < 1 && bounds.width <= viewport.width, 'Drawer must open on the left');
        check(search.y < 110 && search.y + search.height <= people.y && people.y + people.height <= post.y, 'The sidebar starts with Search directly above People and Post');
        check(post.y + post.height <= postToGroup.y && postToGroup.y + postToGroup.height <= createGroup.y && createGroup.y + createGroup.height <= shop.y,
          'The sidebar orders Post, Post to a group, Create a group, then Shop');
        check(profile.y > viewport.height * 0.55 && logout.y > profile.y, 'Profile and account actions belong at the bottom');
        const accountLinks = drawer.locator('.mobile-account-drawer-links');
        check(await accountLinks.evaluate(element => element.clientHeight > 0 && getComputedStyle(element).overflowY === 'auto'), 'Long account links have their own scroll area');
        const pinnedActions = drawer.locator('.mobile-account-drawer-bottom');
        const pinnedBefore = await pinnedActions.boundingBox();
        check(pinnedBefore.y >= bounds.y && pinnedBefore.y + pinnedBefore.height <= bounds.y + bounds.height + 1,
          'Profile and account actions remain inside the drawer viewport');
        const scrollState = await accountLinks.evaluate(element => new Promise(resolve => {
          const previous = element.scrollTop;
          const maximum = element.scrollHeight - element.clientHeight;
          element.scrollTop = maximum;
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const reached = element.scrollTop;
            resolve({ previous, maximum, reached });
          }));
        }));
        const pinnedAfter = await pinnedActions.boundingBox();
        check(scrollState.reached >= scrollState.maximum - 1 && Math.abs(pinnedAfter.y - pinnedBefore.y) <= 1,
          'The account links reach their end while bottom actions stay anchored');
        await accountLinks.evaluate((element, previous) => { element.scrollTop = previous; }, scrollState.previous);
        for (const [label, category] of [['Travel', 'countries'], ['Restaurants', 'restaurants'], ['Bars and clubs', 'bars']]) {
          const postLink = drawer.getByRole('link', { name: `Post to ${label}`, exact: true });
          check(await postLink.getAttribute('href') === `/?feed=${category}&compose=1`, `Post to ${label} must open the composer in its feed`);
          const postStyle = await postLink.evaluate(element => ({ weight: getComputedStyle(element).fontWeight, background: getComputedStyle(element).backgroundImage }));
          check(Number(postStyle.weight) < 700 && postStyle.background === 'none', 'Sidebar posting links use regular navigation styling');
        }
        check(await drawer.locator('img').evaluate(img => img.complete && img.naturalWidth > 0), 'Saved avatar did not load');
        check(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Long profile name overflows the drawer');
        check(await drawer.getByRole('link', { name: 'Cross post', exact: true }).getAttribute('href') === '/command-center?tab=crosspost', 'Mobile Cross post must open the publishing tab');
        check(await drawer.getByRole('link', { name: 'Post to your group', exact: true }).count() === 0, 'Group posting must move out of the mobile sidebar');
        check(await closeButton.evaluate(el => el === document.activeElement), 'Opening should focus the drawer');
        await page.keyboard.press('Shift+Tab');
        check(await drawer.getByRole('button', { name: 'Log out', exact: true }).evaluate(el => el === document.activeElement), 'Reverse tab must stay inside the drawer');
        await page.keyboard.press('Tab');
        check(await closeButton.evaluate(el => el === document.activeElement), 'Tab must wrap inside the drawer');
        await page.screenshot({ path: path.join(output, `account-sidebar-${viewport.width}.png`) });
        await page.keyboard.press('Escape');
        await waitClosed();
        check(await opener.evaluate(el => el === document.activeElement), 'Closing should return focus to the opener');

        // Only the consumed compose=1 command is exempt from route cleanup.
        // Browser-history query changes still close an already open drawer.
        for (const compose of ['0', null]) {
          await opener.click();
          await waitOpen();
          await page.evaluate(value => {
            const next = new URL(location.href);
            if (value === null) next.searchParams.delete('compose');
            else next.searchParams.set('compose', value);
            history.pushState(history.state, '', next);
            window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
          }, compose);
          await waitClosed();
          check(new URL(page.url()).searchParams.get('compose') === compose, 'Ordinary compose query changes retain their navigation behavior');
        }

        for (const [label, category] of [['Travel', 'countries'], ['Restaurants', 'restaurants'], ['Bars and clubs', 'bars']]) {
          await opener.click();
          await waitOpen();
          await drawer.getByRole('link', { name: `Post to ${label}`, exact: true }).click();
          await page.waitForURL(url => new URL(url).searchParams.get('feed') === category);
          await page.getByRole('form', { name: `Create ${label} post`, exact: true }).waitFor();
          // Opening a linked composer consumes its command parameter in a second
          // navigation. Wait for that route before the next shared-menu interaction.
          await page.waitForURL(url => url.searchParams.get('feed') === category && !url.searchParams.has('compose'));
          // The router publishes the URL before Layout's route-change effect
          // closes old drawers. Let that commit finish before the next tap.
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await waitClosed();
        }

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
        await composer.getByRole('button', { name: 'Publish to 1 ready destination', exact: true }).click();
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
        check(new URL(page.url()).searchParams.get('create') === null, 'Cancelling a linked group dialog clears its route before hiding');
        await opener.click();
        await waitOpen();
        await drawer.getByRole('link', { name: 'Create a group', exact: true }).click();
        await page.getByRole('heading', { name: 'Create a group', exact: true }).waitFor();
        await waitClosed();
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('heading', { name: 'Create a group', exact: true }).waitFor({ state: 'hidden' });
        check(new URL(page.url()).searchParams.get('create') === null, 'Repeated group cancellation finishes navigation before reopening the sidebar');
        await opener.click();
        await waitOpen();
        const savedToggle = drawer.getByRole('button', { name: 'Saved', exact: true });
        check(await savedToggle.getAttribute('aria-expanded') === 'false', 'Saved starts as one collapsed tab');
        await savedToggle.click();
        check(await drawer.getByRole('link', { name: 'Saved posts', exact: true }).isVisible(), 'Expanding Saved must reveal Posts');
        await drawer.getByRole('link', { name: 'Saved jobs', exact: true }).click();
        await page.waitForURL('**/saved/jobs');
        await waitClosed();
        const savedTabs = page.getByRole('navigation', { name: 'Saved pages' });
        await savedTabs.waitFor();
        check(await savedTabs.getByRole('link', { name: 'Jobs', exact: true }).getAttribute('aria-current') === 'page', 'Roles must open saved jobs');
        await page.getByRole('button', { name: 'Hide saved jobs', exact: true }).click();
        check(!(await page.locator('#saved-page-content').isVisible()), 'Saved jobs can be hidden without deleting them');
        await page.getByRole('button', { name: 'Show saved jobs', exact: true }).click();
        check(await page.locator('#saved-page-content').isVisible(), 'Saved jobs can be shown again');
        await auditReload(page);
        await savedTabs.waitFor();
        check(await savedTabs.getByRole('link', { name: 'Jobs', exact: true }).getAttribute('aria-current') === 'page', 'Saved roles must survive reload');
        await opener.click();
        await waitOpen();
        await drawer.getByRole('link', { name: 'Saved posts', exact: true }).click();
        await page.waitForURL('**/saved/posts');
        await waitClosed();
        await savedTabs.getByRole('link', { name: 'Posts', exact: true }).and(page.locator('[aria-current="page"]')).waitFor();
        check(await savedTabs.getByRole('link', { name: 'Posts', exact: true }).getAttribute('aria-current') === 'page', 'Posts must open saved posts');
        await page.goBack();
        await page.waitForURL('**/saved/jobs');
        await savedTabs.getByRole('link', { name: 'Jobs', exact: true }).and(page.locator('[aria-current="page"]')).waitFor();
        check(await savedTabs.getByRole('link', { name: 'Jobs', exact: true }).getAttribute('aria-current') === 'page', 'Back must restore saved roles');
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
          const messages = right.getByRole('link', { name: 'Messages', exact: true });
          await checkMessagesPlacement(right, route ? 'Jobs drawer' : 'Home drawer');
          check(await messages.getAttribute('href') === '/messages' && await messages.getAttribute('aria-haspopup') === null, 'Mobile Messages opens the full inbox page');
          if (!route) {
            const destinations = ['Travel', 'Restaurants', 'Bars and clubs'];
            const signatures = [];
            const feedList = right.getByRole('navigation', { name: 'Feeds', exact: true });
            check(await feedList.locator(':scope > button,:scope > a').count() === 8, 'Every feed destination belongs to one scrollable list');
            check(await right.locator('.paged-list-navigation').count() === 0, 'Sidebar lists have no Next or Previous page controls');
            for (const name of destinations) {
              const icon = right.getByRole('button', { name, exact: true }).locator('svg');
              check(await icon.count() === 1, `${name} must use the same line-icon treatment as the other destinations`);
              signatures.push(await icon.locator('path').evaluateAll(paths => paths.map(path => path.getAttribute('d')).join('|')));
            }
            check(new Set(signatures).size === destinations.length, 'Travel, Restaurants and Bars need distinct destination icons');
            await feedList.evaluate(element => { element.scrollTop = element.scrollHeight; });
            await feedList.getByRole('link', { name: 'Your Vault', exact: true }).focus();
            check(await feedList.getByRole('link', { name: 'Your Vault', exact: true }).evaluate(element => element === document.activeElement), 'Scrolling reaches the last destination without paging');
            check(await feedList.locator('[hidden]').count() === 0, 'Scrolling does not hide other feed destinations');
          }
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
        check(await drawer.getAttribute('aria-hidden') === 'false', 'An unrelated avatar update must keep the account drawer open');
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
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), 'Page overflows horizontally');
      check(errors.length === 0, `Browser errors: ${errors.join(', ')}`);
      console.log(`PASS: account sidebar at ${viewport.width}px`);
    } catch (error) {
      console.error('Account sidebar failure state:', await page.evaluate(() => ({
        path: location.pathname + location.search,
        width: window.innerWidth,
        mobile: matchMedia('(max-width: 768px)').matches,
        drawerHidden: document.querySelector('#mobile-account-drawer')?.getAttribute('aria-hidden'),
        pageWidth: document.documentElement.scrollWidth,
        active: document.activeElement?.getAttribute('aria-label'),
        events: window.__sidebarAuditEvents,
      })));
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
