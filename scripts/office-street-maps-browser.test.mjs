import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';
import { FOCUS_STORAGE_KEY } from '../office/src/focus-studio-model.mjs';

const root = fileURLToPath(new URL('../office/', import.meta.url));
const api = 'https://office-street-maps.invalid';
const streetHost = 'https://tile.openstreetmap.org';
const testPosition = { latitude: 37.7749, longitude: -122.4194, accuracy: 4 };
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGO8e+s4AwwwMSAB3BwAfbYChmMya/gAAAAASUVORK5CYII=', 'base64');
let server;
let browser;

before(async () => {
  server = await createServer({
    root,
    configFile: root + 'vite.config.js',
    envDir: false,
    define: { 'import.meta.env.VITE_API_URL': JSON.stringify(api), 'import.meta.env.VITE_PIPELINE_API_URL': JSON.stringify(api) },
    server: {
      host: '127.0.0.1', port: 0, strictPort: false,
      headers: { 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'geolocation=(self)' },
    },
  });
  await server.listen();
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function office(t, width) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    hasTouch: width < 500,
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const requests = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const liveTiles = { available: true };
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === streetHost) {
      requests.push({ path: url.pathname, query: url.search, headers: await request.allHeaders() });
      return route.fulfill({ status: liveTiles.available ? 200 : 503, contentType: 'image/png',
        body: tile, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (url.origin === api) {
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (url.pathname.endsWith('/stream')) return route.fulfill({ headers, contentType: 'text/event-stream', body: 'data: {}\n\n' });
      return route.fulfill({ headers, json: { server: { db: 'connected' }, workers: [], agents: {} } });
    }
    if (url.origin === new URL(server.resolvedUrls.local[0]).origin) return route.continue();
    return route.abort();
  });
  await page.addInitScript(({ center, key }) => {
    localStorage.setItem(key, JSON.stringify({ tracking: { minSeconds: 1 } }));
    let last = center;
    let nextWatch = 0;
    const watchers = new Map();
    const deliver = callback => callback({ coords: last, timestamp: Date.now() });
    Object.defineProperty(navigator, 'geolocation', { value: {
      getCurrentPosition(success) { queueMicrotask(() => deliver(success)); },
      watchPosition(success) {
        const id = ++nextWatch;
        watchers.set(id, success);
        queueMicrotask(() => deliver(success));
        return id;
      },
      clearWatch(id) { watchers.delete(id); },
    } });
    window.updateMapLocation = coords => {
      last = { ...last, ...coords };
      watchers.forEach(deliver);
    };
  }, { center: testPosition, key: FOCUS_STORAGE_KEY });
  return { page, requests, errors, liveTiles };
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
const images = page => page.locator('.focus-globe:visible .focus-street-tiles image');
const attribution = page => page.getByRole('link', { name: '© OpenStreetMap contributors', exact: true });

test('phone navigation opens both maps and preserves street and view choices', async t => {
  const { page, requests, errors } = await office(t, 390);
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' });
  await button(page, 'More tools').click();
  await page.getByRole('searchbox', { name: 'Find an Office tool' }).fill('geofencing');
  await button(page, 'Location maps').click();
  await page.getByRole('heading', { name: 'Location maps', exact: true }).waitFor();
  await page.getByText('Zoom in to see streets.', { exact: true }).waitFor();
  assert.equal(requests.length, 0);

  await button(page, 'Geofencing').click();
  await button(page, 'Use my location').click();
  await images(page).first().waitFor();
  await attribution(page).waitFor();
  await page.locator('.focus-globe:visible [data-marker="draft"] .focus-globe-boundary').waitFor();
  await button(page, 'Save zone').click();
  await page.getByText('Zone saved.', { exact: true }).waitFor();
  await button(page, 'Fit zone on globe').click();
  await images(page).first().waitFor();
  assert.equal(await button(page, '3D globe').getAttribute('aria-pressed'), 'true');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  assert.ok(requests.every(({ path, query, headers }) => /^\/\d+\/\d+\/\d+\.png$/.test(path)
    && !query && headers.referer === new URL(page.url()).origin + '/'
    && !headers.cookie && !headers['x-office-token']));
  await button(page, 'Flat map').click();
  await images(page).first().waitFor();
  await button(page, 'Streets').click();
  await attribution(page).waitFor({ state: 'hidden' });
  await page.getByRole('navigation', { name: 'Location maps' }).getByRole('button', { name: 'Geo Tracking' }).click();
  assert.equal(await button(page, 'Flat map').getAttribute('aria-pressed'), 'true');
  assert.equal(await button(page, 'Streets').getAttribute('aria-pressed'), 'false');

  await page.getByRole('navigation', { name: 'Office sections' }).locator('.office-nav-toggle').click();
  await button(page, 'Focus Studio').click();
  await button(page, 'Live Maps').click();
  assert.equal(await button(page, 'Flat map').getAttribute('aria-pressed'), 'true');
  assert.equal(await button(page, 'Streets').getAttribute('aria-pressed'), 'false');
  await button(page, 'Start live GPS').click();
  await page.getByText('GPS live', { exact: true }).waitFor();
  await button(page, 'Grid').click();
  await page.getByLabel('Grid spacing').selectOption('detail');
  await button(page, 'Streets').click();
  await images(page).first().waitFor();
  await page.locator('[data-movement-grid]').waitFor({ state: 'attached' });
  assert.deepEqual(errors, []);
});

test('desktop tracking overlays retain their geometry when the tile service fails', async t => {
  const { page, liveTiles, errors } = await office(t, 1320);
  await page.clock.install();
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'domcontentloaded' });
  await page.locator('.office-navigation').waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event('ufi-office-open-focus')));
  await page.getByRole('heading', { name: 'Location maps', exact: true }).waitFor();
  await button(page, 'Start Geo Tracking').click();
  await images(page).first().waitFor();
  await page.locator('.focus-globe[data-renderer="webgl"]:visible').waitFor();
  await attribution(page).waitFor();
  await button(page, 'Trip library').click();
  await button(page, 'Record route').click();
  await page.clock.fastForward(1100);
  await page.evaluate(() => window.updateMapLocation({ longitude: -122.4195 }));
  await page.clock.fastForward(1100);
  await page.evaluate(() => window.updateMapLocation({ longitude: -122.4198, latitude: 37.775 }));

  const route = page.locator('.focus-globe:visible .focus-globe-route');
  await route.waitFor();
  const path = await route.getAttribute('d');
  await button(page, 'Streets').click();
  await images(page).first().waitFor({ state: 'detached' });
  liveTiles.available = false;
  const failed = page.waitForResponse(response => response.url().startsWith(streetHost) && response.status() === 503);
  await button(page, 'Streets').click();
  await failed;
  assert.equal(await route.getAttribute('d'), path);
  assert.equal(await images(page).count(), 0);
  await page.locator('.focus-globe:visible .focus-globe-device').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await button(page, 'Stop Geo Tracking').click();
  await page.locator('.focus-globe:visible .focus-globe-device').waitFor({ state: 'detached' });
  assert.deepEqual(errors, []);
});
