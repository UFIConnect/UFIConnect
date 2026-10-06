import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { SOURCE_META } from './sourceMeta';
import { useToast } from '../contexts/ToastContext';
import ReportPostButton from './ReportPostButton';
import './PostCardChrome.css';

// Shared post-card chrome: author header with the source's own badge, the
// original post time, compact actions and an "Open on <source>" link. Every
// accent uses the source's brand colour from SOURCE_META.
export const postSource = post => SOURCE_META[post?.source] || SOURCE_META.uficonnect;

// Identifies an external account (e.g. "mastodon:@name@server") for member-level blocking.
export function feedAccountKey(post) {
  const account = String(post?.sourceLabel || post?.author?.id || post?.author?.name || '').trim().toLowerCase();
  return post?.source && account ? `${post.source}:${account}`.slice(0, 200) : '';
}

function validDate(value) {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date : null;
}

// Show the age of the latest version the source reports, with an Edited label
// when the post was edited after publishing. The full date
// stays in the tooltip and the accessible label.
export function postTimes(post) {
  const created = validDate(post?.createdAt || post?.time);
  if (!created) return null;
  const editedAt = validDate(post?.editedAt);
  const edited = Boolean(editedAt && editedAt.getTime() - created.getTime() > 60_000);
  const latest = edited ? editedAt : created;
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const day = latest.toDateString() === now.toDateString() ? 'Today'
    : latest.toDateString() === yesterday.toDateString() ? 'Yesterday'
      : latest.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(latest.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  const time = latest.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const full = latest.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });
  const seconds = Math.max(0, Math.floor((now.getTime() - latest.getTime()) / 1000));
  const [unit, size] = seconds >= 31_536_000 ? ['year', 31_536_000]
    : seconds >= 2_592_000 ? ['month', 2_592_000]
      : seconds >= 86_400 ? ['day', 86_400]
        : seconds >= 3600 ? ['hour', 3600] : ['minute', 60];
  const relative = seconds < 60 ? 'Just now'
    : new Intl.RelativeTimeFormat('en', { numeric: 'always' }).format(-Math.floor(seconds / size), unit);
  return { day, time, relative, edited, iso: latest.toISOString(), full: `${edited ? 'Edited' : 'Posted'} ${full}` };
}

const initialsOf = name => String(name || '').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || '·';

function SourceBadge({ source, src }) {
  return (
    <span className="post-chrome-badge" style={{ '--source-color': src.color }} aria-hidden="true">
      {hasBrandIcon(source) ? <BrandIcon platform={source} size={13} /> : <b>{src.icon}</b>}
    </span>
  );
}

// Author avatars: the author's photo when the source provides one (tap to view
// it full size), otherwise their initials in the source colour, or the
// source's own mark for publishers. External authors carry the source badge.
export function PostAvatar({ post, member = false, onView }) {
  const src = postSource(post);
  const avatarUrl = post?.author?.avatarUrl;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [avatarUrl]);
  const publisher = !member && (!post?.author?.name || post.author.name === src.label);
  if (publisher && !avatarUrl) {
    return (
      <span className="post-chrome-avatar post-chrome-avatar-source" style={{ '--source-color': src.color }} aria-hidden="true">
        {hasBrandIcon(post.source) ? <BrandIcon platform={post.source} size={26} /> : <b>{src.icon}</b>}
      </span>
    );
  }
  const photo = avatarUrl && !failed;
  const content = (
    <>
      {photo ? <img src={avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <b>{initialsOf(post?.author?.name)}</b>}
      {!member && <SourceBadge source={post.source} src={src} />}
    </>
  );
  const style = { '--source-color': member ? 'var(--primary)' : src.color };
  if (photo && onView) {
    return (
      <button type="button" className="post-chrome-avatar post-chrome-avatar-button" style={style}
        aria-label={`View ${post?.author?.name || 'author'}'s profile photo`} onClick={() => onView(avatarUrl)}>
        {content}
      </button>
    );
  }
  return <span className="post-chrome-avatar" style={style} aria-hidden="true">{content}</span>;
}

// A full-size view of an author's profile photo; Escape, the backdrop or Close dismiss it.
export function ProfilePhotoViewer({ url, name, handle, profileTo, onClose }) {
  const closeButton = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    const escape = event => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('keydown', escape); previous?.focus?.(); };
  }, [onClose]);
  return (
    <div className="post-chrome-photo-viewer" role="dialog" aria-modal="true" aria-label={`${name}'s profile photo`}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <figure>
        <img src={url} alt={`${name}'s profile photo`} referrerPolicy="no-referrer" />
        <figcaption>
          <strong>{name}</strong>
          {handle && <span>{handle}</span>}
          <span className="post-chrome-photo-actions">
            {profileTo && <Link to={profileTo} onClick={onClose}>View profile</Link>}
            <button ref={closeButton} type="button" onClick={onClose}>Close</button>
          </span>
        </figcaption>
      </figure>
    </div>
  );
}

