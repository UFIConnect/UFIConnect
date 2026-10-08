// Plain JavaScript shared by the website and maintained React Native app.
export const ACCOUNT_CATEGORIES = [
  ['social', 'Social'], ['video', 'Video & Streaming'],
  ['work', 'Work & Development'], ['design', 'Design'],
  ['publishing', 'News & Publishing'], ['career', 'Career sites'],
  ['travel', 'Travel'], ['audio', 'Music & Audio'],
];

// Curated discovery order for the expanded categories, not a live usage ranking.
// Other categories and future providers keep their alphabetical ordering.
const POPULAR_ACCOUNT_ORDER = {
  social: ['facebook', 'instagram', 'whatsapp', 'snapchat', 'discord', 'telegram', 'twitter', 'threads', 'reddit', 'bluesky', 'mastodon', 'signal', 'nextdoor', 'quora'],
  video: ['youtube', 'tiktok', 'twitch', 'netflix', 'primevideo', 'disneyplus', 'crunchyroll', 'kick', 'vimeo', 'dailymotion'],
  design: ['canva', 'figma', 'pinterest', 'adobeexpress', 'dribbble', 'behance', 'artstation', 'deviantart', 'webflow', 'sketch'],
  audio: ['spotify', 'applemusic', 'youtubemusic', 'amazonmusic', 'soundcloud', 'tidal', 'deezer', 'bandcamp'],
};

export function accountCategory(key, platform = {}, { business = false, careerSources = [] } = {}) {
  if ((business && key === 'linkedin') || platform.category === 'career' || careerSources.includes(key)) return 'career';
  if (['dribbble', 'behance', 'figma', 'pinterest'].includes(key)) return 'design';
  if (ACCOUNT_CATEGORIES.some(([category]) => category === platform.category)) return platform.category;
  if (['youtube', 'twitch', 'tiktok'].includes(key)) return 'video';
  if (['github', 'gitlab', 'linkedin', 'stackoverflow', 'producthunt'].includes(key)) return 'work';
  if (platform.category === 'publication' || ['medium', 'wordpress', 'tumblr', 'devto', 'hashnode', 'freecodecamp'].includes(key)) return 'publishing';
  return 'social';
}

export function accountSections(entries, options = {}) {
  return ACCOUNT_CATEGORIES.map(([id, label]) => {
    const priority = POPULAR_ACCOUNT_ORDER[id] || [];
    const rank = key => { const index = priority.indexOf(key); return index < 0 ? priority.length : index; };
    const items = entries.filter(([key, platform]) => accountCategory(key, platform, options) === id)
      .sort(([a, pa], [b, pb]) => rank(a) - rank(b) || String(pa.name || a).localeCompare(String(pb.name || b)));
    return { id, label, total: items.length, items };
  }).filter(section => section.total);
}

export function selectedAccountSections(sections, category) {
  const selected = sections.find(section => section.id === category) || sections[0];
  return selected ? [selected] : [];
}
