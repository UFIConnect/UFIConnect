// Exercise the built public bundle with synthetic accounts and all requests intercepted.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { browserSecurityPolicy } from '../web/securityPolicy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'web/dist');
const output = path.join(root, '.cache/audit-ui');
const origin = 'https://uficonnect.org';
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const html = await fs.readFile(path.join(dist, 'app.html'), 'utf8');
const policy = browserSecurityPolicy(html);
const vaultStatus = { phase: 'software-prototype', state: 'disabled', available: false,
  hardwareIntegrated: false, protectsBrowserVault: false, credentials: { active: 0, revoked: 0, quarantined: 0 } };
const vaultPassphrase = 'Synthetic smoke vault passphrase';
const secret = 'SYNTHETIC_VAULT_SECRET_NEVER_SEND';
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };

try {
  await fs.mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: 'en-US', serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    const errors = []; const requests = [];
    let memberId = `built-vault-a-${width}`;
    app.seedUser(member(memberId, { name: 'Synthetic Alice' }));
    app.seedUser(member(`built-vault-b-${width}`, { name: 'Synthetic Bob' }));
    const source = { id: 'youtube', label: 'YouTube', connected: true, status: 'available',
      metrics: { views: 1800000, likes: null, comments: null, posts: 23 }, metricScope: 'Source lifetime totals',
      revenue: { amount: null }, originalUrl: 'https://www.youtube.com/', lastSyncedAt: '2026-09-30T12:00:00Z' };
    const report = { generatedAt: '2026-09-30T12:00:00Z', sources: [source, { id: 'reddit', label: 'Reddit', connected: false,
      status: 'not_connected', metrics: { views: null, likes: null, comments: null, posts: null }, revenue: { amount: null }, originalUrl: 'https://www.reddit.com/' }],
      uficonnect: { status: 'available', posts: 3, likesReceived: 5, commentsReceived: 2, interactionRequests: 1, daily: [] },
      monetization: { plan: 'free', status: 'active', sourceRevenueAvailable: false },
      deepLearning: { status: 'disabled', reason: 'Enable authorized first-party analysis in your preferences.' },
      copyright: { reports: [] }, security: { credentialStorage: 'Connected credentials are encrypted on the server.', auditRetentionDays: 30, rules: [], vault: vaultStatus } };
    let refreshes = 0;
    let outage = false;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push({ url: request.url(), body: request.postData() || '' }));
    await page.addInitScript(() => localStorage.setItem('uficonnect.analytics.consent.v1', 'denied'));
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      const isApi = url.pathname.startsWith('/api/') || url.hostname === 'api.uficonnect.org' || url.hostname.endsWith('.onrender.com');
      if (isApi) {
        const endpoint = url.pathname.replace(/^\/api(?=\/)/, '');
        const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'authorization,content-type', 'Cache-Control': 'no-store' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (endpoint === '/readyz' || endpoint === '/health') return route.fulfill({ headers, json: { status: 'ok' } });
        if (endpoint === '/auth/session') return route.fulfill({ headers, json: { token: app.token(memberId), profile: (await app.request('/profile', { userId: memberId })).data } });
        if (endpoint === '/security/vault/status') return route.fulfill({ headers, json: vaultStatus });
        if (endpoint === '/creator-analytics/report') return route.fulfill({ status: outage ? 503 : 200, headers,
          json: outage ? { message: 'Analytics temporarily unavailable.' } : report });
        if (endpoint === '/creator-analytics/refresh') { refreshes++; return route.fulfill({ headers, json: { refreshed: true } }); }
        if (endpoint === '/creator-analytics/copyright-reports') {
          const body = request.postDataJSON();
          report.copyright.reports.push({ id: `synthetic-report-${width}`, source: body.source, sourceUrl: body.sourceUrl,
            status: 'received', createdAt: '2026-09-30T12:00:00Z' });
          return route.fulfill({ status: 201, headers, json: { recorded: true } });
        }
        if (endpoint === '/feed/stream') return route.fulfill({ headers, contentType: 'text/event-stream', body: ': fixture\n\n' });
        const result = await app.request(endpoint + url.search, { userId: memberId, method: request.method(),
          ...(request.postData() ? { body: request.postDataJSON() } : {}) });
        return route.fulfill({ status: result.status, headers, json: result.data });
      }
      if (url.origin !== origin) return route.abort();
      if (request.resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: html,
        headers: { 'Content-Security-Policy': policy, 'Referrer-Policy': 'no-referrer' } });
      const file = path.resolve(dist, '.' + url.pathname);
      if (!file.startsWith(dist + path.sep)) return route.abort();
      const body = await fs.readFile(file).catch(() => null);
      if (!body) return route.fulfill({ status: 404, body: '' });
      const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
      return route.fulfill({ body, contentType: mime[path.extname(file)] || 'application/octet-stream' });
    });
    try {
      await page.goto(origin + '/vault');
      await page.getByRole('heading', { name: 'Your Vault.' }).waitFor();
      await page.getByText('Awaiting hardware setup', { exact: true }).waitFor();
      check(await page.getByText('Managed on your device', { exact: true }).count() === 1, 'Public bundle must not claim VPN control');
      for (const platform of ['Windows', 'Linux', 'iOS', 'Android']) {
        await page.getByRole('group', { name: 'VPN device' }).getByRole('button', { name: platform, exact: true }).click();
        check(await page.getByText('Managed on your device', { exact: true }).count() === 1, `${platform} handoff must not fabricate a connection`);
      }
      check(await page.getByLabel('Your configured countries', { exact: true }).isDisabled(), 'Country switching requires a configured profile');
      await page.getByRole('navigation', { name: 'Vault pages' }).getByRole('link', { name: 'Device', exact: true }).click();
      check(await page.getByRole('button', { name: 'Orders are not open yet', exact: true }).isDisabled(), 'Device ordering remains locked');
      check(await page.locator('.vault-device-page input,.vault-device-page form').count() === 0, 'Locked ordering does not collect personal or payment details');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Device page fits the viewport');
      await page.screenshot({ path: path.join(output, `public-vault-device-${width}.png`), fullPage: true });
      await page.getByRole('navigation', { name: 'Vault pages' }).getByRole('link', { name: 'Your Vault', exact: true }).click();
      await page.getByLabel('Vault passphrase', { exact: true }).fill(vaultPassphrase);
      await page.getByLabel('Confirm passphrase', { exact: true }).fill(vaultPassphrase);
      await page.getByRole('button', { name: 'Create vault', exact: true }).click();
      await page.getByRole('button', { name: 'Add password', exact: true }).click();
      await page.getByLabel('App or website name', { exact: true }).fill('Synthetic private entry');
      await page.getByLabel('Password', { exact: true }).fill(secret);
      await page.getByRole('button', { name: 'Save password', exact: true }).click();
      await page.getByRole('button', { name: 'Details for Synthetic private entry', exact: true }).waitFor();
      const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
      check(![secret, vaultPassphrase, 'Synthetic private entry'].some(value => stored.includes(value)), 'Persisted vault contains no plaintext entry, secret, or passphrase');
      await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
      await page.getByRole('button', { name: 'Unlock vault', exact: true }).waitFor();
      memberId = `built-vault-b-${width}`;
      await page.reload();
      await page.getByRole('button', { name: 'Create vault', exact: true }).waitFor();
      check(await page.getByRole('button', { name: 'Details for Synthetic private entry', exact: true }).count() === 0, 'Another account never inherits the first account vault');
      await page.screenshot({ path: path.join(output, `public-vault-${width}.png`), fullPage: true });
      await page.goto(origin + '/analytics');
      await page.getByRole('heading', { name: 'Analytics and rights', exact: true }).waitFor();
      await page.getByText('1,800,000', { exact: true }).waitFor();
      const youtube = page.locator('.creator-analytics-source').filter({ has: page.getByRole('heading', { name: 'YouTube', exact: true }) });
      check(await youtube.getByText('Unavailable', { exact: true }).count() >= 3, 'Missing source engagement and revenue stay unavailable');
      await page.getByRole('button', { name: 'Refresh sources', exact: true }).click();
      await page.getByText('Refresh finished. Each source shows its latest sync status.', { exact: true }).waitFor();
      check(refreshes === 1, 'Refresh submits exactly one request');
      await page.locator('#copyright-source').selectOption('youtube');
      await page.getByLabel('Original post URL', { exact: true }).fill('https://www.youtube.com/watch?v=abcdefghijk');
      await page.getByLabel('Describe your concern', { exact: true }).fill('Synthetic copyright concern for browser smoke testing.');
      await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
      await page.getByText('Your copyright concern was recorded for review.', { exact: true }).waitFor();
      await page.getByText('received', { exact: true }).waitFor();
      check(await page.getByRole('heading', { name: 'Deep learning insights', exact: true }).count() === 1, 'Learning status is visible without invented predictions');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Public analytics fits the viewport');
      await page.screenshot({ path: path.join(output, `public-analytics-${width}.png`), fullPage: true });
      outage = true;
      await page.locator('#analytics-period').selectOption('7');
      await page.getByRole('alert').filter({ hasText: 'Analytics temporarily unavailable.' }).waitFor();
      check(await page.getByText('1,800,000', { exact: true }).count() === 0, 'Unavailable period does not retain old totals as current');
      outage = false;
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await page.getByText('1,800,000', { exact: true }).waitFor();
      check(requests.every(item => ![secret, vaultPassphrase].some(value => item.url.includes(value) || item.body.includes(value))), 'Vault plaintext never leaves in network requests');
      check(!requests.some(item => item.url.includes('/__vault/')), 'Public bundle never calls local companion endpoints');
      check(errors.length === 0, `No runtime errors: ${errors.join('; ')}`);
      console.log(`PASS: built public Vault and analytics at ${width}px; account isolation, ciphertext storage, source truth, refresh, reports, outage recovery, no runtime errors`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `public-vault-analytics-failure-${width}.png`), fullPage: true }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
  console.log(`PASS: ${checks} production-bundle Vault and analytics checks`);
} finally { await browser.close(); await app.close(); }
