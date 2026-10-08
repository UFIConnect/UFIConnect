import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate } from './audit-session.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const bcrypt = require('../backend/node_modules/bcryptjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-ui');
const app = await createAppHarness();
const server = await createServer({
  root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('') },
  server: { host: '127.0.0.1', port: 5221, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } },
});
let browser;
let checks = 0;
const fixturePassword = 'cobalt-rain7';
const resetPassword = 'harbor-mist7';
const nextPassword = 'violet-wave7';
const check = (condition, message) => { assert.ok(condition, message); checks += 1; };

async function checkProtectedField(page, selector, autoComplete) {
  const input = page.locator(selector);
  await input.fill(fixturePassword);
  const result = await input.evaluate(element => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'synthetic sentinel');
    const copy = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard });
    const cut = new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: clipboard });
    const drag = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    element.dispatchEvent(copy); element.dispatchEvent(cut); element.dispatchEvent(drag); element.dispatchEvent(paste);
    return { type: element.type, autoComplete: element.autocomplete, copy: copy.defaultPrevented, cut: cut.defaultPrevented,
      drag: drag.defaultPrevented, paste: paste.defaultPrevented, clipboardEmpty: clipboard.getData('text/plain') === '',
      spellCheck: element.spellcheck, draggable: element.draggable };
  });
  check(result.type === 'password', 'Password fields must be hidden by default');
  check(result.autoComplete === autoComplete, 'Password manager autocomplete must remain enabled');
  check(result.copy && result.cut && result.drag && result.clipboardEmpty, 'Password export events must be cancelled');
  check(!result.paste && !result.spellCheck && !result.draggable, 'Paste must remain available without spelling or dragging');
  check(await input.inputValue() === fixturePassword, 'Cut must not remove the entered password');

  const toggle = page.locator(`button[aria-controls="${await input.getAttribute('id')}"]`);
  check(await toggle.getAttribute('aria-label') === 'Show password' && await toggle.getAttribute('aria-pressed') === 'false', 'Password reveal must have an accessible name and state');
  await input.focus();
  await input.evaluate(element => element.setSelectionRange(2, 7));
  await toggle.click();
  check(await input.getAttribute('type') === 'text' && await input.inputValue() === fixturePassword, 'Show must reveal only the value already in the field');
  check(await toggle.getAttribute('aria-label') === 'Hide password' && await toggle.getAttribute('aria-pressed') === 'true', 'Revealed state must offer Hide');
  await page.waitForFunction(value => {
    const element = document.querySelector(value);
    return element === document.activeElement && element.selectionStart === 2 && element.selectionEnd === 7;
  }, selector);
  const selection = await input.evaluate(element => ({ focused: element === document.activeElement, start: element.selectionStart, end: element.selectionEnd }));
  check(selection.focused && selection.start === 2 && selection.end === 7, `Pointer reveal must preserve input focus and selection (${JSON.stringify(selection)})`);
  const revealed = await input.evaluate(element => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', 'synthetic sentinel');
    const events = [
      new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: clipboard }),
      new ClipboardEvent('cut', { bubbles: true, cancelable: true, clipboardData: clipboard }),
      new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }),
    ];
    events.forEach(event => element.dispatchEvent(event));
    return events.every(event => event.defaultPrevented) && clipboard.getData('text/plain') === '';
  });
  check(revealed, 'Revealed passwords must keep copy, cut, and drag protection');
  await toggle.click();
  check(await input.getAttribute('type') === 'password', 'Hide must mask the same input again');
  await input.focus();
  await page.keyboard.press('Tab');
  check(await toggle.evaluate(element => element === document.activeElement), 'Reveal control must be keyboard reachable from its password field');
  await page.keyboard.press('Space');
  check(await input.getAttribute('type') === 'text', 'Keyboard users must be able to reveal a password');
  await page.keyboard.press('Escape');
  check(await input.getAttribute('type') === 'password', 'Escape must hide a revealed password');
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  check(await input.getAttribute('type') === 'password', 'Leaving the field and its toggle must hide the password');
  await input.focus();
  await toggle.click();
  check(await input.evaluate(element => {
    window.dispatchEvent(new Event('pagehide'));
    return element.type === 'password';
  }), 'Page hiding must conceal the password synchronously before the page can be frozen');
  await toggle.click();
  check(await input.evaluate(element => {
    window.dispatchEvent(new Event('blur'));
    return element.type === 'password';
  }), 'Switching windows must conceal the password synchronously');
  await toggle.click();
  check(await input.evaluate(element => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
    return element.type === 'password';
  }), 'A hidden tab must conceal the password synchronously');
  await toggle.click();
  // PasswordInput restores the reveal selection on its next animation frame.
  // Playwright fill('') selects all, then sends Delete in a separate browser
  // operation. Finish that restoration before it can overwrite select-all.
  await input.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  check(await input.getAttribute('type') === 'text', 'The clearing check must begin with a revealed password');
  await input.fill('');
  check(await input.inputValue() === '', 'The clear operation must actually remove the complete password');
  check(await input.getAttribute('type') === 'password', 'Clearing a field must reset password visibility');
  await input.fill(fixturePassword);
}

