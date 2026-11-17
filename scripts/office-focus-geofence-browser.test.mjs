import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';
import { MAX_FIX_AGE_MS } from '../office/src/focus-geofence.mjs';
import { FOCUS_STORAGE_KEY } from '../office/src/focus-studio-model.mjs';

const require = createRequire(import.meta.url);
const express = require('../backend/node_modules/express');
const { registerOfficeFocusLive } = require('../backend/office-focus-live');
const livePath = '/office/focus/live';
const officeToken = 'browser-test-only';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = '/__focus-studio-test';
const fixture = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body { margin: 12px; background: #111220; font: 15px system-ui; }</style>
<div id="root"></div><script type="module">
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import FocusStudio from '/src/FocusStudio.jsx';
function Fixture() {
  const [active, setActive] = useState(true);
  window.setFocusOpen = setActive;
  const liveTransport = {
    url: '${livePath}',
    request: (url, options) => fetch(url, { ...options, headers: { ...options?.headers, 'x-office-token': '${officeToken}' } }),
  };
  return React.createElement(FocusStudio, { active, liveTransport, onOpen: () => setActive(true) });
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
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
  const liveApi = express();
  registerOfficeFocusLive(liveApi, { api: true, json: express.json,
    requireOfficeToken: (request, response, next) => request.get('x-office-token') === officeToken ? next() : response.sendStatus(401) });
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
          if (url.pathname === livePath || url.pathname.startsWith(livePath + '/')) return liveApi(request, response, next);
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
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function openStudio(t, { settings = {}, mock = true, blocked = false, width = 1200, disableWebGL = false } = {}) {
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
  await page.addInitScript(({ key, settings, mock, disableWebGL }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(settings));
    if (disableWebGL) {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...options) {
        return kind.startsWith('webgl') ? null : getContext.call(this, kind, ...options);
      };
    }
    if (!mock) return;
    let nextWatch = 0;
    let probe;
    let hidden = false;
    const watchers = new Map();
    const runningWatches = new Set();
    const activeWatch = () => [...runningWatches].at(-1);
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(update, fail, options) {
        const id = ++nextWatch;
        watchers.set(id, { update, fail, options });
        runningWatches.add(id);
        return id;
      },
      clearWatch(id) { runningWatches.delete(id); },
      getCurrentPosition(update, fail) { probe = { update, fail }; },
    } });
    window.focusTest = {
      fix({ coords, timestamp = Date.now(), watch = activeWatch(), fromProbe }) {
        const callbacks = fromProbe ? probe : watchers.get(watch);
        if (fromProbe) probe = undefined;
        callbacks.update({ coords, timestamp });
      },
      fail(code) { watchers.get(activeWatch()).fail({ code }); },
      visibility(value) { hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
      activeWatch,
      options: () => watchers.get(activeWatch())?.options,
      hasProbe: () => Boolean(probe),
      count: () => runningWatches.size,
    };
  }, { key: FOCUS_STORAGE_KEY, settings: { zones: [home], ...settings }, mock, disableWebGL });
  if (mock) {
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(new Date(+clockStart + 1000));
  }
  await page.goto(`${origin}${fixturePath}${blocked ? '?blocked' : ''}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await button(page, 'Geofencing').click();
  return page;
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
const textVisible = (page, text) => page.getByText(text, { exact: true }).waitFor();
const monitorStatus = (page, text) => page.locator('.focus-monitor .focus-zone-status').filter({ hasText: text }).waitFor();
const fix = (page, coords, options = {}) => page.evaluate(fix => window.focusTest.fix(fix), { coords, ...options });
const crossingNames = page => page.locator('.focus-zone-events li span').allTextContents();
async function confirm(page, point) {
  await fix(page, point);
  await page.clock.fastForward(dwell);
  await fix(page, point);
}

async function saveAddress(page, name, longitude) {
  await page.getByLabel('Place name', { exact: true }).fill(name);
  await page.getByLabel('Street address', { exact: true }).fill('10 Example Avenue');
  await page.getByLabel('Place latitude', { exact: true }).fill('0.0005');
  await page.getByLabel('Place longitude', { exact: true }).fill(String(longitude));
  await page.getByLabel('Arrival radius (m)').fill('40');
  await button(page, 'Save address').click();
}

test('live maps track saved addresses, ordered route stops, grid lines, and repeat messages at mobile width', async t => {
  const page = await openStudio(t, { width: 390, disableWebGL: true });
  const gps = (longitude, accuracy = 2) => ({ ...point(longitude, accuracy), latitude: 0.0005 });
  await button(page, 'Live Maps').click();
  await button(page, 'Addresses').click();
  await saveAddress(page, 'Depot', 0.0025);
  await saveAddress(page, 'Warehouse', 0.0045);
  await button(page, 'Messages').click();
  await page.getByLabel('Message trigger').selectOption('arrival');
  await page.getByLabel('Address for message').selectOption({ label: 'Depot' });
  await page.getByLabel('Message text').fill('Check in at the depot');
  await page.getByLabel('Repeat cadence').selectOption('1');
  await page.getByLabel('Follow-up messages').fill('1');
  await button(page, 'Add message').click();
  await button(page, 'Routes').click();
  const stops = page.getByLabel('Add a saved address as a stop');
  for (const name of ['Warehouse', 'Depot']) {
    await stops.selectOption({ label: name });
    await button(page, 'Add stop').click();
  }
  await button(page, 'Move stop 2 up').click();
  const road = new URL(await page.getByRole('link', { name: 'Open road directions in Google Maps' }).getAttribute('href'));
  assert.equal(road.searchParams.get('waypoints'), '0.0005,0.0025');
  assert.equal(road.searchParams.get('destination'), '0.0005,0.0045');
  await button(page, 'Start live GPS').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await fix(page, gps(0.0005));
  await button(page, 'Track route live').click();
  await page.getByText('Following route to Depot.').waitFor();
  await page.clock.fastForward(1000);
  await fix(page, gps(0.0025));
  const activity = page.getByRole('log', { name: 'Live tracking activity' });
  await activity.getByText('Arrived at Depot', { exact: true }).waitFor();
  await activity.getByText('Reached Depot', { exact: true }).waitFor();
  await activity.getByText('Check in at the depot', { exact: true }).waitFor();
  await button(page, 'Grid').click();
  await page.getByLabel('Grid spacing').selectOption('detail');
  await page.clock.fastForward(1000);
  await fix(page, gps(0.0025));
  await page.locator('.focus-ops-map [data-movement-grid]').waitFor({ state: 'attached' });
  await page.locator('.focus-ops-map [data-current-grid-cell]').waitFor({ state: 'attached' });
  await page.clock.fastForward(1000);
  await fix(page, gps(0.0045));
  await page.getByText('Confirming a crossing', { exact: true }).waitFor();
  await page.clock.fastForward(1000);
  await fix(page, gps(0.0045));
  await activity.getByText(/^Entered grid cell/).waitFor();
  await activity.getByText('Reached Warehouse', { exact: true }).waitFor();
  await button(page, 'Routes').click();
  await page.getByText('All route stops reached.', { exact: true }).waitFor();
  await page.clock.fastForward(61_000);
  await page.waitForFunction(() => [...document.querySelectorAll('.focus-ops-activity li strong')]
    .filter(item => item.textContent === 'Check in at the depot').length === 2);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await button(page, 'Stop live GPS').click();
  await page.getByText('Live GPS off', { exact: true }).waitFor();
});

test('vehicles use a selected type and phone identifier and update live telemetry at desktop width', async t => {
  const page = await openStudio(t, { disableWebGL: true });
  await button(page, 'Live Maps').click();
  await button(page, 'Vehicles & devices').click();
  await page.getByLabel('Profile name').fill('Delivery van');
  await page.getByLabel(/^Vehicle type/).selectOption('van');
  await page.getByLabel('Phone identifier (optional)').fill('+1 (555) 010-0123');
  await button(page, 'Save profile').click();
  await page.getByLabel('Find by phone identifier').fill('+15550100123');
  await page.getByText('Phone ending 0123', { exact: false }).waitFor();
  await page.getByText('Stop detection waits 120 seconds of low movement.', { exact: true }).waitFor();
  await button(page, 'Start live GPS').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await fix(page, { ...point(-122.0005), speed: 10, heading: 80 });
  await button(page, 'Start vehicle trip').click();
  await page.clock.fastForward(1000);
  await fix(page, { ...point(-122.0004), speed: 10, heading: 80 });
  const telemetry = page.locator('[aria-label="Vehicle telemetry"]');
  await telemetry.getByText('Moving', { exact: true }).waitFor();
  await telemetry.getByText('36.0 km/h', { exact: true }).first().waitFor();
  await page.clock.fastForward(2000);
  await fix(page, { ...point(-122.0002), speed: 15, heading: 90 });
  await telemetry.getByText('54.0 km/h', { exact: true }).first().waitFor();
  await telemetry.getByText('90°', { exact: true }).waitFor();
  await button(page, 'Save parking pin').click();
  await page.getByText(/^Parking pin /).waitFor();
  await button(page, 'Finish vehicle trip').click();
  await telemetry.getByText('Trip ended', { exact: true }).waitFor();
  await button(page, 'Clear parking pin').click();
  assert.equal(await page.getByText(/^Parking pin /).count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});

test('one Office device shares authorized GPS with another and can revoke it', async t => {
  const publisher = await openStudio(t, { width: 390, disableWebGL: true });
  const viewer = await openStudio(t, { disableWebGL: true });
  await button(publisher, 'Live Maps').click();
  await button(viewer, 'Live Maps').click();
  await button(publisher, 'Start live GPS').click();
  await publisher.waitForFunction(() => window.focusTest.count() === 1);
  await fix(publisher, point(12.42));
  await button(publisher, 'Share my GPS with Office').click();
  await publisher.getByText('Waiting for GPS', { exact: true }).waitFor();
  await publisher.clock.fastForward(3500);
  await publisher.getByText('Sharing live GPS', { exact: true }).waitFor();
  await button(viewer, 'View shared devices').click();
  const source = viewer.getByLabel('Live tracking source');
  await source.selectOption({ label: 'Office phone · Phone' });
  await viewer.getByText('GPS live', { exact: true }).waitFor();
  const liveMap = viewer.locator('.focus-ops-map .focus-globe-device title');
  await liveMap.filter({ hasText: 'Live GPS · Office phone' }).waitFor({ state: 'attached' });
  await button(publisher, 'Stop sharing my GPS').click();
  await viewer.clock.fastForward(4000);
  await viewer.getByText('Waiting for shared GPS', { exact: true }).waitFor();
  assert.equal(await liveMap.count(), 0);
});

test('Focus section buttons share one row and fit at phone and desktop widths', async t => {
  const page = await openStudio(t, { width: 320, disableWebGL: true });
  const nav = page.getByRole('navigation', { name: 'Focus Studio sections' });
  const sections = nav.getByRole('button');
  assert.equal(await sections.count(), 7);
  for (const width of [320, 390, 540, 768, 1200]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await nav.evaluate(element => ({
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      rows: new Set([...element.querySelectorAll('button')].map(button => button.offsetTop)).size,
    }));
    assert.equal(layout.rows, 1, `Section rows at ${width}px`);
    assert.equal(layout.scrollWidth, layout.width, `Navigation overflow at ${width}px`);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  for (const section of await sections.all()) {
    await section.click();
    assert.equal(await section.getAttribute('aria-current'), 'page');
  }
});

test('Geo Tracking shows fresh fixes without zones and clears the map when stopped', async t => {
  const page = await openStudio(t, { settings: { zones: [] }, width: 390 });
  assert.equal(await button(page, 'Start Geofencing').isDisabled(), true);
  await button(page, 'Geo Tracking').click();
  await page.getByRole('checkbox', { name: 'Background Geo Tracking' }).check();
  await button(page, 'Start Geo Tracking').click();
  await fix(page, point(-122.419416, 5));
  await textVisible(page, 'Receiving live location');
  await textVisible(page, '0.000000° N · 122.419416° W');
  const live = page.getByRole('region', { name: 'Live location' });
  const timestamp = await live.locator('time').getAttribute('datetime');
  await page.clock.fastForward(1000);
  await fix(page, point(151.2093, 12));
  await textVisible(page, '0.000000° N · 151.209300° E');
  assert.match(await live.locator('small').first().textContent(), /Device accuracy ±12 m/);
  assert.ok(await live.locator('time').getAttribute('datetime') > timestamp);
  assert.equal(await live.locator('.focus-globe-device').count(), 1);
  await fix(page, point(-122.419416), { timestamp: Date.parse(timestamp) });
  assert.equal(await live.getByText('0.000000° N · 122.419416° W', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  const watch = await page.evaluate(() => window.focusTest.activeWatch());
  await page.evaluate(() => window.focusTest.visibility(true));
  await textVisible(page, 'Geo Tracking paused while this browser tab is hidden');
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await fix(page, point(-22), { watch });
  assert.equal(await live.locator('.focus-globe-device').count(), 0);
  await page.evaluate(() => window.focusTest.visibility(false));
  await textVisible(page, 'Waiting for your device’s location…');
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await fix(page, point(151.2093));
  await textVisible(page, 'Receiving live location');

  await page.clock.fastForward(MAX_FIX_AGE_MS);
  await live.getByRole('alert').waitFor();
  assert.equal(await live.locator('.focus-globe-device').count(), 0);
  assert.equal(await live.locator('time').count(), 0);
  await fix(page, point(12));
  await textVisible(page, 'Receiving live location');
  await button(page, 'Stop Geo Tracking').click();
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await textVisible(page, 'Geo Tracking off');
  assert.equal(await live.locator('.focus-globe-device').count(), 0);
});

test('background preferences control Geo Tracking and Geofencing independently in Office', async t => {
  const page = await openStudio(t, { settings: { fence: { seconds: 2, exit: 'status' } } });
  const fenceBackground = page.getByRole('checkbox', { name: 'Background Geofencing' });
  const trackBackground = page.getByRole('checkbox', { name: 'Background Geo Tracking' });
  const setOpen = value => page.evaluate(value => window.setFocusOpen(value), value);
  const watch = () => page.evaluate(() => window.focusTest.activeWatch());

  assert.equal(await fenceBackground.isChecked(), false);
  await button(page, 'Start Geofencing').click();
  await confirm(page, point(0));
  await monitorStatus(page, 'Inside the monitored area');
  const shared = await watch();
  await button(page, 'Geo Tracking').click();
  assert.equal(await trackBackground.isChecked(), false);
  await button(page, 'Start Geo Tracking').click();
  assert.equal(await watch(), shared);
  assert.equal(await page.evaluate(() => window.focusTest.count()), 1);
  await setOpen(false);
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await setOpen(true);
  await trackBackground.check();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  const resumed = await watch();
  await setOpen(false);
  await page.getByRole('complementary', { name: 'Focus session' }).waitFor();
  assert.equal(await watch(), resumed);
  await page.clock.fastForward(1);
  await confirm(page, outside);
  assert.deepEqual(await crossingNames(page), []);
  await setOpen(true);
  await textVisible(page, '0.000000° N · 0.010000° E');
  await trackBackground.uncheck();

  await button(page, 'Geofencing').click();
  await fenceBackground.check();
  await page.clock.fastForward(1);
  await confirm(page, point(0));
  await monitorStatus(page, 'Inside the monitored area');
  await setOpen(false);
  await page.getByRole('complementary', { name: 'Focus session' }).waitFor();
  assert.equal(await watch(), resumed);
  await page.clock.fastForward(1);
  await confirm(page, outside);
  await page.getByRole('complementary', { name: 'Focus session' }).getByText('You left Home.', { exact: true }).waitFor();
  await button(page, 'Stop Geofencing').click();
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await setOpen(true);
  await button(page, 'Geo Tracking').click();
  await trackBackground.check();

  await page.reload();
  await button(page, 'Geo Tracking').click();
  assert.equal(await trackBackground.isChecked(), true);
  await button(page, 'Start Geo Tracking').waitFor();
  await button(page, 'Geofencing').click();
  assert.equal(await fenceBackground.isChecked(), true);
  await button(page, 'Start Geofencing').waitFor();
  assert.equal(await page.evaluate(() => window.focusTest.count()), 0);
});

test('expiry retains a selected zone and requires a new dwell before an exit and arrival', async t => {
  const page = await openStudio(t, { settings: { fence: { seconds: 2, enter: 'resume', exit: 'pause' } } });
  await button(page, 'Session').click();
  await button(page, 'Start focus').click();
  await button(page, 'Play soundscape').click();
  await button(page, 'Stop soundscape').waitFor();
  await button(page, 'Geofencing').click();
  await button(page, 'Start Geofencing').click();
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

  await button(page, 'Geofencing').click();
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
  await button(page, 'Start Geofencing').click();
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
  await button(page, 'Start Geofencing').click();
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
  await button(page, 'Start Geofencing').click();
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

test('a hidden tab pauses background geofencing and a stopped session starts with a new baseline', async t => {
  const page = await openStudio(t, { settings: { fence: { background: true, seconds: 2, exit: 'status' } } });
  await button(page, 'Start Geofencing').click();
  await confirm(page, point(0));
  await monitorStatus(page, 'Inside the monitored area');
  const watch = await page.evaluate(() => window.focusTest.activeWatch());
  await page.evaluate(() => window.focusTest.visibility(true));
  await monitorStatus(page, 'Geofencing paused while this browser tab is hidden');
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await page.clock.fastForward(MAX_FIX_AGE_MS);
  await fix(page, outside, { watch });
  assert.deepEqual(await crossingNames(page), []);
  await page.evaluate(() => window.focusTest.visibility(false));
  await monitorStatus(page, 'Waiting for your device’s location…');
  await confirm(page, outside);
  await textVisible(page, 'You left Home.');
  assert.deepEqual(await crossingNames(page), ['Left Home']);

  await button(page, 'Stop Geofencing').click();
  await button(page, 'Clear activity').click();
  await button(page, 'Start Geofencing').click();
  await confirm(page, point(0));
  await monitorStatus(page, 'Inside the monitored area');
  assert.deepEqual(await crossingNames(page), []);
});

test('Office geolocation is blocked by a restrictive header and works with same-origin permission', async t => {
  const blocked = await openStudio(t, { mock: false, blocked: true });
  await button(blocked, 'Use my location').click();
  await textVisible(blocked, 'Location access is blocked. Check location permissions for this site.');
  await button(blocked, 'Start Geofencing').click();
  await blocked.getByRole('region', { name: 'Geofencing' }).getByRole('alert').waitFor();
  await button(blocked, 'Start Geofencing').waitFor();
  assert.deepEqual(await crossingNames(blocked), []);

  const allowed = await openStudio(t, { mock: false });
  await button(allowed, 'Use my location').click();
  await allowed.getByRole('heading', { name: 'New zone' }).waitFor();
  await button(allowed, 'Start Geofencing').click();
  await allowed.locator('.focus-zone-status small').waitFor();
  assert.equal(await allowed.locator('.focus-zone-status span').getAttribute('data-location'), 'inside');
});

test('permission denial stops the watch and discards confirmations before a retry', async t => {
  const page = await openStudio(t, { settings: { fence: { seconds: 2, exit: 'quiet' } } });
  await button(page, 'Start Geofencing').click();
  await confirm(page, point(0));
  await monitorStatus(page, 'Inside the monitored area');
  const watch = await page.evaluate(() => window.focusTest.activeWatch());
  await page.evaluate(() => window.focusTest.fail(1));
  await textVisible(page, 'Location access is blocked. Check location permissions for this site.');
  await page.waitForFunction(() => !window.focusTest.activeWatch());
  await page.clock.fastForward(dwell);
  await fix(page, outside, { watch });
  assert.deepEqual(await crossingNames(page), []);

  await button(page, 'Start Geofencing').click();
  await confirm(page, outside);
  await monitorStatus(page, 'Outside the monitored area');
  assert.deepEqual(await crossingNames(page), []);
  assert.equal(await page.getByRole('button', { name: /^Quiet Mode/ }).getAttribute('aria-pressed'), 'false');
});

test('editing the radius starts a new baseline without firing an exit at a stationary device', async t => {
  const page = await openStudio(t, { settings: { fence: { seconds: 2, exit: 'quiet' } } });
  const nearby = point(0.001);
  await button(page, 'Start Geofencing').click();
  await confirm(page, nearby);
  await monitorStatus(page, 'Inside the monitored area');
  await button(page, 'Edit zone').click();
  const radius = page.getByRole('spinbutton', { name: 'Radius (meters)' });
  await radius.fill('1');
  await button(page, 'Save changes').click();
  await monitorStatus(page, 'Waiting for your device’s location…');
  await page.clock.fastForward(1);
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
    await button(page, 'Geofencing').click();
    assert.equal(await radius.inputValue(), '30000001');
    const zone = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).zones[0], FOCUS_STORAGE_KEY);
    assert.notEqual(zone.center.longitude, -122.419416);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  });
}

test('Geo Tracking can get one fix, use independent accuracy, and record and export a route', async t => {
  const page = await openStudio(t, { width: 320 });
  await button(page, 'Geo Tracking').click();
  await button(page, 'Check my location once').click();
  await page.waitForFunction(() => window.focusTest.hasProbe());
  assert.equal(await page.evaluate(() => window.focusTest.count()), 0);
  await fix(page, { ...point(0), heading: 90, speed: 5, altitude: 22 }, { fromProbe: true });
  await textVisible(page, 'Single location reading');
  await textVisible(page, '18.0 km/h');
  await textVisible(page, '90° E');
  await page.getByText('Geo Tracking settings', { exact: true }).click();
  await page.getByRole('combobox', { name: /^Tracking accuracy/ }).selectOption('battery');
  await button(page, 'Start Geo Tracking').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  assert.equal(await page.evaluate(() => window.focusTest.options().enableHighAccuracy), false);
  await page.getByText('Routes and trip history', { exact: true }).click();
  await button(page, 'Record route').click();
  await page.clock.fastForward(100);
  await fix(page, point(0, 2));
  await page.clock.fastForward(5000);
  await fix(page, point(0.003, 2));
  await textVisible(page, '2 samples · 0 waypoints');
  await page.getByLabel('Trip name').fill('Field route');
  await button(page, 'Save trip on this device').click();
  await textVisible(page, 'Trip saved on this device.');
  await button(page, 'Pause Geo Tracking').click();
  await textVisible(page, 'Geo Tracking paused');
  await page.waitForFunction(() => window.focusTest.count() === 0);
  const download = page.waitForEvent('download');
  await button(page, 'Export trip').click();
  assert.equal((await download).suggestedFilename(), 'office-trip.gpx');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ufi-office-focus-trips-v1')));
  assert.equal(saved[0].name, 'Field route');
  assert.equal(saved[0].points.length, 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('Geofencing honors selected-zone timing overrides and records stays and cooldowns', async t => {
  const page = await openStudio(t, {
    settings: {
      zones: [{ ...home, overrides: { enterSeconds: 2, exitSeconds: 4, staySeconds: 10, cooldownSeconds: 120 } }],
      fence: { seconds: 8, stay: 'status' },
    },
  });
  await button(page, 'Start Geofencing').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  const move = async (coords, milliseconds) => {
    await page.clock.fastForward(milliseconds);
    await fix(page, coords);
  };
  await move(outside, 500);
  await move(outside, 4000);
  await monitorStatus(page, 'Outside the monitored area');
  await move(point(0), 500);
  await move(point(0), 2000);
  await textVisible(page, 'Entered Home');
  await move(point(0), 10000);
  await textVisible(page, 'Stayed inside Home');
  await move(point(0), 3000);
  assert.equal(await page.getByText('Stayed inside Home', { exact: true }).count(), 1);
  await move(outside, 500);
  await move(outside, 2000);
  assert.equal(await page.getByText('Left Home', { exact: true }).count(), 0);
  await move(outside, 2000);
  await textVisible(page, 'Left Home');
  await move(point(0), 500);
  await move(point(0), 2000);
  await textVisible(page, 'Cooldown');
  await page.getByText('Zone schedule and priority', { exact: true }).click();
  assert.equal(await page.getByLabel('Departure confirmation (seconds)', { exact: true }).inputValue(), '4');
  await page.getByRole('combobox', { name: /^Snooze duration/ }).selectOption('15');
  await button(page, 'Snooze zone').click();
  await move(point(0), 500);
  await monitorStatus(page, 'outside active hours');
});

test('an editable rectangle can be saved from two map coordinates and fits on the phone', async t => {
  const page = await openStudio(t, { width: 320 });
  await page.getByText('Enter coordinates', { exact: true }).click();
  await page.getByLabel('Latitude', { exact: true }).fill('1');
  await page.getByLabel('Longitude', { exact: true }).fill('2');
  await button(page, 'Place pin').click();
  await page.getByRole('combobox', { name: /^Zone shape/ }).selectOption('rectangle');
  await page.getByLabel('Latitude', { exact: true }).fill('1.02');
  await page.getByLabel('Longitude', { exact: true }).fill('2.03');
  await button(page, 'Place pin').click();
  await page.getByLabel('Zone name', { exact: true }).fill('Project lot');
  await button(page, 'Save zone').click();
  await textVisible(page, 'Project lot saved.');
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).zones.find(zone => zone.name === 'Project lot'), FOCUS_STORAGE_KEY);
  assert.equal(saved.shape, 'rectangle');
  assert.equal(saved.vertices.length, 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('phone shortcuts open tracking settings, trips and monitoring without starting location', async t => {
  const page = await openStudio(t, { width: 320 });
  await button(page, 'Monitoring').click();
  const monitoring = page.getByRole('region', { name: 'Geofencing', exact: true });
  assert.equal(await monitoring.evaluate(element => element === document.activeElement), true);

  await button(page, 'Zone library').click();
  await page.getByRole('combobox', { name: /^Zone status/ }).selectOption('disabled');
  await textVisible(page, 'Showing 0 of 1 saved zones.');
  await page.getByRole('combobox', { name: /^Zone status/ }).selectOption('enabled');
  await textVisible(page, 'Showing 1 of 1 saved zones.');

  await button(page, 'Geo Tracking').click();
  await button(page, 'Tracking settings').click();
  assert.equal(await page.getByText('Geo Tracking settings', { exact: true }).evaluate(el => el.parentElement.open), true);
  await button(page, 'Trip library').click();
  assert.equal(await page.getByText('Routes and trip history', { exact: true }).evaluate(el => el.parentElement.open), true);
  assert.equal(await page.evaluate(() => window.focusTest.count()), 0);
  await button(page, 'Track for 15 minutes').click();
  await button(page, 'Stop Geo Tracking').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('both maps render shaded terrain and share the 3D and flat map switch', async t => {
  const page = await openStudio(t, { mock: false, width: 390 });
  const globe = page.locator('.focus-zone .focus-globe');
  await globe.locator('canvas').waitFor();
  await page.waitForFunction(() => document.querySelector('.focus-zone .focus-globe').dataset.renderer === 'webgl');
  const scale = await globe.locator('.focus-globe-scale path').getAttribute('d');
  const box = await globe.locator('.focus-globe-map').boundingBox();
  const start = { x: box.x + box.width * .38, y: box.y + box.height * .5 };
  const end = { x: box.x + box.width * .62, y: start.y };
  await globe.locator('svg').first().evaluate((element, { start, end }) => {
    // Pointer capture applies only to native pointers; this drives two synthetic touch pointers.
    element.setPointerCapture = () => {};
    const pointer = (type, id, { x, y }) => element.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: y,
    }));
    pointer('pointerdown', 10, start);
    pointer('pointerdown', 11, end);
    pointer('pointermove', 10, { ...start, x: start.x - 34 });
    pointer('pointermove', 11, { ...end, x: end.x + 34 });
    pointer('pointerup', 10, start);
    pointer('pointerup', 11, end);
  }, { start, end });
  assert.notEqual(await globe.locator('.focus-globe-scale path').getAttribute('d'), scale);
  assert.equal(await page.getByRole('heading', { name: 'New zone' }).count(), 0);
  await button(page, 'Flat map').click();
  await globe.locator('canvas').waitFor({ state: 'detached' });
  await button(page, 'Geo Tracking').click();
  assert.equal(await button(page, 'Flat map').getAttribute('aria-pressed'), 'true');
  await button(page, '3D globe').click();
  await page.waitForFunction(() => document.querySelector('.focus-tracking-map .focus-globe').dataset.renderer === 'webgl');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

test('a phone can drop a route start, pause the walk when hidden and save separate segments locally', async t => {
  const page = await openStudio(t, { width: 390, disableWebGL: true });
  await button(page, 'Commands').click();
  await page.getByRole('searchbox', { name: 'Search commands' }).fill('drop pin');
  await button(page, 'Walk a route').click();
  const walk = page.getByRole('region', { name: 'Walk a route' });
  const trackingMap = page.locator('.focus-tracking-map');
  await trackingMap.getByText('Enter coordinates', { exact: true }).click();
  await trackingMap.getByLabel('Latitude', { exact: true }).fill('0');
  await trackingMap.getByLabel('Longitude', { exact: true }).fill('0');
  await button(page, 'Place pin').click();
  assert.equal(await page.locator('.focus-tracking-map [data-pin="drop"]').count(), 1);
  assert.equal(await page.evaluate(() => window.focusTest.count()), 0);
  await button(page, 'Start Geo Tracking').click();
  await button(page, 'Start walk').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await fix(page, point(0, 2));
  await page.clock.fastForward(3000);
  await fix(page, point(0.0004, 2));
  await walk.getByText(/^2 points/).waitFor();
  await page.evaluate(() => window.focusTest.visibility(true));
  await walk.getByText('Walk paused while Focus Studio was out of view.').waitFor();
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await page.evaluate(() => window.focusTest.visibility(false));
  await button(page, 'Resume walk').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await page.clock.fastForward(3000);
  await fix(page, point(0.003, 2));
  await page.clock.fastForward(3000);
  await fix(page, point(0.0034, 2));
  await walk.getByText(/^4 points/).waitFor();
  await button(page, 'Finish walk').click();
  const paths = await page.locator('.focus-tracking-map .focus-globe-route').getAttribute('d');
  assert.equal(paths.match(/M/g)?.length, 2);
  await page.getByLabel('Walk name', { exact: true }).fill('Morning path');
  await button(page, 'Save walk').click();
  await textVisible(page, 'Morning path saved to Trip library.');
  const [saved] = await page.evaluate(() => JSON.parse(localStorage.getItem('ufi-office-focus-trips-v1')));
  assert.equal(saved.name, 'Morning path');
  assert.deepEqual(saved.points.map(point => point.startsSegment), [true, false, true, false]);
  await button(page, 'Trip library').click();
  await trackingMap.getByRole('combobox', { name: /View trip/ }).selectOption(saved.id);
  await trackingMap.locator('.focus-globe-device title').filter({ hasText: 'Replay position' }).waitFor({ state: 'attached' });
});

test('a walked boundary previews as a polygon before saving an inactive geofence', async t => {
  const page = await openStudio(t, { width: 390, disableWebGL: true });
  await button(page, 'Walk a boundary').click();
  await button(page, 'Start walk').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  const samples = [point(0), point(.0004), { ...point(.0004), latitude: .0004 }, { ...point(0), latitude: .0004 }, point(0)];
  for (const reading of samples) {
    await fix(page, reading);
    await page.clock.fastForward(3000);
  }
  await button(page, 'Finish walk').click();
  await textVisible(page, '4 boundary points. Use the outline to open the zone editor.');
  assert.equal(await page.locator('.focus-globe-marker[data-marker="walk"] .focus-globe-boundary').count(), 1);
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await button(page, 'Use as zone').click();
  await page.getByRole('heading', { name: 'New zone' }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: 'Zone shape' }).inputValue(), 'polygon');
  await button(page, 'Save zone').click();
  await textVisible(page, 'Walked zone saved.');
  const settings = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), FOCUS_STORAGE_KEY);
  assert.deepEqual(settings.zones.map(zone => [zone.name, zone.enabled]), [['Home', true], ['Walked zone', false]]);
  assert.equal(settings.zones[1].vertices.length, 4);
});
