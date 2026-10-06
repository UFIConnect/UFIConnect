import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const MAX_LEASE_MS = 300000;
const MAX_DOCUMENT_BYTES = 128 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const KEY = /^[A-Za-z0-9+/]{43}=$/;
const keyValid = value => typeof value === 'string' && KEY.test(value)
  && Buffer.from(value, 'base64').toString('base64') === value
  && Buffer.from(value, 'base64').some(byte => byte !== 0);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
const timestamp = value => {
  if (typeof value !== 'string') throw new Error('Invalid desired-state timestamp.');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error('Invalid desired-state timestamp.');
  return time;
};

export function validateConfig(value) {
  if (!value || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(value.gatewayId || '')
    || !/^[A-Za-z0-9_-]{40,256}$/.test(value.token || '')) throw new Error('Invalid gateway configuration.');
  const origin = new URL(value.apiOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/'
    || origin.search || origin.hash) throw new Error('The management API must be an HTTPS origin.');
  const match = /^(\d+)\.(\d+)\.(\d+)\.0\/24$/.exec(value.subnet || '');
  const parts = match?.slice(1).map(Number);
  if (!parts || !parts.every(part => part >= 0 && part <= 255)
    || !(parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168))
    || !/^fd[0-9a-f]{2}(?::[0-9a-f]{1,4}){0,3}::\/64$/i.test(value.ipv6Subnet || '')) {
    throw new Error('Invalid gateway address pools.');
  }
  return Object.freeze({ apiOrigin: origin.origin, gatewayId: value.gatewayId, token: value.token,
    prefix: parts.join('.') + '.', ipv6Prefix: value.ipv6Subnet.slice(0, -3).toLowerCase() });
}

export function validateDesired(value, config, { now = Date.now(), allowExpired = false, previousGeneratedAt = 0 } = {}) {
  if (!exactKeys(value, ['version', 'gatewayId', 'generatedAt', 'expiresAt', 'peers'])
    || value.version !== 1 || value.gatewayId !== config.gatewayId || !Array.isArray(value.peers)
    || value.peers.length > 253) throw new Error('Invalid gateway desired state.');
  const generated = timestamp(value.generatedAt), expires = timestamp(value.expiresAt);
  if (generated > now + 5000 || generated < previousGeneratedAt || expires <= generated
    || expires - generated > MAX_LEASE_MS || expires > now + MAX_LEASE_MS
    || (!allowExpired && expires <= now)) throw new Error('Desired state is stale or outside its lease.');
  const keys = new Set(), addresses = new Set(), devices = new Set();
  const peers = value.peers.map(peer => {
    if (!exactKeys(peer, ['deviceId', 'publicKey', 'allowedIPs', 'expiresAt']) || !UUID.test(peer.deviceId)
      || !keyValid(peer.publicKey) || keys.has(peer.publicKey) || devices.has(peer.deviceId)
      || !Array.isArray(peer.allowedIPs) || peer.allowedIPs.length !== 2) throw new Error('Invalid desired peer.');
    const ipv4 = peer.allowedIPs[0];
    if (typeof ipv4 !== 'string' || !ipv4.startsWith(config.prefix) || !ipv4.endsWith('/32')) throw new Error('Invalid peer address.');
    const host = Number(ipv4.slice(config.prefix.length, -3));
    if (!Number.isInteger(host) || host < 2 || host > 254 || ipv4 !== `${config.prefix}${host}/32`
      || peer.allowedIPs[1] !== `${config.ipv6Prefix}${host.toString(16)}/128` || addresses.has(ipv4)) {
      throw new Error('Invalid peer address.');
    }
    const leaseEnd = timestamp(peer.expiresAt);
    if (leaseEnd <= generated || leaseEnd > expires || leaseEnd > now + MAX_LEASE_MS) throw new Error('Invalid peer lease.');
    keys.add(peer.publicKey); devices.add(peer.deviceId); addresses.add(ipv4);
    return { deviceId: peer.deviceId, publicKey: peer.publicKey, allowedIPs: [...peer.allowedIPs], expiresAt: peer.expiresAt };
  });
  return { version: 1, gatewayId: config.gatewayId, generatedAt: value.generatedAt, expiresAt: value.expiresAt, peers };
}

export function wireguardConfiguration(peers, privateKey = null) {
  if (privateKey !== null && !keyValid(privateKey)) throw new Error('Gateway private key is unavailable.');
  return `[Interface]\n${privateKey ? `PrivateKey = ${privateKey}\n` : ''}ListenPort = 51820\n`
    + peers.map(peer => `\n[Peer]\nPublicKey = ${peer.publicKey}\nAllowedIPs = ${peer.allowedIPs.join(', ')}\n`).join('');
}

