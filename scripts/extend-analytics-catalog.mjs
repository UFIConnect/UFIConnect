// Fixed navigation constants only. Never derive category names from user data.
import fs from 'node:fs/promises';
import { SOURCE_META, HOME_FEED_SOURCE_IDS, FOLLOWING_FEED_SOURCE_IDS, CONNECTED_SOCIAL_PLATFORMS } from '../web/src/components/sourceMeta.js';
import { CENTERS, CITY_CATEGORIES } from '../web/src/local/localWorkspace.js';
const target = new URL('../shared/analytics-categories.json', import.meta.url);
const catalog = JSON.parse(await fs.readFile(target, 'utf8'));
function entries(group, label, choices) {
  for (const [value, name] of choices) {
    const category = `${group}_${value.replaceAll('-', '_')}`;
    catalog[category] = { category, path: `/analytics-tabs/${group.replaceAll('_', '-')}/${value}`, title: `${label}: ${name}`, label: `${label}: ${name}`, platform: 'web', group: label, viewType: 'tab' };
  }
}
const sources = values => [['all', 'All sources'], ...[...new Set(values)].map(key => [key, SOURCE_META[key]?.label || (key === 'uficonnect' ? 'UFIConnect' : key)])];
entries('command_center_yourfeed_source', 'Your Feed source', sources(['github', 'gitlab', 'youtube', 'reddit', 'twitch', 'instagram', 'tiktok', 'threads', 'bluesky', 'mastodon']).slice(1));
entries('home_source', 'Home source', sources(HOME_FEED_SOURCE_IDS));
entries('following_source', 'Following source', sources(FOLLOWING_FEED_SOURCE_IDS));
const mediaSources = [...HOME_FEED_SOURCE_IDS, 'uficonnect', ...CONNECTED_SOCIAL_PLATFORMS];
entries('video_source', 'Video source', sources(mediaSources));
entries('music_source', 'Music source', sources(mediaSources));
entries('maps_category', 'City category', CITY_CATEGORIES.map(({ id, label }) => [id, label]));
entries('maps_source', 'City source', sources([...mediaSources, 'wordpress', 'wikivoyage', 'travelnews', 'travelevents', 'livecamera', 'localpulse', 'restaurants', 'bars']));
entries('video_mode', 'Video feed', [['feed', 'Videos'], ['following', 'Following']]);
entries('music_mode', 'Music feed', [['feed', 'Music']]);
entries('notification_filter', 'Notification view', [['all', 'All'], ['unread', 'Unread'], ['requests', 'Requests']]);
const inboxSources = [['all', 'All sources'], ['ufi', 'UFIConnect'], ...CONNECTED_SOCIAL_PLATFORMS.map(key => [key, SOURCE_META[key]?.label || key])];
entries('notification_source', 'Notification source', inboxSources);
entries('message_source', 'Message source', inboxSources);
const statuses = [['all', 'All statuses'], ['connected', 'Connected'], ['available', 'Available'], ['membership', 'Membership'], ['soon', 'Coming soon']];
entries('connected_accounts_status', 'Connected accounts status', statuses);
entries('home_accounts_status', 'Home connected accounts status', statuses);
entries('command_center_accounts_status', 'Command Center accounts status', statuses);
const categories = [['all', 'All categories'], ['social', 'Social'], ['video', 'Video and streaming'], ['work', 'Work and development'], ['publishing', 'Publishing'], ['career', 'Career sites'], ['travel', 'Travel'], ['audio', 'Music and audio']];
entries('connected_accounts_category', 'Connected accounts category', categories);
entries('crosspost_category', 'Cross-post category', categories);
entries('business_posts', 'Business posts', [['list', 'Your posts'], ['compare', 'Similar role comparison']]);
catalog.career_posts = { category: 'career_posts', path: '/career-posts', title: 'Business Cross Post', label: 'Business Cross Post', platform: 'web', group: 'Business', viewType: 'page' };
catalog.business_posts = { category: 'business_posts', path: '/business-posts', title: 'Posts & comparisons', label: 'Posts & comparisons', platform: 'web', group: 'Business', viewType: 'page' };
entries('home_panel', 'Home panel', [['sources', 'Sources'], ['accounts', 'Connected accounts'], ['skills', 'Skills'], ['files', 'Attachments']]);
entries('home_directory', 'Home source directory', [['all', 'All sources'], ['favorites', 'Favorites'], ['social', 'Social and community'], ['developer', 'Development and research'], ['news', 'News and articles'], ['creative', 'Design and video'], ['business', 'Startups and business'], ['career', 'Career sites'], ['local', 'Travel and local']]);
for (const center of CENTERS.filter(center => !center.route)) {
  const category = `workspace_${center.id.replaceAll('-', '_')}`;
  catalog[category] = { category, path: `/centers/${center.id}`, title: center.label, label: center.label, platform: 'web', group: 'Workspaces', viewType: 'page' };
}
const json = JSON.stringify(catalog, null, 2) + '\n';
await fs.writeFile(target, json);
await fs.writeFile(new URL('../backend/analytics-categories.json', import.meta.url), json);
console.log(`Analytics catalog: ${Object.keys(catalog).length} fixed categories.`);
