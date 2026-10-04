import { HeartIcon, postSource } from './PostCardChrome';

export default function PostLikes({ post }) {
  const external = post.isExternal || !['uficonnect', 'livecamera', 'restaurants'].includes(post.source || 'uficonnect');
  const sourceCount = post.sourceLikesCount ?? (post.likesScope !== 'uficonnect' ? post.likesCount : null);
  const fromSource = external && sourceCount != null && Number.isFinite(Number(sourceCount));
  const value = fromSource ? sourceCount : post.likesAvailable === false ? null : post.likesCount;
  const count = value == null ? null : Math.max(0, Math.floor(Number(value) || 0));
  const label = fromSource && ['github', 'gitlab'].includes(post.source) ? 'stars' : 'likes';
  const provider = fromSource ? postSource(post).label : 'UFIconnect';
  return <span className="post-chrome-like post-chrome-like-counted" title={`${provider} ${label}`}>
    <HeartIcon />
    <span className="post-chrome-like-count" aria-label={count === null ? `${label} unavailable` : `${count.toLocaleString()} ${label}`}>
      {count === null ? '—' : count.toLocaleString()} {label}
    </span>
  </span>;
}
