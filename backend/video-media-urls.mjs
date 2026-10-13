// Shared URL checks for API-supplied media. Never derive a stream from a poster.
export function publicMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const url = new URL(value.replace(/&amp;/gi, '&'));
    const host = url.hostname;
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || !host.includes('.') || host.endsWith('.') || host.includes(':')
      || /^(?:\d+\.){3}\d+$/.test(host)
      || /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host)
      || !host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return null;
    return url.href;
  } catch { return null; }
}

export function officialVideoReference(value) {
  const safe = publicMediaUrl(value);
  if (!safe) return null;
  const url = new URL(safe), parts = url.pathname.split('/').filter(Boolean);
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be'].includes(url.hostname)) {
    const id = url.hostname === 'youtu.be' && parts.length === 1 ? parts[0]
      : parts.length === 1 && parts[0] === 'watch' && url.searchParams.getAll('v').length === 1 ? url.searchParams.get('v')
        : parts.length === 2 && ['embed', 'shorts', 'live'].includes(parts[0]) ? parts[1] : null;
    return /^[\w-]{11}$/.test(id || '') ? { kind: 'youtube', id, url: safe, vertical: parts[0] === 'shorts' } : null;
  }
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(url.hostname)) {
    const id = parts.length === 1 ? parts[0] : parts.length === 2 && parts[0] === 'video' ? parts[1] : null;
    return /^\d{1,20}$/.test(id || '') ? { kind: 'vimeo', id, url: safe } : null;
  }
  return null;
}

export function suppliedHlsUrl(value) {
  const safe = publicMediaUrl(value);
  return safe && /\.m3u8$/i.test(new URL(safe).pathname) ? safe : null;
}

export function suppliedVideoFileUrl(value) {
  const safe = publicMediaUrl(value);
  return safe && /\.(?:mp4|webm|mov|m4v|ogv)$/i.test(new URL(safe).pathname) ? safe : null;
}

export function canonicalOpenVideoPost(post) {
  const safe = publicMediaUrl(post?.sourceUrl);
  if (!safe) return null;
  const url = new URL(safe);
  if (post.source === 'bluesky') return url.hostname === 'bsky.app'
    && /^\/profile\/[^/]+\/post\/[a-zA-Z0-9]+\/?$/.test(url.pathname) ? safe : null;
  if (post.source === 'mastodon') return /^\/@[a-zA-Z0-9_.-]+\/\d+\/?$/.test(url.pathname)
    || /^\/users\/[a-zA-Z0-9_.-]+\/statuses\/\d+\/?$/.test(url.pathname) ? safe : null;
  return null;
}

export function openProtocolVideo(post) {
  if (post?.mediaType !== 'video' || !canonicalOpenVideoPost(post)) return null;
  if (post.source === 'bluesky') {
    const src = suppliedHlsUrl(post.mediaUrl);
    return src ? { kind: 'hls', src } : null;
  }
  if (post.source === 'mastodon') {
    const src = suppliedVideoFileUrl(post.mediaUrl);
    if (src) return { kind: 'file', src };
    // Mastodon supplies an attachment type even when its CDN uses a path
    // without a file extension. Posters and provider watch pages are not files.
    const safe = publicMediaUrl(post.mediaUrl);
    if (!safe || officialVideoReference(safe)) return null;
    const url = new URL(safe), filename = url.pathname.split('/').pop();
    if (filename && !filename.includes('.') && url.pathname !== new URL(post.sourceUrl).pathname) return { kind: 'file', src: safe };
  }
  return null;
}
