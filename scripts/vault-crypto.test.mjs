import test from 'node:test';
import assert from 'node:assert/strict';
import { configureNativeRuntime } from '../web/src/nativeRuntime.mjs';
import { exportPasswordCsv } from '../web/src/vault/localVault.mjs';
import { createVault, unlockVault, saveEntries, hasVault, parsePasswordImport, exportEncryptedVault, restoreEncryptedVault,
  enableDeviceUnlock, unlockWithDevice, hasDeviceUnlock, VAULT_STORAGE_KEY } from '../web/src/vault/localVault.mjs';

const memory = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
const phrase = 'Local review long passphrase';
const entry = { id: 'one', name: 'Private service', url: 'https://private.example/', username: 'private-user', password: 'private-password-42', notes: 'private-note', appUrl: 'https://private.example/app', favorite: true, launchCount: 3 };

test('native vault retains passphrase recovery and never invokes browser WebAuthn', async () => {
  const descriptors = Object.fromEntries(['navigator', 'isSecureContext', 'PublicKeyCredential'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let credentialCalls = 0, storageReads = 0;
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: {
    create: async () => { credentialCalls++; }, get: async () => { credentialCalls++; },
  } } });
  configureNativeRuntime({ nativePlatform: 'ios', onApiRequest: async () => { throw new Error('Vault data must stay local'); } });
  try {
    const inaccessible = { getItem() { storageReads++; throw new Error('Must not read device credentials'); } };
    assert.equal(hasDeviceUnlock(inaccessible), false);
    await assert.rejects(enableDeviceUnlock(phrase, inaccessible), /passphrase.*unavailable/);
    await assert.rejects(unlockWithDevice(inaccessible), /passphrase.*unavailable/);
    assert.equal(credentialCalls, 0); assert.equal(storageReads, 0);
    const storage = memory(); const session = await createVault(phrase, storage);
    await saveEntries(session, [entry], storage);
    const restored = memory(); await restoreEncryptedVault(exportEncryptedVault(storage), phrase, restored);
    assert.deepEqual((await unlockVault(phrase, restored)).entries, [entry]);
  } finally {
    configureNativeRuntime(null);
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
});

test('vault persists authenticated ciphertext only, locks key export, and round-trips entries and backups', async () => {
  const storage = memory();
  assert.equal(hasVault(storage), false);
  const session = await createVault(phrase, storage);
  assert.equal(session.key.extractable, false);
  const saved = await saveEntries(session, [entry], storage);
  const text = exportEncryptedVault(storage);
  for (const value of Object.values(entry).filter(value => value.length > 8)) assert.ok(!text.includes(value), 'No plaintext entry fields in storage');
  assert.deepEqual((await unlockVault(phrase, storage)).entries, [entry]);
  assert.notEqual(session.revision, saved.revision);
  await assert.rejects(saveEntries(session, [], storage), /changed in another window/);
  await assert.rejects(unlockVault('wrong password', storage), /incorrect|verified/);
  const restored = memory(); await restoreEncryptedVault(text, phrase, restored);
  assert.deepEqual((await unlockVault(phrase, restored)).entries, [entry]);
  const extraMetadata = { ...JSON.parse(text), privateNote: 'plaintext metadata must not persist' };
  await restoreEncryptedVault(JSON.stringify(extraMetadata), phrase, restored);
  assert.ok(!exportEncryptedVault(restored).includes('privateNote'));
  await assert.rejects(createVault(phrase, storage), /already exists/);
});

test('ciphertext corruption and manipulated KDF cannot unlock', async () => {
  const storage = memory(); await createVault(phrase, storage);
  const record = JSON.parse(storage.getItem(VAULT_STORAGE_KEY));
  record.content.data = (record.content.data.startsWith('A') ? 'B' : 'A') + record.content.data.slice(1);
  storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(record));
  const corrupted = storage.getItem(VAULT_STORAGE_KEY);
  await assert.rejects(unlockVault(phrase, storage), /passphrase was accepted.*contents could not be opened/);
  assert.equal(storage.getItem(VAULT_STORAGE_KEY), corrupted, 'Failed reads preserve the original ciphertext');
  await assert.rejects(unlockVault('wrong passphrase', storage), /passphrase is incorrect/);
  record.kdf.iterations = 1; storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(record));
  await assert.rejects(unlockVault(phrase, storage), /not a supported/);
  await assert.rejects(createVault('short', memory()), /12/);
});

