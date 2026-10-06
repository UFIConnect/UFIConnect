import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { renderGatewayCloudInit } from './hetzner-cloud-init.mjs';
const input = { gatewayId: 'ufi-de-1', token: 'x'.repeat(43), adminAddress: '203.0.113.7', adminPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample fixture', agentSource: '// fixture\n' };
test('gateway bootstrap keeps management restricted and rejects peer/private-network/IPv6 forwarding', () => {
  const doc = parse(renderGatewayCloudInit(input));
  assert.equal(doc.ssh_pwauth, false);
  assert.equal(doc.disable_root, true);
  const files = new Map(doc.write_files.map(f => [f.path, f]));
  assert.equal(files.get('/etc/ufi-vpn/gateway.json').permissions, '0600');
  assert.equal(JSON.parse(files.get('/etc/ufi-vpn/gateway.json').content).apiOrigin, 'https://uficonnect-api-708r.onrender.com');
  const firewall = files.get('/etc/nftables.conf').content;
  assert.match(firewall, /ip saddr 203\.0\.113\.7 tcp dport 22 accept/);
  assert.match(firewall, /iifname "ufi0" oifname "ufi0" drop/);
  assert.match(firewall, /iifname "ufi0" meta nfproto ipv6 drop/);
  assert.match(firewall, /169\.254\.0\.0\/16/);
  assert.match(firewall, /tcp dport 25 drop/);
  assert.doesNotMatch(firewall, /log /);
  assert.match(files.get('/etc/systemd/system/ufi-vpn-expiry.service').content, /--expire/);
  assert.match(files.get('/etc/systemd/system/ufi-vpn-expiry.timer').content, /OnUnitActiveSec=15/);
  assert.match(files.get('/etc/unbound/unbound.conf.d/ufi-vpn.conf').content, /log-queries: no/);
  assert.match(files.get('/usr/local/sbin/ufi-vpn-setup').content, /SaveConfig = false/);
});
test('bootstrap rejects command or broad-network injection before creating user data', () => {
  for (const bad of [{ adminAddress: '0.0.0.0/0' }, { adminAddress: '1.2.3.4; whoami' }, { gatewayId: 'id\ncommands' }, { token: 'short' }, { adminPublicKey: 'command="whoami" ssh-ed25519 ABC' }]) {
    assert.throws(() => renderGatewayCloudInit({ ...input, ...bad }));
  }
});

test('both maintenance units preserve the private runtime mode required to save leases after boot', () => {
  const doc = parse(renderGatewayCloudInit(input));
  for (const name of ['ufi-vpn-agent.service', 'ufi-vpn-expiry.service']) {
    const unit = doc.write_files.find(file => file.path === `/etc/systemd/system/${name}`).content;
    const settings = Object.fromEntries(unit.split('\n').filter(line => line.includes('=')).map(line => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
    assert.equal(settings.RuntimeDirectory, 'ufi-vpn');
    // systemd defaults to 0755 independently of UMask, including when it
    // adjusts the setup script's existing directory. The agent rejects that.
    assert.equal(parseInt(settings.RuntimeDirectoryMode || '0755', 8) & 0o077, 0, name);
    assert.equal(settings.RuntimeDirectoryPreserve, 'yes');
  }
});
