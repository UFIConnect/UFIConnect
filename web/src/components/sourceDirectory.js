import ACCOUNT_DIRECTORY from '../../../backend/account-directory.json' with { type: 'json' };
import { SOURCE_META, CAREER_ACCOUNT_PLATFORMS } from './sourceMeta';

export const SOURCE_CATEGORIES = [
  ['social', 'Social & community'], ['developer', 'Development & research'],
  ['news', 'News & articles'], ['creative', 'Design & video'],
  ['business', 'Startups & business'], ['career', 'Career sites'], ['local', 'Travel & local'],
];
const CATEGORY_SOURCES = {
  social: ['uficonnect', 'reddit', 'twitter', 'facebook', 'bluesky', 'mastodon', 'linkedin', 'threads', 'tumblr'],
  developer: ['github', 'gitlab', 'devto', 'stackoverflow', 'hackernews', 'lobsters', 'arxiv', 'phoronix', 'infoq', 'hashnode', 'freecodecamp'],
  news: ['medium', 'techcrunch', 'theverge', 'arstechnica', 'wired', 'theregister', 'venturebeat', 'mittr', 'wordpress', ...Object.keys(ACCOUNT_DIRECTORY).filter(key => ACCOUNT_DIRECTORY[key].category === 'publication')],
  creative: ['youtube', 'twitch', 'instagram', 'tiktok', 'pinterest', 'behance', 'dribbble', 'designweb', 'smashing'],
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
export const ACCOUNT_STATUSES = [['connected', 'Connected'], ['available', 'Available'], ['membership', 'Membership'], ['soon', 'Coming soon']];
export function accountStatus(platform, connected) {
  if (connected && platform.connectionMode !== 'external') return 'connected';
  if (platform.connectionMode === 'external') return 'available';
  if (platform.forceComingSoon || !platform.configured) return 'soon';
  return platform.locked ? 'membership' : 'available';
}
export function filterAccounts(entries, connected, status) {
  return entries.filter(([key, platform]) => status === 'all' || accountStatus(platform, connected[key]) === status)
    .sort(([a, pa], [b, pb]) => ACCOUNT_STATUSES.findIndex(([s]) => s === accountStatus(pa, connected[a]))
      - ACCOUNT_STATUSES.findIndex(([s]) => s === accountStatus(pb, connected[b]))
      || (pa.name || a).localeCompare(pb.name || b));
}

export const ACCOUNT_CATEGORIES = [
  ['social', 'Social'], ['video', 'Video & Streaming'],
  ['work', 'Work & Development'], ['publishing', 'Publishing'], ['career', 'Career sites'],
  ['travel', 'Travel'], ['audio', 'Music & Audio'],
];
function accountCategory(key, platform) {
  if (['travel', 'audio', 'work', 'video'].includes(platform.category)) return platform.category;
  if (platform.category === 'career' || CAREER_ACCOUNT_PLATFORMS.includes(key)) return 'career';
  if (['youtube', 'twitch', 'tiktok'].includes(key)) return 'video';
  if (['github', 'gitlab', 'linkedin', 'dribbble', 'behance', 'figma', 'stackoverflow', 'producthunt'].includes(key)) return 'work';
  if (platform.category === 'publication' || ['medium', 'wordpress', 'tumblr', 'devto', 'hashnode', 'freecodecamp'].includes(key)) return 'publishing';
  return 'social';
}

// Account categories describe what members connect, while the status filter
// preserves each provider's existing authorization and availability state.
export function accountSections(entries, connected, status = 'all') {
  return ACCOUNT_CATEGORIES.map(([id, label]) => {
    const categoryEntries = entries.filter(([key, platform]) => accountCategory(key, platform) === id);
    return {
      id, label,
      total: categoryEntries.length,
      connectedCount: categoryEntries.filter(([key]) => connected[key]).length,
      items: filterAccounts(categoryEntries, connected, status),
    };
  }).filter(section => section.items.length);
}

// Public destinations only. Authorization always uses the existing OAuth start route.
export const ACCOUNT_SITE_URLS = {
  ...Object.fromEntries(Object.entries(ACCOUNT_DIRECTORY).map(([key, entry]) => [key, entry.siteUrl])),
  discord: 'https://discord.com/channels/@me', figma: 'https://www.figma.com/files',
  linkedin: 'https://www.linkedin.com/', twitter: 'https://x.com/', facebook: 'https://www.facebook.com/',
  instagram: 'https://www.instagram.com/', tiktok: 'https://www.tiktok.com/', threads: 'https://www.threads.com/',
  github: 'https://github.com/', gitlab: 'https://gitlab.com/', youtube: 'https://www.youtube.com/',
  reddit: 'https://www.reddit.com/', medium: 'https://medium.com/', dribbble: 'https://dribbble.com/',
  twitch: 'https://www.twitch.tv/', bluesky: 'https://bsky.app/', mastodon: 'https://joinmastodon.org/servers',
  pinterest: 'https://www.pinterest.com/', tumblr: 'https://www.tumblr.com/', wordpress: 'https://wordpress.com/',
  indeed: 'https://www.indeed.com/', usajobs: 'https://www.usajobs.gov/', remoteok: 'https://remoteok.com/',
  remotive: 'https://remotive.com/', muse: 'https://www.themuse.com/', glassdoor: 'https://www.glassdoor.com/',
  handshake: 'https://app.joinhandshake.com/', wellfound: 'https://wellfound.com/', ziprecruiter: 'https://www.ziprecruiter.com/', dice: 'https://www.dice.com/',
  wired: 'https://www.wired.com/', mittr: 'https://www.technologyreview.com/', smashing: 'https://www.smashingmagazine.com/',
  infoq: 'https://www.infoq.com/', theregister: 'https://www.theregister.com/', arstechnica: 'https://arstechnica.com/',
  phoronix: 'https://www.phoronix.com/', devto: 'https://dev.to/', freecodecamp: 'https://www.freecodecamp.org/',
};
