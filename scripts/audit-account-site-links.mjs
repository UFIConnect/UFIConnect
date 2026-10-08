import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
import { accountSections } from '../shared/accountCategories.js';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await createAppHarness();
const platforms = {
  github: { name: 'GitHub', configured: true, authorizationSupported: true, authorizationAvailable: true },
  mastodon: { name: 'Mastodon', configured: true, authorizationSupported: true, authorizationAvailable: true, siteUrl: 'https://fosstodon.org/@member' },
  youtube: { name: 'YouTube', configured: true, authorizationSupported: true, authorizationAvailable: true, locked: true },
  medium: { name: 'Medium', configured: false, authorizationSupported: true },
  reddit: { name: 'Reddit', configured: true, authorizationSupported: false },
  airbnb: { name: 'Airbnb', category: 'travel', connectionMode: 'external', configured: true, authorizationSupported: false, siteUrl: 'https://www.airbnb.com/' },
  customsite: { name: 'Catalog Website', connectionMode: 'external', siteUrl: 'https://example.invalid/' },
};
const categories = accountSections(Object.entries(platforms));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5297, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390, 320]) {
    const userId = `site-links-${width}`;
    app.seedUser(member(userId, { plan: 'free' }));
    const context = await browser.newContext({ viewport: { width, height: 950 } }), page = await context.newPage();
    let starts = 0;
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(server.resolvedUrls.local[0]).origin) return route.abort();
      const endpoint = url.pathname.replace(/^\/api/, '');
      if (endpoint === '/social/platforms') return route.fulfill({ json: { platforms, connected: {} } });
      if (endpoint === '/profile/social') return route.fulfill({ json: { connected: {} } });
      if (endpoint.startsWith('/auth/social/')) { starts++; return route.fulfill({ status: 400, json: { error: 'Synthetic connection request.' } }); }
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, userId);
    await auditNavigate(page, server.resolvedUrls.local[0] + 'connected-accounts');
    const navigation = page.getByRole('group', { name: 'Account categories' });
    await navigation.getByRole('button', { name: /^Social \d+$/ }).waitFor();
    assert.equal(await navigation.getByRole('button', { name: /^All\b/ }).count(), 0);
    assert.deepEqual(await page.locator('.account-category-heading h2').allTextContents(), ['Social']);
    for (const [key, platform] of Object.entries(platforms)) {
      const category = categories.find(section => section.items.some(([id]) => id === key));
      await navigation.getByRole('button', { name: `${category.label} ${category.total}`, exact: true }).click();
      assert.deepEqual(await page.locator('.account-category-heading h2').allTextContents(), [category.label], 'Website checks cover each provider through its category');
      assert.equal(await page.locator('.account-platform-card').count(), category.total);
      const card = page.locator('.account-platform-card').filter({ has: page.getByText(platform.name, { exact: true }) });
      const actions = card.locator('.account-platform-card-actions');
      const connect = actions.getByRole('button', { name: `Sign in and connect ${platform.name}`, exact: true });
      const website = actions.getByRole('link', { name: `${platform.connectionMode === 'external' ? 'Visit' : 'Open'} ${platform.name} website`, exact: true });
      await website.waitFor();
      assert.equal(await connect.isEnabled(), ['github', 'mastodon'].includes(key));
      assert.equal(await website.getAttribute('target'), '_blank');
      assert.equal(await website.getAttribute('rel'), 'noopener noreferrer');
      assert.equal(await website.getAttribute('href'), key === 'mastodon' ? 'https://fosstodon.org/' : key === 'customsite' ? 'https://example.invalid/' : key === 'github' ? 'https://github.com/' : key === 'airbnb' ? platform.siteUrl : `https://${key === 'youtube' ? 'www.youtube.com' : key === 'reddit' ? 'www.reddit.com' : 'medium.com'}/`);
      const bounds = await website.boundingBox();
      assert.ok(bounds.width >= 40 && bounds.height >= 40);
      await actions.getByRole('button', { name: /Details/ }).click();
      assert.equal(await card.getByRole('link', { name: /website$/, exact: false }).count(), 1, 'Expanded cards retain one website action');
      await actions.getByRole('button', { name: /Details/ }).click();
    }
    assert.equal(starts, 0, 'Website availability never starts authorization');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS account websites: adjacent actions, HTTPS routes, one link per card, preserved readiness and layout at ${width}px`);
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
