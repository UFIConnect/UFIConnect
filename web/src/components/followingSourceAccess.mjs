import { sourceAuthorizationState } from './sourceAuthorization.mjs';

export function followingSourceAccess(platform, { connected = false } = {}) {
  if (connected) return { requiresConnection: false, locked: false, reason: '' };
  const authorization = sourceAuthorizationState(platform);
  return {
    requiresConnection: true,
    locked: !authorization.ready,
    reason: authorization.ready ? 'Connect this source to use its Following feed.' : authorization.reason,
  };
}
