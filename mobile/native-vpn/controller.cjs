const KEY = /^[A-Za-z0-9+/]{43}=$/;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
function validateLease(device, publicKey, now = Date.now()) {
  if (!device || !ID.test(device.deviceId || '') || !ID.test(device.gatewayId || '') ||
      device.publicKey !== publicKey || !KEY.test(publicKey) || !KEY.test(device.serverPublicKey || '') ||
      !Array.isArray(device.addresses) || device.addresses.length !== 2 ||
      !device.addresses.some(v => /^\d{1,3}(\.\d{1,3}){3}\/32$/.test(v)) ||
      !device.addresses.some(v => /^[a-fA-F0-9:]+\/128$/.test(v) && v.includes(':')) ||
      !Array.isArray(device.dns) || !device.dns.length || device.dns.some(v => !/^[a-fA-F0-9:.]+$/.test(v)) ||
      !Array.isArray(device.allowedIPs) || device.allowedIPs.length !== 2 ||
      !device.allowedIPs.includes('0.0.0.0/0') || !device.allowedIPs.includes('::/0') ||
      !/^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\]):\d{1,5}$/.test(device.endpoint || '') ||
      device.persistentKeepalive !== 25 || device.ipv6Egress !== 'blocked' ||
      !(Date.parse(device.leaseExpiresAt) > now + 10000) || Date.parse(device.leaseExpiresAt) > now + 360000) {
    throw new Error('The VPN gateway returned an invalid configuration.');
  }
  // Only explicitly allowed, public configuration crosses the bridge. No arbitrary WG text.
  return Object.fromEntries(['deviceId', 'gatewayId', 'publicKey', 'addresses', 'endpoint', 'serverPublicKey', 'dns', 'allowedIPs', 'persistentKeepalive', 'leaseExpiresAt', 'ipv6Egress'].map(key => [key, device[key]]));
}
function safeStatus(raw, now = Date.now()) {
  const osUp = raw?.tunnelState === 'up';
  const handshake = Number(raw?.lastHandshakeAt || 0);
  const fresh = handshake > 0 && handshake <= now + 5000 && now - handshake < 180000;
  const leaseValid = Date.parse(raw?.leaseExpiresAt) > now;
  const state = osUp && fresh && leaseValid ? 'connected' : osUp ? 'connecting' :
    ['starting', 'stopping'].includes(raw?.tunnelState) ? raw.tunnelState : 'disconnected';
  return { state, deviceId: ID.test(raw?.deviceId || '') ? raw.deviceId : null,
    leaseExpiresAt: leaseValid ? raw.leaseExpiresAt : null,
    lastHandshakeAt: fresh ? handshake : null, supported: raw?.supported !== false };
}
function createVpnController({ native, request, platform, now = Date.now }) {
  let generation = 0, connecting = false, deviceId = null;
  const supported = () => !!native && ['ios', 'android'].includes(platform);
  async function status() {
    if (!supported()) return { state: 'unavailable', supported: false };
    const result = safeStatus(await native.status(), now());
    deviceId = result.deviceId || deviceId;
    return result;
  }
  async function disconnect(token) {
    generation++;
    if (!supported()) return { stopped: true, revoked: true };
    const before = await native.status().catch(() => null);
    const id = deviceId || before?.deviceId;
    // Stop first. Never leave traffic routed while waiting on an HTTP request.
    await native.disconnect();
    const after = await native.status();
    if (after.tunnelState !== 'down') throw new Error('VPN is still disconnecting. Try again or disconnect in device VPN settings.');
    deviceId = null;
    let revoked = !id;
    if (id && token) {
      try { const result = await request('DELETE', `/vpn/devices/${encodeURIComponent(id)}`, token); revoked = result?.removed === true; }
      catch { revoked = false; }
    }
    return { stopped: true, revoked };
  }
  async function connect(token, gatewayId) {
    if (!supported()) throw new Error('VPN needs the native UFIConnect app with VPN support.');
    if (!token) throw new Error('Sign in before connecting.');
    if (connecting) throw new Error('A VPN connection is already being started.');
    connecting = true;
    const operation = ++generation;
    const check = () => { if (operation !== generation) throw new Error('VPN connection cancelled.'); };
    let enrolled;
    try {
      const config = await request('GET', '/vpn/config', token); check();
      if (!config?.available || config.protocol !== 'wireguard') throw new Error('VPN service is currently unavailable.');
      if (gatewayId && !config.gateways?.some(g => g.id === gatewayId)) throw new Error('Select an available VPN location.');
      await native.prepare(); check();
      const identity = await native.createIdentity(); check();
      if (!KEY.test(identity?.publicKey || '')) throw new Error('Secure VPN key creation failed.');
      const response = await request('POST', '/vpn/devices', token, { publicKey: identity.publicKey, label: `UFIConnect ${platform === 'ios' ? 'iOS' : 'Android'}`, ...(gatewayId ? { gatewayId } : {}) });
      enrolled = response?.device?.deviceId;
      check();
      if (response?.state !== 'enrolled') throw new Error('VPN enrollment was not confirmed.');
      const lease = validateLease(response.device, identity.publicKey, now());
      deviceId = lease.deviceId;
      await native.connect(JSON.stringify(lease), token); check();
      return status();
    } catch (error) {
      await native.disconnect().catch(() => {});
      if (enrolled && ID.test(enrolled)) await request('DELETE', `/vpn/devices/${encodeURIComponent(enrolled)}`, token).catch(() => {});
      deviceId = null;
      throw error;
    } finally { connecting = false; }
  }
  return { supported, connect, disconnect, status };
}
module.exports = { createVpnController, validateLease, safeStatus };
