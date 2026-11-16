import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const { hash } = require('bcryptjs');
const { createAppHarness } = require('./test-support/app-harness');
const email = 'returning-member@example.com';
const password = 'Synthetic browser session fixture';
const topic = 'AI & Machine Learning';
const homeSelection = { sources: ['github'], activeTabs: [], topics: [topic], timeRange: 'week' };

async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, phone TEXT DEFAULT '', auth_provider TEXT DEFAULT 'local',
    title TEXT, bio TEXT, organization TEXT, skills TEXT[], links JSONB,
    role_settings JSONB, profile_hidden BOOLEAN, avatar_url TEXT, cover_url TEXT,
    interests TEXT[], onboarding_complete BOOLEAN DEFAULT true
  ); CREATE TABLE auth_sessions (id UUID PRIMARY KEY, user_id UUID NOT NULL, expires_at TIMESTAMPTZ NOT NULL);`);
  const { rows: [account] } = await pg.query(
    'INSERT INTO users (name,email,password_hash,interests,role_settings) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    ['Returning member', email, await hash(password, 4), [topic], { homeFeedLastMode: 'groups', homeFeedView_feed: homeSelection }],
  );
  const workers = await Promise.all([0, 1].map(() => createAppHarness({
    connected: true, automaticLocation: false, env: { TRUST_PROXY: 'loopback' },
    query(sql, params) {
      if (/^SELECT (?:\*|id,phone,auth_provider) FROM users\b|^UPDATE users SET\b|\bauth_sessions\b|^(?:BEGIN|COMMIT|ROLLBACK)$/.test(sql)) {
        return pg.query(sql, params.map(value => Object.prototype.toString.call(value) === '[object Date]' ? new Date(value.getTime()) : value));
      }
      return { rows: [] };
    },
  })));
  t.after(() => Promise.all(workers.map(worker => worker.close())));
  const web = fileURLToPath(new URL('../web/', import.meta.url));
  let networkCountry = 'DE';
  const app = await createServer({ root: web, configFile: join(web, 'vite.config.js'), envDir: false,
    define: { 'import.meta.env.VITE_API_URL': '"/api"', 'import.meta.env.VITE_API_FALLBACK_URL': '""', 'import.meta.env.VITE_AUTH0_DOMAIN': '""' },
    server: { host: '127.0.0.1', port: 0, ws: false,
      proxy: { '/api': { target: workers[0].base, rewrite: path => path.slice(4), configure(proxy) {
        proxy.on('proxyReq', request => {
          request.setHeader('x-forwarded-for', '203.0.113.10, 173.245.48.20');
          request.setHeader('cf-ipcountry', networkCountry);
        });
      } } } },
  });
  t.after(() => app.close());
  await app.listen();
  const origin = new URL(app.resolvedUrls.local[0]).origin;
  const directory = await mkdtemp(join(tmpdir(), 'ufi-returning-member-'));
  const contexts = new Set();
  t.after(async () => {
    await Promise.all([...contexts].map(context => context.close()));
    await rm(directory, { recursive: true, force: true });
  });
  async function open(name, geolocation) {
    const context = await chromium.launchPersistentContext(join(directory, name), {
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      serviceWorkers: 'block', viewport: { width: 1440, height: 900 }, geolocation,
    });
    contexts.add(context);
    context.on('close', () => contexts.delete(context));
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    if (geolocation) await context.grantPermissions(['geolocation'], { origin });
    const page = context.pages()[0];
    page.setDefaultTimeout(15000);
    return { context, page };
  }
  return { pg, account, origin, open, reader: workers[1], setNetworkCountry(country) { networkCountry = country; } };
}

function responseFor(page, path, status = 200, method = 'GET') {
  return page.waitForResponse(response => new URL(response.url()).pathname === `/api${path}`
    && response.status() === status && response.request().method() === method);
}

function homeFeed(page, { device = false, status = 200 } = {}) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/office/feed' && url.searchParams.get('mode') === 'feed'
      && !url.searchParams.has('surface') && !url.searchParams.has('passive') && response.status() === status
      && (!device || Boolean(response.request().headers()['x-ufi-device-location']));
  });
}

async function signIn(page) {
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([responseFor(page, '/auth/login', 200, 'POST'), page.getByRole('button', { name: 'Sign in', exact: true }).click()]);
}

function checkHomeScope(response, { source } = {}) {
  const params = new URL(response.url()).searchParams;
  assert.equal(params.get('personalize'), '1');
  assert.equal(params.get('source'), source ?? null);
  assert.equal(params.get('sources'), null);
  assert.equal(params.get('topics'), topic);
  assert.equal(params.get('timeRange'), 'week');
}

test('cookie and account settings survive reload, browser restart, a second device and a later sign-in', { timeout: 120000 }, async t => {
  const f = await fixture(t);
  const location = { latitude: 34.052, longitude: -118.244, accuracy: 15 };
  let { context, page } = await f.open('primary', location);
  await page.goto(`${f.origin}/login`);
  const [initial] = await Promise.all([homeFeed(page, { device: true }), signIn(page)]);
  checkHomeScope(initial, { source: 'github' });
  const area = (await initial.json()).locationContext;
  assert.equal(area.source, 'device');
  assert.equal(area.country, 'US', 'device wins over the simulated German network exit');
  const clearSources = page.getByRole('button', { name: 'Clear sources', exact: true });
  const profileUrl = '**/api/profile';
  await context.route(profileUrl, route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 503 }) : route.continue());
  await Promise.all([responseFor(page, '/profile', 503, 'PATCH'), clearSources.click()]);
  const retrySaving = page.getByRole('button', { name: 'Retry saving', exact: true });
  await retrySaving.waitFor();
  const { rows: [beforeRetry] } = await f.pg.query('SELECT role_settings FROM users WHERE id=$1', [f.account.id]);
  assert.deepEqual(beforeRetry.role_settings.homeFeedView_feed, homeSelection);
  await context.unroute(profileUrl);
  const [saved] = await Promise.all([responseFor(page, '/profile', 200, 'PATCH'), retrySaving.click()]);
  assert.deepEqual((await saved.json()).roleSettings.homeFeedView_feed, { ...homeSelection, sources: [] });

  const cookie = (await context.cookies(f.origin)).find(value => value.name === 'ufi_session');
  assert.ok(cookie?.httpOnly && cookie.expires > Date.now() / 1000);
  assert.equal(cookie.sameSite, 'Lax');
  assert.equal(await page.evaluate(() => document.cookie.includes('ufi_session=')), false);
  assert.equal(await page.evaluate(value => [localStorage, sessionStorage]
    .some(storage => Object.values(storage).some(item => item.includes(value))), cookie.value), false);
  const crossWorker = await f.reader.request('/auth/session', { headers: { cookie: `${cookie.name}=${cookie.value}` } });
  assert.equal(crossWorker.status, 200);
  assert.equal(crossWorker.data.profile.id, f.account.id);
  assert.deepEqual(crossWorker.data.profile.roleSettings.homeFeedView_feed, { ...homeSelection, sources: [] });

  const [reloaded] = await Promise.all([homeFeed(page), page.reload()]);
  checkHomeScope(reloaded);
  await context.close();
  ({ context, page } = await f.open('primary', location));
  const [reopened, session] = await Promise.all([homeFeed(page, { device: true }), responseFor(page, '/auth/session'), page.goto(f.origin)]);
  checkHomeScope(reopened);
  assert.equal((await session.json()).profile.id, f.account.id);
  assert.equal(session.request().headers().authorization, undefined);

  const second = await f.open('second-device', location);
  const [guest] = await Promise.all([responseFor(second.page, '/auth/session', 401), second.page.goto(`${f.origin}/login`)]);
  assert.equal(guest.request().headers().authorization, undefined);
  const [secondFeed] = await Promise.all([homeFeed(second.page), signIn(second.page)]);
  checkHomeScope(secondFeed);

  const sessionUrl = '**/api/auth/session';
  await context.route(sessionUrl, route => route.fulfill({ status: 503 }));
  const returnTo = `${f.origin}/?feed=feed`;
  await page.goto(returnTo);
  await page.getByRole('heading', { name: 'We couldn’t restore your session' }).waitFor();
  assert.equal(page.url(), returnTo);
  await context.unroute(sessionUrl);
  const [recovered] = await Promise.all([homeFeed(page), page.getByRole('button', { name: 'Try again', exact: true }).click()]);
  checkHomeScope(recovered);

  await f.pg.query("UPDATE auth_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE user_id=$1", [f.account.id]);
  await Promise.all([responseFor(page, '/auth/session', 401), page.goto(`${f.origin}/settings`)]);
  await page.waitForURL(`${f.origin}/login`);
  await signIn(page);
  await page.waitForURL(`${f.origin}/settings`);
  const [signedBackIn] = await Promise.all([homeFeed(page), page.goto(f.origin)]);
  checkHomeScope(signedBackIn);
});

test('returning web feed uses approximate VPN fallback without starting a permission prompt', { timeout: 90000 }, async t => {
  const f = await fixture(t);
  const { context, page } = await f.open('private-permissions');
  await context.addInitScript(() => {
    window.locationRequests = 0;
    const query = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = descriptor => {
      if (descriptor.name !== 'geolocation') return query(descriptor);
      if (new URLSearchParams(location.search).has('noPermissionsApi')) return Promise.reject(new Error('Permission status unavailable'));
      return Promise.resolve(Object.assign(new EventTarget(), { state: 'prompt' }));
    };
    navigator.geolocation.getCurrentPosition = (success, failure) => {
      window.locationRequests++;
      queueMicrotask(() => {
        if (window.allowLocation) success({ coords: { latitude: 34.052, longitude: -118.244, accuracy: 15 }, timestamp: Date.now() });
        else failure({ code: 1 });
      });
    };
  });
  await page.goto(`${f.origin}/login`);
  const [initial] = await Promise.all([homeFeed(page), signIn(page)]);
  const approximate = (await initial.json()).locationContext;
  assert.equal(approximate.source, 'network');
  assert.equal(approximate.country, 'DE');
  assert.equal(approximate.approximate, true);
  const promptAttempts = [await page.evaluate(() => window.locationRequests)];

  f.setNetworkCountry('JP');
  const [afterReload] = await Promise.all([homeFeed(page), page.goto(`${f.origin}/?noPermissionsApi=1`)]);
  assert.equal((await afterReload.json()).locationContext.country, 'JP');
  checkHomeScope(afterReload, { source: 'github' });
  promptAttempts.push(await page.evaluate(() => window.locationRequests));

  f.setNetworkCountry('XX');
  await Promise.all([homeFeed(page, { status: 428 }), page.reload()]);
  await page.getByRole('heading', { name: 'Location is required for your feed' }).waitFor();
  const beforeClick = await page.evaluate(() => { window.allowLocation = true; return window.locationRequests; });
  const [afterEnable] = await Promise.all([homeFeed(page, { device: true }), page.getByRole('button', { name: 'Enable location', exact: true }).click()]);
  assert.equal((await afterEnable.json()).locationContext.source, 'device');
  assert.equal(await page.evaluate(() => window.locationRequests), beforeClick + 1);
  assert.deepEqual([...promptAttempts, beforeClick], [0, 0, 0]);
});
