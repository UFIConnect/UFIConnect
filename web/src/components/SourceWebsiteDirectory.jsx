import { useMemo, useState } from 'react';
import ACCOUNT_DIRECTORY from '../../../backend/account-directory.json';
import { HOME_FEED_SOURCE_IDS, FOLLOWING_FEED_SOURCE_IDS } from './sourceMeta';
import { ACCOUNT_CATEGORIES, accountCategory, accountSections } from './sourceDirectory';
import ExternalAccountLogin from './ExternalAccountLogin';
import { DirectoryControls } from './DirectoryControls';
import SourceButton from './SourceButton';
import { sourceAuthorizationState } from './sourceAuthorization.mjs';
import { sourceConnectionPath } from './sourceConnectionPath.mjs';
import { nativeExternalOpen } from '../nativeRuntime.mjs';

export default function SourceWebsiteDirectory({ plan, mode = 'feed', platforms = {}, connected = {} }) {
  const [category, setCategory] = useState(plan === 'business' ? 'career' : 'publishing');
  const entries = useMemo(() => {
    const supported = new Set(mode === 'following' ? FOLLOWING_FEED_SOURCE_IDS : HOME_FEED_SOURCE_IDS);
    return Object.entries(ACCOUNT_DIRECTORY).filter(([key, entry]) => !supported.has(key)
      && (plan !== 'business' || entry.category === 'career'));
  }, [plan, mode]);
  const reason = mode === 'following' ? 'Following unavailable' : 'Public feed unavailable';
  const categories = ACCOUNT_CATEGORIES.filter(([id]) => entries.some(([key, entry]) => accountCategory(key, entry) === id));
  const selected = categories.some(([id]) => id === category) ? category : categories[0]?.[0];
  const visible = accountSections(entries).find(section => section.id === selected)?.items || [];
  if (!entries.length) return null;
  return <section className="feed-source-websites" aria-label="Source websites" style={{ gridColumn: '1 / -1', minWidth: 0, borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
    <h4 style={{ margin: '0 0 6px' }}>Source websites</h4>
    <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: '0 0 8px' }}>{reason}. Read or listen on the source website.</p>
    <DirectoryControls label="source websites" filter={selected} onFilterChange={setCategory} options={categories} />
    <ul className="feed-source-website-list">
      {visible.map(([key, entry]) => {
        const authorization = sourceAuthorizationState(platforms[key]);
        const action = connected[key] ? 'Manage' : 'Connect';
        return <li key={key} style={{ flexWrap: 'wrap' }}>
        <SourceButton source={key} label={entry.name} locked={!authorization.ready} style={{ maxWidth: '100%' }}
          aria-label={authorization.ready ? `${action} ${entry.name} account` : `${entry.name}: ${reason}`}
          reason={authorization.ready ? `${reason}. ${action} this account for its supported features.` : reason}
          onClick={() => nativeExternalOpen(connected[key] ? platforms[key]?.commandCenterOnly ? '/command-center?tab=accounts' : `/connected-accounts?source=${encodeURIComponent(key)}` : sourceConnectionPath(key))}>
          {authorization.ready && <span>{action}</span>}
        </SourceButton>
        <ExternalAccountLogin platform={key} />
      </li>;})}
    </ul>
  </section>;
}
