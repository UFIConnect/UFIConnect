import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccountVault, accountVaultStorageKey } from '../web/src/vault/accountVault.mjs';
import { createSyncedAccountVault } from '../web/src/vault/syncedAccountVault.mjs';
import { createVaultTransport } from '../web/src/vault/vaultTransport.mjs';
import { portableVaultRecord } from '../web/src/vault/localVault.mjs';
const phrase = '  Synthetic café 密碼 exact passphrase  ';
const memory = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key), clear: () => values.clear() }; };
function server(accountId = 'alice') {
  let saved = { accountId, revision: 0, record: null };
  const requests = [];
  return { requests, snapshot: () => structuredClone(saved),
    async get() { return structuredClone(saved); },
    async put(body) {
      requests.push(body);
      if (saved.revision !== body.revision) throw Object.assign(new Error('conflict'), { response: { status: 409 } });
      saved = { accountId, revision: saved.revision + 1, record: structuredClone(body.record) };
      return structuredClone(saved);
    },
  };
}
test('cache loss and a fresh device reload the same encrypted account vault without transmitting secrets', async () => {
  const api = server(), disk = memory();
  const vault = createSyncedAccountVault('alice', api, disk);
  await vault.initialize();
  const session = await vault.createVault(phrase);
  await vault.saveEntries(session, [{ id: 'private', name: 'Synthetic', password: 'DO_NOT_UPLOAD_PLAINTEXT' }]);
  const ciphertext = api.snapshot().record;
  disk.clear();
  const recovered = createSyncedAccountVault('alice', api, disk);
  const firstHydration = recovered.initialize();
  assert.equal(recovered.initialize(), firstHydration, 'Replayed mounts subscribe to the same pending hydration');
  await firstHydration;
  assert.equal(recovered.hasVault(), true);
  assert.equal((await recovered.unlockVault(phrase)).entries[0].password, 'DO_NOT_UPLOAD_PLAINTEXT');
  const phone = createSyncedAccountVault('alice', api, memory());
  await phone.initialize();
  assert.equal((await phone.unlockVault(phrase)).entries.length, 1);
  assert.deepEqual(api.snapshot().record, ciphertext);
  for (const secret of [phrase, 'DO_NOT_UPLOAD_PLAINTEXT']) assert.ok(!JSON.stringify(api.requests).includes(secret));
});
test('existing local vault is migrated only after successful verification; wrong passwords leave both stores unchanged', async () => {
  const api = server(), disk = memory(), local = createAccountVault('alice', disk);
  await local.createVault(phrase);
  const before = local.exportEncryptedVault();
  const synced = createSyncedAccountVault('alice', api, disk);
  await synced.initialize();
  assert.equal(synced.syncState(), 'local');
  await assert.rejects(synced.unlockVault('incorrect phrase'), /passphrase is incorrect/);
  assert.equal(api.requests.length, 0);
  assert.equal(local.exportEncryptedVault(), before);
  await synced.unlockVault(phrase);
  assert.equal(synced.syncState(), 'saved');
  assert.deepEqual(api.snapshot().record, portableVaultRecord(before));
});
test('stale sessions cannot overwrite another device and untracked conflicts preserve both copies', async () => {
  const api = server();
  const first = createSyncedAccountVault('alice', api, memory());
  const session = await first.createVault(phrase);
  const secondDisk = memory(), second = createSyncedAccountVault('alice', api, secondDisk);
  const stale = await second.unlockVault(phrase);
  await first.saveEntries(session, [{ id: 'new', name: 'New device entry' }]);
  await assert.rejects(second.saveEntries(stale, [{ id: 'old', name: 'Stale overwrite' }]), /changed in another window/);
  assert.equal((await second.unlockVault(phrase)).entries[0].id, 'new');
  const divergentDisk = memory(), old = createAccountVault('alice', divergentDisk);
  await old.createVault('different vault passphrase');
  const copy = old.exportEncryptedVault(), remote = api.snapshot();
  const divergent = createSyncedAccountVault('alice', api, divergentDisk);
  await assert.rejects(divergent.initialize(), /different vault copies/);
  assert.equal(old.exportEncryptedVault(), copy);
  assert.deepEqual(api.snapshot(), remote);
  await assert.rejects(divergent.useAccountCopy('wrong copy'), /different vault copies/);
  await divergent.useAccountCopy(copy);
  assert.equal((await divergent.unlockVault(phrase)).entries[0].id, 'new');
});
test('offline and rejected writes preserve the device copy and never report successful saves', async () => {
  const api = server(), disk = memory(), synced = createSyncedAccountVault('alice', api, disk);
  const session = await synced.createVault(phrase), before = synced.exportEncryptedVault();
  const put = api.put;
  api.put = async () => { throw new Error('network unavailable'); };
  await assert.rejects(synced.saveEntries(session, [{ id: 'pending', name: 'Pending edit' }]), /save was not confirmed/);
  assert.equal(synced.exportEncryptedVault(), before);
  assert.ok(disk.getItem(`${accountVaultStorageKey('alice')}.pending`));
  assert.ok(disk.getItem(`${accountVaultStorageKey('alice')}.pending`).length < 200, 'The journal does not duplicate the encrypted vault');
  api.put = put;
  await synced.saveEntries(session, [{ id: 'pending', name: 'Pending edit' }]);
  assert.equal(disk.getItem(`${accountVaultStorageKey('alice')}.pending`), null);
  const offline = createSyncedAccountVault('alice', { get: async () => { throw new Error('offline'); } }, memory());
  await assert.rejects(offline.createVault(phrase), /could not be reached/);
  assert.equal(offline.hasVault(), false);
  const offlineExisting = createSyncedAccountVault('alice', { get: async () => { throw new Error('offline'); } }, disk);
  assert.equal((await offlineExisting.unlockVault(phrase)).entries[0].id, 'pending', 'Offline reads still work');
  assert.equal(offlineExisting.syncState(), 'unavailable');
});
test('a lost save response reconciles from the account copy, including a changed passphrase', async () => {
  const api = server(), disk = memory(), synced = createSyncedAccountVault('alice', api, disk);
  const session = await synced.createVault(phrase);
  const put = api.put;
  api.put = async body => { await put(body); throw new Error('response lost'); };
  await assert.rejects(synced.changePassphrase(session, 'new synthetic passphrase'), /save was not confirmed/);
  api.put = put;
  const reopened = createSyncedAccountVault('alice', api, disk);
  await reopened.initialize();
  await assert.rejects(reopened.unlockVault(phrase), /passphrase is incorrect/);
  await reopened.unlockVault('new synthetic passphrase');
});
test('storage failure before upload, account mismatch, and account session changes cannot save another account data', async () => {
  const api = server(), disk = memory();
  disk.setItem = () => { throw new Error('disk full'); };
  const synced = createSyncedAccountVault('alice', api, disk);
  await assert.rejects(synced.createVault(phrase), /disk full/);
  assert.equal(api.requests.length, 0);
  await assert.rejects(createSyncedAccountVault('bob', api, memory()).initialize(), /could not be reached/);
  let token = 'first-account', calls = 0;
  const transport = createVaultTransport({ put: async (_url, _body, config) => { calls++; assert.equal(config.headers.Authorization, 'Bearer first-account'); return { data: {} }; } }, () => token);
  await transport.put({});
  token = 'second-account';
  await assert.rejects(transport.put({}), /account session changed/);
  assert.equal(calls, 1);
});
test('restoring a verified backup updates the account and remains decryptable after local storage loss', async () => {
  const api = server(), disk = memory(), synced = createSyncedAccountVault('alice', api, disk);
  await synced.createVault(phrase);
  const backup = createAccountVault('fixture', memory());
  await backup.saveEntries(await backup.createVault('backup fixture passphrase'), [{ id: 'restore', name: 'Restored entry' }]);
  const before = api.snapshot();
  await assert.rejects(synced.restoreEncryptedVault(backup.exportEncryptedVault(), 'wrong passphrase'), /backup passphrase/);
  assert.deepEqual(api.snapshot(), before);
  await synced.restoreEncryptedVault(backup.exportEncryptedVault(), 'backup fixture passphrase');
  disk.clear();
  const reopened = createSyncedAccountVault('alice', api, disk);
  assert.equal((await reopened.unlockVault('backup fixture passphrase')).entries[0].id, 'restore');
});

test('a backup restore cannot replace a newly discovered account copy before preservation and confirmation', async () => {
  const api = server(), disk = memory();
  const stale = createSyncedAccountVault('alice', api, disk);
  await stale.initialize();
  const other = createSyncedAccountVault('alice', api, memory());
  await other.createVault(phrase);
  const backup = createAccountVault('backup', memory());
  await backup.createVault('synthetic backup passphrase');
  const before = api.snapshot();
  await assert.rejects(stale.restoreEncryptedVault(backup.exportEncryptedVault(), 'synthetic backup passphrase'), /changed before restore/);
  assert.deepEqual(api.snapshot(), before);
});
