export const SOURCE_META = {
  reddit:        { label: 'Reddit',        color: '#FF4500', icon: '🟠' },
  hackernews:    { label: 'News',          color: '#FF6600', icon: '🗞' },
  devto:         { label: 'DEV Community', color: '#3B49DF', icon: '👩‍💻' },
  linkedin:      { label: 'LinkedIn',      color: '#0A66C2', icon: '💼' },
  twitter:       { label: 'X (Twitter)',   color: '#000000', icon: '𝕏' },
  bluesky:       { label: 'Bluesky',       color: '#0085FF', icon: '🦋' },
  facebook:      { label: 'Facebook',      color: '#1877F2', icon: '🔵' },
  instagram:     { label: 'Instagram',     color: '#E1306C', icon: '📸' },
  github:        { label: 'GitHub',        color: '#24292F', icon: '🐙' },
  gitlab:        { label: 'GitLab',        color: '#FC6D26', icon: 'GL' },
  discord:       { label: 'Discord',       color: '#5865F2', icon: '🎮' },
  dribbble:      { label: 'Dribbble',      color: '#EA4C89', icon: '🏀' },
  youtube:       { label: 'YouTube',       color: '#FF0000', icon: '▶️' },
  medium:        { label: 'Medium',        color: '#1A8917', icon: '📝' },
  stackoverflow: { label: 'Stack Overflow',color: '#F48024', icon: '📚' },
  mastodon:      { label: 'Mastodon',      color: '#6364FF', icon: '🦣' },
  lobsters:      { label: 'Lobsters',      color: '#AC130D', icon: '🦞' },
  arxiv:         { label: 'arXiv',         color: '#B31B1B', icon: '🔬' },
  indeed:        { label: 'Indeed',        color: '#2557A7', icon: '💼' },
  usajobs:       { label: 'USAJobs',       color: '#005EA8', icon: '🏛️' },
  producthunt:   { label: 'Product Hunt',  color: '#DA552F', icon: '🚀' },
  techcrunch:    { label: 'TechCrunch',      color: '#0D9F3F', icon: '📰' },
  theverge:      { label: 'The Verge',       color: '#FF3333', icon: '⬛' },
  indiehackers:  { label: 'Indie Hackers',   color: '#0E2150', icon: '💡' },
  hashnode:      { label: 'freeCodeCamp',    color: '#006400', icon: '🔥' },
  arstechnica:   { label: 'Ars Technica',    color: '#FF6600', icon: '📡' },
  wired:         { label: 'WIRED',           color: '#111111', icon: '🔌' },
  theregister:   { label: 'The Register',    color: '#CC0000', icon: '📋' },
  venturebeat:   { label: 'VentureBeat',     color: '#1E6FBF', icon: '💹' },
  smashing:      { label: 'Smashing Mag',    color: '#E9620A', icon: '🎨' },
  phoronix:      { label: 'Phoronix',        color: '#2B7BB9', icon: '🐧' },
  infoq:         { label: 'InfoQ',           color: '#67B346', icon: '🏗️' },
  mittr:         { label: 'MIT Tech Review', color: '#A31F34', icon: '🔬' },
  remoteok:      { label: 'Remote OK',       color: '#10B981', icon: 'RO' },
  yc:            { label: 'Y Combinator',    color: '#FF6600', icon: 'YC' },
  crunchbase:    { label: 'Crunchbase',      color: '#146AFF', icon: 'CB' },
  behance:       { label: 'Behance',         color: '#053EFF', icon: 'Be' },
  designweb:     { label: 'Design Web',      color: '#DB2777', icon: 'UX' },
  figma:         { label: 'Figma',           color: '#F24E1E', icon: 'Fi' },
  twitch:        { label: 'Twitch',          color: '#9146FF', icon: '🕹' },
  threads:       { label: 'Threads',         color: '#000000', icon: '🧵' },
  uficonnect:    { label: 'UFconnect',      color: 'var(--primary)', icon: '🌐' },
};

// Every platform a user can link via Connected Accounts (mirrors
// CONNECTED_SOCIAL_PLATFORMS server-side) — the single canonical list
// behind every Following-mode platform picker (the main Feed's Following
// slide bar + filter panel, the video feed's Following filter sheet), so a
// newly connectable platform only needs adding here once instead of
// separately re-hardcoded in each picker. Not every entry has a live
// "following timeline" fetcher wired up yet (see FOLLOWING_SOURCE_FETCHERS/
// CONNECTED_SOCIAL_SEARCH_FETCHERS server-side) — one without a fetcher
// just shows the existing empty state once selected, same as any other
// source with temporarily-thin supply, rather than being left off the
// picker entirely.
export const CONNECTED_SOCIAL_PLATFORMS = [
  'linkedin', 'twitter', 'facebook',
  'github', 'gitlab', 'discord', 'youtube', 'reddit',
  'medium', 'dribbble', 'figma', 'twitch', 'threads', 'bluesky',
];
