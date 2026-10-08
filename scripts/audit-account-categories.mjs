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
app.seedUser(member('account-categories', { plan: 'pro' }));
app.seedUser(member('business-account-categories', { plan: 'business' }));
const fixtures = {
  mastodon: { name: 'Mastodon', configured: true, needsServer: true },
  youtube: { name: 'YouTube', configured: true },
  github: { name: 'GitHub', configured: true },
  dribbble: { name: 'Dribbble', configured: true },
  medium: { name: 'Medium', configured: false },
  booking: { name: 'Booking.com', configured: false, category: 'travel', siteUrl: 'https://www.booking.com/' },
  spotify: { name: 'Spotify', configured: false, category: 'audio', siteUrl: 'https://open.spotify.com/' },
  reddit: { name: 'Private Reddit', configured: true, commandCenterOnly: true },
  linkedin: { name: 'LinkedIn', configured: false, commandCenterOnly: true },
  indeed: { name: 'Indeed', configured: true, category: 'career' },
};
const connected = { mastodon: true, github: true, indeed: true };
const personalSections = accountSections(Object.entries(fixtures).filter(([, platform]) => !platform.commandCenterOnly));
const commandSections = accountSections(Object.entries(fixtures));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5245, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen(); browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); const errors = []; let accountOnly = false;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      if (endpoint === '/social/platforms') return route.fulfill({ json: {
        platforms: Object.fromEntries(Object.entries(fixtures).map(([key, value]) => [key, { ...value, commandCenterOnly: accountOnly || value.commandCenterOnly }])), connected,
      } });
      if (endpoint === '/profile/social') return route.fulfill({ json: { connected } });
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, 'account-categories');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'connected-accounts');
    assert.equal(await page.getByRole('combobox', { name: /Filter accounts/ }).count(), 0, 'Account status filters are removed');
    const categoryList = page.getByRole('group', { name: 'Account categories' });
    await categoryList.getByRole('button', { name: 'Social 1', exact: true }).waitFor();
    assert.equal(await categoryList.getByRole('button', { name: /^All\b/ }).count(), 0, 'All is absent from account navigation');
    assert.equal(await categoryList.getByRole('button', { name: 'Social 1', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.locator('section.account-category-section h2').allTextContents(), ['Social']);
    assert.equal(await page.locator('.account-platform-card').count(), 1, 'Social is the initial category');
    let visited = 0;
    for (const expected of personalSections) {
      const button = categoryList.getByRole('button', { name: `${expected.label} ${expected.total}`, exact: true });
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await page.locator('section.account-category-section h2').allTextContents(), [expected.label], 'Other categories remain hidden');
      const section = page.locator('section.account-category-section');
      assert.equal(await section.locator('.account-platform-card').count(), expected.total);
      for (const [, platform] of expected.items) assert.equal(await section.getByText(platform.name, { exact: true }).count(), 1);
      assert.equal(await section.getByText(/^(Connected|Coming Soon|Membership|Reconnect needed)$/).count(), 0);
      assert.equal(await section.locator('.account-platform-card-header .account-site-link').count(), expected.total);
      visited += expected.total;
    }
    assert.equal(visited, 8, 'Every general catalog account is available exactly once across categories; member-only accounts stay in Command Center');
    await categoryList.getByRole('button', { name: 'Video & Streaming 1', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.locator('section.account-category-section h2').allTextContents(), ['Video & Streaming']);
    assert.equal(await page.locator('.account-platform-card').count(), 1);
    assert.ok((await page.locator('.account-platform-card').innerText()).includes('YouTube'));
    assert.equal(await page.getByRole('button', { name: 'Sign in and connect YouTube', exact: true }).count(), 1, 'OAuth sign-in and connection share one action');
    assert.equal(await page.locator('.account-platform-card-header').getByRole('link').count(), 1, 'OAuth cards retain exactly one adjacent provider website action');
    await categoryList.getByRole('button', { name: 'Work & Development 1', exact: true }).click();
    assert.deepEqual(await page.locator('section.account-category-section h2').allTextContents(), ['Work & Development']);
    const github = page.locator('.account-platform-card');
    await github.getByRole('button', { name: /Details/ }).click();
    await github.getByRole('button', { name: 'Disconnect GitHub', exact: true }).waitFor();
    await github.getByRole('link', { name: 'Open GitHub website', exact: true }).waitFor();
    await categoryList.getByRole('button', { name: 'News & Publishing 1', exact: true }).click();
    await page.getByRole('heading', { name: 'News & Publishing', exact: true }).waitFor();
    assert.deepEqual(await page.locator('section.account-category-section h2').allTextContents(), ['News & Publishing']);
    assert.ok(await page.getByRole('button', { name: 'Sign in and connect Medium', exact: true }).isDisabled(), 'Unavailable OAuth providers cannot start authorization');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await categoryList.locator('button').evaluateAll(buttons => buttons.every(button => {
      const box = button.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth;
    })), 'Every category button fits inside the viewport');
    accountOnly = true;
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=accounts');
    const panel = page.getByRole('tabpanel', { name: 'Connected Accounts', exact: true });
    const commandCategories = panel.getByRole('group', { name: 'Account categories' });
    await commandCategories.getByRole('button', { name: 'Social 2', exact: true }).waitFor();
    assert.equal(await commandCategories.getByRole('button', { name: /^All\b/ }).count(), 0);
    assert.equal(await commandCategories.getByRole('button', { name: 'Social 2', exact: true }).getAttribute('aria-pressed'), 'true');
    let commandVisited = 0;
    for (const expected of commandSections) {
      await commandCategories.getByRole('button', { name: `${expected.label} ${expected.total}`, exact: true }).click();
      assert.deepEqual(await panel.locator('.account-category-heading h3').allTextContents(), [expected.label]);
      assert.equal(await panel.locator('.member-account-card').count(), expected.total);
      for (const [, platform] of expected.items) assert.equal(await panel.getByText(platform.name, { exact: true }).count(), 1);
      assert.equal(await panel.locator('.member-account-card .account-site-link').count(), expected.total);
      commandVisited += expected.total;
    }
    assert.equal(commandVisited, Object.keys(fixtures).length, 'Every Command Center provider remains available across categories');
    await commandCategories.getByRole('button', { name: 'Design 1', exact: true }).click();
    assert.deepEqual(await panel.locator('.account-category-heading h3').allTextContents(), ['Design']);
    await panel.getByRole('button', { name: 'Sign in and connect Dribbble', exact: true }).waitFor();
    await panel.getByRole('link', { name: 'Open Dribbble website', exact: true }).waitFor();
    await commandCategories.getByRole('button', { name: 'News & Publishing 1', exact: true }).click();
    assert.ok(await panel.getByRole('button', { name: 'Sign in and connect Medium', exact: true }).isDisabled());
    assert.equal(await panel.getByRole('combobox', { name: /Filter accounts/ }).count(), 0);
    assert.equal(await panel.getByText(/^(Connected|Coming soon|Membership|Reconnect needed)$/).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    accountOnly = false;
    {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const categoryList = page.getByRole('group', { name: 'Account categories' });
    await installAuditMember(page, app, 'business-account-categories');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'connected-accounts');
    await page.getByRole('heading', { name: 'Business Career Connections', exact: true }).waitFor();
    await categoryList.getByRole('button', { name: /^Career sites \d+$/ }).waitFor();
    assert.equal(await categoryList.getByRole('button').count(), 1, 'Business membership exposes Career sites only');
    assert.equal(await categoryList.getByRole('button', { name: /^All\b/ }).count(), 0);
    assert.equal(await categoryList.getByRole('button', { name: /^Career sites \d+$/ }).getAttribute('aria-pressed'), 'true', 'Unavailable Social defaults to the first available business category');
    assert.deepEqual(await page.locator('section.account-category-section h2').allTextContents(), ['Career sites']);
    const careerCount = await page.locator('.account-platform-card').count();
    assert.ok(careerCount > 1);
    assert.equal(await page.getByRole('button', { name: 'Sign in and connect Indeed', exact: true }).count(), 1);
    assert.equal(await page.locator('.account-platform-card .account-site-link').count(), careerCount, 'Every career source keeps one official website action');
    await page.getByRole('button', { name: 'Sign in and connect LinkedIn', exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Sign in and connect LinkedIn', exact: true }).isDisabled(), 'Business LinkedIn appears under Careers while its unconfigured connection stays locked');
    assert.equal(await page.getByRole('combobox', { name: /Filter accounts/ }).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    assert.deepEqual(errors, []);
    console.log(`PASS account categories, unified sign-in, hidden statuses, authorization gates, management and membership boundaries ${width}`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
