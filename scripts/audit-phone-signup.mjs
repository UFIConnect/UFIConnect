import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') }, server: { host: '127.0.0.1', port: 5283, strictPort: false } });
let browser;
try {
  await server.listen(); const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [320, 390, 1440]) for (const provider of ['phone', 'google', 'apple']) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('uficonnect.analytics.consent.v1', 'denied'));
    const errors = [], calls = [];
    page.on('pageerror', error => errors.push(error.message));
    let authenticated = provider !== 'phone';
    const profile = { id: 'synthetic-new-member', name: 'Phone Member', email: provider === 'phone' ? '' : 'provider@example.test', phone: provider === 'phone' ? '+14155550123' : '',
      hasEmail: provider !== 'phone', title: '', plan: 'free', authProvider: provider, onboardingComplete: false, skills: [], joinedGroups: [], preferences: {}, roleSettings: {} };
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.slice(4), body = request.postDataJSON();
      calls.push({ endpoint, body, authorization: request.headers().authorization });
      if (/events|stream/.test(endpoint)) return route.fulfill({ contentType: 'text/event-stream', body: '' });
      if (endpoint === '/auth/session') return route.fulfill({ status: authenticated ? 200 : 401, json: authenticated ? { token: 'synthetic-new-session', profile } : { message: 'Signed out' } });
      if (endpoint === '/auth/providers') return route.fulfill({ json: { providers: { google: { configured: true, enabled: true }, apple: { configured: true, enabled: true }, phone: { configured: true, enabled: true } } } });
      if (endpoint === '/auth/phone/request') return route.fulfill({ json: { verificationId: 'synthetic-verification', expiresIn: 600, resendAfter: 60 } });
      if (endpoint === '/auth/phone/verify') return route.fulfill({ json: { requiresSignup: true, registrationId: 'synthetic-one-use-phone-proof', expiresIn: 300 } });
      if (endpoint === '/auth/phone/complete-signup') { authenticated = true; return route.fulfill({ json: { token: 'synthetic-new-session', profile, created: true } }); }
      if (endpoint === '/profile/onboarding') { profile.onboardingComplete = true; profile.preferences = body; return route.fulfill({ json: { profile } }); }
      if (endpoint === '/profile') return route.fulfill({ json: profile });
      if (endpoint === '/auth/providers/linked') return route.fulfill({ json: { methods: [{ provider }], passwordAvailable: false } });
      if (endpoint === '/profile/security') return route.fulfill({ json: { passwordChangeAvailable: false, serverSessionRevocation: true } });
      if (endpoint.startsWith('/analytics/')) return route.fulfill({ status: 204 });
      return route.fulfill({ json: { sources: [], posts: [], groups: [], notifications: [], conversations: [], connected: {}, platforms: {}, users: [], members: [], requests: [], items: [], invitations: [], unreadCount: 0, count: 0 } });
    });
    await page.goto(base + `login?returnTo=%2Fsettings%3Ftab%3Dsecurity${provider === 'phone' ? '' : '&provider=' + provider}`);
    if (provider === 'phone') {
      const panel = page.getByRole('region', { name: 'Sign-in options', exact: true });
      await panel.getByRole('button', { name: /^Continue with phone number/ }).click();
      assert.equal(await panel.getByLabel('Country or region', { exact: true }).inputValue(), 'US');
      await panel.getByLabel('Country or region', { exact: true }).selectOption('GB');
      await panel.getByLabel('Phone number', { exact: true }).fill('+1 (415) 555-0123');
      await panel.getByRole('button', { name: 'Send verification code', exact: true }).click();
      await panel.getByLabel('Verification code', { exact: true }).fill('123456');
      await panel.getByRole('button', { name: 'Verify and sign in', exact: true }).click();
      await panel.getByRole('heading', { name: 'Create your phone account', exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/login');
      assert.equal(await panel.locator('input[type="email"],input[type="password"]').count(), 0);
      assert.equal(calls.filter(call => call.endpoint === '/auth/phone/request').length, 1);
      assert.deepEqual(calls.find(call => call.endpoint === '/auth/phone/request').body, { phoneNumber: '+14155550123', mode: 'login' });
      assert.equal(calls.some(call => ['/auth/register', '/auth/login', '/profile/onboarding'].includes(call.endpoint)), false);
      await panel.getByLabel('Full name', { exact: true }).fill('Phone Member');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await panel.getByRole('button', { name: 'Create account with phone', exact: true }).click();
      assert.deepEqual(calls.find(call => call.endpoint === '/auth/phone/complete-signup').body, { registrationId: 'synthetic-one-use-phone-proof', name: 'Phone Member' });
    }
    await page.waitForURL(url => url.pathname === '/onboarding');
    await page.getByRole('heading', { name: 'What best describes you?', exact: true }).waitFor();
    assert.equal(await page.locator('input[type="email"],input[type="password"]').count(), 0);
    await page.getByRole('button', { name: /Other \/ Custom/ }).click();
    await page.getByPlaceholder('e.g. Robotics Engineer, Indie Author, NFT Curator...').fill('Software Engineer');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Search topics', { exact: true }).fill('Open Source');
    await page.getByRole('button', { name: 'Open Source', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: /Junior.*1-3 years/ }).click();
    await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/settings');
    assert.deepEqual(calls.find(call => call.endpoint === '/profile/onboarding').body, { role: 'Software Engineer', interests: ['Open Source'], experience: 'junior' });
    assert.ok(calls.find(call => call.endpoint === '/profile/onboarding').authorization);
    assert.equal(calls.some(call => call.endpoint === '/auth/register'), false);
    assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('synthetic-one-use-phone-proof')), false);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS ${provider}: private session, independent signup, onboarding and return destination at ${width}px`);
  }
} finally { await browser?.close(); await server.close(); }
