// Synthetic vaults only. Never read a user's vault or contact external services.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createAppHarness, member } = createRequire(import.meta.url)('../backend/test-support/app-harness');
const app = await createAppHarness();
const user = 'vault-autofill-audit';
app.seedUser(member(user, { name: 'Synthetic Autofill Member' }));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5249, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
const phrase = '  Synthetic 密碼 "exact" passphrase  ';
const wrong = 'Synthetic wrong saved password';
const setWithoutChange = (locator, value) => locator.evaluate((input, text) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
}, value);
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], outbound = [];
    let membership = false;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => outbound.push(request.url() + (request.postData() || '')));
    const origin = server.resolvedUrls.local[0];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(origin).origin || /\/api\/(?:feed\/stream|office\/events)/.test(url.pathname)) return route.abort();
      if (url.pathname === '/api/billing/status') return route.fulfill({ json: { plan: 'free', vpnConnectorAddon: membership,
        subscriptions: membership ? [{ kind: 'vpn_connector', status: 'active', currentPeriodEnd: Math.floor(Date.now() / 1000) + 3600 }] : [] } });
      if (url.pathname === '/api/billing/config') return route.fulfill({ json: { paymentsReady: true, tiers: { vpn_connector: true } } });
      if (url.pathname === '/api/security/vault/status') return route.fulfill({ json: { phase: 'software-prototype', state: 'disabled', available: false } });
      return route.continue();
    });
    await installAuditMember(page, app, user);
    await auditNavigate(page, origin + 'vault');
    const before = await page.evaluate(async ({ user, phrase }) => {
      const { createAccountVault } = await import('/src/vault/accountVault.mjs');
      const vault = createAccountVault(user);
      await vault.saveEntries(await vault.createVault(phrase), [{ id: 'synthetic', name: 'Preserved item', password: 'SYNTHETIC_PRIVATE_ITEM' }]);
      return vault.exportEncryptedVault();
    }, { user, phrase });
    await auditReload(page);
    const field = page.getByLabel('Vault passphrase', { exact: true });
    await field.fill(wrong);
    await setWithoutChange(field, phrase);
    // Submit without requiring blur/change (e.g. a password manager submitting
    // the filled form). The submit handler must read the current field value.
    await field.evaluate(input => input.form.requestSubmit());
    if (process.argv.includes('--reproduce')) {
      await page.getByRole('alert').getByText(/passphrase is incorrect/).waitFor();
      console.log(`REPRODUCED: autofilled correct passphrase rejected with stale React state at ${width}px`);
    } else {
      await page.getByRole('button', { name: 'Details for Preserved item', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
      // An incorrect current field must never use a correct stale state value.
      await field.fill(phrase);
      await setWithoutChange(field, wrong);
      await field.evaluate(input => input.form.requestSubmit());
      await page.getByRole('alert').getByText(/passphrase is incorrect/).waitFor();
      await field.fill('');
      await setWithoutChange(field, phrase);
      await field.press('Enter');
      await page.getByRole('button', { name: 'Details for Preserved item', exact: true }).waitFor();
      console.log(`PASS: current autofilled value, wrong-password rejection, Enter submit and exact Unicode/whitespace at ${width}px`);
    }
    const after = await page.evaluate(async user => (await import('/src/vault/accountVault.mjs')).createAccountVault(user).exportEncryptedVault(), user);
    assert.equal(after, before, 'Unlock attempts must not modify encrypted data');
    if (!process.argv.includes('--reproduce')) {
      membership = true;
      await page.evaluate(async user => {
        const { accountVaultStorageKey } = await import('/src/vault/accountVault.mjs');
        localStorage.removeItem(accountVaultStorageKey(user));
      }, user);
      await auditReload(page);
      await page.getByRole('button', { name: 'Create vault', exact: true }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Create vault' && !button.disabled));
      await setWithoutChange(field, phrase);
      const confirmation = page.getByLabel('Confirm passphrase', { exact: true });
      await setWithoutChange(confirmation, wrong);
      await field.evaluate(input => input.form.requestSubmit());
      await page.getByRole('alert').getByText('The passphrases do not match.', { exact: true }).waitFor();
      assert.equal(await page.evaluate(async user => (await import('/src/vault/accountVault.mjs')).createAccountVault(user).hasVault(), user), false);
      // The error render clears unchanged React state; refill both actual fields.
      await setWithoutChange(field, phrase);
      await setWithoutChange(confirmation, phrase);
      await field.evaluate(input => input.form.requestSubmit());
      await page.getByRole('button', { name: 'Lock vault', exact: true }).waitFor();
      const created = await page.evaluate(async ({ user, phrase }) => (await (await import('/src/vault/accountVault.mjs')).createAccountVault(user).unlockVault(phrase)).entries.length, { user, phrase });
      assert.equal(created, 0, 'Autofill creation uses the exact submitted passphrase');
      console.log(`PASS: autofilled creation and mismatched confirmation rejected at ${width}px`);
    }
    for (const secret of [phrase, wrong, 'SYNTHETIC_PRIVATE_ITEM']) assert.ok(outbound.every(request => !request.includes(secret)), 'Vault secrets never leave the browser');
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
