// Maps groups every source into a nature-themed town by category. The categories
// follow the Sources page, plus the travel and local sources behind Travel,
// Restaurants and Bars and clubs.
export const MAP_TOWNS = [
  { id: 'developer', label: 'Developer', town: 'Pine Ridge', color: '#4ade80',
    sources: ['github', 'gitlab', 'devto', 'stackoverflow', 'hackernews', 'lobsters', 'arxiv', 'phoronix', 'infoq'] },
  { id: 'news', label: 'Tech News', town: 'Cedar Hollow', color: '#fbbf24',
    sources: ['techcrunch', 'theverge', 'arstechnica', 'wired', 'theregister', 'venturebeat', 'mittr'] },
  { id: 'social', label: 'Social & Community', town: 'Willow Creek', color: '#38bdf8',
    sources: ['reddit', 'mastodon', 'bluesky', 'indiehackers'] },
  { id: 'content', label: 'Writing & Video', town: 'Fern Valley', color: '#a3e635',
    sources: ['medium', 'hashnode', 'youtube', 'smashing'] },
  { id: 'startups', label: 'Startups & Business', town: 'Aspen Heights', color: '#fb923c',
    sources: ['producthunt', 'yc', 'crunchbase'] },
  { id: 'jobs', label: 'Jobs', town: 'Oak Meadow', color: '#f472b6',
    sources: ['indeed', 'remoteok', 'remotive', 'muse', 'usajobs'] },
  { id: 'design', label: 'Design & Creative', town: 'Lavender Fields', color: '#c4b5fd',
    sources: ['behance', 'designweb'] },
  { id: 'travel', label: 'Travel & Local', town: 'Coral Bay', color: '#2dd4bf',
    sources: ['wikivoyage', 'travelnews', 'travelevents', 'localpulse', 'livecamera', 'restaurants', 'bars'] },
  { id: 'community', label: 'UFIconnect', town: 'Maple Commons', color: '#818cf8',
    sources: ['uficonnect'] },
];

// The API reports a few sources under their agent ids.
export const SOURCE_ALIASES = { hackernews: 'hn' };
