import { SOURCE_META, unavailableFeedSourceIds } from './sourceMeta';
import { sourceCategory } from './sourceDirectory';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import ExternalAccountLogin from './ExternalAccountLogin';
import './source-directory.css';

export default function UnavailableFeedSources({ mode = 'feed', category = 'all', plan, includeWebsites = true }) {
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
      {sources.map(source => <li key={source}>
        <button type="button" disabled aria-label={`${SOURCE_META[source]?.label || source}: ${reason}`}>
          {hasBrandIcon(source) ? <BrandIcon platform={source} size={18} /> : <span aria-hidden="true">{SOURCE_META[source]?.icon || 'SRC'}</span>}
          <span>{SOURCE_META[source]?.label || source}</span>
        </button>
        {includeWebsites && <ExternalAccountLogin platform={source} />}
      </li>)}
    </ul>
  </section>;
}
