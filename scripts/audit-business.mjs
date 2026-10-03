import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';
import { installAuditMember, auditNavigate } from './audit-session.mjs';
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
app.seedUser(member('business-audit', { name: 'Recruiting owner', organization: 'Talent Company' }));
const server = await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
await fs.mkdir('.cache/audit-ui', { recursive: true });
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let plan = 'free';
    let addons = { resumeBuilderAddon: false, vpnConnectorAddon: false };
    const requests = [];
    const price = amount => ({ active: true, unitAmount: amount, display: '$' + (amount / 100).toFixed(2), currency: 'USD', interval: 'month', intervalCount: 1, matchesRequiredPrice: true });
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (!['fetch', 'xhr'].includes(request.resourceType())) return url.origin === server.origin ? route.continue() : route.abort();
      const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
      const fulfill = json => route.fulfill({ json, headers });
      if (endpoint === '/profile') return fulfill({ ...app.fullProfile(app.users[0]), plan, ...addons, businessSeats: plan === 'business' ? 3 : 0 });
      if (endpoint === '/billing/status') return fulfill({ plan, ...addons, businessSeats: plan === 'business' ? 3 : 0, hasBillingAccount: plan === 'business', subscriptions: plan === 'business' ? [{ kind: 'plan', tier: 'business', status: 'active' }] : [] });
      if (endpoint === '/billing/config') return fulfill({ paymentsReady: true, tiers: { pro: true, business: true, business_team: true }, pricing: { pro: price(1994), business: price(19994), business_team: price(1994) } });
      if (endpoint === '/billing/create-checkout-session') { requests.push(request.postDataJSON()); return fulfill({ url: 'https://invalid.example/checkout' }); }
      if (endpoint === '/users/search') return fulfill({ users: [{ id: 'candidate-1', name: 'Candidate Example', title: 'Software engineer', organization: 'Example Company', skills: ['React', 'TypeScript'] }], hasMore: false });
      if (endpoint === '/business/team') return fulfill(plan === 'business' ? { role: 'owner', active: true, seats: 3, used: 1, owner: { id: 'business-audit', name: 'Recruiting owner', organization: 'Talent Company' }, members: [], invitations: [] } : { role: 'none', active: false, seats: 0 });
      return fulfill({ sources: [], posts: [], groups: [], connected: {}, members: [], invitations: [], items: [] });
    });
    await installAuditMember(page, app, 'business-audit');
    await auditNavigate(page, server.origin + '/settings');
    await page.getByRole('button', { name: 'Upgrade', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Upgrade UFIconnect' });
    await dialog.getByRole('button', { name: 'Choose Business', exact: true }).waitFor();
    check(await dialog.getByText('$199.94', { exact: true }).isVisible(), 'Solo Business price is $199.94');
    await dialog.getByRole('spinbutton', { name: 'Number of people, including you' }).fill('3');
    check(await dialog.getByText('$59.82', { exact: true }).isVisible(), 'Three people cost $59.82 per month');
    await dialog.getByRole('button', { name: 'Choose Business', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.deepEqual(requests.at(-1), { tier: 'business', quantity: 3 }); checks++;
    check(page.url().startsWith(server.origin), 'Untrusted payment URL does not navigate');
    await dialog.getByRole('spinbutton', { name: 'Number of people, including you' }).fill('0');
    check(await dialog.getByRole('button', { name: 'Unavailable', exact: true }).isDisabled(), 'Zero people cannot be purchased');
    await dialog.getByRole('spinbutton', { name: 'Number of people, including you' }).fill('3');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Pricing fits ${width}px`);
    await page.screenshot({ path: `.cache/audit-ui/business-pricing-${width}.png`, fullPage: true });
    plan = 'business';
    await page.goto(server.origin + '/settings?upgrade=success');
    await page.waitForURL('**/recruiting');
    await page.getByRole('heading', { name: 'Talent Company recruiting', exact: true }).waitFor();
    check(await page.getByRole('navigation', { name: 'Recruiting workspace' }).getByRole('link').count() === 5, 'Business shell has five work destinations');
    check(await page.getByRole('link', { name: 'Videos', exact: true }).count() === 0, 'Business has no video navigation');
    check(await page.getByRole('link', { name: 'Find candidates', exact: false }).isVisible(), 'Recruiting actions are visible after verified activation');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Recruiting workspace fits ${width}px`);
    await page.screenshot({ path: `.cache/audit-ui/business-workspace-${width}.png`, fullPage: true });
    for (const path of ['/music', '/groups', '/global', '/command-center']) {
      await auditNavigate(page, server.origin + path); await page.waitForURL('**/recruiting'); checks++;
    }
    await page.getByRole('navigation', { name: 'Recruiting workspace' }).getByRole('link', { name: 'Candidates', exact: true }).click();
    await page.getByRole('heading', { name: 'Find people for your next role', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Candidate Example', exact: true }).waitFor();
    check(await page.getByRole('link', { name: 'Contact about a role', exact: true }).getAttribute('href') === '/messages/candidate-1', 'Candidate contact starts a direct conversation');
    check(await page.getByText('TypeScript', { exact: true }).isVisible(), 'Candidate skills are visible');
    check(await page.getByRole('link', { name: 'Create a group', exact: true }).count() === 0, 'Candidate search has no social group actions');
    await auditNavigate(page, server.origin + '/settings/');
    await page.getByRole('heading', { name: 'Business plan', exact: true }).waitFor();
    check(new URL(page.url()).pathname === '/settings/', 'Business keeps supported trailing-slash URLs');
    check(await page.getByRole('link', { name: 'Open Vault and recovery', exact: true }).isVisible(), 'Vault recovery remains reachable without an active add-on');
    addons = { resumeBuilderAddon: true, vpnConnectorAddon: true };
    await page.getByRole('button', { name: 'Check billing status', exact: true }).click();
    const navigation = page.getByRole('navigation', { name: 'Recruiting workspace' });
    await navigation.getByRole('link', { name: 'Resume Builder', exact: true }).waitFor();
    await navigation.getByRole('link', { name: 'Resume Builder', exact: true }).click();
    await page.getByRole('heading', { name: 'Resume Builder', exact: true }).waitFor();
    check(new URL(page.url()).pathname === '/resume-builder', 'Business keeps independently purchased Resume Builder accessible');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Business add-on navigation fits ${width}px`);
    await auditNavigate(page, server.origin + '/resume-builder/cover-letter/preview');
    await page.getByText('Cover letter preview', { exact: true }).waitFor();
    check(new URL(page.url()).pathname === '/resume-builder/cover-letter/preview', 'Business can open its paid cover letter preview');
    await navigation.getByRole('link', { name: 'Vault', exact: true }).click();
    await page.locator('.vault-page').waitFor();
    check(new URL(page.url()).pathname === '/vault', 'Business keeps independently purchased Vault accessible');
    check(errors.length === 0, `No browser errors at ${width}px: ${errors.join('; ')}`);
    await context.close();
  }
  await fs.writeFile('.cache/audit-ui/business-results.json', JSON.stringify({ checks, widths: [1440, 390, 320], productionPayments: 'none; all billing requests intercepted', passed: true }, null, 2));
  console.log(`PASS: ${checks} Business browser checks.`);
} catch (error) {
  const page = browser.contexts().at(-1)?.pages().at(-1);
  if (page) { await page.screenshot({ path: '.cache/audit-ui/business-failure.png', fullPage: true }); console.error(await page.locator('body').innerText()); }
  throw error;
} finally { await browser.close(); await server.close(); await app.close(); }
