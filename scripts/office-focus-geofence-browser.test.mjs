import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
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
const phonePath = '/__focus-phone-sync';
const fixture = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body { margin: 12px; background: #111220; font: 15px system-ui; }</style>
<div id="root"></div><script type="module">
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import FocusStudio from '/src/FocusStudio.jsx';
const phone = new URLSearchParams(location.search).has('phone') ? {
  authScope: 'test-office-account',
  focusRequest: (path, { method, body, signal } = {}) => fetch('${phonePath}' + path, {
    method, signal, body: body ? JSON.stringify(body) : undefined,
  }).then(response => response.json()),
} : {};
function Fixture() {
  const [active, setActive] = useState(true);
  window.setFocusOpen = setActive;
  const liveTransport = {
    url: '${livePath}',
    request: (url, options) => fetch(url, { ...options, headers: { ...options?.headers, 'x-office-token': '${officeToken}' } }),
  };
  return React.createElement(FocusStudio, { active, liveTransport, onOpen: () => setActive(true),
    onQuietChange: value => { window.focusQuiet = value; }, ...phone });
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

async function openStudio(t, { settings = {}, mock = true, blocked = false, width = 1200, disableWebGL = false, phoneSync, deviceMocks = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    ...(mock ? {} : { permissions: ['geolocation'], geolocation: point(0) }),
  });
  t.after(() => context.close());
  await context.route('https://tile.openstreetmap.org/**', route => route.abort());
  if (phoneSync) await context.route(`**${phonePath}**`, phoneSync);
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.addInitScript(({ key, settings, mock, disableWebGL, deviceMocks }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(settings));
    if (disableWebGL) {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...options) {
        return kind.startsWith('webgl') ? null : getContext.call(this, kind, ...options);
      };
    }
    if (!mock) return;
    if (deviceMocks) {
      let wakeCount = 0, releaseCount = 0, performanceCallback;
      const permissionStates = new Map(['geolocation', 'camera', 'microphone', 'notifications'].map(name =>
        [name, Object.assign(new EventTarget(), { state: name === 'geolocation' ? 'granted' : 'prompt' })]));
      Object.defineProperty(navigator, 'permissions', { value: { query: async ({ name }) => permissionStates.get(name) } });
      Object.defineProperty(navigator, 'connection', { value: Object.assign(new EventTarget(), { effectiveType: '4g', downlink: 12, rtt: 80, saveData: false }) });
      Object.defineProperty(navigator, 'getBattery', { value: async () => Object.assign(new EventTarget(), { level: 0.42, charging: true }) });
      Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => {
        wakeCount++;
        const lock = Object.assign(new EventTarget(), { released: false });
        lock.release = async () => { lock.released = true; releaseCount++; lock.dispatchEvent(new Event('release')); };
        return lock;
      } } });
      window.PerformanceObserver = class {
        static supportedEntryTypes = ['longtask'];
        constructor(callback) { this.callback = callback; }
        observe() { performanceCallback = this.callback; }
        disconnect() { if (performanceCallback === this.callback) performanceCallback = null; }
      };
      window.deviceTest = {
        permission(name, state) { const status = permissionStates.get(name); status.state = state; status.dispatchEvent(new Event('change')); },
        performance(durations) { performanceCallback?.({ getEntries: () => durations.map(duration => ({ duration })) }); },
        wakeCount: () => wakeCount, releaseCount: () => releaseCount,
      };
    }
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
      fail(code, fromProbe = false) {
        const callbacks = fromProbe ? probe : watchers.get(activeWatch());
        if (fromProbe) probe = undefined;
        callbacks.fail({ code });
      },
      visibility(value) { hidden = value; document.dispatchEvent(new Event('visibilitychange')); },
      activeWatch,
      options: () => watchers.get(activeWatch())?.options,
      hasProbe: () => Boolean(probe),
      count: () => runningWatches.size,
    };
  }, { key: FOCUS_STORAGE_KEY, settings: { zones: [home], ...settings }, mock, disableWebGL, deviceMocks });
  if (mock) {
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(new Date(+clockStart + 1000));
  }
  const query = new URLSearchParams();
  if (blocked) query.set('blocked', '1');
  if (phoneSync) query.set('phone', '1');
  await page.goto(`${origin}${fixturePath}?${query}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
  await page.clock.fastForward(4000);
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
  await page.clock.fastForward(4000);
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

test('grid visitor cards show authorized device evidence, directions and revocation at phone width', async t => {
  const publisher = await openStudio(t, { width: 390, disableWebGL: true });
  const viewer = await openStudio(t, { width: 390, disableWebGL: true });
  for (const page of [publisher, viewer]) await button(page, 'Live Maps').click();
  await publisher.getByLabel('Your sharing label').fill('My delivery phone');
  await button(publisher, 'Start live GPS').click();
  await fix(publisher, { latitude: 0.0005, longitude: 0.0005, accuracy: 2, speed: 8 });
  await button(publisher, 'Share my GPS with Office').click();
  await publisher.getByText('Waiting for GPS', { exact: true }).waitFor();
  await publisher.clock.fastForward(3500);
  await publisher.getByText('Sharing live GPS', { exact: true }).waitFor();
  await button(viewer, 'Grid').click();
  await viewer.getByLabel('Grid spacing').selectOption('detail');
  await button(viewer, 'Load shared grid visitors').click();
  const visitors = viewer.getByRole('list', { name: 'Shared grid visitors' });
  await visitors.getByRole('heading', { name: 'My delivery phone' }).waitFor();
  await visitors.getByText('±2 m', { exact: true }).waitFor();
  await visitors.getByText(/Identity unverified/).waitFor();
  const link = new URL(await visitors.getByRole('link', { name: 'Directions to shared location' }).getAttribute('href'));
  assert.equal(link.origin, 'https://www.google.com');
  assert.equal(link.searchParams.get('destination'), '0.0005,0.0005');
  assert.equal(link.searchParams.get('api'), '1');
  await visitors.getByRole('button', { name: 'View location on map' }).click();
  assert.ok(await viewer.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await visitors.getByRole('button', { name: 'Follow shared device' }).click();
  await viewer.getByText('GPS live', { exact: true }).waitFor();
  await button(publisher, 'Stop sharing my GPS').click();
  await viewer.clock.fastForward(4000);
  await viewer.getByText('Waiting for shared GPS', { exact: true }).waitFor();
  assert.equal(await visitors.getByRole('listitem').count(), 0);
});

test('shared GPS survives a transient HTTP failure without becoming fresh again and expires offline', async t => {
  const viewer = await openStudio(t, { disableWebGL: true });
  let status = 200;
  await viewer.route(`**${livePath}`, route => status === 200 ? route.fulfill({ json: { sources: [{
    id: 'shared-phone', name: 'Shared test phone', kind: 'phone', observedAt: 1000,
    fix: { latitude: 0.0005, longitude: 0.0005, accuracy: 2, age: 0 },
  }] } }) : route.fulfill({ status, json: { error: 'Synthetic failure' } }));
  await button(viewer, 'Live Maps').click();
  await button(viewer, 'View shared devices').click();
  await viewer.getByLabel('Live tracking source').selectOption('shared-phone');
  await viewer.getByText('GPS live', { exact: true }).waitFor();
  status = 503;
  await viewer.clock.fastForward(4000);
  await viewer.getByText('Last shared GPS · connection delayed', { exact: true }).waitFor();
  assert.equal(await viewer.locator('.focus-ops-map .focus-globe-device').count(), 1);
  await viewer.clock.fastForward(MAX_FIX_AGE_MS);
  await viewer.getByText('Waiting for shared GPS', { exact: true }).waitFor();
  assert.equal(await viewer.locator('.focus-ops-map .focus-globe-device').count(), 0);
  status = 200;
  await viewer.evaluate(() => window.dispatchEvent(new Event('online')));
  await viewer.getByText('GPS live', { exact: true }).waitFor();
  status = 401;
  await viewer.clock.fastForward(4000);
  await viewer.getByText('Waiting for shared GPS', { exact: true }).waitFor();
  await viewer.getByRole('alert').filter({ hasText: 'HTTP 401' }).waitFor();
});

test('GPS jumps and imprecise samples do not replace accepted locations or create route distance', async t => {
  const page = await openStudio(t, { width: 390, disableWebGL: true });
  await button(page, 'Geo Tracking').click();
  await button(page, 'Start Geo Tracking').click();
  await page.getByText('Routes and trip history', { exact: true }).click();
  await button(page, 'Record route').click();
  await fix(page, point(0, 2));
  await page.clock.fastForward(5000);
  await fix(page, point(1, 2));
  await page.getByText('GPS jump rejected. Waiting for a consistent reading.', { exact: true }).waitFor();
  await page.locator('.focus-location-reading strong').filter({ hasText: '0.000000° N · 0.000000° E' }).waitFor();
  await textVisible(page, '1 samples · 0 waypoints');
  await page.clock.fastForward(1000);
  await fix(page, point(0, 500));
  await page.getByText(/GPS reading rejected: ±500 m/).waitFor();
  await page.clock.fastForward(1000);
  await fix(page, point(0.00001, 2));
  await textVisible(page, '1 samples · 0 waypoints');
  await page.locator('.focus-tracking-details summary').click();
  await page.getByRole('list', { name: 'Observed phone and tracking events' }).getByText('GPS_JUMP', { exact: true }).waitFor();
  await page.clock.fastForward(MAX_FIX_AGE_MS);
  assert.equal(await page.locator('.focus-tracking-map .focus-globe-device').count(), 0);
});

test('phone diagnostics observe permission changes, release wake locks and recover hung GPS probes', async t => {
  const page = await openStudio(t, { width: 390, disableWebGL: true, deviceMocks: true });
  await button(page, 'Geo Tracking').click();
  await button(page, 'Start Geo Tracking').click();
  await fix(page, point(0, 2));
  await page.locator('.focus-tracking-details summary').click();
  await page.getByRole('checkbox', { name: 'Keep screen awake while tracking' }).check();
  await page.waitForFunction(() => window.deviceTest.wakeCount() === 1);
  await page.locator('.focus-tracking-details').getByText('Active', { exact: true }).waitFor();
  await page.clock.fastForward(14000);
  await button(page, 'Refresh live location').click();
  await page.waitForFunction(() => window.focusTest.hasProbe());
  await fix(page, point(0.00001, 2), { fromProbe: true });
  await page.getByText('0.000000° N · 0.000010° E', { exact: true }).waitFor();
  await page.evaluate(() => window.focusTest.visibility(true));
  await page.waitForFunction(() => window.deviceTest.releaseCount() === 1);
  await page.evaluate(() => window.focusTest.visibility(false));
  await page.waitForFunction(() => window.deviceTest.wakeCount() === 2);
  await page.evaluate(() => window.deviceTest.permission('geolocation', 'denied'));
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await page.getByRole('alert').filter({ hasText: 'Location access is blocked' }).waitFor();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagnostic report', exact: true }).click();
  const report = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
  assert.equal(report.permissions.geolocation, 'denied');
  assert.ok(!JSON.stringify(report).includes('latitude'));
  assert.ok(report.events.some(event => event.code === 'GPS_PERMISSION_DENIED'));
});

test('car and computer focus suppress automatic actions and notifications while diagnostics stay available', async t => {
  const page = await openStudio(t, { width: 390, disableWebGL: true, deviceMocks: true,
    settings: { fence: { seconds: 2, exit: 'resetTimer', notify: true } } });
  await page.evaluate(() => {
    window.syntheticNotifications = 0;
    class Notice { static permission = 'granted'; constructor() { window.syntheticNotifications++; } }
    window.Notification = Notice;
  });
  await button(page, 'Start Geofencing').click();
  await confirm(page, point(0));
  await button(page, 'Session').click();
  await button(page, 'Start focus').click();
  const desk = page.getByRole('region', { name: 'Phone, car & computer diagnostics' });
  await desk.getByRole('button', { name: 'Enable all available diagnostics' }).click();
  await desk.getByText('42% · Charging', { exact: true }).waitFor();
  await desk.getByText('4g', { exact: true }).waitFor();
  await page.evaluate(() => window.deviceTest.performance([20, 80, 120]));
  await desk.getByText('2 observed · longest 120 ms', { exact: true }).waitFor();
  await button(page, 'Start driving focus').click();
  await page.getByRole('heading', { name: 'Driving focus', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.focusQuiet), true, 'the Office shell must mute audio too');
  assert.equal(await page.locator('.focus-studio-nav').count(), 0);
  await page.clock.fastForward(2000);
  await confirm(page, outside);
  assert.equal(await page.evaluate(() => window.syntheticNotifications), 0);
  await button(page, 'End distraction-free focus').click();
  assert.equal(await page.evaluate(() => window.focusQuiet), false, 'the saved quiet setting is restored');
  assert.ok(await page.getByRole('timer').textContent() !== '25:00', 'a suppressed boundary rule must not reset the work timer');
  await button(page, 'Geofencing').click();
  await page.getByText('Distraction-free focus — action suppressed', { exact: true }).waitFor();
  await button(page, 'Session').click();
  await button(page, 'Start computer focus').click();
  await page.getByRole('heading', { name: 'Computer focus', exact: true }).waitFor();
  await page.getByText('Diagnostics & controls on demand', { exact: true }).click();
  await page.locator('.focus-tracking-details summary').click();
  const download = page.waitForEvent('download');
  await button(page, 'Download diagnostic report').click();
  assert.equal((await download).suggestedFilename(), 'office-diagnostics.json');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await button(page, 'End distraction-free focus').click();
});

test('Drop & Track follows a moving device, saves pins without pausing and bypasses automatic stop limits', async t => {
  const page = await openStudio(t, { width: 390, disableWebGL: true,
    settings: { tracking: { stopMinutes: 1, stopMeters: 20, minSeconds: 1, minMeters: 2 } } });
  await button(page, 'Geo Tracking').click();
  await button(page, 'Drop & Track').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  const watch = await page.evaluate(() => window.focusTest.activeWatch());
  assert.equal(await page.evaluate(() => window.focusTest.options().enableHighAccuracy), true);
  assert.equal(await page.locator('.focus-saved-pin').count(), 0, 'no pin is invented before GPS arrives');
  await fix(page, point(0, 2));
  await textVisible(page, 'Pin dropped. Your live route continues while you move.');
  assert.equal(await page.locator('.focus-saved-pin').count(), 1);
  await page.getByText('Routes and trip history', { exact: true }).click();
  await button(page, 'Stop recording route').waitFor();
  const follow = page.getByRole('button', { name: 'Follow location', exact: true });
  assert.equal(await follow.getAttribute('aria-pressed'), 'true');
  await page.clock.fastForward(5000);
  await fix(page, point(0.0005, 2));
  await textVisible(page, 'Receiving live location');
  await button(page, 'Drop at my location').click();
  assert.equal(await page.locator('.focus-saved-pin').count(), 2);
  assert.equal(await page.evaluate(() => window.focusTest.activeWatch()), watch);
  assert.equal(await follow.getAttribute('aria-pressed'), 'true', 'dropping a pin must not disable map following');
  await page.clock.fastForward(5000);
  await fix(page, point(0.001, 2));
  await button(page, 'Drop & Track').click();
  assert.equal(await page.locator('.focus-saved-pin').count(), 3);
  await textVisible(page, '3 samples · 2 waypoints');
  await page.evaluate(() => window.setFocusOpen(false));
  assert.equal(await page.evaluate(() => window.focusTest.count()), 1, 'continuous mode stays active across Office views');
  await page.clock.fastForward(5000);
  await fix(page, point(0.0015, 2));
  await page.evaluate(() => window.setFocusOpen(true));
  await textVisible(page, 'Receiving live location');
  await page.clock.fastForward(65000);
  await fix(page, point(0.002, 2));
  await button(page, 'Continuous moving mode on').waitFor();
  await button(page, 'Stop Geo Tracking').waitFor();
  assert.equal(await page.evaluate(() => window.focusTest.count()), 1, 'configured time and distance stops do not stop moving mode');
  await button(page, 'Pause Geo Tracking').click();
  await page.waitForFunction(() => window.focusTest.count() === 0);
  assert.equal(await follow.getAttribute('aria-pressed'), 'true', 'pausing must not change map following for an unchanged saved pin');
  await button(page, 'Resume Geo Tracking').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await page.clock.fastForward(1000);
  await fix(page, point(0.0025, 2));
  assert.equal(await follow.getAttribute('aria-pressed'), 'true', 'resumed GPS must keep following the moving device');
  await button(page, 'Stop Geo Tracking').click();
  await page.waitForFunction(() => window.focusTest.count() === 0);
});

test('tracking accuracy remains independent of geofencing and expired accepted markers stay hidden', async t => {
  const page = await openStudio(t, { disableWebGL: true,
    settings: { tracking: { profile: 'precise' }, fence: { profile: 'balanced', seconds: 2, exit: 'status' } } });
  await button(page, 'Start Geofencing').click();
  await button(page, 'Geo Tracking').click();
  await button(page, 'Start Geo Tracking').click();
  await confirm(page, point(0, 100));
  await page.getByText(/GPS reading rejected: ±100 m/).waitFor();
  await button(page, 'Geofencing').click();
  await monitorStatus(page, 'Inside the monitored area');
  await page.clock.fastForward(1);
  await fix(page, point(0, 2));
  await page.clock.fastForward(1000);
  await confirm(page, point(0.01, 100));
  await textVisible(page, 'You left Home.');
  for (let index = 0; index < 3; index++) {
    await page.clock.fastForward(10000);
    await fix(page, point(0.01, 100));
  }
  await monitorStatus(page, 'Outside the monitored area');
  await button(page, 'Geo Tracking').click();
  assert.equal(await page.locator('.focus-tracking-map .focus-globe-device').count(), 0,
    'fresh rejected tracking samples must not keep the last accepted marker alive');
  assert.equal(await page.locator('.focus-location-reading').count(), 0);
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
  const timestamp = await live.locator('.focus-location-reading time').getAttribute('datetime');
  await page.clock.fastForward(1000);
  await fix(page, point(-122.419316, 12));
  await textVisible(page, '0.000000° N · 122.419316° W');
  assert.match(await live.locator('small').first().textContent(), /Device accuracy ±12 m/);
  assert.ok(await live.locator('.focus-location-reading time').getAttribute('datetime') > timestamp);
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
  assert.equal(await live.locator('.focus-location-reading time').count(), 0);
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
  await page.clock.fastForward(15000);
  await confirm(page, outside);
  assert.deepEqual(await crossingNames(page), []);
  await setOpen(true);
  await textVisible(page, '0.000000° N · 0.010000° E');
  await trackBackground.uncheck();

  await button(page, 'Geofencing').click();
  await fenceBackground.check();
  await page.clock.fastForward(15000);
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

test('Office reviews phone rules and takes over the final timer state when the phone stops', async t => {
  const zones = [{ ...home, radius: 1500 }, { ...work, radius: 1500 }];
  const snapshot = { ownerId: 'test-owner', revision: 1, config: { zones }, zoneReviewRequired: true,
    session: {}, phone: { id: 'phone', platform: 'ios', status: 'paused', seenAt: +clockStart,
      scopes: { zones: false, precision: 'approximate' }, registered: [], appliedRevision: null } };
  let saved;
  const page = await openStudio(t, {
    settings: { zones, fence: { scope: 'all', combination: 'every', duringFocus: true, exit: 'stopTracking' } },
    phoneSync: async route => {
      if (route.request().method() === 'PUT') {
        saved = route.request().postDataJSON();
        Object.assign(snapshot, { revision: 2, config: saved.config, zoneReviewRequired: false });
        snapshot.phone.scopes.zones = true;
        snapshot.phone.status = 'monitoring';
      }
      await route.fulfill({ json: snapshot });
    },
  });
  await textVisible(page, 'Phone geofencing is paused. Review and save your zones to confirm their rules.');
  assert.equal(await button(page, 'Start Geofencing').isEnabled(), true);
  await button(page, 'Review zone changes').click();
  await textVisible(page, 'Actions run during an active shared work timer.');
  await button(page, 'Save phone configuration').click();
  await page.getByText('Monitoring uses the paired phone', { exact: true }).waitFor();
  assert.equal(saved.revision, 1);
  assert.equal(saved.config.fence.combination, 'every');
  assert.equal(saved.config.fence.duringFocus, true);
  assert.equal(saved.config.fence.exit, 'stopTracking');

  const now = await page.evaluate(() => Date.now());
  snapshot.session = { started: true, remaining: 1500, deadline: now + 1_500_000 };
  snapshot.phone.scopes.zones = false;
  snapshot.phone.status = 'pending';
  await button(page, 'Refresh phone status').click();
  await button(page, 'Start Geofencing').click();
  await monitorStatus(page, 'Waiting for your device’s location');
  assert.equal(await page.evaluate(() => window.focusTest.count()), 1);
  await button(page, 'Session').click();
  await button(page, 'Pause focus').click();
  await button(page, 'Geofencing').click();
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith(phonePath) && response.ok()),
    button(page, 'Refresh phone status').click(),
  ]);
  await button(page, 'Session').click();
  await button(page, 'Resume focus').waitFor();
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

test('Focus saves multiple pin radii and activates a pin only on request', async t => {
  const page = await openStudio(t, { width: 390, disableWebGL: true, settings: { fence: { seconds: 2 } } });
  await button(page, 'Session').click();
  await button(page, 'Drop a pin').click();
  const pick = button(page, 'Drop pin on map');
  const map = page.locator('.focus-tracking-map');
  const marker = map.locator('[data-pin="drop"]');
  const gps = button(page, 'Drop at my location');
  assert.equal(await pick.getAttribute('aria-pressed'), 'true');
  assert.equal(await pick.evaluate(element => document.activeElement === element), true);

  await gps.click();
  await page.waitForFunction(() => window.focusTest.hasProbe());
  await page.evaluate(() => window.focusTest.fail(1, true));
  await map.getByRole('alert').filter({ hasText: 'Location access is blocked' }).waitFor();
  assert.equal(await marker.count(), 0);

  await gps.click();
  await page.waitForFunction(() => window.focusTest.hasProbe());
  await fix(page, { latitude: 37.774929, longitude: -122.419416, accuracy: 4 }, { fromProbe: true });
  await page.getByText('Saved pins (1)', { exact: true }).waitFor();
  await marker.first().waitFor({ state: 'attached' });
  const surface = map.getByRole('group', { name: /^Interactive world map/ });
  const { width, height } = await surface.boundingBox();
  await surface.click({ position: { x: width / 2 + 20, y: height / 2 } });
  await page.getByText('Saved pins (2)', { exact: true }).waitFor();

  await gps.click();
  await page.waitForFunction(() => window.focusTest.hasProbe());
  await map.getByText('Enter coordinates', { exact: true }).click();
  await map.getByLabel('Latitude', { exact: true }).fill('40.7128');
  await map.getByLabel('Longitude', { exact: true }).fill('-74.006');
  await button(page, 'Place pin').click();
  await fix(page, point(1), { fromProbe: true });
  const savedPins = map.getByText('Saved pins (3)', { exact: true });
  await savedPins.waitFor();
  await savedPins.click();
  const third = map.getByRole('group', { name: 'Pin 3', exact: true });
  await third.getByText('Edit pin', { exact: true }).click();
  await third.getByLabel('Pin name', { exact: true }).fill('Downtown');
  await third.getByLabel('Radius (meters)', { exact: true }).fill('400');
  await button(third, 'Save pin').click();
  const pin = map.getByRole('group', { name: 'Downtown', exact: true });
  await textVisible(pin, 'Pin saved.');
  assert.equal(await page.evaluate(() => window.focusTest.count()), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

  await page.reload();
  await button(page, 'Geo Tracking').press('Enter');
  await savedPins.click();
  await pin.getByText('400 m · 40.712800° N · 74.006000° W', { exact: true }).waitFor();
  await marker.first().waitFor({ state: 'attached' });
  await button(page, 'Flat map').click();
  await marker.first().waitFor({ state: 'attached' });
  await button(pin, 'Activate').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await button(pin, 'Deactivate').waitFor();
  await button(page, 'Start Geo Tracking').waitFor();
  await confirm(page, { latitude: 40.7128, longitude: -74.0025, accuracy: 2 });
  await button(page, 'Geofencing').press('Enter');
  await monitorStatus(page, 'Inside the monitored area');

  await button(page, 'Geo Tracking').press('Enter');
  await savedPins.click();
  await button(pin, 'Deactivate').click();
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await button(pin, 'Activate').waitFor();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).zones
    .some(zone => zone.name === 'Downtown' && zone.radius === 400 && !zone.enabled), FOCUS_STORAGE_KEY);
  await pin.getByText('Edit pin', { exact: true }).click();
  await button(pin, 'Remove pin').click();
  await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).zones.filter(zone => zone.pin).length === 2, FOCUS_STORAGE_KEY);
});

async function assertWalkFitsPhone(page, walk) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await walk.getByRole('button').evaluateAll(buttons => buttons.every(button => {
    const { left, right, height } = button.getBoundingClientRect();
    return left >= 0 && right <= innerWidth && height >= 44;
  })));
}

test('a phone waits for a precise route start and saves separate segments after a pause', async t => {
  const page = await openStudio(t, { width: 390, disableWebGL: true });
  await button(page, 'Commands').click();
  await page.getByRole('searchbox', { name: 'Search commands' }).fill('drop pin');
  await button(page, 'Walk a route').click();
  const walk = page.getByRole('region', { name: 'Walk a route' });
  const trackingMap = page.locator('.focus-tracking-map');
  await button(page, 'Drop start at my location').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  assert.deepEqual(await page.evaluate(() => window.focusTest.options()), {
    enableHighAccuracy: true, maximumAge: 0, timeout: 12000,
  });
  await fix(page, point(.0005, 80));
  await textVisible(walk, 'Waiting for precise GPS');
  assert.equal(await walk.locator('.focus-walk-pin').count(), 0);
  await assertWalkFitsPhone(page, walk);
  await fix(page, point(.0002, 25));
  await textVisible(walk, '0.000000° N · 0.000200° E');
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await button(page, 'Start Geo Tracking').click();
  await button(page, 'Start walk').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await fix(page, point(.0005, 80));
  await walk.getByText('Waiting for a more accurate GPS reading.', { exact: false }).waitFor();
  await page.clock.fastForward(1000);
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
  assert.equal(saved.points[0].longitude, 0);
  assert.deepEqual(saved.points.map(point => point.startsSegment), [true, false, true, false]);
  await button(page, 'Trip library').click();
  await trackingMap.getByRole('combobox', { name: /View trip/ }).selectOption(saved.id);
  await trackingMap.locator('.focus-globe-device title').filter({ hasText: 'Replay position' }).waitFor({ state: 'attached' });
});

test('a boundary gets a precise start, rejoins after GPS loss and saves an inactive geofence', async t => {
  const page = await openStudio(t, { width: 360, disableWebGL: true });
  await button(page, 'Walk a boundary').click();
  const walk = page.getByRole('region', { name: 'Walk a boundary' });
  await button(page, 'Drop start at my location').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await fix(page, point(.0005, 80));
  await page.evaluate(() => window.focusTest.fail(2));
  const oldest = await page.evaluate(age => Date.now() - age, MAX_FIX_AGE_MS);
  await fix(page, point(.0005), { timestamp: oldest });
  await textVisible(walk, 'Waiting for precise GPS');
  assert.equal(await walk.locator('.focus-walk-pin').count(), 0);
  await assertWalkFitsPhone(page, walk);
  await fix(page, point(0));
  await textVisible(walk, '0.000000° N · 0.000000° E');
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await button(page, 'Start walk').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  const samples = [point(0), point(.0004), { ...point(.0004), latitude: .0004 }, { ...point(0), latitude: .0004 }, point(0)];
  for (const reading of samples.slice(0, 2)) {
    await fix(page, reading);
    await page.clock.fastForward(3000);
  }
  await walk.getByText(/^2 points/).waitFor();
  await page.clock.fastForward(MAX_FIX_AGE_MS);
  await walk.getByRole('alert').filter({ hasText: 'The last location fix expired.' }).waitFor();
  await fix(page, samples[2]);
  await textVisible(walk, 'Return to the last recorded point to continue the boundary.');
  await walk.getByText(/^2 points/).waitFor();
  await page.clock.fastForward(3000);
  for (const reading of samples.slice(1)) {
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

test('walk start capture times out, cancels when hidden and respects an intentionally distant map pin', async t => {
  const page = await openStudio(t, { width: 320, disableWebGL: true });
  await button(page, 'Geo Tracking').click();
  await button(page, 'Walk a route').click();
  const walk = page.getByRole('region', { name: 'Walk a route' });
  const trackingMap = page.locator('.focus-tracking-map');
  const beginCapture = async () => {
    await button(walk, 'Drop start at my location').click();
    await page.waitForFunction(() => window.focusTest.count() === 1);
    return page.evaluate(() => window.focusTest.activeWatch());
  };

  const expired = await beginCapture();
  await fix(page, point(.0005, 80));
  await page.clock.fastForward(12000);
  await walk.getByRole('alert').filter({ hasText: 'GPS took too long.' }).waitFor();
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await fix(page, point(0), { watch: expired });
  assert.equal(await walk.locator('.focus-walk-pin').count(), 0);
  await assertWalkFitsPhone(page, walk);

  const interrupted = await beginCapture();
  await page.evaluate(() => window.focusTest.visibility(true));
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await page.evaluate(() => window.focusTest.visibility(false));
  await fix(page, point(0), { watch: interrupted });
  assert.equal(await walk.locator('.focus-walk-pin').count(), 0);

  const replaced = await beginCapture();
  await trackingMap.getByText('Enter coordinates', { exact: true }).click();
  await trackingMap.getByLabel('Latitude', { exact: true }).fill('0');
  await trackingMap.getByLabel('Longitude', { exact: true }).fill('0.0005');
  await button(page, 'Place pin').click();
  await page.waitForFunction(() => window.focusTest.count() === 0);
  await fix(page, point(0), { watch: replaced });
  await textVisible(walk, '0.000000° N · 0.000500° E');
  await button(walk, 'Start walk').click();
  await page.waitForFunction(() => window.focusTest.count() === 1);
  await fix(page, point(0));
  await textVisible(walk, 'Walk to the dropped pin, or start from your GPS location.');
  assert.ok(await button(walk, 'Finish walk').isDisabled());
  await page.clock.fastForward(3000);
  await fix(page, point(.0005));
  await walk.getByText(/^1 point/).waitFor();
});
