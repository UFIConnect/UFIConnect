export function safePostLink(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export const isMemberPost = post => post?.source === 'uficonnect' || (!post?.source && post?.isExternal !== true);

// Only identifiers supplied by a source or encoded in its canonical post URL
// identify an author. A display name is not a YouTube handle or channel ID.
export function sourceAuthorProfileUrl(post) {
  for (const value of [post?.author?.profileUrl, post?.author?.url, post?.authorProfileUrl, post?.authorUrl]) {
    const safe = safePostLink(value);
    if (safe) return safe;
  }
  const source = String(post?.source || '').toLowerCase();
  const id = String(post?.author?.id || post?.authorId || '');
  const identifier = prefix => id.startsWith(prefix) ? id.slice(prefix.length) : '';
  const handle = value => /^[A-Za-z0-9_-]{1,80}$/.test(value || '') ? value : null;
  if (source === 'youtube') {
    const channel = post.channelId || post.author?.channelId || identifier('youtube_channel_') || identifier('youtube_');
    if (/^UC[A-Za-z0-9_-]{22}$/.test(channel || '')) return `https://www.youtube.com/channel/${channel}`;
  }
  if (source === 'reddit') {
    const name = handle(identifier('reddit_')) || handle(String(post.author?.name || '').replace(/^u\//, ''));
    if (name && !['deleted', 'unknown', 'reddit'].includes(name.toLowerCase())) return `https://www.reddit.com/user/${name}/`;
  }
  if (source === 'hackernews') {
    const name = handle(identifier('hn_')) || handle(post.author?.name);
    if (name) return `https://news.ycombinator.com/user?id=${encodeURIComponent(name)}`;
  }
  if (source === 'lobsters') {
    const name = handle(identifier('lobsters_')) || handle(post.author?.name);
    if (name) return `https://lobste.rs/u/${name}`;
  }
  if (source === 'stackoverflow' && /^so_\d+$/.test(id)) return `https://stackoverflow.com/users/${identifier('so_')}`;
  if (source === 'github' && handle(identifier('github_'))) return `https://github.com/${identifier('github_')}`;
  if (source === 'gitlab' && handle(post.author?.username)) return `https://gitlab.com/${post.author.username}`;
  const original = safePostLink(post?.sourceUrl);
  if (!original) return null;
  const url = new URL(original), host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  if (source === 'bluesky' && host === 'bsky.app' && parts[0] === 'profile' && parts[1] && parts[2] === 'post') {
    return `https://bsky.app/profile/${parts[1]}`;
  }
  if (source === 'mastodon' && /^@[A-Za-z0-9_.-]+$/.test(parts[0] || '') && /^\d+$/.test(parts[1] || '')) {
    return `${url.origin}/${parts[0]}`;
  }
  if (['twitter', 'x'].includes(source) && ['twitter.com', 'x.com'].includes(host)
    && /^[A-Za-z0-9_]{1,15}$/.test(parts[0] || '') && parts[0] !== 'i' && parts[1] === 'status') {
    return `${url.origin}/${parts[0]}`;
  }
  if (source === 'tiktok' && host === 'tiktok.com' && /^@[A-Za-z0-9_.]+$/.test(parts[0] || '') && parts[1] === 'video') {
    return `${url.origin}/${parts[0]}`;
  }
  if (source === 'devto' && host === 'dev.to' && handle(parts[0]) && parts.length === 2) return `https://dev.to/${parts[0]}`;
  if (source === 'medium' && host === 'medium.com' && /^@[A-Za-z0-9_.-]+$/.test(parts[0] || '')) return `https://medium.com/${parts[0]}`;
  if (source === 'github' && host === 'github.com' && handle(parts[0]) && parts.length === 2) return `https://github.com/${parts[0]}`;
  return null;
}

export function postProfileLink(post, currentUserId) {
  if (isMemberPost(post)) {
    const id = post?.authorId || post?.author?.id;
    return id ? { to: id === currentUserId ? '/profile' : `/u/${encodeURIComponent(id)}`, fallback: false } : null;
  }
  const href = sourceAuthorProfileUrl(post);
  if (href) return { href, fallback: false };
  const original = safePostLink(post?.sourceUrl);
  return original ? { href: original, fallback: true } : null;
}
