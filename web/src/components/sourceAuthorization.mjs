export function sourceAuthorizationState(platform, { isConnected = false } = {}) {
  if (!platform || platform.configured !== true || platform.forceComingSoon === true || platform.authorizationAvailable === false) {
    return { ready: false, reason: 'Sign-in is locked until this connection is set up.', status: 'setup_required' };
  }
  if (platform.connectionMode === 'external' || platform.authorizationSupported === false) {
    return { ready: false, reason: 'Account linking is not available for this provider.', status: 'unsupported' };
  }
  if (platform.locked && !isConnected) {
    return { ready: false, reason: 'An active membership is required to connect this account.', status: 'membership_required' };
  }
  return { ready: true, reason: '', status: 'ready' };
}
