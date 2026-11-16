import { useState } from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { DirectoryControls } from './DirectoryControls';
import { ACCOUNT_SITE_URLS, SOURCE_CATEGORIES, sourceCategory } from './sourceDirectory';
import { HOME_FEED_SOURCE_IDS, SOURCE_META, isFollowingFeedSource, unavailableFeedSourceIds } from './sourceMeta';

const homeSources = new Set(HOME_FEED_SOURCE_IDS);
const extraSources = [...new Set([...HOME_FEED_SOURCE_IDS, ...unavailableFeedSourceIds('following')])]
  .filter(source => !isFollowingFeedSource(source) && (homeSources.has(source) || ACCOUNT_SITE_URLS[source]))
  .map(source => ({
    source,
    category: sourceCategory(source),
    label: SOURCE_META[source]?.label || source,
    home: homeSources.has(source),
  }))
  .sort((a, b) => a.label.localeCompare(b.label));
const categories = SOURCE_CATEGORIES.filter(([key]) => extraSources.some(source => source.category === key));

export default function FollowingSourceDirectory({ category: fixedCategory }) {
  const [category, setCategory] = useState('social');
  const visible = extraSources.filter(source => source.category === (fixedCategory || category));
  if (!visible.length) return null;

  return <section className="following-source-directory" aria-label="More sources">
    <h4 className="source-directory-heading">More sources</h4>
    {!fixedCategory && <DirectoryControls label="more sources" filter={category} onFilterChange={setCategory} options={categories} />}
    <ul>
      {visible.map(({ source, label, home }) => {
        const Icon = home ? ArrowRight : ExternalLink;
        const className = 'source-button following-source-link';
        const contents = <>
          <span className="source-button-mark" aria-hidden="true" style={{ color: SOURCE_META[source]?.color }}>
            {hasBrandIcon(source) ? <BrandIcon platform={source} size={18} /> : SOURCE_META[source]?.icon}
          </span>
          <span className="following-source-link-label">{label}<small>{home ? 'Home feed' : 'Website'}</small></span>
          <Icon size={14} aria-hidden="true" />
        </>;
        return <li key={source}>{home ? (
          <Link className={className} aria-label={`Open ${label} in Home`} to={`/?feed=feed&source=${encodeURIComponent(source)}`}>{contents}</Link>
        ) : (
          <a className={className} aria-label={`Visit ${label} website`} href={ACCOUNT_SITE_URLS[source]} target="_blank" rel="noopener noreferrer">{contents}</a>
        )}</li>;
      })}
    </ul>
  </section>;
}
