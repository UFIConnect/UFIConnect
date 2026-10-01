import test from 'node:test';
import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { importVaultFile, cleanVaultFile, vaultFileBytes, MAX_VAULT_FILE_BYTES } from '../web/src/vault/vaultFiles.mjs';
import { createAccountVault } from '../web/src/vault/accountVault.mjs';
import { VAULT_STORAGE_KEY, createVault, saveEntries, unlockVault, exportEncryptedVault, restoreEncryptedVault } from '../web/src/vault/localVault.mjs';

const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const phrase = 'Synthetic document vault passphrase';
const password = { id: 'legacy', name: 'Legacy account', username: 'alice', password: 'LEGACY_PASSWORD_SECRET' };
const documentBytes = new TextEncoder().encode('SYNTHETIC_PRIVATE_DOCUMENT_PAYLOAD');
const keyBytes = new TextEncoder().encode('-----BEGIN PRIVATE KEY-----\nSYNTHETIC_PRIVATE_KEY\n-----END PRIVATE KEY-----');

test('documents, keys, and legacy passwords round-trip in one encrypted account vault and backup', async () => {
  const storage = memory(), alice = createAccountVault('alice', storage), bob = createAccountVault('bob', storage);
  let session = await alice.createVault(phrase);
  session = await alice.saveEntries(session, [password]);
  const normalizedPassword = session.entries[0];
  const document = await importVaultFile(new File([documentBytes], 'sensitive-record.txt'), 'document');
  const key = await importVaultFile(new File([keyBytes], 'private-signing.key'), 'key');
  session = await alice.saveEntries(session, [...session.entries, document, key]);
  const encrypted = alice.exportEncryptedVault();
  for (const secret of [document.fileName, key.fileName, document.data, key.data, password.password, 'SYNTHETIC_PRIVATE_DOCUMENT_PAYLOAD']) {
    assert.ok(!encrypted.includes(secret), 'Neither content nor sensitive metadata is persisted in plaintext');
  }
  assert.equal(bob.hasVault(), false);
  const unlocked = await alice.unlockVault(phrase);
  assert.deepEqual(unlocked.entries[0], normalizedPassword, 'Legacy password fields and launch preferences remain intact');
  assert.deepEqual(vaultFileBytes(unlocked.entries.find(entry => entry.kind === 'document')), documentBytes);
  assert.deepEqual(vaultFileBytes(unlocked.entries.find(entry => entry.kind === 'key')), keyBytes);
  await bob.restoreEncryptedVault(encrypted, phrase);
  assert.deepEqual((await bob.unlockVault(phrase)).entries, unlocked.entries, 'Verified encrypted backup restores every collection');
  const withoutDocument = await alice.saveEntries(unlocked, unlocked.entries.filter(entry => entry.id !== document.id));
  assert.deepEqual(withoutDocument.entries.map(entry => entry.id), ['legacy', key.id]);
  assert.deepEqual((await bob.unlockVault(phrase)).entries, unlocked.entries, 'Deleting in one account does not modify another');
});

test('file size, total vault size, malformed bytes, and unsupported item types fail without overwriting storage', async () => {
  let read = false;
  await assert.rejects(importVaultFile({ size: MAX_VAULT_FILE_BYTES + 1, name: 'oversize.bin', arrayBuffer: () => { read = true; } }, 'document'), /512 KB/);
  assert.equal(read, false, 'Oversized input is rejected before reading its bytes');
  await assert.rejects(importVaultFile(new File([], 'empty.key'), 'key'), /nonempty/);
  const full = await importVaultFile(new File([new Uint8Array(MAX_VAULT_FILE_BYTES).fill(71)], 'maximum.bin'), 'document');
  assert.equal(vaultFileBytes(full).length, MAX_VAULT_FILE_BYTES, 'The exact per-file boundary is supported');
  assert.throws(() => cleanVaultFile({ ...full, size: full.size - 1 }), /does not match/);
  assert.throws(() => cleanVaultFile({ ...full, data: '%%%=' }), /contents are invalid/);
  const storage = memory();
  const session = await createVault(phrase, storage), before = exportEncryptedVault(storage);
  await assert.rejects(saveEntries(session, [full, { ...full, id: 'two' }, { ...full, id: 'three' }], storage), /limited to 2 MB/);
  assert.equal(exportEncryptedVault(storage), before);
  await assert.rejects(saveEntries(session, [{ ...password, kind: 'executable' }], storage), /type is not supported/);
  assert.equal(exportEncryptedVault(storage), before);
});

test('file-bearing ciphertext is authenticated and browser quota failures leave the previous vault intact', async () => {
  const storage = memory();
  let session = await createVault(phrase, storage);
  session = await saveEntries(session, [password], storage);
  const before = exportEncryptedVault(storage);
  const key = await importVaultFile(new File([keyBytes], '../nested/private.key'), 'key');
  assert.equal(key.fileName, 'private.key', 'Downloads cannot carry a filesystem path');
  const quotaStorage = { getItem: storage.getItem, setItem() { throw new DOMException('Full', 'QuotaExceededError'); } };
  await assert.rejects(saveEntries(session, [...session.entries, key], quotaStorage), /Browser storage is full.*previous vault is unchanged/);
  assert.equal(exportEncryptedVault(storage), before);
  await saveEntries(session, [...session.entries, key], storage);
  const record = JSON.parse(exportEncryptedVault(storage));
  record.content.data = (record.content.data[0] === 'A' ? 'B' : 'A') + record.content.data.slice(1);
  const destination = memory(); await createVault(phrase, destination);
  const destinationBefore = exportEncryptedVault(destination);
  await assert.rejects(restoreEncryptedVault(JSON.stringify(record), phrase, destination), /could not be verified/);
  assert.equal(exportEncryptedVault(destination), destinationBefore);
  storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(record));
  await assert.rejects(unlockVault(phrase, storage), /could not be verified/);
});
