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
app.seedUser(member('account-categories', { plan: 'pro' }));
const fixtures = {
  mastodon: { name: 'Mastodon', configured: true, needsServer: true },
  youtube: { name: 'YouTube', configured: true },
  github: { name: 'GitHub', configured: true },
  medium: { name: 'Medium', configured: false },
};
const connected = { mastodon: true, github: true };
const categories = ['Social', 'Video & Streaming', 'Work & Development', 'Publishing'];
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5245, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen(); browser = await chromium.launch({ channel: 'msedge' });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); const errors = []; let accountOnly = false;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      if (endpoint === '/social/platforms') return route.fulfill({ json: {
        platforms: Object.fromEntries(Object.entries(fixtures).map(([key, value]) => [key, { ...value, commandCenterOnly: accountOnly }])), connected,
      } });
      if (endpoint === '/profile/social') return route.fulfill({ json: { connected } });
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, 'account-categories');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'connected-accounts');
    for (const name of categories) await page.getByRole('heading', { name, exact: true }).waitFor();
    for (const [name, provider] of [['Social', 'Mastodon'], ['Video & Streaming', 'YouTube'], ['Work & Development', 'GitHub'], ['Publishing', 'Medium']]) {
      const section = page.locator('section.account-category-section').filter({ has: page.getByRole('heading', { name, exact: true }) });
      assert.ok((await section.innerText()).includes(provider));
      assert.ok((await section.innerText()).includes(['Social', 'Work & Development'].includes(name) ? '1 of 1 connected' : '0 of 1 connected'));
    }
    const status = page.getByRole('combobox', { name: /Filter accounts/ });
    await status.selectOption('connected');
    assert.deepEqual(await page.locator('section.account-category-section h2').allTextContents(), ['Social', 'Work & Development']);
    await status.selectOption('soon');
    await page.getByRole('heading', { name: 'Publishing', exact: true }).waitFor();
    assert.deepEqual(await page.locator('section.account-category-section h2').allTextContents(), ['Publishing']);
    await status.selectOption('all');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    accountOnly = true;
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=accounts');
    const panel = page.getByRole('tabpanel', { name: 'Connected Accounts', exact: true });
    for (const name of categories) await panel.getByRole('heading', { name, exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log(`PASS account categories, provider placement, counts, status filters and Command Center ${width}`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
