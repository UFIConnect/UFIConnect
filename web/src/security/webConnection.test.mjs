import test from 'node:test';
import assert from 'node:assert/strict';
import { verifiedWebConnection, webConnectionProtected } from './webConnection.mjs';

const report = () => ({ scope: 'uficonnect-web', transport: { encrypted: true, protocol: 'https' },
  session: { verified: true }, protections: { revocableSession: true, privateResponses: true,
    privateMessages: true, validatedImports: true }, checkedAt: new Date().toISOString() });

test('only verified HTTPS web-session reports display protection', () => {
  assert.equal(webConnectionProtected(verifiedWebConnection(report())), true);
  assert.equal(webConnectionProtected(verifiedWebConnection({ ...report(), transport: { encrypted: false, protocol: 'http' } })), false);
  for (const response of [null, {}, { connected: true }, { state: 'registered', protocol: 'wireguard' },
    { ...report(), scope: 'device-vpn' }, { ...report(), session: { verified: false } },
    { ...report(), session: { verified: 'true' } }, { ...report(), transport: { encrypted: true, protocol: 'http' } },
    { ...report(), transport: { encrypted: 'true', protocol: 'https' } },
    { ...report(), checkedAt: 'invalid' }, { ...report(), protections: {} }]) {
    assert.throws(() => verifiedWebConnection(response), /could not be verified/);
  }
});

test('status reports retain actual safeguard availability and discard unrelated metadata', () => {
  const value = { ...report(), publicIP: 'unexpected', protections: { ...report().protections, privateMessages: false } };
  const checked = verifiedWebConnection(value);
  assert.equal(checked.protections.privateMessages, false);
  assert.equal('publicIP' in checked, false);
  assert.notEqual(checked.protections, value.protections);
});
