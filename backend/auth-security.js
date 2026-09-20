'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { passwordBlocklistError } = require('./password-blocklist');

// A revocable browser session should survive normal reloads and browser
// restarts. The token remains server-backed, expires after 30 days, and is
// invalidated immediately by password changes or "sign out all sessions".
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const JWT_ISSUER = 'uficonnect';
const JWT_AUDIENCE = 'uficonnect-api';

function resolveJwtSecret(env = process.env) {
  const value = env.JWT_SECRET || '';
  if (env.NODE_ENV === 'production' && (Buffer.byteLength(value) < 32 || /dev-secret|replace-with|change.?me|example|your-secret/i.test(value))) {
    throw new Error('Production requires a unique JWT_SECRET with at least 32 bytes.');
  }
  return value || crypto.randomBytes(48).toString('base64url');
}

function passwordPolicyError(value) {
  if (typeof value !== 'string') return 'Enter a password.';
  if ([...value].length < 15) return 'Use at least 15 characters for your password.';
  if (Buffer.byteLength(value, 'utf8') > 72) return 'Password must be at most 72 UTF-8 bytes. Use fewer characters.';
  return passwordBlocklistError(value);
}

function signSecurityToken(payload, secret, expiresIn) {
  return jwt.sign(payload, secret, { algorithm: 'HS256', issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn });
}

function verifySecurityToken(token, secret, purpose) {
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
  if (payload.purpose !== purpose || typeof payload.id !== 'string' || !Number.isSafeInteger(payload.ver) || payload.ver < 0 || !Number.isInteger(payload.exp)) {
    throw new Error('Invalid token purpose or claims.');
  }
  if (purpose === 'session' && typeof payload.sid !== 'string') throw new Error('Missing session identifier.');
  return payload;
}

// Account preferences can contain location, notifications, and private drafts.
// Only these presentation values may appear on another member's profile.
function publicRoleSettings(settings = {}) {
  const flags = ['openToWork', 'openToFunding', 'openToDeals', 'openToCollabs', 'openToCollab'];
  const fields = ['primaryStack', 'preferredRole', 'yearsExp', 'designTools', 'specialization', 'portfolioUrl',
    'domain', 'methodology', 'teamSize', 'channels', 'tools', 'industryFocus', 'companyName', 'stage', 'lookingFor',
    'checkSize', 'stagePreference', 'sectors', 'school', 'targetRole', 'currentlyLearning', 'dealType', 'platforms',
    'niche', 'audienceSize', 'communitySize', 'institution', 'field', 'output', 'companySize'];
  return Object.fromEntries([
    ...flags.filter(key => typeof settings[key] === 'boolean').map(key => [key, settings[key]]),
    ...fields.filter(key => typeof settings[key] === 'string').map(key => [key, settings[key].slice(0, 500)]),
  ]);
}

module.exports = { SESSION_TTL_SECONDS, resolveJwtSecret, passwordPolicyError, signSecurityToken, verifySecurityToken, publicRoleSettings };
