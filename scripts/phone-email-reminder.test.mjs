import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { EMAIL_REMINDER_SNOOZE_MS, emailReminderKey, needsPhoneEmailReminder, readEmailReminder, saveEmailReminder } from '../web/src/auth/phoneEmailReminder.mjs';

test('reminder targets only completed phone-created accounts without an email', () => {
  const phone = { id: 'phone-a', authProvider: 'phone', hasEmail: false, email: '', onboardingComplete: true };
  assert.equal(needsPhoneEmailReminder(phone), true);
  for (const patch of [{ authProvider: 'local' }, { authProvider: 'google' }, { authProvider: 'apple' }, { hasEmail: true }, { email: 'added@example.test' }, { onboardingComplete: false }, { hasEmail: undefined }, { id: null }]) {
    assert.equal(needsPhoneEmailReminder({ ...phone, ...patch }), false);
  }
  assert.equal(needsPhoneEmailReminder(null), false);
});

test('account snooze and permanent dismissal persist without contact or raw account identifiers', async () => {
  const values = new Map(), storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const keyA = await emailReminderKey('member-private-a', webcrypto), keyB = await emailReminderKey('member-private-b', webcrypto);
  assert.notEqual(keyA, keyB);
  assert.doesNotMatch(keyA, /member-private/);
  const first = saveEmailReminder('member-private-a', keyA, storage, 1000);
  assert.equal(first.nextAt, 1000 + EMAIL_REMINDER_SNOOZE_MS);
  assert.equal(first.dismissed, false);
  assert.deepEqual(readEmailReminder('member-private-a', keyA, storage), first);
  assert.equal(readEmailReminder('member-private-b', keyB, storage).nextAt, 0);
  saveEmailReminder('member-private-a', keyA, storage, 2000, true);
  assert.equal(readEmailReminder('member-private-a', keyA, storage).dismissed, true);
  assert.deepEqual(Object.keys(JSON.parse(values.get(keyA))).sort(), ['dismissed', 'nextAt', 'version']);
});

test('blocked storage falls back to per-account memory and malformed preferences are ignored', async () => {
  const storage = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
  const preference = saveEmailReminder('blocked-storage-a', null, storage, 1000);
  assert.deepEqual(readEmailReminder('blocked-storage-a', null, storage), preference);
  assert.equal(readEmailReminder('blocked-storage-b', null, storage).nextAt, 0);
  assert.equal(await emailReminderKey('member', {}), null);
  assert.equal(readEmailReminder('malformed-a', 'key', { getItem: () => '{bad-json' }).nextAt, 0);
  assert.equal(readEmailReminder('malformed-b', 'key', { getItem: () => '{"version":1,"nextAt":"never","dismissed":false}' }).nextAt, 0);
});
