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
      uficonnect: { status: 'available', posts: 3, likesReceived: 5, commentsReceived: 2, interactionRequests: 1,
        daily: [{ day: '2026-09-29', posts: 1 }, { day: '2026-09-30', posts: 2 }] },
      monetization: { plan: 'free', status: 'active', sourceRevenueAvailable: false },
      deepLearning: { status: 'disabled', reason: 'Enable authorized first-party analysis in your preferences.' },
      copyright: { reports: [] }, security: { credentialStorage: 'Connected credentials are encrypted on the server.', auditRetentionDays: 30, rules: [], vault: vaultStatus } };
    let refreshes = 0;
    let outage = false;
    let vpnPaid = false;
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
        if (endpoint === '/billing/config') return route.fulfill({ headers, json: { paymentsReady: false, tiers: { vpn_connector: false }, pricing: { vpn_connector: { unitAmount: 394, currency: 'USD', interval: 'month', intervalCount: 1, comingSoon: true } } } });
        if (endpoint === '/billing/status') return route.fulfill({ headers, json: { plan: 'free', vpnConnectorAddon: vpnPaid, hasBillingAccount: vpnPaid, subscriptions: vpnPaid ? [{ kind: 'vpn_connector', status: 'active' }] : [] } });
        if (endpoint === '/vault/vpn/locations') return route.fulfill({ headers, json: { locations: [] } });
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
      check(await page.locator('.vault-secondary-column .vault-activity').count() === 1, 'Connection activity appears once in the right Vault column');
      check(await page.locator('.vault-secondary-column .vault-hardware-status').count() === 1, 'Hardware verification appears in the right Vault column');
      await page.getByRole('button', { name: 'Subscribe — coming soon', exact: true }).waitFor();
      check(await page.getByRole('button', { name: 'Subscribe — coming soon', exact: true }).isDisabled(), 'VPN checkout remains locked until real service is ready');
      check(await page.getByRole('button', { name: 'VPN locked', exact: true }).isDisabled(), 'Unsubscribed public VPN controls are locked');
      check(await page.getByRole('button', { name: 'Create vault', exact: true }).isDisabled(), 'New Vault creation requires an active subscription');
      check(await page.locator('.vault-unlock-content .vault-vpn-subscription').count() === 1, 'VPN offer is in A space that’s yours');
      check(await page.locator('.vault-secondary-column .vault-vpn-subscription').count() === 0, 'VPN offer has no duplicate in the right column');
      check(await page.locator('.vault-vpn-quick-action .vault-button').count() === 1, 'VPN has one prominent connection action');
      check(await page.locator('.vault-vpn-setup').evaluate(element => !element.open), 'VPN setup starts collapsed');
      vpnPaid = true;
      await page.getByRole('button', { name: 'Check subscription status', exact: true }).click();
      await page.getByRole('button', { name: 'Manage or cancel subscription', exact: true }).waitFor();
      check(await page.getByText('Managed on your device', { exact: true }).count() === 1, 'Confirmed billing never fabricates an active VPN tunnel');
      await page.getByText('Device, locations and setup', { exact: true }).click();
      for (const platform of ['Windows', 'Linux', 'iOS', 'Android']) {
        await page.getByRole('group', { name: 'VPN device' }).getByRole('button', { name: platform, exact: true }).click();
        check(await page.getByText('Managed on your device', { exact: true }).count() === 1, `${platform} handoff must not fabricate a connection`);
      }
      check(await page.getByLabel('Your configured countries', { exact: true }).isDisabled(), 'Country switching requires a configured profile');
      vpnPaid = false;
      await page.getByRole('button', { name: 'Check subscription status', exact: true }).click();
      await page.getByRole('button', { name: 'VPN locked', exact: true }).waitFor();
      check(await page.getByRole('button', { name: 'Connect using device settings', exact: true }).isDisabled(), 'Loss of entitlement locks public connector actions');
      await page.getByRole('navigation', { name: 'Vault pages' }).getByRole('link', { name: 'Device', exact: true }).click();
      check(await page.getByRole('button', { name: 'Orders are not open yet', exact: true }).isDisabled(), 'Device ordering remains locked');
      check(await page.locator('.vault-device-page input,.vault-device-page form').count() === 0, 'Locked ordering does not collect personal or payment details');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Device page fits the viewport');
      await page.screenshot({ path: path.join(output, `public-vault-device-${width}.png`), fullPage: true });
      await page.getByRole('navigation', { name: 'Vault pages' }).getByRole('link', { name: 'Your Vault', exact: true }).click();
      vpnPaid = true;
      await page.getByRole('button', { name: 'Check subscription status', exact: true }).click();
      await page.getByRole('button', { name: 'Manage or cancel subscription', exact: true }).waitFor();
      await page.getByLabel('Vault passphrase', { exact: true }).fill(vaultPassphrase);
      await page.getByLabel('Confirm passphrase', { exact: true }).fill(vaultPassphrase);
      await page.getByRole('button', { name: 'Create vault', exact: true }).click();
      await page.locator('.vault-access-home .vault-vpn-subscription').waitFor();
      check(await page.locator('.vault-access-home .vault-vpn-subscription').count() === 1, 'Subscription stays visible after Vault unlock');
      await page.getByRole('button', { name: 'Add password', exact: true }).click();
      await page.getByLabel('App or website name', { exact: true }).fill('Synthetic private entry');
      await page.getByLabel('Password', { exact: true }).fill(secret);
      await page.getByRole('button', { name: 'Save password', exact: true }).click();
      await page.getByRole('button', { name: 'Details for Synthetic private entry', exact: true }).waitFor();
      const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
      check(![secret, vaultPassphrase, 'Synthetic private entry'].some(value => stored.includes(value)), 'Persisted vault contains no plaintext entry, secret, or passphrase');
      vpnPaid = false;
      await page.getByRole('button', { name: 'Check subscription status', exact: true }).click();
      await page.getByRole('button', { name: 'Subscribe — coming soon', exact: true }).waitFor();
      check(await page.getByRole('button', { name: 'Add password', exact: true }).isDisabled(), 'Expired entitlement locks new password writes');
      await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
      await page.getByRole('button', { name: 'Unlock vault', exact: true }).waitFor();
      check(await page.getByRole('button', { name: 'Unlock vault', exact: true }).isEnabled(), 'Existing owners may unlock after subscription expiry');
      await page.getByLabel('Vault passphrase', { exact: true }).fill(vaultPassphrase);
      await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
      await page.getByRole('button', { name: 'Details for Synthetic private entry', exact: true }).click();
      check(await page.getByRole('button', { name: 'Save password', exact: true }).isDisabled(), 'Existing password details remain read-only without entitlement');
      await page.getByRole('button', { name: 'Reveal password', exact: true }).click();
      check(await page.getByLabel('Password', { exact: true }).inputValue() === secret, 'Expired owners can still read their saved password');
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
      memberId = `built-vault-b-${width}`;
      await page.reload();
      await page.getByRole('button', { name: 'Create vault', exact: true }).waitFor();
      check(await page.getByRole('button', { name: 'Create vault', exact: true }).isDisabled(), 'A different unpaid account does not inherit Vault write access');
      check(await page.getByRole('button', { name: 'Details for Synthetic private entry', exact: true }).count() === 0, 'Another account never inherits the first account vault');
      await page.screenshot({ path: path.join(output, `public-vault-${width}.png`), fullPage: true });
      await page.goto(origin + '/analytics');
      await page.getByRole('heading', { name: 'Analytics', exact: true }).waitFor();
      const tabs = page.getByRole('tablist', { name: 'Analytics sections', exact: true });
      const panel = page.getByRole('tabpanel');
      const selectedTab = name => tabs.getByRole('tab', { name, exact: true, selected: true });
      async function selectTab(name) {
        await tabs.getByRole('tab', { name, exact: true }).click();
        await selectedTab(name).waitFor();
        await panel.waitFor();
        check(await panel.count() === 1, `${name} mounts only its active panel`);
      }
      async function checkDailyPosts() {
        await panel.getByRole('heading', { name: 'Posts over time', exact: true }).waitFor();
        const table = panel.getByRole('table', { name: 'Your UFIconnect posts by creation date', exact: true, includeHidden: true });
        const details = panel.locator('details').filter({ has: page.getByRole('table', { name: 'Your UFIconnect posts by creation date', exact: true, includeHidden: true }) });
        if (await details.count() && !(await details.evaluate(element => element.open))) await details.locator('summary').click();
        await table.waitFor({ state: 'visible' });
        check(await table.getByRole('row', { name: '2026-09-29 1', exact: true }).count() === 1, 'Daily table shows the first reported date and count');
        check(await table.getByRole('row', { name: '2026-09-30 2', exact: true }).count() === 1, 'Daily table shows the second reported date and count');
        check(await table.getByRole('row').count() === 3, 'Daily chart table contains only the reported dates');
      }
      await selectedTab('Overview').waitFor();
      check(await tabs.getByRole('tab').allTextContents().then(names => names.join('|') === 'Overview|Content|Audience|Connected sources|Earnings|Tools'), 'Analytics provides the six named sections in order');
      check(await panel.count() === 1, 'Overview mounts only one panel');
      check(await panel.locator('.creator-analytics-metric').count() === 3, 'Overview shows the three first-party metric cards');
      for (const [label, value] of [['Your posts', '3'], ['Likes received', '5'], ['Comments received', '2']]) {
        const card = panel.locator('.creator-analytics-metric').filter({ has: page.getByText(label, { exact: true }) });
        check(await card.locator('dd').innerText() === value, `${label} reflects the account report`);
      }
      check(await page.locator('.creator-analytics-source,#copyright-source').count() === 0, 'Overview does not mount source cards or the copyright form');
      await checkDailyPosts();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Analytics Overview fits the viewport');
      await page.screenshot({ path: path.join(output, `public-analytics-${width}.png`), fullPage: true });

      await tabs.getByRole('tab', { name: 'Overview', exact: true }).focus();
      await page.keyboard.press('ArrowRight');
      await selectedTab('Content').waitFor();
      check(await selectedTab('Content').evaluate(element => element === document.activeElement), 'ArrowRight focuses and activates the next tab');
      await checkDailyPosts();
      await tabs.getByRole('tab', { name: 'Content', exact: true }).focus();
      await page.keyboard.press('End');
      await selectedTab('Tools').waitFor();
      check(await selectedTab('Tools').evaluate(element => element === document.activeElement), 'End focuses and activates the final tab');
      await page.keyboard.press('Home');
      await selectedTab('Overview').waitFor();
      check(await selectedTab('Overview').evaluate(element => element === document.activeElement), 'Home focuses and activates the first tab');

      await selectTab('Audience');
      check(await panel.getByText(/unavailable/i).count() > 0, 'Audience states that audience data is unavailable');
      check(await panel.locator('.creator-analytics-metric').count() === 0, 'Audience does not invent demographic or reach metrics');
      check(await panel.getByRole('heading', { name: 'Posts over time', exact: true }).count() === 0, 'Audience does not substitute post counts for audience measurements');

      await selectTab('Connected sources');
      await page.getByText('1,800,000', { exact: true }).waitFor();
      const youtube = page.locator('.creator-analytics-source').filter({ has: page.getByRole('heading', { name: 'YouTube', exact: true }) });
      check(await youtube.getByText('Unavailable', { exact: true }).count() >= 2, 'Missing source engagement stays unavailable');
      check(await youtube.getByText('Estimated source revenue', { exact: true }).count() === 0, 'Source earnings are separated from engagement');
      await page.locator('#analytics-source-filter').selectOption('youtube');
      check(await page.locator('.creator-analytics-source').count() === 1, 'Source filter limits the section to the selected source');
      await page.locator('#analytics-source-filter').selectOption('reddit');
      check(await page.locator('.creator-analytics-source').getByRole('heading', { name: 'Reddit', exact: true }).count() === 1, 'Source filter can select a disconnected source without inventing metrics');
      await page.locator('#analytics-source-filter').selectOption('all');
      check(await page.locator('.creator-analytics-source').count() === 2, 'All sources restores the reported source cards');
      await page.getByRole('button', { name: 'Refresh sources', exact: true }).click();
      await page.getByText('Refresh finished. Each source shows its latest sync status.', { exact: true }).waitFor();
      check(refreshes === 1, 'Refresh submits exactly one request');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Connected source cards fit the viewport');
      await selectTab('Earnings');
      check(await panel.getByText('Unavailable', { exact: true }).count() >= 2, 'Unreported revenue remains unavailable for each source');
      check(await panel.getByText('1,800,000', { exact: true }).count() === 0, 'Earnings does not present source views as revenue');
      await selectTab('Tools');
      await page.locator('#copyright-source').selectOption('youtube');
      await page.getByLabel('Original post URL', { exact: true }).fill('https://www.youtube.com/watch?v=abcdefghijk');
      await page.getByLabel('Describe your concern', { exact: true }).fill('Synthetic copyright concern for browser smoke testing.');
      await page.getByRole('button', { name: 'Submit for review', exact: true }).click();
      await page.getByText('Your copyright concern was recorded for review.', { exact: true }).waitFor();
      await page.getByText('received', { exact: true }).waitFor();
      check(await page.getByRole('heading', { name: 'Deep learning insights', exact: true }).count() === 1, 'Learning status is visible without invented predictions');
      check(await page.getByRole('heading', { name: 'Connection safeguards', exact: true }).count() === 1, 'Tools retains connection safeguards');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Analytics Tools fits the viewport');
      await selectTab('Connected sources');
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
      console.log(`PASS: built public Vault and analytics at ${width}px; account isolation, ciphertext storage, section tabs, keyboard navigation, daily posts, source truth, refresh, reports, outage recovery, no runtime errors`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `public-vault-analytics-failure-${width}.png`), fullPage: true }).catch(() => {});
      throw error;
    } finally { await context.close(); }
  }
  console.log(`PASS: ${checks} production-bundle Vault and analytics checks`);
} finally { await browser.close(); await app.close(); }