test('unavailable device encryption is not reported as an incorrect passphrase', async t => {
  const storage = memory(); await createVault(phrase, storage);
  const before = storage.getItem(VAULT_STORAGE_KEY);
  t.mock.method(crypto.subtle, 'deriveKey', async () => { throw new Error('Internal platform detail'); });
  await assert.rejects(unlockVault(phrase, storage), error => {
    assert.match(error.message, /encryption could not start/);
    assert.doesNotMatch(error.message, /incorrect|Internal platform detail/);
    return true;
  });
  assert.equal(storage.getItem(VAULT_STORAGE_KEY), before);
  t.mock.restoreAll();
  assert.deepEqual((await unlockVault(phrase, storage)).entries, []);
});

test('unsupported device decryption preserves the vault and allows a later retry', async t => {
  const storage = memory(); await createVault(phrase, storage);
  const before = storage.getItem(VAULT_STORAGE_KEY);
  t.mock.method(crypto.subtle, 'decrypt', async () => { throw new DOMException('Internal platform detail', 'NotSupportedError'); });
  await assert.rejects(unlockVault(phrase, storage), /device could not run vault decryption/);
  assert.equal(storage.getItem(VAULT_STORAGE_KEY), before);
  t.mock.restoreAll();
  assert.deepEqual((await unlockVault(phrase, storage)).entries, []);
});

