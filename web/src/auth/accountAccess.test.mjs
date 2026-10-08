import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedPhoneNumber, PHONE_COUNTRIES, providerAuthorizationUrl } from './accountAccess.mjs';

test('authorization redirects stay on the chosen identity provider', () => {
  assert.equal(new URL(providerAuthorizationUrl('google', 'https://accounts.google.com/o/oauth2/v2/auth?state=opaque')).origin, 'https://accounts.google.com');
  assert.equal(new URL(providerAuthorizationUrl('apple', 'https://appleid.apple.com/auth/authorize?state=opaque')).origin, 'https://appleid.apple.com');
  for (const value of ['javascript:alert(1)', '//accounts.google.com/', 'http://accounts.google.com/', 'https://accounts.google.com.attacker.invalid/', 'https://user:password@accounts.google.com/', 'https://appleid.apple.com/auth/authorize']) {
    assert.throws(() => providerAuthorizationUrl('google', value));
  }
  assert.throws(() => providerAuthorizationUrl('other', 'https://accounts.google.com/'));
});

test('country selection normalizes national numbers and preserves pasted international numbers', () => {
  assert.equal(normalizedPhoneNumber('(415) 555-0123', 'US'), '+14155550123');
  assert.equal(normalizedPhoneNumber('020 7946 0123', 'GB'), '+442079460123');
  assert.equal(normalizedPhoneNumber('06 12 34 56 78', 'FR'), '+33612345678');
  assert.equal(normalizedPhoneNumber('+44 20 7946 0123', 'US'), '+442079460123');
  assert.equal(normalizedPhoneNumber('555', 'US'), null);
  assert.equal(normalizedPhoneNumber('4155550123', 'invalid'), null);
  assert.equal(normalizedPhoneNumber('Call +1 415 555 0123', 'US'), null);
  assert.equal(normalizedPhoneNumber('+1 415 555 0123 ext 9', 'US'), null);
  assert.ok(PHONE_COUNTRIES.length > 200);
  assert.equal(PHONE_COUNTRIES.find(item => item.code === 'GB').callingCode, '44');
});

test('phone login accepts country codes and rejects malformed numbers', () => {
  assert.equal(normalizedPhoneNumber('+1 (555) 123-4567'), '+15551234567');
  assert.equal(normalizedPhoneNumber('+44 20 7946 0123'), '+442079460123');
  for (const value of ['5551234567', '+0123456789', '+123', '+1234567890123456', '+1555a234567', '', null]) assert.equal(normalizedPhoneNumber(value), null);
});
