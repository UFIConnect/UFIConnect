// Exercise production assets and real opener controls with synthetic Stripe
// destinations. Optional hosted run: UFI_BILLING_AUDIT_ORIGIN=https://uficonnect.org
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
const server = process.env.UFI_BILLING_AUDIT_ORIGIN
  ? { origin: new URL(process.env.UFI_BILLING_AUDIT_ORIGIN).origin, close: async () => {} }
  : await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const output = '.cache/audit-ui/billing-return';
const results = [];
const price = (amount, intervalCount = 1) => ({ active: true, matchesRequiredPrice: true,
  display: '$' + (amount / 100).toFixed(2), unitAmount: amount, currency: 'USD', interval: 'month', intervalCount });
const billingConfig = { stripeConfigured: true, webhookConfigured: true, paymentsReady: true,
  tiers: { pro: true, business: true, business_team: true, vpn_connector: true, resume_builder_monthly: true, resume_builder: true },
  pricing: { pro: price(1994), business: price(19994), business_team: price(1994), vpn_connector: price(394),
    resume_builder_monthly: price(3000), resume_builder: price(14994, 6) } };
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const cleanPath = value => {
  const url = new URL(value);
  url.searchParams.delete('upgrade');
  return url.pathname + url.search + url.hash;
};

try {
  await fs.mkdir(output, { recursive: true });
  for (const width of [1440, 390]) {
    for (const surface of ['command', 'settings', 'vault', 'resume']) {
      const userId = `billing-return-${surface}-${width}`;
      const user = member(userId, { name: 'Synthetic billing member', organization: 'Fixture Recruiting',
        resumeBuilderAddon: false, vpnConnectorAddon: false });
      app.seedUser(user);
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      const errors = [], requests = [], forbidden = [];
      let billingReads = 0, profileReads = 0, sequence = 0, stripeReturn;
      let outcome = 'success';
      page.on('pageerror', error => errors.push(error.message));
      const status = () => ({ plan: user.plan, effectivePlan: user.plan,
        resumeBuilderAddon: user.resumeBuilderAddon, vpnConnectorAddon: user.vpnConnectorAddon,
        hasBillingAccount: user.plan !== 'free' || user.resumeBuilderAddon || user.vpnConnectorAddon,
        businessSeats: user.plan === 'business' ? 1 : 0,
        subscriptions: [
          ...(user.plan !== 'free' ? [{ kind: 'plan', tier: user.plan, status: 'active' }] : []),
          ...(user.vpnConnectorAddon ? [{ kind: 'vpn_connector', status: 'active', currentPeriodEnd: Math.floor(Date.now() / 1000) + 3600 }] : []),
          ...(user.resumeBuilderAddon ? [{ kind: 'resume_builder', status: 'active', currentPeriodEnd: Math.floor(Date.now() / 1000) + 3600 }] : []),
        ] });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) {
          assert.ok(stripeReturn, 'A real opener created the synthetic Stripe destination');
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><h1>Synthetic Stripe</h1><a href="${escapeHtml(stripeReturn)}">Return to app</a></body></html>` });
        }
        const api = /^(?:\/api\/|\/fallback\/)/.test(url.pathname)
          || ['fetch', 'xhr', 'eventsource'].includes(request.resourceType()) && !url.pathname.startsWith('/assets/');
        if (!api) return url.origin === server.origin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort();
        const endpoint = url.pathname.replace(/^\/(?:api|fallback)(?=\/)/, '');
        const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-UFI-Device-Location',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Cache-Control': 'private, no-store' };
        const send = (json, code = 200) => route.fulfill({ status: code, headers, json });
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (/events|stream/.test(endpoint)) return route.abort();
        if (endpoint === '/profile') { profileReads++; return send(app.fullProfile(user)); }
        if (endpoint === '/billing/status') { billingReads++; return send(status()); }
        if (endpoint === '/billing/config') return send(billingConfig);
        if (['/billing/create-checkout-session', '/billing/create-portal-session'].includes(endpoint)) {
          const body = request.postDataJSON();
          requests.push({ endpoint, body });
          assert.equal(typeof body.returnPath, 'string', 'Billing opener sends its current relative return path');
          assert.ok(body.returnPath.startsWith('/') && !body.returnPath.startsWith('//'));
          const returned = new URL(body.returnPath, server.origin);
          assert.equal(returned.origin, server.origin);
          const portal = endpoint.endsWith('create-portal-session');
          if (!portal) returned.searchParams.set('upgrade', outcome);
          stripeReturn = returned.href;
          return send({ url: `https://${portal ? 'billing' : 'checkout'}.stripe.com/${portal ? 'p/session' : 'c/pay'}/billing-return-${++sequence}` });
        }
        if (endpoint === '/resume-builder/draft') return send({ template: 'modern', data: {} });
        if (endpoint === '/generation/usage') return send({ period: { startsAt: new Date().toISOString(), resetsAt: new Date(Date.now() + 86400000).toISOString() },
          limits: Object.fromEntries([['image', 50], ['video', 20], ['resume', 30]].map(([kind, limit]) => [kind, { limit, used: 0, remaining: limit }])) });
        if (endpoint === '/business/team') return send({ role: user.plan === 'business' ? 'owner' : 'none', active: user.plan === 'business', seats: user.plan === 'business' ? 1 : 0, used: 1, members: [], invitations: [] });
        if (endpoint === '/security/vault/status') return send({ phase: 'software-prototype', state: 'disabled', available: false });
        if (endpoint === '/security/vault-connection' || endpoint === '/security/web-connection') return send({
          secureTransport: true, account: { signedIn: true }, protections: { revocableSession: true, privateResponses: true, privateMessages: true, validatedImports: true }, checkedAt: new Date().toISOString(),
        }, endpoint === '/security/vault-connection' && !user.vpnConnectorAddon ? 403 : 200);
        if (request.method() !== 'GET' && !/analytics|telemetry|metrics|engaged|engagement-signal/.test(endpoint)) {
          forbidden.push(endpoint); return send({ message: 'Writes disabled in synthetic audit.' }, 409);
        }
        return send({ auth0: { enabled: false }, sources: [], posts: [], groups: [], connected: {}, platforms: {}, jobs: [], opportunities: [],
          members: [], users: [], invitations: [], items: [], methods: [], providers: {}, notifications: [], unreadCount: 0,
          messages: [], conversations: [], requests: [], attachments: [], snaps: [], postIds: [], hasMore: false });
      });
      await installAuditMember(page, app, userId);
      const paths = {
        command: '/command-center?tab=yourfeed&view=published#source-posts',
        settings: '/settings?section=membership&view=account#membership-settings-title',
        vault: '/vault?section=passwords&view=account#vpn-subscription-title',
        resume: '/resume-builder?tab=cover-letter&view=draft#writing',
      };
      const destination = paths[surface];
      const waitSurface = async () => {
        if (surface === 'command') await page.getByRole('heading', { name: 'Command Center', exact: true }).waitFor();
        if (surface === 'settings') await page.getByRole('heading', { name: `${user.plan === 'business' ? 'Business' : user.plan === 'pro' ? 'Pro' : 'Free'} plan`, exact: true }).waitFor();
        if (surface === 'vault') await page.locator('.vault-page').waitFor();
        if (surface === 'resume') await page.getByRole('heading', { name: 'Resume Builder', exact: true }).first().waitFor();
      };
      const visit = async () => { await auditNavigate(page, server.origin + destination); await waitSurface(); };
      const assertReturned = async () => {
        await waitSurface();
        assert.equal(cleanPath(page.url()), destination, 'The original route, query and hash survive the Stripe return');
      };
      const checkout = async (expectedBody, action, result, grant = () => {}) => {
        outcome = result;
        const launchUrl = new URL(page.url());
        const launchPath = launchUrl.pathname + launchUrl.search + launchUrl.hash;
        await action();
        await page.waitForURL(url => url.hostname === 'checkout.stripe.com');
        assert.deepEqual(requests.at(-1), { endpoint: '/billing/create-checkout-session', body: { ...expectedBody, returnPath: launchPath } });
        const reads = billingReads;
        grant();
        await Promise.all([
          page.waitForResponse(response => /\/(?:api\/|fallback\/)?billing\/status$/.test(new URL(response.url()).pathname)),
          page.getByRole('link', { name: 'Return to app', exact: true }).click(),
        ]);
        await page.waitForURL(url => url.origin === server.origin);
        await assertReturned();
        await page.waitForFunction(() => !Array.from(document.querySelectorAll('.splash')).some(element => element.getClientRects().length));
        assert.ok(billingReads > reads, 'Returning from checkout reads authoritative billing status');
      };
      const portal = async action => {
        const launchUrl = new URL(page.url());
        const launchPath = launchUrl.pathname + launchUrl.search + launchUrl.hash;
        await action();
        await page.waitForURL(url => url.hostname === 'billing.stripe.com');
        assert.deepEqual(requests.at(-1), { endpoint: '/billing/create-portal-session', body: { returnPath: launchPath } });
        assert.equal(await page.getByRole('link', { name: 'Return to app', exact: true }).getAttribute('href'), server.origin + launchPath,
          'Portal returns to the exact captured route without adding a checkout result');
        const reads = billingReads;
        await Promise.all([
          page.waitForResponse(response => /\/(?:api\/|fallback\/)?billing\/status$/.test(new URL(response.url()).pathname)),
          page.getByRole('link', { name: 'Return to app', exact: true }).click(),
        ]);
        await page.waitForURL(url => url.origin === server.origin);
        await assertReturned();
        assert.ok(billingReads > reads, 'Portal return refreshes authoritative billing status');
      };
      const reload = async () => { await page.reload({ waitUntil: 'domcontentloaded' }); await assertReturned(); };
      await visit();
      if (surface === 'command' || surface === 'settings') {
        const choose = async tier => {
          await page.getByRole('button', { name: surface === 'command' ? 'Upgrade to unlock' : 'Upgrade', exact: true }).click();
          await page.getByRole('dialog', { name: 'Upgrade UFIconnect' }).getByRole('button', { name: `Choose ${tier}`, exact: true }).click();
        };
        if (surface === 'command') {
          await checkout({ tier: 'pro', quantity: 1 }, () => choose('Pro'), 'cancelled');
          await page.getByRole('heading', { name: 'Unlock the Command Center', exact: true }).waitFor();
          await reload();
          await page.getByRole('heading', { name: 'Unlock the Command Center', exact: true }).waitFor();
          await checkout({ tier: 'pro', quantity: 1 }, () => choose('Pro'), 'success');
          await page.getByRole('heading', { name: 'Unlock the Command Center', exact: true }).waitFor();
          assert.equal(await page.getByRole('tabpanel', { name: 'Your Feed', exact: true }).count(), 0, 'A success query cannot grant a paid Command Center');
          await checkout({ tier: 'pro', quantity: 1 }, () => choose('Pro'), 'success', () => { user.plan = 'pro'; });
          await page.getByRole('tabpanel', { name: 'Your Feed', exact: true }).waitFor();
          assert.equal(await page.getByRole('tab', { name: 'Your Feed', exact: true }).getAttribute('aria-selected'), 'true');
          await reload();
          assert.equal(await page.getByRole('tab', { name: 'Your Feed', exact: true }).getAttribute('aria-selected'), 'true', 'Paid Command Center return keeps its tab after reload');
        } else {
          await checkout({ tier: 'business', quantity: 1 }, () => choose('Business'), 'success', () => { user.plan = 'business'; });
          await page.getByRole('heading', { name: 'Business plan', exact: true }).waitFor();
          assert.equal(new URL(page.url()).pathname, '/settings', 'Confirmed Business membership keeps the Settings return route');
          await reload();
          await portal(() => page.getByRole('button', { name: 'Manage billing', exact: true }).click());
          await reload();
        }
      } else if (surface === 'vault') {
        const subscribe = () => page.getByRole('button', { name: 'Subscribe for $3.94 USD / month', exact: true }).click();
        await checkout({ tier: 'vpn_connector' }, subscribe, 'success');
        await page.getByText('Payment is still being confirmed. Check status again shortly before starting another checkout.', { exact: true }).waitFor();
        assert.ok(await page.getByRole('switch', { name: 'Vault connection monitoring', exact: true }).isDisabled(), 'A success query cannot activate unpaid Vault monitoring');
        await reload();
        await checkout({ tier: 'vpn_connector' }, subscribe, 'success', () => { user.vpnConnectorAddon = true; });
        const manage = page.getByRole('button', { name: 'Manage or cancel subscription', exact: true });
        await manage.waitFor();
        await reload();
        await portal(() => manage.click());
        await reload();
      } else {
        const unlock = () => page.getByRole('button', { name: 'Unlock for $30.00 / month', exact: true }).click();
        await checkout({ tier: 'resume_builder_monthly' }, unlock, 'cancelled');
        await reload();
        await checkout({ tier: 'resume_builder_monthly' }, unlock, 'success');
        await page.getByText('Access is not active yet. Payment may still be processing; check billing status in Settings.', { exact: true }).waitFor();
        assert.equal(await page.getByRole('tablist', { name: 'Resume Builder', exact: true }).count(), 0, 'A success query cannot unlock Resume Builder');
        await checkout({ tier: 'resume_builder_monthly' }, unlock, 'success', () => { user.resumeBuilderAddon = true; });
        await page.getByRole('tab', { name: 'Cover letter', exact: true }).waitFor();
        assert.equal(await page.getByRole('tab', { name: 'Cover letter', exact: true }).getAttribute('aria-selected'), 'true');
        await reload();
        assert.equal(await page.getByRole('tab', { name: 'Cover letter', exact: true }).getAttribute('aria-selected'), 'true', 'Resume query selection survives return and reload');
      }
      assert.deepEqual(errors, [], 'No browser exceptions');
      assert.deepEqual(forbidden, [], 'No provider, account or content writes');
      assert.ok(profileReads > 0, 'Membership UI reads a verified member profile');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      await page.screenshot({ path: `${output}/${surface}-${width}.png`, fullPage: true });
      results.push({ width, surface, returnPath: destination, billingReads, profileReads, syntheticBillingOpeners: requests.length,
        reloadPreserved: true, providerRequests: 0, payments: 0, errors, forbidden });
      await context.close();
      console.log(`PASS billing return route, query/hash and verified membership: ${surface} ${width}px`);
    }
  }
  await fs.writeFile(`${output}/summary.json`, JSON.stringify({ origin: server.origin, productionAssets: true, results }, null, 2) + '\n');
} finally { await browser.close(); await server.close(); await app.close(); }
