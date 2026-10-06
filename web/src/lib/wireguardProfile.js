import { x25519 } from '@noble/curves/ed25519.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const GATEWAY = /^[a-z0-9][a-z0-9-]{0,47}$/;
const fail = () => { throw new Error('VPN profile could not be verified. Try again.'); };
const base64 = bytes => btoa(String.fromCharCode(...bytes));

export function publicKeyValid(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false;
  try { const decoded = atob(value); return decoded.length === 32 && btoa(decoded) === value && [...decoded].some(c => c.charCodeAt(0) !== 0); }
  catch { return false; }
}

// RFC 7748 scalar decoding / WireGuard genkey format. Curve multiplication and
// random generation come from the pinned noble implementation, not local math.
export function wireguardIdentity(seed) {
  const privateKey = seed === undefined ? x25519.utils.randomSecretKey() : new Uint8Array(seed);
  if (privateKey.length !== 32) { privateKey.fill(0); return fail(); }
  privateKey[0] &= 248;
  privateKey[31] &= 127;
  privateKey[31] |= 64;
  return { privateKey, publicKey: base64(x25519.getPublicKey(privateKey)) };
}

export function forgetIdentity(identity) { identity?.privateKey?.fill(0); }

function ipv4(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(n => n <= 255) ? parts : null;
}
const privatePool = p => p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);

function endpoint(value) {
  if (typeof value !== 'string' || value.length > 260) return fail();
  const match = /^(\[[0-9a-f:]+\]|[a-z0-9.-]+):([1-9]\d{0,4})$/.exec(value);
  if (!match || Number(match[2]) > 65535) return fail();
  const host = match[1];
  if (host.startsWith('[')) {
    try { if (!/^[23]/.test(host.slice(1)) || new URL('https://' + host).hostname !== host) return fail(); }
    catch { return fail(); }
  } else if (/^[0-9.]+$/.test(host)) {
    const ip = ipv4(host);
    if (!ip || privatePool(ip) || ip[0] === 0 || ip[0] === 127 || ip[0] >= 224 || (ip[0] === 169 && ip[1] === 254)) return fail();
  } else if (host.length > 253 || !host.includes('.') || host.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))
    || /\.(?:localhost|local|internal)$/.test(host)) return fail();
  return value;
}

export function validateProfile(data, ownPublicKey, config) {
  const value = data?.profile;
  const allowed = ['id', 'gatewayId', 'label', 'publicKey', 'addresses', 'endpoint', 'serverPublicKey', 'dns', 'allowedIPs', 'persistentKeepalive', 'ipv6Egress', 'createdAt', 'enrollmentMode'];
  if (data?.state !== 'registered' || !value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key)) || !UUID.test(value.id || '') || !GATEWAY.test(value.gatewayId || '')
    || value.enrollmentMode !== 'profile' || !publicKeyValid(ownPublicKey) || value.publicKey !== ownPublicKey || !publicKeyValid(value.serverPublicKey)
    || config?.available !== true || config?.profileImportAvailable !== true || config?.protocol !== 'wireguard'
    || !Array.isArray(config.gateways) || !config.gateways.some(g => g?.id === value.gatewayId && g.country === 'DE')
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || !Array.isArray(value.addresses) || value.addresses.length !== 2
    || !Array.isArray(value.allowedIPs) || value.allowedIPs.length !== 2 || value.allowedIPs[0] !== '0.0.0.0/0' || value.allowedIPs[1] !== '::/0'
    || value.persistentKeepalive !== 25 || value.ipv6Egress !== 'blocked') return fail();
  const ipv4Match = /^([0-9.]+)\/32$/.exec(value.addresses[0]);
  const ip = ipv4Match && ipv4(ipv4Match[1]);
  if (!ip || !privatePool(ip) || ip[3] < 2 || ip[3] > 254
    || !Array.isArray(value.dns) || value.dns.length !== 1 || value.dns[0] !== ip.slice(0, 3).join('.') + '.1') return fail();
  const ipv6Match = /^(fd[0-9a-f]{2}(?::[0-9a-f]{1,4}){0,3}::[0-9a-f]{1,2})\/128$/.exec(value.addresses[1]);
  if (!ipv6Match || Number.parseInt(ipv6Match[1].split(':').at(-1), 16) !== ip[3]) return fail();
  let ipv6;
  try { ipv6 = new URL('https://[' + ipv6Match[1] + ']').hostname.slice(1, -1); } catch { return fail(); }
  return { id: value.id, publicKey: value.publicKey, gatewayId: value.gatewayId,
    addresses: [ipv4Match[1] + '/32', ipv6 + '/128'], endpoint: endpoint(value.endpoint),
    serverPublicKey: value.serverPublicKey, dns: [...value.dns] };
}

export function profileText(identity, data, config) {
  if (!(identity?.privateKey instanceof Uint8Array) || identity.privateKey.length !== 32
    || (identity.privateKey[0] & 7) || (identity.privateKey[31] & 128) || !(identity.privateKey[31] & 64)
    || base64(x25519.getPublicKey(identity.privateKey)) !== identity.publicKey) return fail();
  const profile = validateProfile(data, identity.publicKey, config);
  // Fixed directives only. API labels and arbitrary fields never enter the file.
  return '[Interface]\nPrivateKey = ' + base64(identity.privateKey)
    + '\nAddress = ' + profile.addresses.join(', ') + '\nDNS = ' + profile.dns[0]
    + '\nMTU = 1280\n\n[Peer]\nPublicKey = ' + profile.serverPublicKey
    + '\nEndpoint = ' + profile.endpoint + '\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n';
}

export function profileList(data) {
  if (!Array.isArray(data?.profiles) || data.profiles.length > 10) return fail();
  return data.profiles.map(value => {
    if (!UUID.test(value?.id || '') || !GATEWAY.test(value.gatewayId || '') || !publicKeyValid(value.publicKey)
      || value.enrollmentMode !== 'profile' || !Number.isFinite(Date.parse(value.createdAt))) return fail();
    return { id: value.id, publicKey: value.publicKey, createdAt: value.createdAt };
  });
}
