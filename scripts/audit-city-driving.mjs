import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const require = createRequire(import.meta.url);
require('../backend/generated-media');
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-ui/city-driving');
await fs.mkdir(output, { recursive: true });
const app = await createAppHarness();
app.seedUser(member('city-driving-audit', { plan: 'pro' }));
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5259, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
let browser;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined,
    ...(process.argv.includes('--software-gpu') ? { args: ['--use-angle=swiftshader'] } : {}) });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 600, hasTouch: width < 600, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const errors = [], forbiddenWrites = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
      if (/\/api\/.*(?:events|stream)/.test(url.pathname)) return route.abort();
      if (url.pathname === '/api/office/feed') return route.fulfill({ json: { posts: [], hasMore: false, nativeUficonnectIncluded: true } });
      if (route.request().method() !== 'GET' && /\/api\/(?:social|crosspost|billing|auth\/phone|auth\/email)/.test(url.pathname)) {
        forbiddenWrites.push(url.pathname);
        return route.fulfill({ status: 409, json: { error: 'Provider writes are disabled in this audit.' } });
      }
      return route.continue();
    });
    const scene = page.locator('.map-city-scene canvas');
    const snapshot = () => scene.evaluate(canvas => ({ ...canvas.dataset }));
    const waitForMatchingHud = () => page.waitForFunction(() => {
      const data = document.querySelector('.map-city-scene canvas')?.dataset;
      const controls = document.querySelector('.map-drive-controls');
      const selector = controls?.querySelector('select');
      const destination = selector?.selectedOptions[0]?.textContent;
      const expected = { 'red-light': 'Waiting at traffic light', traffic: 'Following traffic', turning: 'Slowing for turn', paused: 'Drive paused' }[data?.driveStatus]
        || (data?.driveStatus === 'arrived' ? 'Arrived at ' : 'Driving to ') + destination;
      const signal = data?.driveStatus !== 'arrived' && ['red', 'yellow', 'green'].includes(data?.driveSignal) ? data.driveSignal : null;
      return controls?.querySelector('[role="status"]')?.textContent === expected
        && (controls.querySelector('.map-drive-signal')?.getAttribute('data-signal') || null) === signal;
    });
    try {
      await installAuditMember(page, app, 'city-driving-audit');
      await auditNavigate(page, base + 'maps');
      await page.getByRole('button', { name: 'Play animation', exact: true }).waitFor();
      await page.getByRole('combobox', { name: 'Rendering quality', exact: true }).selectOption('auto');
      await page.waitForFunction(() => Number(document.querySelector('.map-city-scene canvas')?.dataset.residentPopulation) > 42);
      assert.equal(await page.getByRole('button', { name: 'Exit drive mode', exact: true }).count(), 0,
        'Reduced motion never starts a drive automatically');
      const initial = await snapshot();
      assert.ok(Number(initial.residentPopulation) <= 1000, 'Decorative population remains bounded');
      assert.ok(Number(initial.trafficPopulation) > 0 && Number(initial.trafficPopulation) <= 500, 'Traffic uses a bounded scene population');
      assert.equal(Number(initial.trafficLights), 20, 'City and ramp junctions share working traffic signals');
      assert.equal(await page.getByRole('heading', { name: 'Map', exact: true }).count(), 1);
      const centered = await page.getByRole('heading', { name: 'Map', exact: true }).evaluate(element => getComputedStyle(element).textAlign);
      assert.equal(centered, 'center', 'Map title is centered');
      await page.waitForTimeout(250);
      assert.equal((await snapshot()).trafficTime, initial.trafficTime, 'Reduced motion freezes the idle traffic clock');

      assert.equal(await page.getByRole('button', { name: 'Night view', exact: true }).count(), 0);
      await page.evaluate(() => window.__ufiAppearance.setPreference('dark'));
      await page.waitForFunction(() => {
        const data = document.querySelector('.map-city-scene canvas')?.dataset;
        return data?.timeOfDay === 'night' && Number(data.trafficLights) > 0;
      });
      await scene.screenshot({ path: path.join(output, `night-city-${width}.png`) });
      await page.evaluate(() => window.__ufiAppearance.setPreference('light'));
      await page.waitForFunction(() => document.querySelector('.map-city-scene canvas')?.dataset.timeOfDay === 'day');
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.evaluate(() => window.__ufiAppearance.setPreference('system'));
      await page.waitForFunction(() => document.querySelector('.map-city-scene canvas')?.dataset.timeOfDay === 'night');
      await page.getByRole('button', { name: 'Drive mode', exact: true }).click();
      const drive = page.getByRole('group', { name: 'Drive between cities', exact: true });
      const destination = drive.getByRole('combobox', { name: 'Drive destination', exact: true });
      assert.equal(await destination.locator('option').count(), 18, 'Every city and both landmarks remain reachable');
      assert.equal(await page.getByRole('slider', { name: 'View altitude', exact: true }).isDisabled(), true);
      await scene.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const data = document.querySelector('.map-city-scene canvas')?.dataset;
        return Number(data?.driveProgress) > .005 && Number(data?.trafficTime) > 0;
      });
      assert.equal(await page.getByRole('button', { name: 'Play animation', exact: true }).count(), 1,
        'Starting a drive does not restart decorative animation');
      const moving = await snapshot();
      assert.ok(['driving', 'turning', 'traffic', 'red-light'].includes(moving.driveStatus));
      assert.ok(Number.isFinite(Number(moving.driveSpeed)) && Number(moving.driveSpeed) >= 0);
      assert.ok(await drive.getByRole('status').innerText(), 'Driving status is visible outside the canvas');
      await waitForMatchingHud();
      assert.match(await drive.locator('.map-drive-status small').innerText(), /Traffic simulation/,
        'Decorative traffic is described as a simulation');
      await page.evaluate(() => {
        window.__cityAuditHiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      const hidden = await snapshot();
      await page.waitForTimeout(350);
      const background = await snapshot();
      assert.equal(background.driveProgress, hidden.driveProgress, 'A hidden page stops the vehicle');
      assert.equal(background.trafficTime, hidden.trafficTime, 'A hidden page stops the shared traffic clock');
      const firstVisible = await page.evaluate(() => new Promise(resolve => {
        if (window.__cityAuditHiddenDescriptor) Object.defineProperty(document, 'hidden', window.__cityAuditHiddenDescriptor);
        else delete document.hidden;
        delete window.__cityAuditHiddenDescriptor;
        document.dispatchEvent(new Event('visibilitychange'));
        requestAnimationFrame(() => resolve({ ...document.querySelector('.map-city-scene canvas').dataset }));
      }));
      assert.ok(Number(firstVisible.trafficTime) - Number(hidden.trafficTime) <= .051,
        'Resuming a visible page never advances by hidden wall-clock time');
      await page.waitForFunction(previous => Number(document.querySelector('.map-city-scene canvas')?.dataset.trafficTime) > Number(previous), hidden.trafficTime);
      await drive.getByRole('button', { name: 'Pause drive', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.map-city-scene canvas')?.dataset.driveStatus === 'paused');
      const paused = await snapshot();
      await waitForMatchingHud();
      assert.equal(await drive.getByRole('status').innerText(), 'Drive paused');
      await page.waitForTimeout(300);
      const still = await snapshot();
      assert.equal(still.driveProgress, paused.driveProgress, 'Pause immediately stops route progress');
      assert.equal(Number(still.driveSpeed), 0, 'Paused status reports zero speed');
      assert.equal(still.trafficTime, paused.trafficTime, 'Paused ambient animation and paused drive stop the traffic clock');
      await page.screenshot({ path: path.join(output, `drive-paused-${width}.png`), fullPage: true });

      await drive.getByRole('button', { name: 'Resume drive', exact: true }).click();
      await scene.scrollIntoViewIfNeeded();
      await page.waitForFunction(previous => Number(document.querySelector('.map-city-scene canvas')?.dataset.driveProgress) > Number(previous), paused.driveProgress);
      for (const id of ['airport', 'shopping']) {
        await destination.selectOption(id);
        await scene.scrollIntoViewIfNeeded();
        await page.waitForFunction(expected => {
          const data = document.querySelector('.map-city-scene canvas')?.dataset;
          return data?.driveDestination === expected && Number(data.driveProgress) > 0;
        }, id);
        assert.equal(await destination.inputValue(), id, 'Changing destination updates the active route');
        await waitForMatchingHud();
        assert.equal(await drive.getByRole('button', { name: 'Resume drive', exact: true }).count(), 0, 'New routes clear the prior pause state');
      }
      await page.getByRole('button', { name: 'Exit drive mode', exact: true }).click();
      await drive.waitFor({ state: 'hidden' });
      assert.equal(await page.getByRole('slider', { name: 'View altitude', exact: true }).isEnabled(), true);
      await scene.scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      const stoppedTime = (await snapshot()).trafficTime;
      await page.waitForTimeout(300);
      assert.equal((await snapshot()).trafficTime, stoppedTime, 'Exiting an explicit drive restores paused traffic');
      assert.equal(await page.getByRole('button', { name: 'Play animation', exact: true }).count(), 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Driving controls fit desktop and mobile');
      assert.deepEqual(forbiddenWrites, []);
      assert.deepEqual(errors, []);
      console.log(`PASS city driving ${width}px: bounded decorative residents, lights at night, reduced motion, real drive/pause/resume/reroute and controls`);
    } catch (error) {
      console.error('City diagnostics:', await snapshot().catch(() => null));
      await page.screenshot({ path: path.join(output, `failure-${width}.png`), fullPage: true }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
