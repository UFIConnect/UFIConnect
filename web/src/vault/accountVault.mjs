import * as vault from './localVault.mjs';

export function accountVaultStorageKey(accountId) {
  if (typeof accountId !== 'string' || !accountId.trim() || accountId.length > 512) throw new Error('Sign in before opening your vault.');
  return `${vault.VAULT_STORAGE_KEY}.account.${encodeURIComponent(accountId)}`;
}

// Account isolation is separate from encryption: another signed-in member on
// the same browser never inherits this member's record or device credential.
// Legacy unscoped preview storage is deliberately not claimed or migrated.
export function createAccountVault(accountId, storage) {
  const key = accountVaultStorageKey(accountId);
  // Some browsers throw when the localStorage property itself is read. Defer
  // that lookup until an operation so the locked page can still render and
  // report an actionable storage error instead of crashing during render.
  const resolveStorage = () => {
    try {
      const resolved = storage ?? globalThis.localStorage;
      if (!resolved) throw new Error();
      return resolved;
    } catch { throw new Error('Browser storage is unavailable. Allow storage for this site before opening your vault.'); }
  };
  const scoped = {
    getItem: () => resolveStorage().getItem(key),
    setItem: (_key, value) => resolveStorage().setItem(key, value),
  };
  return Object.freeze({
    hasVault: () => vault.hasVault(scoped),
    createVault: passphrase => vault.createVault(passphrase, scoped),
    unlockVault: passphrase => vault.unlockVault(passphrase, scoped),
    saveEntries: (session, entries) => vault.saveEntries(session, entries, scoped),
    parsePasswordImport: vault.parsePasswordImport,
    exportEncryptedVault: () => vault.exportEncryptedVault(scoped),
    restoreEncryptedVault: (text, passphrase) => vault.restoreEncryptedVault(text, passphrase, scoped),
    hasDeviceUnlock: () => vault.hasDeviceUnlock(scoped),
    enableDeviceUnlock: passphrase => vault.enableDeviceUnlock(passphrase, scoped),
    unlockWithDevice: () => vault.unlockWithDevice(scoped),
  });
}
