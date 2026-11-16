import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';
import { MAX_FIX_AGE_MS } from '../office/src/focus-geofence.mjs';
import { FOCUS_STORAGE_KEY } from '../office/src/focus-studio-model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = '/__focus-studio-test';
const fixture = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body { margin: 12px; background: #111220; font: 15px system-ui; }</style>
<div id="root"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import FocusStudio from '/src/FocusStudio.jsx';
createRoot(document.getElementById('root')).render(React.createElement(FocusStudio, { active: true }));
</script>`;

const point = (longitude, accuracy = 2) => ({ latitude: 0, longitude, accuracy });
const home = { id: 'home', name: 'Home', center: point(0, 0), radius: 250, enabled: true };
const work = { id: 'work', name: 'Work', center: point(0.02, 0), radius: 250, enabled: true };
const outside = point(0.01);
const dwell = 2000;
const clockStart = new Date('2026-11-13T16:00:00Z');

let server;
let browser;
let origin;
before(async () => {
  server = await createServer({
    root: path.join(root, 'office'),
    configFile: path.join(root, 'office/vite.config.js'),
    envDir: false,
    cacheDir: path.join(root, '.cache/vite-focus-geofence-test'),
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'focus-studio-test',
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          const url = new URL(request.url, 'http://localhost');
          if (url.pathname !== fixturePath) return next();
          const allowlist = url.searchParams.has('blocked') ? '()' : '(self)';
          response.setHeader('Content-Type', 'text/html');
          response.setHeader('Permissions-Policy', `geolocation=${allowlist}`);
          response.end(await vite.transformIndexHtml(fixturePath, fixture));
        });
      },
    }],
  });
  await server.listen();
  origin = new URL(server.resolvedUrls.local[0]).origin;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function openStudio(t, { settings = {}, mock = true, blocked = false, width = 1200 } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    ...(mock ? {} : { permissions: ['geolocation'], geolocation: point(0) }),
  });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.addInitScript(({ key, settings, mock }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(settings));
    if (!mock) return;
    let nextWatch = 0;
    let activeWatch;
    let probe;
    let hidden = false;
    const watchers = new Map();
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(update, fail) {
        activeWatch = ++nextWatch;
        watchers.set(activeWatch, { update, fail });
        return activeWatch;
      },
      clearWatch(id) { if (id === activeWatch) activeWatch = undefined; },
      getCurrentPosition(update, fail) { probe = { update, fail }; },
    } });
    window.focusTest = {
      fix({ coords, timestamp = Date.now(), watch = activeWatch, fromProbe }) {
        const callbacks = fromProbe ? probe : watchers.get(watch);
        if (fromProbe) probe = undefined;
        callbacks.update({ coords, timestamp });
      },
      fail(code) { watchers.get(activeWatch).fail({ code }); },
      visibility(value) { hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
      activeWatch: () => activeWatch,
    };
  }, { key: FOCUS_STORAGE_KEY, settings: { zones: [home], ...settings }, mock });
  if (mock) {
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(new Date(+clockStart + 1000));
  }
  await page.goto(`${origin}${fixturePath}${blocked ? '?blocked' : ''}`);
  await button(page, 'Zones').click();
  return page;
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
const textVisible = (page, text) => page.getByText(text, { exact: true }).waitFor();
const monitorStatus = (page, text) => page.locator('.focus-zone-status').filter({ hasText: text }).waitFor();
const fix = (page, coords, options = {}) => page.evaluate(fix => window.focusTest.fix(fix), { coords, ...options });
const crossingNames = page => page.locator('.focus-zone-events li span').allTextContents();
async function confirm(page, point) {
  await fix(page, point);
  await page.clock.fastForward(dwell);
  await fix(page, point);
}

test('expiry retains a selected zone and requires a new dwell before an exit and arrival', async t => {
  const page = await openStudio(t, { settings: { fence: { seconds: 2, enter: 'resume', exit: 'pause' } } });
  await button(page, 'Session').click();
  await button(page, 'Start focus').click();
  await button(page, 'Play soundscape').click();
  await button(page, 'Stop soundscape').waitFor();
  await button(page, 'Zones').click();
  await button(page, 'Start monitoring').click();
  await confirm(page, point(0));
  await monitorStatus(page, 'Inside the monitored area');
  assert.deepEqual(await crossingNames(page), []);

  await page.clock.fastForward(1000);
  await fix(page, outside);
  await monitorStatus(page, 'Confirming you’re outside…');
  await page.clock.fastForward(MAX_FIX_AGE_MS);
  await textVisible(page, 'The last location fix expired. Waiting for a new reading.');
  await page.evaluate(() => window.focusTest.fail(3));
  await textVisible(page, 'Waiting for a fresh location fix. Try again with a clearer signal.');
  await fix(page, outside, { timestamp: await page.evaluate(() => Date.now()) - MAX_FIX_AGE_MS });
  assert.deepEqual(await crossingNames(page), []);
  await fix(page, outside);
  await monitorStatus(page, 'Confirming you’re outside…');
  await fix(page, outside); // Duplicate timestamp.
  await page.clock.fastForward(dwell - 1);
  await fix(page, outside);
  assert.deepEqual(await crossingNames(page), []);
  await page.clock.fastForward(1);
  await fix(page, outside, { fromProbe: true });
  await textVisible(page, 'You left Home. Timer and ambience paused.');
  assert.deepEqual(await crossingNames(page), ['Left Home']);
  await button(page, 'Session').click();
  await button(page, 'Resume focus').waitFor();
  await button(page, 'Play soundscape').waitFor();

  await button(page, 'Zones').click();
  await page.clock.fastForward(MAX_FIX_AGE_MS + 1);
  await fix(page, point(0, 200));
  await monitorStatus(page, 'Location accuracy is too low');
  await page.clock.fastForward(1);
  await confirm(page, point(0));
  await textVisible(page, 'You entered Home. Timer resumed.');
  assert.deepEqual(await crossingNames(page), ['Entered Home', 'Left Home']);
});

test('individual zones survive an expired fix and keep Quiet Mode priority for simultaneous crossings', async t => {
  const page = await openStudio(t, { settings: {
    zones: [{ ...home, rules: { exit: 'quiet' } }, { ...work, rules: { enter: 'start' } }],
    fence: { scope: 'individual', seconds: 2 },
  } });
  await button(page, 'Start monitoring').click();
  await confirm(page, point(0));
  await monitorStatus(page, 'Inside the monitored area');
  await page.clock.fastForward(MAX_FIX_AGE_MS + 1);
  await confirm(page, point(0.02));
  await textVisible(page, 'You left Home. Quiet Mode is on.');
  assert.deepEqual(await crossingNames(page), ['Left Home', 'Entered Work']);
  assert.equal(await page.getByRole('button', { name: /^Quiet Mode/ }).getAttribute('aria-pressed'), 'true');
  await button(page, 'Session').click();
  await button(page, 'Start focus').waitFor();
});

test('together mode stays inside when signal returns in a different zone in the union', async t => {
  const page = await openStudio(t, { settings: {
    zones: [{ ...home, radius: 1500, rules: { exit: 'quiet' } }, { ...work, radius: 1500 }],
    fence: { scope: 'all', seconds: 2, exit: 'status' },
  } });
  await button(page, 'Start monitoring').click();
  await confirm(page, point(0));
  await monitorStatus(page, 'Inside the monitored area');
  await page.clock.fastForward(MAX_FIX_AGE_MS + 1);
  await confirm(page, point(0.02));
  await monitorStatus(page, 'Inside the monitored area');
  assert.deepEqual(await crossingNames(page), []);
  await page.clock.fastForward(1);
  await confirm(page, point(0.05));
  await textVisible(page, 'You left the monitored area.');
  assert.deepEqual(await crossingNames(page), ['Left the monitored area']);
});

test('a delayed expiration timer cannot carry a pending crossing across a signal gap', async t => {
  const page = await openStudio(t, { settings: { fence: { seconds: 2 } } });
  await button(page, 'Start monitoring').click();
  await confirm(page, point(0));
  await monitorStatus(page, 'Inside the monitored area');
  await page.clock.fastForward(1000);
  await fix(page, outside);
  await monitorStatus(page, 'Confirming you’re outside…');
  await page.clock.setSystemTime(await page.evaluate(() => Date.now()) + MAX_FIX_AGE_MS + 1);
  await fix(page, point(outside.longitude, 6));
  await monitorStatus(page, 'Device accuracy ±6 m');
  assert.deepEqual(await crossingNames(page), []);
  await monitorStatus(page, 'Confirming you’re outside…');
  await page.clock.fastForward(dwell);
  await fix(page, outside);
  await textVisible(page, 'You left Home. Timer and ambience paused.');
  assert.deepEqual(await crossingNames(page), ['Left Home']);
});

test('a hidden tab pauses tracking and an explicitly stopped session starts with a new baseline', async t => {
  const page = await openStudio(t, { settings: { fence: { seconds: 2, exit: 'status' } } });
  await button(page, 'Start monitoring').click();
  await confirm(page, point(0));
  await monitorStatus(page, 'Inside the monitored area');
  const watch = await page.evaluate(() => window.focusTest.activeWatch());
  await page.evaluate(() => window.focusTest.visibility(true));
  await monitorStatus(page, 'Monitoring paused while this browser tab is hidden');
  await page.clock.fastForward(MAX_FIX_AGE_MS);
  await fix(page, outside, { watch });
  assert.deepEqual(await crossingNames(page), []);
  await page.evaluate(() => window.focusTest.visibility(false));
  await monitorStatus(page, 'Waiting for your device’s location…');
  await confirm(page, outside);
  await textVisible(page, 'You left Home.');
  assert.deepEqual(await crossingNames(page), ['Left Home']);

  await button(page, 'Stop monitoring').click();
  await button(page, 'Clear activity').click();
  await button(page, 'Start monitoring').click();
  await confirm(page, point(0));
  await monitorStatus(page, 'Inside the monitored area');
  assert.deepEqual(await crossingNames(page), []);
});

test('Office geolocation is blocked by a restrictive header and works with same-origin permission', async t => {
  const blocked = await openStudio(t, { mock: false, blocked: true });
  await button(blocked, 'Use my location').click();
  await textVisible(blocked, 'Location access is blocked. Check location permissions for this site.');
  await button(blocked, 'Start monitoring').click();
  await blocked.getByRole('region', { name: 'Monitoring' }).getByRole('alert').waitFor();
  await button(blocked, 'Start monitoring').waitFor();
  assert.deepEqual(await crossingNames(blocked), []);

  const allowed = await openStudio(t, { mock: false });
  await button(allowed, 'Use my location').click();
  await allowed.getByRole('heading', { name: 'New zone' }).waitFor();
  await button(allowed, 'Start monitoring').click();
  await allowed.locator('.focus-zone-status small').waitFor();
  assert.equal(await allowed.locator('.focus-zone-status span').getAttribute('data-location'), 'inside');
});

test('permission denial stops the watch and discards confirmations before a retry', async t => {
  const page = await openStudio(t, { settings: { fence: { seconds: 2, exit: 'quiet' } } });
  await button(page, 'Start monitoring').click();
  await confirm(page, point(0));
  await monitorStatus(page, 'Inside the monitored area');
  const watch = await page.evaluate(() => window.focusTest.activeWatch());
  await page.evaluate(() => window.focusTest.fail(1));
  await textVisible(page, 'Location access is blocked. Check location permissions for this site.');
  await page.waitForFunction(() => !window.focusTest.activeWatch());
  await page.clock.fastForward(dwell);
  await fix(page, outside, { watch });
  assert.deepEqual(await crossingNames(page), []);

  await button(page, 'Start monitoring').click();
  await confirm(page, outside);
  await monitorStatus(page, 'Outside the monitored area');
  assert.deepEqual(await crossingNames(page), []);
  assert.equal(await page.getByRole('button', { name: /^Quiet Mode/ }).getAttribute('aria-pressed'), 'false');
});

test('editing the radius starts a new baseline without firing an exit at a stationary device', async t => {
  const page = await openStudio(t, { settings: { fence: { seconds: 2, exit: 'quiet' } } });
  const nearby = point(0.001);
  await button(page, 'Start monitoring').click();
  await confirm(page, nearby);
  await monitorStatus(page, 'Inside the monitored area');
  await button(page, 'Edit zone').click();
  const radius = page.getByRole('spinbutton', { name: 'Radius (meters)' });
  await radius.fill('1');
  await button(page, 'Save changes').click();
  await monitorStatus(page, 'Waiting for your device’s location…');
  await confirm(page, nearby);
  await monitorStatus(page, 'Outside the monitored area');
  assert.deepEqual(await crossingNames(page), []);
});

for (const width of [390, 1200]) {
  test(`the zone map supports precise placement, draggable pins and uncapped radii at ${width}px`, async t => {
    const page = await openStudio(t, { width, settings: { zones: [] } });
    await page.getByText('Enter coordinates', { exact: true }).click();
    const latitude = page.getByLabel('Latitude', { exact: true });
    const longitude = page.getByLabel('Longitude', { exact: true });
    await latitude.fill('37.774929');
    await longitude.fill('-122.419416');
    const latitudeBox = await latitude.boundingBox();
    const longitudeBox = await longitude.boundingBox();
    assert.ok(latitudeBox.x + latitudeBox.width <= longitudeBox.x);
    await button(page, 'Place pin').click();
    const radius = page.getByRole('spinbutton', { name: 'Radius (meters)' });
    assert.equal(await radius.getAttribute('max'), null);
    await radius.fill('1');
    await radius.press('Enter');
    await button(page, 'Fit zone on globe').click();
    const world = await button(page, 'World view').boundingBox();
    const drop = await button(page, 'Drop pin here').boundingBox();
    assert.ok(world.y + world.height <= drop.y);
    assert.equal(await page.locator('.focus-globe-scale text').textContent(), '1 m');
    const ring = page.locator('.focus-globe-marker[data-marker="draft"] .focus-globe-boundary');
    const ringWidth = await ring.evaluate(boundary => boundary.getBBox().width);
    assert.ok(ringWidth > 130 && ringWidth < 150, `Expected a fitted circle, got width ${ringWidth}`);
    assert.match(await page.locator('.focus-globe-center').innerText(), /37\.774929° N · 122\.419416° W/);
    await button(page, 'Save zone').click();
    await textVisible(page, 'Focus zone saved.');

    const pin = page.locator('[data-zone-id] .focus-globe-pin');
    await pin.scrollIntoViewIfNeeded();
    const { x, y, width: pinWidth, height: pinHeight } = await pin.boundingBox();
    await page.mouse.move(x + pinWidth / 2, y + pinHeight / 2);
    await page.mouse.down();
    await page.mouse.move(x + pinWidth / 2 + 28, y + pinHeight / 2, { steps: 4 });
    await page.mouse.up();
    await page.getByRole('heading', { name: 'Edit zone' }).waitFor();
    await radius.fill('30000001');
    await radius.press('Enter');
    await button(page, 'World view').click();
    assert.equal(await ring.getAttribute('d'), await page.locator('.focus-globe-ocean').getAttribute('d'));
    await button(page, 'Save changes').click();
    await page.reload();
    await button(page, 'Zones').click();
    assert.equal(await radius.inputValue(), '30000001');
    const zone = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).zones[0], FOCUS_STORAGE_KEY);
    assert.notEqual(zone.center.longitude, -122.419416);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
}
