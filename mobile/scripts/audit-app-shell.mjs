// Exercise the compiled Expo browser app with synthetic API responses. This is
// browser/layout evidence, not an iPhone device or production-account test.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(mobile);
const exportRoot = path.resolve(process.env.EXPO_EXPORT_DIR || process.env.EXPO_AUDIT_EXPORT_DIR || path.join(mobile, '.cache/export-sdk57'));
const output = path.resolve(process.env.APP_SHELL_AUDIT_DIR || path.join(root, '.cache/app-welcome-20261013/browser-qa'));
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../../backend/test-support/app-harness');
const report = { checkedAt: new Date().toISOString(), exportRoot, fixturesOnly: true, realAccountActions: 0, checks: 0, results: [] };
const check = (value, message) => { assert.ok(value, message); report.checks++; };
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
await fs.access(path.join(exportRoot, 'index.html'));
await fs.mkdir(output, { recursive: true });
async function fingerprint(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await fingerprint(filename));
    else files.push({ path: path.relative(exportRoot, filename).replaceAll('\\', '/'), sha256: createHash('sha256').update(await fs.readFile(filename)).digest('hex') });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
report.artifacts = await fingerprint(exportRoot);
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(exportRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(exportRoot + path.sep)) throw new Error('Invalid path');
    let body, extension = path.extname(filename);
    try { body = await fs.readFile(filename); }
    catch (error) {
      if (extension || !String(request.headers.accept).includes('text/html')) throw error;
      body = await fs.readFile(path.join(exportRoot, 'index.html')); extension = '.html';
    }
    response.writeHead(200, { 'content-type': mime[extension] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const app = await createAppHarness();
const posts = Array.from({ length: 12 }, (_, index) => ({
  id: `app-shell-fixture-${index}`, source: 'uficonnect', isExternal: false,
  authorId: 'fixture-creator', author: { id: 'fixture-creator', name: 'Community member', title: 'Designer' },
  title: `App viewport conversation ${index + 1}`, content: 'An isolated community post for checking app navigation and scrolling.',
  createdAt: new Date(Date.now() - index * 60000).toISOString(), likesCount: 0, commentsCount: 0,
}));
let browser;
try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }]) {
    const { width, height } = viewport;
    const userId = `app-shell-${width}`;
    app.seedUser(member(userId, { name: 'App Review Member', plan: 'pro', skills: ['Design'] }));
    const context = await browser.newContext({ viewport, isMobile: width < 600, hasTouch: width <= 820, serviceWorkers: 'block', reducedMotion: 'reduce' });
    if (width !== 390) await context.addInitScript(() => {
      localStorage.setItem('uficonnect.analytics.consent.v1', 'denied');
      localStorage.setItem('uficonnect.ads.consent.v1', 'denied');
    });
    let session = 'guest', releaseRestore;
    const restoreGate = new Promise(resolve => { releaseRestore = resolve; });
    const errors = [], failedAssets = [], deniedWrites = [], screenshots = [];
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(base) && /\.(?:js|css|woff2?|ttf)(?:\?|$)/.test(response.url()) && response.status() !== 200) failedAssets.push(response.url());
    });
    const cors = { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type, X-UFI-Device-Location', 'cache-control': 'no-store' };
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const isApi = url.hostname === 'api.uficonnect.org' || url.hostname.endsWith('.onrender.com') || url.origin === base && /^\/(?:api|fallback)\//.test(url.pathname);
      if (isApi) {
        const endpoint = url.pathname.replace(/^\/(?:api|fallback)(?=\/)/, '');
        const fulfill = options => route.fulfill({ headers: cors, ...options });
        if (request.method() === 'OPTIONS') return fulfill({ status: 204 });
        if (endpoint === '/auth/session') {
          await restoreGate;
          if (session === 'unavailable') return fulfill({ status: 503, json: { message: 'Synthetic restoration outage.' } });
          if (session !== 'member') return fulfill({ status: 401, json: { message: 'No saved fixture session.' } });
          const profile = (await app.request('/profile', { userId })).data;
          return fulfill({ json: { token: app.token(userId), profile } });
        }
        if (endpoint === '/auth/login') {
          session = 'member';
          return fulfill({ json: { token: app.token(userId), profile: (await app.request('/profile', { userId })).data } });
        }
        if (endpoint.startsWith('/analytics/') || ['/posts/engaged', '/posts/engagement-signal', '/errors/client'].includes(endpoint)) return fulfill({ json: { ok: true } });
        if (!['GET', 'HEAD'].includes(request.method())) {
          deniedWrites.push(endpoint); return fulfill({ status: 409, json: { error: 'Writes disabled in app-shell audit.' } });
        }
        if (/events|stream/.test(endpoint)) return route.abort();
        if (endpoint === '/auth/providers') return fulfill({ json: { providers: {} } });
        if (['/feed', '/office/feed', '/feed/guest'].includes(endpoint)) return fulfill({ json: { posts, hasMore: false, nativeUficonnectIncluded: true, waitingForNew: true } });
        if (/^\/office\/feed\/(?:videos|music)/.test(endpoint)) return fulfill({ json: { posts: [], hasMore: false } });
        if (endpoint === '/feed/location') return fulfill({ json: { automaticLocationAvailable: true, countryCode: 'US' } });
        if (endpoint === '/billing/status') return fulfill({ json: {} });
        const result = await app.request(endpoint + url.search, { userId });
        return fulfill({ status: result.status, json: result.data ?? {} });
      }
      if (url.origin === base && ['GET', 'HEAD'].includes(request.method())) return route.continue();
      if (request.resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>' });
      return route.abort();
    });
    async function capture(name) {
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name} fits ${width}px horizontally`);
      const filename = `${name}-${width}.png`;
      await page.screenshot({ path: path.join(output, filename) }); screenshots.push(filename);
    }
    async function checkAnchors() {
      const metrics = await page.evaluate(() => {
        const header = document.querySelector('.global-app-header').getBoundingClientRect();
        const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
        const content = document.querySelector('.shell-content').getBoundingClientRect();
        return { top: header.top, left: header.left, right: header.right, contentLeft: content.left, contentRight: content.right, bottom: nav.bottom, navHeight: nav.height, height: window.innerHeight };
      });
      check(Math.abs(metrics.top) <= 1, 'App header anchors to the top of the viewport');
      check(Math.abs(metrics.left - metrics.contentLeft) <= 1 && Math.abs(metrics.right - metrics.contentRight) <= 1, 'Header fills available app content width');
      if (width <= 768) check(Math.abs(metrics.bottom - metrics.height) <= 1 && metrics.navHeight >= 56, 'Bottom navigation anchors to the visible viewport');
    }
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.locator('.splash').waitFor();
      check(await page.locator('.app-welcome').count() === 0, 'Welcome does not flash during saved-session restoration');
      releaseRestore();
      await page.getByRole('heading', { name: 'Welcome to UFIConnect', exact: true }).waitFor();
      if (width === 390) {
        await page.getByRole('button', { name: 'Decline analytics', exact: true }).waitFor();
        check(await page.getByRole('button', { name: 'Accept analytics', exact: true }).isVisible(), 'App welcome retains the global privacy choices');
        await page.getByRole('button', { name: 'Decline analytics', exact: true }).click();
        await page.locator('.analytics-privacy-panel').waitFor({ state: 'detached' });
        check(await page.evaluate(() => localStorage.getItem('uficonnect.analytics.consent.v1') === 'denied'), 'Privacy choice remains functional on the app welcome');
      }
      check(await page.locator('.landing-shell').count() === 0, 'Expo signed-out home replaces the marketing landing');
      check(await page.locator('html').getAttribute('data-ufi-app') === 'web', 'Compiled Expo browser activates app-only layout');
      check(await page.locator('.app-welcome-logo').evaluate(img => img.complete && img.naturalWidth > 0), 'App welcome loads the existing logo');
      const welcomeMetrics = await page.locator('.app-welcome').evaluate(el => ({ height: el.getBoundingClientRect().height, viewport: window.innerHeight, scroll: document.documentElement.scrollHeight }));
      check(Math.abs(welcomeMetrics.height - welcomeMetrics.viewport) <= 1 && welcomeMetrics.scroll <= welcomeMetrics.viewport + 1, 'Compact welcome fits the entire viewport');
      check(await page.getByRole('link', { name: 'Explore the public feed', exact: true }).count() === 0, 'App welcome omits the public-feed shortcut');
      const readBackdrop = () => page.locator('.app-welcome').evaluate(el => ({
        layers: ['::before', '::after'].map(pseudo => ({ content: getComputedStyle(el, pseudo).content, animation: getComputedStyle(el, pseudo).animationName })),
        animation: getComputedStyle(el).animationName,
        background: getComputedStyle(el).backgroundColor, heading: getComputedStyle(el.querySelector('h1')).color,
      }));
      const backdrop = await readBackdrop();
      check(backdrop.animation === 'none' && backdrop.layers.every(layer => ['none', 'normal'].includes(layer.content) && layer.animation === 'none'),
        'Reduced-motion welcome has no generated decorative layers or background animation');
      check(backdrop.background === 'rgb(6, 38, 95)' && backdrop.heading === 'rgb(255, 255, 255)', 'Welcome uses the bold blue background with white heading');
      if (width === 390) {
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        const normalMotion = await readBackdrop();
        check(normalMotion.animation === 'none' && normalMotion.layers.every(layer => ['none', 'normal'].includes(layer.content) && layer.animation === 'none'),
          'Normal-motion welcome retains the clean static background without decorative layers');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const reducedAgain = await readBackdrop();
        check(reducedAgain.animation === 'none' && reducedAgain.layers.every(layer => ['none', 'normal'].includes(layer.content) && layer.animation === 'none'),
          'Changing back to reduced motion preserves the static layer-free welcome');
      }
      for (const [name, href] of [['Sign in', '/login'], ['Create account', '/register'], ['Terms', '/terms'], ['Privacy', '/privacy'], ['Safety', '/child-safety']]) {
        const link = page.getByRole('link', { name, exact: true });
        check(await link.getAttribute('href') === href, `${name} retains the real route`);
        const bounds = await link.boundingBox();
        check(bounds.height >= 44 && bounds.y >= 0 && bounds.y + bounds.height <= height + 1, `${name} is reachable with a full touch target`);
      }
      await capture('welcome');
      await page.getByRole('link', { name: 'Create account', exact: true }).click();
      await page.getByRole('heading', { name: 'Create your account', exact: true }).waitFor();
      check(await page.locator('.app-welcome').count() === 0, 'Create account opens the shared registration flow');
      await page.goto(base + '/global');
      await page.waitForURL('**/global');
      await page.getByText(posts[0].title, { exact: true }).first().waitFor();
      check(await page.locator('.app-welcome').count() === 0, 'Public feed opens without requiring a member login');
      if (width === 390) {
        session = 'unavailable'; await page.goto(base);
        await page.getByRole('heading', { name: 'We couldn’t restore your session', exact: true }).waitFor();
        check(await page.locator('.app-welcome').count() === 0, 'Temporary session failure keeps recovery instead of a signed-out welcome');
        session = 'guest'; await page.getByRole('button', { name: 'Try again', exact: true }).click();
        await page.locator('.app-welcome').waitFor();
      } else await page.goto(base);
      await page.getByRole('link', { name: 'Sign in', exact: true }).click();
      await page.locator('#login-email').fill('app-shell@example.invalid');
      await page.locator('input[name="password"]').fill('Synthetic app review password');
      check(await page.locator('input[name="password"]').getAttribute('type') === 'password', 'Existing sign-in retains password masking');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.locator('#login-email').waitFor({ state: 'detached' });
      await page.locator('.home-feed-layout').waitFor();
      await page.getByText(posts[0].title, { exact: true }).first().waitFor();
      await checkAnchors();
      await capture('member-home');
      await page.evaluate(() => window.scrollTo(0, 500));
      await page.waitForFunction(() => window.scrollY >= 400);
      await checkAnchors();
      await capture('member-scrolled');
      if (width > 768) {
        const rail = page.locator('.home-feed-right-tabs');
        if (await rail.isVisible()) {
          const a = await rail.boundingBox(), b = await page.locator('.global-app-header').boundingBox();
          check(a.y >= b.y + b.height, 'Desktop app rail remains below the anchored header');
        }
      }
      await page.reload();
      await page.locator('.home-feed-layout').waitFor();
      check(await page.locator('.app-welcome').count() === 0, 'Saved member session restores directly to the feed');
      check(errors.length === 0, `No app exceptions: ${errors.join('; ')}`);
      check(failedAssets.length === 0, 'Compiled scripts, fonts, and styles load successfully');
      check(deniedWrites.length === 0, `No unexpected account writes: ${deniedWrites.join(', ')}`);
      report.results.push({ width, height, screenshots, errors, failedAssets, deniedWrites, passed: true });
      console.log(`PASS app welcome, auth restoration, navigation anchors, and scroll at ${width}×${height}`);
    } catch (error) {
      releaseRestore();
      const layout = await page.evaluate(() => ({ scrollY: window.scrollY, viewport: { width: window.innerWidth, height: window.innerHeight },
        nodes: [...document.querySelectorAll('html, body, #root, #root > *, .shell, .shell-content, .main')].map(el => {
          const style = getComputedStyle(el), bounds = el.getBoundingClientRect();
          return { node: el.tagName, className: String(el.className), height: bounds.height, scrollHeight: el.scrollHeight, overflow: style.overflow, position: style.position };
        }) })).catch(() => null);
      await page.screenshot({ path: path.join(output, `failure-${width}.png`) }).catch(() => {});
      report.results.push({ width, height, errors, failedAssets, deniedWrites, layout, passed: false, error: error.message });
      throw error;
    } finally { await context.close(); }
  }
  check(JSON.stringify(await fingerprint(exportRoot)) === JSON.stringify(report.artifacts), 'Export bytes are unchanged throughout the audit');
  report.passed = true;
  console.log(`PASS ${report.checks} app-shell checks. Evidence: ${output}`);
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve)); await app.close();
}
