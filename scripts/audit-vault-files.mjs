// Exercise device imports with synthetic files; all API calls stay in the local
// harness and no vault contents are uploaded to a service.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { installAuditMember, auditNavigate, auditReload } from './audit-session.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
app.seedUser(member('vault-files-audit', { name: 'Synthetic Vault Member' }));
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envDir: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') },
  server: { host: '127.0.0.1', port: 5229, strictPort: false, proxy: { '/api': { target: app.base, rewrite: value => value.replace(/^\/api/, '') } } } });
const phrase = 'Synthetic browser file vault passphrase';
const password = 'VAULT_PASSWORD_PRIVATE_BYTES';
const document = { name: 'sensitive-document.txt', mimeType: 'text/plain', buffer: Buffer.from('PRIVATE_DOCUMENT_BYTES') };
const key = { name: 'private-signing.key', mimeType: 'application/octet-stream', buffer: Buffer.from('PRIVATE_KEY_BYTES') };
const secrets = [phrase, password, document.name, key.name, document.buffer.toString(), key.buffer.toString(), document.buffer.toString('base64'), key.buffer.toString('base64')];
async function readDownload(download) {
  const stream = await download.createReadStream(); const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, isMobile: width < 600, hasTouch: width < 600, acceptDownloads: true });
    const page = await context.newPage(); page.setDefaultTimeout(12_000);
    const errors = [], outbound = [];
    let vaultPaid = false;
    let releaseCheckout;
    page.on('pageerror', failure => errors.push(failure.message));
    page.on('request', request => outbound.push(request.url() + (request.postData() || '')));
    const origin = server.resolvedUrls.local[0];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://checkout.stripe.com') return route.fulfill({ contentType: 'text/html', body: '<h1>Secure checkout fixture</h1>' });
      if (url.origin !== new URL(origin).origin) return route.abort();
      if (/\/api\/(?:feed\/stream|office\/events)/.test(url.pathname)) return route.abort();
      if (url.pathname === '/api/security/vault/status') return route.fulfill({ json: { phase: 'software-prototype', state: 'disabled', available: false } });
      if (url.pathname === '/api/billing/config') return route.fulfill({ json: { paymentsReady: true, tiers: { vpn_connector: true }, pricing: { vpn_connector: { active: true, unitAmount: 394, currency: 'USD', interval: 'month', intervalCount: 1 } } } });
      if (url.pathname === '/api/billing/create-checkout-session') {
        assert.deepEqual(route.request().postDataJSON(), { tier: 'vpn_connector' });
        await new Promise(resolve => { releaseCheckout = resolve; });
        return route.fulfill({ json: { url: 'https://checkout.stripe.com/vault-audit' } });
      }
      if (url.pathname === '/api/billing/status') return route.fulfill({ json: { plan: 'free', vpnConnectorAddon: vaultPaid, hasBillingAccount: vaultPaid, subscriptions: vaultPaid ? [{ kind: 'vpn_connector', status: 'active', currentPeriodEnd: Math.floor(Date.now() / 1000) + 3600 }] : [] } });
      return route.continue();
    });
    async function refreshEntitlement(paid) {
      vaultPaid = paid;
      await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === '/api/billing/status'),
        page.getByRole('button', { name: 'Check subscription status', exact: true }).click(),
      ]);
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Check subscription status' && !button.disabled));
    }
    await installAuditMember(page, app, 'vault-files-audit');
    await auditNavigate(page, origin + 'vault');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Check subscription status' && !button.disabled));
    assert.equal(await page.getByRole('button', { name: 'Create vault', exact: true }).isDisabled(), true, 'New unpaid accounts cannot create a paid vault');
    await page.getByRole('button', { name: 'Subscribe for $3.94 USD / month', exact: true }).click();
    while (!releaseCheckout) await new Promise(resolve => setTimeout(resolve, 20));
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/billing/status'),
      page.evaluate(() => window.dispatchEvent(new Event('focus'))),
    ]);
    releaseCheckout();
    await page.waitForURL('https://checkout.stripe.com/vault-audit');
    await auditNavigate(page, origin + 'vault');
    await page.getByRole('button', { name: 'Subscribe for $3.94 USD / month', exact: true }).waitFor();
    await refreshEntitlement(true);
    await page.getByLabel('Vault passphrase', { exact: true }).fill(phrase);
    await page.getByLabel('Confirm passphrase', { exact: true }).fill(phrase);
    await page.getByRole('button', { name: 'Create vault', exact: true }).click();
    const collections = page.getByRole('group', { name: 'Vault Home collections', exact: true });
    await collections.waitFor();
    await page.locator('.vault-password-footer').getByRole('button', { name: 'Import from this device', exact: true }).click();
    let chooser = page.getByRole('dialog', { name: 'Import from this device', exact: true });
    await chooser.getByText('Import a CSV or JSON password export on Android, Windows, Linux or iOS.', { exact: false }).waitFor();
    assert.equal(await chooser.getByRole('button', { name: 'Choose document', exact: true }).count(), 1);
    assert.equal(await chooser.getByRole('button', { name: 'Choose key file', exact: true }).count(), 1);
    await chooser.getByRole('button', { name: 'Add a password manually', exact: true }).click();
    await page.getByLabel('App or website name', { exact: true }).fill('Existing password account');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Save password', exact: true }).click();
    await page.getByRole('button', { name: 'Details for Existing password account', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Import passwords', exact: true }).click();
    const passwordChooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose password file', exact: true }).click();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await (await passwordChooser).setFiles({ name: 'password-export.csv', mimeType: 'text/csv', buffer: Buffer.from('Title,URL,Username,Password,Notes\nImported account,https://example.com,member,IMPORTED_PRIVATE_PASSWORD,Device import\nImported account,https://example.com,member,IMPORTED_PRIVATE_PASSWORD,Device import') });
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.getByLabel('Vault passphrase', { exact: true }).fill(phrase);
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await page.getByRole('dialog', { name: 'Review password import', exact: true }).getByText('1 new password ready to import.', { exact: true }).waitFor();
    await fs.mkdir(path.join(root, '.cache/audit-ui'), { recursive: true });
    await page.getByRole('dialog', { name: 'Review password import', exact: true }).screenshot({ path: path.join(root, `.cache/audit-ui/vault-password-import-${width}.png`) });
    await page.getByRole('button', { name: 'Import passwords now', exact: true }).click();
    await page.getByRole('button', { name: 'Export passwords', exact: true }).click();
    const passwordDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download password CSV', exact: true }).click();
    assert.ok((await readDownload(await passwordDownload)).toString().includes('IMPORTED_PRIVATE_PASSWORD'), 'Export preserves imported passwords');
    await page.getByRole('button', { name: 'Details for Imported account', exact: true }).click();
    assert.equal(await page.getByRole('dialog').getByLabel('Password', { exact: true }).inputValue(), 'IMPORTED_PRIVATE_PASSWORD');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Details for Imported account', exact: true }).waitFor({ state: 'detached' });
    for (const [kind, file] of [['document', document], ['key', key]]) {
      await page.locator('.vault-password-footer').getByRole('button', { name: 'Import from this device', exact: true }).click();
      chooser = page.getByRole('dialog', { name: 'Import from this device', exact: true });
      const pendingPicker = page.waitForEvent('filechooser');
      await chooser.getByRole('button', { name: kind === 'document' ? 'Choose document' : 'Choose key file', exact: true }).click();
      const picker = await pendingPicker;
      await picker.setFiles(file);
      await page.getByRole('button', { name: `Download ${file.name}`, exact: true }).waitFor();
      const pendingDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: `Download ${file.name}`, exact: true }).click();
      const download = await pendingDownload;
      assert.equal(download.suggestedFilename(), file.name);
      assert.deepEqual(await readDownload(download), file.buffer, `${kind} bytes survive import, encryption, and user-initiated download`);
      assert.equal(await page.locator('.vault-file-entry iframe,.vault-file-entry object,.vault-file-entry embed,.vault-file-entry a[target]').count(), 0, 'Vault files never preview or execute in the page');
    }
    const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    for (const secret of secrets) assert.ok(!stored.includes(secret), 'Private file content and metadata are absent from persistent plaintext');
    const pendingBackup = page.waitForEvent('download');
    await page.locator('.vault-password-footer').getByRole('button', { name: 'Encrypted backup', exact: true }).click();
    const backup = await readDownload(await pendingBackup);
    for (const secret of secrets) assert.ok(!backup.toString().includes(secret), 'Backup contains only encrypted item data');
    await refreshEntitlement(false);
    assert.equal(await page.getByRole('button', { name: 'Import key', exact: true }).isDisabled(), true, 'Expired members cannot import new keys');
    assert.equal(await page.locator('.vault-password-footer').getByRole('button', { name: 'Import from this device', exact: true }).isDisabled(), true);
    const expiredDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: `Download ${key.name}`, exact: true }).click();
    assert.deepEqual(await readDownload(await expiredDownload), key.buffer, 'Subscription expiry never blocks downloading an existing key');
    await collections.getByRole('button', { name: /^Passwords/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Add password', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Details for Existing password account', exact: true }).click();
    const passwordDialog = page.getByRole('dialog', { name: 'Password details', exact: true });
    await passwordDialog.getByRole('button', { name: 'Reveal password', exact: true }).click();
    assert.equal(await passwordDialog.getByLabel('Password', { exact: true }).inputValue(), password, 'Existing password remains readable after expiry');
    assert.equal(await passwordDialog.getByRole('button', { name: 'Save password', exact: true }).isDisabled(), true, 'Expired membership blocks editing existing passwords');
    await passwordDialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const expiredBackup = page.waitForEvent('download');
    await page.locator('.vault-password-footer').getByRole('button', { name: 'Encrypted backup', exact: true }).click();
    assert.ok((await readDownload(await expiredBackup)).length > 0, 'Owner backup is always available');
    await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).waitFor();
    assert.equal(await page.locator('.vault-file-entry').count(), 0);
    for (const name of [document.name, key.name, 'Existing password account']) assert.ok(!(await page.locator('body').innerText()).includes(name), 'Lock hides private item names');
    await auditReload(page);
    await page.getByLabel('Vault passphrase', { exact: true }).fill(phrase);
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await page.getByRole('button', { name: 'Details for Existing password account', exact: true }).waitFor();
    await collections.getByRole('button', { name: /^Keys/ }).click();
    await page.getByRole('button', { name: `Download ${key.name}`, exact: true }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: `Delete ${key.name}`, exact: true }).click();
    await page.getByRole('button', { name: `Download ${key.name}`, exact: true }).waitFor({ state: 'hidden' });
    await page.locator('.vault-password-footer').getByRole('button', { name: 'Restore', exact: true }).click();
    const restore = page.getByRole('dialog', { name: 'Restore encrypted backup', exact: true });
    await restore.getByLabel('Backup file', { exact: true }).setInputFiles({ name: 'encrypted-backup.json', mimeType: 'application/json', buffer: backup });
    await restore.getByLabel('Backup passphrase', { exact: true }).fill(phrase);
    await restore.getByRole('checkbox').check();
    await restore.getByRole('button', { name: 'Restore backup', exact: true }).click();
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).waitFor();
    await page.getByLabel('Vault passphrase', { exact: true }).fill(phrase);
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await page.getByRole('button', { name: 'Details for Existing password account', exact: true }).waitFor();
    for (const [label, file] of [['Documents', document], ['Keys', key]]) {
      await collections.getByRole('button', { name: new RegExp(`^${label}`) }).click();
      await page.getByRole('button', { name: `Download ${file.name}`, exact: true }).waitFor();
    }
    assert.equal(vaultPaid, false, 'Owner unlock, delete, and authenticated restore were checked without an active subscription');
    await refreshEntitlement(true);
    await page.getByLabel('Key from this device', { exact: true }).setInputFiles({ name: 'too-large.key', mimeType: 'application/octet-stream', buffer: Buffer.alloc(512 * 1024 + 1) });
    await page.getByRole('alert').getByText('Choose a nonempty document or key up to 512 KB.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Download too-large.key', exact: true }).count(), 0);
    const beforeDelayedImport = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    await page.evaluate(() => {
      window.__originalVaultFileRead = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () {
        return new Promise(resolve => { window.__releaseVaultFileRead = async () => resolve(await window.__originalVaultFileRead.call(this)); });
      };
    });
    await page.getByLabel('Key from this device', { exact: true }).setInputFiles({ name: 'late-secret.key', mimeType: 'application/octet-stream', buffer: Buffer.from('DELAYED_PRIVATE_BYTES') });
    await page.waitForFunction(() => typeof window.__releaseVaultFileRead === 'function');
    await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).waitFor();
    await page.evaluate(async () => {
      await window.__releaseVaultFileRead();
      File.prototype.arrayBuffer = window.__originalVaultFileRead;
      delete window.__originalVaultFileRead; delete window.__releaseVaultFileRead;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage })), beforeDelayedImport, 'An import finishing after lock never writes to the vault');
    assert.equal(await page.getByRole('group', { name: 'Vault Home collections', exact: true }).count(), 0, 'Late import cannot restore an unlocked session');
    await page.getByLabel('Vault passphrase', { exact: true }).fill(phrase);
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await collections.getByRole('button', { name: /^Keys/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Download late-secret.key', exact: true }).count(), 0);
    const beforeExpiredImport = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    await page.evaluate(() => {
      window.__originalVaultFileRead = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () {
        return new Promise(resolve => { window.__releaseVaultFileRead = async () => resolve(await window.__originalVaultFileRead.call(this)); });
      };
    });
    await page.getByLabel('Key from this device', { exact: true }).setInputFiles({ name: 'expired-import.key', mimeType: 'application/octet-stream', buffer: Buffer.from('EXPIRED_IMPORT_PRIVATE_BYTES') });
    await page.waitForFunction(() => typeof window.__releaseVaultFileRead === 'function');
    await refreshEntitlement(false);
    await page.evaluate(async () => {
      await window.__releaseVaultFileRead();
      File.prototype.arrayBuffer = window.__originalVaultFileRead;
      delete window.__originalVaultFileRead; delete window.__releaseVaultFileRead;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage })), beforeExpiredImport, 'A file read finishing after subscription expiry cannot write the vault');
    assert.equal(await page.getByRole('button', { name: 'Download expired-import.key', exact: true }).count(), 0);
    await collections.getByRole('button', { name: /^Passwords/ }).click();
    await page.getByRole('group', { name: 'Password tools', exact: true }).screenshot({ path: path.join(root, `.cache/audit-ui/vault-password-tools-${width}.png`) });
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Delete all passwords', exact: true }).click();
    await page.getByRole('button', { name: 'Details for Existing password account', exact: true }).waitFor({ state: 'detached' });
    await collections.getByRole('button', { name: /^Documents/ }).click();
    assert.ok(await page.getByRole('button', { name: `Download ${document.name}`, exact: true }).isVisible(), 'Deleting passwords keeps documents');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Collections fit the viewport');
    for (const secret of [...secrets, 'IMPORTED_PRIVATE_PASSWORD', 'password-export.csv']) assert.ok(outbound.every(value => !value.includes(secret)), 'No private item content or filename is sent to an API');
    assert.deepEqual(errors, []);
    console.log(`PASS: device imports, encrypted storage/backup, locking, bounds, paid writes, expired owner recovery/access, and delayed expiry guard at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
