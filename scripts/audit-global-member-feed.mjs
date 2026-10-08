import { installAuditMember, auditNavigate } from './audit-session.mjs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const require = createRequire(import.meta.url);
require('../backend/generated-media');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await createAppHarness();
for (const id of ['regional-alice', 'regional-bob']) app.seedUser(member(id));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5238, strictPort: false, proxy: { '/api': { target: app.base, rewrite: p => p.replace(/^\/api/, '') } } } });
const story = owner => ({ id: `${owner}-regional-story`, source: 'reddit', topic: 'Science',
  title: `${owner} regional research`, content: 'Researchers publish useful findings for their community.',
  createdAt: new Date().toISOString(), sourceUrl: `https://example.org/${owner}/science`,
  isExternal: true, author: { name: 'Research publisher' } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, isMobile: width < 600, hasTouch: width < 600 });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const errors = [], feedRequests = []; let guestRequests = 0, guestFails = true;
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      if (/events|stream/.test(endpoint)) return route.abort();
      if (endpoint === '/feed/guest') {
        guestRequests += 1;
        return route.fulfill(guestFails ? { status: 503, json: { message: 'Temporary fixture outage.' } }
          : { json: { posts: [story('guest')], hasMore: false } });
      }
      if (endpoint === '/office/feed') {
        const token = (await route.request().allHeaders()).authorization?.replace(/^Bearer /, '');
        const owner = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).id : null;
        feedRequests.push({ owner, url: route.request().url() });
        assert.ok(['regional-alice', 'regional-bob'].includes(owner), 'member request carries its own identity');
        return route.fulfill({ json: { posts: [story(owner)], hasMore: false } });
      }
      return route.continue();
    });
    await page.goto(origin + '/global', { waitUntil: 'domcontentloaded' });
    await page.getByRole('alert').filter({ hasText: 'Public posts could not load' }).waitFor();
    assert.equal(await page.getByText('No public posts are available right now. Use Refresh to try again.').count(), 0);
    guestFails = false;
    await page.getByRole('button', { name: 'Refresh feed', exact: true }).click();
    await page.getByText('guest regional research', { exact: true }).waitFor();
    assert.equal(await page.getByRole('alert').filter({ hasText: 'Public posts could not load' }).count(), 0);

    await installAuditMember(page, app, 'regional-alice');
    await auditNavigate(page, origin + '/global');
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('feed') === 'feed');
    await page.getByText('regional-alice regional research', { exact: false }).waitFor().catch(async error => {
      console.log(JSON.stringify({ feedRequests, errors, body: (await page.locator('body').innerText()).slice(-3000) })); throw error;
    });
    assert.equal(await page.getByText('guest regional research', { exact: true }).count(), 0);
    const beforeHydration = guestRequests;
    let releaseSession, sessionStarted;
    const heldSession = new Promise(resolve => { sessionStarted = resolve; });
    const gate = new Promise(resolve => { releaseSession = resolve; });
    const holdSession = async route => { sessionStarted(); await gate; await route.fallback(); };
    await page.route('**/auth/session', holdSession);
    await page.goto(origin + '/global', { waitUntil: 'domcontentloaded' });
    await heldSession;
    assert.equal(guestRequests, beforeHydration, 'restoring a session must not mount or fetch the guest feed');
    assert.equal(await page.getByText('Explore the global feed', { exact: true }).count(), 0);
    releaseSession();
    await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('feed') === 'feed');
    await page.getByText('regional-alice regional research', { exact: false }).waitFor();
    assert.equal(guestRequests, beforeHydration);
    await page.unroute('**/auth/session', holdSession);

    await installAuditMember(page, app, 'regional-bob');
    await auditNavigate(page, origin + '/global');
    await page.getByText('regional-bob regional research', { exact: false }).waitFor();
    assert.equal(await page.getByText('regional-alice regional research', { exact: false }).count(), 0);
    assert.equal(await page.getByText('guest regional research', { exact: true }).count(), 0);
    assert.equal(guestRequests, beforeHydration, 'account switching does not return to the guest feed');
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: guest error/retry, sign-in, delayed session restore, Global redirect, and separate account feeds`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }

await import('./audit-feed-location.mjs');
