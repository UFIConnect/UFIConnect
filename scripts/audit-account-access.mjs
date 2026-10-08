import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') }, server: { host: '127.0.0.1', port: 5282, strictPort: false } });
let browser;
try {
  await server.listen(); const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [390, 1440]) for (const mode of ['login', 'signup', 'link']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.addInitScript(() => window.localStorage.setItem('uficonnect.analytics.consent.v1', 'denied'));
    const errors = [], calls = []; page.on('pageerror', error => errors.push(error.message));
    let authenticated = mode === 'link', statusFailure = mode === 'login', phoneLinked = false;
    const profile = { id: 'account-access-member', name: 'Private Member', email: 'private@example.test', title: 'Engineer', plan: 'free', authProvider: 'local', onboardingComplete: mode !== 'signup', skills: [], joinedGroups: [], preferences: {}, roleSettings: {} };
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (['accounts.google.com', 'appleid.apple.com'].includes(url.hostname)) return route.fulfill({ contentType: 'text/html', body: '<h1>Stub identity provider</h1>' });
      if (url.origin !== new URL(base).origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.slice(4), body = request.postDataJSON(), authorization = request.headers().authorization;
      calls.push({ endpoint, body, authorization });
      if (/events|stream/.test(endpoint)) return route.fulfill({ contentType: 'text/event-stream', body: '' });
      if (endpoint === '/auth/session') return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { token: 'synthetic-account-session', profile } : { message: 'Signed out' } });
      if (endpoint === '/auth/providers') return route.fulfill({ status: statusFailure ? 500 : 200, json: statusFailure ? { message: 'Synthetic unavailable status' } : { providers: { google: { enabled: true }, apple: { enabled: false }, phone: { enabled: true } } } });
      if (endpoint === '/auth/providers/linked') return route.fulfill({ json: { methods: phoneLinked ? [{ provider: 'phone', linkedAt: '2026-10-08T00:00:00Z' }] : [], passwordAvailable: true } });
      if (/^\/auth\/providers\/google\/(start|link)$/.test(endpoint)) return route.fulfill({ json: { authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic' } });
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
      statusFailure = false; await panel.getByRole('button', { name: 'Retry options', exact: true }).click();
    }
    await panel.getByRole('button', { name: /^Continue with Google/ }).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.account-access-provider')].some(button => button.textContent.includes('Google') && !button.disabled));
    assert.equal(await panel.getByRole('button', { name: /^Continue with Apple/ }).isDisabled(), true);
    if (mode !== 'signup') {
      await panel.getByRole('button', { name: /^Continue with Google/ }).click();
      await page.waitForURL('https://accounts.google.com/**');
      const start = calls.find(call => call.endpoint.endsWith(mode === 'link' ? '/google/link' : '/google/start'));
      assert.deepEqual(start.body, mode === 'link' ? { client: 'web' } : { client: 'web', mode: 'login', returnTo: '/settings?tab=security' });
      assert.equal(Boolean(start.authorization), mode === 'link');
      await page.goto(base + target);
    }
    await panel.getByRole('button', { name: mode === 'link' ? /^Connect phone number/ : /^Continue with phone number/ }).click();
    if (mode === 'signup') await panel.getByLabel('Full name', { exact: true }).fill('Private Signup Member');
    await panel.getByLabel('Phone number', { exact: true }).fill('555');
    await panel.getByRole('button', { name: 'Send verification code', exact: true }).click();
    await panel.getByText('Enter your phone number with its country code, such as +1 555 123 4567.', { exact: true }).waitFor();
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
      assert.equal(await panel.getByRole('button', { name: /Connect phone number.*Connected/ }).isDisabled(), true);
      await page.goto(base + 'settings?tab=security&auth_error=account_exists');
      await panel.getByText('This sign-in method is already connected to another account.', { exact: true }).waitFor();
    }
    assert.deepEqual(calls.filter(call => call.endpoint === '/auth/phone/verify').at(-1).body, { verificationId: 'synthetic-verification', code: '123456' });
    assert.equal(await page.evaluate(() => JSON.stringify({ ...window.localStorage, ...window.sessionStorage }).includes('synthetic-verified-session')), false);
    assert.ok(calls.filter(call => call.endpoint.startsWith('/analytics/')).every(call => !/123456|14155550123|Private/.test(JSON.stringify(call.body))));
    assert.deepEqual(errors, []);
    await context.close(); console.log(`PASS account access ${mode}: readiness, provider destination, phone verification, private data, layout at ${width}px`);
  }
} finally { await browser?.close(); await server.close(); }
