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

module.exports = { sessionCookieName, createSessionCookie, readSessionCookie, isPrivateRequest,
  privateConnectionResponse, webConnectionStatus };
