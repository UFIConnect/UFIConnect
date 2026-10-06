import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exportRoot = process.env.EXPO_EXPORT_DIR || path.join(projectRoot, '.cache/export-sdk57');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(exportRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(exportRoot + path.sep)) throw new Error('Invalid path');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'application/octet-stream');
    response.end(await fs.readFile(file));
  } catch { response.statusCode = 404; response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks += 1; };
const profile = { id: 'synthetic-mobile-member', name: 'Test Member', email: 'member@example.test', title: 'Engineer', onboardingComplete: true, joinedGroups: [], skills: [], connectedPlatforms: [] };
const password = 'A synthetic mobile passphrase';

async function verifyReveal(page, field, name) {
  check(await field.evaluate(element => element.type) === 'password', `${name} starts masked`);
  await page.getByRole('button', { name: `Show ${name.toLowerCase()}`, exact: true }).click();
  await page.waitForFunction(label => document.querySelector(`input[aria-label="${label}"]`)?.type === 'text', name, { timeout: 2000 });
  check(await field.evaluate(element => element.type) === 'text' && await field.inputValue() !== '', `${name} can be explicitly revealed`);
  const exports = await field.evaluate(element => ['copy', 'cut', 'dragstart'].every(type => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }));
  check(exports, `${name} still blocks copy, cut, and drag while visible`);
  await page.evaluate(() => navigator.clipboard.writeText('public-clipboard-sentinel'));
  await field.press('ControlOrMeta+A');
  await field.press('ControlOrMeta+C');
  check(await page.evaluate(() => navigator.clipboard.readText()) === 'public-clipboard-sentinel', `${name} blocks real keyboard copying while revealed`);
  const entered = await field.inputValue();
  await field.press('ControlOrMeta+X');
  check(await page.evaluate(() => navigator.clipboard.readText()) === 'public-clipboard-sentinel' && await field.inputValue() === entered, `${name} blocks real keyboard cutting while revealed`);
  await page.getByRole('button', { name: `Hide ${name.toLowerCase()}`, exact: true }).click();
  check(await field.evaluate(element => element.type) === 'password', `${name} can be explicitly hidden`);
  await page.getByRole('button', { name: `Show ${name.toLowerCase()}`, exact: true }).click();
  await field.blur();
  check(await field.evaluate(element => element.type) === 'password', `${name} hides when focus leaves`);
}

