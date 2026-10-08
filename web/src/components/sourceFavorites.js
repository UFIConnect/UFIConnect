import { HOME_FEED_SOURCE_IDS, FOLLOWING_FEED_SOURCE_IDS } from './sourceMeta.js';

export function normalizeSourceFavorites(value) {
  const saved = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries({ feed: HOME_FEED_SOURCE_IDS, following: FOLLOWING_FEED_SOURCE_IDS }).map(([mode, sources]) => [
    mode, [...new Set((Array.isArray(saved[mode]) ? saved[mode] : sources.slice(0, 6)).filter(source => sources.includes(source)))],
  ]));
}
