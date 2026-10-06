'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { proxyDiagnostics } = require('./proxy-diagnostics');

test('network diagnostic classifies hops without exposing addresses or headers', () => {
  const req = { socket: { remoteAddress: '::ffff:10.0.0.12' },
    headers: { 'x-forwarded-for': '203.0.113.7, 104.16.10.2', 'cf-ipcountry': 'US', 'cf-ray': 'private-value', 'cf-connecting-ip': '203.0.113.7' },
    app: { get: () => false } };
  const result = proxyDiagnostics(req);
  assert.deepEqual(result.hops, [
    { family: 'ipv4', range: 'private', cloudflare: false },
    { family: 'ipv4', range: 'unicast', cloudflare: true },
    { family: 'ipv4', range: 'reserved', cloudflare: false },
  ]);
  assert.equal(result.countryHeaderPresent, true);
  assert.equal(result.trustConfigured, false);
  for (const value of ['10.0.0.12', '104.16.10.2', '203.0.113.7', 'private-value', 'US']) assert.ok(!JSON.stringify(result).includes(value));
});
