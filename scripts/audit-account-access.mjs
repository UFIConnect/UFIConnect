import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auth0Domain = 'audit-tenant.example.invalid';
const auth0Audience = 'https://api.example.invalid/';
const readyAuth0 = { enabled: true, domain: auth0Domain, audience: auth0Audience, issuer: `https://${auth0Domain}/` };
const readyProviders = { google: { configured: true, enabled: true }, apple: { configured: true, enabled: false }, phone: { configured: true, enabled: true } };
const fixtureId = 'virtual:account-access-readiness.jsx', sdkId = 'virtual:account-access-sdk';
const sdkFixture = `
export function Auth0Provider({ children }) { return children; }
const sdk = { isLoading: false, isAuthenticated: false,
  async loginWithRedirect(options) { window.__accountAccessAudit.redirects.push(options); },
  async getAccessTokenSilently() { throw new Error('The audit must not obtain a provider token.'); },
  logout() { throw new Error('The audit must not call provider logout.'); } };
export function useAuth0() { return sdk; }`;
const readinessFixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { AuthProvider, useAuth } from '/src/contexts/AuthContext.jsx';
import { setAccessToken } from '/src/auth/session.js';
import AccountAccess from '/src/components/AccountAccess.jsx';
import Login from '/src/pages/Login.jsx';
import Register from '/src/pages/Register.jsx';
import '/src/index.css';
const params = new URL(location.href).searchParams, mode = params.get('mode');
window.__accountAccessAudit.setToken = setAccessToken;
function Fixture() {
  const { auth0Ready, auth0Checking } = useAuth();
  return React.createElement(React.Fragment, null,
    React.createElement('output', { hidden: true, 'data-audit-auth0-state': true }, JSON.stringify({ auth0Ready, auth0Checking })),
    params.has('auth0') ? React.createElement(mode === 'signup' ? Register : Login)
      : React.createElement(AccountAccess, { mode }));
}
createRoot(document.getElementById('root')).render(React.createElement(HelmetProvider, null,
  React.createElement(BrowserRouter, null, React.createElement(AuthProvider, null, React.createElement(Fixture)))));`;
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  cacheDir: path.join(root, '.cache/audit-account-access-vite'), optimizeDeps: { exclude: ['@auth0/auth0-react'] },
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify(''),
    'import.meta.env.VITE_AUTH0_DOMAIN': JSON.stringify(auth0Domain), 'import.meta.env.VITE_AUTH0_CLIENT_ID': JSON.stringify('synthetic-audit-client'),
    'import.meta.env.VITE_AUTH0_AUDIENCE': JSON.stringify(auth0Audience) },
  plugins: [{ name: 'account-access-readiness-fixture', enforce: 'pre',
    resolveId(id) { if (id === '@auth0/auth0-react' || id === sdkId) return '\0' + sdkId; if (id === fixtureId) return '\0' + fixtureId; },
    load(id) { if (id === '\0' + sdkId) return sdkFixture; if (id === '\0' + fixtureId) return readinessFixture; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      if (new URL(req.url, 'http://fixture.invalid').pathname !== '/__account-access-readiness') return next();
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account readiness audit</title></head><body><div id="root"></div><script type="module" src="/@id/virtual:account-access-readiness.jsx"></script></body></html>'));
    }); },
  }], server: { host: '127.0.0.1', port: 5282, strictPort: false } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const providerButtonName = (mode, provider) => new RegExp('^' + (mode === 'link' ? 'Connect ' : mode === 'signup' ? 'Sign up with ' : 'Sign in with ') + (provider === 'google' ? 'Google' : 'Apple'));
const panelName = mode => mode === 'link' ? 'Account sign-in methods' : mode === 'signup' ? 'Account creation options' : 'Sign-in options';
const profileFor = mode => ({ id: 'account-access-member', name: 'Private Member', email: 'private@example.test', title: 'Engineer', plan: 'free', authProvider: 'local', onboardingComplete: mode !== 'signup', skills: [], joinedGroups: [], preferences: {}, roleSettings: {} });
const flowRequests = calls => calls.filter(call => /^\/auth\/(?:providers\/(?:google|apple)\/(?:start|link)|phone\/(?:request|link|verify))$/.test(call.endpoint));
async function installAuditState(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('uficonnect.analytics.consent.v1', 'denied');
    const realNow = Date.now.bind(Date); let offset = 0;
    Date.now = () => realNow() + offset;
    window.__accountAccessAudit = { redirects: [], advanceClock: milliseconds => { offset += milliseconds; } };
  });
}
async function assertProviderLock(panel, name, status) {
  const button = panel.getByRole('button', { name });
  if (status) await button.getByText(status, { exact: true }).waitFor();
  assert.equal(await button.isDisabled(), true, `${name}: provider is locked`);
  assert.equal(await button.locator('.lucide-lock-keyhole').count(), 1, `${name}: lock icon is visible`);
  if (status) assert.match(await button.innerText(), new RegExp(status));
  await button.evaluate(element => element.click());
}
let browser;
try {
  await server.listen(); const base = server.resolvedUrls.local[0];
  await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [390, 1440]) for (const mode of ['login', 'signup', 'link']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage();
    page.setDefaultTimeout(15000);
    await installAuditState(page);
    const errors = [], calls = []; page.on('pageerror', error => errors.push(error.message));
    let authenticated = mode === 'link', statusFailure = mode === 'login', phoneLinked = false, appleReady = false;
    const profile = profileFor(mode);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (['accounts.google.com', 'appleid.apple.com'].includes(url.hostname)) return route.fulfill({ contentType: 'text/html', body: '<h1>Stub identity provider</h1>' });
      if (url.origin !== new URL(base).origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.slice(4), body = request.postDataJSON(), authorization = request.headers().authorization;
      calls.push({ endpoint, body, authorization });
      if (/events|stream/.test(endpoint)) return route.fulfill({ contentType: 'text/event-stream', body: '' });
      if (endpoint === '/auth/session') return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { token: 'synthetic-account-session', profile } : { message: 'Signed out' } });
      if (endpoint === '/auth/config') return route.fulfill({ json: { auth0: { enabled: false } } });
      if (endpoint === '/auth/providers') return route.fulfill({ status: statusFailure ? 500 : 200, json: statusFailure ? { message: 'Synthetic unavailable status' } : { providers: { ...readyProviders, apple: { configured: true, enabled: appleReady } } } });
      if (endpoint === '/auth/login') { authenticated = true; return route.fulfill({ json: { token: 'synthetic-email-session', profile } }); }
      if (endpoint === '/auth/providers/linked') return route.fulfill({ json: { methods: phoneLinked ? [{ provider: 'phone', linkedAt: '2026-10-08T00:00:00Z' }] : [], passwordAvailable: true } });
      if (/^\/auth\/providers\/google\/(start|link)$/.test(endpoint)) return route.fulfill({ json: { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic' } });
      if (/^\/auth\/providers\/apple\/(start|link)$/.test(endpoint)) return route.fulfill({ json: { authorizationUrl: 'https://appleid.apple.com/auth/authorize?state=synthetic' } });
      if (endpoint === '/auth/phone/request' || endpoint === '/auth/phone/link') return route.fulfill({ json: { verificationId: 'synthetic-verification', expiresIn: 600, resendAfter: 60 } });
      if (endpoint === '/auth/phone/verify') {
        if (body.code === '000000') return route.fulfill({ status: mode === 'link' ? 409 : 400, json: { message: mode === 'link' ? 'This sign-in method is already connected to another account.' : 'That code could not be verified.' } });
        authenticated = true; phoneLinked = mode === 'link';
        return route.fulfill({ json: { token: 'synthetic-verified-session', profile, created: mode === 'signup' } });
      }
      if (endpoint === '/profile') return route.fulfill({ json: profile });
      if (endpoint === '/profile/security') return route.fulfill({ json: { passwordChangeAvailable: true, passwordChangeRevokesSessions: true, serverSessionRevocation: true, sessionLifetimeSeconds: 86400 } });
      if (endpoint === '/profile/preferences') return route.fulfill({ json: {} });
      if (endpoint.startsWith('/analytics/')) return route.fulfill({ status: 204 });
      return route.fulfill({ json: { sources: [], posts: [], groups: [], notifications: [], conversations: [], connected: {}, platforms: {}, users: [], members: [], requests: [], items: [], invitations: [], unreadCount: 0, count: 0 } });
    });
    const target = mode === 'link' ? 'settings?tab=security' : mode === 'signup' ? 'register' : 'login?returnTo=%2Fsettings%3Ftab%3Dsecurity';
    await page.goto(base + target);
    let panel = page.getByRole('region', { name: mode === 'link' ? 'Account sign-in methods' : mode === 'signup' ? 'Account creation options' : 'Sign-in options', exact: true });
    if (statusFailure) {
      await panel.getByRole('button', { name: 'Retry options', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).isEnabled(), true);
      await page.screenshot({ path: path.join(root, `.cache/audit-ui/account-access-locked-login-${width}.png`), fullPage: true });
      statusFailure = false; await panel.getByRole('button', { name: 'Retry options', exact: true }).click();
    }
    await panel.getByRole('button', { name: providerButtonName(mode, 'google') }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.account-access-provider')].some(button => button.textContent.includes('Google') && !button.disabled));
    await assertProviderLock(panel, providerButtonName(mode, 'apple'), 'Unavailable');
    {
      await panel.getByRole('button', { name: providerButtonName(mode, 'google') }).click();
      await page.waitForURL('https://accounts.google.com/**');
      const start = calls.find(call => call.endpoint.endsWith(mode === 'link' ? '/google/link' : '/google/start'));
      assert.deepEqual(start.body, mode === 'link' ? { client: 'web' } : { client: 'web', mode, returnTo: mode === 'signup' ? '/' : '/settings?tab=security' });
      assert.equal(Boolean(start.authorization), mode === 'link');
      appleReady = true;
      await page.goto(base + target);
      await page.waitForFunction(() => !document.querySelector('.account-access-provider-apple')?.disabled);
      await panel.getByRole('button', { name: providerButtonName(mode, 'apple') }).click();
      await page.waitForURL('https://appleid.apple.com/**');
      const appleStart = calls.find(call => call.endpoint.endsWith(mode === 'link' ? '/apple/link' : '/apple/start'));
      assert.deepEqual(appleStart.body, start.body);
      assert.equal(Boolean(appleStart.authorization), mode === 'link');
      appleReady = false;
      await page.goto(base + target);
    }
    await panel.getByRole('button', { name: mode === 'link' ? /^Connect phone number/ : /^Continue with phone number/ }).click();
    if (mode === 'signup') await panel.getByLabel('Full name', { exact: true }).fill('Private Signup Member');
    await panel.getByLabel('Phone number', { exact: true }).fill('555');
    await panel.getByRole('button', { name: 'Send verification code', exact: true }).click();
    await panel.getByText('Enter a valid phone number for the selected country, or paste an international number with +.', { exact: true }).waitFor();
    assert.equal(calls.some(call => ['/auth/phone/request', '/auth/phone/link'].includes(call.endpoint)), false);
    await panel.getByLabel('Phone number', { exact: true }).fill('+1 (415) 555-0123');
    await panel.getByRole('button', { name: 'Send verification code', exact: true }).click();
    await panel.getByLabel('Verification code', { exact: true }).waitFor();
    const requested = calls.find(call => ['/auth/phone/request', '/auth/phone/link'].includes(call.endpoint));
    assert.equal(requested.endpoint, mode === 'link' ? '/auth/phone/link' : '/auth/phone/request');
    assert.deepEqual(requested.body, { phoneNumber: '+14155550123', ...(mode === 'link' ? {} : { mode, ...(mode === 'signup' ? { name: 'Private Signup Member' } : {}) }) });
    assert.equal(Boolean(requested.authorization), mode === 'link');
    assert.equal(await panel.getByRole('button', { name: /^Resend in/ }).isDisabled(), true);
    await panel.getByLabel('Verification code', { exact: true }).fill('000000');
    await panel.getByRole('button', { name: mode === 'link' ? 'Verify and connect phone' : mode === 'signup' ? 'Verify and create account' : 'Verify and sign in', exact: true }).click();
    await panel.getByRole('alert').waitFor();
    assert.equal(await panel.getByLabel('Verification code', { exact: true }).inputValue(), '');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await panel.getByLabel('Verification code', { exact: true }).fill('123456');
    await panel.getByRole('button', { name: mode === 'link' ? 'Verify and connect phone' : mode === 'signup' ? 'Verify and create account' : 'Verify and sign in', exact: true }).click();
    await page.waitForURL(url => mode === 'signup' ? url.pathname === '/onboarding' : url.pathname === '/settings' && (mode !== 'link' || url.searchParams.get('linked') === 'phone'));
    if (mode === 'link') {
      await panel.getByText('Phone number is connected for sign-in.', { exact: true }).waitFor();
      assert.equal(await panel.getByRole('button', { name: /Change phone number.*Connected/ }).isEnabled(), true);
      await page.clock.install(); await page.clock.fastForward(65000);
      await panel.getByRole('button', { name: /Change phone number.*Connected/ }).click();
      await panel.getByLabel('Country or region', { exact: true }).selectOption('GB');
      await panel.getByLabel('Phone number', { exact: true }).fill('020 7946 0123');
      await panel.getByRole('button', { name: 'Send verification code', exact: true }).click();
      await panel.getByLabel('Verification code', { exact: true }).fill('123456');
      await panel.getByRole('button', { name: 'Verify and change phone number', exact: true }).click();
      await panel.getByRole('button', { name: /Change phone number.*Connected/ }).waitFor();
      assert.deepEqual(calls.filter(call => call.endpoint === '/auth/phone/link').at(-1).body, { phoneNumber: '+442079460123', replacePhone: true });
      await page.goto(base + 'settings?tab=security&auth_error=account_exists');
      await panel.getByText('This sign-in method is already connected to another account.', { exact: true }).waitFor();
    }
    assert.deepEqual(calls.filter(call => call.endpoint === '/auth/phone/verify').at(-1).body, { verificationId: 'synthetic-verification', code: '123456' });
    assert.equal(await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }).includes('synthetic-verified-session')), false);
    assert.ok(calls.filter(call => call.endpoint.startsWith('/analytics/')).every(call => !/123456|14155550123|Private/.test(JSON.stringify(call.body))));
    if (mode === 'login') {
      authenticated = false; await page.goto(base + target);
      await page.getByLabel('Email address', { exact: true }).fill('private@example.test');
      await page.getByLabel('Password', { exact: true }).fill('Synthetic password 123!');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/settings');
      assert.deepEqual(calls.find(call => call.endpoint === '/auth/login').body,
        { email: 'private@example.test', password: 'Synthetic password 123!' }, 'Email/password login remains available');
    }
    assert.deepEqual(errors, []);
    await context.close(); console.log(`PASS account access ${mode}: readiness, provider destination, phone verification, private data, layout at ${width}px`);
  }
  if (!process.argv.includes('--providers-only')) for (const width of [1440, 390]) for (const mode of ['login', 'signup', 'link']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    await installAuditState(page);
    const errors = [], calls = [], external = []; page.on('pageerror', error => errors.push(error.message));
    let availability = {}, availabilityStatus = 200, gate = deferred(), revision = 0;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(base).origin) { external.push(url.href); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.slice(4);
      calls.push({ endpoint, body: request.postDataJSON() });
      const reply = (json, status = 200) => route.fulfill({ json, status }).catch(() => {});
      if (endpoint === '/auth/session') return reply(mode === 'link' ? { token: 'synthetic-linked-session', profile: profileFor(mode) } : { message: 'Signed out' }, mode === 'link' ? 200 : 401);
      if (endpoint === '/profile') return reply(profileFor(mode));
      if (endpoint === '/auth/config') return reply({ auth0: { enabled: false } });
      if (endpoint === '/auth/providers') { const pending = gate; if (pending) await pending.promise; return reply(availability, availabilityStatus); }
      if (endpoint === '/auth/providers/linked') return reply({ methods: [], passwordAvailable: true });
      if (endpoint === '/auth/phone/request' || endpoint === '/auth/phone/link') return reply({ verificationId: 'synthetic-guard-verification', expiresIn: 600, resendAfter: 60 });
      if (flowRequests([{ endpoint }]).length) return reply({ message: 'A locked flow must not reach the API.' }, 400);
      return reply({});
    });
    await page.goto(`${base}__account-access-readiness?mode=${mode}`);
    const panel = page.getByRole('region', { name: panelName(mode), exact: true });
    const names = [providerButtonName(mode, 'google'), providerButtonName(mode, 'apple'), mode === 'link' ? /^Connect phone number/ : /^Continue with phone number/];
    const assertAllLocked = async status => { for (const name of names) await assertProviderLock(panel, name, status); };
    await assertAllLocked('Checking availability');
    assert.equal(flowRequests(calls).length, 0, 'Loading availability never starts a sign-in flow');
    gate.resolve(); gate = null;
    await panel.getByRole('button', { name: /Google.*Setup required/ }).waitFor();
    const loadAvailability = async (response, status = 200, hold = false) => {
      availability = response; availabilityStatus = status; gate = hold ? deferred() : null;
      const request = page.waitForRequest(value => new URL(value.url()).pathname === '/api/auth/providers');
      await page.evaluate(token => window.__accountAccessAudit.setToken(token), `synthetic-readiness-${++revision}`);
      await request;
      return gate;
    };
    const strictCases = [
      { label: 'missing configured', response: { providers: Object.fromEntries(['google', 'apple', 'phone'].map(provider => [provider, { enabled: true }])) }, statuses: ['Setup required', 'Setup required', 'Setup required'] },
      { label: 'configured false', response: { providers: Object.fromEntries(['google', 'apple', 'phone'].map(provider => [provider, { configured: false, enabled: true }])) }, statuses: ['Setup required', 'Setup required', 'Setup required'] },
      { label: 'enabled false', response: { providers: Object.fromEntries(['google', 'apple', 'phone'].map(provider => [provider, { configured: true, enabled: false }])) }, statuses: ['Unavailable', 'Unavailable', 'Unavailable'] },
      { label: 'string true', response: { providers: Object.fromEntries(['google', 'apple', 'phone'].map(provider => [provider, { configured: 'true', enabled: 'true' }])) }, statuses: ['Setup required', 'Setup required', 'Setup required'] },
      { label: 'malformed provider values', response: { providers: { google: true, apple: 'true', phone: [] } }, statuses: ['Setup required', 'Setup required', 'Setup required'] },
      { label: 'partial readiness', response: { providers: { google: { configured: true }, apple: { enabled: true }, phone: { configured: true, enabled: 'true' } } }, statuses: ['Unavailable', 'Setup required', 'Unavailable'] },
    ];
    for (const testCase of strictCases) {
      const pending = await loadAvailability(testCase.response, 200, true);
      await assertAllLocked('Checking availability');
      pending.resolve(); gate = null;
      await page.waitForFunction(() => !document.querySelector('.account-access-providers')?.textContent.includes('Checking availability'));
      for (const [index, name] of names.entries()) await assertProviderLock(panel, name, testCase.statuses[index]);
      assert.equal(flowRequests(calls).length, 0, `${testCase.label} never starts a sign-in flow`);
    }
    await loadAvailability({ providers: { google: { configured: true, enabled: true } } });
    await page.waitForFunction(() => !document.querySelector('.account-access-provider-google')?.disabled);
    assert.equal(await panel.getByRole('button', { name: names[0] }).isEnabled(), true, 'One ready provider does not unlock missing providers');
    await assertProviderLock(panel, names[1], 'Setup required'); await assertProviderLock(panel, names[2], 'Setup required');
    assert.equal(flowRequests(calls).length, 0);
    await loadAvailability({ message: 'Synthetic status failure' }, 500);
    await panel.getByRole('button', { name: 'Retry options', exact: true }).waitFor();
    await assertAllLocked('Unavailable');
    assert.equal(flowRequests(calls).length, 0, 'Status errors keep all providers locked');
    availability = { providers: readyProviders }; availabilityStatus = 200; gate = deferred();
    await panel.getByRole('button', { name: 'Retry options', exact: true }).click();
    await assertAllLocked('Checking availability'); gate.resolve(); gate = null;
    await page.waitForFunction(() => !document.querySelector('.account-access-provider-google')?.disabled);
    await assertProviderLock(panel, names[1], 'Unavailable');
    const phoneButton = panel.getByRole('button', { name: names[2] });
    await phoneButton.click();
    if (mode === 'signup') await panel.getByLabel('Full name', { exact: true }).fill('Synthetic Guard Member');
    await panel.getByLabel('Phone number', { exact: true }).fill('+1 415 555 0123');
    const send = panel.getByRole('button', { name: 'Send verification code', exact: true });
    let pending = await loadAvailability({ providers: { phone: { configured: false, enabled: true } } }, 200, true);
    await assertAllLocked('Checking availability');
    assert.equal(await send.isDisabled(), true, 'An already open phone form locks while readiness reloads');
    await panel.locator('form').evaluate(form => form.requestSubmit());
    assert.equal(flowRequests(calls).length, 0, 'Submitting the open phone form during loading does not send a code');
    pending.resolve(); gate = null;
    await panel.getByRole('button', { name: /phone number.*Setup required/ }).waitFor();
    await panel.locator('form').evaluate(form => form.requestSubmit());
    assert.equal(flowRequests(calls).length, 0, 'Missing phone setup blocks the submit handler too');
    await loadAvailability({ providers: readyProviders });
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Send verification code')?.disabled);
    await send.click();
    await panel.getByLabel('Verification code', { exact: true }).fill('123456');
    const verify = panel.getByRole('button', { name: mode === 'link' ? 'Verify and connect phone' : mode === 'signup' ? 'Verify and create account' : 'Verify and sign in', exact: true });
    await page.evaluate(() => window.__accountAccessAudit.advanceClock(61_000));
    const resend = panel.getByRole('button', { name: 'Resend code', exact: true }); await resend.waitFor();
    assert.equal(await resend.isEnabled(), true, 'Resend becomes available after its real cooldown');
    const flowCount = flowRequests(calls).length;
    pending = await loadAvailability({ message: 'Synthetic status failure' }, 500, true);
    await assertAllLocked('Checking availability');
    assert.equal(await verify.isDisabled(), true); assert.equal(await resend.isDisabled(), true);
    await panel.locator('form').evaluate(form => form.requestSubmit()); await resend.evaluate(button => button.click());
    assert.equal(flowRequests(calls).length, flowCount, 'Verification and resend handlers stay locked during readiness reload');
    pending.resolve(); gate = null;
    await panel.getByRole('button', { name: 'Retry options', exact: true }).waitFor();
    await assertAllLocked('Unavailable');
    await panel.locator('form').evaluate(form => form.requestSubmit()); await resend.evaluate(button => button.click());
    assert.equal(flowRequests(calls).length, flowCount, 'Status failures cannot verify or resend from an open form');
    availability = { providers: readyProviders }; availabilityStatus = 200;
    await panel.getByRole('button', { name: 'Retry options', exact: true }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll('.account-access-phone button')].find(button => button.type === 'submit')?.disabled);
    assert.equal(await verify.isEnabled(), true); assert.equal(await resend.isEnabled(), true);
    assert.equal(flowRequests(calls).length, flowCount, 'Readiness recovery never starts a phone action automatically');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS account readiness ${mode}: strict booleans, missing/malformed/partial state, loading/error/retry, guarded phone send/verify/resend at ${width}px`);
  }
  if (!process.argv.includes('--providers-only')) for (const width of [1440, 390]) for (const mode of ['login', 'signup']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000); await installAuditState(page);
    const errors = [], calls = [], external = []; page.on('pageerror', error => errors.push(error.message));
    let configuration = {}, configurationStatus = 200, gate = deferred();
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(base).origin) { external.push(url.href); return route.abort(); }
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.slice(4); calls.push({ endpoint, body: request.postDataJSON() });
      const reply = (json, status = 200) => route.fulfill({ json, status }).catch(() => {});
      if (endpoint === '/auth/session') return reply({ message: 'Signed out' }, 401);
      if (endpoint === '/auth/config') { const pending = gate; if (pending) await pending.promise; return reply(configuration, configurationStatus); }
      if (endpoint === '/auth/providers') return reply({ providers: readyProviders });
      return reply({});
    });
    const open = () => page.goto(`${base}__account-access-readiness?mode=${mode}&auth0=1`);
    const auth0Button = page.getByRole('button', { name: /^Continue with Auth0/ });
    const waitState = (auth0Ready, auth0Checking = false) => page.waitForFunction(expected => {
      const output = document.querySelector('[data-audit-auth0-state]');
      if (!output) return false;
      const state = JSON.parse(output.textContent);
      return state.auth0Ready === expected.auth0Ready && state.auth0Checking === expected.auth0Checking;
    }, { auth0Ready, auth0Checking });
    const assertAuth0Lock = async checking => {
      await waitState(false, checking);
      assert.equal(await auth0Button.isDisabled(), true);
      assert.equal(await auth0Button.locator('.lucide-lock-keyhole').count(), 1);
      assert.match(await auth0Button.innerText(), checking ? /Checking availability/ : /Unavailable/);
      await auth0Button.evaluate(button => button.click());
      assert.deepEqual(await page.evaluate(() => window.__accountAccessAudit.redirects), []);
    };
    await open(); await assertAuth0Lock(true); gate.resolve(); gate = null; await assertAuth0Lock(false);
    const cases = [
      { label: 'missing backend', response: {} },
      { label: 'server disabled', response: { auth0: { ...readyAuth0, enabled: false } } },
      { label: 'string enabled', response: { auth0: { ...readyAuth0, enabled: 'true' } } },
      { label: 'wrong domain', response: { auth0: { ...readyAuth0, domain: 'other-tenant.example.invalid' } } },
      { label: 'wrong audience', response: { auth0: { ...readyAuth0, audience: 'https://other-api.example.invalid/' } } },
      { label: 'wrong issuer', response: { auth0: { ...readyAuth0, issuer: 'https://other-tenant.example.invalid/' } } },
      { label: 'partial configuration', response: { auth0: { enabled: true, domain: auth0Domain } } },
      { label: 'malformed configuration', response: { auth0: 'true' } },
      { label: 'status failure', response: { message: 'Synthetic status failure' }, status: 500 },
    ];
    for (const testCase of cases) {
      configuration = testCase.response; configurationStatus = testCase.status || 200;
      await open(); await assertAuth0Lock(false);
      assert.equal(flowRequests(calls).length, 0, `${testCase.label} never starts any sign-in flow`);
      if (testCase.label === 'malformed configuration') await page.screenshot({ path: path.join(root, `.cache/audit-ui/account-access-auth0-locked-${mode}-${width}.png`), fullPage: true });
    }
    configuration = { auth0: readyAuth0 }; configurationStatus = 200;
    await open(); await waitState(true);
    assert.equal(await auth0Button.isEnabled(), true, 'A matching enabled backend unlocks the configured Auth0 frontend');
    assert.equal(await auth0Button.locator('.lucide-lock-keyhole').count(), 0);
    const configReads = calls.filter(call => call.endpoint === '/auth/config').length;
    await auth0Button.click();
    await page.waitForFunction(() => window.__accountAccessAudit.redirects.length === 1);
    const [redirect] = await page.evaluate(() => window.__accountAccessAudit.redirects);
    assert.deepEqual(redirect.authorizationParams, { redirect_uri: new URL(base).origin, scope: 'openid profile email', audience: auth0Audience, screen_hint: mode });
    assert.ok(calls.filter(call => call.endpoint === '/auth/config').length > configReads, 'The ready Auth0 handler rechecks backend readiness before SDK redirect');
    for (const failure of ['disabled', 'network']) {
      configuration = { auth0: readyAuth0 }; configurationStatus = 200;
      await open(); await waitState(true);
      if (failure === 'disabled') configuration = { auth0: { ...readyAuth0, enabled: false } };
      else configurationStatus = 500;
      await auth0Button.click(); await assertAuth0Lock(false);
      assert.deepEqual(await page.evaluate(() => window.__accountAccessAudit.redirects), [], 'Readiness lost before the click prevents SDK redirect');
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS Auth0 readiness ${mode}: real auth0Ready/auth0Checking, matching backend config, locked loading/error/malformed state, successful SDK handoff, last-click readiness recheck at ${width}px`);
  }
} finally { await browser?.close(); await server.close(); }
