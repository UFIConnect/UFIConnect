'use strict';

const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { isIP } = require('node:net');
const { MANAGED_VPN_SCHEMA } = require('./managed-vpn-schema');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const fault = (status, message) => Object.assign(new Error(message), { status });
const digest = value => createHash('sha256').update(value).digest();
const iso = value => new Date(value).toISOString();
const cleanLabel = value => typeof value === 'string' && value.trim().length >= 1
  && value.trim().length <= 80 && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
const publicKeyValid = value => typeof value === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(value)
  && Buffer.from(value, 'base64').toString('base64') === value
  && Buffer.from(value, 'base64').some(byte => byte !== 0);

function normalizeGateway(input) {
  if (!input || !ID.test(input.id || '') || !cleanLabel(input.label)
    || !/^[A-Z]{2}$/.test(input.country || '') || !publicKeyValid(input.publicKey)
    || typeof input.token !== 'string' || !/^[A-Za-z0-9_-]{40,256}$/.test(input.token)) {
    throw new Error('Invalid managed VPN gateway identity or credentials.');
  }
  const endpoint = /^([^:\s]+|\[[a-f0-9:]+\]):(\d{1,5})$/i.exec(input.endpoint || '');
  const host = endpoint?.[1].replace(/^\[|\]$/g, '');
  if (!endpoint || Number(endpoint[2]) < 1 || Number(endpoint[2]) > 65535
    || !(isIP(host) || /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host))) {
    throw new Error('Invalid managed VPN gateway endpoint.');
  }
  // This first deployment deliberately supports bounded /24 pools only.
  const network = /^(\d+)\.(\d+)\.(\d+)\.0\/24$/.exec(input.subnet || '');
  const octets = network?.slice(1).map(Number);
  const privatePool = octets && octets.every(part => part >= 0 && part <= 255)
    && (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168));
  if (!privatePool || !/^fd[0-9a-f]{2}(?::[0-9a-f]{1,4}){0,3}::\/64$/i.test(input.ipv6Subnet || '')) {
    throw new Error('Managed VPN gateways require private IPv4 /24 and ULA IPv6 /64 pools.');
  }
  const prefix = octets.join('.') + '.';
  if (!Array.isArray(input.dns) || input.dns.length !== 1 || input.dns[0] !== prefix + '1') {
    throw new Error('Managed VPN DNS must use the gateway resolver.');
  }
  const maxPeers = input.maxPeers ?? 100;
  if (!Number.isInteger(maxPeers) || maxPeers < 1 || maxPeers > 253) throw new Error('Invalid managed VPN gateway capacity.');
  return Object.freeze({ id: input.id, label: input.label.trim(), country: input.country,
    endpoint: input.endpoint, publicKey: input.publicKey, dns: Object.freeze([...input.dns]),
    prefix, ipv6Prefix: input.ipv6Subnet.slice(0, -3).toLowerCase(),
    tokenHash: digest(input.token), maxPeers });
}

