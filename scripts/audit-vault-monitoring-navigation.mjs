// Production provider tree, synthetic sessions and billing. No provider writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-vault-monitoring-navigation');
const report = () => ({ scope: 'uficonnect-web', transport: { encrypted: true, protocol: 'https' }, session: { verified: true },
  protections: { revocableSession: true, privateResponses: true, privateMessages: true, validatedImports: true }, checkedAt: new Date().toISOString() });
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const server = process.env.UFI_VAULT_AUDIT_ORIGIN ? { origin: process.env.UFI_VAULT_AUDIT_ORIGIN, close: async () => {} } : await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
const results = [];
try {
  await fs.mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    await page.clock.install();
    await page.addInitScript(() => {
      localStorage.setItem('uficonnect.ads.consent.v1', 'denied');
      localStorage.setItem('uficonnect.analytics.consent.v1', 'denied');
    });
    const errors = [], writes = [];
    let member = 'account-a', session = true, mode = 'paid', until = 0, serverDenied = false, monitoringCalls = 0, billingCalls = 0, held, release;
    const profile = () => ({ id: member, name: 'Synthetic member', email: 'monitoring@example.invalid', plan: 'free', onboardingComplete: true,
      joinedGroups: [], skills: [], preferences: { interests: [], goals: [] }, roleSettings: {}, connectedAccounts: {} });
    const paid = () => mode === 'paid' && member !== 'account-b';
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const isApi = /^(?:\/api\/|\/fallback\/)/.test(url.pathname) || ['xhr', 'fetch', 'eventsource'].includes(request.resourceType()) && !url.pathname.startsWith('/assets/');
      if (!isApi) return url.origin === server.origin && request.method() === 'GET' ? route.continue() : route.abort();
      const pathname = url.pathname.replace(/^\/(?:api|fallback)(?=\/)/, '');
      const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-UFI-Device-Location', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Cache-Control': 'private, no-store' };
      const send = (json, status = 200) => route.fulfill({ status, headers, json }).catch(() => {});
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (/events|stream/.test(pathname)) return route.abort();
      if (pathname === '/auth/session') return send(session ? { token: 'synthetic-' + member, profile: profile() } : {}, session ? 200 : 401);
      if (pathname === '/auth/login') { session = true; return send({ token: 'synthetic-' + member, profile: profile() }); }
      if (pathname === '/auth/logout') { session = false; return send({ ok: true, revoked: true }); }
      if (pathname === '/profile' || pathname === '/auth/me') return send(profile());
      if (pathname === '/billing/config') return send({ paymentsReady: false, tiers: {}, pricing: {} });
      if (pathname === '/billing/status') {
        billingCalls++;
        return send({ plan: 'free', vpnConnectorAddon: paid(), subscriptions: paid() ? [{ kind: 'vpn_connector', status: 'active',
          currentPeriodEnd: until || Math.floor(Date.now() / 1000) + 3600 }] : [] });
      }
      if (pathname === '/security/vault-connection') {
        monitoringCalls++; const allowed = paid() && !serverDenied, captured = report();
        if (held) await held;
        return send(allowed ? captured : { message: 'An active paid Vault membership is required.' }, allowed ? 200 : 403);
      }
      if (pathname === '/security/web-connection') return send(report());
      if (pathname === '/profile/security') return send({ passwordChangeAvailable: true, serverSessionRevocation: true, multiFactorAvailable: false });
      if (pathname === '/security/vault/status') return send({ phase: 'software-prototype', available: false, state: 'disabled' });
      if (request.method() !== 'GET' && !/analytics|telemetry|metrics/.test(pathname)) { writes.push(pathname); return send({ message: 'Writes disabled in synthetic audit.' }, 409); }
      return send({ ok: true, postIds: [], jobs: [], users: [], sources: [], groups: [], posts: [], snaps: [], messages: [], conversations: [], notifications: [], comments: [], requests: [],
        hasMore: false, totalUnread: 0, unreadMessages: 0, unreadNotifications: 0, connected: {}, methods: [], providers: {} });
    });
    const navigate = async (destination, selector) => {
      await page.evaluate(value => { history.pushState({}, '', value); window.dispatchEvent(new PopStateEvent('popstate')); }, destination);
      await page.locator(selector).waitFor({ state: 'visible' });
    };
    const vault = () => navigate('/vault#vpn', '.vault-page');
    const panel = page.locator('.web-protection-panel').first();
    const status = panel.locator('.web-protection-status');
    const monitoring = panel.getByRole('switch', { name: 'Vault connection monitoring', exact: true });
    const protectedStatus = () => status.filter({ hasText: /^Protected$/ }).waitFor();
    const lockedStatus = () => status.filter({ hasText: /^Subscription required$/ }).waitFor();
    await page.goto(server.origin + '/vault#vpn');
    await protectedStatus();
    check(await monitoring.getAttribute('aria-checked') === 'true', `${width}: paid monitor defaults On`);
    const initialBilling = billingCalls;
    await navigate('/?feed=ufi', '.home-feed-layout');
    check(await page.locator('.vault-page').count() === 0 && billingCalls === initialBilling, `${width}: navigation unmounts Vault without recreating billing`);
    for (const [destination, selector] of [['/messages', '.messages-header'], ['/settings', '.page-header']]) {
      await navigate(destination, selector);
      const before = monitoringCalls;
      await page.clock.fastForward(61000);
      await page.waitForTimeout(150);
      check(monitoringCalls > before, `${width}: shared Vault monitor keeps checking on ${destination}`);
    }
    await vault(); await protectedStatus();
    check(await monitoring.getAttribute('aria-checked') === 'true', `${width}: returning to Vault retains On`);
    await monitoring.click();
    await status.filter({ hasText: /^Monitoring paused$/ }).waitFor();
    const paused = monitoringCalls;
    await navigate('/?feed=ufi', '.home-feed-layout');
    await page.clock.fastForward(61000); await page.waitForTimeout(100);
    check(monitoringCalls === paused, `${width}: Off pauses global monitoring on other pages`);
    await vault(); await status.filter({ hasText: /^Monitoring paused$/ }).waitFor();
    check(await monitoring.getAttribute('aria-checked') === 'false', `${width}: returning to Vault retains Off`);
    await monitoring.click(); await protectedStatus();
    mode = 'unpaid';
    await navigate('/messages', '.messages-header');
    await page.clock.fastForward(61000); await page.waitForTimeout(150);
    await vault(); await lockedStatus();
    check(await monitoring.isDisabled(), `${width}: membership cancellation locks the monitor across navigation`);
    const locked = monitoringCalls;
    await navigate('/?feed=ufi', '.home-feed-layout');
    await page.clock.fastForward(61000); await page.waitForTimeout(100);
    check(monitoringCalls === locked, `${width}: unpaid monitoring stays stopped`);
    await vault(); await lockedStatus();
    mode = 'paid'; until = Math.floor(await page.evaluate(() => Date.now()) / 1000) + 5;
    await page.getByRole('button', { name: 'Check subscription status', exact: true }).click(); await protectedStatus();
    await navigate('/messages', '.messages-header');
    await page.clock.fastForward(6100); await page.waitForTimeout(100);
    await vault(); await lockedStatus();
    check(await monitoring.isDisabled(), `${width}: paid period expiry stops monitoring before the minute poll`);
    until = Math.floor(await page.evaluate(() => Date.now()) / 1000) + 3600;
    await page.getByRole('button', { name: 'Check subscription status', exact: true }).click(); await protectedStatus();
    serverDenied = true;
    await panel.getByRole('button', { name: 'Check protection', exact: true }).click(); await lockedStatus();
    check(await monitoring.isDisabled(), `${width}: server denial overrides a paid client billing report`);
    const deniedCalls = monitoringCalls;
    await navigate('/messages', '.messages-header');
    await page.clock.fastForward(61000); await page.waitForTimeout(100);
    check(monitoringCalls === deniedCalls, `${width}: stale client billing cannot restart server-denied monitoring`);
    await vault(); await lockedStatus(); serverDenied = false;
    await page.getByRole('button', { name: 'Check subscription status', exact: true }).click(); await protectedStatus();
    held = new Promise(resolve => { release = resolve; });
    const [pending] = await Promise.all([page.waitForRequest(request => /\/security\/vault-connection$/.test(new URL(request.url()).pathname)),
      panel.getByRole('button', { name: 'Check protection', exact: true }).click()]);
    const cancelled = page.waitForEvent('requestfailed', { predicate: request => request === pending });
    // Same UI logout handler on both viewports; hidden desktop button avoids opening unrelated menus.
    await page.locator('.sidebar-logout--danger').evaluate(button => button.click());
    await cancelled; release(); held = null;
    await page.waitForURL('**/login');
    const loggedOut = monitoringCalls;
    await page.clock.fastForward(61000); await page.waitForTimeout(100);
    check(monitoringCalls === loggedOut && /abort|cancel/i.test(pending.failure()?.errorText || ''), `${width}: sign-out aborts in-flight reports and stops checks`);
    member = 'account-b';
    await page.locator('#login-email').fill('monitoring@example.invalid');
    await page.locator('#login-password').fill('SyntheticPassword123!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForURL(url => url.pathname !== '/login');
    await vault(); await lockedStatus();
    check(await monitoring.isDisabled() && monitoringCalls === loggedOut, `${width}: a free account cannot inherit the previous member report`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}: no horizontal overflow`);
    check(errors.length === 0, `${width}: no browser exceptions: ${errors.join('; ')}`);
    check(writes.length === 0, `${width}: no provider or account writes: ${writes.join(', ')}`);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `${width}-vault-locked.png`), fullPage: true });
    results.push({ width, monitoringCalls, billingCalls, errors, writes });
    await context.close();
  }
  await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify({ origin: server.origin, checks, results }, null, 2));
  console.log(`Vault monitoring navigation passed ${checks} checks on desktop and mobile.`);
} finally { await browser.close(); await server.close(); }
