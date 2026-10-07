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
for (const plan of ['pro', 'free', 'business']) app.seedUser(member(`directory-${plan}`, { plan }));
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5253, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
const platform = (name, extra = {}) => ({ name, configured: true, description: `${name} account`, ...extra });
const catalog = {
  github: platform('GitHub'), youtube: platform('YouTube'),
  mastodon: platform('Mastodon', { needsServer: true, reconnectRequired: true, reconnectMessage: 'Reconnect Mastodon to grant posts, likes, and replies.', siteUrl: 'https://social.example' }),
  bluesky: platform('Bluesky', { needsHandle: true, crossPost: { supported: true, media: 'link' } }),
  instagram: platform('Instagram', { commandCenterOnly: true, crossPost: { supported: true, requiresPhoto: true } }),
  twitter: platform('X / Twitter', { crossPost: { supported: true, media: 'link' } }),
  linkedin: platform('LinkedIn', { forceComingSoon: true, crossPost: { supported: false } }),
  wired: platform('WIRED', { category: 'publication', configured: false, forceComingSoon: true, crossPost: { supported: false } }),
  gitlab: platform('GitLab', { locked: true }),
};
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge' });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], oauth = [], writes = [], followingRequests = [];
    let plan = 'pro';
    const connected = { github: true, mastodon: true, instagram: true, twitter: true };
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      const endpoint = url.pathname.replace(/^\/api/, '');
      if (endpoint === '/social/platforms') return route.fulfill({ json: { platforms: { ...catalog, ...(plan === 'business' ? { indeed: platform('Indeed', { category: 'career' }) } : {}) }, connected, careerOnly: plan === 'business' } });
      if (endpoint === '/profile/social') return route.fulfill({ json: { connected } });
      if (endpoint === '/billing/status') return route.fulfill({ json: {} });
      if (endpoint.startsWith('/auth/social/') && endpoint.endsWith('/start')) {
        oauth.push({ endpoint, params: Object.fromEntries(url.searchParams) });
        return route.fulfill({ status: 400, json: { error: 'Synthetic provider response' } });
      }
      if (endpoint === '/social/connect/github' && request.method() === 'DELETE') {
        connected.github = false;
        return route.fulfill({ json: { success: true } });
      }
      if (endpoint === '/command-center/cross-post/history') return route.fulfill({ json: { posts: [{ id: 'old-queued', content: 'Earlier queued audit draft', targets: [{ platform: 'linkedin', status: 'queued' }], createdAt: new Date().toISOString() }] } });
      if (endpoint === '/command-center/cross-post' && request.method() === 'POST') {
        writes.push({ endpoint, body: request.postDataJSON() });
        return route.fulfill({ json: { id: 'audit-published', targets: [{ platform: 'twitter', status: 'posted', postedUrl: 'https://x.com/audit/status/123' }], historySaved: true } });
      }
      if (endpoint === '/groups/ufi-general/posts' && request.method() === 'POST') {
        writes.push({ endpoint, body: request.postDataJSON() });
        return route.fulfill({ json: { post: { id: 'ufi-audit-post' } } });
      }
      if (endpoint === '/command-center/history') return route.fulfill({ json: { items: [], hasMore: false } });
      if (endpoint === '/command-center/your-content/feed') return route.fulfill({ json: { posts: [], totalAvailable: 0 } });
      if (endpoint === '/command-center/your-content') return route.fulfill({ json: { posts: [{ id: 'own-audit', title: 'Own post with documentation', content: 'Read https://example.com/docs/project', sourceUrl: 'https://github.com/audit/project', createdAt: new Date().toISOString() }] } });
      if (endpoint === '/command-center/media-options') return route.fulfill({ json: { video: { shortClipSeconds: [], longFormConfigured: false } } });
      if (endpoint === '/office/feed' && new URL(page.url()).pathname === '/command-center') followingRequests.push(url.search);
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, 'directory-pro');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=accounts');
    const accounts = page.getByRole('tabpanel', { name: 'Connected Accounts', exact: true });
    await accounts.getByText('4 of 9 accounts connected', { exact: true }).waitFor();
    assert.equal(await accounts.locator('.member-account-card').count(), 9, 'Command Center includes every catalog account');
    for (const category of ['Social', 'Video & Streaming', 'Work & Development', 'Publishing']) await accounts.getByRole('heading', { name: category, exact: true }).waitFor();
    const card = name => accounts.locator('.member-account-card').filter({ has: page.getByText(name, { exact: true }) });
    assert.ok(await card('LinkedIn').getByRole('button', { name: 'Coming soon', exact: true }).isDisabled());
    assert.ok(await card('WIRED').getByRole('button', { name: 'Coming soon', exact: true }).isDisabled());
    assert.ok(await card('GitLab').getByRole('button', { name: 'Membership', exact: true }).isDisabled());
    await card('Mastodon').getByText('Reconnect needed', { exact: true }).waitFor();
    assert.equal(await card('Mastodon').getByRole('link', { name: 'Open Mastodon website' }).getAttribute('href'), 'https://social.example');
    await card('YouTube').getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByText('Synthetic provider response', { exact: true }).waitFor();
    assert.deepEqual(oauth[0], { endpoint: '/auth/social/youtube/start', params: { returnTo: 'command-center' } });
    await card('Mastodon').getByRole('button', { name: 'Reconnect Mastodon', exact: true }).click();
    await page.getByRole('dialog', { name: 'Connect Mastodon', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('returnTo'), 'command-center');
    assert.equal(oauth.length, 1, 'Mastodon waits for the server choice');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=accounts');
    await card('Bluesky').getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('dialog', { name: 'Connect Bluesky', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('returnTo'), 'command-center');
    assert.equal(oauth.length, 1, 'Bluesky waits for the handle');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=accounts');
    await accounts.getByRole('combobox', { name: 'Filter accounts' }).selectOption('connected');
    assert.equal(await accounts.locator('.member-account-card').count(), 4);
    await card('GitHub').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await accounts.getByText('3 of 9 accounts connected', { exact: true }).waitFor();
    assert.equal(await accounts.locator('.member-account-card').count(), 3);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Accounts fit the viewport');

    await page.getByRole('tab', { name: 'Cross-Post', exact: true }).click();
    const crossPost = page.getByRole('tabpanel', { name: 'Cross-Post', exact: true });
    await crossPost.getByRole('heading', { name: 'Social', exact: true }).waitFor();
    await crossPost.getByText('Earlier queued audit draft', { exact: true }).waitFor();
    assert.ok(await crossPost.getByRole('button', { name: /Instagram.*photo/ }).isDisabled(), 'Photo-required gate remains');
    await crossPost.getByRole('button', { name: 'X (Twitter)', exact: true }).click();
    await crossPost.getByRole('button', { name: 'UFIConnect', exact: true }).click();
    await crossPost.getByRole('combobox', { name: 'Publishing category' }).selectOption('video');
    assert.equal(await crossPost.getByRole('button', { name: 'X (Twitter)', exact: true }).count(), 0);
    await crossPost.getByText(/Selected \(2\):/).waitFor();
    await crossPost.getByRole('combobox', { name: 'Publishing category' }).selectOption('social');
    assert.equal(await crossPost.getByRole('button', { name: 'X (Twitter)', exact: true }).getAttribute('aria-pressed'), 'true');
    await crossPost.getByRole('textbox').fill('Categorized publishing audit');
    await crossPost.getByRole('button', { name: 'Send', exact: true }).click();
    await crossPost.getByRole('heading', { name: 'Result', exact: true }).waitFor();
    assert.deepEqual(writes.map(item => item.endpoint), ['/groups/ufi-general/posts', '/command-center/cross-post']);
    assert.deepEqual(writes[1].body.platforms, ['twitter'], 'Only selected capable external destinations are submitted');
    await crossPost.getByText('Choose the accounts to publish to.', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Cross Post fits the viewport');

    await page.getByRole('tab', { name: 'AI Content Hub', exact: true }).click();
    const content = page.getByRole('tabpanel', { name: 'AI Content Hub', exact: true });
    await content.getByRole('heading', { name: 'Draft new content', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'AI Content Hub', exact: true }).locator('svg').count(), 1);
    assert.ok(await content.getByRole('button', { name: 'Instagram', exact: true }).first().locator('svg').count());
    await page.getByRole('tab', { name: 'Media Studio', exact: true }).click();
    const media = page.getByRole('tabpanel', { name: 'Media Studio', exact: true });
    await media.getByRole('heading', { name: 'Create media', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Media Studio', exact: true }).locator('svg').count(), 1);
    assert.equal(await media.getByRole('button', { name: 'image', exact: true }).locator('svg').count(), 1);
    assert.equal(await media.getByRole('button', { name: 'video', exact: true }).locator('svg').count(), 1);
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=feed');
    await page.getByRole('tabpanel', { name: 'Automation', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: 'Following Feed', exact: true }).count(), 0);
    assert.equal(await page.getByText('Following Feed', { exact: true }).count(), 0);
    assert.deepEqual(followingRequests, [], 'Command Center no longer requests the Following feed');

    plan = 'free';
    await installAuditMember(page, app, 'directory-free');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=crosspost');
    await crossPost.getByRole('heading', { name: 'Social', exact: true }).waitFor();
    assert.ok(await crossPost.getByRole('button', { name: 'X (Twitter)', exact: true }).isDisabled(), 'Free members cannot publish externally');
    assert.ok(await crossPost.getByRole('button', { name: 'UFIConnect', exact: true }).isEnabled(), 'Native publishing remains available');
    plan = 'business';
    await installAuditMember(page, app, 'directory-business');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=accounts');
    await page.waitForURL(url => url.pathname === '/recruiting');
    assert.equal(await page.getByRole('tab', { name: 'Cross-Post', exact: true }).count(), 0, 'Business remains in the recruiting workspace');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'connected-accounts');
    await page.getByText('Indeed', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Reconnect Mastodon', exact: true }).count(), 0, 'Business stays limited to career connections');
    assert.deepEqual(errors, []);
    console.log(`PASS Command Center all accounts, categories, provider gates, federated pickers, Cross Post selection, icons, membership boundaries, and Following removal at ${width}px`);
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
  await app.close();
}
