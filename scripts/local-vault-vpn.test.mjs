import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalVaultVpn, parseNmcliRow } from './local-vault-vpn.mjs';
import { createVpnChallenges } from './local-vault-vpn-challenges.mjs';

test('VPN approval is bound to origin, profile, and action and works once', () => {
  let clock = 1000;
  const challenges = createVpnChallenges({ now: () => clock });
  const request = { origin: 'http://localhost:4188', profileId: 'a'.repeat(32), action: 'connect' };
  const first = challenges.issue(request);
  assert.equal(challenges.consume({ ...request, nonce: first.nonce }), true);
  assert.equal(challenges.consume({ ...request, nonce: first.nonce }), false);
  for (const wrong of [{ action: 'disconnect' }, { origin: 'https://uficonnect.org' }, { profileId: 'b'.repeat(32) }]) {
    const fresh = challenges.issue(request);
    assert.equal(challenges.consume({ ...request, ...wrong, nonce: fresh.nonce }), false);
    assert.equal(challenges.consume({ ...request, nonce: fresh.nonce }), false);
  }
  const expired = challenges.issue(request);
  clock += 30000;
  assert.equal(challenges.consume({ ...request, nonce: expired.nonce }), false);
  assert.equal(challenges.issue({ ...request, profileId: '--bad' }), null);
});

test('VPN approvals are bounded and expired entries are reclaimed', () => {
  let clock = 0;
  const challenges = createVpnChallenges({ now: () => clock });
  const request = { origin: 'http://localhost:4188', profileId: 'a'.repeat(32), action: 'disconnect' };
  for (let index = 0; index < 20; index += 1) assert.ok(challenges.issue(request));
  assert.equal(challenges.issue(request), null);
  clock = 30000;
  assert.ok(challenges.issue(request));
});

function executor(handler, calls) {
  return (file, args, options, callback) => {
    calls.push({ file, args, options });
    queueMicrotask(() => {
      try { callback(null, handler(file, args)); } catch { callback(new Error('PRIVATE DIAGNOSTIC')); }
    });
    return { stdin: { end() {} } };
  };
}

test('Linux VPN uses fixed nmcli and UUID arguments, confirms OS state, minimizes activity', async () => {
  const uuid = 'c9bb013d-d0ae-4b38-b151-733144fb3aae';
  let connected = false;
  const calls = [];
  const vpn = createLocalVaultVpn({ platform: 'linux', env: {}, now: () => new Date('2026-10-01T00:00:00Z'), execFileImpl: executor((file, args) => {
    assert.equal(file, '/usr/bin/nmcli');
    if (args.includes('--fields')) return `${uuid}:wireguard:Canada\\:Work:${connected ? 'activated' : ''}\n`;
    assert.deepEqual(args, ['--wait', '40', 'connection', connected ? 'down' : 'up', 'uuid', uuid]);
    connected = !connected;
    return '';
  }, calls) });
  const initial = await vpn.status();
  assert.equal(initial.profiles[0].name, 'Canada:Work');
  assert.equal(initial.profiles[0].status, 'disconnected');
  const result = await vpn.connect(initial.profiles[0].id);
  assert.equal(result.operation.confirmed, true);
  assert.equal(result.profiles[0].status, 'connected');
  assert.deepEqual(result.activity, [{ action: 'connect', timestamp: '2026-10-01T00:00:00.000Z' }]);
  assert.equal((await vpn.disconnect(initial.profiles[0].id)).operation.confirmed, true);
  assert.ok(calls.every(call => call.options.shell === false && !call.args.includes('--show-secrets') && !call.args.includes('--ask')));
});

test('Linux fails closed for unsupported profiles and refuses overlapping VPN connections', async () => {
  const one = 'c9bb013d-d0ae-4b38-b151-733144fb3aae';
  const two = 'c9bb013d-d0ae-4b38-b151-733144fb3aaf';
  const calls = [];
  let active = '';
  let type = 'vpn';
  const vpn = createLocalVaultVpn({ platform: 'linux', env: {}, execFileImpl: executor((file, args) => {
    if (args.includes('--fields')) return `${one}:${type}:First:\n${two}:wireguard:Second:${active}\n`;
    if (args.includes('--get-values')) return 'org.freedesktop.NetworkManager.pptp\n';
    throw new Error('Must not mutate');
  }, calls) });
  const state = await vpn.status();
  assert.equal(state.profiles[0].canConnect, false);
  await assert.rejects(vpn.connect(state.profiles[0].id), { code: 'VPN_PROFILE_UNAVAILABLE' });
  type = 'wireguard'; active = 'activated';
  await assert.rejects(vpn.connect(state.profiles[0].id), { code: 'VPN_OTHER_ACTIVE' });
  assert.ok(calls.every(call => !call.args.includes('--wait')));
  assert.deepEqual(parseNmcliRow('x:Name\\:With\\\\Slashes:'), ['x', 'Name:With\\Slashes', '']);
});

test('Windows rejects weak protocols and option-like names without executing rasdial', async () => {
  const calls = [];
  const vpn = createLocalVaultVpn({ platform: 'win32', env: { SystemRoot: 'C:\\Windows', APPDATA: 'C:\\Users\\test\\AppData\\Roaming' }, execFileImpl: executor((file) => {
    assert.ok(file.endsWith('powershell.exe'));
    return JSON.stringify({ failedScopes: [], profiles: [
      { name: 'Legacy', scope: 'user', protocol: 'Pptp', status: 'Disconnected' },
      { name: '/disconnect', scope: 'user', protocol: 'Ikev2', status: 'Disconnected' },
    ] });
  }, calls) });
  const state = await vpn.status();
  for (const profile of state.profiles) {
    assert.equal(profile.canConnect, false);
    await assert.rejects(vpn.connect(profile.id), { code: 'VPN_PROFILE_UNAVAILABLE' });
  }
  await assert.rejects(vpn.connect('unknown'), { code: 'VPN_PROFILE_NOT_FOUND' });
  assert.ok(calls.every(call => call.file.endsWith('powershell.exe')));
});

test('OS command failures never expose private diagnostics as connected', async () => {
  const vpn = createLocalVaultVpn({ platform: 'linux', execFileImpl: executor(() => { throw new Error('private endpoint'); }, []) });
  const state = await vpn.status();
  assert.equal(state.available, false);
  assert.deepEqual(state.profiles, []);
  assert.ok(!JSON.stringify(state).includes('PRIVATE'));
});
