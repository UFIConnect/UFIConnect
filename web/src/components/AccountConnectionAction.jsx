import { AccountSiteLink } from './DirectoryControls';
import { sourceAuthorizationState } from './sourceAuthorization.mjs';
import SourceButton from './SourceButton';

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
    <SourceButton source={platformKey} label={platform?.name || platformKey}
      connected={isConnected} locked={!state.ready} reason={state.ready ? label : state.reason}
      className="account-source-button" markClassName="account-action-icon" statusClassName="account-action-lock" onClick={inactive ? undefined : onConnect}
      disabled={disabled || connecting} aria-label={label} aria-busy={connecting}>
      {connecting && <span className="spinner account-action-spinner" aria-hidden="true" />}
    </SourceButton>
    <AccountSiteLink platform={platformKey} name={platform?.name} siteUrl={platform?.siteUrl} className="account-connection-site-link"
      label={platform?.connectionMode === 'external' ? `Visit ${platform?.name || platformKey} website` : undefined} />
  </>;
}
