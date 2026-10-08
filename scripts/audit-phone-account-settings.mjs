// All account/session, SMS and email verification responses are synthetic.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5289, strictPort: false } });
let browser, checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
try {
  await server.listen(); const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' }), page = await context.newPage();
    page.setDefaultTimeout(12000);
    await page.addInitScript(() => localStorage.setItem('uficonnect.analytics.consent.v1', 'denied'));
    const calls = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const initial = { id: 'a0000000-0000-4000-8000-000000000001', name: 'Synthetic Phone Member', email: '', hasEmail: false, phone: '+14155550123',
      authProvider: 'phone', plan: 'free', title: '', onboardingComplete: true, skills: [], joinedGroups: [], preferences: {}, roleSettings: {} };
    let profile = { ...initial }, verificationEmail = '', requestedPhone = '';
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== new URL(base).origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const endpoint = url.pathname.slice(4), body = request.postDataJSON();
      calls.push({ endpoint, body, authorization: request.headers().authorization });
      if (/events|stream/.test(endpoint)) return route.fulfill({ contentType: 'text/event-stream', body: '' });
      if (endpoint === '/auth/session') return route.fulfill({ json: { token: 'synthetic-phone-settings-session', profile } });
      if (endpoint === '/profile' || endpoint === '/auth/me') {
        if (request.method() === 'PATCH') profile = { ...profile, ...body };
        return route.fulfill({ json: profile });
      }
      if (endpoint === '/auth/email/config') return route.fulfill({ json: { available: true } });
      if (endpoint === '/auth/email/request') { verificationEmail = body.email; return route.fulfill({ json: { verificationId: 'synthetic-email-verification', expiresIn: 600, resendAfter: 60 } }); }
      if (endpoint === '/auth/email/verify') {
        if (body.code !== '123456') return route.fulfill({ status: 400, json: { message: 'The email verification code is incorrect.' } });
        profile = { ...profile, email: verificationEmail, hasEmail: true };
        return route.fulfill({ json: { profile } });
      }
      if (endpoint === '/auth/providers') return route.fulfill({ json: { providers: { google: { configured: true, enabled: true }, apple: { configured: true, enabled: true }, phone: { configured: true, enabled: true } } } });
      if (endpoint === '/auth/providers/linked') return route.fulfill({ json: { methods: [{ provider: 'phone', linkedAt: '2026-10-08T00:00:00Z' }], passwordAvailable: false } });
      if (endpoint === '/auth/phone/link') { requestedPhone = body.phoneNumber; return route.fulfill({ json: { verificationId: 'synthetic-phone-replacement', expiresIn: 600, resendAfter: 60 } }); }
      if (endpoint === '/auth/phone/verify') {
        if (body.code !== '123456') return route.fulfill({ status: 409, json: { message: 'This sign-in method is already connected to another account.' } });
        profile = { ...profile, phone: requestedPhone };
        return route.fulfill({ json: { token: 'synthetic-replaced-phone-session', profile } });
      }
      if (endpoint === '/profile/security') return route.fulfill({ json: { passwordChangeAvailable: false, serverSessionRevocation: true } });
      if (endpoint.startsWith('/analytics/')) return route.fulfill({ status: 204 });
      return route.fulfill({ json: { sources: [], posts: [], groups: [], notifications: [], conversations: [], connected: {}, platforms: {}, users: [], members: [], requests: [], items: [], invitations: [], unreadCount: 0, count: 0 } });
    });
    await page.goto(base + 'policies');
    const reminder = page.getByRole('dialog', { name: 'Add an email address', exact: true });
    await reminder.waitFor();
    check(await reminder.getAttribute('aria-modal') === 'false', 'Reminder does not block account use');
    check(await reminder.getByText(/without an email or password/).isVisible(), 'Phone account stays independent');
    await reminder.getByRole('button', { name: 'Not now', exact: true }).click();
    await page.reload(); await page.waitForTimeout(3100);
    check(await reminder.count() === 0, 'Snooze survives reload and restored sign-in');
    const persisted = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('uficonnect.email-reminder.v1.')));
    check(persisted.length === 1 && !JSON.stringify(persisted).includes(initial.id) && !JSON.stringify(persisted).includes(initial.phone), 'Reminder preference excludes raw account and phone data');
    profile = { ...initial, id: 'a0000000-0000-4000-8000-000000000002' };
    await page.reload(); await reminder.waitFor();
    await reminder.getByRole('link', { name: 'Add email in Settings' }).click();
    await page.waitForURL(url => url.pathname === '/settings' && url.searchParams.get('tab') === 'account' && url.hash === '#email');
    check(await reminder.count() === 0, 'Settings reminder link is specific and does not reopen the popup');
    const emailPanel = page.getByRole('region', { name: 'Email address', exact: true });
    await emailPanel.getByLabel('New email address').fill('Added@Example.test');
    await emailPanel.getByRole('button', { name: 'Send verification email', exact: true }).click();
    await emailPanel.getByLabel('Email verification code').waitFor();
    check(profile.hasEmail === false && profile.email === '', 'Requesting a code does not save an unverified email');
    check(await emailPanel.getByRole('button', { name: /^Resend in/ }).isDisabled(), 'Email resend has a cooldown');
    await emailPanel.getByLabel('Email verification code').fill('000000');
    await emailPanel.getByRole('button', { name: 'Verify and add email' }).click();
    await emailPanel.getByRole('alert').waitFor();
    check(await emailPanel.getByLabel('Email verification code').inputValue() === '' && !profile.hasEmail, 'Incorrect code clears the input and preserves phone-only account');
    await emailPanel.getByLabel('Email verification code').fill('123456');
    await emailPanel.getByRole('button', { name: 'Verify and add email' }).click();
    await emailPanel.getByText('Email verified and added. Your phone sign-in stays available.', { exact: true }).waitFor();
    check(profile.authProvider === 'phone' && profile.phone === initial.phone, 'Verified email addition preserves phone sign-in');
    check(await page.locator('input[type=password]').count() === 0, 'Adding an email never requires a password');
    check(await page.getByLabel('Private phone number').getAttribute('readonly') !== null, 'General profile cannot change the sign-in phone directly');
    await page.getByRole('link', { name: 'Security', exact: true }).click();
    const access = page.getByRole('region', { name: 'Account sign-in methods', exact: true });
    await access.getByRole('button', { name: /Change phone number/ }).click();
    await access.getByLabel('Phone number', { exact: true }).fill('+1 415 555 0199');
    await access.getByRole('button', { name: 'Send verification code' }).click();
    await access.getByLabel('Verification code', { exact: true }).waitFor();
    const requested = calls.filter(call => call.endpoint === '/auth/phone/link').at(-1);
    check(requested.body.phoneNumber === '+14155550199' && requested.body.replacePhone === true && Boolean(requested.authorization), 'Phone replacement uses authenticated verified replacement route');
    check(profile.phone === initial.phone, 'Old login number remains until the new number is verified');
    await access.getByLabel('Verification code', { exact: true }).fill('000000');
    await access.getByRole('button', { name: 'Verify and change phone number', exact: true }).click();
    await access.getByRole('alert').waitFor();
    check(profile.phone === initial.phone, 'Collision or invalid code preserves the old phone identity');
    await access.getByLabel('Verification code', { exact: true }).fill('123456');
    await access.getByRole('button', { name: 'Verify and change phone number', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('linked') === 'phone');
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await page.getByLabel('Private phone number').waitFor();
    check(await page.getByLabel('Private phone number').inputValue() === '+14155550199', 'Settings shows verified replacement phone');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('Settings saved', { exact: true }).first().waitFor();
    check(!Object.hasOwn(calls.filter(call => call.endpoint === '/profile' && call.body).at(-1).body, 'phone'), 'Saving other Settings cannot overwrite the verified number');
    await page.goto(base + 'policies'); await page.waitForTimeout(3100);
    check(await reminder.count() === 0, 'Phone-created account with an added email gets no popup');
    profile = { ...initial, id: 'a0000000-0000-4000-8000-000000000003', authProvider: 'local' };
    await page.reload(); await page.waitForTimeout(3100);
    check(await reminder.count() === 0, 'Other sign-up methods never receive this reminder');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Account surfaces fit viewport');
    check(errors.length === 0, 'No runtime errors: ' + errors.join('; '));
    await context.close();
  }
  console.log(`PASS: ${checks} phone account reminder, verified email and editable phone Settings browser checks; no SMS or email sent.`);
} finally { await browser?.close(); await server.close(); }
