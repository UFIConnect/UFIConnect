// Exercise the compiled shared app's real settings and collectors. All API
// responses are synthetic; no account, provider, or analytics service is used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exportRoot = path.resolve(process.env.EXPO_EXPORT_DIR || process.env.EXPO_AUDIT_EXPORT_DIR || path.join(mobile, '.cache/export-sdk57'));
const output = path.resolve(process.env.SHARED_PRIVACY_AUDIT_DIR || path.join(mobile, '.cache/shared-privacy-qa'));
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../../backend/test-support/app-harness');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
await fs.access(path.join(exportRoot, 'index.html'));
await fs.mkdir(output, { recursive: true });
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(exportRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    assert.ok(filename.startsWith(exportRoot + path.sep));
    let body, extension = path.extname(filename);
    try { body = await fs.readFile(filename); }
    catch (error) {
      if (extension || !String(request.headers.accept).includes('text/html')) throw error;
      body = await fs.readFile(path.join(exportRoot, 'index.html')); extension = '.html';
    }
    response.writeHead(200, { 'content-type': mime[extension] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const app = await createAppHarness();
const report = { checkedAt: new Date().toISOString(), exportRoot, fixturesOnly: true, realAccountActions: 0, checks: 0, results: [] };
const check = (condition, message) => { assert.ok(condition, message); report.checks++; };
const preferenceKey = 'uficonnect.data-preferences.v1';
let browser;
try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of [390, 1280]) {
    const userId = `privacy-private-member-${width}`;
    app.seedUser(member(userId, { name: 'Private Synthetic Name', email: 'private-synthetic@example.invalid', onboardingComplete: true }));
    const profile = (await app.request('/profile', { userId })).data;
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' });
    const requests = [], google = [], errors = [], failedAssets = [], deniedWrites = [];
    // A real cookie in the API jar proves the collectors use credentials:omit.
    await context.addCookies([{ name: 'ufi-private-audit', value: 'private-cookie-sentinel', domain: 'api.uficonnect.org', path: '/', secure: true, httpOnly: true, sameSite: 'None' }]);
    await context.addInitScript(() => {
      localStorage.setItem('uficonnect.analytics.consent.v1', 'denied');
      localStorage.setItem('uficonnect.ads.consent.v1', 'denied');
    });
    const cors = { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Authorization, Content-Type, X-UFI-Device-Location' };
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (/google-analytics|googletagmanager|analytics\.google/.test(url.hostname)) { google.push(url.href); return route.abort(); }
      if (url.origin === base && ['GET', 'HEAD'].includes(request.method())) return route.continue();
      if (url.hostname !== 'api.uficonnect.org') return route.abort();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const fulfill = options => route.fulfill({ headers: cors, ...options });
      if (url.pathname.startsWith('/analytics/')) {
        requests.push({ path: url.pathname, body: request.postDataJSON(), headers: await request.allHeaders() });
        return fulfill({ status: 204 });
      }
      if (url.pathname === '/auth/session') return fulfill({ json: { token: app.token(userId), profile } });
      if (!['GET', 'HEAD'].includes(request.method())) {
        deniedWrites.push(url.pathname); return fulfill({ status: 409, json: { error: 'Member writes disabled.' } });
      }
      if (/events|stream/.test(url.pathname)) return route.abort();
      if (url.pathname === '/feed/location') return fulfill({ json: { automaticLocationAvailable: true, countryCode: 'US' } });
      const result = await app.request(url.pathname + url.search, { userId });
      return fulfill({ status: result.status, json: result.data ?? {} });
    });
    async function pageAtSettings() {
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => {
        if (response.url().startsWith(base) && /\.(?:js|css|woff2?|ttf)(?:\?|$)/.test(response.url()) && response.status() !== 200) failedAssets.push(response.url());
      });
      await page.goto(base + '/settings?tab=data&private-query=do-not-send', { waitUntil: 'domcontentloaded' });
      await page.getByRole('switch', { name: 'Optional performance diagnostics', exact: true }).waitFor();
      return page;
    }
    const page = await pageAtSettings();
    const performance = page.getByRole('switch', { name: 'Optional performance diagnostics', exact: true });
    const dataSaver = page.getByRole('switch', { name: 'Data saver for feed previews', exact: true });
    const autoplay = page.getByRole('switch', { name: 'Autoplay feed previews', exact: true });
    const required = () => requests.filter(request => request.path === '/analytics/pageview');
    const optional = () => requests.filter(request => request.path === '/analytics/performance');
    const emitError = target => target.evaluate(async () => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'PRIVATE ERROR NAME private-synthetic@example.invalid', filename: 'https://private.example.invalid/?token=private-token', error: new Error('private stack sentinel') }));
      await new Promise(resolve => requestAnimationFrame(resolve));
    });
    try {
      check(await performance.getAttribute('aria-checked') === 'false', 'Optional diagnostics default off');
      check(await page.getByRole('heading', { name: 'Required service analytics', exact: true }).isVisible(), 'Required metrics remain disclosed');
      check(required().some(request => request.body.category === 'settings'), 'Aggregate page category works without optional consent');
      await emitError(page);
      check(optional().length === 0, 'No diagnostics before opt-in');
      await performance.click();
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.performanceInsights === true, preferenceKey);
      const captured = page.waitForResponse(response => response.url().endsWith('/analytics/performance') && response.request().method() === 'POST');
      await emitError(page); await captured;
      check(optional().length === 1, 'Opt-in enables the real error collector');
      assert.deepEqual(optional()[0].body, { category: 'settings', kind: 'client_error', code: 'script_error' }); report.checks++;
      await emitError(page);
      check(optional().length === 1, 'Repeated errors are bounded within the current category');
      const other = await pageAtSettings();
      const otherPerformance = other.getByRole('switch', { name: 'Optional performance diagnostics', exact: true });
      check(await otherPerformance.getAttribute('aria-checked') === 'true', 'Second tab restores the opted-in preference');
      await performance.click();
      await other.waitForFunction(() => document.querySelector('[aria-label="Optional performance diagnostics"]')?.getAttribute('aria-checked') === 'false');
      check(await otherPerformance.getAttribute('aria-checked') === 'false', 'Withdrawal propagates to open tabs');
      await emitError(page); await emitError(other);
      check(optional().length === 1, 'Withdrawal stops new diagnostics in both tabs');
      await dataSaver.click();
      check(await autoplay.isDisabled() && await autoplay.getAttribute('aria-checked') === 'false', 'Data saver pauses and disables automatic previews');
      await dataSaver.click();
      check(await autoplay.isEnabled() && await autoplay.getAttribute('aria-checked') === 'true', 'Disabling data saver restores the autoplay choice');
      await autoplay.click();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await performance.waitFor();
      check(await autoplay.getAttribute('aria-checked') === 'false', 'Playback preference survives reload');
      check(await performance.getAttribute('aria-checked') === 'false', 'Withdrawal survives reload');
      for (const request of required()) {
        check(Object.keys(request.body).length === 1 && typeof request.body.category === 'string', 'Core metrics contain only a fixed category');
      }
      for (const request of requests) {
        check(!request.headers.authorization && !request.headers.cookie && !request.headers.referer && !request.headers['x-ufi-device-location'], 'Metrics exclude credentials, referrer and precise location');
        check(!/private|synthetic|@|eyJ|token=|error name/i.test(JSON.stringify(request.body)), 'Metrics exclude identifiers, query strings and error details');
      }
      check(google.length === 0, 'First-party metrics never enable optional Google collection');
      check(deniedWrites.length === 0, 'Privacy controls do not write account data');
      check(errors.length === 0, 'Compiled app has no unhandled exceptions: ' + errors.join('; '));
      check(failedAssets.length === 0, 'Compiled app assets load successfully');
      await page.screenshot({ path: path.join(output, `privacy-${width}.png`) });
      report.results.push({ width, passed: true, metrics: requests, googleRequests: google, errors, failedAssets });
    } catch (error) {
      await page.screenshot({ path: path.join(output, `failure-${width}.png`) }).catch(() => {});
      report.results.push({ width, passed: false, error: error.message, metrics: requests, errors, failedAssets });
      throw error;
    } finally { await context.close(); }
  }
  report.passed = true;
  console.log(`PASS ${report.checks} compiled shared privacy and preference checks; report: ${output}`);
} finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve)); await app.close();
}
