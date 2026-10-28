import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';

const require = createRequire(import.meta.url);
const { PGlite } = require('../backend/node_modules/@electric-sql/pglite');
const { createAppHarness } = require('../backend/test-support/app-harness');
const { BUSINESS_TEAM_SCHEMA } = require('../backend/business-teams');
const { OFFICE_MEMBERS_SCHEMA } = require('../backend/office-members');
const pg = new PGlite();
await pg.exec(`CREATE TABLE users(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,
  phone TEXT,password_hash TEXT,title TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),organization TEXT,
  plan TEXT NOT NULL DEFAULT 'free',business_seats INTEGER NOT NULL DEFAULT 0,billing_closed BOOLEAN NOT NULL DEFAULT false,
  auth_version INTEGER NOT NULL DEFAULT 0,onboarding_complete BOOLEAN NOT NULL DEFAULT false,profile_hidden BOOLEAN NOT NULL DEFAULT false,
  role_settings JSONB NOT NULL DEFAULT '{}');
  CREATE TABLE auth_sessions(id UUID PRIMARY KEY,user_id UUID REFERENCES users(id),expires_at TIMESTAMPTZ);`);
for (const sql of [...OFFICE_MEMBERS_SCHEMA, ...BUSINESS_TEAM_SCHEMA]) await pg.exec(sql);
const app = await createAppHarness({ connected: true, query(sql, params) {
  if (sql.includes('site_activity_heartbeat')) return { rows: [], rowCount: 0 };
  return pg.query(sql, params.map(value => Object.prototype.toString.call(value) === '[object Date]' ? value.toISOString() : value));
} });
const server = await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
await fs.mkdir('.cache/audit-ui', { recursive: true });
const password = 'Cobalt-rain-sky7';
const registration = email => ({ name: 'Recruiting contact', email, password, accountType: 'business', organization: 'Sample recruiting', businessIndustryId: 'technology' });
const price = unitAmount => ({ active: true, unitAmount, currency: 'USD', interval: 'month', intervalCount: 1 });
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const scenarios = [];

async function browserScenario(width, { failCatalog = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
  const state = { token: '', failCatalog, catalogRequests: 0, registrations: [], billingRequests: [], errors: [], routeErrors: [] };
  await context.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.setItem('uficonnect.analytics.consent.v1', 'denied');
    localStorage.setItem('uficonnect.ads.consent.v1', 'denied');
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' };
    const fulfill = (json, status = 200) => route.fulfill({ status, headers, json });
    try {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (!['fetch', 'xhr'].includes(request.resourceType())) return url.origin === server.origin ? route.continue() : route.abort();
      const endpoint = url.pathname.replace(/^\/(api|fallback)(?=\/)/, '');
      if (endpoint === '/auth/business-options') {
        state.catalogRequests++;
        if (state.failCatalog) return fulfill({ message: 'Synthetic catalog outage.' }, 503);
      }
      if (/^\/auth\/(?:config|business-options|register|login|session)$/.test(endpoint) || endpoint === '/profile'
        || endpoint === '/business/team' || endpoint === '/business/team/invitation') {
        const body = request.method() === 'POST' || request.method() === 'PATCH' ? request.postDataJSON() : undefined;
        if (endpoint === '/auth/register') state.registrations.push(body);
        const token = request.headers().authorization?.replace(/^Bearer /, '') || state.token;
        const result = await app.request(endpoint, { method: request.method(), body, headers: token ? { authorization: `Bearer ${token}` } : {} });
        if (result.data.token) state.token = result.data.token;
        return fulfill(result.data, result.status);
      }
      if (endpoint === '/billing/status') {
        const result = await app.request('/profile', { headers: state.token ? { authorization: `Bearer ${state.token}` } : {} });
        if (result.status !== 200) return fulfill(result.data, result.status);
        return fulfill({ plan: result.data.plan, accountType: result.data.accountType, hasBillingAccount: false,
          businessEnrollmentRequired: false, subscriptions: [], businessSeats: 0 });
      }
      if (endpoint === '/billing/config') return fulfill({ paymentsReady: true, tiers: { business: true, business_team: true }, pricing: { business: price(19994), business_team: price(1994) } });
      if (endpoint.startsWith('/billing/create-')) {
        state.billingRequests.push({ endpoint, body: request.postDataJSON() });
        return fulfill({ message: 'Payments are disabled in this isolated audit.' }, 503);
      }
      return fulfill({ sources: [], posts: [], groups: [], connected: {}, members: [], invitations: [], items: [] });
    } catch (error) {
      state.routeErrors.push(error.message);
      return fulfill({ message: 'Synthetic audit request failed.' }, 503);
    }
  });
  const page = await context.newPage();
  page.on('pageerror', error => state.errors.push(error.message));
  const scenario = { context, page, state, width };
  scenarios.push(scenario);
  return scenario;
}

