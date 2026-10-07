// Synthetic records only; all external requests are blocked.
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
const user = 'vault-recovery-audit';
app.seedUser(member(user, { name: 'Synthetic Recovery Member' }));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5243, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
const oldPhrase = 'Synthetic old forgotten phrase', backupPhrase = 'Synthetic known backup phrase', newPhrase = 'Synthetic recovery replacement phrase';
async function readDownload(download) {
  const stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], outbound = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => outbound.push(request.url() + (request.postData() || '')));
    const origin = server.resolvedUrls.local[0];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(origin).origin || /\/api\/(?:feed\/stream|office\/events)/.test(url.pathname)) return route.abort();
      if (url.pathname === '/api/billing/status') return route.fulfill({ json: { plan: 'free', vpnConnectorAddon: false, subscriptions: [] } });
      if (url.pathname === '/api/billing/config') return route.fulfill({ json: { paymentsReady: true, tiers: { vpn_connector: true } } });
      if (url.pathname === '/api/security/vault/status') return route.fulfill({ json: { phase: 'software-prototype', state: 'disabled', available: false } });
      return route.continue();
    });
    await page.addInitScript(() => {
      const result = () => ({ prf: { enabled: true, results: { first: new Uint8Array(32).fill(7).buffer } } });
      Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
        create: async () => ({ rawId: new Uint8Array([1, 2, 3]), getClientExtensionResults: result }),
        get: async () => { if (window.__rejectVaultDevice) throw new Error('Device verification cancelled.'); return { getClientExtensionResults: result }; },
      } });
    });
    await installAuditMember(page, app, user);
    await auditNavigate(page, origin + 'vault');
    const fixture = await page.evaluate(async ({ user, oldPhrase, backupPhrase }) => {
      const { createAccountVault } = await import('/src/vault/accountVault.mjs');
      const vault = createAccountVault(user);
      await vault.saveEntries(await vault.createVault(oldPhrase), [{ id: 'current', name: 'Current private item', password: 'CURRENT_PRIVATE_SECRET' }]);
      const other = createAccountVault('backup-fixture');
      await other.saveEntries(await other.createVault(backupPhrase), [{ id: 'backup', name: 'Backup private item', password: 'BACKUP_PRIVATE_SECRET' }]);
      return { current: vault.exportEncryptedVault(), backup: other.exportEncryptedVault() };
    }, { user, oldPhrase, backupPhrase });
    await auditReload(page);
    await page.getByRole('button', { name: 'Forgot vault password?', exact: true }).click();
    let recovery = page.getByRole('dialog', { name: 'Forgot vault password?', exact: true });
    assert.equal(await recovery.getByRole('button', { name: 'Recover with device unlock', exact: true }).isDisabled(), true);
    assert.equal(await recovery.getByRole('link', { name: 'Reset UFIConnect sign-in password' }).getAttribute('href'), '/forgot-password');
    await recovery.getByRole('button', { name: 'Restore a known backup', exact: true }).click();
    const restore = page.getByRole('dialog', { name: 'Restore encrypted backup', exact: true });
    await restore.getByLabel('Backup file', { exact: true }).setInputFiles({ name: 'synthetic-backup.json', mimeType: 'application/json', buffer: Buffer.from(fixture.backup) });
    await restore.getByLabel('Backup passphrase', { exact: true }).fill(oldPhrase);
    await restore.getByRole('checkbox').check();
    assert.equal(await restore.getByRole('button', { name: 'Restore backup', exact: true }).isDisabled(), true, 'Locked restore requires an encrypted preservation copy');
    const download = page.waitForEvent('download');
    await restore.getByRole('button', { name: 'Download current backup', exact: true }).click();
    assert.equal(await readDownload(await download), fixture.current, 'Locked ciphertext is preserved before replacing it');
    await restore.getByRole('button', { name: 'Restore backup', exact: true }).click();
    await restore.getByRole('alert').getByText(/backup passphrase is incorrect/).waitFor();
    const currentText = () => page.evaluate(async user => (await import('/src/vault/accountVault.mjs')).createAccountVault(user).exportEncryptedVault(), user);
    assert.equal(await currentText(), fixture.current);
    await restore.getByLabel('Backup passphrase', { exact: true }).fill(backupPhrase);
    await restore.getByRole('button', { name: 'Restore backup', exact: true }).click();
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).waitFor();
    assert.equal(await currentText(), fixture.backup);
    await page.getByLabel('Vault passphrase', { exact: true }).fill(backupPhrase);
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await page.getByRole('button', { name: 'Details for Backup private item', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
    await page.evaluate(async ({ user, current, oldPhrase }) => {
      const vault = (await import('/src/vault/accountVault.mjs')).createAccountVault(user);
      await vault.restoreEncryptedVault(current, oldPhrase); await vault.enableDeviceUnlock(oldPhrase);
    }, { user, current: fixture.current, oldPhrase });
    await auditReload(page);
    await page.getByRole('button', { name: 'Forgot vault password?', exact: true }).click();
    recovery = page.getByRole('dialog', { name: 'Forgot vault password?', exact: true });
    await page.evaluate(() => { window.__rejectVaultDevice = true; });
    await recovery.getByRole('button', { name: 'Recover with device unlock', exact: true }).click();
    await recovery.getByRole('alert').getByText('Device verification cancelled.', { exact: true }).waitFor();
    await page.evaluate(() => { window.__rejectVaultDevice = false; });
    await recovery.getByRole('button', { name: 'Recover with device unlock', exact: true }).click();
    const change = page.getByRole('dialog', { name: 'Change vault passphrase', exact: true });
    await change.getByLabel('New vault passphrase', { exact: true }).fill(newPhrase);
    await change.getByLabel('Confirm new vault passphrase', { exact: true }).fill(newPhrase + 'wrong');
    await change.getByRole('button', { name: 'Save new passphrase', exact: true }).click();
    await change.getByRole('alert').getByText('The new passphrases do not match.', { exact: true }).waitFor();
    await change.getByLabel('Confirm new vault passphrase', { exact: true }).fill(newPhrase);
    assert.ok(await change.evaluate(element => element.scrollWidth <= element.clientWidth + 2), 'Recovery dialog fits narrow screens');
    await change.getByRole('button', { name: 'Save new passphrase', exact: true }).click();
    await page.getByRole('button', { name: 'Details for Current private item', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Add password', exact: true }).isDisabled(), true, 'Recovery is available after membership expiry');
    await page.getByRole('button', { name: 'Set up device unlock', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
    await page.getByLabel('Vault passphrase', { exact: true }).fill(oldPhrase);
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await page.getByRole('alert').getByText(/passphrase is incorrect/).waitFor();
    await page.getByLabel('Vault passphrase', { exact: true }).fill(newPhrase);
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await page.getByRole('button', { name: 'Details for Current private item', exact: true }).waitFor();
    for (const secret of [oldPhrase, backupPhrase, newPhrase, 'CURRENT_PRIVATE_SECRET', 'BACKUP_PRIVATE_SECRET']) assert.ok(outbound.every(request => !request.includes(secret)), 'Recovery secrets never leave the browser');
    assert.deepEqual(errors, []);
    console.log(`PASS: Vault device recovery, locked backup preservation/restore, cancelled verification, expiry access and no secret uploads at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
