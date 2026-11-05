// Source permissions are engineering controls, not a grant of platform access.
// An available API still requires the member's OAuth scopes and provider approval.
// Keep analytics permission separate from a deployed collector's availability.
const { mastodonPostUrl, mastodonCanInteract } = require('./mastodon-oauth');
const SOURCE_COMMANDS = require('../shared/source-post-commands.json');
const { youtubeCanInteract } = require('./youtube-permissions');
const POLICY_VERSION = '2026-10-06';
const METRICS_NOTICE = 'Engagement metrics are provided by the original source. The source determines whether playback qualifies as a view.';
const NEVER = Object.freeze({ directRehosting: false, cacheVideo: false, scrapingFallback: false, mediaExtraction: false, syntheticMetrics: false });
const SOURCES = {
  youtube: { label: 'YouTube', hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'], actions: true, player: true, metrics: true, docs: 'https://developers.google.com/youtube/v3/docs/videos/rate', note: 'OAuth scopes and API approval apply. The videos.rate API does not promise a change to the public like count.' },
  tiktok: { label: 'TikTok', hosts: ['tiktok.com', 'www.tiktok.com'], player: true, metrics: true, docs: 'https://developers.tiktok.com/doc/embed-player', note: 'Use the source player. Display API access and creator statistics require approved products and scopes.' },
  instagram: { label: 'Instagram', hosts: ['instagram.com', 'www.instagram.com'], metrics: true, docs: 'https://developers.facebook.com/docs/instagram-platform/', note: 'Professional account products, permissions and app review vary. Consumer likes are not implemented.' },
  facebook: { label: 'Facebook', hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com'], metrics: true, docs: 'https://developers.facebook.com/docs/graph-api/', note: 'Page and business access requires the relevant permissions. General consumer interactions are not implemented.' },
  threads: { label: 'Threads', hosts: ['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'], metrics: true, docs: 'https://developers.facebook.com/docs/threads/', note: 'Enable only reviewed Threads API products and account scopes. No interaction adapter is installed.' },
  twitter: { label: 'X', hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'], actions: true, metrics: true, maxLength: 280, docs: 'https://docs.x.com/x-api/posts/likes/introduction', note: 'API access tier and user authorization determine available metrics and writes.' },
  bluesky: { label: 'Bluesky', hosts: ['bsky.app'], actions: true, metrics: true, maxLength: 300, docs: 'https://docs.bsky.app/docs/advanced-guides/posts', note: 'Writes use the connected member session and the AT Protocol record APIs.' },
  mastodon: { label: 'Mastodon', hosts: ['mastodon.social', 'mastodon.online'], actions: true, maxLength: 500, metrics: true, docs: 'https://docs.joinmastodon.org/methods/statuses/', note: 'Instance rules and OAuth scopes apply. Federated post URLs are resolved on the connected member server before interactions.' },
  reddit: { label: 'Reddit', hosts: ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'oauth.reddit.com'], actions: true, metrics: true, likeLabel: 'Upvote', docs: 'https://www.reddit.com/dev/api/', note: 'Approved API access and member scopes are required. Votes are source actions, not local counts.' },
  linkedin: { label: 'LinkedIn', hosts: ['linkedin.com', 'www.linkedin.com'], metrics: true, docs: 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/', note: 'Community Management access, organization roles and app approval apply.' },
  pinterest: { label: 'Pinterest', hosts: ['pinterest.com', 'www.pinterest.com'], metrics: true, docs: 'https://developers.pinterest.com/docs/api/v5/', note: 'Account and business analytics require approved access and the relevant scopes.' },
  snapchat: { label: 'Snapchat', hosts: ['snapchat.com', 'www.snapchat.com'], metrics: true, docs: 'https://developers.snap.com/marketing-api/Public-Profile-API/Introduction', note: 'Public Profile and partner products control access. Private account analytics are not universal.' },
  twitch: { label: 'Twitch', hosts: ['twitch.tv', 'www.twitch.tv', 'clips.twitch.tv'], player: true, metrics: true, docs: 'https://dev.twitch.tv/docs/embed/', note: 'Official embeds require HTTPS and a configured parent domain. Creator and extension analytics have separate access requirements.' },
  vimeo: { label: 'Vimeo', hosts: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'], player: true, metrics: true, docs: 'https://developer.vimeo.com/api/reference', note: 'Video privacy, embed settings, account plans and API scopes determine availability.' },
  tumblr: { label: 'Tumblr', hosts: ['tumblr.com', 'www.tumblr.com'], metrics: true, docs: 'https://www.tumblr.com/docs/en/api/v2', note: 'OAuth and the official API govern available notes and interactions. No interaction adapter is installed.' },
  discord: { label: 'Discord', hosts: ['discord.com', 'www.discord.com'], docs: 'https://docs.discord.com/developers/intro', note: 'Only authorized bot/app channel access is appropriate. User-token automation and private-server aggregation are not implemented.' },
  github: { label: 'GitHub', hosts: ['github.com', 'www.github.com'], actions: true, metrics: true, likeLabel: 'Star repository', docs: 'https://docs.github.com/en/rest/activity/starring', note: 'Repository stars and issue comments require the acting member permissions.' },
  gitlab: { label: 'GitLab', hosts: ['gitlab.com', 'www.gitlab.com'], actions: true, metrics: true, likeLabel: 'Star project', docs: 'https://docs.gitlab.com/api/projects/', note: 'Only GitLab.com is configured. Project stars and notes require the acting member permissions.' },
};

function freezeDeep(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
  return value;
}

// Each adapter keeps its own access and lifecycle contract. These describe
// controls in this application; they do not assert that a provider approved it.
function adapterRules(source, info) {
  const authentication = source === 'bluesky' ? 'Connected AT Protocol session; validated PDS origin'
    : source === 'mastodon' ? 'Instance-specific authorization; canonical status URLs resolved by the connected server'
      : ['github', 'gitlab'].includes(source) ? 'Connected member token with repository or project permissions'
        : 'Provider authorization and product-specific scopes; API approval where required';
  return {
    authentication: { requirement: authentication, credentialLogging: false },
    api: { documentation: info.docs, scrapingFallback: false, accessReviewRequired: true },
    display: { sourceIdentityRequired: true, originalLinkRequired: true, preserveSafetyLabels: true, officialPlayer: Boolean(info.player) },
    trademark: { attributionOnly: true, endorsementClaimAllowed: false },
    // These limits apply to creator-metric snapshots. Feed metadata and provider
    // media have separate storage paths; no universal platform cache grant exists.
    caching: { videoFilesAllowed: false, metricSnapshotFreshnessMs: 15 * 60000, metricSnapshotRetentionMs: 86400000 },
    deletion: { invalidateMetricsOnDisconnect: true, sourceRemovalRequiresSeparateAction: true },
    interactions: { explicitMemberActionRequired: true, implemented: Boolean(info.actions), metricLabel: SOURCE_COMMANDS[source]?.reaction || info.likeLabel || 'Like' },
    analytics: { authorizationRequired: true, syntheticMetricsAllowed: false, sourceDecidesQualifiedView: true },
    reporting: { destination: 'uficonnect_review', automaticProviderTakedown: false },
  };
}

const SOURCE_POLICY = freezeDeep(Object.fromEntries(Object.entries(SOURCES).map(([source, info]) => [source, {
  source, label: info.label, hosts: info.hosts, likeLabel: SOURCE_COMMANDS[source]?.reaction || info.likeLabel || 'Like',
  commentLabel: SOURCE_COMMANDS[source]?.discussion || 'Comment', maxLength: info.maxLength || 1000,
  version: POLICY_VERSION, documentation: [info.docs], note: info.note,
  rules: adapterRules(source, info),
  // Status describes the access review; enabled describes our runtime support.
  capabilities: {
    displayPost: { status: 'requires_approval', enabled: true },
    officialPlayer: { status: info.player ? 'allowed' : 'requires_approval', enabled: Boolean(info.player) },
    like: { status: info.actions ? 'requires_approval' : 'dont_implement', enabled: Boolean(info.actions) },
    comment: { status: info.actions ? 'requires_approval' : 'dont_implement', enabled: Boolean(info.actions) },
    sourceAnalytics: { status: info.metrics ? 'requires_approval' : 'dont_implement', enabled: Boolean(info.metrics) },
    creatorAnalytics: { status: 'requires_approval', enabled: source === 'youtube' },
    sourceMonetization: { status: 'requires_approval', enabled: source === 'youtube' },
    ...Object.fromEntries(Object.keys(NEVER).map(key => [key, { status: 'dont_implement', enabled: false }])),
  },
  originalLinkRequired: true, attributionRequired: true, metricsNotice: METRICS_NOTICE,
}])));

function normalizeSource(value) {
  if (typeof value !== 'string') return '';
  const key = value.toLowerCase().trim();
  return key === 'x' ? 'twitter' : key;
}
function enabledBySetting(value) { return value === undefined || /^(true|1|yes|on)$/i.test(String(value).trim()); }
function getSourcePolicy(value, { env = process.env } = {}) {
  const source = normalizeSource(value), definition = Object.hasOwn(SOURCE_POLICY, source) ? SOURCE_POLICY[source] : null;
  if (!definition) return null;
  const prefix = `SOURCE_${source.toUpperCase()}`;
  const enabled = enabledBySetting(env.SOURCE_ACCESS_ENABLED) && enabledBySetting(env[`${prefix}_ENABLED`]);
  const capabilities = Object.fromEntries(Object.entries(definition.capabilities).map(([key, info]) => {
    const name = key.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
    const interaction = key === 'like' || key === 'comment';
    return [key, { ...info, enabled: info.enabled && enabled && enabledBySetting(env[`${prefix}_${name}_ENABLED`]) && (!interaction || enabledBySetting(env.SOURCE_INTERACTIONS_ENABLED)) }];
  }));
  return { ...definition, enabled, capabilities, features: Object.fromEntries(Object.entries(capabilities).map(([key, info]) => [key, info.enabled])) };
}
function listSourcePolicies(options) { return Object.keys(SOURCE_POLICY).map(source => getSourcePolicy(source, options)); }
function isSourceActionAllowed(source, action, options) {
  if (action !== 'like' && action !== 'comment') return false;
  return getSourcePolicy(source, options)?.features[action] === true;
}
function isSourceDisplayAllowed(source, options) {
  const key = String(source || '').toLowerCase();
  // Public research metadata has no member OAuth or interaction adapter, but
  // the same operator display switches still revoke collection and cached reads.
  if (['crossref', 'datacite', 'zenodo', 'openalex'].includes(key)) {
    const env = options?.env || process.env;
    return enabledBySetting(env.SOURCE_ACCESS_ENABLED)
      && enabledBySetting(env[`SOURCE_${key.toUpperCase()}_ENABLED`])
      && enabledBySetting(env[`SOURCE_${key.toUpperCase()}_DISPLAY_POST_ENABLED`]);
  }
  const policy = getSourcePolicy(source, options);
  // Native content and connectors outside this review keep their own policy.
  return !policy || (policy.enabled && policy.features.displayPost);
}
function getInteractionCapabilities(user, options) {
  return Object.fromEntries(listSourcePolicies(options).map(policy => [policy.source, {
    label: policy.label, likeLabel: policy.likeLabel, commentLabel: policy.commentLabel, maxLength: policy.maxLength,
    connected: Boolean(user?.socialTokens?.[policy.source]),
    like: policy.features.like && (policy.source !== 'mastodon' || mastodonCanInteract(user?.socialTokens?.mastodon, 'like'))
      && (policy.source !== 'youtube' || !user?.socialTokens?.youtube || youtubeCanInteract(user?.socialGrantedScopes?.youtube, 'like')),
    comment: policy.features.comment && (policy.source !== 'mastodon' || mastodonCanInteract(user?.socialTokens?.mastodon, 'comment'))
      && (policy.source !== 'youtube' || !user?.socialTokens?.youtube || youtubeCanInteract(user?.socialGrantedScopes?.youtube, 'comment')),
    ...(policy.source === 'youtube' ? { reconnectRequired: Boolean(user?.socialTokens?.youtube)
      && (!youtubeCanInteract(user?.socialGrantedScopes?.youtube, 'like') || !youtubeCanInteract(user?.socialGrantedScopes?.youtube, 'comment')) } : {}),
    ...(policy.source === 'mastodon' ? { reconnectRequired: Boolean(user?.socialTokens?.mastodon) && !mastodonCanInteract(user.socialTokens.mastodon) } : {}),
    fallback: { like: `${policy.likeLabel} on ${policy.label}`, comment: `${policy.commentLabel} on ${policy.label}` },
    metricsNotice: METRICS_NOTICE,
  }]));
}

function validateOriginalUrl(source, value, { env = process.env } = {}) {
  const policy = getSourcePolicy(source, { env });
  if (!policy || typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value) || !value.startsWith('https://')) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  // URL normalizes :443 away, so reject explicit ports in the original authority.
  const authority = value.slice(8).split(/[/?#]/, 1)[0];
  if (url.protocol !== 'https:' || url.username || url.password || url.port || authority.includes(':') || url.hostname.endsWith('.')) return null;
  // A Mastodon original may live on any federated server. Only status URLs
  // qualify; provider writes always go to the member's authorized server.
  if (policy.source === 'mastodon') return mastodonPostUrl(value);
  let permitted = policy.hosts.includes(url.hostname.toLowerCase());
  if (!permitted && policy.source === 'tumblr') permitted = /^[a-z0-9][a-z0-9-]*\.tumblr\.com$/.test(url.hostname);
  if (!permitted) return null;
  return url.href;
}

module.exports = { POLICY_VERSION, METRICS_NOTICE, SOURCE_POLICY, normalizeSource, getSourcePolicy, listSourcePolicies, isSourceActionAllowed, isSourceDisplayAllowed, getInteractionCapabilities, validateOriginalUrl };
