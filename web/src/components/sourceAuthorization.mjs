export function sourceAuthorizationState(platform) {
  if (!platform || platform.configured !== true || platform.forceComingSoon === true || platform.authorizationAvailable === false || platform.canStartAuthorization === false) {
    return { ready: false, reason: 'Sign-in is locked until this connection is set up.', status: 'setup_required' };
  }
  if (platform.connectionMode === 'external' || platform.authorizationSupported === false) {
    return { ready: false, reason: 'Account linking is not available for this provider.', status: 'unsupported' };
  }
  // Membership limits apply to individual features, not account authorization.
  return { ready: true, reason: '', status: 'ready' };
}
