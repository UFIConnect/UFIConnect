// Synthetic browser verification only. API reports deliberately model HTTPS;
// no production accounts, native VPN handlers, downloads or payments are used.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-web-protection');
const fixture = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {BrowserRouter, useLocation} from 'react-router-dom';
import {HelmetProvider} from 'react-helmet-async';
import {AuthProvider} from '/src/contexts/AuthContext.jsx';
import {ToastProvider} from '/src/contexts/ToastContext.jsx';
import {SavedItemsProvider} from '/src/contexts/SavedItemsContext.jsx';
import {setAccessToken, clearSession, getAccessToken} from '/src/auth/session.js';
import Vault from '/src/pages/Vault.jsx';
import Settings from '/src/pages/Settings.jsx';
import '/src/index.css';
setAccessToken('synthetic-account-a');
window.__webProtectionAudit = {clearSession, setAccessToken, getAccessToken};
function Fixture() {
  const location = useLocation();
  const [accountId, setAccountId] = useState('account-a');
  window.__webProtectionAudit.update = value => flushSync(() => {
    setAccessToken('synthetic-' + value); setAccountId(value);
  });
  return location.pathname === '/settings' ? React.createElement(Settings) : React.createElement(Vault, {accountId});
}
createRoot(document.getElementById('root')).render(React.createElement(HelmetProvider, null,
  React.createElement(BrowserRouter, null, React.createElement(AuthProvider, null,
    React.createElement(SavedItemsProvider, null, React.createElement(ToastProvider, null, React.createElement(Fixture)))))));`;
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api'),
    'import.meta.env.VITE_AUTH0_DOMAIN': JSON.stringify(''), 'import.meta.env.VITE_AUTH0_CLIENT_ID': JSON.stringify('') },
  plugins: [{ name: 'web-protection-fixture',
    resolveId(id) { if (id === 'virtual:web-protection-audit.jsx') return '\0virtual:web-protection-audit.jsx'; },
    load(id) { if (id === '\0virtual:web-protection-audit.jsx') return fixture; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (!['/vault', '/settings'].includes(new URL(req.url, 'http://fixture.invalid').pathname)) return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Web protection audit</title></head><body><div id="root"></div><script type="module" src="/@id/virtual:web-protection-audit.jsx"></script></body></html>'));
    }); },
  }], server: { host: '127.0.0.1', port: 5267, strictPort: false } });

const report = () => ({ scope: 'uficonnect-web', transport: { encrypted: true, protocol: 'https' }, session: { verified: true },
  protections: { revocableSession: true, privateResponses: true, privateMessages: true, validatedImports: true }, checkedAt: new Date().toISOString() });
let browser, checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
try {
  await fs.mkdir(output, { recursive: true });
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const device of [
    { name: 'windows', width: 1440, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' },
    { name: 'iphone', width: 390, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' },
  ]) {
    const context = await browser.newContext({ viewport: { width: device.width, height: 1000 }, userAgent: device.userAgent, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await page.clock.install();
    const errors = [], requests = [], downloads = [];
    let mode = 'https', subscriptionMode = 'unpaid', expiresAt = 0, calls = 0, held = null, release;
    let billingHeld = null, releaseBilling;
    page.on('pageerror', error => errors.push(error.message));
    page.on('download', download => downloads.push(download.suggestedFilename()));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(base).origin) return route.fulfill({ status: 403, body: 'External requests disabled in synthetic audit.' });
      if (!url.pathname.startsWith('/api/')) return route.continue();
      requests.push({ path: url.pathname, method: request.method() });
      const owner = String(request.headers().authorization || '').replace('Bearer synthetic-', '') || 'account-a';
      if (['/api/security/web-connection', '/api/security/vault-connection'].includes(url.pathname)) {
        calls++;
        const captured = mode;
        if (held) await held;
        if (captured === 'error') return route.fulfill({ status: 503, json: { message: 'Synthetic unavailable' } }).catch(() => {});
        if (captured === 'unauthenticated') return route.fulfill({ status: 401, json: { message: 'Synthetic session expired' } }).catch(() => {});
        const value = captured === 'malformed' ? { connected: true } : report();
        if (captured === 'http') value.transport = { encrypted: false, protocol: 'http' };
        if (captured === 'unverified') value.session.verified = false;
        return route.fulfill({ json: value }).catch(() => {});
      }
      if (url.pathname === '/api/profile') return route.fulfill({ json: { id: owner, name: 'Synthetic Member', email: 'synthetic@example.invalid', plan: 'free', onboardingComplete: true, preferences: {}, roleSettings: {} } });
      if (url.pathname === '/api/billing/status') {
        const paid = owner !== 'account-b' && subscriptionMode !== 'unpaid';
        const value = { plan: 'free', vpnConnectorAddon: paid, subscriptions: paid ? [{ kind: 'vpn_connector',
          status: subscriptionMode === 'trial' ? 'trialing' : 'active',
          currentPeriodEnd: subscriptionMode === 'expired' ? 1 : subscriptionMode === 'expiring' ? expiresAt : Math.floor(Date.now() / 1000) + 3600 }] : [] };
        if (billingHeld && owner === 'account-a') await billingHeld;
        return route.fulfill({ json: value }).catch(() => {});
      }
      if (url.pathname === '/api/billing/config') return route.fulfill({ json: { paymentsReady: false, tiers: {}, pricing: {} } });
      if (url.pathname === '/api/profile/security') return route.fulfill({ json: { passwordChangeAvailable: true, serverSessionRevocation: true, multiFactorAvailable: false } });
      if (url.pathname === '/api/auth/providers') return route.fulfill({ json: { providers: {} } });
      if (url.pathname === '/api/auth/providers/linked') return route.fulfill({ json: { methods: [], passwordAvailable: true } });
      if (url.pathname === '/api/security/vault/status') return route.fulfill({ json: { phase: 'software-prototype', available: false, state: 'disabled' } });
      return route.fulfill({ json: { postIds: [], jobs: [], users: [], notifications: [], totalUnread: 0, unreadMessages: 0, unreadNotifications: 0 } });
    });

    await page.goto(base + 'vault#vpn');
    const panel = page.locator('.web-protection-panel');
    const status = panel.getByRole('status');
    const refresh = panel.getByRole('button', { name: 'Check protection', exact: true });
    const monitoring = panel.getByRole('switch', { name: 'Vault connection monitoring', exact: true });
    await status.filter({ hasText: 'Subscription required' }).waitFor();
    check(await panel.getByRole('heading', { name: 'Web protection' }).isVisible(), `${device.name}: browser Vault shows web protection`);
    check(await panel.getByText('No app, profile or download is needed.', { exact: false }).isVisible(), `${device.name}: download-free browser scope explained`);
    check(await page.getByRole('button', { name: /Get VPN profile|Connect VPN|Enable VPN/ }).count() === 0, `${device.name}: no native VPN action in ordinary browser visit`);
    check(await page.getByRole('link', { name: /Download Windows preview|Get official WireGuard|Download VPN profile/ }).count() === 0, `${device.name}: no connection download offered`);
    check(await monitoring.getAttribute('aria-checked') === 'false' && await monitoring.isDisabled() && await refresh.isDisabled(), `${device.name}: unpaid Vault cannot enable monitoring or claim protection`);
    check(calls === 0, `${device.name}: unpaid Vault starts no connection monitoring requests`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${device.name}: Vault does not overflow the viewport`);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, device.name + '-vault.png'), fullPage: true });

    const subscriptionRefresh = page.getByRole('button', { name: 'Check subscription status', exact: true });
    for (const value of ['trial', 'expired']) {
      subscriptionMode = value;
      await subscriptionRefresh.click();
      await status.filter({ hasText: 'Subscription required' }).waitFor();
      check(await monitoring.isDisabled() && await monitoring.getAttribute('aria-checked') === 'false' && calls === 0,
        `${device.name}: ${value} billing flags cannot activate monitoring`);
      check(await page.locator('.vault-vpn-subscription [role="status"]').filter({ hasText: /^Active/ }).count() === 0,
        `${device.name}: ${value} membership is never presented as active`);
    }
    subscriptionMode = 'expiring'; expiresAt = Math.floor(await page.evaluate(() => Date.now()) / 1000) + 3;
    await subscriptionRefresh.click();
    await status.filter({ hasText: 'Protected' }).waitFor();
    await page.clock.fastForward(3500);
    await status.filter({ hasText: 'Subscription required' }).waitFor();
    check(await monitoring.isDisabled() && await monitoring.getAttribute('aria-checked') === 'false', `${device.name}: period expiry stops monitoring without waiting for the minute poll`);
    subscriptionMode = 'paid';
    await subscriptionRefresh.click();
    await status.filter({ hasText: 'Protected' }).waitFor();

    check(await monitoring.getAttribute('aria-checked') === 'true' && await monitoring.isEnabled(), `${device.name}: Vault monitoring starts On`);
    check(await panel.getByText('HTTPS, Vault encryption and account security stay active.', { exact: false }).isVisible(), `${device.name}: pausing monitoring preserves security`);
    held = new Promise(resolve => { release = resolve; });
    const [pendingMonitoringRequest] = await Promise.all([
      page.waitForRequest(request => new URL(request.url()).pathname === '/api/security/vault-connection'), refresh.click(),
    ]);
    await status.filter({ hasText: 'Checking protection' }).waitFor();
    check(await monitoring.isEnabled(), `${device.name}: monitoring can be stopped during a pending check`);
    const cancelledMonitoringRequest = page.waitForEvent('requestfailed', { predicate: request => request === pendingMonitoringRequest });
    await monitoring.click();
    await status.filter({ hasText: 'Monitoring paused' }).waitFor();
    check(await monitoring.getAttribute('aria-checked') === 'false' && await refresh.isDisabled(), `${device.name}: Off pauses checks and disables manual refresh`);
    release(); held = null;
    await cancelledMonitoringRequest;
    check(/abort|cancel/i.test(pendingMonitoringRequest.failure()?.errorText || ''), `${device.name}: Off aborts the pending network request`);
    await page.waitForTimeout(100);
    check(await status.filter({ hasText: 'Protected' }).count() === 0 && await panel.locator('time').count() === 0,
      `${device.name}: delayed report cannot restore paused verification`);
    const pausedCalls = calls;
    await refresh.evaluate(button => button.click());
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('offline'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(60001);
    await page.waitForTimeout(100);
    check(calls === pausedCalls, `${device.name}: manual refresh, focus, connection events, visibility and polling do not check while Off`);
    check(await status.filter({ hasText: 'Monitoring paused' }).isVisible() && await panel.getByRole('alert').count() === 0,
      `${device.name}: paused connection events do not create errors`);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, device.name + '-vault-monitoring-off.png'), fullPage: true });
    check(await page.evaluate(() => localStorage.getItem('ufi:vault-monitoring:account-a')) === 'off', `${device.name}: Off preference belongs to the current account`);
    await page.reload();
    await status.filter({ hasText: 'Monitoring paused' }).waitFor();
    await page.waitForTimeout(100);
    check(await monitoring.getAttribute('aria-checked') === 'false' && calls === pausedCalls, `${device.name}: reload restores Off without a request`);
    await page.evaluate(() => window.__webProtectionAudit.update('account-c'));
    await status.filter({ hasText: 'Protected' }).waitFor();
    check(await monitoring.getAttribute('aria-checked') === 'true' && calls > pausedCalls, `${device.name}: another account defaults On and gets its own report`);
    const otherAccountCalls = calls;
    await page.evaluate(() => window.__webProtectionAudit.update('account-a'));
    await status.filter({ hasText: 'Monitoring paused' }).waitFor();
    await page.waitForTimeout(100);
    check(await monitoring.getAttribute('aria-checked') === 'false' && calls === otherAccountCalls, `${device.name}: returning to the paused account restores its isolated preference`);
    await monitoring.click();
    await status.filter({ hasText: 'Protected' }).waitFor();
    check(await monitoring.getAttribute('aria-checked') === 'true' && calls > otherAccountCalls, `${device.name}: On obtains a fresh report`);

    const firstCalls = calls;
    await refresh.click(); await status.filter({ hasText: 'Protected' }).waitFor();
    check(calls > firstCalls, `${device.name}: refresh obtains a fresh server report`);
    for (const failure of ['http', 'unverified', 'malformed', 'error']) {
      mode = failure;
      await refresh.click();
      await status.filter({ hasText: 'Needs attention' }).waitFor();
      check(await status.filter({ hasText: 'Protected' }).count() === 0, `${device.name}: ${failure} cannot claim protection`);
      mode = 'https'; await refresh.click(); await status.filter({ hasText: 'Protected' }).waitFor();
    }

    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await status.filter({ hasText: 'Needs attention' }).waitFor();
    check(await panel.getByRole('alert').filter({ hasText: 'offline' }).isVisible(), `${device.name}: offline immediately clears verified status`);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await status.filter({ hasText: 'Protected' }).waitFor();

    held = new Promise(resolve => { release = resolve; });
    const beforeHeld = calls;
    await refresh.click();
    await page.waitForFunction(count => window.__webProtectionAudit != null && document.querySelector('.web-protection-status')?.textContent.includes('Checking protection'), beforeHeld);
    await page.evaluate(() => window.__webProtectionAudit.update('account-b'));
    check(await status.filter({ hasText: 'Protected' }).count() === 0, `${device.name}: account switch immediately clears previous verification`);
    release(); held = null;
    await status.filter({ hasText: 'Subscription required' }).waitFor();
    check(await monitoring.isDisabled() && await monitoring.getAttribute('aria-checked') === 'false', `${device.name}: an unpaid account cannot inherit a delayed paid connection report`);
    await page.evaluate(() => window.__webProtectionAudit.update('account-a'));
    await status.filter({ hasText: 'Protected' }).waitFor();

    billingHeld = new Promise(resolve => { releaseBilling = resolve; });
    const [pendingBilling] = await Promise.all([
      page.waitForRequest(request => new URL(request.url()).pathname === '/api/billing/status'), subscriptionRefresh.click(),
    ]);
    await status.filter({ hasText: 'Protected' }).waitFor();
    check(await monitoring.isEnabled() && await subscriptionRefresh.isDisabled(), `${device.name}: a routine billing recheck retains bounded verified monitoring`);
    const cancelledBilling = page.waitForEvent('requestfailed', { predicate: request => request === pendingBilling });
    await page.evaluate(() => window.__webProtectionAudit.update('account-b'));
    await status.filter({ hasText: 'Subscription required' }).waitFor();
    releaseBilling(); billingHeld = null;
    await cancelledBilling;
    await page.waitForTimeout(100);
    check(await status.filter({ hasText: 'Protected' }).count() === 0 && await monitoring.isDisabled(), `${device.name}: a delayed paid billing response cannot activate another account`);
    await page.evaluate(() => window.__webProtectionAudit.update('account-a'));
    await status.filter({ hasText: 'Protected' }).waitFor();

    held = new Promise(resolve => { release = resolve; });
    await refresh.click();
    await page.evaluate(() => window.__webProtectionAudit.clearSession());
    await status.filter({ hasText: 'Sign in to check' }).waitFor();
    release(); held = null;
    await page.waitForTimeout(100);
    check(await status.filter({ hasText: 'Protected' }).count() === 0 && await refresh.isDisabled(), `${device.name}: delayed report after logout cannot restore protection`);
    check(await monitoring.isDisabled(), `${device.name}: signed-out users cannot change monitoring`);

    await page.evaluate(() => window.__webProtectionAudit.update('account-a'));
    await status.filter({ hasText: 'Protected' }).waitFor();
    await monitoring.click();
    await status.filter({ hasText: 'Monitoring paused' }).waitFor();

    await page.goto(base + 'settings?tab=security');
    await panel.getByRole('heading', { name: 'Web protection' }).waitFor();
    await status.filter({ hasText: 'Protected' }).waitFor();
    check(await refresh.isEnabled(), `${device.name}: Settings security tab uses the same automatic protection control`);
    check(await panel.getByRole('switch').count() === 0, `${device.name}: Settings remains automatic without the Vault switch`);
    check(await page.evaluate(() => localStorage.getItem('ufi:vault-monitoring:account-a')) === 'off', `${device.name}: Settings checks remain active while Vault monitoring is Off`);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, device.name + '-settings.png'), fullPage: true });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${device.name}: Settings does not overflow the viewport`);

    mode = 'unauthenticated'; await refresh.click();
    await page.waitForFunction(() => window.__webProtectionAudit.getAccessToken() === null);
    check(await status.filter({ hasText: 'Protected' }).count() === 0, `${device.name}: revoked session cannot verify protection`);

    mode = 'https';
    await page.addInitScript(() => {
      const originalGet = Storage.prototype.getItem, originalSet = Storage.prototype.setItem;
      Storage.prototype.getItem = function (key) {
        if (String(key).startsWith('ufi:vault-monitoring:')) throw new DOMException('Storage unavailable', 'SecurityError');
        return originalGet.call(this, key);
      };
      Storage.prototype.setItem = function (key, value) {
        if (String(key).startsWith('ufi:vault-monitoring:')) throw new DOMException('Storage unavailable', 'QuotaExceededError');
        return originalSet.call(this, key, value);
      };
    });
    await page.goto(base + 'vault#vpn');
    await status.filter({ hasText: 'Protected' }).waitFor();
    check(await monitoring.getAttribute('aria-checked') === 'true', `${device.name}: blocked preference reads safely default On`);
    await monitoring.click();
    await status.filter({ hasText: 'Monitoring paused' }).waitFor();
    check(await monitoring.getAttribute('aria-checked') === 'false' && await refresh.isDisabled(), `${device.name}: blocked preference writes still allow Off`);
    const blockedStorageCalls = calls;
    await monitoring.click();
    await status.filter({ hasText: 'Protected' }).waitFor();
    check(await monitoring.getAttribute('aria-checked') === 'true' && calls > blockedStorageCalls, `${device.name}: blocked storage still allows On and a fresh report`);
    check(requests.every(value => !value.path.startsWith('/api/vpn/')), `${device.name}: no VPN API, profile or native handoff requests`);
    check(downloads.length === 0, `${device.name}: no download events`);
    check(errors.length === 0, `${device.name}: no browser errors (${errors.join('; ')})`);
    await context.close();
  }
  const summary = { checks, devices: ['Windows 1440px', 'iPhone 390px'], pages: ['/vault#vpn', '/settings?tab=security'], syntheticApiReports: true };
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`PASS: ${checks} synthetic web protection browser checks`);
} finally {
  await browser?.close();
  await server.close();
}
