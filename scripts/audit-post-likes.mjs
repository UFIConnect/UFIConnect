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
    let failList = false;
    let writes = 0;
    const post = {
      id: 'audit-likes', source: 'github', isExternal: true, title: 'Shared recruiting tools',
      content: 'A useful public post for checking likes.', author: { name: 'Community author' },
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
      if (endpoint.startsWith('/office/feed/videos')) return route.fulfill({ json: { posts: [{ ...post, source: 'reddit', sourceLikesCount: 47, likedByMe: liked, likesCount: 2 + Number(liked), mediaType: 'video', mediaUrl: 'https://media.example.invalid/likes.mp4', directPlaybackAuthorized: true, videoDurationSeconds: 30 }], hasMore: false } });
      if (endpoint === '/feed/audit-likes') return route.fulfill({ json: { post: { ...post, likedByMe: liked, likesCount: 2 + Number(liked) } } });
      if (endpoint === '/feed/audit-likes/comments') return route.fulfill({ json: { comments: [], hasMore: false } });
      if (endpoint === '/feed/audit-likes/like') {
        writes++;
        if (failWrite) return route.fulfill({ status: 503, json: { message: 'Could not update your like. Please try again.' } });
        liked = route.request().postDataJSON().liked;
        await new Promise(resolve => setTimeout(resolve, 150));
        return route.fulfill({ json: { likedByMe: liked, likesCount: 2 + Number(liked), post: { id: post.id, likedByMe: liked, likesCount: 2 + Number(liked), sourceLikesCount: 47 } } });
      }
      if (endpoint === '/feed/audit-likes/likes') return failList
        ? route.fulfill({ status: 400, json: { message: 'Unavailable' } })
        : route.fulfill({ json: { likesCount: 2 + Number(liked), users: [{ id: 'likes-reader', name: 'Test likes-reader', isSelf: true }] } });
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, 'likes-reader');
    await context.route('https://media.example.invalid/**', route => route.fulfill({ status: 404, body: '' }));
    await page.goto(base + 'p/audit-likes?audit-public=1');
    await page.getByLabel('47 stars', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Sign in to like', exact: true }).count(), 0);
    assert.equal(writes, 0);
    await auditNavigate(page, base + 'p/audit-likes');
    await page.goto(base + 'p/audit-likes');
    await page.getByLabel('47 stars', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^(Like|Unlike)$/ }).count(), 0);
    await auditReload(page);
    await page.getByLabel('47 stars', { exact: true }).waitFor();
    assert.equal(writes, 0, 'Viewing counts never writes a like');
    await page.locator('.post-chrome-day').getByText('5 minutes ago', { exact: true }).waitFor();
    assert.equal(await page.locator('.post-chrome-time time').getAttribute('datetime'), post.createdAt);
    assert.match(await page.locator('.post-chrome-time').getAttribute('aria-label'), /^Posted /);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(output, `likes-${viewport.width}.png`), fullPage: true });
    await auditNavigate(page, base + 'videos');
    const video = page.locator('[data-post-id="audit-likes"]');
    await video.getByLabel('47 likes', { exact: true }).waitFor();
    assert.equal(await video.getByRole('button', { name: /^(Like|Unlike)$/ }).count(), 0);
    assert.equal(writes, 0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}px: guest and member source counts, no like buttons or writes, readable time`);
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
