import ACCOUNT_DIRECTORY from '../../../backend/account-directory.json' with { type: 'json' };
import { SOURCE_META, CAREER_ACCOUNT_PLATFORMS } from './sourceMeta.js';
import { accountCategory as sharedAccountCategory, accountSections as sharedAccountSections } from '../../../shared/accountCategories.js';
import { ACCOUNT_PROVIDER_SITES } from '../../../shared/accountWebsiteUrls.js';
export { ACCOUNT_CATEGORIES, selectedAccountSections } from '../../../shared/accountCategories.js';

export const SOURCE_CATEGORIES = [
  ['social', 'Social & community'], ['developer', 'Development & research'],
  ['news', 'News & articles'], ['creative', 'Design & video'],
  ['business', 'Startups & business'], ['career', 'Career sites'], ['local', 'Travel & local'],
];
const CATEGORY_SOURCES = {
  social: ['uficonnect', 'reddit', 'twitter', 'facebook', 'bluesky', 'mastodon', 'linkedin', 'threads', 'tumblr', ...Object.keys(ACCOUNT_DIRECTORY).filter(key => ACCOUNT_DIRECTORY[key].category === 'social')],
  developer: ['github', 'gitlab', 'devto', 'stackoverflow', 'hackernews', 'lobsters', 'arxiv', 'crossref', 'datacite', 'zenodo', 'openalex', 'phoronix', 'infoq', 'hashnode', 'freecodecamp', 'discord', 'figma', 'slack', 'notion'],
  news: ['medium', 'techcrunch', 'theverge', 'arstechnica', 'wired', 'theregister', 'venturebeat', 'mittr', 'wordpress', ...Object.keys(ACCOUNT_DIRECTORY).filter(key => ACCOUNT_DIRECTORY[key].category === 'publication')],
  creative: ['youtube', 'twitch', 'instagram', 'tiktok', 'pinterest', 'behance', 'dribbble', 'designweb', 'smashing', ...Object.keys(ACCOUNT_DIRECTORY).filter(key => ['video', 'audio', 'design'].includes(ACCOUNT_DIRECTORY[key].category))],
  business: ['producthunt', 'yc', 'crunchbase', 'indiehackers'],
  career: CAREER_ACCOUNT_PLATFORMS,
  local: ['livecamera', 'wikivoyage', 'travelnews', 'travelevents', 'localpulse', 'restaurants', ...Object.keys(ACCOUNT_DIRECTORY).filter(key => ACCOUNT_DIRECTORY[key].category === 'travel')],
};
export function sourceCategory(source) {
  return SOURCE_CATEGORIES.find(([key]) => CATEGORY_SOURCES[key].includes(source))?.[0] || 'social';
}
export function enabledFirstSourceSections(sections, disabledSources) {
  // Partition the whole directory, so disabled favorites or earlier categories
  // cannot appear above enabled sources in later categories.
  return [true, false].flatMap(enabled => sections.map(section => ({
    ...section,
    id: `${enabled ? 'enabled' : 'disabled'}-${section.id}`,
    label: `${enabled ? 'On' : 'Off'} · ${section.label}`,
    items: section.items.filter(source => !disabledSources.has(source) === enabled),
  })).filter(section => section.items.length));
}
export function sourceSections(sources, favorites, category, disabledSources) {
  const filtered = sources.filter(source => category === 'all' || (category === 'favorites' ? favorites.includes(source) : sourceCategory(source) === category));
  const sections = [['favorites', 'Favorites'], ...SOURCE_CATEGORIES].map(([id, label]) => ({
    id, label,
    items: filtered.filter(source => favorites.includes(source) ? id === 'favorites' : sourceCategory(source) === id)
      .sort((a, b) => (SOURCE_META[a]?.label || a).localeCompare(SOURCE_META[b]?.label || b)),
  })).filter(section => section.items.length);
  return enabledFirstSourceSections(sections, disabledSources);
}
export function filterAccounts(entries) {
  return [...entries].sort(([a, pa], [b, pb]) => (pa.name || a).localeCompare(pb.name || b));
}

export function accountCategory(key, platform = {}, { business = false } = {}) {
  return sharedAccountCategory(key, platform, { business, careerSources: CAREER_ACCOUNT_PLATFORMS });
}

// Categories describe the providers without status-based ordering or filters.
export function accountSections(entries, { business = false } = {}) {
  return sharedAccountSections(entries, { business, careerSources: CAREER_ACCOUNT_PLATFORMS });
}

// Public destinations only. Authorization always uses the existing OAuth start route.
export const ACCOUNT_SITE_URLS = {
  ...Object.fromEntries(Object.entries(ACCOUNT_DIRECTORY).map(([key, entry]) => [key, entry.siteUrl])),
  ...ACCOUNT_PROVIDER_SITES,
};
