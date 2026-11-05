'use strict';

// Keep every YouTube connect entry point on the same permission contract.
// A normal reconnect must not replace publishing/interaction consent with a
// feed-only grant. Google still decides which requested permissions are granted.
const YOUTUBE_SCOPES = Object.freeze([
  'youtube.readonly', 'youtube.upload', 'youtube.force-ssl',
  'yt-analytics.readonly', 'yt-analytics-monetary.readonly',
].map(scope => `https://www.googleapis.com/auth/${scope}`));
function youtubeCanInteract(scopes, action) {
  if (!Array.isArray(scopes)) return false;
  const permitted = action === 'comment' ? ['youtube.force-ssl'] : ['youtube.force-ssl', 'youtube', 'youtubepartner'];
  return permitted.some(scope => scopes.includes(`https://www.googleapis.com/auth/${scope}`));
}
function youtubeNeedsReconnect(user) {
  return Boolean(user?.socialTokens?.youtube) && (!user.socialRefreshTokens?.youtube
    || !YOUTUBE_SCOPES.every(scope => user.socialGrantedScopes?.youtube?.includes(scope)));
}
module.exports = { YOUTUBE_SCOPES, youtubeCanInteract, youtubeNeedsReconnect };