function createManagedVpn({ db, billing, gateways = [], now = Date.now, leaseSeconds = 300,
  maxDevices = 3, billingTimeoutMs = 5000, reconcileBudgetMs = 10000 } = {}) {
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 300
    || !Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 10
    || !Number.isInteger(billingTimeoutMs) || billingTimeoutMs < 1 || billingTimeoutMs > 10000
    || !Number.isInteger(reconcileBudgetMs) || reconcileBudgetMs < 1 || reconcileBudgetMs > 15000
    || !Array.isArray(gateways) || gateways.length > 20) throw new Error('Invalid managed VPN limits.');
  const configured = gateways.map(normalizeGateway);
  const byId = new Map(configured.map(gateway => [gateway.id, gateway]));
  if (byId.size !== configured.length) throw new Error('Duplicate managed VPN gateway ID.');
  const billingPending = new Map();

  const storageReady = () => {
    if (!db?.isConnected?.()) throw fault(503, 'VPN account storage is temporarily unavailable.');
  };
  const account = userId => {
    if (!UUID.test(String(userId || ''))) throw fault(401, 'Sign in to manage your VPN devices.');
    storageReady();
  };
  async function transaction(work) {
    return db.withClient(async client => {
      await client.query('BEGIN');
      try { const result = await work(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
    });
  }
  function within(promise, timeoutMs) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(fault(503, 'VPN membership verification is temporarily unavailable.')), timeoutMs);
    })]).finally(() => clearTimeout(timer));
  }
  async function entitlement(userId, timeoutMs = billingTimeoutMs) {
    // Share only in-flight reads. Every later poll must verify current Stripe
    // state; neither a previous success nor a stored paid flag renews a lease.
    let pending = billingPending.get(userId);
    if (pending && Date.now() - pending.startedAt >= billingTimeoutMs) {
      // A provider call that never settles must not permanently strand a saved
      // profile. A later poll may attempt fresh verification; its predecessor
      // cannot clear this replacement or contribute a stale authorization.
      billingPending.delete(userId);pending = null;
    }
    if (!pending) {
      pending = { startedAt: Date.now(), promise: Promise.resolve().then(() => billing.status(userId)) };
      billingPending.set(userId, pending);
      pending.promise.finally(() => { if (billingPending.get(userId) === pending) billingPending.delete(userId); }).catch(() => {});
    }
    let status;
    try {
      const remaining = billingTimeoutMs - (Date.now() - pending.startedAt);
      if (remaining <= 0) throw new Error('Stale verification');
      status = await within(pending.promise, Math.max(1, Math.min(timeoutMs, remaining)));
      if (Date.now() - pending.startedAt > billingTimeoutMs) throw new Error('Stale verification');
    }
    catch { throw fault(503, 'VPN membership verification is temporarily unavailable.'); }
    const subscriptions = Array.isArray(status?.subscriptions)
      ? status.subscriptions.filter(item => item.kind === 'vpn_connector' && item.status === 'active') : [];
    const paidThrough = subscriptions.length === 1 ? Number(subscriptions[0].currentPeriodEnd) * 1000 : 0;
    if (status?.vpnConnectorAddon !== true || !Number.isFinite(paidThrough) || paidThrough <= now()) {
      throw fault(403, 'An active, paid UFI Vault membership is required for VPN access.');
    }
    // Trialing subscriptions intentionally do not activate the paid VPN.
    return Math.min(now() + leaseSeconds * 1000, paidThrough);
  }
  async function verifyIdentity(client, owner, identity) {
    if (!identity || identity.id !== owner.id) throw fault(401, 'Sign in again to connect VPN.');
    if (identity.sid !== undefined) {
      if (!UUID.test(String(identity.sid || '')) || !Number.isInteger(identity.ver)
        || identity.ver !== Number(owner.auth_version)) throw fault(401, 'Sign in again to connect VPN.');
      const { rows: [session] } = await client.query(`SELECT expires_at FROM auth_sessions
        WHERE id=$1 AND user_id=$2 AND expires_at>$3 FOR KEY SHARE`, [identity.sid, owner.id, iso(now())]);
      if (!session) throw fault(401, 'Sign in again to connect VPN.');
      return new Date(session.expires_at).getTime();
    }
    if (identity.authProvider !== 'auth0' || owner.auth_provider !== 'auth0'
      || !identity.sub || identity.sub !== owner.auth_subject) throw fault(401, 'Sign in again to connect VPN.');
    return Infinity;
  }
  const launchBody = (body, consume = false) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || !['windows', 'ios', 'android'].includes(body.platform)
      || Object.keys(body).some(key => !(consume ? ['platform', 'code'] : ['platform']).includes(key))
      || (consume && (typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.code)
        || Buffer.from(body.code, 'base64url').toString('base64url') !== body.code))) {
      throw fault(400, 'Choose a supported UFIConnect app and request a new connection.');
    }
  };
  async function launch(userId, body, identity) {
    account(userId); launchBody(body);
    if (!configured.length) throw fault(503, 'UFI VPN gateway setup is pending.');
    const paidUntil = await entitlement(userId);
    return transaction(async client => {
      const { rows: [owner] } = await client.query('SELECT id,vpn_connector_addon,billing_closed,auth_version,auth_provider,auth_subject FROM users WHERE id=$1 FOR UPDATE', [userId]);
      if (!owner || owner.billing_closed || !owner.vpn_connector_addon || paidUntil <= now()) throw fault(403, 'Your paid VPN membership is not active.');
      const sessionUntil = await verifyIdentity(client, owner, identity);
      const expiresAt = iso(Math.min(now() + 180000, paidUntil, sessionUntil));
      const code = randomBytes(32).toString('base64url');
      // Keep cleanup within the locked account; do not take another owner's
      // ticket locks while holding this account/session lock.
      await client.query('DELETE FROM managed_vpn_launches WHERE user_id=$1 AND (expires_at<=$2 OR platform=$3)', [userId, iso(now()), body.platform]);
      await client.query(`INSERT INTO managed_vpn_launches
        (token_hash,user_id,platform,auth_version,initiating_session_id,initiating_auth_subject,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)`, [digest(code).toString('hex'), userId, body.platform,
        Number(owner.auth_version), identity.sid || null, identity.sid ? null : identity.sub, expiresAt]);
      return { url: 'uficonnect-vpn://connect?code=' + code, expiresAt };
    });
  }
  async function consumeLaunch(userId, body, identity) {
    account(userId); launchBody(body, true);
    if (!configured.length) throw fault(503, 'UFI VPN gateway setup is pending.');
    const paidUntil = await entitlement(userId);
    return transaction(async client => {
      const { rows: [owner] } = await client.query('SELECT id,vpn_connector_addon,billing_closed,auth_version,auth_provider,auth_subject FROM users WHERE id=$1 FOR UPDATE', [userId]);
      if (!owner || owner.billing_closed || !owner.vpn_connector_addon || paidUntil <= now()) throw fault(403, 'Your paid VPN membership is not active.');
      await verifyIdentity(client, owner, identity);
      const { rows: [ticket] } = await client.query(`SELECT * FROM managed_vpn_launches
        WHERE token_hash=$1 AND user_id=$2 AND platform=$3 AND expires_at>$4`,
      [digest(body.code).toString('hex'), userId, body.platform, iso(now())]);
      if (!ticket || Number(ticket.auth_version) !== Number(owner.auth_version)) throw fault(409, 'This connection request expired. Select Connect VPN on the website again.');
      if (ticket.initiating_session_id) {
        const { rows: [session] } = await client.query(`SELECT id FROM auth_sessions
          WHERE id=$1 AND user_id=$2 AND expires_at>$3 FOR KEY SHARE`, [ticket.initiating_session_id, userId, iso(now())]);
        if (!session) throw fault(409, 'The browser sign-in ended. Select Connect VPN on the website again.');
      } else if (owner.auth_provider !== 'auth0' || !ticket.initiating_auth_subject
        || ticket.initiating_auth_subject !== owner.auth_subject) {
        throw fault(409, 'The browser account changed. Select Connect VPN on the website again.');
      }
      // Logout locks its session before cascading to launch rows. Acquire that
      // session first too, then lock/recheck the ticket; the opposite order can
      // deadlock a legitimate sign-out against this connection request.
      const { rows: [current] } = await client.query(`SELECT token_hash FROM managed_vpn_launches
        WHERE token_hash=$1 AND user_id=$2 AND platform=$3 AND expires_at>$4 FOR UPDATE`,
      [ticket.token_hash, userId, body.platform, iso(now())]);
      if (!current) throw fault(409, 'This connection request expired. Select Connect VPN on the website again.');
      await client.query('DELETE FROM managed_vpn_launches WHERE token_hash=$1', [ticket.token_hash]);
      return { action: 'connect' };
    });
  }
  function gatewayPublic(gateway) {
    return { id: gateway.id, label: gateway.label, country: gateway.country };
  }
  function configuration(row, gateway) {
    const host = Number(row.tunnel_address.slice(gateway.prefix.length));
    if (!row.tunnel_address.startsWith(gateway.prefix) || !Number.isInteger(host) || host < 2 || host > 254
      || row.tunnel_address !== gateway.prefix + host || !publicKeyValid(row.public_key)) return null;
    return { deviceId: row.id, gatewayId: gateway.id, label: row.label, publicKey: row.public_key,
      addresses: [`${row.tunnel_address}/32`, `${gateway.ipv6Prefix}${host.toString(16)}/128`],
      endpoint: gateway.endpoint, serverPublicKey: gateway.publicKey, dns: [...gateway.dns],
      allowedIPs: ['0.0.0.0/0', '::/0'], persistentKeepalive: 25,
      leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : null,
      ipv6Egress: 'blocked' };
  }
  function config() {
    return { available: configured.length > 0 && !!db?.isConnected?.(), protocol: 'wireguard',
      clientRequired: true, maxDevices, leaseSeconds, trialAccess: false,
      profileImportAvailable: configured.some(gateway => gateway.country === 'DE') && !!db?.isConnected?.(),
      gateways: configured.map(gatewayPublic) };
  }
  function profileConfiguration(row, gateway) {
    const value = configuration(row, gateway);
    if (!value) throw fault(503, 'VPN profile configuration needs review.');
    const { deviceId, leaseExpiresAt, ...fields } = value;
    return { id: deviceId, ...fields, enrollmentMode: 'profile', createdAt: iso(row.created_at) };
  }
  async function list(userId) {
    account(userId);
    const { rows } = await db.query(`SELECT id,gateway_id,label,public_key,tunnel_address,created_at,lease_expires_at
      FROM managed_vpn_devices WHERE user_id=$1 AND enrollment_mode='native' AND revoked_at IS NULL AND lease_expires_at>$2
      ORDER BY created_at,id`, [userId, iso(now())]);
    return { devices: rows.map(row => ({ id: row.id, gatewayId: row.gateway_id, label: row.label, enrollmentMode: 'native',
      publicKey: row.public_key, createdAt: iso(row.created_at),
      leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : null })) };
  }
  async function listProfiles(userId) {
    account(userId);
    const { rows } = await db.query(`SELECT id,gateway_id,label,public_key,created_at
      FROM managed_vpn_devices WHERE user_id=$1 AND enrollment_mode='profile' AND revoked_at IS NULL
      ORDER BY created_at,id`, [userId]);
    // A registration is not evidence of a current connection or paid access.
    // Listing/removal remains available during billing outages and cancellation.
    return { profiles: rows.map(row => ({ id: row.id, gatewayId: row.gateway_id, label: row.label, enrollmentMode: 'profile',
      publicKey: row.public_key, createdAt: iso(row.created_at) })) };
  }
  async function enrollWithMode(userId, body, verifiedIdentity, mode) {
    account(userId);
    if (!configured.length) throw fault(503, 'UFI VPN gateway setup is pending.');
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some(key => !(mode === 'profile' ? ['publicKey', 'label'] : ['publicKey', 'label', 'gatewayId']).includes(key))
      || !publicKeyValid(body.publicKey) || !cleanLabel(body.label)) {
      throw fault(400, 'Provide a device label and a valid WireGuard public key only.');
    }
    const gateway = mode === 'profile' ? configured.find(item => item.country === 'DE')
      : body.gatewayId === undefined ? configured[0] : byId.get(body.gatewayId);
    if (!gateway && mode === 'profile') throw fault(503, 'WireGuard profile setup is temporarily unavailable.');
    if (!gateway) throw fault(400, 'Choose an available VPN gateway.');
    let expiresAt = await entitlement(userId);
    return transaction(async client => {
      const { rows: [owner] } = await client.query('SELECT id,vpn_connector_addon,billing_closed,auth_version,auth_provider,auth_subject FROM users WHERE id=$1 FOR UPDATE', [userId]);
      if (!owner || owner.billing_closed || owner.vpn_connector_addon !== true || expiresAt <= now()) {
        throw fault(403, 'Your paid VPN membership is not active.');
      }
      // Middleware authentication precedes asynchronous billing verification.
      // Recheck the verified identity under the same owner lock used by
      // logout-all/password changes, before creating or extending any peer.
      if (mode === 'profile' || verifiedIdentity !== undefined) {
        const sessionUntil = await verifyIdentity(client, owner, verifiedIdentity);
        // Imported profiles explicitly outlive this browser session. Their
        // registration remains tied to the account's revocation version.
        if (mode === 'native') expiresAt = Math.min(expiresAt, sessionUntil);
      }
      // Serialize public-key ownership and address allocation across API workers.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`vpn-key:${body.publicKey}`]);
      // Acquire the gateway lock before device rows. Expired enrollments can then
      // release slots/addresses without racing another owner's renewal.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`vpn-gateway:${gateway.id}`]);
      await client.query(`UPDATE managed_vpn_devices SET revoked_at=$2
        WHERE gateway_id=$1 AND enrollment_mode='native' AND revoked_at IS NULL
        AND (lease_expires_at IS NULL OR lease_expires_at<=$2)`, [gateway.id, iso(now())]);
      const { rows: [existing] } = await client.query('SELECT * FROM managed_vpn_devices WHERE public_key=$1 FOR UPDATE', [body.publicKey]);
      if (existing && (existing.user_id !== userId || existing.revoked_at || existing.gateway_id !== gateway.id
        || existing.enrollment_mode !== mode
        || (mode === 'profile' && (existing.registration_auth_version === null
          || Number(existing.registration_auth_version) !== Number(owner.auth_version))))) {
        throw fault(409, 'This device key cannot be enrolled. Generate a new key on your device.');
      }
      if (existing) {
        if (mode === 'profile') return { profile: profileConfiguration(existing, gateway), state: 'registered' };
        existing.lease_expires_at = iso(expiresAt);
        await client.query('UPDATE managed_vpn_devices SET lease_expires_at=$2 WHERE id=$1', [existing.id, existing.lease_expires_at]);
        const value = configuration(existing, gateway);
        if (!value) throw fault(503, 'VPN device configuration needs review.');
        return { device: value, state: 'enrolled' };
      }
      const { rows: [count] } = await client.query(`SELECT COUNT(*)::int AS total FROM managed_vpn_devices
        WHERE user_id=$1 AND revoked_at IS NULL AND (enrollment_mode='profile' OR lease_expires_at>$2)`, [userId, iso(now())]);
      if (count.total >= maxDevices) throw fault(409, 'Your VPN device limit is reached. Remove a device before adding another.');
      const { rows: used } = await client.query('SELECT tunnel_address FROM managed_vpn_devices WHERE gateway_id=$1 AND revoked_at IS NULL', [gateway.id]);
      if (used.length >= gateway.maxPeers) throw fault(503, 'This VPN gateway is at capacity. Try another available gateway.');
      const addresses = new Set(used.map(row => row.tunnel_address));
      let address;
      for (let host = 2; host <= 254; host++) {
        if (!addresses.has(gateway.prefix + host)) { address = gateway.prefix + host; break; }
      }
      if (!address) throw fault(503, 'This VPN gateway is at capacity.');
      const { rows: [row] } = await client.query(`INSERT INTO managed_vpn_devices
        (id,user_id,gateway_id,public_key,label,tunnel_address,created_at,lease_expires_at,enrollment_mode,registration_auth_version)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [randomUUID(), userId, gateway.id, body.publicKey, body.label.trim(), address, iso(now()),
        mode === 'profile' ? null : iso(expiresAt), mode, mode === 'profile' ? Number(owner.auth_version) : null]);
      if (mode === 'profile') return { profile: profileConfiguration(row, gateway), state: 'registered' };
      return { device: configuration(row, gateway), state: 'enrolled' };
    });
  }
  const enroll = (userId, body, identity) => enrollWithMode(userId, body, identity, 'native');
  const enrollProfile = (userId, body, identity) => enrollWithMode(userId, body, identity, 'profile');
  async function removeWithMode(userId, deviceId, mode) {
    account(userId);
    if (!UUID.test(String(deviceId || ''))) throw fault(400, 'Choose an enrolled VPN device.');
    const result = await db.query(`UPDATE managed_vpn_devices SET revoked_at=COALESCE(revoked_at,$3),lease_expires_at=$3
      WHERE id=$1 AND user_id=$2 AND enrollment_mode=$4 RETURNING id`, [deviceId, userId, iso(now()), mode]);
    if (!result.rows.length) throw fault(404, 'VPN device not found.');
    return { removed: true };
  }
  const remove = (userId, deviceId) => removeWithMode(userId, deviceId, 'native');
  const removeProfile = (userId, deviceId) => removeWithMode(userId, deviceId, 'profile');
  function authorizeGateway(gatewayId, authorization) {
    const gateway = byId.get(gatewayId);
    const value = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!gateway || !value || value.length > 256 || !timingSafeEqual(digest(value), gateway.tokenHash)) {
      throw fault(401, 'Gateway authentication failed.');
    }
    return gateway;
  }
  async function desired(gatewayId, authorization) {
    const gateway = authorizeGateway(gatewayId, authorization);
    storageReady();
    const generatedAt = now();
    const deadline = Date.now() + reconcileBudgetMs;
    const { rows } = await db.query(`SELECT d.id,d.user_id,d.public_key,d.label,d.tunnel_address,d.lease_expires_at,d.enrollment_mode
      FROM managed_vpn_devices d JOIN users u ON u.id=d.user_id
      WHERE d.gateway_id=$1 AND d.revoked_at IS NULL AND u.billing_closed=false
        AND ((d.enrollment_mode='native' AND d.lease_expires_at>$3 AND u.vpn_connector_addon=true)
          OR (d.enrollment_mode='profile' AND d.registration_auth_version=u.auth_version))
      ORDER BY d.created_at,d.id LIMIT $2`, [gateway.id, gateway.maxPeers, iso(now())]);
    const users = [...new Set(rows.map(row => row.user_id))];
    const verified = new Map();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, users.length) }, async () => {
      while (next < users.length && Date.now() < deadline) {
        const userId = users[next++];
        try { verified.set(userId, await entitlement(userId, Math.min(billingTimeoutMs, deadline - Date.now()))); }
        catch { /* Unpaid, expired, or unverifiable owners receive no peers. */ }
      }
    }));
    const expiresAt = generatedAt + leaseSeconds * 1000;
    const peers = await transaction(async client => {
      // Re-read ownership, revocations and paid flags after Stripe requests.
      // Deletion/cancellation cannot be resurrected by an older device snapshot.
      // Lock owners before devices, matching enrollment/account deletion, so
      // a concurrent poll cannot deadlock an enrollment of the same device.
      const verifiedOwners = [...verified.keys()].sort();
      await client.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [verifiedOwners]);
      const { rows: current } = await client.query(`SELECT d.id,d.user_id,d.public_key,d.label,d.tunnel_address,d.lease_expires_at,d.enrollment_mode
        FROM managed_vpn_devices d JOIN users u ON u.id=d.user_id
        WHERE d.gateway_id=$1 AND d.revoked_at IS NULL AND d.user_id=ANY($4::uuid[])
          AND ((d.enrollment_mode='native' AND d.lease_expires_at>$3)
            OR (d.enrollment_mode='profile' AND d.registration_auth_version=u.auth_version))
          AND u.vpn_connector_addon=true AND u.billing_closed=false
        ORDER BY d.created_at,d.id LIMIT $2 FOR UPDATE OF d`, [gateway.id, gateway.maxPeers, iso(now()), verifiedOwners]);
      const result = [];
      for (const row of current) {
        // Native leases still require the authenticated client to renew.
        // A saved profile is an explicit durable registration, but it grants
        // no traffic access without fresh payment and account verification.
        const clientEnd = row.enrollment_mode === 'profile' ? Infinity : new Date(row.lease_expires_at).getTime();
        const leaseEnd = Math.min(verified.get(row.user_id) || 0, expiresAt, clientEnd);
        const value = configuration(row, gateway);
        if (leaseEnd <= now() || !value) continue;
        result.push({ deviceId: row.id, publicKey: row.public_key, allowedIPs: value.addresses, expiresAt: iso(leaseEnd) });
      }
      return result;
    });
    return { version: 1, gatewayId: gateway.id, generatedAt: iso(generatedAt), expiresAt: iso(expiresAt), peers };
  }
  return { config, list, enroll, remove, listProfiles, enrollProfile, removeProfile, desired, launch, consumeLaunch,
    authenticateGateway: (gatewayId, authorization) => authorizeGateway(gatewayId, authorization).id };
}

function gatewayRateLimitKey(req) {
  if (!ID.test(req.vpnGatewayId || '')) throw fault(401, 'Gateway authentication failed.');
  return req.vpnGatewayId;
}

function isAuthenticatedGatewayPoll(req, vpn) {
  // Subscribers and the polling agent share the gateway's public egress IP.
  // Only verified polling may bypass an earlier general IP abuse bucket.
  if (req.method !== 'GET') return false;
  const match = /^\/vpn\/gateways\/([^/]+)\/desired\/?$/i.exec(req.path || '');
  if (!match) return false;
  try { return Boolean(vpn.authenticateGateway(decodeURIComponent(match[1]), req.get('authorization'))); }
  catch { return false; }
}

function registerManagedVpnRoutes(app, { vpn, authenticate, limiter, gatewayLimiter }) {
  const failure = (res, error) => {
    const expected = [400, 401, 403, 404, 409, 503].includes(error.status);
    res.status(expected ? error.status : 503).json({ message: expected ? error.message : 'VPN service is temporarily unavailable.' });
  };
  const respond = work => async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try { res.json(await work(req)); }
    catch (error) { failure(res, error); }
  };
  const authenticateGateway = (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try { req.vpnGatewayId = vpn.authenticateGateway(req.params.id, req.get('authorization')); next(); }
    catch (error) { failure(res, error); }
  };
  const member = [authenticate, ...(limiter ? [limiter] : [])];
  app.get('/vpn/config', ...member, respond(() => vpn.config()));
  app.post('/vpn/launch', ...member, respond(req => vpn.launch(req.user.id, req.body, req.user || null)));
  app.post('/vpn/launch/consume', ...member, respond(req => vpn.consumeLaunch(req.user.id, req.body, req.user || null)));
  app.get('/vpn/devices', ...member, respond(req => vpn.list(req.user.id)));
  app.post('/vpn/devices', ...member, respond(req => vpn.enroll(req.user.id, req.body, req.user || null)));
  app.delete('/vpn/devices/:id', ...member, respond(req => vpn.remove(req.user.id, req.params.id)));
  app.get('/vpn/profiles', ...member, respond(req => vpn.listProfiles(req.user.id)));
  app.post('/vpn/profiles', ...member, respond(req => vpn.enrollProfile(req.user.id, req.body, req.user || null)));
  app.delete('/vpn/profiles/:id', ...member, respond(req => vpn.removeProfile(req.user.id, req.params.id)));
  app.get('/vpn/gateways/:id/desired', authenticateGateway, ...(gatewayLimiter ? [gatewayLimiter] : []), respond(req => vpn.desired(req.vpnGatewayId, req.get('authorization'))));
}

module.exports = { createManagedVpn, registerManagedVpnRoutes, MANAGED_VPN_SCHEMA, publicKeyValid,
  gatewayRateLimitKey, isAuthenticatedGatewayPoll };
