import { openProtocolVideo } from '../../../backend/video-media-urls.mjs';

// Open-protocol APIs supply playable attachments/playlists. Other source
// videos use an approved embed or an explicit backend playback authorization.
export function directMediaPlaybackAllowed(post) {
  if (!post || typeof post !== 'object') return false;
  if (post.directPlaybackAuthorized === true) return true;
  if (openProtocolVideo(post)) return true;
  return post.isExternal !== true && (['uficonnect', 'livecamera'].includes(post.source) || (!post.source && post.isExternal === false));
}

function sourceUrl(value, hosts) {
  if (typeof value !== 'string' || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !hosts.includes(url.hostname)) return null;
    return url;
  } catch { return null; }
}

export function officialYouTubeId(value) {
  const url = sourceUrl(value, ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be']);
  if (!url) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const id = url.hostname === 'youtu.be' && parts.length === 1 ? parts[0]
    : parts.length === 1 && parts[0] === 'watch' && url.searchParams.getAll('v').length === 1 ? url.searchParams.get('v')
      : parts.length === 2 && ['embed', 'shorts', 'live'].includes(parts[0]) ? parts[1] : null;
  return /^[\w-]{11}$/.test(id || '') ? id : null;
}

export function officialVimeoId(value) {
  const url = sourceUrl(value, ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
  if (!url) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts.length === 1 ? parts[0] : parts.length === 2 && parts[0] === 'video' ? parts[1] : null;
  return /^\d+$/.test(id || '') ? id : null;
}

export function officialTwitchClipId(value) {
  const url = sourceUrl(value, ['clips.twitch.tv', 'twitch.tv', 'www.twitch.tv']);
  if (!url || value.length > 2048) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const id = url.hostname === 'clips.twitch.tv' && /^\/[^/]+\/?$/.test(url.pathname) ? parts[0]
    : ['twitch.tv', 'www.twitch.tv'].includes(url.hostname) && parts.length === 3 && /^\/[a-zA-Z0-9_]{1,25}\/clip\/[^/]+\/?$/.test(url.pathname) ? parts[2] : null;
  return /^[A-Za-z0-9_-]{1,140}$/.test(id || '') && !['embed', 'create'].includes(id) ? id : null;
}

export function officialTwitchClipUrl(value) {
  const id = officialTwitchClipId(value);
  return id ? `https://clips.twitch.tv/${id}` : null;
}

// Twitch clip iframes require the hostname actually serving the parent page.
// Incoming embed URLs/parent values never supply this parameter.
export function officialTwitchClipEmbedUrl(value, parentHostname) {
  const id = officialTwitchClipId(value);
  if (!id || typeof parentHostname !== 'string' || parentHostname.length > 253
    || !parentHostname.split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))) return null;
  const params = new URLSearchParams({ clip: id, parent: parentHostname.toLowerCase(), autoplay: 'false' });
  return `https://clips.twitch.tv/embed?${params}`;
}

export function officialTwitchPosterUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !['twitch.tv', 'jtvnw.net', 'ttvnw.net'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    return url.href;
  } catch { return null; }
}