test('concurrent creation cannot replace the first newly created vault', async () => {
  const storage = memory();
  const results = await Promise.allSettled([createVault(phrase, storage), createVault(phrase, storage)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.deepEqual((await unlockVault(phrase, storage)).entries, []);
});

test('CSV imports quoted commas, escaped quotes and multiline passwords without executing content', () => {
  const entries = parsePasswordImport('name,url,username,password,notes\r\n"Demo, app",https://example.com,user,"p""ass\nword","<script>ignored</script>"', 'passwords.csv');
  assert.equal(entries[0].name, 'Demo, app');
  assert.equal(entries[0].password, 'p"ass\nword');
  assert.equal(entries[0].notes, '<script>ignored</script>');
  assert.throws(() => parsePasswordImport('name,username\nApp,user'), /password column/);
  assert.throws(() => parsePasswordImport('name,password\nApp,"bad'), /closing quote/);
  assert.throws(() => parsePasswordImport('a'.repeat(2 * 1024 * 1024 + 1)), /smaller/);
});

test('common JSON and CSV exports import only login entries and reject unsafe URLs', async () => {
  const entries = parsePasswordImport(JSON.stringify({ items: [{ type: 1, name: 'App', login: { username: 'a', password: 'b', uris: [{ uri: 'https://example.com' }] } }, { type: 2, name: 'Secure note' }] }), 'bitwarden.json');
  assert.equal(entries.length, 1); assert.equal(entries[0].password, 'b');
  assert.equal(parsePasswordImport('name,login_uri,login_username,login_password\nApp,example.com,u,p')[0].url, 'https://example.com/');
  assert.throws(() => parsePasswordImport(JSON.stringify([{ name: 'App', url: 'https://user:secret@example.com' }]), 'export.json'), /valid website/);
  assert.throws(() => parsePasswordImport('null', 'export.json'), /No password/);
  await assert.rejects(restoreEncryptedVault('{"entries":[]}', phrase, memory()), /not a supported/);
});

test('password exports from Android, Windows, Linux and iOS retain exact credentials', () => {
  const fixtures = [
    ['android.csv', 'name,url,username,password,note\nAndroid app,android://hash@org.example.app,user,secret,Mobile login'],
    ['windows.csv', 'name,url,username,password\r\nEdge,https://example.com,user,"comma,quote""password"'],
    ['linux.csv', 'url,username,password,httpRealm,formActionOrigin,guid,timeCreated\nhttps://example.com,user,secret,,https://example.com,guid,100'],
    ['ios.csv', '\uFEFFTitle,URL,Username,Password,Notes,OTPAuth\nApple,https://example.com,user,secret,Notes,'],
  ];
  for (const [filename, text] of fixtures) {
    const [entry] = parsePasswordImport(text, filename);
    assert.equal(entry.username, 'user');
    assert.equal(entry.password, filename === 'windows.csv' ? 'comma,quote"password' : 'secret');
    if (filename === 'android.csv') { assert.equal(entry.url, ''); assert.match(entry.notes, /android:\/\/hash@org.example.app/); }
    else assert.equal(entry.url, 'https://example.com/');
  }
});

test('password CSV export preserves punctuation, quotes, Unicode and newlines on reimport', () => {
  const entry = { name: 'Example, app', url: 'https://example.com/', username: 'person@example.com', password: '=exact+秘密"\ncredential', notes: 'line one\nline two' };
  const csv = exportPasswordCsv([entry]);
  const [restored] = parsePasswordImport(csv, 'passwords.csv');
  for (const key of Object.keys(entry)) assert.equal(restored[key], entry[key]);
  assert.equal(exportPasswordCsv([{ kind: 'document' }]), '\uFEFFname,url,username,password,notes');
});

test('failed backup authentication leaves the existing vault intact', async () => {
  const storage = memory(); await createVault(phrase, storage);
  const before = exportEncryptedVault(storage);
  const other = memory(); await createVault('Another long passphrase', other);
  await assert.rejects(restoreEncryptedVault(exportEncryptedVault(other), phrase, storage), /current vault has not changed/);
  assert.equal(exportEncryptedVault(storage), before);
  const corrupted = JSON.parse(exportEncryptedVault(other));
  corrupted.content.data = (corrupted.content.data[0] === 'A' ? 'B' : 'A') + corrupted.content.data.slice(1);
  await assert.rejects(restoreEncryptedVault(JSON.stringify(corrupted), 'Another long passphrase', storage), /current vault has not changed/);
  assert.equal(exportEncryptedVault(storage), before);
});

test('device unlock requires verified PRF key material; no boolean authentication bypass', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalSecure = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext');
  const originalCredential = Object.getOwnPropertyDescriptor(globalThis, 'PublicKeyCredential');
  let wrongSecret = false, getOptions, duringCreate;
  const output = () => ({ prf: { enabled: true, results: { first: new Uint8Array(32).fill(wrongSecret ? 9 : 7).buffer } } });
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: class {} });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: {
    create: async options => { assert.equal(options.publicKey.authenticatorSelection.userVerification, 'required'); await duringCreate?.(); return { rawId: new Uint8Array([1, 2, 3]), getClientExtensionResults: output }; },
    get: async options => { getOptions = options; return { getClientExtensionResults: output }; },
  } } });
  try {
    const storage = memory(); const session = await createVault(phrase, storage); const saved = await saveEntries(session, [entry], storage);
    const newerEntries = [entry, { ...entry, id: 'two', name: 'Saved during device setup' }];
    duringCreate = () => saveEntries(saved, newerEntries, storage);
    await enableDeviceUnlock(phrase, storage);
    assert.equal(hasDeviceUnlock(storage), true);
    assert.deepEqual((await unlockWithDevice(storage)).entries, newerEntries, 'device setup preserves newer password edits');
    assert.equal(getOptions.publicKey.userVerification, 'required');
    assert.equal(getOptions.publicKey.allowCredentials.length, 1);
    wrongSecret = true;
    await assert.rejects(unlockWithDevice(storage), /could not verify/);
    assert.deepEqual((await unlockVault(phrase, storage)).entries, newerEntries, 'passphrase recovery remains available');
  } finally {
    for (const [name, descriptor] of [['navigator', originalNavigator], ['isSecureContext', originalSecure], ['PublicKeyCredential', originalCredential]]) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
});
