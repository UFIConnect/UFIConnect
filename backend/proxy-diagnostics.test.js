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
  assert.equal(result.resolvedClientMatchesCloudflare, false);
  for (const value of ['10.0.0.12', '104.16.10.2', '203.0.113.7', 'private-value', 'US']) assert.ok(!JSON.stringify(result).includes(value));
});

test('resolved-client diagnostic compares canonical addresses and rejects shared proxies or malformed input', () => {
  for (const [resolved, connecting, expected] of [
    ['::ffff:203.0.113.7', '203.0.113.7', true],
    ['2001:db8:0:0:0:0:0:7', '2001:DB8::7', true],
    ['10.0.0.12', '203.0.113.7', false],
    ['203.0.113.7', 'not-an-ip', false],
    ['203.0.113.7', '203.0.113.7, 203.0.113.8', false],
    [undefined, undefined, false],
  ]) {
    const diagnostic = proxyDiagnostics({ ip: resolved, socket: { remoteAddress: '10.0.0.12' }, headers: { 'cf-connecting-ip': connecting } });
    assert.equal(diagnostic.resolvedClientMatchesCloudflare, expected);
    for (const value of [resolved, connecting].filter(Boolean)) assert.ok(!JSON.stringify(diagnostic).includes(value));
  }
});
