'use strict';

function publishingOAuthConfig(env) {
  return {
    pinterest: { authUrl: 'https://www.pinterest.com/oauth/', tokenUrl: 'https://api.pinterest.com/v5/oauth/token', clientId: () => env.PINTEREST_CLIENT_ID, clientSecret: () => env.PINTEREST_CLIENT_SECRET, scope: 'user_accounts:read,boards:read,pins:read', basicAuth: true, pkce: false },
    tumblr: { authUrl: 'https://www.tumblr.com/oauth2/authorize', tokenUrl: 'https://api.tumblr.com/v2/oauth2/token', clientId: () => env.TUMBLR_CLIENT_ID, clientSecret: () => env.TUMBLR_CLIENT_SECRET, scope: 'basic offline_access', pkce: false },
    wordpress: { authUrl: 'https://public-api.wordpress.com/oauth2/authorize', tokenUrl: 'https://public-api.wordpress.com/oauth2/token', clientId: () => env.WORDPRESS_CLIENT_ID, clientSecret: () => env.WORDPRESS_CLIENT_SECRET, scope: 'users sites', pkce: false },
  };
}
const PUBLISHING_SCOPES = {
  discord: 'identify webhook.incoming', figma: 'current_user:read file_comments:read file_comments:write',
  gitlab: 'read_user api', youtube: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload',
  twitch: 'user:read:follows user:write:chat', medium: 'basicProfile publishPost', dribbble: 'public upload',
  pinterest: 'pins:write', tumblr: 'write', wordpress: 'posts media',
};
function publishingScope(platform, current) {
  const additional = Object.hasOwn(PUBLISHING_SCOPES, platform) ? PUBLISHING_SCOPES[platform] : '';
  const existing = typeof current === 'string' ? current.trim() : '';
  return additional ? [...new Set(`${existing} ${additional}`.trim().split(/[\s,]+/))].join(['pinterest', 'medium'].includes(platform) ? ',' : ' ') : existing;
}
const YOUTUBE_UPLOAD_SCOPES = new Set(['youtube.upload', 'youtube', 'youtubepartner', 'youtube.force-ssl']
  .map(scope => `https://www.googleapis.com/auth/${scope}`));
function youtubeCanUpload(scopes) {
  return Array.isArray(scopes) && scopes.some(scope => YOUTUBE_UPLOAD_SCOPES.has(scope));
}
function youtubeGrantedScopes(response, requested, publishing) {
  // Google reports the granted set after granular consent. An omitted scope
  // means the requested set, per OAuth; it must come from our signed state.
  const value = response?.scope === undefined ? requested : response.scope;
  const granted = typeof value === 'string' ? [...new Set(value.split(/\s+/).filter(Boolean))] : [];
  if (publishing && !youtubeCanUpload(granted)) {
    throw Object.assign(new Error('Connect YouTube and allow video uploads to publish.'), { oauthReason: 'publishing_permission_required' });
  }
  return granted;
}
function discordPublishingToken(accessToken, response, publishing) {
  if (!publishing) return accessToken;
  const webhook = response?.webhook;
  if (typeof accessToken !== 'string' || !accessToken.trim() || /[\s\x00-\x1f]/.test(accessToken) ||
      !webhook || !/^\d{6,25}$/.test(String(webhook.id || '')) || !/^\d{6,25}$/.test(String(webhook.channel_id || '')) || !/^\d{6,25}$/.test(String(webhook.guild_id || '')) ||
      typeof webhook.token !== 'string' || !/^[A-Za-z0-9_.-]{10,250}$/.test(webhook.token)) throw new Error('Discord did not authorize a publishing channel.');
  return JSON.stringify({ accessToken, webhook: { id: String(webhook.id), channel_id: String(webhook.channel_id), guild_id: String(webhook.guild_id), token: webhook.token } });
}
module.exports = { publishingOAuthConfig, publishingScope, discordPublishingToken, youtubeCanUpload, youtubeGrantedScopes };
