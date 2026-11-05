import { SOURCE_META, unavailableFeedSourceIds } from './sourceMeta';
import { sourceCategory } from './sourceDirectory';
import SourceButton from './SourceButton';
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
        <SourceButton source={source} locked reason={reason} />
        {includeWebsites && <ExternalAccountLogin platform={source} />}
      </li>)}
    </ul>
  </section>;
}
