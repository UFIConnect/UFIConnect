import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../office/node_modules/vite/dist/node/index.js';
import { fulfillOfficeWelcomeRead, returnFromOfficeWelcome } from './office-welcome-audit.mjs';
import catalog from '../shared/analytics-categories.json' with { type: 'json' };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screenshots = path.join(root, '.cache', 'office-analytics-tabs-20261028');
await mkdir(screenshots, { recursive: true });
const API = 'https://office-analytics.invalid', TOKEN = 'synthetic-office-audit';
const days = Array.from({ length: 161 }, (_, index) => new Date(Date.UTC(2026, 4, 1) + index * 86400000).toISOString().slice(0, 10));
function report(empty = false) {
  return { available: true, mode: 'aggregate', range: { from:'2026-05-01',to:'2026-10-08' },
    history: { firstRecordedDay: empty ? null : '2026-08-11',lastRecordedDay: empty ? null : '2026-10-08',restoredViews: empty ? 0 : 7 }, daily: days.map(day => ({ day })),
    categories: Object.values(catalog).map(meta => {
      const views = empty ? 0 : meta.category === 'home' ? 3 : meta.category === 'app_feed' ? 4 : meta.category === 'command_center_accounts' ? 2 : 0;
      const errors = empty ? 0 : meta.category === 'home' ? 2 : meta.category === 'app_feed' ? 8 : 0;
      return { ...meta, today: views, last7: views, last30: views, errors: { today: errors, last7: errors, last30: errors }, daily: days.map(day => ({ day, views: day === days.at(-1) ? views : !empty && day === '2026-08-11' && meta.category === 'home' ? 7 : 0, errors: day === days.at(-1) ? errors : 0 })) };
    }), performance: { byCode: [], details: empty ? [] : [
      { day: '2026-10-08', category: 'home', code: 'script_error', count: 2 },
      { day: '2026-10-08', category: 'app_feed', code: 'request_failed', count: 8 },
    ] }, geography: { available: true, cityHeadersEnabled: true, firstRecordedDay: empty ? null : '2026-10-08', daily: empty ? [] : [
      { day: '2026-10-08', category: 'home', country: 'US', countryName: 'United States', city: 'Portland', region: 'Oregon', views: 2 },
      { day: '2026-10-08', category: 'home', country: 'GB', countryName: 'United Kingdom', city: 'London', region: 'England', views: 1 },
      { day: '2026-10-08', category: 'app_feed', country: 'US', countryName: 'United States', city: 'Portland', region: 'Maine', views: 4 },
      { day: '2026-10-08', category: 'command_center_accounts', country: 'US', countryName: 'United States', city: null, region: null, views: 2 },
    ] }, storage: { connected: true, status: 'ready', pendingEvents: 0, collector: { rateLimited: 0, writeFailures: 0 } }, service: { total: 0, since: '2026-10-08T00:00:00Z', responses: [] } };
}
function geographyReport(params, empty = false) {
  const source = report(empty), platform = params.get('platform'), category = params.get('category'), viewType = params.get('viewType');
  const start = params.get('from'), end = params.get('to'), countries = new Map(), cities = new Map();
  const matches = row => {
    const meta = catalog[row.category];
    return (!platform || platform === 'all' || meta.platform === platform) && (!category || category === 'all' || row.category === category)
      && (!viewType || viewType === 'all' || meta.viewType === viewType);
  };
  const total = source.categories.filter(matches).reduce((sum, row) => sum + row.daily.filter(day => day.day >= start && day.day <= end).reduce((sum, day) => sum + day.views, 0), 0);
  for (const row of source.geography.daily.filter(row => matches(row) && row.day >= start && row.day <= end)) {
    const country = countries.get(row.country) || { country: row.country, label: row.countryName, views: 0 };
    country.views += row.views; countries.set(row.country, country);
    if (row.city) { const key = JSON.stringify([row.country, row.region, row.city]); const city = cities.get(key) || { ...row, key, views: 0 }; city.views += row.views; cities.set(key, city); }
  }
  const knownCountry = [...countries.values()].reduce((sum, row) => sum + row.views, 0), knownCity = [...cities.values()].reduce((sum, row) => sum + row.views, 0);
  return { available: true, total, knownCountry, knownCity, unknownCountry: total - knownCountry, unknownCity: total - knownCity,
    countries: [...countries.values()], cities: [...cities.values()], cityLimit: 1000, cityCount: cities.size, otherCityViews: 0,
    firstRecordedDay: source.geography.firstRecordedDay, cityHeadersEnabled: true };
}
const server = await createServer({ root: path.join(root, 'office'), configFile: path.join(root, 'office/vite.config.js'), envDir: false,
  cacheDir: path.join(root, '.cache/vite-office-analytics'),
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify(API), 'import.meta.env.VITE_PIPELINE_API_URL': JSON.stringify(API) },
  server: { host: '127.0.0.1', port: 5273, strictPort: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {});
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(15000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let mode = 'normal', held = null, heldGeography = null;
    await page.route(`${API}/**`, async route => {
      const req = route.request(), url = new URL(req.url());
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'x-office-token,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (req.headers()['x-office-token'] !== TOKEN) return route.fulfill({ status: 401, headers, json: { error: 'Unauthorized' } });
      if(await fulfillOfficeWelcomeRead(route,url.pathname,headers)) return;
      if (url.pathname === '/office/analytics/pageviews') {
        assert.equal(req.headers()['x-office-token'], TOKEN);
        if (mode === 'hold') { held = route; return; }
        if (mode === 'error') return route.fulfill({ status: 503, headers, json: { error: 'Synthetic storage outage' } });
        if (mode === 'unauthorized') return route.fulfill({ status: 401, headers, json: { error: 'Unauthorized' } });
        return route.fulfill({ headers, json: report(mode === 'empty') });
      }
      if (url.pathname === '/office/analytics/geography') {
        if (mode === 'hold') { heldGeography = route; return; }
        if (mode === 'error') return route.fulfill({ status: 503, headers, json: { error: 'Synthetic geography outage' } });
        return route.fulfill({ headers, json: geographyReport(url.searchParams, mode === 'empty') });
      }
      if (url.pathname === '/office/users') return route.fulfill({ headers, json: { available: true,
        recent: [{ id:'00000000-0000-4000-8000-000000000001',name:'Recovered May member',email:'member@example.invalid',registeredDay:'2026-05-31',createdAt:'2026-10-08T00:00:00Z',onboarded:false }],
        total:1,onboarded:0,incomplete:1,today:1,last7:1,last30:1,sinceMay:1,incompleteSinceMay:1,knownRegistrationsSinceMay:15,recoveredRegistrations:14,
        registrationHistory: { from:'2026-05-01',to:'2026-10-08',earlierRegistrationDates:1,daily:[
          { day:'2026-05-31',currentRegistrations:1,recoveredRegistrations:0,registrations:1 },
          { day:'2026-08-12',currentRegistrations:0,recoveredRegistrations:14,registrations:14 },
        ] }, pagination: { total:1,pages:1,page:1 },signupRequests: { available:true,since:'2026-09-17',outcomes:[] },email: { available:true } } });
      if (url.pathname.endsWith('/stream')) return route.fulfill({ headers, contentType: 'text/event-stream', body: 'data: {"backlog":[]}\n\n' });
      return route.fulfill({ headers, json: { ok: true, server: {}, agents: {}, users: [], records: [], cache: {} } });
    });
    await page.goto(`${server.resolvedUrls.local[0]}#analytics`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByLabel('Access token', { exact: true }).fill(TOKEN);
    await page.getByRole('button', { name: 'Unlock Office', exact: true }).click();
    await returnFromOfficeWelcome(page,'Analytics');
    const dashboard = page.locator('.office-analytics');
    const tabs = dashboard.getByRole('tablist', { name: 'Analytics sections', exact: true });
    const selectTab = async name => {
      await tabs.getByRole('tab', { name, exact: true }).click();
      assert.equal(await dashboard.getByRole('tabpanel').count(), 1, 'Only the selected section is exposed');
      assert.equal(await dashboard.getByRole('tabpanel').getAttribute('aria-labelledby'), await tabs.getByRole('tab', { name, exact: true }).getAttribute('id'));
    };
    await dashboard.getByRole('heading', { name: 'Daily activity', exact: true }).waitFor();
    await page.screenshot({ path: path.join(screenshots, `overview-${width}.png`), fullPage: true });
    assert.equal(await tabs.getByRole('tab').count(), 5);
    assert.equal(await tabs.getByRole('tab', { name: 'Overview', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await tabs.locator('[tabindex="0"]').count(), 1);
    await tabs.getByRole('tab', { name: 'Overview', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await tabs.getByRole('tab', { name: 'Pages & tabs', exact: true }).evaluate(element => element === document.activeElement && element.getAttribute('aria-selected') === 'true'), true);
    await page.keyboard.press('End');
    assert.equal(await tabs.getByRole('tab', { name: 'Users', exact: true }).evaluate(element => element === document.activeElement), true);
    assert.equal(await dashboard.getByLabel('Platform', { exact: true }).isVisible(), false, 'Analytics filters do not imply they filter registered users');
    await page.keyboard.press('ArrowRight');
    assert.equal(await tabs.getByRole('tab', { name: 'Overview', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('ArrowLeft');
    assert.equal(await tabs.getByRole('tab', { name: 'Users', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press('Home');
    assert.equal(await tabs.getByRole('tab', { name: 'Overview', exact: true }).evaluate(element => element === document.activeElement), true);
    if (width === 390) assert.equal(await tabs.evaluate(element => element.scrollWidth > element.clientWidth), true, 'Phone tabs scroll horizontally');
    await selectTab('Pages & tabs');
    const table = dashboard.getByRole('region', { name: 'Category activity table', exact: true });
    await table.waitFor();
    assert.equal(await table.locator('tbody tr').count(), Object.keys(catalog).length);
    await page.screenshot({ path: path.join(screenshots, `pages-${width}.png`), fullPage: true });
    const metric = label => dashboard.locator('.office-analytics-metrics > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');
    assert.equal(await metric('Page / screen views').innerText(), '14');
    assert.equal(await metric('Tab opens').innerText(), '2');
    assert.equal(await metric('Optional diagnostics').innerText(), '10');
    const countryTable = dashboard.getByRole('region', { name: 'Country activity table', exact: true });
    const cityTable = dashboard.getByRole('region', { name: 'City activity table', exact: true });
    const diagnostics = dashboard.getByRole('region', { name: 'Diagnostic history table', exact: true });
    await selectTab('Geography');
    await countryTable.waitFor();
    assert.equal(await countryTable.locator('tbody tr').filter({ hasText: 'United States' }).locator('td').first().innerText(), '8');
    assert.equal(await countryTable.locator('tbody tr').filter({ hasText: 'Unknown country' }).locator('td').first().innerText(), '7');
    assert.equal(await cityTable.locator('tbody tr').filter({ hasText: 'Portland' }).count(), 2);
    await selectTab('Diagnostics');
    assert.equal(await diagnostics.locator('tbody tr').count(), 2);
    assert.ok((await diagnostics.innerText()).includes('Failed requests'));
    await selectTab('Geography');
    await dashboard.getByLabel('Find a city', { exact: true }).fill('oregon');
    assert.equal(await cityTable.locator('tbody tr').count(), 1);
    assert.equal(await cityTable.locator('tbody td').first().innerText(), '2');
    await selectTab('Overview');
    await selectTab('Geography');
    assert.equal(await dashboard.getByLabel('Find a city', { exact: true }).inputValue(), 'oregon', 'City search survives tab changes');
    await dashboard.getByLabel('Find a city', { exact: true }).fill('');
    await selectTab('Overview');
    assert.equal(await dashboard.getByLabel('Period', { exact:true }).inputValue(),'history');
    assert.equal(await dashboard.getByLabel('From (UTC)', { exact:true }).inputValue(),'2026-05-01');
    assert.equal(await dashboard.locator('.office-analytics-bar.unavailable').count(),102);
    await dashboard.getByText('Available analytics begins 2026-08-11.', { exact:false }).waitFor();
    await dashboard.getByText('View daily data', { exact:true }).click();
    const dailyTable = dashboard.getByRole('region', { name:'Daily activity table',exact:true });
    assert.ok((await dailyTable.locator('tbody tr').first().innerText()).includes('Unavailable'));
    assert.ok((await dailyTable.locator('tbody tr').filter({ has: page.getByText('2026-08-11', { exact:true }) }).innerText()).includes('7'));
    await dashboard.getByText('View daily data', { exact:true }).click();
    const accounts = dashboard.getByRole('region', { name:'Registered accounts',exact:true });
    await selectTab('Users');
    await accounts.getByText('Recovered May member', { exact:true }).waitFor();
    assert.equal(await accounts.getByLabel('Registration window', { exact:true }).inputValue(),'since_may');
    const accountRow = accounts.locator('tbody tr').filter({ hasText:'Recovered May member' });
    assert.ok((await accountRow.innerText()).includes('2026-05-31'));
    assert.ok((await accountRow.innerText()).includes('Current account record:'));
    await accounts.getByText('Daily registration history since May', { exact:true }).click();
    await accounts.getByText('15 known registrations, including 14 recovered historical registrations.', { exact:false }).waitFor();
    assert.ok((await accounts.locator('details table tbody tr').filter({ has:page.getByText('2026-05-31',{exact:true}) }).innerText()).includes('1'));
    await accounts.getByText('Daily registration history since May', { exact:true }).click();
    await selectTab('Geography');
    await dashboard.getByLabel('Platform', { exact: true }).selectOption('mobile');
    assert.equal(await metric('Page / screen views').innerText(), '4');
    await countryTable.getByText('4', { exact: true }).first().waitFor();
    assert.equal(await countryTable.locator('tbody tr').filter({ hasText: 'United States' }).locator('td').first().innerText(), '4');
    assert.equal(await cityTable.locator('tbody tr').filter({ hasText: 'Portland' }).count(), 1);
    assert.ok((await cityTable.innerText()).includes('Maine'));
    await selectTab('Diagnostics');
    assert.equal(await diagnostics.locator('tbody tr').count(), 1);
    assert.equal(await metric('Optional diagnostics').innerText(), '8');
    await dashboard.getByLabel('Category', { exact: true }).selectOption('app_feed');
    await selectTab('Pages & tabs');
    assert.equal(await table.locator('tbody tr').count(), 1);
    await dashboard.getByLabel('Period', { exact: true }).selectOption('custom');
    await dashboard.getByLabel('To (UTC)', { exact: true }).fill('2026-10-07');
    assert.equal(await metric('Page / screen views').innerText(), '0');
    await dashboard.getByLabel('Period', { exact: true }).selectOption('30');
    await dashboard.getByLabel('Platform', { exact: true }).selectOption('all');
    const categorySearch = catalog.maps.label;
    await dashboard.getByLabel('Find a category', { exact: true }).fill(categorySearch);
    await table.locator('tbody tr').first().waitFor();
    assert.equal(await table.locator('tbody tr').count(), Object.values(catalog).filter(row => `${row.label} ${row.group}`.toLowerCase().includes(categorySearch.toLowerCase())).length);
    assert.ok((await table.innerText()).includes('0'));
    await selectTab('Overview');
    await selectTab('Pages & tabs');
    assert.equal(await dashboard.getByLabel('Find a category', { exact: true }).inputValue(), categorySearch, 'Category search survives tab changes');
    assert.equal(await dashboard.getByLabel('Period', { exact: true }).inputValue(), '30');
    await dashboard.getByLabel('Find a category', { exact: true }).fill('');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    mode = 'error'; await dashboard.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
    await dashboard.getByRole('alert').filter({ hasText: 'Synthetic storage outage' }).waitFor();
    await selectTab('Geography');
    await dashboard.getByRole('alert').filter({ hasText: 'Synthetic geography outage' }).waitFor();
    assert.equal(await metric('Page / screen views').innerText(), '7');
    mode = 'normal'; await dashboard.getByRole('button', { name: 'Retry analytics', exact: true }).click();
    await dashboard.getByRole('button', { name: 'Refresh analytics', exact: true }).waitFor();
    mode = 'hold'; await dashboard.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
    for (let i = 0; i < 100 && (!held || !heldGeography); i++) await page.waitForTimeout(10);
    assert.ok(held); assert.ok(heldGeography);
    mode = 'empty'; await page.evaluate(() => window.dispatchEvent(new Event('office-token-changed')));
    await returnFromOfficeWelcome(page,'Analytics');
    await selectTab('Geography');
    await dashboard.getByRole('button', { name: 'Refresh analytics', exact: true }).waitFor();
    await held.fulfill({ json: report(), headers: { 'Access-Control-Allow-Origin': '*' } }).catch(() => {});
    await heldGeography.fulfill({ json: geographyReport(new URL(heldGeography.request().url()).searchParams), headers: { 'Access-Control-Allow-Origin': '*' } }).catch(() => {});
    assert.equal(await metric('Page / screen views').innerText(), '0', 'Old credential request cannot restore stale data');
    assert.equal(await metric('Tab opens').innerText(), '0');
    assert.equal(await countryTable.locator('tfoot td').first().innerText(), '0');
    mode = 'unauthorized'; await dashboard.getByRole('button', { name: 'Refresh analytics', exact: true }).click();
    await page.getByLabel('Access token', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dashboard.locator('#office-analytics-panel-pages').waitFor({ state: 'detached' });
    assert.equal(await dashboard.locator('#office-analytics-panel-geography').count(), 0, 'A rejected credential clears visible and hidden analytics data');
    mode = 'error';
    await dashboard.getByRole('button', { name: 'Retry analytics', exact: true }).click();
    await dashboard.getByRole('alert').filter({ hasText: 'Synthetic storage outage' }).waitFor();
    await selectTab('Users');
    await accounts.getByText('Recovered May member', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(`PASS Office accessible tabs, preserved section filters, country/city counts, diagnostic history, May date range, recovery, errors and stale token protection ${width}`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); }
