import ACCOUNT_DIRECTORY from '../../../backend/account-directory.json' with { type: 'json' };
import FEED_SOURCE_CATALOG from '../../../shared/feed-source-catalog.json' with { type: 'json' };

export const SOURCE_META = {
  discord:       { label: 'Discord',       color: '#5865F2', icon: 'DS' },
  figma:         { label: 'Figma',         color: '#A259FF', icon: 'FG' },
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
  glassdoor:     { label: 'Glassdoor',     color: '#0CAA41', icon: 'GD' },
  handshake:     { label: 'Handshake',     color: '#F97316', icon: 'HS' },
  wellfound:     { label: 'Wellfound',     color: '#111827', icon: 'WF' },
  ziprecruiter:  { label: 'ZipRecruiter',  color: '#E92C2C', icon: 'ZR' },
  dice:          { label: 'Dice',          color: '#0066CC', icon: 'DI' },
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
  bars:          { label: 'Bars and clubs', color: '#7C3AED', icon: 'BAR' },
  restaurants:   { label: 'Restaurants',     color: '#B45309', icon: 'RS' },
  weworkremotely: { label: 'We Work Remotely', color: '#EF4444', icon: 'WWR' },
  cntraveler: { label: 'Condé Nast Traveler', color: '#026B9C', icon: 'LM', desc: 'Travel journalism and destination articles' },
  uficonnect:    { label: 'UFIconnect',      color: 'var(--primary)', icon: 'UFI' },
};

Object.assign(SOURCE_META, Object.fromEntries(Object.entries(ACCOUNT_DIRECTORY).map(([key, entry]) => [key, {label: entry.name, color: entry.color, icon: entry.icon, desc: entry.description}])));

// Account-owned integrations are managed in Command Center. They only use
// content from the member who authorizes them and never enter shared feeds.
export const COMMAND_CENTER_ACCOUNT_PLATFORMS = [
  'discord', 'figma',
  'linkedin', 'instagram', 'tiktok', 'threads',
  'pinterest', 'tumblr', 'wordpress',
];

// Career providers use the same connection lifecycle as social accounts.
// They remain separate from CONNECTED_SOCIAL_PLATFORMS so authorizing a
// career account can never make it appear as a Following-feed source.
export const CAREER_ACCOUNT_PLATFORMS = Object.keys(ACCOUNT_DIRECTORY).filter(key => ACCOUNT_DIRECTORY[key].category === 'career');
export const TRAVEL_ACCOUNT_PLATFORMS = Object.keys(ACCOUNT_DIRECTORY).filter(key => ACCOUNT_DIRECTORY[key].category === 'travel');
export const NEWS_ACCOUNT_PLATFORMS = Object.keys(ACCOUNT_DIRECTORY).filter(key => ACCOUNT_DIRECTORY[key].category === 'publication');

// Official website sign-in is separate from an authorized account connection.
// These records also keep the directory useful during independent API/web rolls.
const EXTERNAL_ACCOUNT_FALLBACK = Object.fromEntries(Object.entries(ACCOUNT_DIRECTORY).map(([key, entry]) => [key, {
  ...entry, connectionMode: 'external', configured: false, forceComingSoon: false,
  note: 'Open the official website to use its reader or account features. Automatic account sync and publishing are unavailable.',
  commandCenterOnly: false, requiresMembership: false, locked: false,
  crossPost: { supported: false, media: 'none', note: 'Publishing is completed on the source website.' },
}]));
export function withCareerAccountFallback(platforms = {}, careerOnly = false) {
  const keys = careerOnly ? [...new Set([...CAREER_ACCOUNT_PLATFORMS, ...Object.keys(platforms)])] : Object.keys(platforms);
  const merged = Object.fromEntries(keys.map(key => {
    const fallback = EXTERNAL_ACCOUNT_FALLBACK[key];
    const provider = platforms[key];
    const entry = provider?.configured && !provider.forceComingSoon
      ? provider : fallback ? {...provider, ...fallback} : provider;
    return [key, entry];
  }));
  return careerOnly ? Object.fromEntries(Object.entries(merged).filter(([key, entry]) => key === 'linkedin' || entry?.category === 'career')) : merged;
}

// Cross-Post shows supported providers and planned publishing destinations.
// The server marks each one as selectable only when its provider flow is
// configured and supported.
export const CROSS_POST_PLATFORM_IDS = [
  'bluesky', 'reddit', 'twitter', 'facebook', 'instagram', 'tiktok',
  'threads', 'linkedin', 'mastodon', 'pinterest', 'tumblr', 'wordpress',
  'youtube', 'wired', 'mittr', 'smashing', 'infoq', 'theregister',
  'arstechnica', 'phoronix', 'devto', 'freecodecamp',
  ...Object.keys(ACCOUNT_DIRECTORY),
];

// Account authorization and feed support are separate capabilities. Identity
// and own-content integrations remain available in Connected Accounts.
export const CONNECTED_SOCIAL_PLATFORMS = [
  'discord', 'figma',
  'linkedin', 'twitter', 'instagram', 'tiktok', 'facebook',
  'github', 'gitlab', 'youtube', 'reddit',
  'medium', 'dribbble', 'twitch', 'threads', 'bluesky', 'mastodon',
];

// Include only installed adapters for authenticated followed content. Public
// discovery, keyword search and own-content adapters remain in their own feeds.
export const FOLLOWING_EXCLUDED_SOURCE_IDS = CONNECTED_SOCIAL_PLATFORMS.filter(
  source => FEED_SOURCE_CATALOG.following[source] !== 'following',
);

// Shared by the desktop feed rail and the mobile app menu. Keeping this
// vocabulary here prevents the two controls from quietly drifting apart.
export const HOME_FEED_SOURCE_IDS = [...new Set([
  ...FEED_SOURCE_CATALOG.home,
  ...Object.keys(ACCOUNT_DIRECTORY).filter(source => ACCOUNT_DIRECTORY[source].feedSupported === true),
])];

export const FOLLOWING_FEED_SOURCE_IDS = [
  'uficonnect',
  ...Object.entries(FEED_SOURCE_CATALOG.following).filter(([, capability]) => capability === 'following').map(([source]) => source),
];

export const SOURCE_WEBSITE_IDS = Object.keys(ACCOUNT_DIRECTORY).filter(
  source => !HOME_FEED_SOURCE_IDS.includes(source) && !FOLLOWING_FEED_SOURCE_IDS.includes(source),
);