async function fillRegistration(page, email, confirmation = password) {
  const form = page.getByRole('form', { name: 'Create Business account', exact: true });
  await form.getByLabel('Contact name', { exact: true }).fill('Recruiting contact');
  await form.getByLabel('Company or organization', { exact: true }).fill('  Sample recruiting  ');
  await form.getByLabel('Work email', { exact: true }).fill(email);
  await form.getByRole('combobox', { name: /Primary industry/ }).selectOption('technology');
  await form.getByLabel('Password', { exact: true }).fill(password);
  await form.getByLabel('Confirm password', { exact: true }).fill(confirmation);
  return form;
}

async function verifyAccount(email) {
  const row = (await pg.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
  check(row?.account_type === 'business', 'Registration persists a Business account in PostgreSQL');
  check(row.organization === 'Sample recruiting' && row.business_industry_id === 'technology', 'Organization and industry persist after trimming');
  check(row.onboarding_complete === true && row.plan === 'free' && row.business_seats === 0, 'Account creation completes onboarding without granting paid access');
  return row;
}

try {
  const personal = await app.request('/auth/register', { method: 'POST', body: { name: 'Personal member', email: 'personal-signup-audit@example.invalid', password } });
  assert.equal(personal.status, 201);
  await pg.query('UPDATE users SET onboarding_complete=true WHERE id=$1', [personal.data.profile.id]);

  const signup = await browserScenario(390, { failCatalog: true });
  await signup.page.goto(server.origin + '/business/register');
  await signup.page.getByRole('button', { name: 'Retry industry choices', exact: true }).waitFor();
  check(await signup.page.getByRole('combobox', { name: /Primary industry/ }).isDisabled(), 'Failed industry loading cannot submit an incomplete signup');
  check(await signup.page.getByRole('button', { name: 'Create Business account', exact: true }).isDisabled(), 'Signup remains disabled while industry choices are unavailable');
  const failedRequests = signup.state.catalogRequests;
  signup.state.failCatalog = false;
  await signup.page.getByRole('button', { name: 'Retry industry choices', exact: true }).click();
  await signup.page.getByRole('option', { name: 'Technology & software', exact: true }).waitFor({ state: 'attached' });
  check(signup.state.catalogRequests > failedRequests, 'Retry requests the real public industry catalog');
  const form = await fillRegistration(signup.page, 'new-business-signup-audit@example.invalid', password + '-different');
  await form.getByRole('button', { name: 'Create Business account', exact: true }).click();
  await signup.page.getByText('Passwords do not match.', { exact: true }).waitFor();
  check(signup.state.registrations.length === 0, 'Password mismatch is rejected before any registration request');
  await form.getByLabel('Confirm password', { exact: true }).fill(password);
  check(await signup.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Public Business registration fits a 390px screen');
  await signup.page.screenshot({ path: '.cache/audit-ui/business-signup-390.png', fullPage: true });
  await form.getByRole('button', { name: 'Create Business account', exact: true }).click();
  await signup.page.getByRole('heading', { name: 'Complete your Business membership', exact: true }).waitFor();
  await verifyAccount('new-business-signup-audit@example.invalid');
  check(new URL(signup.page.url()).pathname === '/business/enrollment', 'New Business registration opens enrollment instead of personal onboarding');
  check(signup.state.registrations.length === 1 && signup.state.registrations[0].accountType === 'business', 'The public form explicitly chooses Business exactly once');
  check(signup.state.billingRequests.length === 0, 'Registering and viewing enrollment never starts a payment');
  await signup.page.reload();
  await signup.page.getByRole('heading', { name: 'Complete your Business membership', exact: true }).waitFor();
  check(new URL(signup.page.url()).pathname === '/business/enrollment', 'The real persisted session restores the pending Business account');

  const conflict = await browserScenario(1440);
  await conflict.page.goto(server.origin + '/business/register');
  await conflict.page.getByRole('option', { name: 'Technology & software', exact: true }).waitFor({ state: 'attached' });
  const conflictForm = await fillRegistration(conflict.page, 'personal-signup-audit@example.invalid');
  await conflictForm.getByRole('button', { name: 'Create Business account', exact: true }).click();
  await conflict.page.getByText('That email already has an account.', { exact: false }).waitFor();
  check((await pg.query('SELECT account_type FROM users WHERE id=$1', [personal.data.profile.id])).rows[0].account_type === 'personal', 'An existing personal email cannot be converted by public Business registration');
  await conflict.page.goto(server.origin + '/login?returnTo=%2Fbusiness%2Fregister');
  await conflict.page.getByLabel('Email address', { exact: true }).fill('personal-signup-audit@example.invalid');
  await conflict.page.getByLabel('Password', { exact: true }).fill(password);
  await conflict.page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await conflict.page.getByRole('heading', { name: /signed in to a personal account/ }).waitFor();
  check(await conflict.page.getByRole('form', { name: 'Create Business account', exact: true }).count() === 0, 'Signed-in personal members cannot submit the Business registration form');
  check(await conflict.page.getByRole('button', { name: 'Sign out to create a Business account', exact: true }).isVisible(), 'Personal members receive an explicit separate-account path');
  const forged = await app.request('/auth/register', { method: 'POST', headers: { authorization: `Bearer ${conflict.state.token}` }, body: registration('forged-business-signup-audit@example.invalid') });
  check(forged.status === 409 && forged.data.code === 'business_registration_required', 'The actual registration handler also refuses an authenticated conversion attempt');
  check((await pg.query('SELECT COUNT(*)::int AS count FROM users')).rows[0].count === 2, 'Conflict and authenticated attempts create no extra accounts');

  const invite = await browserScenario(320);
  const invitationPath = '/recruiting#invite=' + 'a'.repeat(43);
  await invite.page.goto(server.origin + invitationPath);
  await invite.page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
  await invite.page.getByRole('link', { name: 'Create one', exact: true }).click();
  await invite.page.getByRole('option', { name: 'Technology & software', exact: true }).waitFor({ state: 'attached' });
  check(new URL(invite.page.url()).pathname === '/business/register', 'Recruiting invitations lead to public Business registration');
  const invitedForm = await fillRegistration(invite.page, 'invited-business-signup-audit@example.invalid');
  check(await invite.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Public Business registration fits a 320px screen');
  await invitedForm.getByRole('button', { name: 'Create Business account', exact: true }).click();
  await invite.page.getByRole('heading', { name: 'Business team invitation', exact: true }).waitFor();
  check(new URL(invite.page.url()).pathname + new URL(invite.page.url()).hash === invitationPath, 'Registration preserves the safe invitation return path');
  await verifyAccount('invited-business-signup-audit@example.invalid');
  check(invite.state.billingRequests.length === 0, 'An invited Business account is not sent to paid checkout');
  await invite.page.screenshot({ path: '.cache/audit-ui/business-signup-invite-320.png', fullPage: true });
  await invite.page.evaluate(() => {
    history.pushState({ usr: { from: '//invalid.example/checkout' }, key: 'unsafe-return-audit' }, '', '/business/register');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await invite.page.getByRole('heading', { name: 'Complete your Business membership', exact: true }).waitFor();
  check(new URL(invite.page.url()).origin === server.origin && new URL(invite.page.url()).pathname === '/business/enrollment', 'An external return target cannot redirect a Business account away from UFI');

  for (const scenario of scenarios) {
    check(scenario.state.errors.length === 0, `No browser errors at ${scenario.width}px: ${scenario.state.errors.join('; ')}`);
    check(scenario.state.routeErrors.length === 0, `All real isolated API handlers completed: ${scenario.state.routeErrors.join('; ')}`);
    check(scenario.state.billingRequests.length === 0, 'The signup audit never creates checkout or portal sessions');
  }
  await fs.writeFile('.cache/audit-ui/business-signup-results.json', JSON.stringify({ checks, widths: [1440, 390, 320],
    backend: 'real registration, login, session, profile and team routes with isolated PostgreSQL',
    productionPayments: 'none; billing status and prices are synthetic and billing mutations are blocked', passed: true }, null, 2));
  console.log(`PASS: ${checks} Business signup browser checks.`);
} catch (error) {
  const page = scenarios.at(-1)?.page;
  if (page) { await page.screenshot({ path: '.cache/audit-ui/business-signup-failure.png', fullPage: true }); console.error(await page.locator('body').innerText()); }
  throw error;
} finally { await browser.close(); await server.close(); await app.close(); await pg.close(); }
