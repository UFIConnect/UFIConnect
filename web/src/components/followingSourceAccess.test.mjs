import test from 'node:test';
import assert from 'node:assert/strict';
import { followingSourceAccess } from './followingSourceAccess.mjs';

test('configured disconnected Following sources offer Connect without selecting an unauthorised feed', () => {
  assert.deepEqual(followingSourceAccess({ configured: true, locked: true, canStartAuthorization: true }), {
    requiresConnection: true, locked: false, reason: 'Connect this source to use its Following feed.',
  });
  assert.deepEqual(followingSourceAccess({}, { connected: true }), { requiresConnection: false, locked: false, reason: '' });
});

test('missing setup, unsupported sources and explicit authorization denials stay unavailable', () => {
  for (const platform of [undefined, {}, { configured: false }, { configured: 'true' },
    { configured: true, canStartAuthorization: false }, { configured: true, authorizationAvailable: false },
    { configured: true, authorizationSupported: false }, { configured: true, connectionMode: 'external' }]) {
    const state = followingSourceAccess(platform);
    assert.equal(state.locked, true);
    assert.equal(state.requiresConnection, true);
    assert.ok(state.reason);
  }
});
