import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';
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
const platforms = {
  reddit: { name: 'Reddit', configured: true }, youtube: { name: 'YouTube', configured: true },
  wired: { name: 'WIRED', configured: false, category: 'publication' },
  mittr: { name: 'MIT Technology Review', configured: false, category: 'publication' },
  instagram: { name: 'Instagram', configured: true, commandCenterOnly: true },
  linkedin: { name: 'LinkedIn', configured: true, forceComingSoon: true, commandCenterOnly: true },
  indeed: { name: 'Indeed', category: 'career', configured: false },
};
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5210, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
async function assertEnabledFirst(scope) {
  const rows = await scope.getByRole('switch').evaluateAll(elements => elements.map(element => ({
    name: element.getAttribute('aria-label'),
    enabled: element.getAttribute('aria-checked') === 'true',
  })));
  assert.equal(new Set(rows.map(row => row.name)).size, rows.length, 'Each source appears once');
  assert.deepEqual(rows.map(row => row.enabled), rows.map(row => row.enabled).sort((a, b) => Number(b) - Number(a)),
    'Every enabled source precedes every disabled source, including sources from the API');
  return rows;
}
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  for (const width of [1440, 768, 390, 320]) {
    const id = `directory-${width}`;
    app.seedUser(member(id, { plan: 'pro', roleSettings: { feedSourceFavorites: { feed: ['youtube', 'reddit'], following: [] } } }));
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width <= 768, isMobile: width < 600 });
    await context.route('https://www.indeed.com/', route => route.fulfill({ contentType: 'text/html', body: '<title>Indeed test website</title>' }));
    const page = await context.newPage();
    await installAuditMember(page, app, id);
    const errors = [];
    let authorizationRequests = 0;
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/office/feed?*', route => route.fulfill({ json: { posts: [], hasMore: false, nativeUficonnectIncluded: true } }));
    await page.route('**/api/social/platforms', route => route.fulfill({ json: { platforms, connected: { reddit: true } } }));
    await page.route('**/api/feed/sources?*', route => route.fulfill({ json: {
      sources: [{ id: 'reddit', postCount: 3, lastFetch: new Date().toISOString(), samplePosts: [] },
        { id: 'audit-source', postCount: 0, samplePosts: [] }],
    } }));
    await page.route('**/auth/social/youtube/start*', route => {
      authorizationRequests += 1;
      return route.fulfill({ status: 503, json: { error: 'Test provider unavailable' } });
    });
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=feed&all=1');
    const homeSources = page.getByRole('group', { name: 'Home sources', exact: true });
    await homeSources.getByRole('button', { name: 'We Work Remotely', exact: true }).waitFor();
    await homeSources.getByRole('button', { name: 'Condé Nast Traveler', exact: true }).waitFor();
    await page.getByRole('button', { name: 'View all feed sources', exact: true }).click();
    const websites = page.getByRole('region', { name: 'Source websites', exact: true });
    await websites.getByRole('link', { name: 'Visit Reuters website', exact: true }).waitFor();
    assert.equal(await websites.getByRole('link', { name: 'Visit Reuters website', exact: true }).getAttribute('href'), 'https://www.reuters.com/');
    assert.equal(await homeSources.getByRole('button', { name: 'Reuters', exact: true }).count(), 0);
    await websites.getByRole('combobox', { name: 'Filter source websites', exact: true }).selectOption('travel');
    await websites.getByRole('link', { name: 'Visit Airbnb website', exact: true }).waitFor();
    await websites.getByRole('combobox', { name: 'Filter source websites', exact: true }).selectOption('audio');
    await websites.getByRole('link', { name: 'Visit Spotify website', exact: true }).waitFor();
    assert.equal(await websites.getByRole('link', { name: 'Visit Spotify website', exact: true }).getAttribute('rel'), 'noopener noreferrer');
    await page.getByRole('button', { name: 'View all feed sources', exact: true }).click();
    if (width <= 768) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const tools = page.locator(width <= 768 ? '#mobile-feed-drawer .home-feed-side-tools' : '.home-feed-right-tabs .home-feed-side-tools');
    const sourceTrigger = tools.getByRole('button', { name: /Feed sources/ });
    if (await sourceTrigger.getAttribute('aria-expanded') !== 'true') await sourceTrigger.click();
    await tools.locator('.home-feed-source-name').first().waitFor();
    const names = await tools.locator('.home-feed-source-name').allTextContents();
    assert.equal(new Set(names).size, names.length, 'Each source appears once');
    await assertEnabledFirst(tools);
    assert.ok(names.includes('Reddit'));
    assert.ok(!names.includes('YouTube'), 'Default category shows only social sources');
    assert.equal(await tools.getByRole('combobox', { name: 'Filter feed sources' }).locator('option[value="all"]').count(), 0);
    assert.equal(await tools.getByRole('searchbox').count(), 0);
    assert.equal(await tools.getByRole('button', { name: 'Select favorites', exact: true }).count(), 0);
    await tools.getByRole('combobox', { name: 'Filter feed sources' }).selectOption('career');
    assert.ok((await tools.locator('.home-feed-source-name').allTextContents()).includes('USAJobs'));
    assert.ok(!(await tools.locator('.home-feed-source-name').allTextContents()).includes('Reddit'));
    await tools.getByRole('combobox', { name: 'Filter feed sources' }).selectOption('favorites');
    assert.deepEqual(await tools.locator('.home-feed-source-name').allTextContents(), ['Reddit', 'YouTube']);
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/source-directory-${width}.png`) });
    await tools.getByRole('button', { name: /Connected accounts/ }).click();
    await tools.getByRole('button', { name: 'Sign in and connect YouTube', exact: true }).waitFor();
    assert.equal(await tools.getByRole('searchbox').count(), 0, 'Connected accounts has no search bar');
    assert.equal(await tools.getByRole('link', { name: 'Open Instagram website' }).count(), 0);
    assert.equal(await tools.getByRole('link', { name: 'Visit Indeed website' }).count(), 1);
    assert.equal(await tools.getByRole('combobox', { name: 'Filter accounts' }).count(), 0);
    assert.equal(await tools.locator('.home-connected-account-status').count(), 0);
    assert.equal(await tools.locator('.account-site-link').count(), 5, 'Every account, including connected accounts, has a separate website link');
    const homeYouTubeSite = tools.getByRole('link', { name: 'Open YouTube website', exact: true });
    assert.equal(await homeYouTubeSite.getAttribute('href'), 'https://www.youtube.com/');
    assert.equal(await homeYouTubeSite.getAttribute('target'), '_blank');
    assert.equal(await homeYouTubeSite.getAttribute('rel'), 'noopener noreferrer');
    assert.equal(await tools.getByRole('button', { name: 'Sign in and connect WIRED', exact: true }).isDisabled(), true,
      'The website link does not unlock an unconfigured connection');
    assert.equal(await tools.locator('.home-connected-account-row').count(), 5);
    const popupPromise = context.waitForEvent('page');
    await tools.getByRole('link', { name: 'Visit Indeed website' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.equal(popup.url(), 'https://www.indeed.com/');
    assert.equal(await popup.evaluate(() => window.opener), null);
    await popup.close();
    assert.equal(authorizationRequests, 0, 'Opening a website must not start account authorization');
    await tools.getByRole('button', { name: 'Sign in and connect YouTube', exact: true }).click();
    await tools.getByRole('alert').getByText('Test provider unavailable').waitFor();
    assert.ok(authorizationRequests >= 1, 'Connect uses OAuth, including the API retry on a temporary outage');
    await tools.getByRole('button', { name: 'Retry', exact: true }).click();
    await tools.getByRole('button', { name: 'Sign in and connect YouTube', exact: true }).waitFor();
    if (width <= 768) {
      const row = tools.locator('.home-connected-account-row').filter({ hasText: 'YouTube' });
      const rowBox = await row.boundingBox();
      const actionBox = await row.locator('.source-directory-account-actions').boundingBox();
      const nameBox = await row.locator('.home-connected-account-name').boundingBox();
      assert.ok(rowBox.height <= 80, 'Mobile account rows remain compact');
      assert.ok(nameBox.x + nameBox.width <= actionBox.x, 'Account names do not overlap actions');
      assert.ok(actionBox.x + actionBox.width <= rowBox.x + rowBox.width + 1, 'Account actions stay inside the row');
    }
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/account-directory-${width}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await auditNavigate(page, server.resolvedUrls.local[0] + 'sources');
    await page.getByRole('heading', { name: 'Feed Sources', exact: true }).waitFor();
    await page.getByRole('switch').first().waitFor();
    assert.equal(await page.getByPlaceholder(/Search sources/).count(), 0, 'Full Feed Sources page has no search bar');
    assert.equal(await page.getByRole('search', { name: 'Search UFIconnect', exact: true })
      .getByRole('searchbox', { name: 'Search UFIconnect', exact: true }).count(), 1, 'Global header search remains available');
    assert.equal(await page.getByRole('main').getByRole('searchbox').count(), 0, 'Feed Sources content has no source-specific search bar');
    assert.equal(await page.getByRole('button', { name: 'Select favorites', exact: true }).count(), 0);
    assert.ok(await page.getByRole('switch').count() > 30, 'Removing search does not hide sources');
    await page.getByText('audit-source', { exact: true }).waitFor();
    let sourceSave = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/profile'));
    await page.getByRole('switch', { name: 'Turn off GitHub', exact: true }).click();
    assert.equal((await sourceSave).status(), 200);
    await page.getByRole('switch', { name: 'Turn on GitHub', exact: true }).waitFor();
    await page.locator('[role="switch"]:disabled').first().waitFor({ state: 'detached' });
    await assertEnabledFirst(page);
    sourceSave = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/profile'));
    await page.getByRole('switch', { name: 'Turn off audit-source', exact: true }).click();
    assert.equal((await sourceSave).status(), 200);
    await page.getByRole('switch', { name: 'Turn on audit-source', exact: true }).waitFor();
    await assertEnabledFirst(page);
    await page.getByRole('button', { name: 'Enable all', exact: true }).waitFor();
    await auditReload(page);
    await page.getByRole('button', { name: 'Enable all', exact: true }).waitFor();
    await page.getByRole('switch', { name: 'Turn on GitHub', exact: true }).waitFor();
    await page.getByRole('switch', { name: 'Turn on audit-source', exact: true }).waitFor();
    assert.equal(await page.getByRole('switch').first().getAttribute('aria-checked'), 'true');
    await assertEnabledFirst(page);
    sourceSave = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().endsWith('/profile'));
    await page.getByRole('switch', { name: 'Turn on audit-source', exact: true }).click();
    assert.equal((await sourceSave).status(), 200);
    await page.getByRole('switch', { name: 'Turn off audit-source', exact: true }).waitFor();
    await page.locator('[role="switch"]:disabled').first().waitFor({ state: 'detached' });
    await assertEnabledFirst(page);
    await page.getByRole('button', { name: 'Enable all', exact: true }).click();
    await page.getByRole('button', { name: 'Enable all', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('switch', { checked: false }).count(), 0);
    await assertEnabledFirst(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/sources-page-${width}.png`) });
    await auditNavigate(page, server.resolvedUrls.local[0] + 'connected-accounts');
    assert.equal(await page.getByRole('combobox', { name: 'Filter accounts' }).count(), 0);
    assert.equal(await page.getByRole('searchbox', { name: 'Search accounts', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Sign in and connect YouTube', exact: true }).waitFor();
    const redditSite = page.getByRole('link', { name: 'Open Reddit website', exact: true });
    assert.equal(await redditSite.count(), 1, 'Connected accounts retain a single website action');
    assert.equal(await redditSite.getAttribute('href'), 'https://www.reddit.com/');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/accounts-page-${width}.png`) });
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=accounts');
    assert.equal(await page.getByRole('combobox', { name: 'Filter accounts' }).count(), 0);
    assert.equal(await page.getByRole('searchbox', { name: 'Search accounts', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Sign in and connect Instagram', exact: true }).waitFor();
    const memberAccounts = page.locator('.member-account-card');
    const youtubeAccount = memberAccounts.getByRole('button', { name: 'Sign in and connect YouTube', exact: true });
    assert.equal(await youtubeAccount.count(), 1, 'Command Center includes configured general account connections');
    assert.equal(await memberAccounts.locator('.account-site-link:visible').count(), await memberAccounts.count(),
      'Command Center shows one website link beside each account connection');
    assert.ok((await memberAccounts.evaluateAll(cards => cards.map(card => card.querySelectorAll('.account-site-link').length)))
      .every(count => count === 1), 'Account details do not duplicate website links');
    assert.equal(await youtubeAccount.isEnabled(), true, 'Configured providers remain connectable');
    assert.equal(await memberAccounts.getByRole('button', { name: 'Sign in and connect LinkedIn', exact: true }).isDisabled(), true,
      'Forced provider restrictions remain locked');
    assert.equal(await memberAccounts.getByRole('button', { name: 'Sign in and connect WIRED', exact: true }).isDisabled(), true,
      'Unconfigured providers remain locked');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/member-accounts-${width}.png`) });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    if (width === 390) {
      app.seedUser(member('business-directory', { plan: 'business' }));
      await installAuditMember(page, app, 'business-directory');
      await auditNavigate(page, server.resolvedUrls.local[0] + 'connected-accounts');
      await page.getByRole('link', { name: 'Visit Indeed website' }).waitFor();
      assert.equal(await page.getByRole('link', { name: /^Visit .* website$/ }).count(), 21, 'Business includes all career website destinations');
      assert.equal(await page.getByRole('link', { name: 'Open Reddit website' }).count(), 0);
      assert.equal(await page.getByRole('combobox', { name: 'Filter accounts' }).count(), 0);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: Source categories, favorites, status removal and unified provider actions at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
