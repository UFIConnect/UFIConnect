import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { constants } from 'node:fs';
import { createGatewayAgent, validateConfig, validateDesired, wireguardConfiguration, fetchDesiredState, applyWireguard } from './agent.mjs';

const key = () => randomBytes(32).toString('base64');
const rawConfig = { gatewayId: 'test-us-1', apiOrigin: 'https://api.example.invalid', token: randomBytes(32).toString('base64url'),
  subnet: '10.80.0.0/24', ipv6Subnet: 'fd80:80:0::/64' };
const config = validateConfig(rawConfig);
const instant = Date.parse('2026-10-06T12:00:00.000Z');
const iso = offset => new Date(instant + offset).toISOString();
const state = () => ({ version: 1, gatewayId: config.gatewayId, generatedAt: iso(0), expiresAt: iso(300000), peers: [
  { deviceId: randomUUID(), publicKey: key(), allowedIPs: ['10.80.0.2/32', 'fd80:80:0::2/128'], expiresAt: iso(60000) },
  { deviceId: randomUUID(), publicKey: key(), allowedIPs: ['10.80.0.3/32', 'fd80:80:0::3/128'], expiresAt: iso(300000) },
] });
function fixture() {
  const control = { now: instant, stored: null, incoming: state(), failFetch: false, failKey: false, failWrite: false, applied: [] };
  const privateKey = key();
  const agent = createGatewayAgent({ config: rawConfig, now: () => control.now,
    fetchDesired: async () => { if (control.failFetch) throw new Error('Private provider diagnostics'); return structuredClone(control.incoming); },
    readState: async () => structuredClone(control.stored),
    writeState: async value => { if (control.failWrite) throw new Error('Disk unavailable'); control.stored = structuredClone(value); },
    removeState: async () => { control.stored = null; },
    readPrivateKey: async () => { if (control.failKey) throw new Error('Key unavailable'); return privateKey; },
    applyConfiguration: async value => { control.applied.push(value); },
  });
  return { agent, control, privateKey };
}

test('gateway validates only bounded HTTPS management and private address pools', () => {
  for (const changes of [{ apiOrigin: 'http://api.example.invalid' }, { apiOrigin: 'https://user:password@api.example.invalid' },
    { apiOrigin: 'https://api.example.invalid/path' }, { token: 'short' }, { subnet: '8.8.8.0/24' },
    { subnet: '10.0.0.0/16' }, { ipv6Subnet: '2001:db8::/64' }, { gatewayId: '../other' }]) {
    assert.throws(() => validateConfig({ ...rawConfig, ...changes }));
  }
});

test('desired validation rejects replay, excessive lifetime, routing injection and duplicate peers', () => {
  assert.equal(validateDesired(state(), config, { now: instant }).peers.length, 2);
  const edits = [
    item => { item.version = 2; }, item => { item.gatewayId = 'other'; }, item => { item.expiresAt = iso(300001); },
    item => { item.generatedAt = iso(6000); }, item => { item.expiresAt = iso(-1); },
    item => { item.peers[0].allowedIPs[0] = '0.0.0.0/0'; }, item => { item.peers[0].allowedIPs[0] = '10.80.0.1/32'; },
    item => { item.peers[0].allowedIPs[1] = '::/0'; }, item => { item.peers[0].allowedIPs[1] = 'fd80:80:0::3/128'; },
    item => { item.peers[0].publicKey += '\nPostUp = evil'; }, item => { item.peers[0].privateKey = key(); },
    item => { item.peers[0].endpoint = 'attacker.invalid:1'; }, item => { item.peers[0].expiresAt = iso(300001); },
    item => { item.peers[0].publicKey = Buffer.alloc(32).toString('base64'); }, item => { item.peers.push(item.peers[0]); },
    item => { item.peers[1].publicKey = item.peers[0].publicKey; },
    item => { item.peers[1].allowedIPs = item.peers[0].allowedIPs; },
  ];
  for (const edit of edits) { const value = state(); edit(value); assert.throws(() => validateDesired(value, config, { now: instant })); }
  assert.throws(() => validateDesired(state(), config, { now: instant, previousGeneratedAt: instant + 1 }));
});

test('poll applies structured peers with local private key and persists only public desired state', async () => {
  const f = fixture();
  assert.deepEqual(await f.agent.poll(), { state: 'updated', peers: 2 });
  assert.match(f.control.applied[0], /^\[Interface\]\nPrivateKey = /);
  assert.ok(f.control.applied[0].includes(f.privateKey));
  assert.ok(f.control.applied[0].includes('AllowedIPs = 10.80.0.2/32, fd80:80:0::2/128'));
  for (const secret of [f.privateKey, rawConfig.token, rawConfig.apiOrigin, 'endpoint']) {
    assert.equal(JSON.stringify(f.control.stored).includes(secret), false);
  }
});

test('independent expiry removes shorter peer leases and closes the whole interface at document expiry', async () => {
  const f = fixture(); await f.agent.poll();
  f.control.now += 60000;
  assert.deepEqual(await f.agent.expire(), { state: 'retained', peers: 1 });
  assert.ok(f.control.applied.at(-1).includes(f.privateKey), 'syncconf must preserve the gateway key while retaining peers');
  assert.equal(f.control.applied.at(-1).includes(f.control.incoming.peers[0].publicKey), false);
  f.control.now = instant + 300000;
  f.control.failKey = true;
  assert.deepEqual(await f.agent.expire(), { state: 'closed', peers: 0 });
  assert.equal(f.control.applied.at(-1).includes('[Peer]'), false);
  assert.equal(f.control.applied.at(-1).includes('PrivateKey'), false);
  assert.equal(f.control.stored, null);
});

