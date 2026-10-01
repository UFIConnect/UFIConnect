// Local browser audit. API persistence and uploads are synthetic; no posts or
// files are sent to a public service.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
app.seedUser(member('shop-audit', { name: 'Synthetic Shop Member' }));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5228, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const mediaUrl = 'https://res.cloudinary.com/ufi-audit/image/upload/shop-fixture.png';
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  const origin = server.resolvedUrls.local[0];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, isMobile: width < 600, hasTouch: width < 600 });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    const posts = [], publications = [], errors = [];
    let uploadCount = 0;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.hostname === 'api.cloudinary.com') {
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
        uploadCount++;
        return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: { secure_url: mediaUrl, resource_type: 'image' } });
      }
      if (request.url() === mediaUrl) return route.fulfill({ contentType: 'image/png', body: pixel });
      if (url.origin !== new URL(origin).origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.replace(/^\/api/, '');
      if (/events|stream/.test(endpoint)) return route.abort();
      if (endpoint === '/media/upload-signature') return route.fulfill({ json: { cloudName: 'ufi-audit', apiKey: 'synthetic', timestamp: 1, signature: 'synthetic', folder: 'posts' } });
      if (endpoint === '/social/platforms') return route.fulfill({ json: { platforms: {}, connected: {} } });
      if (endpoint === '/office/feed') return route.fulfill({ json: { posts: [], hasMore: false } });
      if (endpoint === '/posts' && request.method() === 'GET') {
        const shop = url.searchParams.get('groupIds') === 'ufi-shop';
        return route.fulfill({ json: { posts: posts.filter(post => shop ? post.groupId === 'ufi-shop' : post.groupId !== 'ufi-shop'), hasMore: false } });
      }
      const publish = endpoint.match(/^\/groups\/(ufi-shop|ufi-general)\/posts$/);
      if (publish && request.method() === 'POST') {
        const body = request.postDataJSON();
        publications.push({ groupId: publish[1], ...body });
        const post = { ...body, id: `synthetic-${width}-${posts.length}`, groupId: publish[1], source: 'uficonnect',
          authorId: 'shop-audit', author: { id: 'shop-audit', name: 'Synthetic Shop Member' },
          createdAt: new Date().toISOString(), likesCount: 0, commentsCount: 0, likedByMe: false };
        posts.unshift(post);
        return route.fulfill({ status: 201, json: { post } });
      }
      const like = endpoint.match(/^\/posts\/([^/]+)\/like$/);
      if (like && request.method() === 'POST') {
        const post = posts.find(item => item.id === like[1]);
        post.likedByMe = !post.likedByMe; post.likesCount += post.likedByMe ? 1 : -1;
        return route.fulfill({ json: { post } });
      }
      if (/^\/posts\/[^/]+\/comments$/.test(endpoint)) return route.fulfill({ json: { comments: [], hasMore: false } });
      return route.continue();
    });
    await installAuditMember(page, app, 'shop-audit');
    await auditNavigate(page, origin + '?feed=ufi&channel=shop');
    await page.getByRole('button', { name: 'Create a Shop post', exact: true }).click();
    const form = page.getByRole('form', { name: 'Create Shop post', exact: true });
    await form.getByLabel('Item title', { exact: true }).fill('City bicycle');
    await form.getByRole('combobox', { name: 'Currency', exact: true }).selectOption('EUR');
    await form.getByLabel('Description', { exact: true }).fill('Recently serviced bicycle. Collection near the city library.');
    for (const invalid of ['-5', '12.345', 'free']) {
      await form.getByLabel('Price', { exact: true }).fill(invalid);
      assert.equal(await form.getByLabel('Price', { exact: true }).evaluate(element => element.checkValidity()), false, `${invalid} is invalid`);
      await form.getByRole('button', { name: 'Publish', exact: true }).click();
      assert.equal(publications.length, 0, 'Invalid prices never reach the publishing API');
    }
    await form.getByLabel('Price', { exact: true }).fill('125.50');
    await form.locator('input[type="file"]').first().setInputFiles({ name: 'bicycle.png', mimeType: 'image/png', buffer: pixel });
    await form.getByRole('button', { name: 'Publish', exact: true }).waitFor();
    await form.getByRole('button', { name: 'Publish', exact: true }).click();
    const listing = page.locator('.post-card').filter({ has: page.getByRole('heading', { name: 'City bicycle', exact: true }) });
    await listing.waitFor();
    assert.equal(uploadCount, 1, 'The photo uses the existing upload flow');
    assert.equal(publications.length, 1);
    assert.equal(publications[0].groupId, 'ufi-shop');
    assert.equal(publications[0].content, 'Item: City bicycle\nPrice: EUR 125.50\n\nRecently serviced bicycle. Collection near the city library.');
    assert.equal(publications[0].mediaUrl, mediaUrl);
    assert.equal(publications[0].mediaType, 'image');
    assert.match(await listing.locator('.shop-post-price').innerText(), /EUR\s*125[.,]50/);
    await listing.getByText('Recently serviced bicycle. Collection near the city library.', { exact: true }).waitFor();
    assert.equal(await listing.locator('img').last().getAttribute('src'), mediaUrl);
    await listing.getByRole('button', { name: 'Like 0', exact: true }).click();
    await listing.getByRole('button', { name: 'Liked 1', exact: true }).waitFor();
    await listing.getByRole('button', { name: 'Comment 0', exact: true }).waitFor();
    await auditReload(page);
    await listing.getByRole('button', { name: 'Liked 1', exact: true }).waitFor();
    assert.match(await listing.locator('.shop-post-price').innerText(), /EUR\s*125[.,]50/, 'Price survives feed reload');
    assert.equal(await listing.getByRole('region', { name: 'Item details' }).count(), 1, 'Shop details render once');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Shop fits the viewport');
    await auditNavigate(page, origin + '?feed=ufi');
    await page.getByRole('button', { name: 'Write a post', exact: true }).click();
    const ordinary = page.getByRole('form', { name: 'Create UFI post', exact: true });
    assert.equal(await ordinary.getByLabel('Item title', { exact: true }).count(), 0, 'Ordinary composer has no Shop fields');
    await ordinary.locator('textarea').fill('An ordinary community update.');
    await ordinary.getByRole('button', { name: 'Publish', exact: true }).click();
    const plainCard = page.locator('.post-card').filter({ hasText: 'An ordinary community update.' });
    await plainCard.waitFor();
    assert.equal(await plainCard.locator('.shop-post-details').count(), 0, 'Ordinary posts keep the existing layout');
    assert.equal(publications[1].groupId, 'ufi-general');
    assert.equal(publications[1].content, 'An ordinary community update.');
    assert.deepEqual(errors, []);
    console.log(`PASS: Shop form validation, photo upload, item/price/description persistence, likes/comments, and ordinary posts at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
