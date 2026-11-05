import { HOME_FEED_SOURCE_IDS, FOLLOWING_FEED_SOURCE_IDS } from '../components/sourceMeta.js';

// Route links use the same supported-source catalogs as the feed controls.
// A missing or unsupported source leaves the member's selection alone.
export function feedRouteSources(search, mode) {
  const params = new URLSearchParams(search);
  const allowed = mode === 'following' ? FOLLOWING_FEED_SOURCE_IDS : mode === 'feed' ? HOME_FEED_SOURCE_IDS : [];
  if (mode === 'feed' && params.get('all') === '1') return null;
  const sources = [...new Set([
    ...params.getAll('source'),
    ...params.getAll('sources').flatMap(value => value.split(',')),
  ].filter(source => allowed.includes(source)))];
  return sources.length ? sources : null;
}