test('watchdog closes all peers when the local private key becomes unavailable', async () => {
  const f = fixture(); await f.agent.poll();
  f.control.failKey = true;
  assert.deepEqual(await f.agent.expire(), { state: 'closed', peers: 0 });
  assert.equal(f.control.applied.at(-1).includes('[Peer]'), false);
});

test('API outage retains only the existing lease and never extends it', async () => {
  const f = fixture(); await f.agent.poll();
  const originalExpiry = f.control.stored.expiresAt;
  f.control.failFetch = true; f.control.now += 100000;
  assert.deepEqual(await f.agent.poll(), { state: 'retained', peers: 1 });
  assert.equal(f.control.stored.expiresAt, originalExpiry);
  f.control.now += 200000;
  assert.deepEqual(await f.agent.poll(), { state: 'closed', peers: 0 });
});

test('poisoned management response never replaces a valid public document', async () => {
  const f = fixture(); await f.agent.poll();
  const original = structuredClone(f.control.stored);
  f.control.incoming.peers[0].allowedIPs = ['0.0.0.0/0', '::/0'];
  assert.deepEqual(await f.agent.poll(), { state: 'retained', peers: 2 });
  assert.deepEqual(f.control.stored, original);
  assert.equal(f.control.applied.at(-1).includes('AllowedIPs = 0.0.0.0/0'), false);
});

test('boot, missing or invalid state close peers without requiring API or private-key access', async () => {
  const f = fixture(); f.control.failKey = true; f.control.failFetch = true;
  assert.deepEqual(await f.agent.expire(), { state: 'closed', peers: 0 });
  f.control.stored = { peers: 'poisoned' };
  assert.deepEqual(await f.agent.expire(), { state: 'closed', peers: 0 });
  f.control.stored = state();
  assert.deepEqual(await f.agent.boot(), { state: 'closed', peers: 0 });
  assert.equal(f.control.stored, null);
});

test('failed state persistence cannot leave untracked access enabled', async () => {
  const f = fixture(); f.control.failWrite = true;
  assert.deepEqual(await f.agent.poll(), { state: 'closed', peers: 0 });
  assert.equal(f.control.applied.at(-1).includes('[Peer]'), false);
});

test('fetch sends a per-gateway credential only to a fixed HTTPS endpoint and refuses redirects/oversized bodies', async () => {
  let request;
  const response = await fetchDesiredState(config, async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify(state()), { headers: { 'content-type': 'application/json' } });
  });
  assert.equal(response.peers.length, 2);
  assert.equal(request.url, 'https://api.example.invalid/vpn/gateways/test-us-1/desired');
  assert.equal(request.options.headers.Authorization, 'Bearer ' + rawConfig.token);
  assert.equal(request.options.redirect, 'error');
  await assert.rejects(fetchDesiredState(config, async () => new Response('x'.repeat(131073), { headers: { 'content-type': 'application/json' } })));
  await assert.rejects(fetchDesiredState(config, async () => new Response('{}', { status: 302, headers: { 'content-type': 'application/json' } })));
});

test('wg reopens an inherited private tmpfs descriptor; the named secret file is removed before spawn', async () => {
  const configuration = wireguardConfiguration(state().peers, key());
  let invocation, received = '', removed = false, closed = false;
  const fsImpl = {
    lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false, uid: 0, mode: 0o700 }),
    open: async (file, flags, mode) => {
      assert.match(file, /^\/run\/ufi-vpn\/wireguard-[a-f0-9-]+\.tmp$/);
      assert.equal(mode, 0o600);
      assert.equal(flags, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW);
      return { fd: 10, writeFile: async value => { received = value; }, close: async () => { closed = true; } };
    },
    unlink: async () => { removed = true; },
  };
  const fakeSpawn = (file, args, options) => {
    assert.equal(removed, true);
    assert.equal(closed, false, 'descriptor remains open until wg finishes');
    invocation = { file, args, options };
    const child = new EventEmitter(); child.kill = () => {};
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };
  await applyWireguard(configuration, { spawnImpl: fakeSpawn, fsImpl });
  assert.deepEqual(invocation, { file: '/usr/bin/wg', args: ['syncconf', 'ufi0', '/proc/self/fd/3'], options: { shell: false, stdio: ['ignore', 'ignore', 'ignore', 10] } });
  assert.equal(received, configuration);
  assert.equal(closed, true);
  assert.equal(invocation.args.some(value => value.includes('PrivateKey')), false);
  closed = false; removed = false;
  await assert.rejects(applyWireguard(configuration, { fsImpl, spawnImpl: () => { throw new Error('Unable to spawn'); } }), /Unable to spawn/);
  assert.equal(closed, true); assert.equal(removed, true);
});

test('wg never writes a private configuration in an unprotected or symlinked runtime directory', async () => {
  for (const changes of [{ mode: 0o755 }, { uid: 1000 }, { isSymbolicLink: () => true }]) {
    const fsImpl = { lstat: async () => ({ isDirectory: () => true, isSymbolicLink: () => false, uid: 0, mode: 0o700, ...changes }),
      open: async () => assert.fail('must reject before writing configuration') };
    await assert.rejects(applyWireguard('secret', { fsImpl }), /not protected/);
  }
});