try {
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, headless: true } : { channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    const runtimeErrors = [];
    const requests = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('token', 'synthetic-legacy-session'));
    await page.route('https://api.uficonnect.org/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      requests.push({ pathname, method: request.method(), body: request.postDataJSON(), authorization: request.headers().authorization });
      const data = pathname === '/auth/login' ? { token: 'synthetic-live-session', profile }
        : pathname === '/profile' ? { profile }
          : pathname === '/profile/password' ? { ok: true, requiresSignIn: true }
            : { users: [], opportunities: [], groups: [], categories: [], posts: [], jobs: [], messages: [], platforms: [] };
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto(base);
    await page.getByRole('button', { name: 'Decline analytics', exact: true }).click();
    const field = page.getByLabel('Password', { exact: true });
    await field.waitFor();
    check(await page.evaluate(() => localStorage.getItem('token')) === null, 'Legacy web token must be removed');
    await field.fill(password);
    const protections = await field.evaluate(element => {
        const copy = new window.ClipboardEvent('copy', { bubbles: true, cancelable: true });
        const cut = new window.ClipboardEvent('cut', { bubbles: true, cancelable: true });
        const drag = new window.DragEvent('dragstart', { bubbles: true, cancelable: true });
        const paste = new window.ClipboardEvent('paste', { bubbles: true, cancelable: true });
      for (const event of [copy, cut, drag, paste]) element.dispatchEvent(event);
      return { type: element.type, autocomplete: element.autocomplete, copy: copy.defaultPrevented, cut: cut.defaultPrevented, drag: drag.defaultPrevented, paste: paste.defaultPrevented };
    });
    check(protections.type === 'password' && protections.autocomplete === 'current-password', 'Password masking and autofill must survive migration');
    check(protections.copy && protections.cut && protections.drag && !protections.paste, 'Password export is blocked and paste remains available');
    await verifyReveal(page, field, 'Password');
    await page.getByRole('button', { name: 'Show password', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    check(await field.evaluate(element => element.type) === 'password', 'Leaving the browser window hides the password');
    await page.getByRole('button', { name: 'Show password', exact: true }).focus();
    await page.keyboard.press('Enter');
    check(await field.evaluate(element => element.type) === 'text', 'Keyboard users can reveal the password');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => document.querySelector('input[aria-label="Password"]')?.value === '');
    check(await field.inputValue() === '' && await field.evaluate(element => element.type) === 'password', 'App backgrounding conceals and clears the password');
    await page.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await field.fill(password);
    await page.getByRole('button', { name: 'Show password', exact: true }).click();
    await field.fill('');
    await field.fill(password);
    check(await field.evaluate(element => element.type) === 'password', 'Clearing a password resets reveal state');
    await page.getByRole('button', { name: 'Show password', exact: true }).click();
    await page.getByText('Sign in', { exact: true }).click();
    check(await field.evaluate(element => element.type) === 'password', 'Invalid submission also hides the password');
    check(!requests.some(request => request.pathname === '/auth/login'), 'Missing login fields never reach the API');
    await page.getByText('Create one', { exact: true }).click();
    const registerField = page.getByLabel('New password', { exact: true });
    await registerField.fill(password);
    await verifyReveal(page, registerField, 'New password');
    await page.getByText('Sign in', { exact: true }).last().click();
    await field.waitFor();
    check(await field.inputValue() === '', 'Leaving the login screen clears its password');
    await field.fill(password);
    await page.getByPlaceholder('you@example.com').fill(profile.email);
    await page.getByText('Sign in', { exact: true }).click();
    await page.getByPlaceholder('Search jobs, gigs, grants, events...').waitFor();
    check(requests.some(request => request.pathname === '/auth/login' && request.body.password === password), 'Native API login contract must be preserved');
    check(await page.evaluate(() => Object.values(localStorage).every(value => !value.includes('synthetic-live-session'))), 'Expo web must not persist bearer tokens');
    await page.getByRole('tab', { name: 'Profile' }).click();
    await page.getByText('Security', { exact: true }).click();
    const currentField = page.getByLabel('Current password', { exact: true });
    const nextField = page.getByLabel('New password', { exact: true });
    const confirmField = page.getByLabel('Confirm new password', { exact: true });
    await currentField.fill(password);
    await nextField.fill(password);
    await confirmField.fill(password);
    for (const [field, name] of [[currentField, 'Current password'], [nextField, 'New password'], [confirmField, 'Confirm new password']]) {
      await verifyReveal(page, field, name);
    }
    await page.getByRole('button', { name: 'Show new password', exact: true }).click();
    await page.getByText('Update password', { exact: true }).click();
    await page.getByRole('alert').getByText('Choose a new password that is different from your current password.', { exact: true }).waitFor();
    check(!requests.some(request => request.pathname === '/profile/password'), 'Reusing the current password is rejected without an API request');
    check(await nextField.evaluate(element => element.type) === 'password', 'Rejected password reuse conceals the field');
    const nextPassword = 'A different synthetic passphrase';
    await nextField.fill(nextPassword);
    await confirmField.fill('A mismatched synthetic passphrase');
    await page.getByText('Update password', { exact: true }).click();
    await page.getByRole('alert').getByText('Passwords do not match. Re-enter your new password.', { exact: true }).waitFor();
    check(!requests.some(request => request.pathname === '/profile/password'), 'Mismatched confirmation never reaches the API');
    await confirmField.fill(nextPassword);
    await page.screenshot({ path: path.join(projectRoot, `.cache/export-security-${width}.png`), fullPage: true });
    await page.getByText('Update password', { exact: true }).click();
    await page.getByLabel('Password', { exact: true }).waitFor();
    check(requests.some(request => request.pathname === '/profile/password' && request.authorization === 'Bearer synthetic-live-session' && request.body.newPassword === nextPassword), 'Password changes must use authenticated API requests');
    check(await page.getByLabel('Password', { exact: true }).inputValue() === '', 'Password change must clear the local session and secret fields');
    await page.reload();
    await page.getByLabel('Password', { exact: true }).waitFor();
    check(runtimeErrors.length === 0, `No browser runtime errors: ${runtimeErrors.join('; ')}`);
    await context.close();
  }
  console.log(`Expo SDK57 exported-web audit: ${checks} checks passed at phone and desktop widths.`);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
