import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
app.seedUser(member('comment-refresh-reader'));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  cacheDir: path.join(root, '.cache/vite-post-comment-refresh'),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5298, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
let browser;
let currentPage;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  const base = server.resolvedUrls.local[0];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); currentPage = page;
    page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const native = { id: 'native-refresh', source: 'uficonnect', isExternal: false, authorId: 'comment-refresh-reader', author: { id: 'comment-refresh-reader', name: 'Reader' },
      content: 'Native comment freshness fixture', createdAt: new Date().toISOString(), likesCount: 0, likedByMe: false, commentsCount: 0 };
    const external = { ...native, id: 'mastodon-refresh', source: 'mastodon', sourceUrl: 'https://social.example/@reader/123', isExternal: true,
      author: { id: 'source-reader', name: 'Source reader' }, content: 'Source comment freshness fixture', mediaType: 'video',
      mediaUrl: 'https://media.example.invalid/refresh.mp4', directPlaybackAuthorized: true, videoDurationSeconds: 30, sourceLikesCount: 4 };
    const threads = new Map([[native.id, []], [external.id, []]]);
    const reads = new Map();
    const unavailable = new Set();
    const held = new Map();
    const releases = new Map();
    let writeNumber = 0;
    let feedReads = 0, sourceRefreshes = 0, holdFeed = false, releaseFeed = null;
    await context.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (!pathname.startsWith('/api/')) return route.continue();
      const endpoint = pathname.replace(/^\/api/, '');
      if (endpoint === '/social/interaction-capabilities') return route.fulfill({ json: { sources: { mastodon: { connected: true, comment: true, like: true, label: 'Mastodon', maxLength: 500 } } } });
      if (endpoint === '/feed/refresh') { sourceRefreshes++; return route.fulfill({ status: 202, json: { accepted: true, status: 'queued' } }); }
      if (endpoint === '/office/feed') {
        feedReads++;
        const snapshot = JSON.parse(JSON.stringify({ posts: [native, external], nativeUficonnectIncluded: true, hasMore: false }));
        if (holdFeed) await new Promise(resolve => { releaseFeed = resolve; });
        return route.fulfill({ json: snapshot });
      }
      if (endpoint.startsWith('/office/feed/videos')) return route.fulfill({ json: { posts: [external], hasMore: false } });
      if (endpoint === '/feed/native-refresh') return route.fulfill({ json: { post: native } });
      if (endpoint === '/feed/mastodon-refresh') return route.fulfill({ json: { post: external } });
      const match = endpoint.match(/^\/feed\/(native-refresh|mastodon-refresh)\/comments$/);
      if (match) {
        const id = match[1]; reads.set(id, (reads.get(id) || 0) + 1);
        const snapshot = { comments: [...threads.get(id)], commentsCount: threads.get(id).length, hasMore: false, live: true, ...(unavailable.has(id) ? { unavailable: true } : {}) };
        if (held.has(id)) await new Promise(resolve => releases.set(id, resolve));
        return route.fulfill({ json: snapshot }).catch(() => {});
      }
      if (endpoint === '/posts/native-refresh/comments') {
        const body = route.request().postDataJSON();
        const comment = { id: `native-comment-${++writeNumber}`, author: 'Reader', body: body.content, score: 0, created: new Date().toISOString() };
        threads.get(native.id).push(comment); native.commentsCount = threads.get(native.id).length;
        return route.fulfill({ json: { comment: { id: comment.id, author: { name: 'Reader' }, content: comment.body, createdAt: comment.created }, commentsCount: native.commentsCount } });
      }
      if (endpoint === '/social/interactions') {
        const body = route.request().postDataJSON();
        const comment = { id: `source-comment-${++writeNumber}`, author: 'Source reader', body: body.content, score: 0, created: new Date().toISOString() };
        threads.get(external.id).push(comment); external.commentsCount = threads.get(external.id).length;
        return route.fulfill({ json: { published: true, commentId: comment.id } });
      }
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await context.route('https://media.example.invalid/**', route => route.fulfill({ status: 404, body: '' }));
    await installAuditMember(page, app, 'comment-refresh-reader');

    // Detail: a delayed pre-write read must not erase the new local comment.
    held.set(native.id, true);
    await auditNavigate(page, base + 'p/' + native.id);
    await page.goto(base + 'p/' + native.id, { waitUntil: 'domcontentloaded' });
    const composer = page.getByRole('textbox', { name: 'Add a comment', exact: true });
    await composer.waitFor({ timeout: 60000 });
    await page.waitForFunction(() => Boolean(document.querySelector('input[aria-label="Add a comment"]')));
    await composer.fill('Detail comment appears immediately');
    await page.getByRole('button', { name: 'Post', exact: true }).click();
    await page.getByText('Detail comment appears immediately', { exact: true }).waitFor();
    held.delete(native.id); releases.get(native.id)?.(); releases.delete(native.id);
    await page.waitForTimeout(100);
    assert.equal(await page.getByText('Detail comment appears immediately', { exact: true }).count(), 1);
    unavailable.add(native.id);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('alert').filter({ hasText: 'Comments could not be refreshed.' }).waitFor();
    assert.equal(await page.getByText('Detail comment appears immediately', { exact: true }).count(), 1, 'A failed detail refresh retains valid comments');
    unavailable.delete(native.id);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Comments could not be refreshed.' }).waitFor({ state: 'hidden' });
    const detailBeforePull = reads.get(native.id);
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.post-card').dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 })); });
    await page.waitForTimeout(300);
    assert.ok(reads.get(native.id) > detailBeforePull, 'Pulling the detail page refreshes its comment content');

    // External detail: a confirmed provider publication wakes its comments immediately.
    await auditNavigate(page, base + 'p/' + external.id);
    await page.getByLabel('Write a reply on Mastodon').fill('Reply refreshes source detail');
    await page.getByRole('button', { name: 'Reply on Mastodon' }).click();
    await page.getByText('Reply refreshes source detail', { exact: true }).waitFor();
    console.log(`PASS Detail ${width}px: stale-read protection, refresh failure retention, pull refresh and source reply publication`);

    // Home: opening, reopening and publishing replies all read fresh data.
    await auditNavigate(page, base + '?feed=feed');
    const card = page.locator('.post-card').filter({ hasText: 'Source comment freshness fixture' }).first();
    await card.waitFor();
    await card.getByRole('button', { name: /^Show Replies/ }).click();
    await card.getByText('Reply refreshes source detail', { exact: true }).waitFor();
    await card.getByLabel('Write a reply on Mastodon').fill('Reply refreshes home comments');
    await card.getByRole('button', { name: 'Reply on Mastodon' }).click();
    await card.getByText('Reply refreshes home comments', { exact: true }).waitFor();
    await card.getByRole('button', { name: 'Hide Replies', exact: true }).click();
    threads.get(external.id).push({ id: 'source-remote', author: 'Someone', body: 'A newer remote comment', created: new Date().toISOString() });
    await card.getByRole('button', { name: /^Show Replies/ }).click();
    await card.getByText('A newer remote comment', { exact: true }).waitFor();

    const beforeFeedReads = feedReads, beforeSourceRefreshes = sourceRefreshes;
    holdFeed = true; releaseFeed = null;
    await page.evaluate(() => { window.dispatchEvent(new Event('ufi:refresh-selected-feed')); window.dispatchEvent(new Event('ufi:refresh-selected-feed')); });
    for (let attempt = 0; attempt < 200 && !releaseFeed; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(typeof releaseFeed, 'function', 'The explicit feed read started');
    await page.waitForTimeout(100);
    assert.equal(feedReads, beforeFeedReads + 1, 'Duplicate refresh commands coalesce into one feed read');
    assert.equal(sourceRefreshes, beforeSourceRefreshes + 1, 'Duplicate refresh commands coalesce into one background source refresh');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('ufi-post-engagement-updated', { detail: {
      postId: 'mastodon-refresh', source: 'mastodon', sourceUrl: 'https://social.example/@reader/123', action: 'like', sourceLikesCount: 7, sourceLikedByMe: true,
    } })));
    await card.locator('.post-chrome-like-count').filter({ hasText: /^7$/ }).waitFor();
    assert.match(await card.locator('.post-chrome-like > .post-chrome-action').getAttribute('aria-label'), /7 likes/);
    const oldFeedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/office/feed');
    holdFeed = false; releaseFeed(); await oldFeedResponse;
    await page.waitForTimeout(100);
    assert.equal(await card.locator('.post-chrome-like-count').innerText(), '7', 'An older feed read cannot undo a confirmed source metric');
    external.sourceLikesCount = 9; external.sourceLikedByMe = true;
    await page.evaluate(() => window.dispatchEvent(new Event('ufi:refresh-selected-feed')));
    await card.locator('.post-chrome-like-count').filter({ hasText: /^9$/ }).waitFor();
    assert.match(await card.locator('.post-chrome-like > .post-chrome-action').getAttribute('aria-label'), /9 likes/);

    // Videos: the queue count updates with the comments sheet and failed reads retain replies.
    await auditNavigate(page, base + 'videos');
    const slide = page.locator('[data-post-id="mastodon-refresh"]'); await slide.waitFor();
    await slide.getByRole('button', { name: /^Replies/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Replies', exact: true }); await sheet.waitFor();
    await sheet.getByText('A newer remote comment', { exact: true }).waitFor();
    await sheet.getByLabel('Write a reply on Mastodon').fill('Reply refreshes video comments');
    await sheet.getByRole('button', { name: 'Reply on Mastodon' }).click();
    await sheet.getByText('Reply refreshes video comments', { exact: true }).waitFor();
    await slide.getByRole('button', { name: `Replies ${threads.get(external.id).length}`, exact: true }).waitFor();
    unavailable.add(external.id);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await sheet.getByRole('alert').waitFor();
    assert.equal(await sheet.getByText('Reply refreshes video comments', { exact: true }).count(), 1);
    assert.equal(await sheet.getByText('No comments yet.', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: Detail stale reads, error retention and pull refresh; immediate replies in Detail/Home/Videos; feed refresh coalescing, confirmed-metric protection and later fresh metrics; queue comment counts`);
    await context.close();
  }
} catch (error) {
  if (currentPage && !currentPage.isClosed()) console.error('AUDIT PAGE', currentPage.url(), (await currentPage.locator('body').innerText()).slice(-4000));
  throw error;
} finally { await browser?.close(); await server.close(); await app.close(); }
