import { ACCOUNT_PROVIDER_SITES } from '../shared/accountWebsiteUrls.js';

export function normalizeConnectedAccounts(data, { business = false, directory = {} } = {}) {
  const entries = Array.isArray(data?.platforms)
    ? data.platforms.map(platform => [platform?.id, platform])
    : Object.entries(data?.platforms || {});
  const hasConnectionMap = data?.connected && typeof data.connected === 'object' && !Array.isArray(data.connected);
  return entries.filter(([key, platform]) => /^[a-z][a-z0-9_-]{0,79}$/.test(key || '') && platform && typeof platform === 'object')
    .map(([id, platform]) => [id, { ...directory[id], ...platform, id,
      name: platform.name || directory[id]?.name || id,
      configured: platform.configured === true,
      connected: hasConnectionMap ? data.connected[id] === true : platform.connected === true,
    }])
    .filter(([id, platform]) => business || data?.careerOnly === true
      ? id === 'linkedin' || platform.category === 'career'
      : !platform.commandCenterOnly);
}

export function nativeAccountReadiness(platform) {
  if (!platform || platform.configured !== true || platform.forceComingSoon === true || platform.authorizationAvailable === false) return { ready: false, reason: 'Sign-in is locked until this connection is set up.' };
  if (platform.connectionMode === 'external' || platform.authorizationSupported === false) return { ready: false, reason: 'Account linking is not available for this provider.' };
  if (platform.locked && platform.connected !== true) return { ready: false, reason: 'An active membership is required to connect this account.' };
  return { ready: true, reason: 'Finish authorization on uficonnect.org.' };
}

export function nativeAccountWebsite(platform) {
  let candidate = ACCOUNT_PROVIDER_SITES[platform?.id] || platform?.siteUrl;
  if (platform?.id === 'mastodon' && platform.siteUrl) {
    try { const url = new URL(platform.siteUrl); if (url.protocol === 'https:' && !url.username && !url.password) candidate = url.origin; } catch { /* Use the official server directory. */ }
  }
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