export function postHandle(post, member = false) {
  const src = postSource(post);
  if (member) return [post?.author?.title, post?.author?.organization].filter(Boolean).join(' · ');
  const label = String(post?.sourceLabel || '').trim();
  if (label && label !== src.label && label !== post?.author?.name) return label;
  if (post?.author?.name && post.author.name !== src.label) return src.label;
  try { return post?.sourceUrl ? new URL(post.sourceUrl).hostname.replace(/^www\./, '') : src.label; } catch { return src.label; }
}

// One timestamp at the top right: when the post was published, or last edited.
export function PostTime({ post, live = false }) {
  if (live) return <span className="post-chrome-time"><span className="post-chrome-live">Live feed</span></span>;
  const times = postTimes(post);
  if (!times) return null;
  return (
    <Link to={`/p/${encodeURIComponent(post.id)}`} className="post-chrome-time" title={times.full} aria-label={times.full}>
      <time dateTime={times.iso}><span className="post-chrome-day">{times.edited ? 'Edited ? ' : ''}{times.relative}</span></time>
    </Link>
  );
}

export function PostHeader({ post, member = false, to }) {
  const src = postSource(post);
  const name = post?.author?.name || src.label;
  const handle = postHandle(post, member);
  const [viewing, setViewing] = useState('');
  const closeViewer = useCallback(() => setViewing(''), []);
  const who = (
    <span className="post-chrome-who">
      <span className="post-chrome-name">{name}</span>
      <span className="post-chrome-handle-row">
        <span className="post-chrome-handle">{handle}</span>
        {post?.topic && <span className="post-chrome-topic">{post.topic}</span>}
      </span>
    </span>
  );
  return (
    <div className="post-chrome-header">
      <PostAvatar post={post} member={member} onView={setViewing} />
      {to ? <Link to={to} className="post-chrome-identity">{who}</Link> : <div className="post-chrome-identity">{who}</div>}
      <div className="post-chrome-corner">
        <PostTime post={post} live={post?.isLiveCamera} />
        <ReportPostButton post={post} />
      </div>
      {viewing && <ProfilePhotoViewer url={viewing} name={name} handle={handle} profileTo={to} onClose={closeViewer} />}
    </div>
  );
}

export function CommentIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20l1.2-4.3A8 8 0 0 1 3 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z" /></svg>;
}
export function HeartIcon({ filled }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8Z" /></svg>;
}
function ShareIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3m0 0-4 4m4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>;
}

// The "more" button opens the post's options. Each item is
// { label, detail?, danger?, busy?, ariaLabel?, onSelect }; hidden items are left out.
export function PostOptionsMenu({ items = [] }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef(null), button = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!wrapper.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const visible = items.filter(Boolean);
  if (!visible.length) return null;
  return (
    <div className="post-chrome-more" ref={wrapper}>
      <button ref={button} type="button" className="post-chrome-action" aria-label="More options" aria-haspopup="menu" aria-expanded={open} title="More options" onClick={() => setOpen(value => !value)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {open && (
        <div className="post-chrome-menu" role="menu">
          {visible.map(item => (
            <button key={item.label} type="button" role="menuitem" className={item.danger ? 'post-chrome-menu-danger' : undefined}
              aria-label={item.ariaLabel} disabled={item.busy} onClick={() => { setOpen(false); item.onSelect(); }}>
              {item.busy ? `${item.label}…` : item.label}{item.detail && <small>{item.detail}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SharePostButton({ post }) {
  const { showToast } = useToast();
  async function share(event) {
    event.preventDefault(); event.stopPropagation();
    const url = post?.sourceUrl || `${window.location.origin}/p/${encodeURIComponent(post.id)}`;
    try {
      if (navigator.share) { await navigator.share({ title: post?.title || 'UFIconnect post', url }); return; }
      await navigator.clipboard.writeText(url);
      showToast('Link copied', 'success');
    } catch (error) {
      if (error?.name !== 'AbortError') showToast('Could not share this post. Copy the link from the post page instead.', 'error');
    }
  }
  return <button type="button" className="post-chrome-action" aria-label="Share post" title="Share post" onClick={share}><ShareIcon /></button>;
}

// Compact source link that sits in the action row: the source's own mark and
// an arrow, named for screen readers ("Open on Reddit", "Apply on Indeed").
export function OpenOnSource({ post, label, onClick }) {
  const src = postSource(post);
  if (!post?.sourceUrl) return null;
  const name = label || `Open on ${src.label}`;
  return (
    <a className="post-chrome-action post-chrome-source-link" href={post.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={onClick} style={{ '--source-color': src.color }} aria-label={name} title={name}>
      <span className="post-chrome-open-mark" aria-hidden="true">{hasBrandIcon(post.source) ? <BrandIcon platform={post.source} size={16} /> : <b>{src.icon}</b>}</span>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
    </a>
  );
}
