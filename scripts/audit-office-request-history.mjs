import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://request-history-audit.invalid';
const report = { available: true, range: { from: '2026-05-01', to: '2026-11-05' },
  coverage: { firstRecordedDay: '2026-10-22', observedDays: 2 }, storage: { status: 'ready' },
  daily: [
    { day: '2026-10-22', requests: 100, errors: 2, clientErrors: 4, slowRequests: null, aborted: null },
    { day: '2026-11-05', requests: 10, errors: 0, clientErrors: 1, slowRequests: 1, aborted: 0 },
  ], dailyByRole: [
    { day: '2026-10-22', role: 'api', requests: 70, errors: 2, clientErrors: 3, slowRequests: null, aborted: null },
    { day: '2026-10-22', role: 'pipeline', requests: 30, errors: 0, clientErrors: 1, slowRequests: null, aborted: null },
    { day: '2026-11-05', role: 'api', requests: 10, errors: 0, clientErrors: 1, slowRequests: 1, aborted: 0 },
  ], byFamily: [{ family: 'feed', requests: 100 }, { family: 'office', requests: 10 }],
  byRole: [{ role: 'api', requests: 80 }, { role: 'pipeline', requests: 30 }],
  byStatus: [{ statusClass: '2xx', requests: 103 }, { statusClass: '4xx', requests: 5 }, { statusClass: '5xx', requests: 2 }],
  byLatency: [{ latencyBucket: 'under_100ms', requests: 10 }, { latencyBucket: 'unknown', requests: 100 }],
  history: { sources: ['api', 'pipeline'].map(role => ({ source: 'render-request-logs', role,
    firstRecordedDay: '2026-10-22', lastRecordedDay: '2026-10-22', recoveredRequests: role === 'api' ? 70 : 30,
    retrievedCompletely: true, completeDays: [], partialDays: [{ day: '2026-10-22' }],
  })) },
  providerHistory: { available: true, source: 'render-http-metrics', definition: 'Public HTTP responses observed at Render ingress.',
    range: { from: '2026-10-07', to: '2026-11-04' }, coverage: { firstRecordedDay: '2026-10-07' },
    daily: [{ day: '2026-10-07', requests: 70, errors: 1, clientErrors: 4 }, { day: '2026-10-22', requests: 160, errors: 3, clientErrors: 8 }],
    dailyByRole: [
      { day: '2026-10-07', role: 'api', requests: 50, errors: 1, clientErrors: 3 }, { day: '2026-10-07', role: 'pipeline', requests: 20, errors: 0, clientErrors: 1 },
      { day: '2026-10-22', role: 'api', requests: 120, errors: 2, clientErrors: 6 }, { day: '2026-10-22', role: 'pipeline', requests: 40, errors: 1, clientErrors: 2 },
    ],
  },
};
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#080d14;color:#dbe4f0;font:14px Arial}</style></head><body><main id="root" class="office-analytics"></main><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import Requests from '/src/RequestsAnalytics.jsx';import '/src/AnalyticsDashboard.css';const request=(url,options)=>fetch(url,options);createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Requests,{apiBase:${JSON.stringify(API)},request})));</script></body></html>`;
const server = await createServer({ root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envDir: false,
  cacheDir: path.join(root, '.cache/vite-request-history'), server: { host: '127.0.0.1', port: 0, strictPort: false },
  plugins: [{ name: 'request-history-audit', configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (req.url !== '/__request-history') return next();
    res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html));
  }); } }],
});
let browser;
try {
  await server.listen(); await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = []; let reads = 0;
    page.on('pageerror', error => errors.push(error.name));
    await page.route(`${API}/**`, route => { reads++; return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: report }); });
    await page.goto(server.resolvedUrls.local[0] + '__request-history');
    const classifiedTable = page.getByRole('region', { name: 'Daily server requests table', exact: true });
    await classifiedTable.waitFor();
    const metric = label => page.locator('.office-analytics-metrics > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');
    assert.equal(await metric('Recorded requests').innerText(), '110');
    assert.equal(await metric('Platform HTTP requests').innerText(), '230');
    const recovered = classifiedTable.getByRole('row').filter({ hasText: '2026-10-22' });
    assert.equal(await recovered.getByRole('cell', { name: 'Unavailable', exact: true }).count(), 2, 'Historical latency and abort counts remain unknown');
    await page.getByText('1 of 2 recorded days measured', { exact: true }).first().waitFor();
    await page.getByRole('region', { name: 'Requests by duration', exact: true }).getByText('Time to headers unavailable', { exact: true }).waitFor();
    const recovery = page.getByRole('region', { name: 'Recovered request log coverage table', exact: true });
    assert.equal(await recovery.getByText('Partial: 2026-10-22', { exact: true }).count(), 2);
    const settledReads = reads;
    await page.getByLabel('Requests to (UTC)', { exact: true }).fill('2026-10-21');
    assert.equal(await metric('Recorded requests').innerText(), 'Unavailable');
    assert.equal(await metric('Platform HTTP requests').innerText(), '70', 'Earlier provider history remains available before classified logs');
    await page.getByLabel('Request service', { exact: true }).selectOption('pipeline');
    assert.equal(await recovery.locator('tbody tr').count(), 1, 'Recovery provenance follows the selected service');
    assert.equal(await metric('Platform HTTP requests').innerText(), '20');
    await page.getByLabel('Requests to (UTC)', { exact: true }).fill('2026-11-05');
    assert.equal(await metric('Recorded requests').innerText(), '30');
    assert.equal(await metric('Responses taking 2+ seconds').innerText(), 'Unavailable');
    assert.equal(await metric('Platform HTTP requests').innerText(), '60');
    assert.equal(reads, settledReads, 'Date and service filters use the loaded snapshots without more requests');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(root, `.cache/audit-ui/request-history-${width}.png`), fullPage: true });
    await page.close(); console.log(`PASS: historical counts, independent provider totals, unknown measurements and local filters at ${width}px`);
  }
} finally { await browser?.close(); await server.close(); }
