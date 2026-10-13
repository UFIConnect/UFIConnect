import assert from 'node:assert/strict';
import test from 'node:test';
import { isAppHost } from './appHost.mjs';

test('only the dedicated app host uses the shared installed-app interface', () => {
  assert.equal(isAppHost('app.uficonnect.org'), true);
  assert.equal(isAppHost('APP.UFICONNECT.ORG'), true);
  for (const host of ['uficonnect.org', 'www.uficonnect.org', 'localhost',
    'app.uficonnect.org.example.com', 'example-app.uficonnect.org', '', null]) {
    assert.equal(isAppHost(host), false);
  }
});
