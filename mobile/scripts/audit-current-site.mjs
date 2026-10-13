// Audit the actual Expo export with isolated member/API fixtures. Only local
// static files reach the network; no real accounts, provider pages, or writes.
// EXPO_EXPORT_DIR selects the completed export. CURRENT_SITE_AUDIT_DIR selects
// the JSON report and screenshots (defaults to mobile/.cache/current-site-qa).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { installAuditMember, auditNavigate } from '../../scripts/audit-session.mjs';

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(mobile);
const exportRoot = path.resolve(process.env.EXPO_EXPORT_DIR || process.env.EXPO_AUDIT_EXPORT_DIR || path.join(mobile, '.cache/export-sdk57'));
const output = path.resolve(process.env.CURRENT_SITE_AUDIT_DIR || path.join(mobile, '.cache/current-site-qa'));
const screenshotSet = process.env.CURRENT_SITE_SCREENSHOT_SET === '1';
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../../backend/test-support/app-harness');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4' };
await fs.access(path.join(exportRoot, 'index.html'));
await fs.mkdir(output, { recursive: true });
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(exportRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!filename.startsWith(exportRoot + path.sep)) throw new Error('Invalid path');
    let body;
    let extension = path.extname(filename);
    try { body = await fs.readFile(filename); }
    catch (error) {
      if (extension || !String(request.headers.accept).includes('text/html')) throw error;
      body = await fs.readFile(path.join(exportRoot, 'index.html'));
      extension = '.html';
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', mime[extension] || 'application/octet-stream');
    if (extension === '.mp4') {
      response.setHeader('Accept-Ranges', 'bytes');
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
      if (range) {
        const start = Number(range[1]), end = Math.min(body.length - 1, range[2] ? Number(range[2]) : body.length - 1);
        if (start > end || start >= body.length) { response.writeHead(416, { 'Content-Range': `bytes */${body.length}` }); response.end(); return; }
        response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1 });
        response.end(body.subarray(start, end + 1)); return;
      }
    }
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const app = await createAppHarness();
const report = { checkedAt: new Date().toISOString(), exportRoot: path.relative(root, exportRoot),
  fixturesOnly: true, realAccountActions: 0, checks: 0, results: [] };
const check = (condition, message) => { assert.ok(condition, message); report.checks++; };
const fixturePost = {
  id: 'expo-current-site-synthetic-post', authorId: 'fixture-other-member',
  author: { id: 'fixture-other-member', name: 'Community member', title: 'Designer' },
  source: 'uficonnect', isExternal: false, title: 'A new idea starts with a conversation',
  content: 'Explore communities, share your interests, and discover your next opportunity.',
  createdAt: new Date().toISOString(), likesCount: 3, commentsCount: 1, likedByMe: false,
};
const fixtureVideo = { ...fixturePost, id: 'expo-current-site-synthetic-video', title: 'Introduce yourself with confidence',
  content: 'A short introduction can start your next conversation.', mediaType: 'video', directPlaybackAuthorized: true,
  videoDurationSeconds: 158, mediaUrl: base + '/media/preparation/professional-introduction.mp4',
  thumbnailUrl: base + '/media/preparation/professional-introduction.png' };
const fixtureJobs = ['Product Designer', 'Community Program Manager', 'Frontend Engineer'].map((title, index) => ({
  id: `expo-opportunity-${index}`, type: 'job', title, org: ['Northstar Studio', 'Together Collective', 'Open Horizon'][index],
  location: 'Remote', remote: true, posted: new Date().toISOString(), source: 'UFIConnect',
  sourceUrl: `https://example.invalid/positions/${index}`, tags: ['Full-time', 'Remote'],
  description: ['Design thoughtful digital experiences with a collaborative product team.',
    'Bring people together through inclusive community programs and events.',
    'Build accessible web experiences with a team that values thoughtful craft.'][index],
}));
let browser;

async function withinViewport(page, surface) {
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), `${surface} has no horizontal overflow`);
}
async function capture(page, name, width) {
  await withinViewport(page, name);
  const filename = `${name}-${width}.png`;
  await page.screenshot({ path: path.join(output, filename), fullPage: false });
  return filename;
}
async function navigate(page, pathname) {
  await auditNavigate(page, base + pathname);
}

