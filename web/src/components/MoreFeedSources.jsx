import { useState } from 'react';
import { ArrowRight, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { DirectoryControls } from './DirectoryControls';
import { ACCOUNT_SITE_URLS, SOURCE_CATEGORIES, sourceCategory } from './sourceDirectory';
import { HOME_FEED_SOURCE_IDS, SOURCE_META, isFollowingFeedSource, unavailableFeedSourceIds } from './sourceMeta';

const homeSources = new Set(HOME_FEED_SOURCE_IDS);
const websiteSources = unavailableFeedSourceIds('feed').filter(source => ACCOUNT_SITE_URLS[source]);
const sourcesByMode = {
  feed: websiteSources,
  following: [...new Set([...homeSources, ...websiteSources])].filter(source => !isFollowingFeedSource(source)),
};

export default function MoreFeedSources({ mode, category: fixedCategory }) {
  const [category, setCategory] = useState('social');
  const sources = sourcesByMode[mode];
  const categories = SOURCE_CATEGORIES.filter(([key]) => sources.some(source => sourceCategory(source) === key));
  const selectedCategory = fixedCategory || (categories.some(([key]) => key === category) ? category : categories[0]?.[0]);
  const visible = sources.filter(source => sourceCategory(source) === selectedCategory)
    .sort((a, b) => (SOURCE_META[a]?.label || a).localeCompare(SOURCE_META[b]?.label || b));
  if (!visible.length) return null;

  return <section className="more-feed-sources" aria-label="More sources">
    <h4 className="source-directory-heading">More sources</h4>
    {!fixedCategory && <DirectoryControls label="more sources" filter={selectedCategory} onFilterChange={setCategory} options={categories} />}
    <ul>
      {visible.map(source => {
        const label = SOURCE_META[source]?.label || source;
        const home = homeSources.has(source);
        const Icon = home ? ArrowRight : ExternalLink;
        const className = 'source-button more-feed-source-link';
        const contents = <>
          <span className="source-button-mark" aria-hidden="true" style={{ color: SOURCE_META[source]?.color }}>
            {hasBrandIcon(source) ? <BrandIcon platform={source} size={18} /> : SOURCE_META[source]?.icon}
          </span>
          <span className="more-feed-source-label">{label}<small>{home ? 'Home feed' : 'Website'}</small></span>
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
