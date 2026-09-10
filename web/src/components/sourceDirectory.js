import { SOURCE_META, CAREER_ACCOUNT_PLATFORMS } from './sourceMeta';

export const SOURCE_CATEGORIES = [
  ['social', 'Social & community'], ['developer', 'Development & research'],
  ['news', 'News & articles'], ['creative', 'Design & video'],
  ['business', 'Startups & business'], ['career', 'Career sites'], ['local', 'Travel & local'],
];
const CATEGORY_SOURCES = {
  social: ['uficonnect', 'reddit', 'twitter', 'facebook', 'bluesky', 'mastodon', 'linkedin', 'threads', 'tumblr'],
  developer: ['github', 'gitlab', 'devto', 'stackoverflow', 'hackernews', 'lobsters', 'arxiv', 'phoronix', 'infoq', 'hashnode', 'freecodecamp'],
  news: ['medium', 'techcrunch', 'theverge', 'arstechnica', 'wired', 'theregister', 'venturebeat', 'mittr', 'wordpress'],
  creative: ['youtube', 'twitch', 'instagram', 'tiktok', 'pinterest', 'behance', 'dribbble', 'designweb', 'smashing'],
  business: ['producthunt', 'yc', 'crunchbase', 'indiehackers'],
  career: CAREER_ACCOUNT_PLATFORMS,
  local: ['livecamera', 'wikivoyage', 'travelnews', 'travelevents', 'localpulse', 'restaurants'],
};
export function sourceCategory(source) {
  return SOURCE_CATEGORIES.find(([key]) => CATEGORY_SOURCES[key].includes(source))?.[0] || 'social';
}
export function matchesSource(source, name, query) {
  const text = `${source} ${name || SOURCE_META[source]?.label || ''}`.toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every(word => text.includes(word));
}
export function sourceSections(sources, favorites, query, category) {
  const filtered = sources.filter(source => matchesSource(source, '', query)
    && (category === 'all' || (category === 'favorites' ? favorites.includes(source) : sourceCategory(source) === category)));
  return [['favorites', 'Favorites'], ...SOURCE_CATEGORIES].map(([id, label]) => ({
    id, label,
    items: filtered.filter(source => favorites.includes(source) ? id === 'favorites' : sourceCategory(source) === id)
      .sort((a, b) => (SOURCE_META[a]?.label || a).localeCompare(SOURCE_META[b]?.label || b)),
  })).filter(section => section.items.length);
}
export const ACCOUNT_STATUSES = [['connected', 'Connected'], ['available', 'Available'], ['membership', 'Membership'], ['soon', 'Coming soon']];
export function accountStatus(platform, connected) {
  if (connected) return 'connected';
  if (platform.forceComingSoon || !platform.configured) return 'soon';
  return platform.locked ? 'membership' : 'available';
}
export function filterAccounts(entries, connected, query, status) {
  return entries.filter(([key, platform]) => matchesSource(key, platform.name, query)
    && (status === 'all' || accountStatus(platform, connected[key]) === status))
    .sort(([a, pa], [b, pb]) => ACCOUNT_STATUSES.findIndex(([s]) => s === accountStatus(pa, connected[a]))
      - ACCOUNT_STATUSES.findIndex(([s]) => s === accountStatus(pb, connected[b]))
      || (pa.name || a).localeCompare(pb.name || b));
}

// Public destinations only. Authorization always uses the existing OAuth start route.
export const ACCOUNT_SITE_URLS = {
  linkedin: 'https://www.linkedin.com/', twitter: 'https://x.com/', facebook: 'https://www.facebook.com/',
  instagram: 'https://www.instagram.com/', tiktok: 'https://www.tiktok.com/', threads: 'https://www.threads.com/',
  github: 'https://github.com/', gitlab: 'https://gitlab.com/', youtube: 'https://www.youtube.com/',
  reddit: 'https://www.reddit.com/', medium: 'https://medium.com/', dribbble: 'https://dribbble.com/',
  twitch: 'https://www.twitch.tv/', bluesky: 'https://bsky.app/', mastodon: 'https://joinmastodon.org/',
  pinterest: 'https://www.pinterest.com/', tumblr: 'https://www.tumblr.com/', wordpress: 'https://wordpress.com/',
  indeed: 'https://www.indeed.com/', usajobs: 'https://www.usajobs.gov/', remoteok: 'https://remoteok.com/',
  remotive: 'https://remotive.com/', muse: 'https://www.themuse.com/', glassdoor: 'https://www.glassdoor.com/',
  handshake: 'https://app.joinhandshake.com/', wellfound: 'https://wellfound.com/', ziprecruiter: 'https://www.ziprecruiter.com/', dice: 'https://www.dice.com/',
  wired: 'https://www.wired.com/', mittr: 'https://www.technologyreview.com/', smashing: 'https://www.smashingmagazine.com/',
  infoq: 'https://www.infoq.com/', theregister: 'https://www.theregister.com/', arstechnica: 'https://arstechnica.com/',
  phoronix: 'https://www.phoronix.com/', devto: 'https://dev.to/', freecodecamp: 'https://www.freecodecamp.org/',
};
