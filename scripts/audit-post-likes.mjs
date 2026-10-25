import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
app.seedUser(member('likes-reader'));
const output = path.join(root, '.cache/audit-post-likes');
await fs.mkdir(output, { recursive: true });
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5193, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
let browser;
let currentPage;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    let liked = false;
    let failWrite = false;
    let connected = false;
    let heldWrite = null;
    const requests = [];
    let writes = 0;
    const post = {
      id: 'audit-likes', source: 'github', isExternal: true, title: 'Shared recruiting tools',
      content: 'A useful public post for checking likes.', author: { name: 'Community author', profileUrl: 'https://github.com/example' },
      sourceUrl: 'https://github.com/example/project', createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      sourceLikesCount: 47, likesScope: 'uficonnect', likesAvailable: true, commentsCount: 0,
    };
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    currentPage = page;
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const endpoint = url.pathname.replace(/^\/api/, '');
      if (endpoint === '/social/interaction-capabilities') return route.fulfill({ json: { sources: {
        github: { connected, like: true, label: 'GitHub', likeLabel: 'Star repository' },
        reddit: { connected, like: true, label: 'Reddit', likeLabel: 'Upvote' },
      } } });
      if (endpoint === '/social/interactions') {
        writes++;
        const payload = route.request().postDataJSON(); requests.push(payload);
        if (heldWrite) await heldWrite;
        if (!connected) return route.fulfill({ status: 403, json: { message: 'Connect this source.' } });
        if (failWrite) return route.fulfill({ status: 503, json: { message: 'The source did not confirm this action.' } });
        liked = payload.liked;
        await new Promise(resolve => setTimeout(resolve, 150));
        return route.fulfill({ json: { published: true, liked, source: payload.source, action: 'like' } });
      }
      if (endpoint === '/office/feed') return route.fulfill({ json: { posts: [{ ...post, likedByMe: true, likesCount: 3 }], hasMore: false } });
      if (endpoint.startsWith('/office/feed/videos')) return route.fulfill({ json: { posts: [{ ...post, source: 'reddit', sourceUrl: 'https://www.reddit.com/r/audit/comments/abcd/shared_recruiting_tools/', sourceLikesCount: 47, likedByMe: liked, likesCount: 2 + Number(liked), mediaType: 'video', mediaUrl: 'https://media.example.invalid/likes.mp4', directPlaybackAuthorized: true, videoDurationSeconds: 30 }], hasMore: false } });
      if (endpoint === '/feed/audit-likes') return route.fulfill({ json: { post: { ...post, likedByMe: liked, likesCount: 2 + Number(liked) } } });
      if (endpoint === '/feed/audit-likes/comments') return route.fulfill({ json: { comments: [], hasMore: false } });
      if (endpoint === '/feed/audit-likes/like') {
        writes++;
        if (failWrite) return route.fulfill({ status: 503, json: { message: 'Could not update your like. Please try again.' } });
        liked = route.request().postDataJSON().liked;
        await new Promise(resolve => setTimeout(resolve, 150));
        return route.fulfill({ json: { likedByMe: liked, likesCount: 2 + Number(liked), post: { id: post.id, likedByMe: liked, likesCount: 2 + Number(liked), sourceLikesCount: 47 } } });
      }
      if (endpoint === '/feed/audit-likes/likes') return route.fulfill({ json: { likesCount: 2 + Number(liked), users: [{ id: 'likes-reader', name: 'Test likes-reader', isSelf: true }] } });
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, 'likes-reader');
    await context.route('https://media.example.invalid/**', route => route.fulfill({ status: 404, body: '' }));
    await page.goto(base + 'p/audit-likes?audit-public=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const guestLike = page.getByRole('link', { name: 'Sign in to like, 47 stars', exact: true });
    await guestLike.waitFor();
    assert.equal(await guestLike.count(), 1);
    assert.equal(await guestLike.locator('.post-chrome-like-count').innerText(), '47');
    assert.match(await guestLike.getAttribute('title'), /47 stars$/, 'Compact guest count retains its full provider label');
    assert.equal(writes, 0);
    await auditNavigate(page, base + 'p/audit-likes');
    await page.goto(base + 'p/audit-likes', { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: 'Connect GitHub to like, 47 stars', exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Connect GitHub to like, 47 stars', exact: true }).getAttribute('href'), '/connected-accounts?interactions=1');
    assert.equal(await page.locator('.post-chrome-like > .post-chrome-action').count(), 1, 'One control combines the action and count');
    assert.equal(await page.locator('.post-chrome-corner').getByRole('button', { name: /Report/ }).count(), 0);
    await page.getByRole('button', { name: 'More options', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: /^Likes on GitHub/ }).getAttribute('href'), post.sourceUrl);
    assert.equal(await page.getByRole('menuitem', { name: /^Go to profile/ }).getAttribute('href'), post.author.profileUrl);
    await page.getByRole('menuitem', { name: 'Report post', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await auditReload(page);
    await page.getByRole('link', { name: 'Connect GitHub to like, 47 stars', exact: true }).waitFor();
    assert.equal(writes, 0, 'Viewing counts never writes a like');
    connected = true;
    await page.evaluate(() => window.dispatchEvent(new Event('ufi-connections-changed')));
    const star = page.getByRole('button', { name: 'Star repository on GitHub, 47 stars', exact: true });
    await star.click();
    await page.getByRole('button', { name: 'Remove star on GitHub, 47 stars', exact: true }).waitFor();
    assert.equal(writes, 1);
    assert.equal(requests[0].sourceUrl, post.sourceUrl);
    assert.equal(await page.locator('.post-chrome-like-count').innerText(), '47', 'Provider counts do not use the local reaction count');
    failWrite = true;
    await page.getByRole('button', { name: 'Remove star on GitHub, 47 stars', exact: true }).click();
    await page.getByText('The source did not confirm this action.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Remove star on GitHub, 47 stars', exact: true }).getAttribute('aria-pressed'), 'true');
    const failedRequest = requests.at(-1).requestId;
    failWrite = false;
    await page.getByRole('button', { name: 'Remove star on GitHub, 47 stars', exact: true }).click();
    await star.waitFor();
    assert.equal(requests.at(-1).requestId, failedRequest, 'An uncertain provider write reuses its request ID');
    assert.equal(liked, false);
    assert.equal(writes, 3);
    let releaseWrite;
    heldWrite = new Promise(resolve => { releaseWrite = resolve; });
    const started = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/social/interactions'));
    await star.click(); await started;
    connected = false;
    await page.evaluate(() => window.dispatchEvent(new Event('ufi-connections-changed')));
    await page.getByRole('link', { name: 'Connect GitHub to like, 47 stars', exact: true }).waitFor();
    connected = true;
    await page.evaluate(() => window.dispatchEvent(new Event('ufi-connections-changed')));
    await star.waitFor();
    const completed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/social/interactions'));
    releaseWrite(); heldWrite = null; await completed;
    await page.waitForTimeout(150);
    assert.equal(await star.getAttribute('aria-pressed'), 'false', 'An old connection response cannot mark the new connection liked');
    liked = false;
    connected = false;
    await page.evaluate(() => window.dispatchEvent(new Event('ufi-connections-changed')));
    await page.getByRole('link', { name: 'Connect GitHub to like, 47 stars', exact: true }).waitFor();
    await page.locator('.post-chrome-day').getByText('5 minutes ago', { exact: true }).waitFor();
    assert.equal(await page.locator('.post-chrome-time time').getAttribute('datetime'), post.createdAt);
    assert.match(await page.locator('.post-chrome-time').getAttribute('aria-label'), /^Posted /);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(output, `likes-${viewport.width}.png`), fullPage: true });
    await auditNavigate(page, base + '?feed=feed');
    const home = page;
    await home.getByRole('link', { name: 'Connect GitHub to like, 47 stars', exact: true }).waitFor();
    assert.equal(writes, 4, 'Home views must not submit provider writes');
    await auditNavigate(page, base + 'videos');
    const video = page.locator('[data-post-id="audit-likes"]');
    const videoLike = video.getByRole('group', { name: 'Post actions', exact: true }).getByRole('link', { name: 'Connect Reddit to like, 47 likes', exact: true });
    await videoLike.waitFor();
    assert.equal(await videoLike.getAttribute('href'), '/connected-accounts?interactions=1');
    assert.equal(await videoLike.locator('.post-chrome-like-count').innerText(), '47', 'Videos uses a compact visible count');
    assert.match(await videoLike.getAttribute('title'), /47 likes$/, 'Compact count retains its full label in the tooltip and accessible name');
    assert.equal(writes, 4);
    post.source = 'uficonnect'; post.isExternal = false; post.author.id = 'likes-reader';
    await auditNavigate(page, base + 'p/audit-likes');
    await page.getByRole('button', { name: 'Like, 2 likes', exact: true }).click();
    const nativeLike = page.getByRole('button', { name: 'Unlike, 3 likes', exact: true });
    await nativeLike.waitFor();
    assert.equal(await nativeLike.locator('.post-chrome-like-count').innerText(), '3');
    assert.match(await nativeLike.getAttribute('title'), /3 likes$/, 'Compact native count retains its full label');
    assert.equal(writes, 5, 'Native likes use the persisted UFI endpoint');
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}px: combined action/count, guest/member gates, provider like/unlike, idempotent failure retry, disconnect, Home and Videos`);
    await context.close();
  }
} catch (error) {
  if (currentPage && !currentPage.isClosed()) {
    console.error('Page:', currentPage.url(), (await currentPage.locator('body').innerText()).slice(0, 3500));
    await currentPage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  }
  throw error;
} finally {
  await browser?.close();
  await server.close();
  await app.close();
}

// Keep source menus covered wherever the existing source-like audit runs.
await import('./audit-source-post-menus.mjs');
