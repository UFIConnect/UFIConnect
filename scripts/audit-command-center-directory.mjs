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
  // Synthetic capability proves the picker includes future server-supported destinations.
  github: platform('GitHub', { crossPost: { supported: true, media: 'link' } }), youtube: platform('YouTube'),
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
    const errors = [], oauth = [], writes = [], followingRequests = [], generations = [];
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
      if (endpoint === '/command-center/content-draft' && request.method() === 'POST') {
        generations.push({ endpoint, body: request.postDataJSON() });
        return route.fulfill({ json: { drafts: ['An audit draft for the selected platform.'] } });
      }
      if (endpoint === '/command-center/hashtag-draft' && request.method() === 'POST') {
        generations.push({ endpoint, body: request.postDataJSON() });
        return route.fulfill({ json: { groups: [{ label: 'Audit set', hashtags: ['#Audit'] }] } });
      }
      if (endpoint === '/command-center/your-content/feed') return route.fulfill({ json: { posts: [], totalAvailable: 0 } });
      if (endpoint === '/command-center/your-content') return route.fulfill({ json: { posts: [{ id: 'own-audit', title: 'Own post with documentation https://example.com/docs/project', content: 'Read https://example.com/docs/project', mediaType: 'image', mediaUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', sourceUrl: 'https://github.com/audit/project', createdAt: new Date().toISOString() }] } });
      if (endpoint === '/command-center/media-options') return route.fulfill({ json: { video: { shortClipSeconds: [], longFormConfigured: false } } });
      if (endpoint === '/office/feed' && new URL(page.url()).pathname === '/command-center') followingRequests.push(url.search);
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, 'directory-pro');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=accounts');
    const accounts = page.getByRole('tabpanel', { name: 'Connected Accounts', exact: true });
    await accounts.getByRole('heading', { name: 'All account connections', exact: true }).waitFor();
    assert.equal(await accounts.locator('.member-account-card').count(), 9, 'Command Center includes every catalog account');
    for (const category of ['Social', 'Video & Streaming', 'Work & Development', 'Publishing']) await accounts.getByRole('heading', { name: category, exact: true }).waitFor();
    const card = name => accounts.locator('.member-account-card').filter({ has: page.getByText(name, { exact: true }) });
    assert.equal(await accounts.getByRole('combobox', { name: 'Filter accounts' }).count(), 0);
    assert.equal(await accounts.getByText(/^(Connected|Coming soon|Membership|Reconnect needed)$/).count(), 0);
    assert.ok(await card('LinkedIn').getByRole('button', { name: 'Sign in and connect LinkedIn', exact: true }).isDisabled());
    assert.ok(await card('WIRED').getByRole('button', { name: 'Sign in and connect WIRED', exact: true }).isDisabled());
    assert.ok(await card('GitLab').getByRole('button', { name: 'Sign in and connect GitLab', exact: true }).isDisabled());
    await card('Mastodon').locator('summary').click();
    await card('Mastodon').getByText(catalog.mastodon.reconnectMessage, { exact: true }).waitFor();
    assert.equal(await card('Mastodon').getByRole('link', { name: 'Open Mastodon website' }).getAttribute('href'), 'https://social.example');
    await card('YouTube').getByRole('button', { name: 'Sign in and connect YouTube', exact: true }).click();
    await page.getByText('Synthetic provider response', { exact: true }).waitFor();
    assert.deepEqual(oauth[0], { endpoint: '/auth/social/youtube/start', params: { returnTo: 'command-center' } });
    await card('Mastodon').getByRole('button', { name: 'Sign in and connect Mastodon', exact: true }).click();
    await page.getByRole('dialog', { name: 'Connect Mastodon', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('returnTo'), 'command-center');
    assert.equal(oauth.length, 1, 'Mastodon waits for the server choice');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=accounts');
    await card('Bluesky').getByRole('button', { name: 'Sign in and connect Bluesky', exact: true }).click();
    await page.getByRole('dialog', { name: 'Connect Bluesky', exact: true }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('returnTo'), 'command-center');
    assert.equal(oauth.length, 1, 'Bluesky waits for the handle');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await auditNavigate(page, server.resolvedUrls.local[0] + 'command-center?tab=accounts');
    await card('GitHub').locator('summary').click();
    await card('GitHub').getByRole('button', { name: 'Disconnect GitHub', exact: true }).click();
    await page.getByText('Account disconnected.', { exact: true }).waitFor();
    assert.equal(await card('GitHub').getByRole('button', { name: 'Disconnect GitHub', exact: true }).count(), 0);
    assert.equal(await accounts.locator('.member-account-card').count(), 9, 'Disconnect keeps the provider available for sign-in');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Accounts fit the viewport');

    await page.getByRole('tab', { name: 'Cross-Post', exact: true }).click();
    const crossPost = page.getByRole('tabpanel', { name: 'Cross-Post', exact: true });
    await crossPost.getByRole('heading', { name: 'Social', exact: true }).waitFor();
    await crossPost.getByText('Earlier queued audit draft', { exact: true }).waitFor();
    await crossPost.getByRole('combobox', { name: 'Publishing category' }).selectOption('work');
    await crossPost.getByRole('link', { name: 'Connect GitHub', exact: true }).waitFor();
    await crossPost.getByRole('combobox', { name: 'Publishing category' }).selectOption('social');
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
    const contentPlatform = content.getByRole('combobox', { name: 'Content platform', exact: true });
    assert.equal(await contentPlatform.locator('option').count(), 23, 'All 23 content targets are available');
    for (const platform of ['uficonnect', 'bluesky', 'mastodon', 'facebook', 'reddit', 'youtube', 'pinterest', 'medium', 'wordpress', 'discord', 'figma', 'github', 'gitlab', 'twitch']) {
      assert.equal(await contentPlatform.locator(`option[value="${platform}"]`).count(), 1, `AI Content includes ${platform}`);
    }
    await contentPlatform.selectOption('mastodon');
    assert.ok(await content.locator('.cc-draft-platform-control').first().locator('svg, img').count(), 'Selected platform keeps its icon');
    await content.getByPlaceholder('e.g. Launching my new side project, a productivity app for freelancers').fill('A local meetup announcement');
    await content.getByRole('button', { name: 'Draft with AI', exact: true }).click();
    await content.getByText('An audit draft for the selected platform.', { exact: true }).waitFor();
    assert.equal(generations[0].body.platform, 'mastodon');
    await content.getByRole('combobox', { name: 'Hashtag platform', exact: true }).selectOption('bluesky');
    await content.getByRole('button', { name: 'Draft hashtags', exact: true }).click();
    await content.getByText('#Audit', { exact: true }).waitFor();
    assert.equal(generations[1].body.platform, 'bluesky');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'AI platform selects fit mobile');
    await page.getByRole('tab', { name: 'Your Feed', exact: true }).click();
    const ownPosts = page.getByRole('tabpanel', { name: 'Your Feed', exact: true });
    const ownCard = ownPosts.locator('.card').filter({ has: page.getByText('Own post with documentation', { exact: true }) });
    await ownCard.waitFor();
    assert.equal(await ownCard.locator('.command-center-content-row').innerText().then(text => text.includes('https://example.com')), false, 'Own post text omits the URL duplicated by its preview');
    const photoBox = await ownCard.locator('img').first().boundingBox();
    const previewBox = await ownCard.locator('.post-link-previews').boundingBox();
    assert.ok(previewBox.y >= photoBox.y + photoBox.height, 'Own post preview is below its photo');
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
    assert.equal(await page.getByRole('button', { name: 'Sign in and connect Mastodon', exact: true }).count(), 0, 'Business stays limited to career connections');
    assert.deepEqual(errors, []);
    console.log(`PASS Command Center all accounts, categories, provider gates, federated pickers, Cross Post selection, icons, membership boundaries, and Following removal at ${width}px`);
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
  await app.close();
}
