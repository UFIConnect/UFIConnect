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
const server = await createServer({ cacheDir: path.join(root, '.cache/interface-release/vite'), root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
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
    const errors = [], feedRequests = [], published = [], interactions = [], memberLikes = [];
    const likesByPost = new Map();
    let rejectNextComment = false;
    page.on('pageerror', e => errors.push(e.message));
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url()), endpoint = url.pathname.replace(/^\/api/, '');
      if (/events|stream/.test(endpoint)) return route.abort();
      if (endpoint === '/office/feed') {
        feedRequests.push(url.searchParams);
        const mode = url.searchParams.get('mode');
        const selectedSources = (url.searchParams.get('sources') || url.searchParams.get('source') || '').split(',').filter(Boolean);
        const posts = mode === 'groups' ? [sample('joined-good', 'uficonnect', { groupId: 'group-a', group: { id: 'group-a', name: 'Design circle' }, fromJoinedGroup: true }), sample('wrong-native', 'uficonnect', { groupId: 'unjoined' }), sample('wrong-connected', 'reddit', { groupId: 'group-a', isExternal: true })]
          : mode === 'bars' ? [sample('bar-story', 'bars', { topic: 'Wine & Spirits' })] : [sample('reddit-story', 'reddit', { likesCount: 31 }), sample('hn-story', 'hackernews', { isExternal: true, groupId: 'ext_hn', group: { id: 'ext_hn', name: 'Hacker News' }, fromJoinedGroup: true })];
        if (mode === 'feed' && !selectedSources.length) posts.push(sample('unfiltered-only', 'devto', { sourceUrl: 'https://dev.to/example/an-unfiltered-story' }));
        return route.fulfill({ json: { posts, mode, hasMore: false, nativeUficonnectIncluded: true } });
      }
      if (endpoint === '/groups/internal') return route.fulfill({ json: { groups: [{ id: 'ufi-general', name: 'General' }, { id: 'group-a', name: 'Design circle', isJoined: true }, { id: 'group-b', name: 'Builders club', isJoined: true }, { id: 'not-joined', name: 'Another group' }] } });
      if (/^\/groups\/[^/]+\/posts$/.test(endpoint) && route.request().method() === 'POST') { published.push({ endpoint, body: route.request().postDataJSON() }); return route.fulfill({ status: 201, json: { post: { id: 'created' } } }); }
      if (endpoint === '/saved/posts') return route.fulfill({ json: { posts: [sample('saved-story', 'reddit')], postIds: ['saved-story'], hasMore: false, total: 1 } });
      if (endpoint === '/jobs/tracking') return route.fulfill({ json: { jobs: [{ id: 'saved-job', title: 'Community engineer', org: 'Example Company', status: 'saved' }] } });
      if (endpoint === '/social/interaction-capabilities') return route.fulfill({ json: { sources: { reddit: { connected: true, like: true, comment: true, label: 'Reddit', likeLabel: 'Upvote', maxLength: 1000 } } } });
      if (endpoint === '/social/interactions' && route.request().method() === 'POST') {
        const body = route.request().postDataJSON(); interactions.push(body);
        if (body.action === 'comment' && rejectNextComment) {
          rejectNextComment = false;
          return route.fulfill({ status: 503, json: { message: 'Synthetic source timeout. Check the original before retrying.' } });
        }
        return route.fulfill({ json: { published: true, liked: body.liked, commentId: 'remote-comment', ...(body.action === 'comment' ? { commentsCount: 1 } : {}) } });
      }
      if (/^\/feed\/[^/]+\/comments$/.test(endpoint)) return route.fulfill({ json: { comments: [], live: true, hasMore: false } });
      if (endpoint === '/feed/likes') return route.fulfill({ json: { likes: Object.fromEntries((url.searchParams.get('ids') || '').split(',').filter(Boolean).map(id => {
        const likedByMe = likesByPost.get(id) || false;
        return [id, { count: Number(likedByMe), likesCount: Number(likedByMe), likedByMe, likesScope: 'uficonnect', likesAvailable: true }];
      })) } });
      const like = endpoint.match(/^\/feed\/([^/]+)\/like$/);
      if (like && route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        assert.equal(typeof body.liked, 'boolean', 'Like writes specify the desired state');
        memberLikes.push({ endpoint, ...body }); likesByPost.set(like[1], body.liked);
        const state = { likedByMe: body.liked, likesCount: Number(body.liked) };
        return route.fulfill({ json: { ...state, post: { id: like[1], ...state, likesScope: 'uficonnect', likesAvailable: true, sourceLikesCount: like[1] === 'reddit-story' ? 31 : 0 } } });
      }
      const likers = endpoint.match(/^\/feed\/([^/]+)\/likes$/);
      if (likers) return route.fulfill({ json: { likesCount: Number(likesByPost.get(likers[1]) || false), users: likesByPost.get(likers[1])
        ? [{ id: 'interface-member', name: 'Alex Member', isSelf: true }] : [] } });
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
    assert.ok(dimensions.width >= dimensions.height && dimensions.height >= 40, 'Labeled source buttons have a usable touch target'); assert.equal(dimensions.radius, '10px');
    const menu = await page.getByRole('button', { name: 'View all feed sources', exact: true }).evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight, radius: getComputedStyle(el).borderRadius }));
    assert.equal(menu.width, menu.height); assert.equal(menu.radius, '50%');
    const toolbarSizes = await page.locator('.feed-unified-control-bar').evaluate(bar =>
      ['.feed-source-option.compact', '.feed-source-menu-button', '.home-shop-button', '.feed-topic-filter-trigger'].map(selector => {
        const rect = bar.querySelector(selector).getBoundingClientRect();
        return { height: rect.height, center: rect.top + rect.height / 2 };
      }));
    assert.ok(toolbarSizes[0].height >= 40 && toolbarSizes[1].height === 34, 'Shared source buttons and the compact menu retain their touch targets');
    assert.ok(toolbarSizes.every(size => Math.abs(size.center - toolbarSizes[0].center) < 1),
      'Compact source icons stay centered with Shop and Topics');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'saved/posts');
    await page.getByRole('heading', { name: 'Saved', exact: true }).waitFor();
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=feed'); await sources.waitFor();
    assert.equal(await sources.getByRole('button', { name: 'Reddit', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await sources.getByRole('button', { name: 'Hacker News', exact: true }).getAttribute('aria-pressed'), 'true');
    // UFIconnect reactions persist independently of reported source metrics.
    const redditCard = page.locator('.post-card').filter({ has: page.getByRole('link', { name: 'Open on Reddit', exact: true }) }).first();
    const hnCard = page.locator('.post-card').filter({ has: page.getByText('Story hn-story', { exact: false }) }).first();
    await hnCard.getByText('Following source', { exact: true }).waitFor();
    assert.equal(await hnCard.getByText('Following source', { exact: true }).getAttribute('title'), 'Following this source in UFIconnect.');
    assert.equal(await hnCard.locator('.post-chrome-chips').getByText('Hacker News', { exact: true }).count(), 1, 'Keep the actual source name beside its local following status');
    assert.equal(await hnCard.getByText('Joined', { exact: true }).count(), 0, 'A local source association does not claim membership at Hacker News');
    assert.equal(await redditCard.getByText(/^(Following source|Joined)$/).count(), 0, 'Unjoined sources have no relationship badge');
    assert.equal(await page.getByText('your group', { exact: true }).count(), 0);
    await redditCard.getByRole('button', { name: 'Upvote on Reddit, 31 points', exact: true }).waitFor();
    assert.equal(await redditCard.locator('.post-chrome-like > .post-chrome-action').count(), 1, 'One source control combines upvote and count');
    assert.equal(await redditCard.getByRole('button', { name: 'Upvote on Reddit, 31 points', exact: true }).locator('.post-chrome-like-count').innerText(), '31');
    assert.match(await redditCard.getByRole('button', { name: 'Upvote on Reddit, 31 points', exact: true }).getAttribute('title'), /31 points$/, 'Compact counts preserve their source meaning in the tooltip and accessible name');
    assert.deepEqual(interactions, [], 'Viewing a source count does not submit a provider action');
    assert.deepEqual(memberLikes, [], 'Viewing source counts never changes a reaction');
    await auditReload(page);
    await redditCard.getByRole('button', { name: 'Upvote on Reddit, 31 points', exact: true }).waitFor();
    assert.equal(await redditCard.getByRole('button', { name: 'Comment on Reddit', exact: true }).count(), 0, 'No duplicate source comment action appears below the post');
    const commentAction = redditCard.locator('.post-chrome-actions').getByRole('button', { name: 'Show Comments', exact: true });
    const redditComment = redditCard.getByRole('textbox', { name: 'Write a comment on Reddit', exact: true });
    assert.equal(await commentAction.count(), 1, 'One comments action is in the normal post action row');
    assert.equal(await redditComment.isVisible(), false, 'Composer follows the comments section visibility');
    await commentAction.click();
    await redditComment.fill('Thank you for the useful update.');
    rejectNextComment = true;
    await redditCard.getByRole('button', { name: 'Comment on Reddit', exact: true }).click();
    await redditCard.getByRole('alert').getByText('Synthetic source timeout.', { exact: false }).waitFor();
    await redditCard.getByRole('button', { name: 'Hide Comments', exact: true }).click();
    await commentAction.click();
    assert.equal(await redditComment.inputValue(), 'Thank you for the useful update.', 'Closing comments retains an unconfirmed draft');
    await redditCard.getByRole('button', { name: 'Comment on Reddit', exact: true }).click();
    await page.getByText('Comment published on Reddit.', { exact: true }).waitFor();
    assert.equal(await redditComment.inputValue(), '', 'A confirmed source comment clears its draft');
    await redditCard.getByText('Thank you for the useful update.', { exact: true }).waitFor();
    assert.equal(await redditCard.getByRole('button', { name: 'Hide Comments', exact: true }).innerText(), '1', 'The comment count updates immediately without a reload');
    assert.deepEqual(interactions.map(item => item.action), ['comment', 'comment']);
    assert.ok(interactions.every(item => item.source === 'reddit' && item.sourceUrl === 'https://www.reddit.com/r/test/comments/abc123/story'), 'Both requests target the original Reddit post');
    assert.ok(interactions.every(item => typeof item.requestId === 'string' && item.requestId.length > 0), 'Each action includes its duplicate-protection request ID');
    assert.equal(interactions[0].requestId, interactions[1].requestId, 'Retry after closing/reopening reuses the original duplicate-protection ID');
    assert.equal(interactions[0].content, 'Thank you for the useful update.');
    assert.equal(memberLikes.length, 0, 'Source comment actions do not change local likes');
    assert.equal(await redditCard.locator('.post-chrome-like-count').innerText(), '31');
    assert.equal(await redditCard.locator('.post-chrome-source-count').count(), 0, 'The source count appears once');
    await hnCard.locator('.post-chrome-actions').getByRole('button', { name: 'Show Comments', exact: true }).click();
    assert.equal(await hnCard.locator('.connected-post-actions textarea').count(), 0, 'An unsupported source never displays an API publishing form');
    const originalComments = hnCard.getByRole('link', { name: /View all comments on Hacker News/ });
    assert.equal(await originalComments.getAttribute('href'), 'https://news.ycombinator.com/item?id=123', 'Unsupported sources preserve the original-post comment link');
    assert.equal(await originalComments.getAttribute('target'), '_blank');
    // The persistence check reloads the page; restore this filter test's
    // selection when a new session starts with the unfiltered feed.
    for (const name of ['Reddit', 'Hacker News']) {
      const button = sources.getByRole('button', { name, exact: true });
      if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
    }
    assert.equal(await clearSources.isEnabled(), true);
    await page.getByRole('button', { name: 'View all feed sources', exact: true }).click();
    const sourceMenu = page.getByRole('group', { name: 'Feed sources and favorites', exact: true });
    assert.equal(await sourceMenu.locator('.feed-source-option').count(), await sources.locator('.feed-source-option').count(), 'the menu exposes the complete source rail');
    assert.equal(await sourceMenu.getByRole('button', { name: 'All sources', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'View all feed sources', exact: true }).click();
    await sourceMenu.waitFor({ state: 'hidden' });
    await clearSources.click();
    await page.getByText('Story unfiltered-only', { exact: true }).waitFor();
    assert.ok(feedRequests.some(params => params.get('mode') === 'feed' && !params.has('source') && !params.has('sources')), 'Unfiltered results came from an unfiltered API request, including a cached response');
    assert.equal(await clearSources.isDisabled(), true, 'Clearing restores the unfiltered source feed');
    assert.equal(await sources.getByRole('button', { name: 'Reddit', exact: true }).getAttribute('aria-pressed'), 'false');
    assert.equal(await sources.getByRole('button', { name: 'Hacker News', exact: true }).getAttribute('aria-pressed'), 'false');
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/interface-sources-${width}.png`) });
    await auditNavigate(page, server.resolvedUrls.local[0] + '?feed=groups');
    await page.getByText('Story joined-good', { exact: true }).waitFor();
    const joinedCard = page.locator('.post-card').filter({ has: page.getByText('Story joined-good', { exact: true }) });
    assert.equal(await joinedCard.getByText('Joined', { exact: true }).getAttribute('title'), 'You joined this UFIconnect group.');
    assert.equal(await joinedCard.locator('.post-chrome-chips').getByText('Design circle', { exact: true }).count(), 1);
    assert.equal(await joinedCard.getByText('Following source', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Story wrong-native', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Story wrong-connected', { exact: true }).count(), 0);
    await auditNavigate(page, server.resolvedUrls.local[0] + 'groups/post');
    const selector = page.getByLabel('Select a group to post to', { exact: true }); await selector.waitFor();
    assert.equal(await selector.locator('option').count(), 3);
    await selector.selectOption('group-b');
    await page.getByLabel('Your post', { exact: true }).fill('An update for the builders.');
    await page.getByRole('button', { name: 'Publish to 1 ready destination', exact: true }).click();
    await page.getByText('Posted to Builders club.', { exact: false }).waitFor();
    assert.equal(published[0].endpoint, '/groups/group-b/posts');
    await auditNavigate(page, server.resolvedUrls.local[0] + 'saved/posts');
    await page.getByRole('heading', { name: 'Saved', exact: true }).waitFor();
    await page.getByText('Story saved-story', { exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Saved pages' }).getByRole('link', { name: 'Jobs', exact: true }).click();
    await page.getByText('Community engineer', { exact: true }).waitFor();
    await auditNavigate(page, server.resolvedUrls.local[0] + 'profile?tab=more');
    await page.getByRole('heading', { name: 'More is locked', exact: true }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'Profile sections' }).getByRole('button', { name: 'More · Locked', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.profile-more-options').count(), 0, 'a direct More URL cannot open its options');
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
    console.log(`PASS: circles, multi-source navigation, persisted local likes and separate source counts, source comments, source/group relationship labels, group isolation/composer, saved pages, public About and Bars topics at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