try {
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true }
    : { channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of screenshotSet ? [440, 1032] : [390, 820, 1440]) {
    const userId = `expo-current-site-${width}`;
    app.seedUser(member(userId, { name: 'Alex Morgan', title: 'Product Designer', plan: 'pro',
      bio: 'Connecting with people and discovering what comes next.', skills: ['Design', 'Technology'] }));
    const height = screenshotSet ? width === 440 ? 956 : 1376 : width === 390 ? 844 : 1000;
    const scale = screenshotSet ? width === 440 ? 3 : 2 : 1;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale,
      isMobile: width <= 768, hasTouch: width <= 820, serviceWorkers: 'block', reducedMotion: 'reduce' });
    const errors = [], failedAssets = [], deniedWrites = [], fixtureWrites = [], providerStarts = [], screenshots = [];
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      if (response.url().startsWith(base) && /\.(?:js|css|woff2?|ttf)(?:\?|$)/.test(response.url()) && response.status() !== 200) {
        failedAssets.push({ path: new URL(response.url()).pathname, status: response.status() });
      }
    });
    const cors = { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'Authorization, Content-Type, X-UFI-Device-Location', 'cache-control': 'no-store' };
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const isApi = url.hostname === 'api.uficonnect.org' || url.hostname.endsWith('.onrender.com')
        || url.origin === base && /^\/(?:api|fallback)\//.test(url.pathname);
      if (isApi) {
        const endpoint = url.pathname.replace(/^\/(?:api|fallback)(?=\/)/, '');
        const fulfill = options => route.fulfill({ headers: cors, ...options });
        if (request.method() === 'OPTIONS') return fulfill({ status: 204 });
        if (/^\/auth\/(?:social|providers)\/[^/]+\/(?:start|callback)$/.test(endpoint)) {
          providerStarts.push(endpoint);
          return fulfill({ status: 409, json: { error: 'Provider authorization is disabled in this audit.' } });
        }
        if (endpoint.startsWith('/analytics/') || ['/posts/engaged', '/posts/engagement-signal', '/errors/client'].includes(endpoint)
          || /^\/(?:office\/)?feed\/.*\/(?:seen|view|consume|engagement|engage)$/.test(endpoint)) return fulfill({ json: { ok: true } });
        // Current feed/group controls save preferences. Execute that request
        // only against the in-memory test harness, never a production API.
        if (endpoint === '/profile' && ['PUT', 'PATCH'].includes(request.method())) {
          fixtureWrites.push({ endpoint, method: request.method() });
          const response = await app.request(endpoint, { userId, method: request.method(), body: request.postDataJSON() });
          return fulfill({ status: response.status, json: response.data ?? {} });
        }
        if (!['GET', 'HEAD'].includes(request.method())) {
          deniedWrites.push(endpoint);
          return fulfill({ status: 409, json: { error: 'Member writes are disabled in this audit.' } });
        }
        if (/events|stream/.test(endpoint)) return route.abort();
        if (['/readyz', '/health'].includes(endpoint)) return fulfill({ json: { ok: true } });
        if (endpoint === '/auth/providers') return fulfill({ json: { providers: {
          google: { enabled: true, configured: true }, apple: { enabled: true, configured: true }, phone: { enabled: true, configured: true },
        } } });
        if (endpoint === '/office/feed' || endpoint === '/feed') return fulfill({ json: {
          posts: screenshotSet ? [fixturePost,
            { ...fixturePost, id: 'expo-community-conversation', title: 'Share what you are working on', content: 'Exchange ideas, ask questions, and find people who enjoy the same things.', author: { id: 'fixture-jordan', name: 'Jordan Lee', title: 'Community builder' } },
            { ...fixturePost, id: 'expo-community-next-chapter', title: 'A community for your next chapter', content: 'Learn something new and make connections along the way.', author: { id: 'fixture-sam', name: 'Sam Rivera', title: 'Developer' } },
          ] : [fixturePost], hasMore: false, nativeUficonnectIncluded: true, waitingForNew: true,
        } });
        if (endpoint === '/opportunities' && screenshotSet) return fulfill({ json: {
          opportunities: fixtureJobs, totalCount: fixtureJobs.length, hasMore: false, liveCount: 0, availableSources: ['UFIConnect'],
        } });
        if (/^\/office\/feed\/(?:videos|music)(?:\/following)?$/.test(endpoint)) return fulfill({ json: {
          posts: screenshotSet ? [fixtureVideo] : [], hasMore: false, waitingForNew: true,
        } });
        if (endpoint === '/feed/location') return fulfill({ json: { automaticLocationAvailable: true, countryCode: 'US' } });
        if (endpoint === '/billing/status') return fulfill({ json: {} });
        const response = await app.request(endpoint + url.search, { userId });
        return fulfill({ status: response.status, json: response.data ?? {} });
      }
      if (url.origin === base && ['GET', 'HEAD'].includes(request.method())) return route.continue();
      if (request.resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="#102a6b"/></svg>' });
      return route.abort();
    });
    await installAuditMember(page, app, userId);
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.locator('.app-welcome').waitFor();
      check(await page.getByRole('heading', { name: 'Welcome to UFIConnect', exact: true }).isVisible(), 'Expo opens the compact app welcome');
      screenshots.push(await capture(page, 'welcome', width));
      await page.getByRole('navigation', { name: 'Get started' }).getByRole('link', { name: 'Sign in', exact: true }).click();
      await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
      const password = page.locator('input[name="password"]');
      check(await password.getAttribute('type') === 'password', 'Current website login masks the password');
      check(await password.getAttribute('autocomplete') === 'current-password', 'Login retains password manager support');
      await password.fill('Synthetic privacy audit password');
      const clipboard = await password.evaluate(input => Object.fromEntries(['copy', 'cut', 'dragstart', 'paste'].map(type => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        input.dispatchEvent(event); return [type, event.defaultPrevented];
      })));
      check(clipboard.copy && clipboard.cut && clipboard.dragstart && !clipboard.paste, 'Password blocks clipboard export and dragging while allowing password-manager paste');
      await page.getByRole('button', { name: 'Show password', exact: true }).click();
      check(await password.getAttribute('type') === 'text', 'Password visibility is an explicit user choice');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      check(await password.getAttribute('type') === 'password', 'Backgrounding immediately conceals a revealed password');
      await password.fill('');
      screenshots.push(await capture(page, 'login', width));
      await page.getByRole('link', { name: 'Create one', exact: true }).click();
      await page.getByRole('heading', { name: 'Create your account', exact: true }).waitFor();
      screenshots.push(await capture(page, 'signup', width));

      await navigate(page, '/?feed=feed&all=1');
      await page.locator('.home-feed-layout').waitFor();
      await page.getByText(fixturePost.title, { exact: true }).first().waitFor();
      const navigation = width <= 768 ? page.locator('.bottom-nav') : page.getByRole('navigation', { name: 'Main navigation', exact: true });
      for (const name of width <= 768 ? ['Home', 'Videos', 'Groups', 'Jobs', 'Profile'] : ['Home', 'Videos', 'Jobs', 'Profile']) {
        const link = navigation.getByRole('link', { name, exact: true });
        check(await link.isVisible(), `${name} is visible in the current primary navigation`);
        const bounds = await link.boundingBox();
        check(bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `${name} fits the viewport`);
      }
      check(await page.getByRole('tab').filter({ hasText: /^Explore$/ }).count() === 0, 'Legacy Explore tab is absent');
      screenshots.push(await capture(page, 'home', width));
      await navigation.getByRole('link', { name: 'Videos', exact: true }).click();
      await page.waitForURL('**/videos');
      await page.locator('.video-feed-view').waitFor();
      if (screenshotSet) {
        await page.locator(`[data-post-id="${fixtureVideo.id}"]`).waitFor();
        await page.waitForFunction(() => [...document.querySelectorAll('.video-feed-view video')].some(video => video.readyState >= 2));
        await page.locator('.video-feed-view video').first().evaluate(video => { video.currentTime = 5; video.pause(); });
        await page.waitForFunction(() => [...document.querySelectorAll('.video-feed-view video')].some(video => !video.seeking && video.readyState >= 2 && video.currentTime >= 5));
      }
      screenshots.push(await capture(page, 'videos', width));
      await page.getByRole('button', { name: 'Back to Home', exact: true }).click();
      await page.locator('.home-feed-layout').waitFor();
      if (width <= 768) await navigation.getByRole('link', { name: 'Groups', exact: true }).click();
      else await navigate(page, '/?feed=groups');
      await page.getByRole('tab', { name: 'Your groups', exact: true }).waitFor();
      check(await page.getByRole('tab', { name: 'Public posts', exact: true }).isVisible(), 'Groups exposes current public/joined feed navigation');
      screenshots.push(await capture(page, 'groups', width));
      await navigation.getByRole('link', { name: 'Jobs', exact: true }).click();
      await page.locator('.jobs-page-layout').waitFor();
      if (screenshotSet) await page.locator('.jobs-page-layout').getByText(fixtureJobs[0].title, { exact: true }).first().waitFor();
      screenshots.push(await capture(page, 'jobs', width));
      await navigation.getByRole('link', { name: 'Profile', exact: true }).click();
      await page.locator('.profile-header').waitFor();
      check(await page.locator('.profile-header').getByText('Alex Morgan', { exact: true }).isVisible(), 'Profile displays the authenticated fixture member');
      screenshots.push(await capture(page, 'profile', width));

      await navigate(page, '/?feed=feed&all=1');
      await page.locator('.home-feed-layout').waitFor();
      if (width <= 768) {
        await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
        const drawer = page.locator('#mobile-account-drawer');
        await page.waitForFunction(() => document.querySelector('#mobile-account-drawer')?.getAttribute('aria-hidden') === 'false');
        check(await drawer.getByRole('link', { name: 'Map', exact: true }).isVisible(), 'Map remains accessible in the current account menu');
        check(await drawer.getByRole('button', { name: 'Log out', exact: true }).isVisible(), 'Account menu exposes sign-out');
        screenshots.push(await capture(page, 'account-menu', width));
        await drawer.getByRole('button', { name: 'Close account sidebar', exact: true }).click();
        await page.waitForFunction(() => document.body.style.overflow !== 'hidden');
        await page.getByRole('button', { name: 'Open menu', exact: true }).click();
        await page.getByRole('button', { name: 'Close feed sidebar', exact: true }).waitFor();
        screenshots.push(await capture(page, 'feed-menu', width));
        await page.getByRole('button', { name: 'Close feed sidebar', exact: true }).click();
        await page.waitForFunction(() => document.body.style.overflow !== 'hidden');
      } else check(await page.locator('.sidebar').getByRole('link', { name: 'Map', exact: true }).isVisible(), 'Map appears in the desktop sidebar');
      await navigate(page, '/maps');
      await page.getByRole('heading', { name: 'Map', exact: true }).waitFor();
      screenshots.push(await capture(page, 'map', width));
      await navigate(page, '/connected-accounts');
      await page.getByRole('heading', { name: 'Connected Accounts', exact: true }).waitFor();
      await page.getByRole('group', { name: 'Account categories', exact: true }).waitFor();
      screenshots.push(await capture(page, 'connected-accounts', width));
      const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
      check(!storage.includes('eyJ') && !storage.includes('UI audit passphrase only'), 'Local storage has no bearer credential or password');
      check(errors.length === 0, `No page exceptions: ${errors.join('; ')}`);
      check(failedAssets.length === 0, `Export loads all scripts/styles: ${JSON.stringify(failedAssets)}`);
      check(deniedWrites.length === 0, `No unexpected member write attempted: ${deniedWrites.join(', ')}`);
      check(providerStarts.length === 0, 'No provider authorization attempted');
      report.results.push({ width, height, deviceScaleFactor: scale, screenshots, pageErrors: errors, failedAssets, deniedWrites, fixtureWrites, providerStarts, passed: true });
      console.log(`PASS current website Expo parity at ${width}px: public pages, five destinations, menus, Map, accounts, private session storage`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `failure-${width}.png`), fullPage: false }).catch(() => {});
      report.results.push({ width, screenshots, pageErrors: errors, failedAssets, deniedWrites, fixtureWrites, providerStarts, passed: false, error: error.message });
      throw error;
    } finally { await context.close(); }
  }
  report.passed = true;
  console.log(`PASS ${report.checks} checks. Screenshots and report: ${output}`);
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await app.close();
}
