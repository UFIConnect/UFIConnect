import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';
import catalog from '../shared/analytics-categories.json' with { type: 'json' };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/analytics-comparison-audit'); await fs.mkdir(output, { recursive: true });
const API = 'https://comparison-audit.invalid';
const range = { from: '2026-05-30', to: '2026-06-02' }, days = ['2026-05-30', '2026-05-31', '2026-06-01', '2026-06-02'];
const comparison = { available: true, generatedAt: '2026-06-02T12:00:00Z', range, sources: {
  edge: { status: 'cached', firstRecordedDay: '2026-05-30', scope: 'Zone requests including automated traffic.' },
  firstParty: { status: 'ready', firstRecordedDay: '2026-05-31', scope: 'Anonymous recorded opens.' },
  registrations: { status: 'ready', firstRecordedDay: '2026-06-01', scope: 'Current and recovered registrations.' },
}, daily: [
  { day: '2026-05-30', edgeRequests: 3639224, htmlPageViews: 998748, webPageOpens: null, mobileScreenOpens: null, tabOpens: null, diagnostics: null, registrations: null },
  { day: '2026-05-31', edgeRequests: 100, htmlPageViews: 50, webPageOpens: 10, mobileScreenOpens: 3, tabOpens: 2, diagnostics: 0, registrations: null },
  { day: '2026-06-01', edgeRequests: 300, htmlPageViews: 120, webPageOpens: 0, mobileScreenOpens: 0, tabOpens: 0, diagnostics: 2, registrations: 1 },
] };
const requests = { available: true, range, generatedAt: '2026-06-02T12:00:00Z', coverage: { firstRecordedDay: '2026-06-01', observedDays: 2 }, storage: { status: 'ready' },
  daily: [{ day: '2026-06-01', requests: 10, errors: 1, clientErrors: 2, slowRequests: 3, aborted: 0 }, { day: '2026-06-02', requests: 20, errors: 0, clientErrors: 4, slowRequests: 1, aborted: 2 }],
  dailyByRole: [{ day: '2026-06-01', role: 'api', requests: 7, errors: 1, clientErrors: 2, slowRequests: 3, aborted: 0 }, { day: '2026-06-01', role: 'pipeline', requests: 3, errors: 0, clientErrors: 0, slowRequests: 0, aborted: 0 }],
  byFamily: [{ family: 'feed', requests: 25 }, { family: 'office', requests: 5 }], byRole: [{ role: 'api', requests: 27 }, { role: 'pipeline', requests: 3 }],
  byStatus: [{ statusClass: '2xx', requests: 23 }, { statusClass: '4xx', requests: 6 }, { statusClass: '5xx', requests: 1 }], byLatency: [{ latencyBucket: 'under_100ms', requests: 26 }, { latencyBucket: '2_10s', requests: 4 }],
};
const firstParty = { available: true, mode: 'aggregate', range, history: { firstRecordedDay: '2026-05-31' }, daily: days.map(day => ({ day })),
  categories: Object.values(catalog).map(meta => ({ ...meta, today: 0, last7: 1, last30: 1, daily: meta.category === 'home' ? [{ day: '2026-05-31', views: 1, errors: 0 }] : [] })),
  performance: { byCode: [], details: [] }, service: { total: 0, responses: [] } };
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:20px;background:#080d14;color:#dbe4f0;font-family:Arial,sans-serif}@media(max-width:460px){body{padding:12px}}</style></head><body><div id="root"></div><script type="module">import React from 'react';import{createRoot}from'react-dom/client';import Dashboard from '/src/AnalyticsDashboard.jsx';const request=(url,options)=>fetch(url,options);createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Dashboard,{apiBase:${JSON.stringify(API)},request,usersPanel:React.createElement('p',null,'Account fixture')})));</script></body></html>`;
const server = await createServer({ root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envDir: false,
  plugins: [{ name: 'analytics-comparison-fixture', configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (req.url !== '/__analytics-comparison-audit') return next();
    res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html));
  }); } }],
  cacheDir: path.join(root, '.cache/vite-comparison-audit'), server: { host: '127.0.0.1', port: 5276, strictPort: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {});
  for (const width of [1440, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); page.setDefaultTimeout(15000);
    const errors = [], reads = { comparison: 0, requests: 0, pageviews: 0 }; let mode = 'normal', overviewMode = 'normal';
    page.on('pageerror', error => errors.push(error.name));
    await page.route(`${API}/**`, route => {
      const endpoint = new URL(route.request().url()).pathname, headers = { 'Access-Control-Allow-Origin': '*' };
      if (endpoint.endsWith('/comparison')) { reads.comparison++; return route.fulfill({ headers, status: mode === 'error' ? 503 : mode === 'unauthorized' ? 401 : 200, json: mode === 'error' ? { error: 'Comparison fixture unavailable' } : comparison }); }
      if (endpoint.endsWith('/requests')) { reads.requests++; return route.fulfill({ headers, json: requests }); }
      if (endpoint.endsWith('/overview')) {
        reads.pageviews++; return route.fulfill({ headers, json: { available: true, mode: 'overview', range: firstParty.range,
          activity: overviewMode === 'activity-failure' ? { available: false, error: 'Tracked activity fixture unavailable.' } : firstParty,
          traffic: overviewMode === 'traffic-failure' ? { available: false, error: 'Traffic fixture unavailable.' } : { available: true, status: overviewMode === 'stale' ? 'stale' : 'cached',
            generatedAt: '2026-06-02T12:00:00Z', coverage: { firstRecordedDay: '2026-05-30' },
            daily: comparison.daily.map(row => ({ day: row.day, pageViews: row.htmlPageViews, requests: row.edgeRequests })) } } });
      }
      return route.fulfill({ headers, json: { available: true, daily: [], monthly: [], totals: {}, coverage: {}, countries: [], cities: [] } });
    });
    await page.goto(`${server.resolvedUrls.local[0]}__analytics-comparison-audit`, { waitUntil: 'domcontentloaded' });
    const dashboard = page.locator('.office-analytics'), tabs = dashboard.getByRole('tablist');
    await dashboard.getByRole('heading', { name: 'Daily activity', exact: true }).waitFor();
    assert.equal(await tabs.getByRole('tab').count(), 8); assert.equal(reads.comparison, 0); assert.equal(reads.requests, 0);
    const overviewMetric = label => dashboard.locator('#office-analytics-panel-overview .office-analytics-metrics > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');
    assert.equal(await overviewMetric('HTML page views').innerText(), '998,918');
    assert.equal(await overviewMetric('Edge requests').innerText(), '3,639,624');
    assert.equal(await overviewMetric('Tracked website opens').innerText(), '1');
    assert.equal(await overviewMetric('Tracked app screens').innerText(), 'Unavailable');
    assert.equal(await dashboard.getByLabel('Platform', { exact: true }).isVisible(), false);
    const overviewReads = reads.pageviews;
    await dashboard.getByLabel('From (UTC)', { exact: true }).fill('2026-05-30');
    await dashboard.getByLabel('To (UTC)', { exact: true }).fill('2026-05-30');
    assert.equal(await overviewMetric('HTML page views').innerText(), '998,748');
    assert.equal(await overviewMetric('Tracked website opens').innerText(), 'Unavailable');
    await dashboard.getByLabel('Period', { exact: true }).selectOption('1');
    assert.equal(await overviewMetric('HTML page views').innerText(), 'Unavailable');
    assert.equal(await overviewMetric('Tracked website opens').innerText(), '0');
    await dashboard.getByLabel('Period', { exact: true }).selectOption('history');
    await dashboard.getByLabel('Daily trend', { exact: true }).selectOption('webOpens');
    assert.equal(reads.pageviews, overviewReads, 'The main traffic date filters and source trend use one shared snapshot');
    await dashboard.getByLabel('Daily trend', { exact: true }).selectOption('htmlViews');
    await page.screenshot({ path: path.join(output, `unified-overview-${width}.png`), fullPage: true });
    overviewMode = 'activity-failure'; await dashboard.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
    await dashboard.getByText('Tracked activity fixture unavailable.', { exact: true }).waitFor();
    assert.equal(await overviewMetric('HTML page views').innerText(), '998,918');
    assert.equal(await overviewMetric('Tracked website opens').innerText(), 'Unavailable');
    overviewMode = 'traffic-failure'; await dashboard.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
    await dashboard.getByText('Traffic fixture unavailable.', { exact: false }).waitFor();
    assert.equal(await overviewMetric('HTML page views').innerText(), 'Unavailable');
    assert.equal(await overviewMetric('Tracked website opens').innerText(), '1');
    overviewMode = 'stale'; await dashboard.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
    await dashboard.getByText('Provider traffic needs a fresh check', { exact: true }).waitFor();
    assert.equal(await overviewMetric('HTML page views').innerText(), '998,918');
    overviewMode = 'normal'; await dashboard.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
    await dashboard.getByText('Analytics sources loaded', { exact: true }).waitFor();
    await tabs.getByRole('tab', { name: 'Compare', exact: true }).click();
    const panel = dashboard.getByRole('tabpanel'), table = panel.getByRole('region', { name: 'Traffic and activity comparison table', exact: true });
    await table.waitFor();
    const metric = label => panel.locator('.analytics-comparison-metrics > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');
    assert.equal(await metric('Edge requests').innerText(), '400'); assert.equal(await metric('Website page opens').innerText(), '10');
    assert.equal(await table.locator('tbody tr').count(), 2);
    const comparisonReads = reads.comparison, mainReads = reads.pageviews;
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(100);
    assert.equal(reads.pageviews, mainReads, 'Primary report polling pauses on the comparison tab');
    await panel.getByLabel('Comparison from (UTC)', { exact: true }).fill('2026-05-30');
    await panel.getByLabel('Comparison to (UTC)', { exact: true }).fill('2026-05-30');
    assert.equal(await metric('Edge requests').innerText(), 'Unavailable');
    await panel.getByRole('checkbox').uncheck();
    assert.equal(await metric('Edge requests').innerText(), '3,639,224'); assert.equal(await metric('Website page opens').innerText(), 'Unavailable\n0 of 1 days recorded');
    await panel.getByRole('button', { name: 'All retained dates', exact: true }).click();
    await panel.getByRole('checkbox').check(); await panel.getByLabel('Compare by', { exact: true }).selectOption('day');
    assert.equal(await table.locator('tbody tr').count(), 2);
    await panel.getByLabel('Activity series', { exact: true }).selectOption('registrations');
    assert.equal(reads.comparison, comparisonReads, 'Date, coverage, grouping and series filters use the loaded snapshot');
    assert.equal(await panel.getByRole('img').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, `comparison-${width}.png`), fullPage: true });
    mode = 'error'; await panel.getByRole('button', { name: 'Refresh comparison', exact: true }).click();
    await panel.getByRole('alert').getByText('Comparison fixture unavailable', { exact: false }).waitFor();
    assert.equal(await table.locator('tbody tr').count(), 1, 'A failed refresh retains the last successful snapshot and selected pair coverage');
    mode = 'unauthorized'; await panel.getByRole('button', { name: 'Refresh comparison', exact: true }).click();
    await panel.getByRole('alert').getByText('Office access is required.', { exact: false }).waitFor();
    assert.equal(await table.count(), 0, 'An authorization failure clears previous data');
    mode = 'normal'; await panel.getByRole('button', { name: 'Refresh comparison', exact: true }).click(); await table.waitFor();
    await tabs.getByRole('tab', { name: 'API requests', exact: true }).click();
    const requestsTable = panel.getByRole('region', { name: 'Daily server requests table', exact: true }); await requestsTable.waitFor();
    const requestMetric = label => panel.locator('.office-analytics-metrics > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');
    assert.equal(await requestMetric('Recorded requests').innerText(), '30'); assert.equal(await requestsTable.locator('tbody tr').count(), 2);
    await panel.getByLabel('Request service', { exact: true }).selectOption('pipeline');
    assert.equal(await requestMetric('Recorded requests').innerText(), '3'); assert.equal(await requestsTable.locator('tbody tr').count(), 1);
    await panel.getByLabel('Requests to (UTC)', { exact: true }).fill('2026-05-31');
    assert.equal(await requestMetric('Recorded requests').innerText(), 'Unavailable');
    await panel.getByLabel('Requests to (UTC)', { exact: true }).fill('2026-06-02');
    await panel.getByRole('region', { name: 'This Office session requests', exact: true }).waitFor();
    assert.equal(await panel.getByRole('region', { name: 'Requests by endpoint family', exact: true }).locator('tbody tr').count(), 2);
    const requestReads = reads.requests, hiddenComparisonReads = reads.comparison;
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.waitForTimeout(100);
    assert.equal(reads.comparison, hiddenComparisonReads); assert.equal(reads.requests, requestReads); assert.equal(reads.pageviews, mainReads);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, `requests-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []); console.log(`PASS comparison coverage, local date/month/day filters, source separation, errors, request service/history and hidden reads ${width}`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); }
