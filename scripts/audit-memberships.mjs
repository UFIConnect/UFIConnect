import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { hostedBillingUrl } from '../web/src/api/hostedBilling.mjs';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
app.seedUser(member('membership-audit', { name: 'Membership test member' }));
const server = await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
await fs.mkdir('.cache/audit-ui', { recursive: true });
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
try {
  for (const unsafe of ['http://checkout.stripe.com/test', 'https://checkout.stripe.com.evil.invalid/', 'https://user:pass@checkout.stripe.com/', 'javascript:alert(1)', 'https://evil.invalid/']) {
    assert.throws(() => hostedBillingUrl(unsafe)); checks++;
  }
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let status = { plan: 'free', resumeBuilderAddon: false, hasBillingAccount: false, subscriptions: [] };
    let ready = true; let checkoutUrl = 'https://evil.invalid/checkout'; const requests = [];
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' } });
      if (!['fetch', 'xhr'].includes(request.resourceType())) return url.origin === server.origin ? route.continue() : route.abort();
      const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
      const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true' };
      const fulfill = json => route.fulfill({ json, headers });
      if (endpoint === '/billing/status') return fulfill(status);
      if (endpoint === '/billing/config') return fulfill({ stripeConfigured: true, webhookConfigured: true, paymentsReady: ready, tiers: { pro: ready, business: false }, pricing: { pro: { active: true, display: '$19.94', currency: 'USD', interval: 'month', intervalCount: 1 } } });
      if (endpoint === '/billing/create-checkout-session') { requests.push(request.postDataJSON()); return fulfill({ url: checkoutUrl }); }
      if (endpoint === '/billing/create-portal-session') return fulfill({ url: 'https://billing.stripe.com/p/session/audit' });
      if (endpoint === '/profile') return fulfill({ ...app.fullProfile(app.users[0]), plan: status.plan });
      if (endpoint === '/feed') return fulfill({ posts: [], hasMore: false });
      if (endpoint === '/notifications') return fulfill({ notifications: [], unreadCount: 0 });
      return fulfill({ sources: [], posts: [], groups: [], connected: {}, items: [] });
    });
    await installAuditMember(page, app, 'membership-audit');
    await auditNavigate(page, server.origin + '/settings');
    const section = page.getByRole('region', { name: 'Free plan', exact: true });
    const upgrade = section.getByRole('button', { name: 'Upgrade', exact: true });
    await upgrade.click();
    const dialog = page.getByRole('dialog', { name: 'Upgrade UFIconnect' });
    await dialog.getByRole('button', { name: 'Choose Pro', exact: true }).waitFor();
    check(await dialog.getByText('$19.94', { exact: true }).isVisible(), 'Current Stripe price is visible');
    check(await dialog.getByText('every month', { exact: true }).isVisible(), 'Recurring interval is visible');
    check(await dialog.getByText(/Memberships renew automatically/).isVisible(), 'Recurring payment terms precede checkout');
    check(await dialog.getByRole('button', { name: 'Unavailable', exact: true }).isDisabled(), 'Unconfigured Business stays unavailable');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Membership modal fits ${width}px`);
    await page.screenshot({ path: `.cache/audit-ui/membership-${width}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Choose Pro', exact: true }).click();
    await page.getByText('Could not open secure billing. Please try again.', { exact: true }).waitFor();
    check(page.url().startsWith(server.origin), 'An untrusted checkout URL never receives the browser');
    assert.deepEqual(requests, [{ tier: 'pro' }]); checks++;
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    ready = false;
    await upgrade.click();
    await dialog.getByText('Membership checkout is currently unavailable. Please try again later.').waitFor();
    check(await dialog.getByRole('button', { name: 'Unavailable', exact: true }).first().isDisabled(), 'Unavailable processor disables checkout');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    status = { ...status, hasBillingAccount: true, subscriptions: [{ kind: 'plan', tier: 'pro', status: 'past_due', cancelAtPeriodEnd: false }] };
    await section.getByRole('button', { name: 'Check billing status', exact: true }).click();
    await section.getByText('past due', { exact: false }).waitFor();
    check(await section.getByRole('button', { name: 'Manage billing', exact: true }).isVisible(), 'Unpaid membership can recover through portal');
    check(await section.getByRole('button', { name: 'Upgrade', exact: true }).count() === 0, 'Recoverable subscriptions do not start a duplicate purchase');
    await page.goto(server.origin + '/settings?upgrade=success');
    await page.getByText(/Your membership is not active yet/).waitFor();
    check(await page.getByText(/Payment received/).count() === 0, 'Return URL cannot claim an unverified payment');
    check(await page.getByRole('heading', { name: 'Free plan', exact: true }).isVisible(), 'An unverified return URL cannot unlock a plan');
    status = { ...status, plan: 'pro', subscriptions: [{ kind: 'plan', tier: 'pro', status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: 1792713600 }] };
    await page.getByRole('heading', { name: 'Pro plan', exact: true }).waitFor();
    check(await page.getByText(/Your Pro membership is active/).isVisible(), 'Confirmed server status activates the membership UI');
    check(await page.getByText(/Cancellation scheduled for/).isVisible(), 'Scheduled cancellation is visible');
    check(errors.length === 0, `No browser errors at ${width}px: ${errors.join('; ')}`);
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true });
    localStorage.setItem('uficonnect.analytics.consent.v1', 'granted');
    localStorage.setItem('uficonnect.analytics.client.v1', 'previous-test-identifier');
  });
  const requests = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/analytics-bridge.html' || /google-analytics|googletagmanager/.test(url.hostname)) requests.push(url.href);
    return url.origin === server.origin ? route.continue() : route.fulfill({ status: 401, json: {} });
  });
  const page = await context.newPage();
  await page.goto(server.origin + '/privacy#analytics');
  await page.getByText(/Global Privacy Control is enabled in your browser/).waitFor();
  check(await page.getByRole('button', { name: 'Accept analytics', exact: true }).isDisabled(), 'GPC cannot be overridden by the consent button');
  check(requests.length === 0, 'GPC prevents all optional analytics requests');
  check(await page.evaluate(() => localStorage.getItem('uficonnect.analytics.client.v1')) === null, 'GPC clears the old analytics identifier');
  await context.close();
  await fs.writeFile('.cache/audit-ui/membership-results.json', JSON.stringify({ checks, widths: [1440, 390, 320], productionPayments: 'none; all billing requests intercepted', passed: true }, null, 2));
  console.log(`PASS: ${checks} membership and privacy browser checks.`);
} finally { await browser.close(); await server.close(); await app.close(); }
