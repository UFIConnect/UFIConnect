// Source social video uses its approved player. Direct playback is reserved
// for native uploads or rights explicitly recorded by the trusted backend.
export function directMediaPlaybackAllowed(post) {
  if (!post || typeof post !== 'object') return false;
  if (post.directPlaybackAuthorized === true) return true;
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
