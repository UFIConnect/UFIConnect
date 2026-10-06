// Run only on the newly provisioned, empty gateway, before enrollment opens:
// sudo node validate-gateway.mjs --new-empty-gateway ufi-de-1
// No provider changes, subscriber enrollment, persistent client keys, or logs
// of addresses/keys. Uses the existing server and an isolated Linux namespace.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve4, resolve6 } from 'node:dns/promises';
import { isIP } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const BIN = { ip: '/usr/sbin/ip', wg: '/usr/bin/wg', curl: '/usr/bin/curl', systemctl: '/usr/bin/systemctl', node: '/usr/bin/node' };
const UNITS = ['ufi-vpn-poll.timer', 'ufi-vpn-expiry.timer'];
const ROOT = '/run/ufi-vpn';
const statePath = `${ROOT}/desired.json`;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function protectedRead(file, maximum) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    assert(stat.isFile() && stat.uid === 0 && !(stat.mode & 0o077) && stat.size <= maximum, 'Protected file permissions are invalid.');
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}

export async function validateNewGateway(expectedGatewayId) {
  assert(process.platform === 'linux' && process.getuid?.() === 0, 'Validation requires root on the new Linux gateway.');
  assert(/^[a-z0-9][a-z0-9-]{0,47}$/.test(expectedGatewayId || ''), 'An expected gateway ID is required.');
  const agentPath = '/usr/local/lib/ufi-vpn/gateway-agent.mjs';
  const { applyWireguard, wireguardConfiguration, validateConfig } = await import(pathToFileURL(agentPath));
  const config = validateConfig(JSON.parse(await protectedRead('/etc/ufi-vpn/gateway.json', 16384)));
  assert(config.gatewayId === expectedGatewayId && config.prefix === '10.80.0.' && config.ipv6Prefix === 'fd80:80:0::', 'This is not the expected new gateway.');
  const rootStat = await fs.lstat(ROOT);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink() && rootStat.uid === 0 && !(rootStat.mode & 0o077), 'Runtime directory must be private and root-owned.');
  const lock = await fs.open(`${ROOT}/validation.lock`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const abort = new AbortController();
  const interrupt = () => abort.abort();
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const deadline = setTimeout(interrupt, 90000);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  const namespace = `ufi-validate-${suffix}`, hostVeth = `uvh${suffix}`, clientVeth = `uvc${suffix}`;
  const report = {};
  const timers = new Map();
  let baseline, oldState = null, clientPublicKey, temporaryDirectory;
  let controlled = false, namespaceCreated = false, vethCreated = false, stateChanged = false;

  async function run(file, args, { input, allowFailure = false, cleanup = false } = {}) {
    if (!cleanup) abort.signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', bytes = 0, timedOut = false;
      const kill = () => { timedOut = true; child.kill('SIGKILL'); };
      const timer = setTimeout(kill, 15000);
      const onAbort = () => kill();
      if (!cleanup) abort.signal.addEventListener('abort', onAbort, { once: true });
      const finish = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', onAbort); };
      child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 131072) kill(); else output += chunk; });
      child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 131072) kill(); });
      child.stdin.on('error', () => {}); child.stdin.end(input);
      child.once('error', () => { finish(); reject(new Error(`Cannot run ${path.basename(file)}.`)); });
      child.once('close', code => {
        finish();
        if (timedOut || (code !== 0 && !allowFailure)) reject(new Error(`Validation command failed: ${path.basename(file)}.`));
        else resolve({ code, output });
      });
    });
  }
  const command = (name, args, options) => run(BIN[name], args, options);
  const inNamespace = (name, args, options) => command('ip', ['netns', 'exec', namespace, BIN[name], ...args], options);
  const peers = async cleanup => (await command('wg', ['show', 'ufi0', 'peers'], { cleanup })).output.trim().split(/\s+/).filter(Boolean);
  const note = name => { report[name] = true; console.log(JSON.stringify({ check: name, passed: true })); };
  const cleanupErrors = [];
  let failure;
  try {
    assert((await peers()).length === 0, 'Refusing validation: the gateway already has peers.');
    try {
      oldState = await protectedRead(statePath, 131072);
      assert(Array.isArray(JSON.parse(oldState).peers) && JSON.parse(oldState).peers.length === 0, 'Refusing validation: stored leases already contain peers.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const unit of UNITS) timers.set(unit, (await command('systemctl', ['is-active', '--quiet', unit], { allowFailure: true })).code === 0);
    baseline = (await command('wg', ['showconf', 'ufi0'])).output;
    // Record prerequisites before stopping any production maintenance.
    for (const binary of Object.values(BIN)) await fs.access(binary, constants.X_OK);
    const [publicV4, publicV6] = await Promise.all([resolve4('www.cloudflare.com'), resolve6('www.cloudflare.com')]);
    assert(isIP(publicV4[0]) === 4 && isIP(publicV6[0]) === 6, 'Public probe addresses are unavailable.');
    const traceArgs = ['--disable', '--noproxy', '*', '--silent', '--show-error', '--fail', '--max-time', '10', '--proto', '=https', '--ipv4',
      '--resolve', `www.cloudflare.com:443:${publicV4[0]}`, 'https://www.cloudflare.com/cdn-cgi/trace'];
    const hostTrace = (await command('curl', traceArgs)).output;
    const hostAddress = /^ip=(.+)$/m.exec(hostTrace)?.[1]?.trim();
    assert(isIP(hostAddress) === 4, 'Gateway public IPv4 probe failed.');
    controlled = true;
    await command('systemctl', ['stop', ...UNITS, 'ufi-vpn-agent.service', 'ufi-vpn-expiry.service']);
    assert((await peers()).length === 0, 'Refusing validation: a peer appeared during maintenance shutdown.');
    note('emptyGateway');

    temporaryDirectory = await fs.mkdtemp(`${ROOT}/validation-`);
    await fs.chmod(temporaryDirectory, 0o700);
    const clientPrivateKey = (await command('wg', ['genkey'])).output.trim();
    clientPublicKey = (await command('wg', ['pubkey'], { input: clientPrivateKey + '\n' })).output.trim();
    const serverPrivateKey = (await protectedRead('/etc/wireguard/ufi0.key', 128)).trim();
    const serverPublicKey = (await command('wg', ['pubkey'], { input: serverPrivateKey + '\n' })).output.trim();
    const clientFile = `${temporaryDirectory}/client.conf`;
    await fs.writeFile(clientFile, `[Interface]\nPrivateKey = ${clientPrivateKey}\n[Peer]\nPublicKey = ${serverPublicKey}\nEndpoint = 10.81.0.1:51820\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 5\n`, { mode: 0o600, flag: 'wx' });
    await command('ip', ['netns', 'add', namespace]); namespaceCreated = true;
    await command('ip', ['link', 'add', hostVeth, 'type', 'veth', 'peer', 'name', clientVeth]); vethCreated = true;
    await command('ip', ['link', 'set', clientVeth, 'netns', namespace]);
    await command('ip', ['address', 'add', '10.81.0.1/30', 'dev', hostVeth]);
    await command('ip', ['link', 'set', hostVeth, 'up']);
    await inNamespace('ip', ['link', 'set', 'lo', 'up']);
    await inNamespace('ip', ['address', 'add', '10.81.0.2/30', 'dev', clientVeth]);
    await inNamespace('ip', ['link', 'set', clientVeth, 'up']);
    await inNamespace('ip', ['link', 'add', 'uvpn0', 'type', 'wireguard']);
    await inNamespace('wg', ['setconf', 'uvpn0', clientFile]);
    await fs.unlink(clientFile);
    await inNamespace('ip', ['address', 'add', '10.80.0.2/32', 'dev', 'uvpn0']);
    await inNamespace('ip', ['-6', 'address', 'add', 'fd80:80:0::2/128', 'dev', 'uvpn0', 'nodad']);
    await inNamespace('ip', ['link', 'set', 'uvpn0', 'mtu', '1380', 'up']);
    await inNamespace('ip', ['route', 'add', 'default', 'dev', 'uvpn0']);
    await inNamespace('ip', ['-6', 'route', 'add', 'default', 'dev', 'uvpn0']);
    await applyWireguard(wireguardConfiguration([{ publicKey: clientPublicKey, allowedIPs: ['10.80.0.2/32', 'fd80:80:0::2/128'] }], serverPrivateKey));

    const healthArgs = ['--disable', '--noproxy', '*', '--silent', '--show-error', '--fail', '--max-time', '8', 'http://10.80.0.1:8787/health'];
    const health = JSON.parse((await inNamespace('curl', healthArgs)).output);
    assert(health.ok === true && health.gatewayId === expectedGatewayId, 'Internal tunnel health failed.'); note('internalHealth');
    const handshakes = (await command('wg', ['show', 'ufi0', 'latest-handshakes'])).output.trim().split('\n');
    assert(handshakes.length === 1 && handshakes[0].split(/\s+/)[0] === clientPublicKey && Number(handshakes[0].split(/\s+/)[1]) > 0, 'WireGuard handshake failed.'); note('kernelHandshake');
    await inNamespace('node', ['-e', `const d=require('node:dgram').createSocket('udp4');const q=Buffer.from('6a7101000001000000000000076578616d706c6503636f6d0000010001','hex');const t=setTimeout(()=>{d.close();process.exitCode=1},4000);d.on('error',()=>{clearTimeout(t);d.close();process.exitCode=1});d.on('message',b=>{clearTimeout(t);d.close();process.exitCode=b.length>=12&&b.readUInt16BE(0)===0x6a71&&(b[2]&128)&&!(b[3]&15)&&b.readUInt16BE(6)>0?0:1});d.send(q,53,'10.80.0.1');`]); note('gatewayDns');
    const tunneledTrace = (await inNamespace('curl', traceArgs)).output;
    assert(/^ip=(.+)$/m.exec(tunneledTrace)?.[1]?.trim() === hostAddress, 'Public IPv4 did not exit through this gateway.'); note('publicIpv4Egress');
    const deniedArgs = ['--disable', '--noproxy', '*', '--silent', '--max-time', '3', '--connect-timeout', '2', '--output', '/dev/null', '--write-out', '%{http_code}'];
    const metadata = await inNamespace('curl', [...deniedArgs, 'http://169.254.169.254/'], { allowFailure: true });
    assert(metadata.code !== 0 && metadata.output === '000', 'Private metadata destination was reachable.'); note('privateMetadataBlocked');
    const ipv6 = await inNamespace('curl', [...deniedArgs, '--ipv6', '--resolve', `www.cloudflare.com:443:[${publicV6[0]}]`, 'https://www.cloudflare.com/cdn-cgi/trace'], { allowFailure: true });
    assert(ipv6.code !== 0 && ipv6.output === '000', 'IPv6 traffic escaped the blocked route.'); note('ipv6Blocked');

    const generated = Date.now();
    const lease = { version: 1, gatewayId: expectedGatewayId, generatedAt: new Date(generated).toISOString(), expiresAt: new Date(generated + 30000).toISOString(),
      peers: [{ deviceId: randomUUID(), publicKey: clientPublicKey, allowedIPs: ['10.80.0.2/32', 'fd80:80:0::2/128'], expiresAt: new Date(generated + 4000).toISOString() }] };
    const staged = `${temporaryDirectory}/desired.json`;
    await fs.writeFile(staged, JSON.stringify(lease), { mode: 0o600, flag: 'wx' });
    await fs.rename(staged, statePath); stateChanged = true;
    await command('node', [agentPath, '--expire']);
    assert((await peers()).length === 1, 'Watchdog did not retain the unexpired validation lease.');
    await delay(Math.max(1, generated + 4100 - Date.now()), undefined, { signal: abort.signal });
    await command('node', [agentPath, '--expire']);
    assert((await peers()).length === 0, 'Watchdog did not remove the expired validation peer.'); note('leaseExpiryRemovedPeer');
  } catch (error) { failure = error; }
  finally {
    clearTimeout(deadline);
    const attempt = async work => { try { await work(); } catch { cleanupErrors.push('cleanup operation failed'); } };
    if (controlled) {
      await attempt(async () => {
        const remaining = await peers(true);
        if (remaining.some(key => key !== clientPublicKey)) {
          if (clientPublicKey) await command('wg', ['set', 'ufi0', 'peer', clientPublicKey, 'remove'], { cleanup: true });
          throw new Error('Unexpected peer appeared; baseline was not restored.');
        }
        await applyWireguard(baseline);
        assert((await peers(true)).length === 0, 'Validation peer cleanup failed.');
      });
    }
    if (namespaceCreated) await attempt(() => command('ip', ['netns', 'delete', namespace], { cleanup: true }));
    if (vethCreated) await attempt(() => command('ip', ['link', 'delete', hostVeth], { allowFailure: true, cleanup: true }));
    if (stateChanged) await attempt(async () => {
      if (oldState === null) await fs.unlink(statePath);
      else {
        const staged = `${temporaryDirectory}/restore.json`;
        await fs.writeFile(staged, oldState, { mode: 0o600, flag: 'wx' }); await fs.rename(staged, statePath);
      }
    });
    if (temporaryDirectory) {
      for (const name of ['client.conf', 'desired.json', 'restore.json']) await attempt(() => fs.unlink(`${temporaryDirectory}/${name}`).catch(error => { if (error.code !== 'ENOENT') throw error; }));
      await attempt(() => fs.rmdir(temporaryDirectory));
    }
    if (controlled) for (const [unit, active] of timers) if (active) await attempt(() => command('systemctl', ['start', unit], { cleanup: true }));
    await attempt(() => lock.close()); await attempt(() => fs.unlink(`${ROOT}/validation.lock`));
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
  }
  assert(cleanupErrors.length === 0, 'Validation cleanup needs operator review; no subscriber enrollments should be enabled.');
  if (failure) throw failure;
  note('cleanupAndTimersRestored');
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--new-empty-gateway') {
    console.error('Usage: sudo node validate-gateway.mjs --new-empty-gateway EXPECTED_GATEWAY_ID'); process.exitCode = 1;
  } else validateNewGateway(process.argv[3]).then(() => console.log(JSON.stringify({ passed: true })))
    .catch(error => { console.error(error.name === 'AbortError' ? 'Validation interrupted; cleanup was attempted.' : error.message); process.exitCode = 1; });
}