async function checkPrivateStorage(page, secrets = []) {
  const safe = await page.evaluate(values => {
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        const value = storage.getItem(key) || '';
        if (key === 'pc_token' || key === 'ufi_profile_snapshot' || key.startsWith('@@auth0spajs@@')) return false;
        if (/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(value) || values.some(secret => secret && value.includes(secret))) return false;
      }
    }
    return true;
  }, [fixturePassword, resetPassword, nextPassword, ...secrets]);
  check(safe, 'Browser storage must not contain credentials or private profile snapshots');
}

try {
  await server.listen();
  await fs.mkdir(output, { recursive: true });
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of [1440, 390]) {
    const userId = `security-audit-${width}`;
    const user = member(userId, { authProvider: 'local', passwordHash: bcrypt.hashSync(fixturePassword, 4) });
    app.seedUser(user);
    const context = await browser.newContext({ viewport: { width, height: 960 }, isMobile: width < 600, hasTouch: width < 600 });
    await context.route(/^https:\/\//, route => route.abort());
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await context.addInitScript(() => {
      localStorage.setItem('pc_token', 'synthetic legacy credential');
      localStorage.setItem('ufi_profile_snapshot', 'synthetic legacy private profile');
      localStorage.setItem('@@auth0spajs@@old', 'synthetic legacy refresh credential');
      sessionStorage.setItem('ufi_feed_v1:old', 'synthetic private cache');
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    await installAuditMember(page, app, userId);
    const errors = [];
    const requests = [];
    let loginFailure = true;
    let registrationFailure = true;
    let resetFailure = true;
    let revokeFailure = false;
    let currentBearer = '';
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const headers = request.headers();
      if (headers.authorization?.startsWith('Bearer ')) currentBearer = headers.authorization;
      requests.push({ url: request.url(), referrer: headers.referer || '', type: request.resourceType(), body: request.postData() || '' });
    });
    await page.route('**/api/**', route => {
      const endpoint = new URL(route.request().url()).pathname.slice(4);
      if (endpoint === '/auth/login' && loginFailure) return route.fulfill({ status: 401, json: { message: 'Invalid email or password.' } });
      if (endpoint === '/auth/register' && registrationFailure) return route.fulfill({ status: 503, json: { message: 'Registration temporarily unavailable.' } });
      if (endpoint === '/auth/register') return route.fulfill({ status: 201, json: { token: app.token(userId), profile: app.fullProfile(user) } });
      if (endpoint === '/auth/reset-password' && resetFailure) return route.fulfill({ status: 503, json: { message: 'Reset temporarily unavailable.' } });
      if (endpoint === '/auth/logout-all' && revokeFailure) return route.fulfill({ status: 503, json: { message: 'Revocation temporarily unavailable.' } });
      if (endpoint === '/office/feed') return route.fulfill({ json: { posts: [], hasMore: false, nativeUficonnectIncluded: true } });
      if (endpoint === '/feed/stream') return route.fulfill({ contentType: 'text/event-stream', body: ': audit heartbeat\n\ndata: {"posts":[]}\n\n' });
      if (endpoint === '/security-audit/redirect') return route.fulfill({ status: 307, headers: { Location: base + 'api/security-audit/collector' }, body: '' });
      if (endpoint === '/security-audit/collector') return route.fulfill({ json: { received: true } });
      return route.fallback();
    });
    try {
      await auditNavigate(page, base + 'login');
      await checkProtectedField(page, '#login-password', 'current-password');
      // Exercise actual keyboard paste, copy, and cut in addition to events.
      await page.evaluate(() => navigator.clipboard.writeText('Synthetic password manager paste'));
      await page.locator('#login-password').fill('');
      await page.locator('#login-password').focus();
      await page.keyboard.press('Control+V');
      check(await page.locator('#login-password').inputValue() === 'Synthetic password manager paste', 'Password manager paste must enter the field');
      await page.evaluate(() => navigator.clipboard.writeText('Synthetic clipboard sentinel'));
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Control+C');
      check(await page.evaluate(() => navigator.clipboard.readText()) === 'Synthetic clipboard sentinel', 'Copy must not export the password');
      await page.keyboard.press('Control+X');
      check(await page.locator('#login-password').inputValue() === 'Synthetic password manager paste', 'Keyboard cut must preserve the password');
      await page.locator('button[aria-controls="login-password"]').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Control+C');
      check(await page.evaluate(() => navigator.clipboard.readText()) === 'Synthetic clipboard sentinel', 'A revealed password must not be copied by keyboard');
      await page.keyboard.press('Control+X');
      check(await page.locator('#login-password').inputValue() === 'Synthetic password manager paste', 'A revealed password must not be cut by keyboard');
      await page.locator('input[name="email"]').fill('synthetic@example.invalid');
      await page.locator('#login-password').focus();
      await page.locator('button[aria-controls="login-password"]').click();
      await page.keyboard.press('Enter');
      await page.getByText('Invalid email or password.', { exact: true }).waitFor();
      check(await page.locator('#login-password').getAttribute('type') === 'password', 'Submitting by Enter must remask a password even when sign-in fails');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByText('Invalid email or password.', { exact: true }).waitFor();
      check(new URL(page.url()).pathname === '/login', 'Failed sign-in must stay on the login screen');
      await checkPrivateStorage(page);
      await page.screenshot({ path: path.join(output, `security-login-${width}.png`) });

      await auditNavigate(page, base + 'register');
      await checkProtectedField(page, '#register-password', 'new-password');
      await checkProtectedField(page, '#register-confirm-password', 'new-password');
      await page.locator('button[aria-controls="register-password"]').click();
      await page.locator('button[aria-controls="register-confirm-password"]').click();
      check(await page.locator('#register-password').getAttribute('type') === 'password' && await page.locator('#register-confirm-password').getAttribute('type') === 'text', 'Showing another password field must hide the previously revealed field');
      await page.locator('input[name="name"]').fill('Synthetic Audit Member');
      await page.locator('input[name="email"]').fill(`synthetic-registration-${width}@example.invalid`);
      await page.locator('#register-password').fill('cobalt-rain');
      await page.locator('#register-confirm-password').fill('cobalt-rain');
      await page.getByRole('button', { name: 'Continue →', exact: true }).click();
      await page.getByText('Use at least 12 characters for your new password.', { exact: true }).waitFor();
      check(!requests.some(request => new URL(request.url).pathname === '/api/auth/register'), 'Short passwords must be rejected before submission');
      await page.locator('#register-password').fill('😀'.repeat(19));
      await page.locator('#register-confirm-password').fill('😀'.repeat(19));
      await page.getByRole('button', { name: 'Continue →', exact: true }).click();
      await page.getByText(/Password must be 72 UTF-8 bytes or fewer/).waitFor();
      await page.locator('#register-password').fill(fixturePassword);
      await page.locator('#register-confirm-password').fill(fixturePassword);
      await page.getByRole('button', { name: 'Continue →', exact: true }).click();
      await page.getByRole('button', { name: /Skip & create account/ }).click();
      await page.getByText('Registration temporarily unavailable.', { exact: true }).waitFor();
      check(new URL(page.url()).pathname === '/register', 'Failed registration must not create a UI session');
      registrationFailure = false;
      await page.getByRole('button', { name: 'Continue →', exact: true }).click();
      await page.getByRole('button', { name: /Skip & create account/ }).click();
      await page.waitForURL('**/onboarding');
      await checkPrivateStorage(page, [currentBearer.slice(7)]);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForURL('**/login');
      check(true, 'Reload must end a local session');

      const resetToken = app.createPasswordResetToken(user);
      const beforeReset = app.token(userId);
      // Existing emailed query links are still accepted and scrubbed. New
      // links put the reset credential in a fragment, outside HTTP requests.
      await auditNavigate(page, base + 'reset-password?token=' + encodeURIComponent(resetToken));
      await page.waitForURL('**/reset-password');
      check(!page.url().includes(resetToken), 'Legacy query reset links must be scrubbed');
      await auditNavigate(page, base + 'login');
      const fragmentStart = requests.length;
      await auditNavigate(page, base + 'reset-password#token=' + encodeURIComponent(resetToken));
      await page.waitForURL('**/reset-password');
      check(requests.slice(fragmentStart).every(request => !request.url.includes(resetToken)), 'Fragment reset credentials must never reach HTTP requests');
      await checkProtectedField(page, '#reset-password', 'new-password');
      await checkProtectedField(page, '#reset-confirm-password', 'new-password');
      await page.locator('#reset-password').fill(resetPassword);
      await page.locator('#reset-confirm-password').fill(resetPassword);
      check(!page.url().includes(resetToken), 'Reset token must be removed from browser history');
      await page.getByRole('button', { name: 'Reset password', exact: true }).click();
      await page.getByText('Reset temporarily unavailable.', { exact: true }).waitFor();
      check(await page.getByText(/Password updated/).count() === 0, 'Failed reset must not claim success');
      resetFailure = false;
      await page.locator('#reset-password').fill(fixturePassword);
      await page.locator('#reset-confirm-password').fill(fixturePassword);
      await page.getByRole('button', { name: 'Reset password', exact: true }).click();
      await page.getByText('Choose a new password different from your current password.', { exact: true }).waitFor();
      check(await page.getByText(/Password updated/).count() === 0, 'Resetting to the same password must display the server error without claiming success');
      check((await app.request('/profile', { headers: { authorization: `Bearer ${beforeReset}` } })).status === 200, 'A rejected password reset must not invalidate the existing session');
      await page.locator('#reset-password').fill('passwordpassword');
      await page.locator('#reset-confirm-password').fill('passwordpassword');
      await page.getByRole('button', { name: 'Reset password', exact: true }).click();
      await page.getByText('This password is too common or predictable. Choose a unique passphrase with unrelated words.', { exact: true }).waitFor();
      check(await page.getByText(/Password updated/).count() === 0, 'Common passwords must show the server blocklist error without claiming success');
      await page.locator('#reset-password').fill(resetPassword);
      await page.locator('#reset-confirm-password').fill(resetPassword);
      await page.getByRole('button', { name: 'Reset password', exact: true }).click();
      await page.getByText(/Password updated/).waitFor();
      check((await app.request('/profile', { headers: { authorization: `Bearer ${beforeReset}` } })).status === 401, 'Reset must revoke existing sessions');
      await page.waitForURL('**/login');
      await checkPrivateStorage(page, [resetToken]);

      loginFailure = false;
      const liveRequest = page.waitForRequest(request => new URL(request.url()).pathname === '/api/feed/stream');
      await auditNavigate(page, base);
      const live = await liveRequest;
      check(Boolean(live.headers().authorization?.startsWith('Bearer ')), 'Live updates must authenticate with a request header');
      await auditNavigate(page, base + 'settings');
      await page.getByRole('button', { name: 'Security', exact: true }).click();
      await page.getByRole('button', { name: 'Sign out all sessions', exact: true }).waitFor();
      await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Sign out all sessions')?.disabled);
      const transport = await page.evaluate(async () => {
        const { default: client } = await import('/src/api/client.js');
        const rejects = async (request) => { try { await request(); return false; } catch { return true; } };
        return Promise.all([
          rejects(() => client.get('https://untrusted.example/security-audit/collector')),
          rejects(() => client.get('//untrusted.example/security-audit/collector')),
          rejects(() => client.get('/profile', { _ufiApiOrigin: 'https://untrusted.example' })),
          rejects(() => client.get('/security-audit/redirect')),
        ]);
      });
      check(transport.every(Boolean), 'API transport must reject arbitrary destinations and redirects');
      check(!requests.some(request => new URL(request.url).pathname === '/api/security-audit/collector' || new URL(request.url).hostname === 'untrusted.example'), 'Rejected requests and redirects must not reach a credential collector');
      for (const [selector, autocomplete] of [['#current-password', 'current-password'], ['#new-password', 'new-password'], ['#confirm-password', 'new-password']]) {
        await checkProtectedField(page, selector, autocomplete);
      }
      for (const selector of ['#current-password', '#new-password', '#confirm-password']) await page.locator(selector).fill(resetPassword);
      const changeRequestsBeforeReuse = requests.filter(request => new URL(request.url).pathname === '/api/profile/password').length;
      await page.getByRole('button', { name: 'Update password', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Choose a new password different from your current password.' }).waitFor();
      check(requests.filter(request => new URL(request.url).pathname === '/api/profile/password').length === changeRequestsBeforeReuse, 'The unchanged password must be rejected before a change request is sent');
      check(new URL(page.url()).pathname === '/settings', 'Rejecting the unchanged password must preserve the settings session');
      await page.locator('#new-password').fill(nextPassword);
      check(await page.getByText('Choose a new password different from your current password.', { exact: true }).count() === 0, 'Editing a password must clear the stale validation error');
      await page.locator('#confirm-password').fill(nextPassword);
      await page.locator('#current-password').fill('An incorrect synthetic password');
      await page.getByRole('button', { name: 'Update password', exact: true }).click();
      await page.getByText('Current password is incorrect.', { exact: true }).waitFor();
      check(new URL(page.url()).pathname === '/settings', 'Incorrect current password must allow a retry');
      check(await page.getByText(/^Password updated\./).count() === 0, 'Rejected password change must not claim success');
      await page.locator('#current-password').fill(resetPassword);
      await checkPrivateStorage(page, [currentBearer.slice(7)]);
      await page.screenshot({ path: path.join(output, `security-settings-${width}.png`), fullPage: true });
      const beforeChange = currentBearer;
      await page.getByRole('button', { name: 'Update password', exact: true }).click();
      await page.waitForURL('**/login');
      check((await app.request('/profile', { headers: { authorization: beforeChange } })).status === 401, 'Password change must revoke the previous bearer');
      await checkPrivateStorage(page, [beforeChange.slice(7)]);

      // The synthetic cookie fixture must observe the revocation too. It
      // otherwise mints a fresh session on the next /login navigation, which
      // correctly redirects an authenticated member away from the form.
      await installAuditMember(page, app, userId);
      await auditNavigate(page, base + 'settings');
      await page.getByRole('button', { name: 'Security', exact: true }).click();
      const revoke = page.getByRole('button', { name: 'Sign out all sessions', exact: true });
      await revoke.waitFor();
      revokeFailure = true;
      await revoke.click();
      await page.getByText('Could not sign out all sessions. Check your connection and try again.', { exact: true }).waitFor();
      check(new URL(page.url()).pathname === '/settings', 'Failed revocation must retain the account controls for retry');
      revokeFailure = false;
      const beforeRevoke = currentBearer;
      await revoke.click();
      await page.waitForURL('**/login');
      check((await app.request('/profile', { headers: { authorization: beforeRevoke } })).status === 401, 'Sign out all sessions must revoke the current bearer');
      await checkPrivateStorage(page, [beforeRevoke.slice(7)]);
      check(requests.some(request => new URL(request.url).pathname === '/api/feed/stream'), 'The audit must exercise authenticated live updates');
      check(requests.every(request => {
        const url = new URL(request.url);
        const resetDocument = request.type === 'document' && url.pathname === '/reset-password';
        return !(url.pathname === '/api/feed/stream' && url.search) && (resetDocument || !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(request.url));
      }), 'Bearer credentials must never enter request URLs');
      check(requests.every(request => !request.referrer.includes(resetToken)), 'Reset credentials must never enter request referrers');
      check(requests.filter(request => /analytics|client-error/.test(request.url)).every(request => !request.body.includes(resetToken) && !request.body.includes(fixturePassword)), 'Telemetry must exclude passwords and reset credentials');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Security flows must fit the viewport');
      check(errors.length === 0, 'Security flows must have no browser runtime errors');
      console.log(`PASS: Security inputs, storage, reset, password changes and session revocation at ${width}px`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `security-failure-${width}.png`), fullPage: true }).catch(() => {});
      throw error;
    } finally {
      await page.evaluate(() => navigator.clipboard.writeText('')).catch(() => {});
      await context.close();
    }
  }
  console.log(`PASS: ${checks} browser security checks`);
} finally {
  await browser?.close();
  await server.close();
  await app.close();
}
