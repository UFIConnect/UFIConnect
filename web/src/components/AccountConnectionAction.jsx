import ExternalAccountLogin from './ExternalAccountLogin';

// OAuth already includes the provider's sign-in screen. Website-only accounts
// keep their official sign-in link without inventing a UFIConnect authorization.
export default function AccountConnectionAction({
  platformKey, platform, onConnect, connecting = false, disabled = false,
  isConnected = false, className = 'btn btn-outline btn-sm', compact = false,
}) {
  if (platform.connectionMode === 'external') {
    return <ExternalAccountLogin platform={platformKey} className={className} compact={compact} />;
  }
  const unavailable = !platform.configured || platform.forceComingSoon;
  const membershipRequired = platform.locked && !isConnected;
  const reason = unavailable
    ? 'Review this provider’s authorization options in its account details.'
    : membershipRequired ? 'An active membership is required to authorize this account.' : undefined;
  return <button type="button" className={className} onClick={onConnect}
    disabled={disabled || connecting || unavailable || membershipRequired}
    aria-label={`Sign in and connect ${platform.name}`} title={reason}>
    {connecting ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> Opening…</> : 'Sign in & connect'}
  </button>;
}
