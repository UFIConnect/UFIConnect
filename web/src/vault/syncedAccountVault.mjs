import { createAccountVault, accountVaultStorageKey } from './accountVault.mjs';
import { portableVaultRecord } from './localVault.mjs';

const conflict = () => new Error('This device and your account have different vault copies. Save an encrypted copy, then choose Use account copy. Neither copy has been replaced.');
const unavailable = () => new Error('Vault account storage could not be reached. Your device copy is unchanged. Retry before creating or changing your vault.');
const canonical = text => JSON.stringify(portableVaultRecord(text));
const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');

// Crypto remains entirely local. Writes are staged, committed with a server
// revision check, then cached. A journal of ciphertext hashes covers a lost
// response without doubling the local storage required by large vaults.
export function createSyncedAccountVault(accountId, transport, suppliedStorage) {
  const key = accountVaultStorageKey(accountId);
  const markerKey = `${key}.sync`;
  const pendingKey = `${key}.pending`;
  const storage = () => suppliedStorage ?? globalThis.localStorage;
  const local = createAccountVault(accountId, suppliedStorage);
  let active = false;
  let initializing = null;
  let state = 'checking';
  const readJSON = name => { try { return JSON.parse(storage().getItem(name)); } catch { return null; } };
  const mark = async (text, revision) => {
    const fingerprint = await hash(canonical(text));
    unchanged(text);
    storage().setItem(markerKey, JSON.stringify({ hash: fingerprint, revision }));
  };
  const remoteRecord = result => {
    if (result?.accountId !== accountId || !Number.isSafeInteger(result.revision) || result.revision < 0
      || (result.revision === 0) !== (result.record === null)) throw unavailable();
    return result.record ? canonical(JSON.stringify(result.record)) : null;
  };
  const get = async () => {
    try { const result = await transport.get(); remoteRecord(result); return result; }
    catch { state = 'unavailable'; throw unavailable(); }
  };
  const exclusive = async work => {
    if (active) throw new Error('Wait for the current vault operation to finish.');
    active = true;
    try { return await work(); } finally { active = false; }
  };
  const unchanged = before => { if (storage().getItem(key) !== before) throw conflict(); };
  async function cache(text, revision, before) {
    unchanged(before);
    // Compute before writing so another tab cannot slip between the guard and
    // the synchronous cache update. Metadata failure never erases ciphertext.
    const fingerprint = await hash(canonical(text));
    unchanged(before);
    storage().setItem(key, text);
    storage().setItem(markerKey, JSON.stringify({ hash: fingerprint, revision }));
    state = 'saved';
  }
  async function refresh() {
    const remote = await get();
    const serverText = remoteRecord(remote);
    const before = storage().getItem(key);
    const marker = readJSON(markerKey);
    const pending = readJSON(pendingKey);
    if (!before) {
      if (serverText) await cache(serverText, remote.revision, before);
      else state = 'empty';
      return remote;
    }
    let localText;
    try { localText = canonical(before); } catch { state = 'conflict'; throw conflict(); }
    if (serverText === localText) {
      await mark(before, remote.revision);
      state = 'saved';
      return remote;
    }
    const fingerprint = await hash(localText);
    const committedPending = serverText && pending?.baseHash === fingerprint && pending.hash === await hash(serverText);
    if (serverText && (committedPending || (marker?.hash === fingerprint && remote.revision >= marker.revision))) {
      // A clean cached copy can follow the account version. Keep this device's
      // biometric wrapper only while the underlying wrapped key is unchanged.
      const old = JSON.parse(before), next = JSON.parse(serverText);
      if (old.device && JSON.stringify(old.kdf) === JSON.stringify(next.kdf)
        && JSON.stringify(old.wrappedKey) === JSON.stringify(next.wrappedKey)) next.device = old.device;
      await cache(JSON.stringify(next), remote.revision, before);
      if (committedPending) storage().removeItem(pendingKey);
    } else if (!serverText && !marker) state = 'local';
    else { state = 'conflict'; throw conflict(); }
    return remote;
  }
  async function operate(method, args, { signal, deviceOnly = false } = {}) {
    return exclusive(async () => {
      const startingCopy = storage().getItem(key);
      let remote;
      try { remote = await refresh(); }
      catch (error) {
        // A database outage must not deny access to an existing device copy.
        // Offline/conflicting reads never upload or permit unconfirmed writes.
        if (['unlockVault', 'unlockWithDevice'].includes(method) && local.hasVault()
          && ['unavailable', 'conflict'].includes(state)) return local[method](...args);
        throw error;
      }
      signal?.throwIfAborted();
      const before = storage().getItem(key);
      if (method === 'restoreEncryptedVault' && before !== startingCopy) {
        throw new Error('Your account vault changed before restore. Download its current encrypted copy and confirm replacement again.');
      }
      let staged = before;
      const scratch = { getItem: () => staged, setItem: (_key, text) => { staged = text; } };
      const candidate = createAccountVault(accountId, scratch);
      const result = await candidate[method](...args);
      signal?.throwIfAborted();
      unchanged(before);
      const record = portableVaultRecord(staged);
      const serialized = JSON.stringify(record);
      if (deviceOnly && remote.record) { await cache(staged, remote.revision, before); return result; }
      if (serialized === remoteRecord(remote)) { state = 'saved'; return result; }
      const baseHash = before ? await hash(canonical(before)) : null;
      const candidateHash = await hash(serialized);
      unchanged(before);
      storage().setItem(pendingKey, JSON.stringify({ baseHash, hash: candidateHash }));
      let saved;
      try { saved = await transport.put({ revision: remote.revision, record }); }
      catch (error) {
        state = error?.response?.status === 409 ? 'conflict' : 'unavailable';
        if (state === 'conflict') throw conflict();
        throw new Error('The account save was not confirmed. Your device copy is unchanged. Reopen Vault to check whether the save completed before retrying.');
      }
      if (remoteRecord(saved) !== serialized) throw unavailable();
      // A remote commit must be cached even if the page locked during the
      // request. The caller's epoch guard prevents reopening an old session.
      await cache(staged, saved.revision, before);
      storage().removeItem(pendingKey);
      return result;
    });
  }
  return Object.freeze({
    ...local,
    initialize: () => {
      // React may replay mount effects while the first fetch is still pending.
      // Both subscribers must observe hydration, not a spurious busy failure.
      initializing ??= exclusive(refresh).finally(() => { initializing = null; });
      return initializing;
    },
    syncState: () => state,
    createVault: phrase => operate('createVault', [phrase]),
    unlockVault: phrase => operate('unlockVault', [phrase]),
    unlockWithDevice: () => operate('unlockWithDevice', []),
    saveEntries: (session, entries) => operate('saveEntries', [session, entries]),
    changePassphrase: (session, phrase, options = {}) => operate('changePassphrase', [session, phrase, options], options),
    restoreEncryptedVault: (text, phrase, options = {}) => operate('restoreEncryptedVault', [text, phrase, options], options),
    enableDeviceUnlock: phrase => operate('enableDeviceUnlock', [phrase], { deviceOnly: true }),
    // The UI requires exporting and confirming preservation of the exact local
    // record first. This changes only the local copy, never the account record.
    useAccountCopy: preservedText => exclusive(async () => {
      const before = storage().getItem(key);
      if (before && local.exportEncryptedVault() !== preservedText) throw conflict();
      const remote = await get();
      const text = remoteRecord(remote);
      if (!text) throw new Error('There is no encrypted account copy to use. Your device copy is unchanged.');
      await cache(text, remote.revision, before);
    }),
  });
}