export function createGatewayAgent({ config: rawConfig, now = Date.now, fetchDesired, readState, writeState,
  removeState, readPrivateKey, applyConfiguration }) {
  const config = validateConfig(rawConfig);
  async function clear() {
    // An absent/damaged key file must not prevent the independent watchdog
    // from removing every peer on the already-existing interface.
    await applyConfiguration(wireguardConfiguration([]));
    await removeState();
    return { state: 'closed', peers: 0 };
  }
  async function stored() {
    try { return validateDesired(await readState(), config, { now: now(), allowExpired: true }); }
    catch { return null; }
  }
  async function expire() {
    const state = await stored();
    if (!state || timestamp(state.expiresAt) <= now()) return clear();
    let privateKey;
    try { privateKey = (await readPrivateKey()).trim(); if (!keyValid(privateKey)) throw new Error(); }
    catch { return clear(); }
    if (timestamp(state.expiresAt) <= now()) return clear();
    const peers = state.peers.filter(peer => timestamp(peer.expiresAt) > now());
    // syncconf clears omitted interface fields, so retaining peers must also
    // supply the same local private key. A keyless config is used only to close.
    await applyConfiguration(wireguardConfiguration(peers, privateKey));
    return { state: 'retained', peers: peers.length };
  }
  async function poll() {
    try {
      const previous = await stored();
      const candidate = await fetchDesired(config);
      const state = validateDesired(candidate, config, { now: now(), previousGeneratedAt: previous ? timestamp(previous.generatedAt) : 0 });
      const privateKey = (await readPrivateKey()).trim();
      // Re-evaluate leases after network and disk I/O, immediately before wg.
      if (timestamp(state.expiresAt) <= now()) throw new Error('Desired state expired before application.');
      const peers = state.peers.filter(peer => timestamp(peer.expiresAt) > now());
      await applyConfiguration(wireguardConfiguration(peers, privateKey));
      await writeState(state);
      return { state: 'updated', peers: peers.length };
    } catch {
      // A bad response never replaces a known valid document. Retain access
      // only until its original expiry, then the watchdog removes all peers.
      return expire();
    }
  }
  return { poll, expire, boot: clear };
}

export async function fetchDesiredState(config, fetchImpl = fetch) {
  const response = await fetchImpl(`${config.apiOrigin}/vpn/gateways/${encodeURIComponent(config.gatewayId)}/desired`, {
    headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000), redirect: 'error', cache: 'no-store',
  });
  if (!response.ok || !/^application\/json\b/i.test(response.headers.get('content-type') || '')
    || Number(response.headers.get('content-length') || 0) > MAX_DOCUMENT_BYTES || !response.body) {
    throw new Error('Gateway management response is unavailable.');
  }
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_DOCUMENT_BYTES) throw new Error('Gateway management response exceeds its limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}

export async function applyWireguard(configuration, { spawnImpl = spawn, fsImpl = fs } = {}) {
  // Node's piped stdio is a socket on Linux; wg reopens its configuration
  // pathname, which makes /dev/stdin fail with ENXIO. Give it a regular tmpfs
  // descriptor instead. Unlink before spawn so even a killed agent leaves no
  // named file containing the private key. The inherited descriptor stays open.
  const directory = '/run/ufi-vpn';
  const stat = await fsImpl.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o077)) {
    throw new Error('Gateway runtime directory is not protected.');
  }
  const temporary = `${directory}/wireguard-${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fsImpl.open(temporary, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(configuration);
    await fsImpl.unlink(temporary);
    await new Promise((resolve, reject) => {
      const child = spawnImpl('/usr/bin/wg', ['syncconf', 'ufi0', '/proc/self/fd/3'], {
        shell: false, stdio: ['ignore', 'ignore', 'ignore', handle.fd],
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('error', () => { clearTimeout(timer); reject(new Error('WireGuard state update failed.')); });
      child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('WireGuard state update failed.')); });
    });
  } finally {
    if (handle) {
      try { await fsImpl.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      finally { await handle.close(); }
    }
  }
}

async function privateFile(file, maximumBytes) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o077) || stat.size > maximumBytes) throw new Error('Gateway file is not protected.');
    return await handle.readFile('utf8');
  } finally { await handle.close(); }
}

async function main() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('Gateway agent requires the configured Linux service.');
  const operation = process.argv[2];
  if (!['--poll', '--expire', '--boot'].includes(operation) || process.argv.length !== 3) throw new Error('Choose a gateway agent operation.');
  const statePath = '/run/ufi-vpn/desired.json';
  let config;
  try { config = JSON.parse(await privateFile('/etc/ufi-vpn/gateway.json', 16384)); validateConfig(config); }
  catch {
    await applyWireguard(wireguardConfiguration([]));
    await fs.unlink(statePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    console.log(JSON.stringify({ state: 'closed', peers: 0 }));
    return;
  }
  const agent = createGatewayAgent({ config, fetchDesired: fetchDesiredState,
    readState: async () => JSON.parse(await privateFile(statePath, MAX_DOCUMENT_BYTES)),
    removeState: () => fs.unlink(statePath).catch(error => { if (error.code !== 'ENOENT') throw error; }),
    writeState: async state => {
      const directory = path.dirname(statePath);
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || (stat.mode & 0o077)) throw new Error('Gateway runtime directory is not protected.');
      const temporary = `${statePath}.${process.pid}.tmp`;
      const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify(state) + '\n'); await handle.sync(); }
      finally { await handle.close(); }
      try { await fs.rename(temporary, statePath); }
      catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
    },
    readPrivateKey: () => privateFile('/etc/wireguard/ufi0.key', 128), applyConfiguration: applyWireguard,
  });
  const result = await agent[operation.slice(2)]();
  // Operational counts only: no keys, peer addresses, accounts or endpoints.
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('VPN gateway maintenance failed.'); process.exitCode = 1; });
}
