// Build source players from canonical post links, never from imported HTML.
// Sources without a supported player keep their original Watch on source link.
function publicUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port
      || host === 'localhost' || host.endsWith('.local') || !host.includes('.')
      || /^[\d.]+$/.test(host) || host.includes(':')) return null;
    return url;
  } catch { return null; }
}

export function officialSnapEmbedUrl(snap) {
  const url = publicUrl(snap?.sourceUrl);
  if (!url) return null;
  const path = url.pathname;
  if (snap.source === 'mastodon' && /^\/@[a-zA-Z0-9_.-]+\/\d+\/?$/.test(path)) {
    return `${url.origin}${path.replace(/\/$/, '')}/embed`;
  }
  if (snap.source === 'bluesky' && url.hostname === 'bsky.app') {
    const match = path.match(/^\/profile\/([^/]+)\/post\/([a-zA-Z0-9]+)\/?$/);
    if (!match) return null;
    let profile;
    try { profile = decodeURIComponent(match[1]); } catch { return null; }
    // The official widget takes an AT URI. A canonical handle is a valid
    // repository authority, including for rows restored from the feed DB.
    if (!/^(?:did:plc:[a-z0-9]+|[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,})$/.test(profile)) return null;
    return `https://embed.bsky.app/embed/${profile}/app.bsky.feed.post/${match[2]}?colorMode=dark`;
  }
  if (snap.source === 'reddit' && ['reddit.com', 'www.reddit.com', 'old.reddit.com'].includes(url.hostname)
    && /^\/r\/[a-zA-Z0-9_]+\/comments\/[a-zA-Z0-9]+(?:\/[^/]+)?\/?$/.test(path)) {
    return `https://www.redditmedia.com${path}?ref_source=embed&ref=share&embed=true`;
  }
  return null;
}
