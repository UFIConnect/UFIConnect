import { sourceAuthorizationState } from './sourceAuthorization.mjs';

function publishingReconnectRequired(platform) {
  // A source can need extra permissions for other services while its existing
  // publishing grant remains valid. The publishing-specific receipt wins.
  return typeof platform?.crossPost?.reconnectRequired === 'boolean'
    ? platform.crossPost.reconnectRequired : Boolean(platform?.reconnectRequired);
}

export function publishingUnavailableReason(platform, { connected = false, plan, media } = {}) {
  const authorization = sourceAuthorizationState(platform, { isConnected: connected });
  if (!authorization.ready) return authorization.reason;
  const capability = platform?.crossPost;
  if (!capability?.supported) return capability?.note || 'Direct publishing is unavailable for this source.';
  if (!connected) return 'Connect this account to publish.';
  if (publishingReconnectRequired(platform)) return capability?.reconnectMessage || platform.reconnectMessage || 'Reconnect to renew publishing permission.';
  if (plan !== 'pro') return 'Publishing to connected accounts requires Pro.';
  if (capability.requiresPhoto && media?.type !== 'image') return 'Add a photo to publish to this account.';
  if (capability.requiresVideo && media?.type !== 'video') return 'Add a video to publish to this account.';
  if (capability.allowedMedia && !capability.allowedMedia.includes(media?.type || 'text')) return `This account does not support this ${media?.type || 'text'} attachment.`;
  if (media?.type === 'video' && !capability.allowedMedia && !['link', 'video'].includes(capability.media)) return 'This account does not support this video attachment.';
  if (capability.maxVideoBytes && media?.type === 'video' && media.size > capability.maxVideoBytes) return `Choose a video smaller than ${Math.floor(capability.maxVideoBytes / 1024 / 1024)} MB.`;
  return '';
}

// Configuration determines whether a source can be used. Media, account
// consent and publishing settings determine when a selected draft can be sent.
export function publishingDestinationState(platform, { connected = false, plan, media, reconnectRequired = false } = {}) {
  const authorization = sourceAuthorizationState(platform, { isConnected: connected });
  const supported = platform?.crossPost?.supported === true;
  const reconnect = Boolean(reconnectRequired || publishingReconnectRequired(platform));
  const available = authorization.ready;
  return {
    available,
    selectable: available && connected && supported && !reconnect,
    action: !available ? 'unavailable' : !supported ? 'manage' : !connected ? 'connect' : reconnect ? 'reconnect' : 'select',
    reason: available && connected && supported && reconnectRequired ? 'Connect this account again to restore publishing permission.' : publishingUnavailableReason(platform, { connected, plan, media }),
  };
}

export function publishingResults(platforms, targets = []) {
  return platforms.map(platform => targets.find(target => target.platform === platform) || {
    platform, status: 'failed', deliveryUncertain: true, error: 'Publication could not be confirmed. Check Cross-Post history before retrying.',
  });
}

export function wasPublishingSubmitted(target) {
  return ['posted', 'handoff', 'processing'].includes(target?.status);
}
