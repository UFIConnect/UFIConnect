import { SOURCE_META, unavailableFeedSourceIds } from './sourceMeta';
import { sourceCategory } from './sourceDirectory';
import SourceButton from './SourceButton';
import ExternalAccountLogin from './ExternalAccountLogin';
import { sourceAuthorizationState } from './sourceAuthorization.mjs';
import { sourceConnectionPath } from './sourceConnectionPath.mjs';
import { nativeExternalOpen } from '../nativeRuntime.mjs';
import './source-directory.css';

export default function UnavailableFeedSources({ mode = 'feed', category = 'all', plan, includeWebsites = true, platforms = {}, connected = {} }) {
  const reason = mode === 'following' ? 'Following unavailable' : 'Public feed unavailable';
  const sources = unavailableFeedSourceIds(mode, { includeWebsites, careerOnly: plan === 'business' })
    .filter(source => category === 'all' || sourceCategory(source) === category)
    .sort((a, b) => (SOURCE_META[a]?.label || a).localeCompare(SOURCE_META[b]?.label || b));
  if (!sources.length) return null;
  return <section className="feed-unavailable-sources" aria-label={reason}>
    <h4 className="source-directory-heading">{reason}</h4>
    <p>{mode === 'following'
      ? 'These sources do not provide a connected Following feed in UFIConnect.'
      : 'These sources do not provide a public Home feed in UFIConnect.'}</p>
    <ul>
      {sources.map(source => {
        const authorization = sourceAuthorizationState(platforms[source]);
        const action = connected[source] ? 'Manage' : 'Connect';
        const name = SOURCE_META[source]?.label || source;
        return <li key={source} style={{ flexWrap: 'wrap' }}>
        <SourceButton source={source} locked={!authorization.ready} reason={authorization.ready ? `${reason}. ${action} this account for its supported features.` : reason}
          style={{ maxWidth: '100%' }} aria-label={authorization.ready ? `${action} ${name} account` : undefined}
          onClick={() => nativeExternalOpen(connected[source] ? platforms[source]?.commandCenterOnly ? '/command-center?tab=accounts' : `/connected-accounts?source=${encodeURIComponent(source)}` : sourceConnectionPath(source))}>
          {authorization.ready && <span>{action}</span>}
        </SourceButton>
        {includeWebsites && <ExternalAccountLogin platform={source} />}
      </li>;})}
    </ul>
  </section>;
}
