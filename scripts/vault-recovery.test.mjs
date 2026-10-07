import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountVault, accountVaultStorageKey } from '../web/src/vault/accountVault.mjs';

const oldPhrase = 'Synthetic old vault passphrase';
const newPhrase = 'Synthetic replacement vault passphrase';
function memory() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
async function fixture() {
  const storage = memory(), vault = createAccountVault('recovery-member', storage);
  const entries = [{ id: 'one', name: 'Recovery fixture', username: 'private-user', password: 'PRIVATE_PASSWORD', notes: 'PRIVATE_NOTE', favorite: true }];
  const initial = await vault.createVault(oldPhrase);
  const session = await vault.saveEntries({ ...initial, preferences: { favorites: ['copy'], commands: { copy: 9 } } }, entries);
  return { storage, vault, session };
}

test('authenticated passphrase replacement preserves stored content, rotates key, and leaves old backups recoverable', async () => {
  const { vault, session } = await fixture();
  const before = vault.exportEncryptedVault();
  const changed = await vault.changePassphrase({ ...session, entries: [] }, newPhrase);
  assert.equal(changed.key.extractable, false);
  assert.notEqual(changed.key, session.key);
  assert.deepEqual(changed.entries, session.entries, 'preserves verified stored entries, not caller edits');
  assert.deepEqual(changed.preferences, session.preferences);
  assert.deepEqual((await vault.unlockVault(newPhrase)).entries, session.entries);
  await assert.rejects(vault.unlockVault(oldPhrase), /incorrect|verified/);
  await assert.rejects(vault.saveEntries(session, []), /changed in another window/);
  const after = vault.exportEncryptedVault();
  for (const secret of [oldPhrase, newPhrase, 'PRIVATE_PASSWORD', 'private-user', 'PRIVATE_NOTE']) assert.ok(!after.includes(secret));
  const backup = createAccountVault('restore-member', memory());
  await backup.restoreEncryptedVault(before, oldPhrase);
  assert.deepEqual((await backup.unlockVault(oldPhrase)).entries, session.entries);
});

test('device unlock can recover a forgotten phrase and old device wrapping is revoked on rotation', async () => {
  const descriptors = ['navigator', 'isSecureContext', 'PublicKeyCredential'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const result = () => ({ prf: { enabled: true, results: { first: new Uint8Array(32).fill(7).buffer } } });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: {
    create: async () => ({ rawId: new Uint8Array([1, 2, 3]), getClientExtensionResults: result }),
    get: async options => { assert.equal(options.publicKey.userVerification, 'required'); return { getClientExtensionResults: result }; },
  } } });
  try {
    const { vault } = await fixture();
    await vault.enableDeviceUnlock(oldPhrase);
    const unlocked = await vault.unlockWithDevice();
    assert.equal(vault.hasDeviceUnlock(), true);
    await vault.changePassphrase(unlocked, newPhrase);
    assert.equal(vault.hasDeviceUnlock(), false);
    await assert.rejects(vault.unlockWithDevice(), /set up device unlock/);
    await vault.enableDeviceUnlock(newPhrase);
    assert.deepEqual((await vault.unlockWithDevice()).entries, unlocked.entries);
  } finally {
    for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});

test('missing, foreign, stale or aborted sessions cannot replace a vault', async () => {
  const { vault, session } = await fixture();
  const before = vault.exportEncryptedVault();
  await assert.rejects(vault.changePassphrase(null, newPhrase), /Unlock/);
  await assert.rejects(vault.changePassphrase(session, 'short'), /12/);
  const foreign = await createAccountVault('other-member', memory()).createVault(oldPhrase);
  await assert.rejects(vault.changePassphrase({ ...session, key: foreign.key }, newPhrase));
  await assert.rejects(vault.changePassphrase(session, newPhrase, { signal: AbortSignal.abort() }));
  assert.equal(vault.exportEncryptedVault(), before);
  await vault.saveEntries(session, []);
  await assert.rejects(vault.changePassphrase(session, newPhrase), /changed in another window/);
});

test('rotation refuses concurrent writes and storage failure leaves old phrase working', async () => {
  const { storage, vault, session } = await fixture();
  const original = storage.getItem(accountVaultStorageKey('recovery-member'));
  const get = storage.getItem;
  let reads = 0;
  storage.getItem = key => { reads++; return reads === 2 ? original + ' ' : get(key); };
  await assert.rejects(vault.changePassphrase(session, newPhrase), /changed in another window/);
  storage.getItem = get;
  assert.equal(storage.getItem(accountVaultStorageKey('recovery-member')), original);
  storage.setItem = () => { throw Object.assign(new Error('storage full'), { name: 'QuotaExceededError' }); };
  await assert.rejects(vault.changePassphrase(session, newPhrase), /previous vault is unchanged/);
  assert.deepEqual((await vault.unlockVault(oldPhrase)).entries, session.entries);
});

test('locking during passphrase replacement or backup verification cancels the storage write', async () => {
  const { vault, session } = await fixture();
  const before = vault.exportEncryptedVault();
  const changeController = new AbortController();
  const changing = vault.changePassphrase(session, newPhrase, { signal: changeController.signal });
  changeController.abort();
  await assert.rejects(changing, { name: 'AbortError' });
  assert.equal(vault.exportEncryptedVault(), before);
  const other = createAccountVault('other-backup', memory());
  await other.createVault(newPhrase);
  const restoreController = new AbortController();
  const restoring = vault.restoreEncryptedVault(other.exportEncryptedVault(), newPhrase, { signal: restoreController.signal });
  restoreController.abort();
  await assert.rejects(restoring, { name: 'AbortError' });
  assert.equal(vault.exportEncryptedVault(), before);
});
