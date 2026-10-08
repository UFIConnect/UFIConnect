import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exportRoot = process.env.EXPO_EXPORT_DIR || path.join(mobile, '.cache/export-sdk57');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(exportRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(exportRoot + path.sep)) throw new Error('Invalid path');
    response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store'); response.end(await fs.readFile(file));
  } catch { response.statusCode = 404; response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [390, 1280]) for (const mode of ['login', 'signup']) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage();
    const calls = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let ready = true;
    const profile = { id: 'synthetic-phone-member', name: 'Private Phone Member', email: '', title: 'Private Role', onboardingComplete: true, joinedGroups: [], skills: [], connectedPlatforms: [] };
    await page.route('https://api.uficonnect.org/**', async route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const body = request.postDataJSON(); calls.push({ pathname, body });
      let data = { users: [], opportunities: [], groups: [], categories: [], posts: [], jobs: [], messages: [], platforms: [] };
      if (pathname === '/auth/providers') data = { providers: { google: { enabled: true }, apple: { enabled: false }, phone: { enabled: ready } } };
      if (pathname === '/auth/phone/request') data = { verificationId: 'synthetic-verification', expiresIn: 600, resendAfter: 60 };
      if (pathname === '/auth/phone/verify') {
        if (body.code === '000000') return route.fulfill({ status: 400, headers, json: { message: 'That code could not be verified.' } });
        data = { token: 'synthetic-phone-session', profile, created: mode === 'signup' };
      }
      if (pathname === '/profile') data = { profile };
      return route.fulfill({ headers, json: data });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: 'Decline analytics', exact: true }).click();
    if (mode === 'signup') await page.getByText('Create one', { exact: true }).click();
    await page.getByRole('button', { name: 'Continue with phone number', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Continue with Apple', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Continue with Google', exact: true }).isDisabled(), true, 'Expo preview sends social sign-in to the main website');
    await page.getByRole('link', { name: 'Sign in on uficonnect.org', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Continue with phone number', exact: true }).click();
    await page.getByLabel('Phone number for verification', { exact: true }).fill('555');
    await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
    await page.getByText('Enter your phone number with its country code, such as +14155550123.', { exact: true }).waitFor();
    assert.equal(calls.some(call => call.pathname === '/auth/phone/request'), false);
    if (mode === 'signup') {
      await page.getByLabel('Phone signup full name', { exact: true }).fill(profile.name);
      await page.getByLabel('Phone signup professional title', { exact: true }).fill(profile.title);
    }
    await page.getByLabel('Phone number for verification', { exact: true }).fill('+1 (415) 555-0123');
    await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
    await page.getByLabel('Phone verification code', { exact: true }).waitFor();
    assert.deepEqual(calls.find(call => call.pathname === '/auth/phone/request').body, {
      phoneNumber: '+14155550123', mode, ...(mode === 'signup' ? { name: profile.name, title: profile.title } : {}),
    });
    assert.equal(await page.getByRole('button', { name: /^Resend code in/ }).isDisabled(), true);
    await page.getByLabel('Phone verification code', { exact: true }).fill('000000');
    await page.getByRole('button', { name: 'Verify phone number', exact: true }).click();
    await page.getByText('That code could not be verified.', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Phone verification code', { exact: true }).inputValue(), '');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByLabel('Phone verification code', { exact: true }).fill('123456');
    await page.getByRole('button', { name: 'Verify phone number', exact: true }).click();
    await page.getByPlaceholder('Search jobs, gigs, grants, events...').waitFor();
    assert.deepEqual(calls.filter(call => call.pathname === '/auth/phone/verify').at(-1).body, { verificationId: 'synthetic-verification', code: '123456' });
    assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage }).includes('synthetic-phone-session')), false);
    assert.ok(calls.filter(call => call.pathname.startsWith('/analytics/')).every(call => !/123456|14155550123|Private/.test(JSON.stringify(call.body))));
    ready = false; await page.reload();
    await page.getByText('Phone verification is currently unavailable.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Continue with phone number', exact: true }).isDisabled(), true);
    assert.equal(calls.some(call => call.pathname.startsWith('/auth/providers/') && call.pathname.endsWith('/start')), false);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS mobile ${mode}: verified phone, readiness, resend protection, private storage, and layout at ${width}px`);
  }
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
