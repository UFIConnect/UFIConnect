import { sourceAuthorizationState } from './sourceAuthorization.mjs';

export function followingSourceAccess(platform, { connected = false } = {}) {
  if (connected) return { requiresConnection: false, locked: false, reason: '' };
  const authorization = sourceAuthorizationState(platform);
  return {
    requiresConnection: true,
    locked: !authorization.ready,
    reason: authorization.ready ? 'Opens account setup for this Following feed.' : 'Account setup is unavailable for this source.',
  };
}
