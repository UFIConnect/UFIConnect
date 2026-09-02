export const SOURCE_META = {
  reddit:        { label: 'Reddit',        color: '#FF4500', icon: 'RD' },
  hackernews:    { label: 'Hacker News',   color: '#FF6600', icon: 'HN' },
  devto:         { label: 'DEV Community', color: '#3B49DF', icon: 'DEV' },
  linkedin:      { label: 'LinkedIn',      color: '#0A66C2', icon: 'in' },
  twitter:       { label: 'X (Twitter)',   color: '#000000', icon: 'X' },
  bluesky:       { label: 'Bluesky',       color: '#0085FF', icon: 'BS' },
  facebook:      { label: 'Facebook',      color: '#1877F2', icon: 'f' },
  instagram:     { label: 'Instagram',     color: '#E1306C', icon: 'IG' },
  tiktok:        { label: 'TikTok',        color: '#111111', icon: 'TT' },
  github:        { label: 'GitHub',        color: '#24292F', icon: 'GH' },
  gitlab:        { label: 'GitLab',        color: '#FC6D26', icon: 'GL' },
  dribbble:      { label: 'Dribbble',      color: '#EA4C89', icon: 'Dr' },
  youtube:       { label: 'YouTube',       color: '#FF0000', icon: 'YT' },
  medium:        { label: 'Medium',        color: '#1A8917', icon: 'M' },
  stackoverflow: { label: 'Stack Overflow',color: '#F48024', icon: 'SO' },
  mastodon:      { label: 'Mastodon',      color: '#6364FF', icon: 'MD' },
  pinterest:     { label: 'Pinterest',     color: '#E60023', icon: 'P' },
  tumblr:        { label: 'Tumblr',        color: '#001935', icon: 'TU' },
  wordpress:     { label: 'WordPress.com', color: '#21759B', icon: 'WP' },
  lobsters:      { label: 'Lobsters',      color: '#AC130D', icon: 'LB' },
  arxiv:         { label: 'arXiv',         color: '#B31B1B', icon: 'arXiv' },
  indeed:        { label: 'Indeed',        color: '#2557A7', icon: 'IN' },
  usajobs:       { label: 'USAJobs',       color: '#005EA8', icon: 'US' },
  producthunt:   { label: 'Product Hunt',  color: '#DA552F', icon: 'PH' },
  techcrunch:    { label: 'TechCrunch',      color: '#0D9F3F', icon: 'TC' },
  theverge:      { label: 'The Verge',       color: '#FF3333', icon: 'TV' },
  indiehackers:  { label: 'Indie Hackers',   color: '#0E2150', icon: 'IH' },
  hashnode:      { label: 'freeCodeCamp',    color: '#006400', icon: 'FCC' },
  arstechnica:   { label: 'Ars Technica',    color: '#FF6600', icon: 'AT' },
  wired:         { label: 'WIRED',           color: '#111111', icon: 'W' },
  theregister:   { label: 'The Register',    color: '#CC0000', icon: 'TR' },
  venturebeat:   { label: 'VentureBeat',     color: '#1E6FBF', icon: 'VB' },
  smashing:      { label: 'Smashing Mag',    color: '#E9620A', icon: 'SM' },
  phoronix:      { label: 'Phoronix',        color: '#2B7BB9', icon: 'PX' },
  infoq:         { label: 'InfoQ',           color: '#67B346', icon: 'IQ' },
  mittr:         { label: 'MIT Tech Review', color: '#A31F34', icon: 'MIT' },
  freecodecamp:  { label: 'freeCodeCamp',    color: '#006400', icon: 'FCC' },
  remoteok:      { label: 'Remote OK',       color: '#10B981', icon: 'RO' },
  remotive:      { label: 'Remotive',        color: '#2563EB', icon: 'RM' },
  muse:          { label: 'The Muse',        color: '#7C3AED', icon: 'MU' },
  yc:            { label: 'Y Combinator',    color: '#FF6600', icon: 'YC' },
  crunchbase:    { label: 'Crunchbase',      color: '#146AFF', icon: 'CB' },
  behance:       { label: 'Behance',         color: '#053EFF', icon: 'Be' },
  designweb:     { label: 'Design Web',      color: '#DB2777', icon: 'UX' },
  twitch:        { label: 'Twitch',          color: '#9146FF', icon: 'TW' },
  threads:       { label: 'Threads',         color: '#000000', icon: 'TH' },
  livecamera:    { label: 'Live Cameras',    color: '#DC2626', icon: 'CAM' },
  wikivoyage:    { label: 'Wikivoyage',      color: '#396',    icon: 'WV' },
  travelnews:    { label: 'Travel News',     color: '#1A73E8', icon: 'GN' },
  travelevents:  { label: 'Local Events',    color: '#B45309', icon: 'EV' },
  localpulse:    { label: 'Local Pulse',     color: '#0F766E', icon: 'LP' },
  restaurants:   { label: 'Restaurants',     color: '#B45309', icon: 'RS' },
  uficonnect:    { label: 'UFIconnect',      color: 'var(--primary)', icon: 'UFI' },
};

// Account-owned integrations are managed in Command Center. They only use
// content from the member who authorizes them and never enter shared feeds.
export const COMMAND_CENTER_ACCOUNT_PLATFORMS = [
  'linkedin', 'instagram', 'tiktok', 'threads',
  'mastodon', 'pinterest', 'tumblr', 'wordpress',
];

// Cross-Post shows supported providers and planned publishing destinations.
// The server marks each one as selectable only when its provider flow is
// configured and supported.
export const CROSS_POST_PLATFORM_IDS = [
  'bluesky', 'reddit', 'twitter', 'facebook', 'instagram', 'tiktok',
  'threads', 'linkedin', 'mastodon', 'pinterest', 'tumblr', 'wordpress',
  'youtube', 'wired', 'mittr', 'smashing', 'infoq', 'theregister',
  'arstechnica', 'phoronix', 'devto', 'freecodecamp',
];

// Every platform a user can link via Connected Accounts (mirrors
// CONNECTED_SOCIAL_PLATFORMS server-side). Not every entry has a live
// "following timeline" fetcher wired up yet; platforms without one simply
// show the existing empty/coming-soon states.
export const CONNECTED_SOCIAL_PLATFORMS = [
  'linkedin', 'twitter', 'instagram', 'tiktok', 'facebook',
  'github', 'gitlab', 'youtube', 'reddit',
  'medium', 'dribbble', 'twitch', 'threads', 'bluesky',
];

// Shared by the desktop feed rail and the mobile app menu. Keeping this
// vocabulary here prevents the two controls from quietly drifting apart.
export const HOME_FEED_SOURCE_IDS = [
  'reddit', 'github', 'youtube', 'hackernews',
  'twitter', 'facebook',
  'indeed', 'remoteok', 'remotive', 'muse', 'usajobs',
  'bluesky', 'gitlab', 'devto', 'medium', 'stackoverflow', 'lobsters', 'arxiv',
  'producthunt', 'techcrunch', 'theverge', 'indiehackers', 'hashnode',
  'arstechnica', 'wired', 'theregister', 'venturebeat', 'smashing', 'phoronix', 'infoq', 'mittr',
  'yc', 'crunchbase', 'behance', 'designweb', 'mastodon',
];

export const FOLLOWING_FEED_SOURCE_IDS = ['uficonnect', ...CONNECTED_SOCIAL_PLATFORMS];
