// Exercise device imports with synthetic files; all API calls stay in the local
// harness and no vault contents are uploaded to a service.
import assert from 'node:assert/strict';
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
    page.on('pageerror', failure => errors.push(failure.message));
    page.on('request', request => outbound.push(request.url() + (request.postData() || '')));
    const origin = server.resolvedUrls.local[0];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(origin).origin) return route.abort();
      if (/\/api\/(?:feed\/stream|office\/events)/.test(url.pathname)) return route.abort();
      if (url.pathname === '/api/security/vault/status') return route.fulfill({ json: { phase: 'software-prototype', state: 'disabled', available: false } });
      return route.continue();
    });
    await installAuditMember(page, app, 'vault-files-audit');
    await auditNavigate(page, origin + 'vault');
    await page.getByLabel('Vault passphrase', { exact: true }).fill(phrase);
    await page.getByLabel('Confirm passphrase', { exact: true }).fill(phrase);
    await page.getByRole('button', { name: 'Create vault', exact: true }).click();
    const collections = page.getByRole('group', { name: 'Vault Home collections', exact: true });
    await collections.waitFor();
    await page.locator('.vault-password-footer').getByRole('button', { name: 'Import from this device', exact: true }).click();
    let chooser = page.getByRole('dialog', { name: 'Import from this device', exact: true });
    await chooser.getByText('Your browser cannot bulk-transfer passwords', { exact: false }).waitFor();
    assert.equal(await chooser.getByRole('button', { name: 'Choose document', exact: true }).count(), 1);
    assert.equal(await chooser.getByRole('button', { name: 'Choose key file', exact: true }).count(), 1);
    await chooser.getByRole('button', { name: 'Add a password manually', exact: true }).click();
    await page.getByLabel('App or website name', { exact: true }).fill('Existing password account');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Save password', exact: true }).click();
    await page.getByRole('button', { name: 'Details for Existing password account', exact: true }).waitFor();
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
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Collections fit the viewport');
    for (const secret of secrets) assert.ok(outbound.every(value => !value.includes(secret)), 'No private item content or filename is sent to an API');
    assert.deepEqual(errors, []);
    console.log(`PASS: device picker, documents/keys, inert downloads, encrypted storage/backup, lock, restore, password compatibility, and upload bounds at ${width}px`);
    await context.close();
  }
} finally { await browser?.close(); await server.close(); await app.close(); }
