import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountVault, accountVaultStorageKey } from '../web/src/vault/accountVault.mjs';
import { safeLaunchUrl } from '../web/src/vault/vaultLaunchers.mjs';
test('launch links reject executable schemes and embedded credentials', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,bad', 'file:///C:/Windows/system32/cmd.exe', 'https://user:password@example.com', 'ms-settings:network-vpn', 'msteams://evil.example/l/app/id']) {
    assert.equal(safeLaunchUrl(value, true), '');
  }
  assert.equal(safeLaunchUrl('https://example.com/app', true), 'https://example.com/app');
  assert.equal(safeLaunchUrl('spotify:track:4cOdK2wGLETKBW3PvgPWqT', true), 'spotify:track:4cOdK2wGLETKBW3PvgPWqT');
});
test('favorites, app links, and command counts round-trip only inside account encryption', async () => {
  const records = new Map(), storage = { getItem: key => records.get(key), setItem: (key, value) => records.set(key, value) };
  const vault = createAccountVault('preview-a', storage), other = createAccountVault('preview-b', storage);
  let session = await vault.createVault('Local synthetic test passphrase');
  session = await vault.saveEntries({ ...session, preferences: { favorites: ['web'], commands: { web: 7 } } }, [{ name: 'Private launcher', url: 'https://example.com', appUrl: 'https://example.com/app', password: 'private-password', favorite: true, launchCount: 7 }]);
  const record = records.get(accountVaultStorageKey('preview-a'));
  for (const secret of ['Private launcher', 'example.com', 'private-password', 'favorites', 'launchCount']) assert.ok(!record.includes(secret));
  assert.equal(other.hasVault(), false);
  const unlocked = await vault.unlockVault('Local synthetic test passphrase');
  assert.equal(unlocked.entries[0].favorite, true);
  assert.equal(unlocked.entries[0].launchCount, 7);
  assert.deepEqual(unlocked.preferences.favorites, ['web']);
  assert.equal(unlocked.preferences.commands.web, 7);
  await assert.rejects(vault.saveEntries(unlocked, [{ name: 'Unsafe', password: 'x', appUrl: 'javascript:alert(1)' }]), /app link/);
  assert.equal(records.get(accountVaultStorageKey('preview-a')), record);
});
