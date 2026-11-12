import sourceCatalog from './feed-source-catalog.json' with { type: 'json' };
import { isVenueFeed } from './venue-location.mjs';

export const HOME_VIEW_MODES = new Set(['ufi', 'feed', 'following', 'groups', 'countries', 'restaurants', 'bars']);
const timeRanges = new Set(['all', '1h', '6h', 'today', 'week']);
const homeSources = new Set(sourceCatalog.home);
const followingSources = new Set(['uficonnect', ...Object.keys(sourceCatalog.following)
  .filter(source => sourceCatalog.following[source] === 'following')]);
const noSources = new Set();
export const HOME_FEED_MODE_KEY = 'homeFeedLastMode';
export const homeFeedViewKey = mode => `homeFeedView_${mode}`;
const homeFeedKeys = new Set([HOME_FEED_MODE_KEY, ...Array.from(HOME_VIEW_MODES, homeFeedViewKey)]);

export function savedHomeFeedMode(settings) {
  const saved = settings?.[HOME_FEED_MODE_KEY];
  return HOME_VIEW_MODES.has(saved) ? saved : settings?.mobileSelectedFeed;
}

export function resolveHomeFeedMode(requested, settings) {
  if (requested === 'local') return 'countries';
  if (HOME_VIEW_MODES.has(requested)) return requested;
  const saved = savedHomeFeedMode(settings);
  return HOME_VIEW_MODES.has(saved) && !isVenueFeed(saved) ? saved : 'feed';
}

export function withoutHomeFeedSettings(settings) {
  return Object.fromEntries(Object.entries(settings || {}).filter(([key]) => !homeFeedKeys.has(key)));
}

function uniqueStrings(value, valid, limit) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(item => typeof item === 'string' && valid(item)))].slice(0, limit);
}

export function normalizeHomeFeedSelection(mode, value) {
  const sourceIds = mode === 'following' ? followingSources : ['feed', 'groups'].includes(mode) ? homeSources : noSources;
  const activeTabs = uniqueStrings(value?.activeTabs, source => sourceIds.has(source), sourceIds.size);
  return {
    activeTabs,
    sources: activeTabs.length ? [] : uniqueStrings(value?.sources, source => sourceIds.has(source), sourceIds.size),
    topics: uniqueStrings(value?.topics, topic => topic.trim() === topic && topic.length > 0 && topic.length <= 120
      && !/[\u0000-\u001f\u007f]/.test(topic), 250),
    timeRange: timeRanges.has(value?.timeRange) ? value.timeRange : 'all',
  };
}
