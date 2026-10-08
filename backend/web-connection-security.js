'use strict';

const LEGACY_COOKIE = 'ufi_session';
const PRODUCTION_COOKIE = '__Host-ufi_session';
const PRIVATE_PATH = /^\/(?:auth|profile|messages|connected-inbox|security|media)(?:\/|$)/;

function sessionCookieName(env = process.env) {
  return env.NODE_ENV === 'production' ? PRODUCTION_COOKIE : LEGACY_COOKIE;
}

function createSessionCookie(token, maxAge, env = process.env) {
  const parts = [`${sessionCookieName(env)}=${encodeURIComponent(token || '')}`, 'Path=/', 'HttpOnly',
    'SameSite=Lax', `Max-Age=${Math.max(0, Math.floor(maxAge))}`];
  if (env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

function readSessionCookie(req, env = process.env) {
  const name = sessionCookieName(env);
  const pairs = String(req.headers.cookie || '').split(';').map(value => value.trim())
    .filter(value => value.startsWith(name + '='));
  // A browser session has exactly one host cookie. Reject ambiguous values
  // instead of letting their order choose the account identity.
  if (pairs.length !== 1) return null;
  try {
    const token = decodeURIComponent(pairs[0].slice(name.length + 1));
    return token && !/\s/.test(token) && token.length <= 8192 ? token : null;
  } catch { return null; }
}

function isPrivateRequest(req) {
  return Boolean(req.headers.authorization || PRIVATE_PATH.test(req.path)
    || /(?:^|;\s*)(?:__Host-)?ufi_session=/.test(String(req.headers.cookie || '')));
}

function privateConnectionResponse(req, res, next) {
  if (isPrivateRequest(req)) {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.vary('Cookie');
    res.vary('Authorization');
  }
  next();
}

function webConnectionStatus(req, now = Date.now()) {
  const encrypted = req.secure === true;
  return { scope: 'uficonnect-web', transport: { encrypted, protocol: encrypted ? 'https' : 'http' },
    session: { verified: Boolean(req.user?.id) },
    protections: { revocableSession: true, privateResponses: true, privateMessages: true, validatedImports: true },
    checkedAt: new Date(now).toISOString() };
}

function hasPaidVaultSubscription(status, now = Date.now()) {
  if (status?.vpnConnectorAddon !== true) return false;
  const active = Array.isArray(status.subscriptions)
    ? status.subscriptions.filter(subscription => subscription?.kind === 'vpn_connector' && subscription?.status === 'active') : [];
  const paidUntil = active.length === 1 ? Number(active[0].currentPeriodEnd) * 1000 : 0;
  return Number.isFinite(paidUntil) && paidUntil > now;
}

function createVaultConnectionHandler({ readBillingStatus, authenticate, now = Date.now }) {
  return async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const accountId = req.user?.id;
    if (!accountId) return res.status(401).json({ message: 'Sign in to check Vault connection monitoring.' });
    const denied = () => res.status(403).json({ message: 'An active, paid UFI Vault membership is required for connection monitoring.' });
    try {
      // The authenticated owner is the only billing lookup key. No previous
      // success, profile flag or caller-supplied account can grant access.
      const billing = await readBillingStatus(accountId);
      if (!hasPaidVaultSubscription(billing, now())) return denied();
      // Billing involves external I/O. Resolve the current session again so
      // a sign-out or account change during verification cannot return success.
      return await authenticate(req, res, () => {
        if (req.user?.id !== accountId) return res.status(401).json({ message: 'Sign in again to check Vault connection monitoring.' });
        if (!hasPaidVaultSubscription(billing, now())) return denied();
        return res.json(webConnectionStatus(req, now()));
      });
    } catch {
      if (!res.headersSent) return res.status(503).json({ message: 'Vault connection monitoring is temporarily unavailable. Please try again.' });
    }
  };
}

module.exports = { sessionCookieName, createSessionCookie, readSessionCookie, isPrivateRequest,
  privateConnectionResponse, webConnectionStatus, hasPaidVaultSubscription, createVaultConnectionHandler };
