import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await createAppHarness();
const platforms = {
  mastodon: { name: 'Mastodon', configured: true, needsServer: true, siteUrl: 'https://fosstodon.org/' },
  bluesky: { name: 'Bluesky', configured: true },
  youtube: { name: 'YouTube', configured: true, locked: true },
  twitch: { name: 'Twitch', configured: true },
  github: { name: 'GitHub', configured: true },
  medium: { name: 'Medium', configured: false },
  wired: { name: 'WIRED', category: 'publication', configured: true, forceComingSoon: true },
  instagram: { name: 'Instagram', configured: true, commandCenterOnly: true },
  indeed: { name: 'Indeed', category: 'career', configured: false },
};
const categories = ['Social', 'Video & Streaming', 'Work & Development', 'Publishing', 'Career sites'];
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5252, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge' });
  for (const width of [1440, 390, 320]) {
    const userId = `home-accounts-${width}`;
    app.seedUser(member(userId, { plan: 'pro' }));
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    const connected = { mastodon: true, github: true };
    let disconnectStarted = false;
    let completeDisconnect;
    let authorizationRequests = 0;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      if (endpoint === '/social/platforms') return route.fulfill({ json: { platforms, connected } });
      if (endpoint === '/profile/social') return route.fulfill({ json: { connected } });
      if (endpoint === '/social/connect/mastodon' && route.request().method() === 'DELETE') {
        disconnectStarted = true;
        await new Promise(resolve => { completeDisconnect = resolve; });
        connected.mastodon = false;
        return route.fulfill({ json: { success: true } });
      }
      if (endpoint.startsWith('/auth/social/')) {
        authorizationRequests += 1;
        return route.fulfill({ status: 400, json: { error: 'Audit connection response' } });
      }
      if (endpoint === '/office/feed' || endpoint === '/feed') return route.fulfill({ json: { posts: [], hasMore: false, nativeUficonnectIncluded: true } });
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, userId);
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=feed&all=1');
    if (width <= 768) await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const tools = page.locator(width <= 768 ? '#mobile-feed-drawer .home-feed-side-tools' : '.home-feed-right-tabs .home-feed-side-tools');
    await tools.getByRole('button', { name: /Connected accounts/ }).click();
    await tools.getByRole('heading', { name: 'Social', exact: true }).waitFor();
    assert.deepEqual(await tools.locator('.home-account-category h4').allTextContents(), categories);
    assert.equal(await tools.locator('.home-connected-account-row').count(), 8);
    for (const [category, providers] of [
      ['Social', ['Mastodon', 'Bluesky']], ['Video & Streaming', ['YouTube', 'Twitch']],
      ['Work & Development', ['GitHub']], ['Publishing', ['Medium', 'WIRED']],
    ]) {
      const section = tools.getByRole('region', { name: `${category} accounts`, exact: true });
      for (const provider of providers) assert.ok((await section.innerText()).includes(provider));
    }
    assert.equal(await tools.getByRole('link', { name: 'Open Instagram website' }).count(), 0);
    assert.equal(await tools.getByRole('link', { name: 'Sign in on Indeed' }).count(), 1);
    assert.equal(await tools.locator('.account-site-link, .home-connected-account-status').count(), 0);
    assert.equal(await tools.getByRole('button', { name: 'Coming soon', exact: true }).count(), 0);
    for (const provider of ['Medium', 'WIRED', 'YouTube']) {
      assert.equal(await tools.getByRole('button', { name: `Sign in and connect ${provider}`, exact: true }).isDisabled(), true);
    }
    assert.equal(authorizationRequests, 0, 'Displaying grouped accounts must not start authorization');
    assert.equal(await tools.getByRole('combobox', { name: 'Filter accounts', exact: true }).count(), 0);
    const social = tools.getByRole('region', { name: 'Social accounts', exact: true });
    assert.equal(await tools.locator('.home-account-category-heading span').count(), 0);
    const disconnectRequest = page.waitForRequest(request => request.url().endsWith('/social/connect/mastodon') && request.method() === 'DELETE');
    await social.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await disconnectRequest;
    assert.equal(disconnectStarted, true);
    assert.equal(await tools.getByRole('button', { name: 'Wait...', exact: true }).isDisabled(), true);
    assert.equal(await tools.getByRole('button', { name: 'Disconnect', exact: true }).isDisabled(), true);
    completeDisconnect();
    await social.getByRole('button', { name: 'Sign in and connect Mastodon', exact: true }).waitFor();
    assert.deepEqual(await tools.locator('.home-account-category h4').allTextContents(), categories);
    const bluesky = tools.locator('.home-connected-account-row').filter({ hasText: 'Bluesky' });
    await bluesky.getByRole('button', { name: 'Sign in and connect Bluesky', exact: true }).click();
    await tools.getByPlaceholder('name.bsky.social').waitFor();
    const handleForm = tools.locator('.home-connected-account-handle');
    assert.equal(await handleForm.getByRole('button', { name: 'Sign in & connect', exact: true }).isDisabled(), true);
    await handleForm.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    for (const row of await tools.locator('.home-connected-account-row').all()) {
      const rowBox = await row.boundingBox();
      const actionsBox = await row.locator('.source-directory-account-actions').boundingBox();
      assert.ok(actionsBox.x + actionsBox.width <= rowBox.x + rowBox.width + 1, 'Actions stay inside each account row');
    }
    const mastodon = tools.locator('.home-connected-account-row').filter({ hasText: 'Mastodon' });
    await mastodon.getByRole('button', { name: 'Sign in and connect Mastodon', exact: true }).click();
    await page.getByRole('heading', { name: 'Connect Mastodon', exact: true }).waitFor();
    assert.equal(authorizationRequests, 0, 'Mastodon server selection occurs before authorization');
    assert.deepEqual(errors, []);
    console.log(`PASS Home account categories, unified sign-in, status removal, connection gates, disconnect, Bluesky form, Mastodon routing and layout ${width}px`);
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
  await app.close();
}
