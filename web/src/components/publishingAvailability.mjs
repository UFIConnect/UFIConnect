import { sourceAuthorizationState } from './sourceAuthorization.mjs';

export function publishingUnavailableReason(platform, { connected = false, plan, media } = {}) {
  const authorization = sourceAuthorizationState(platform, { isConnected: connected });
  if (!authorization.ready) return authorization.reason;
  if (!connected) return 'Connect this account to publish.';
  const capability = platform?.crossPost;
  if (platform.reconnectRequired || capability?.reconnectRequired) return capability?.reconnectMessage || platform.reconnectMessage || 'Reconnect to renew publishing permission.';
  if (!capability?.supported) return capability?.note || 'Direct publishing is unavailable for this source.';
  if (platform.locked || plan !== 'pro') return 'Publishing to connected accounts requires Pro.';
  if (capability.requiresPhoto && media?.type !== 'image') return 'Add a photo to publish to this account.';
  if (media?.type === 'video' && capability.media !== 'link') return 'This account does not support this video attachment.';
  return '';
}

export function publishingResults(platforms, targets = []) {
  return platforms.map(platform => targets.find(target => target.platform === platform) || {
    platform, status: 'failed', error: 'Publication could not be confirmed. Check Cross-Post history before retrying.',
  });
}

export function wasPublishingSubmitted(target) {
  return ['posted', 'handoff', 'processing'].includes(target?.status);
}
