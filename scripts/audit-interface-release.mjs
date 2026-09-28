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
const app = await createAppHarness();
app.seedUser(member('interface-member', { name: 'Alex Member', joinedGroups: ['group-a', 'group-b'], bio: 'Building useful communities.', preferences: { role: 'Engineer / Developer', interests: ['Open Source'], goals: ['Learn new skills'] } }));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') }, server: { host: '127.0.0.1', port: 5216, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } } });
let browser;
const sample = (id, source, extra = {}) => ({ id, source, title: `Story ${id}`, content: 'A useful community update with details to discuss.', createdAt: new Date().toISOString(), sourceUrl: source === 'reddit' ? 'https://www.reddit.com/r/test/comments/abc123/story' : 'https://news.ycombinator.com/item?id=123', author: { id: 'other', name: 'Jordan Member' }, ...extra });
try {
  await server.listen();
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 768, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width < 600, hasTouch: width <= 768 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], feedRequests = [], published = [], interactions = [];
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url()), endpoint = url.pathname.replace(/^\/api/, '');
      if (/events|stream/.test(endpoint)) return route.abort();
      if (endpoint === '/office/feed') {
        feedRequests.push(url.searchParams);
        const mode = url.searchParams.get('mode');
        const posts = mode === 'groups' ? [sample('joined-good', 'uficonnect', { groupId: 'group-a' }), sample('wrong-native', 'uficonnect', { groupId: 'unjoined' }), sample('wrong-connected', 'reddit', { groupId: 'group-a', isExternal: true })]
          : mode === 'bars' ? [sample('bar-story', 'bars', { topic: 'Wine & Spirits' })] : [sample('reddit-story', 'reddit'), sample('hn-story', 'hackernews')];
        return route.fulfill({ json: { posts, mode, hasMore: false, nativeUficonnectIncluded: true } });
      }
      if (endpoint === '/groups/internal') return route.fulfill({ json: { groups: [{ id: 'ufi-general', name: 'General' }, { id: 'group-a', name: 'Design circle', isJoined: true }, { id: 'group-b', name: 'Builders club', isJoined: true }, { id: 'not-joined', name: 'Another group' }] } });
      if (/^\/groups\/[^/]+\/posts$/.test(endpoint) && route.request().method() === 'POST') { published.push({ endpoint, body: route.request().postDataJSON() }); return route.fulfill({ status: 201, json: { post: { id: 'created' } } }); }
      if (endpoint === '/saved/posts') return route.fulfill({ json: { posts: [sample('saved-story', 'reddit')], postIds: ['saved-story'], hasMore: false, total: 1 } });
      if (endpoint === '/jobs/tracking') return route.fulfill({ json: { jobs: [{ id: 'saved-job', title: 'Community engineer', org: 'Example Company', status: 'saved' }] } });
      if (endpoint === '/social/interaction-capabilities') return route.fulfill({ json: { sources: { reddit: { connected: true, label: 'Reddit', likeLabel: 'Upvote', maxLength: 1000 } } } });
      if (endpoint === '/social/interactions') { const body = route.request().postDataJSON(); interactions.push(body); return route.fulfill({ json: { published: true, liked: body.liked, commentId: 'remote-comment' } }); }
      if (endpoint === '/users/public-member') return route.fulfill({ json: { id: 'public-member', name: 'Jordan', bio: 'Building useful communities.', interests: ['Open Source'], goals: ['Learn new skills'], skills: [], followersCount: 0, followingCount: 0 } });
      if (endpoint === '/users/public-member/posts') return route.fulfill({ json: { posts: [], hasMore: false } });
      return route.continue();
    });
    await installAuditMember(page, app, 'interface-member');
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=feed');
    const sources = page.getByRole('group', { name: 'Home sources', exact: true }); await sources.waitFor();
    assert.equal(await sources.getByRole('button', { name: 'All sources', exact: true }).count(), 0);
    const clearSources = sources.getByRole('button', { name: 'Clear sources', exact: true });
    assert.equal(await clearSources.isDisabled(), true, 'Clear is inactive before any source is selected');
    await sources.getByRole('button', { name: 'Reddit', exact: true }).click();
    await sources.getByRole('button', { name: 'Hacker News', exact: true }).click();
    await page.waitForTimeout(150);
    assert.equal(await sources.getByRole('button', { name: 'Reddit', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await sources.getByRole('button', { name: 'Hacker News', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await clearSources.isEnabled(), true, 'Clear becomes available for a source selection');
    assert.ok(feedRequests.some(params => params.get('sources')?.split(',').includes('reddit') && params.get('sources')?.split(',').includes('hackernews')));
    const dimensions = await sources.getByRole('button', { name: 'Reddit', exact: true }).evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight, radius: getComputedStyle(el).borderRadius }));
    assert.equal(dimensions.width, dimensions.height); assert.equal(dimensions.radius, '50%');
    const menu = await page.getByRole('button', { name: 'View all feed sources', exact: true }).evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight, radius: getComputedStyle(el).borderRadius }));
    assert.equal(menu.width, menu.height); assert.equal(menu.radius, '50%');
    const toolbarSizes = await page.locator('.feed-unified-control-bar').evaluate(bar =>
      ['.feed-source-option.compact', '.feed-source-menu-button', '.home-shop-button', '.feed-topic-filter-trigger'].map(selector => {
        const rect = bar.querySelector(selector).getBoundingClientRect();
        return { height: rect.height, center: rect.top + rect.height / 2 };
      }));
    assert.ok(toolbarSizes.slice(0, 2).every(size => size.height === 34), 'Source icons and menu use compact 34px circles');
    assert.ok(toolbarSizes.every(size => Math.abs(size.center - toolbarSizes[0].center) < 1),
      'Compact source icons stay centered with Shop and Topics');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'saved/posts');
    await page.getByRole('heading', { name: 'Saved', exact: true }).waitFor();
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=feed'); await sources.waitFor();
    assert.equal(await sources.getByRole('button', { name: 'Reddit', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await sources.getByRole('button', { name: 'Hacker News', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Upvote on Reddit', exact: true }).click();
    await page.getByRole('button', { name: 'Remove upvote on Reddit', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Comment on Reddit', exact: true }).click();
    await page.getByLabel('Publish a comment on Reddit', { exact: true }).fill('Thank you for the useful update.');
    await page.getByRole('button', { name: 'Publish on Reddit', exact: true }).click();
    await page.getByText('Comment published on Reddit.', { exact: true }).waitFor();
    assert.deepEqual(interactions.map(item => item.action), ['like', 'comment']);
    assert.equal(interactions[1].content, 'Thank you for the useful update.');
    await page.getByRole('button', { name: 'View all feed sources', exact: true }).click();
    const sourceMenu = page.getByRole('group', { name: 'Feed sources and favorites', exact: true });
    assert.equal(await sourceMenu.locator('.feed-source-option').count(), await sources.locator('.feed-source-option').count(), 'the menu exposes the complete source rail');
    assert.equal(await sourceMenu.getByRole('button', { name: 'All sources', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'View all feed sources', exact: true }).click();
    await sourceMenu.waitFor({ state: 'hidden' });
    await Promise.all([
      page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/office/feed') && url.searchParams.get('mode') === 'feed'
          && !url.searchParams.has('source') && !url.searchParams.has('sources');
      }),
      clearSources.click(),
    ]);
    assert.equal(await clearSources.isDisabled(), true, 'Clearing restores the unfiltered source feed');
    assert.equal(await sources.getByRole('button', { name: 'Reddit', exact: true }).getAttribute('aria-pressed'), 'false');
    assert.equal(await sources.getByRole('button', { name: 'Hacker News', exact: true }).getAttribute('aria-pressed'), 'false');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/interface-sources-${width}.png`) });
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=groups');
    await page.getByText('Story joined-good', { exact: true }).waitFor();
    assert.equal(await page.getByText('Story wrong-native', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Story wrong-connected', { exact: true }).count(), 0);
    await auditNavigate(page, server.resolvedUrls.local[0] + 'groups/post');
    const selector = page.getByLabel('Select a group to post to', { exact: true }); await selector.waitFor();
    assert.equal(await selector.locator('option').count(), 3);
    await selector.selectOption('group-b');
    await page.getByLabel('Your post', { exact: true }).fill('An update for the builders.');
    await page.getByRole('button', { name: 'Post to group', exact: true }).click();
    await page.getByText('Posted to Builders club.', { exact: false }).waitFor();
    assert.equal(published[0].endpoint, '/groups/group-b/posts');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'saved/posts');
    await page.getByRole('heading', { name: 'Saved', exact: true }).waitFor();
    await page.getByText('Story saved-story', { exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Saved pages' }).getByRole('link', { name: 'Jobs', exact: true }).click();
    await page.getByText('Community engineer', { exact: true }).waitFor();
    await auditNavigate(page, server.resolvedUrls.local[0] + 'profile?tab=more');
    await page.getByRole('link', { name: /Settings and privacy/ }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'Saved', exact: true }).count(), 0);
    await auditNavigate(page, server.resolvedUrls.local[0] + 'u/public-member');
    await page.getByRole('navigation', { name: 'Public profile sections' }).getByRole('button', { name: 'About', exact: true }).click();
    await page.getByText('Building useful communities.', { exact: true }).waitFor();
    await page.getByText('Open Source', { exact: true }).waitFor(); await page.getByText('Learn new skills', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/interface-profile-${width}.png`) });
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=bars');
    await page.getByText('Story bar-story', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Filter feed by topic', exact: true }).click();
    await page.getByRole('button', { name: 'Wine & Spirits', exact: true }).click();
    await page.getByRole('button', { name: 'Apply topics', exact: true }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    assert.deepEqual(errors, []);
    console.log(`PASS: circles, multi-source navigation, native source actions, group isolation/composer, saved pages, public About and Bars topics at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
