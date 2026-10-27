import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const officeRoot = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root: officeRoot, server: { host: '127.0.0.1', port: 4178, strictPort: true } });
let browser;
const checks = [], pageErrors = [];
try {
  await server.listen();
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}), headless: true });
  const page = await browser.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.clock.install({ time: new Date('2026-10-27T22:00:00Z') });
  await page.goto('http://127.0.0.1:4178/tests/analytics-refresh.html');
  const metrics = () => page.locator('.office-analytics-metrics > div').evaluateAll(nodes => Object.fromEntries(nodes.map(node => [node.querySelector('dt').textContent, node.querySelector('dd').textContent])));
  const waitMetric = (label, value) => page.waitForFunction(([name, expected]) => [...document.querySelectorAll('.office-analytics-metrics > div')].some(node => node.querySelector('dt').textContent === name && node.querySelector('dd').textContent === expected), [label, String(value)]);
  const settle = () => page.waitForFunction(() => !document.querySelector('.office-analytics-header button')?.disabled);
  const patch = values => page.evaluate(values => Object.assign(window.analyticsFixture, values), values);
  const reads = () => page.evaluate(() => window.analyticsFixture.reads);
  await waitMetric('Page / screen views', 45);
  await page.getByLabel('Period', { exact: true }).selectOption('1');
  assert.equal((await metrics())['Tab opens'], '99');
  assert.match(await page.getByRole('region', { name: 'Analytics freshness' }).innerText(), /Database counts verified/);
  checks.push('Today shows 45 page/screen views and 99 tab opens separately');

  await patch({ home: 34, tabs: 101 });
  await page.clock.fastForward(30_000); await waitMetric('Page / screen views', 46);
  assert.equal((await metrics())['Tab opens'], '101');
  assert.equal(await page.getByLabel('Period', { exact: true }).inputValue(), '1');
  await page.getByLabel('Category', { exact: true }).selectOption('home');
  await patch({ home: 35 }); await page.clock.fastForward(30_000); await waitMetric('Page / screen views', 35);
  assert.equal(await page.getByLabel('Category', { exact: true }).inputValue(), 'home');
  checks.push('30-second updates change counts and preserve date/category filters');

  const lastSuccess = await page.getByRole('region', { name: 'Analytics freshness' }).locator('time').first().getAttribute('datetime');
  await patch({ mode: 'failure' }); await page.clock.fastForward(30_000);
  await page.getByRole('alert').filter({ hasText: 'Fixture storage unavailable.' }).waitFor();
  assert.equal((await metrics())['Page / screen views'], '35');
  assert.equal(await page.getByRole('region', { name: 'Analytics freshness' }).locator('time').first().getAttribute('datetime'), lastSuccess);
  await patch({ mode: 'ok', home: 36 }); await page.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
  await waitMetric('Page / screen views', 36); assert.equal(await page.getByRole('alert').count(), 0);
  checks.push('failed reads retain prior counts and timestamp; manual recovery clears the error');

  await patch({ mode: 'hold', home: 37 }); await page.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
  const heldReads = await reads();
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await reads(), heldReads);
  await page.evaluate(() => window.analyticsFixture.pending.shift()()); await waitMetric('Page / screen views', 37);
  assert.equal(await page.evaluate(() => window.analyticsFixture.maxActive), 1);
  checks.push('simultaneous focus/online/visibility refreshes do not overlap');

  await patch({ mode: 'hold' }); await page.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
  await page.clock.fastForward(25_001); await page.getByRole('alert').filter({ hasText: 'timed out' }).waitFor();
  assert.equal((await metrics())['Page / screen views'], '37');
  await page.evaluate(() => { window.analyticsFixture.pending.shift()(); window.analyticsFixture.mode = 'ok'; window.analyticsFixture.home = 38; window.dispatchEvent(new Event('online')); });
  await waitMetric('Page / screen views', 38);
  checks.push('hung reads time out; reconnect refresh recovers');

  await patch({ hidden: true }); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const hiddenReads = await reads(); await page.clock.fastForward(95_000); assert.equal(await reads(), hiddenReads);
  assert.match(await page.getByRole('region', { name: 'Analytics freshness' }).innerText(), /Counts need a fresh check/);
  await patch({ hidden: false, home: 39 }); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await waitMetric('Page / screen views', 39);
  checks.push('hidden pages pause periodic reads; returning refreshes stale data');

  await patch({ mode: 'ignoreAbort', home: 500 }); await page.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
  await patch({ mode: 'ok', home: 40 }); await page.evaluate(() => window.dispatchEvent(new Event('office-token-changed')));
  await waitMetric('Page / screen views', 40);
  await page.evaluate(() => window.analyticsFixture.pending.shift()()); await settle();
  assert.equal((await metrics())['Page / screen views'], '40');
  checks.push('token changes discard the previous response even when abort is ignored');

  await patch({ verification: 'mismatch' }); await page.getByRole('button', { name: 'Refresh analytics', exact: true }).click(); await settle();
  assert.match(await page.getByRole('region', { name: 'Analytics freshness' }).innerText(), /Count verification needs attention/);
  assert.equal(await page.locator('.office-analytics-freshness.warning').count(), 1);
  await patch({ verification: 'verified', mode: 'unauthorized' }); await page.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Office access is required' }).waitFor();
  assert.equal(await page.locator('.office-analytics-metrics').count(), 0);
  checks.push('verification mismatch is visible and access failures clear protected counts');

  await patch({ mode: 'ok' }); await page.getByRole('button', { name: 'Retry analytics', exact: true }).click(); await waitMetric('Page / screen views', 40);
  await page.evaluate(() => window.unmountAnalyticsFixture()); const unmountedReads = await reads();
  await page.clock.fastForward(60_000); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal(await reads(), unmountedReads); assert.deepEqual(pageErrors, []);
  checks.push('unmount removes refresh timers/listeners; no browser JavaScript errors');
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
} finally { await browser?.close(); await server.close(); }
