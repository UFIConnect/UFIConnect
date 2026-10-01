import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountVault, accountVaultStorageKey } from '../web/src/vault/accountVault.mjs';
import { createVault, VAULT_STORAGE_KEY } from '../web/src/vault/localVault.mjs';

test('a blocked localStorage getter does not crash account Vault construction or device availability', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let reads = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { reads++; throw Error('Blocked storage'); } });
  try {
    const account = createAccountVault('storage-blocked-member');
    assert.equal(reads, 0, 'Constructing the locked page does not access browser storage');
    assert.equal(account.hasDeviceUnlock(), false);
    assert.throws(() => account.hasVault(), /Browser storage is unavailable/);
    await assert.rejects(account.createVault('Synthetic storage blocked passphrase'), /Browser storage is unavailable/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('accounts on the same browser keep independent encrypted records and passphrases', async () => {
  const entries = new Map();
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  await createVault('Legacy preview passphrase', storage);
  const legacy = entries.get(VAULT_STORAGE_KEY);
  const alice = createAccountVault('alice', storage), bob = createAccountVault('bob', storage);
  assert.equal(alice.hasVault(), false);
  assert.equal(bob.hasVault(), false);
  const a = await alice.createVault('Alice private passphrase');
  await alice.saveEntries(a, [{ name: 'Alice only', password: 'secret-a' }]);
  assert.equal(bob.hasVault(), false);
  assert.equal(bob.hasDeviceUnlock(), false);
  const b = await bob.createVault('Bob private passphrase');
  await bob.saveEntries(b, [{ name: 'Bob only', password: 'secret-b' }]);
  await assert.rejects(bob.unlockVault('Alice private passphrase'));
  assert.equal((await alice.unlockVault('Alice private passphrase')).entries[0].name, 'Alice only');
  assert.equal((await bob.unlockVault('Bob private passphrase')).entries[0].name, 'Bob only');
  assert.notEqual(entries.get(accountVaultStorageKey('alice')), entries.get(accountVaultStorageKey('bob')));
  assert.equal(entries.get(VAULT_STORAGE_KEY), legacy, 'legacy data is never silently assigned to an account');
  assert.throws(() => createAccountVault('', storage));
});
