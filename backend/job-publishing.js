'use strict';

const { createHash } = require('node:crypto');

const fail = (status, message) => Object.assign(new Error(message), { status, safeJobPublishing: true });
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const object = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function canonical(value, depth = 0) {
  if (depth > 5) throw fail(400, 'Publishing options are too deeply nested.');
  if (typeof value === 'string') {
    if (value.length > 4000) throw fail(400, 'A publishing option is too long.');
    return value.trim();
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 50) throw fail(400, 'Too many publishing options.');
    return value.map(item => canonical(item, depth + 1));
  }
  if (!object(value) || Object.keys(value).length > 40) throw fail(400, 'Use valid publishing options.');
  const result = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    if (forbidden.has(key) || key.length > 80) throw fail(400, 'Use valid publishing option names.');
    result[key] = canonical(value[key], depth + 1);
  }
  return result;
}

function normalizeJobPublishing(input = {}) {
  const requested = input.targets === undefined ? [] : input.targets;
  if (!Array.isArray(requested) || requested.length > 33) throw fail(400, 'Choose up to 32 other publishing sources.');
  const targets = ['uficonnect'];
  for (const raw of requested) {
    if (typeof raw !== 'string') throw fail(400, 'Choose valid publishing sources.');
    const target = raw.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{0,79}$/.test(target) || forbidden.has(target)) throw fail(400, 'Choose valid publishing sources.');
    if (!targets.includes(target)) targets.push(target);
  }
  const supplied = input.publisherSettings === undefined ? {} : input.publisherSettings;
  if (!object(supplied) || Object.keys(supplied).some(key => forbidden.has(key))) throw fail(400, 'Use valid publishing options.');
  const publisherSettings = Object.create(null);
  for (const target of targets.filter(key => key !== 'uficonnect').sort()) {
    if (!Object.hasOwn(supplied, target)) continue;
    if (!object(supplied[target])) throw fail(400, 'Use valid source publishing options.');
    const settings = canonical(supplied[target]);
    if (Object.keys(settings).length) publisherSettings[target] = settings;
  }
  if (JSON.stringify(publisherSettings).length > 32000) throw fail(400, 'Publishing options are too large.');
  return { targets, publisherSettings };
}

function authorizationIdentity(platform, token) {
  let session = token;
  if (typeof token === 'string' && token.trim().startsWith('{')) {
    try { session = JSON.parse(token); } catch { session = null; }
  }
  let actor = null;
  if (object(session)) {
    if (platform === 'mastodon' && session.origin && session.accountId) actor = ['mastodon', session.origin, String(session.accountId)];
    if (platform === 'bluesky' && session.did) actor = ['bluesky', session.did];
    if (platform === 'discord' && session.webhook?.id && session.webhook.channel_id && session.webhook.guild_id) actor = ['discord', String(session.webhook.id), String(session.webhook.channel_id), String(session.webhook.guild_id)];
  }
  return createHash('sha256').update(JSON.stringify(actor || [platform, token ?? null])).digest('hex');
}

function snapshotJobAuthorization(user, targets) {
  // Capture primitives before publication awaits. Actor IDs survive ordinary
  // token renewal; opaque tokens use an in-memory digest as a safe fallback.
  // Neither this snapshot nor its hashes are saved in a post or fingerprint.
  return Object.fromEntries(targets.filter(key => key !== 'uficonnect').map(key => [key, authorizationIdentity(key, user.socialTokens?.[key])]));
}

// Jobs reuses the existing provider adapters. This policy keeps their account,
// plan and text requirements at the server boundary as well as in the chooser.
function createJobPublishing({ getUser, known, ready, capability, publishTarget, label = key => key }) {
  function validate(user, { targets = [], content = '', mediaUrl = null } = {}) {
    for (const platform of targets) {
      if (!known(platform)) throw fail(400, 'Choose a supported publishing source.');
      if (user?.plan === 'business' ? platform !== 'linkedin' : user?.plan !== 'pro') {
        throw fail(403, user?.plan === 'business' ? 'Business job sharing supports LinkedIn.' : 'Sharing jobs to connected sources requires Pro.');
      }
      const cap = capability(platform);
      if (!cap?.supported || !ready(platform)) throw fail(403, `${label(platform)} publishing is currently unavailable.`);
      if (mediaUrl || cap.requiresPhoto || cap.requiresVideo || cap.allowedMedia && !cap.allowedMedia.includes('text')) {
        throw fail(400, 'Choose a source that supports the complete job as a text post.');
      }
      if (!Object.hasOwn(user.socialTokens || {}, platform) || !user.socialTokens[platform]) throw fail(409, `Connect ${label(platform)} before sharing this job.`);
      const limit = ({ twitter: 280, bluesky: 300, threads: 500, linkedin: 3000, twitch: 500 })[platform] || 4000;
      if (content.length > limit) throw fail(400, `Shorten this job to ${limit.toLocaleString()} characters for ${label(platform)}, or deselect that source.`);
    }
  }
  async function publish(user, platform, payload) {
    // A disconnect, account replacement or downgrade while native publication
    // was in progress must not send with the previously captured credentials.
    const current = await getUser(user.id);
    if (!current) throw fail(403, 'The account is no longer available for sharing.');
    validate(current, { targets: [platform], content: payload.content, mediaUrl: payload.mediaUrl });
    const { authorizationIdentity: expected, ...providerPayload } = payload;
    if (typeof expected !== 'string' || authorizationIdentity(platform, current.socialTokens[platform]) !== expected) throw fail(409, 'The connected account changed while this job was publishing. Review that source before sharing again.');
    // Legacy refresh retries can reload a newly replaced opaque connection.
    // Jobs reports that refusal for review instead of changing credentials.
    return publishTarget(current, platform, { ...providerPayload, allowTokenRefresh: false });
  }
  return { validate, publish };
}

module.exports = { normalizeJobPublishing, snapshotJobAuthorization, createJobPublishing };
