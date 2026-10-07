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
app.seedUser(member('link-preview-member', { plan: 'pro' }));
const original = 'https://mastodon.social/@example/123';
const article = 'https://example.com/reports/annual%20review?id=2026&utm_source=feed#findings';
const post = {
  id: 'p_link_preview_audit', source: 'uficonnect', sourceUrl: original,
  authorId: 'link-preview-member', author: { id: 'link-preview-member', name: 'Link preview member' },
  createdAt: new Date().toISOString(), likesCount: 0,
  mediaType: 'image', mediaUrl: 'https://media.example.test/post-photo.png', title: 'A research update',
  content: `Article ${article}. Again ${article}. Reference https://example.org/docs/getting-started.\nThird https://example.net/guide and fourth https://example.edu/%3Cscript%3E.\nOriginal ${original}. Truncated https://example.com/incomplete… Unsafe https://trusted.com@evil.test/. <img src=x onerror=alert(1)> #Research`,
};
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5268, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ channel: 'msedge' });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], unexpectedFetches = [];
    await context.route('https://media.example.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="#2457a7"/></svg>' }));
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:\/\/example\./.test(request.url())) unexpectedFetches.push(request.url()); });
    await context.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      if (endpoint === `/feed/${post.id}`) return route.fulfill({ json: { post } });
      if (endpoint === `/feed/${post.id}/comments`) return route.fulfill({ json: { comments: [], total: 0 } });
      if (/events|stream/.test(endpoint)) return route.abort();
      return route.continue();
    });
    await installAuditMember(page, app, 'link-preview-member');
    await auditNavigate(page, server.resolvedUrls.local[0] + `p/${post.id}`);
    await page.goto(server.resolvedUrls.local[0] + `p/${post.id}`, { waitUntil: 'domcontentloaded' });
    const previews = page.getByRole('region', { name: 'Links in this post' });
    await previews.waitFor().catch(async error => { console.log('AUDIT VIEW', page.url(), errors, (await page.locator('body').innerText()).slice(0, 1600)); throw error; });
    assert.equal(await previews.locator('a').count(), 2);
    assert.equal(await page.locator('p a[href^="https://example."]').count(), 0);
    assert.equal(await page.locator('p').filter({ hasText: 'Article' }).first().innerText().then(text => text.includes(article)), false);
    const photo = page.locator('img[src="https://media.example.test/post-photo.png"]');
    await photo.scrollIntoViewIfNeeded();
    await photo.evaluate(element => element.decode());
    const photoBox = await photo.boundingBox(), previewBox = await previews.boundingBox();
    assert.ok(previewBox.y >= photoBox.y + photoBox.height, 'Link previews appear below the post photo');
    assert.equal(await previews.locator('a').first().getAttribute('href'), article);
    assert.equal(await previews.locator('a').first().getAttribute('title'), article);
    assert.equal(await previews.locator('.post-link-preview-domain').first().innerText(), 'example.com');
    assert.equal(await previews.locator('.post-link-preview-path').first().innerText(), '/reports/annual review?id=2026#findings');
    assert.ok((await previews.locator('a').first().getAttribute('aria-label')).includes('opens in a new tab'));
    await previews.locator('a').first().focus();
    assert.ok(await previews.locator('a').first().evaluate(element => element === document.activeElement));
    const toggle = previews.getByRole('button', { name: 'Show 2 more links', exact: true });
    await toggle.click();
    assert.equal(await previews.locator('a').count(), 4);
    assert.equal(await previews.getByRole('button', { name: 'Show fewer links', exact: true }).getAttribute('aria-expanded'), 'true');
    assert.equal(await previews.locator('.post-link-preview-path').last().innerText(), '/<script>');
    assert.equal(await previews.locator('script, img').count(), 0);
    assert.equal(await previews.locator(`a[href="${original}"]`).count(), 0);
    assert.equal(await page.locator('a[href*="incomplete"], a[href*="evil.test"]').count(), 0);
    assert.equal(await page.locator('p .post-link-previews, button .post-link-previews, a .post-link-previews').count(), 0);
    await previews.getByRole('button', { name: 'Show fewer links', exact: true }).click();
    assert.equal(await previews.locator('a').count(), 2);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(unexpectedFetches, []);
    assert.deepEqual(errors, []);
    console.log(`PASS compact post link previews, exact destinations, keyboard access, safe text and no external fetch at ${width}`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
