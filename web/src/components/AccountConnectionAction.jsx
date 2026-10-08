import ExternalAccountLogin from './ExternalAccountLogin';
import { Lock } from 'lucide-react';
import { sourceAuthorizationState } from './sourceAuthorization.mjs';

// Catalog readiness controls account authorization. Website visits remain a
// separate action with a label that describes where the link goes.
export default function AccountConnectionAction({
  platformKey, platform, onConnect, connecting = false, disabled = false,
  isConnected = false, className = 'btn btn-outline btn-sm', compact = false,
}) {
  const state = sourceAuthorizationState(platform, { isConnected });
  const inactive = disabled || connecting || !state.ready;
  return <>
    <button type="button" className={className} onClick={inactive ? undefined : onConnect}
      disabled={inactive} aria-label={`Sign in and connect ${platform?.name || platformKey}`} title={state.reason || undefined}>
      {!state.ready ? <><Lock size={13} aria-hidden="true" /> {compact ? 'Locked' : 'Sign in & connect · Locked'}</>
        : connecting ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> Opening…</> : 'Sign in & connect'}
    </button>
    {platform?.connectionMode === 'external' && <ExternalAccountLogin platform={platformKey} className={className} compact={compact} />}
  </>;
}
