import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';
import catalog from '../shared/analytics-categories.json' with { type: 'json' };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://office-analytics.invalid', TOKEN = 'synthetic-office-audit';
const days = Array.from({ length: 30 }, (_, index) => new Date(Date.UTC(2026, 9, 8) - (29 - index) * 86400000).toISOString().slice(0, 10));
function report(empty = false) {
  return { available: true, mode: 'aggregate', daily: days.map(day => ({ day })),
    categories: Object.values(catalog).map(meta => {
      const views = empty ? 0 : meta.category === 'home' ? 3 : meta.category === 'app_feed' ? 4 : meta.category === 'command_center_accounts' ? 2 : 0;
      return { ...meta, today: views, last7: views, last30: views, errors: { today: 0, last7: 0, last30: 0 }, daily: days.map(day => ({ day, views: day === days.at(-1) ? views : 0, errors: 0 })) };
    }), performance: { byCode: [] }, storage: { connected: true, status: 'ready', pendingEvents: 0, collector: { rateLimited: 0, writeFailures: 0 } }, service: { total: 0, since: '2026-10-08T00:00:00Z', responses: [] } };
}
const server = await createServer({ root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify(API), 'import.meta.env.VITE_PIPELINE_API_URL': JSON.stringify(API) },
  server: { host: '127.0.0.1', port: 5273, strictPort: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ channel: 'msedge' });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let mode = 'normal', held = null;
    await page.route(`${API}/**`, async route => {
      const req = route.request(), url = new URL(req.url());
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-office-token,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (req.headers()['x-office-token'] !== TOKEN) return route.fulfill({ status: 401, headers, json: { error: 'Unauthorized' } });
      if (url.pathname === '/office/analytics/pageviews') {
        assert.equal(req.headers()['x-office-token'], TOKEN);
        if (mode === 'hold') { held = route; return; }
        if (mode === 'error') return route.fulfill({ status: 503, headers, json: { error: 'Synthetic storage outage' } });
        if (mode === 'unauthorized') return route.fulfill({ status: 401, headers, json: { error: 'Unauthorized' } });
        return route.fulfill({ headers, json: report(mode === 'empty') });
      }
      if (url.pathname === '/office/users') return route.fulfill({ headers, json: { available: true, recent: [], total: 0, pagination: { total: 0, pages: 1, page: 1 }, signupRequests: { available: true, outcomes: [] }, email: { available: true } } });
      if (url.pathname.endsWith('/stream')) return route.fulfill({ headers, contentType: 'text/event-stream', body: 'data: {"backlog":[]}\n\n' });
      return route.fulfill({ headers, json: { ok: true, server: {}, agents: {}, users: [], records: [], cache: {} } });
    });
    await page.goto(`${server.resolvedUrls.local[0]}#analytics`);
    await page.getByLabel('Access token', { exact: true }).fill(TOKEN);
    await page.getByRole('button', { name: 'Unlock Office', exact: true }).click();
    const dashboard = page.locator('.office-analytics');
    const table = dashboard.getByRole('region', { name: 'Category activity table', exact: true });
    await table.waitFor();
    assert.equal(await table.locator('tbody tr').count(), Object.keys(catalog).length);
    const metric = label => dashboard.locator('.office-analytics-metrics > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');
    assert.equal(await metric('Page / screen views').innerText(), '7');
    assert.equal(await metric('Tab opens').innerText(), '2');
    await dashboard.getByLabel('Platform', { exact: true }).selectOption('mobile');
    assert.equal(await metric('Page / screen views').innerText(), '4');
    await dashboard.getByLabel('Category', { exact: true }).selectOption('app_feed');
    assert.equal(await table.locator('tbody tr').count(), 1);
    await dashboard.getByLabel('Period', { exact: true }).selectOption('custom');
    await dashboard.getByLabel('To (UTC)', { exact: true }).fill('2026-10-07');
    assert.equal(await metric('Page / screen views').innerText(), '0');
    await dashboard.getByLabel('Period', { exact: true }).selectOption('30');
    await dashboard.getByLabel('Platform', { exact: true }).selectOption('all');
    await dashboard.getByLabel('Find a category', { exact: true }).fill('maps');
    assert.equal(await table.locator('tbody tr').count(), 1);
    assert.ok((await table.innerText()).includes('0'));
    await dashboard.getByLabel('Find a category', { exact: true }).fill('');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    mode = 'error'; await dashboard.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
    await dashboard.getByRole('alert').filter({ hasText: 'Synthetic storage outage' }).waitFor();
    assert.equal(await metric('Page / screen views').innerText(), '7');
    mode = 'normal'; await dashboard.getByRole('button', { name: 'Retry analytics', exact: true }).click();
    await dashboard.getByRole('button', { name: 'Refresh analytics', exact: true }).waitFor();
    mode = 'hold'; await dashboard.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
    for (let i = 0; i < 100 && !held; i++) await page.waitForTimeout(10);
    assert.ok(held);
    mode = 'empty'; await page.evaluate(() => window.dispatchEvent(new Event('office-token-changed')));
    await dashboard.getByRole('button', { name: 'Refresh analytics', exact: true }).waitFor();
    await held.fulfill({ json: report(), headers: { 'Access-Control-Allow-Origin': '*' } }).catch(() => {});
    assert.equal(await metric('Page / screen views').innerText(), '0', 'Old credential request cannot restore stale data');
    assert.equal(await metric('Tab opens').innerText(), '0');
    assert.deepEqual(errors, []);
    console.log(`PASS Office analytics zero categories, filters, dates, errors, refresh and stale token request protection ${width}`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); }
