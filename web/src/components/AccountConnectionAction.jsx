import ExternalAccountLogin from './ExternalAccountLogin';
import { Lock } from 'lucide-react';
import { sourceAuthorizationState } from './sourceAuthorization.mjs';
import AccountActionIcon from './AccountActionIcon';

// Catalog readiness controls account authorization. Website visits remain a
// separate action with a label that describes where the link goes.
export default function AccountConnectionAction({
  platformKey, platform, onConnect, connecting = false, disabled = false,
  isConnected = false, className = 'btn btn-outline btn-sm', compact = false,
}) {
  const state = sourceAuthorizationState(platform, { isConnected });
  const inactive = disabled || connecting || !state.ready;
  const label = `Sign in and connect ${platform?.name || platformKey}`;
  return <>
    <button type="button" className={`${className} account-icon-action`} style={{ position: 'relative' }} onClick={inactive ? undefined : onConnect}
      disabled={inactive} aria-label={label} aria-busy={connecting} title={state.ready ? label : `${label}. Locked. ${state.reason}`}>
      <AccountActionIcon platform={platformKey} busy={connecting && state.ready} />
      {!state.ready && <span className="account-action-lock" aria-hidden="true" style={{ position: 'absolute', right: 3, bottom: 3, display: 'flex', padding: 1, borderRadius: 3, background: 'var(--card)', color: 'var(--text)' }}><Lock size={12} strokeWidth={2.5} /></span>}
    </button>
    {platform?.connectionMode === 'external' && <ExternalAccountLogin platform={platformKey} className={className} compact={compact} />}
  </>;
}
