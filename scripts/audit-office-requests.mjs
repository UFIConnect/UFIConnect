import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';
import catalog from '../shared/analytics-categories.json' with { type: 'json' };
import { fulfillOfficeWelcomeRead } from './office-welcome-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/office-request-audit');
const API = 'https://office-request-api.invalid', PIPELINE = 'https://office-request-pipeline.invalid';
const now = new Date().toISOString(), day = now.slice(0, 10), observations = [], errors = [], writes = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 150));
const status = role => ({ server: { serviceRole: role, uptime: 300000, db: 'connected' },
  feed: { postCount: role === 'api' ? 40000 : 200, cachedInMemory: role === 'api' ? 0 : 200, countBasis: role === 'api' ? 'stored' : 'memory', composition: [] },
  sources: { total: 0, workers: [], healthy: 0, degraded: 0, paused: 0 }, staging: { pendingCount: 0 },
  stability: { mode: 'normal' }, agents: {}, feedStorage: { cache: { count: 40000 } } });
const analytics = { available: true, mode: 'aggregate', range: { from: day, to: day }, daily: [{ day, views: 3 }],
  categories: Object.values(catalog).map(meta => ({ ...meta, total: 3, today: 3, daily: [{ day, views: 3, errors: 0 }] })),
  performance: { byCode: [], details: [] }, storage: { connected: true, status: 'ready', collector: {} },
  geography: { available: true, daily: [], cityHeadersEnabled: true }, service: { responses: [] } };
const server = await createServer({ root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envDir: false,
  cacheDir: path.join(root, '.cache/vite-office-requests'), define: { 'import.meta.env.VITE_API_URL': JSON.stringify(API), 'import.meta.env.VITE_PIPELINE_API_URL': JSON.stringify(PIPELINE) },
  server: { host: '127.0.0.1', port: 0, strictPort: false } });
let browser;
try {
  await server.listen(); await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  // Install before mounting so every application polling timer is controlled.
  await page.clock.install({ time: Date.now() });
  page.on('pageerror', error => errors.push(error.message));
  await page.route(/https:\/\/office-request-(?:api|pipeline)\.invalid\//, async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-office-token,content-type,accept', 'Access-Control-Allow-Methods': 'GET,OPTIONS' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.method() !== 'GET') { writes.push('unexpected write'); return route.abort(); }
    if (request.headers()['x-office-token'] !== 'request-audit-fixture') return route.fulfill({ status: 401, headers, json: {} });
    observations.push({ family: url.pathname === '/office/status' ? 'status' : url.pathname === '/office/agents' ? 'agents' : url.pathname.endsWith('/stream') ? 'stream' : 'section', role: url.origin === API ? 'api' : 'pipeline' });
    if (await fulfillOfficeWelcomeRead(route, url.pathname, headers)) return;
    if (url.pathname === '/office/status') return route.fulfill({ headers, json: status(url.origin === API ? 'api' : 'pipeline') });
    if (url.pathname === '/office/agents') return route.fulfill({ headers, json: { agents: {} } });
    if (url.pathname.endsWith('/stream')) return route.fulfill({ headers, contentType: 'text/event-stream', body: 'data: {"backlog":[]}\n\n' });
    if (url.pathname === '/office/analytics/pageviews') return route.fulfill({ headers, json: analytics });
    if (url.pathname === '/office/analytics/requests') return route.fulfill({ headers, json: { available: true, status: 'ready', daily: [], rows: [], totals: {}, coverage: {}, services: [] } });
    if (url.pathname === '/office/versions') return route.fulfill({ headers, json: { backend: { name: 'Fixture API', version: '1.0' }, services: [] } });
    return route.fulfill({ headers, json: { available: true, sources: [], items: [], history: [], attempts: [] } });
  });
  await page.goto(server.resolvedUrls.local[0] + '#analytics');
  await page.getByLabel('Access token', { exact: true }).fill('request-audit-fixture');
  await page.getByRole('button', { name: 'Unlock Office', exact: true }).click();
  await page.locator('.pip-dock-floating .pip-dock-panel').waitFor();
  await page.getByRole('button', { name: 'Continue with text', exact: true }).click();
  await page.getByRole('button', { name: 'Minimize Pip', exact: true }).click();
  await page.locator('main[data-office-section="analytics"]').waitFor(); await settle();
  let marker = observations.length;
  await page.clock.runFor(31000); await settle();
  const analyticsWindow = observations.slice(marker);
  assert.equal(analyticsWindow.filter(item => ['status', 'agents', 'stream'].includes(item.family)).length, 0, 'Analytics never polls unused global telemetry');
  marker = observations.length;
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(61000); await settle();
  assert.equal(observations.length, marker, 'hidden Analytics sends no polling requests');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(100); await settle();
  await page.getByRole('tab', { name: 'API requests', exact: true }).click();
  await page.getByRole('heading', { name: 'This Office session', exact: true }).waitFor();
  const beforeObservation = observations.length;
  await page.clock.runFor(2000); await settle();
  assert.equal(observations.length, beforeObservation, 'reading session diagnostics does not create observer requests');
  assert.doesNotMatch(await page.locator('.office-request-diagnostics').innerText(), /request-audit-fixture|office-request-api|\/office\//);
  await page.screenshot({ path: path.join(output, 'request-diagnostics-1440.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'request metrics fit mobile width');
  await page.screenshot({ path: path.join(output, 'request-diagnostics-390.png'), fullPage: true });
  await page.evaluate(() => { location.hash = '#pipeline'; });
  await page.locator('main[data-office-section="pipeline"]').waitFor(); await page.clock.runFor(100); await settle();
  assert.ok(observations.some(item => item.family === 'status' && item.role === 'pipeline'), 'Pipeline data stays accessible');
  assert.deepEqual(writes, [], 'request inspection and navigation never issue writes');
  assert.deepEqual(errors, [], 'request audit has no browser errors');
  const report = { checks: ['unused telemetry absent on Analytics', 'hidden polling paused', 'visibility resumes active data', 'diagnostics do not poll', 'fixed dimensions only', 'mobile layout', 'Pipeline remains accessible', 'no writes', 'no browser errors'],
    analyticsWindow: { total: analyticsWindow.length, globalTelemetry: 0 }, hiddenWindow: { total: 0 }, observations };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.checks.length, analyticsWindow: report.analyticsWindow, hiddenWindow: report.hiddenWindow }));
} finally { await browser?.close(); await server.close(); }
