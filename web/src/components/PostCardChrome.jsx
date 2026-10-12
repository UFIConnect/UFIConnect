import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Martini, Plane, Utensils } from 'lucide-react';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { SOURCE_META } from './sourceMeta';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import ReportModal from './ReportModal';
import NativePostEditor from './NativePostEditor';
import client from '../api/client';
import { isMemberPost, postProfileLink, safePostLink } from '../../../backend/post-links.mjs';
import { sourcePostMenuItems } from '../utils/sourcePostMenu.mjs';
import { publicSiteUrl } from '../utils/publicSiteUrl.mjs';
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
export function ProfilePhotoViewer({ url, name, handle, profileTo, profileHref, onClose }) {
  const dialog = useRef(null), closeButton = useRef(null);
  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow;
    dialog.current.showModal(); document.body.style.overflow = 'hidden';
    closeButton.current?.focus();
    const currentDialog = dialog.current;
    return () => { currentDialog.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return createPortal(
    <dialog ref={dialog} className="post-chrome-photo-viewer" aria-label={`${name}'s profile photo`}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <figure>
        <img src={url} alt={`${name}'s profile photo`} referrerPolicy="no-referrer" />
        <figcaption>
          <strong>{name}</strong>
          {handle && <span>{handle}</span>}
          <span className="post-chrome-photo-actions">
            {profileTo && <Link to={profileTo} onClick={onClose}>View profile</Link>}
            {profileHref && <a href={profileHref} target="_blank" rel="noopener noreferrer" onClick={onClose}>Go to profile</a>}
            <button ref={closeButton} type="button" onClick={onClose}>Close</button>
          </span>
        </figcaption>
      </figure>
    </dialog>, document.body
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
  const original = post?.source === 'mastodon' && safePostLink(post?.sourceUrl);
  if (original) return (
    <a href={original} target="_blank" rel="noopener noreferrer" className="post-chrome-time" title={times.full} aria-label={`${times.full}. Open post on Mastodon`}>
      <time dateTime={times.iso}><span className="post-chrome-day">{times.edited ? 'Edited · ' : ''}{times.relative}</span></time>
    </a>
  );
  return (
    <Link to={`/p/${encodeURIComponent(post.id)}`} className="post-chrome-time" title={times.full} aria-label={times.full}>
      <time dateTime={times.iso}><span className="post-chrome-day">{times.edited ? 'Edited ? ' : ''}{times.relative}</span></time>
    </Link>
  );
}

export function PostHeader({ post, member = false, to }) {
  const { profile } = useAuth();
  const src = postSource(post);
  const name = post?.author?.name || src.label;
  const handle = postHandle(post, member);
  const [viewing, setViewing] = useState('');
  const closeViewer = useCallback(() => setViewing(''), []);
  const destination = to ? { to } : postProfileLink(post, profile?.id);
  const profileHref = destination?.fallback ? null : destination?.href;
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
      {destination?.to ? <Link to={destination.to} className="post-chrome-identity">{who}</Link>
        : profileHref ? <a href={profileHref} target="_blank" rel="noopener noreferrer" className="post-chrome-identity">{who}</a>
          : <div className="post-chrome-identity">{who}</div>}
      <div className="post-chrome-corner">
        <PostTime post={post} live={post?.isLiveCamera} />
      </div>
      {viewing && <ProfilePhotoViewer url={viewing} name={name} handle={handle} profileTo={destination?.to} profileHref={profileHref} onClose={closeViewer} />}
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
// { label, detail?, danger?, busy?, disabled?, ariaLabel?, to?, href?, onSelect }.
// Playback callbacks belong to the player; source links never imply an API write.
export function PostOptionsMenu({ post, items = [], sourceItems, onOpenComments, onPostUpdated, onRemoved }) {
  const { profile, token } = useAuth();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [position, setPosition] = useState(null);
  const [optionsPage, setOptionsPage] = useState(0);
  const menuId = useId();
  const wrapper = useRef(null), button = useRef(null), menu = useRef(null), initialFocus = useRef('first');
  const closeMenu = () => { setOpen(false); button.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!open) return undefined;
    const outside = event => { if (!wrapper.current?.contains(event.target) && !menu.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeMenu(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const destination = postProfileLink(post, profile?.id);
  const native = isMemberPost(post);
  const original = safePostLink(post?.sourceUrl);
  const ownPost = native && profile?.id && (post?.authorId || post?.author?.id) === profile.id;
  const suppliedItems = items.filter(Boolean);
  const hasCommentsItem = suppliedItems.some(item => item.key === 'comments' || /^(?:(?:show|hide|view|open) )?comments\b/i.test(item.label || ''));
  async function copyLink() {
    const url = native && post?.id ? publicSiteUrl(`/p/${encodeURIComponent(post.id)}`) : original;
    if (!url) return;
    try { await navigator.clipboard.writeText(url); showToast('Link copied.', 'success'); }
    catch { showToast('Could not copy the link. Open the post to share it.', 'error'); }
  }
  async function deletePost() {
    if (!ownPost || deleteBusy || !window.confirm('Delete this post and its comments? This cannot be undone.')) return;
    setDeleteBusy(true);
    try {
      const { data } = await client.delete(`/posts/${encodeURIComponent(post.id)}`);
      if (data?.deleted !== true) throw new Error('Deletion was not confirmed');
      onRemoved?.(post);
      showToast('Post deleted.', 'success');
    } catch (error) {
      showToast(error.response?.data?.message || 'Could not delete this post. Please try again.', 'error');
    } finally { setDeleteBusy(false); }
  }
  const visible = [
    ...suppliedItems,
    ...(native ? [
      post?.id && { label: 'Likes on UFIconnect', to: `/p/${encodeURIComponent(post.id)}`, detail: 'View likes on the post.' },
      post?.id && { label: 'Go to profile', ...destination, disabled: !destination, detail: destination ? post.author?.name : 'Author profile unavailable.' },
    ] : sourceItems ?? sourcePostMenuItems(post, { onOpenComments, includeComments: !hasCommentsItem })),
    post?.id && (native || original) && !suppliedItems.some(item => /^Copy (?:original link|link to post)$/i.test(item.label)) && { label: native ? 'Copy link to post' : 'Copy original link', onSelect: copyLink },
    ownPost && { label: 'Edit post', busy: deleteBusy, onSelect: () => setEditOpen(true) },
    ownPost && !items.some(item => item?.label === 'Delete post') && { label: 'Delete post', danger: true, busy: deleteBusy, onSelect: deletePost },
    post?.id && !ownPost && !items.some(item => item?.label === 'Report post') && { label: 'Report post', onSelect: () => setReportOpen(true) },
  ].filter(item => item && item.key !== 'original' && item.label !== 'Open post')
    .flatMap(item => item.href ? safePostLink(item.href) ? [{ ...item, href: safePostLink(item.href) }] : [] : [item]);
  const pageCount = Math.max(1, Math.ceil(visible.length / 6));
  const activePage = Math.min(optionsPage, pageCount - 1);
  const pageItems = visible.slice(activePage * 6, (activePage + 1) * 6);
  useLayoutEffect(() => {
    if (!open) { setPosition(null); return undefined; }
    function updatePosition() {
      const anchor = button.current?.getBoundingClientRect();
      if (!anchor || !menu.current) return;
      const edge = 12, gap = 6;
      const maxHeight = Math.max(80, window.innerHeight - edge * 2);
      const width = menu.current.getBoundingClientRect().width;
      const height = Math.min(menu.current.scrollHeight, maxHeight);
      const above = anchor.top - gap - edge, below = window.innerHeight - anchor.bottom - gap - edge;
      const top = below >= height || below > above ? Math.min(anchor.bottom + gap, window.innerHeight - height - edge) : Math.max(edge, anchor.top - gap - height);
      setPosition({ top: Math.max(edge, top), left: Math.max(edge, Math.min(anchor.right - width, window.innerWidth - width - edge)), maxHeight });
    }
    updatePosition();
    window.addEventListener('resize', updatePosition); window.addEventListener('scroll', updatePosition, true);
    return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition, true); };
  }, [open, visible.length, activePage]);
  useEffect(() => {
    if (!open || !position) return;
    const openedItems = [...(menu.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])];
    (initialFocus.current === 'last' ? openedItems.at(-1) : openedItems[0])?.focus({ preventScroll: true });
  }, [open, Boolean(position), activePage]);
  function handleMenuKey(event) {
    const targets = [...menu.current.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const index = targets.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = (index + 1) % targets.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + targets.length) % targets.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = targets.length - 1;
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
    else if (event.key === 'Tab') { closeMenu(); return; }
    else return;
    event.preventDefault(); event.stopPropagation(); targets[next]?.focus();
  }
  if (!visible.length) return null;
  return (
    <div className="post-chrome-more" ref={wrapper}>
      <button ref={button} type="button" className="post-chrome-action" aria-label="More options" aria-haspopup="menu" aria-controls={open ? menuId : undefined} aria-expanded={open} title="More options"
        onClick={event => { event.stopPropagation(); initialFocus.current = 'first'; setOptionsPage(0); setOpen(value => !value); }}
        onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOptionsPage(0); setOpen(true); } }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {(open || visible.some(item => item.element)) && createPortal(
        <div ref={menu} id={menuId} className="post-chrome-menu" role="menu" aria-label={`Post options on ${native ? 'UFIConnect' : postSource(post).label}`}
          hidden={!open} style={{ ...position, visibility: position ? undefined : 'hidden' }} onKeyDown={handleMenuKey} onClick={event => event.stopPropagation()}>
          {pageItems.map(item => {
            if (item.element) return <span key={item.label} role="none">{item.element}</span>;
            const content = <>{item.busy ? `${item.label}…` : item.label}{item.detail && <small>{item.detail}</small>}</>;
            const props = { role: 'menuitem', className: item.danger ? 'post-chrome-menu-danger' : undefined,
              'aria-label': item.ariaLabel, onClick: event => { event.stopPropagation(); closeMenu(); item.onSelect?.(); } };
            return item.to ? <Link key={item.label} to={item.to} {...props}>{content}</Link>
              : item.href ? <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer" {...props}>{content}</a>
                : <button key={item.label} type="button" disabled={item.busy || item.disabled} {...props}>{content}</button>;
          })}
          {pageCount > 1 && <div className="post-chrome-menu-pages" role="group" aria-label="Post options pages">
            <button type="button" role="menuitem" aria-label="Previous options" disabled={activePage === 0}
              onClick={() => { initialFocus.current = 'first'; setOptionsPage(activePage - 1); }}>Previous</button>
            <span role="presentation" aria-live="polite">{activePage + 1} / {pageCount}</span>
            <button type="button" role="menuitem" aria-label="Next options" disabled={activePage + 1 === pageCount}
              onClick={() => { initialFocus.current = 'first'; setOptionsPage(activePage + 1); }}>Next</button>
          </div>}
        </div>, document.body
      )}
      {reportOpen && <ReportModal targetType="post" targetId={String(post.id)} targetLabel="post" source={post.source}
        sourceUrl={original || undefined} signInRequired={!token} onClose={() => { setReportOpen(false); button.current?.focus({ preventScroll: true }); }} />}
      {editOpen && ownPost && <NativePostEditor post={post} onClose={() => { setEditOpen(false); button.current?.focus(); }}
        onSaved={updated => { onPostUpdated?.(updated); showToast('Post updated.', 'success'); }} />}
    </div>
  );
}

export function SharePostButton({ post }) {
  const { showToast } = useToast();
  async function share(event) {
    event.preventDefault(); event.stopPropagation();
    const url = safePostLink(post?.sourceUrl) || publicSiteUrl(`/p/${encodeURIComponent(post.id)}`);
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

// Compact source link placed after More options in the action row: the source's own mark and
// an arrow, named for screen readers ("Open on Reddit", "Apply on Indeed").
export function OpenOnSource({ post, label, onClick }) {
  const src = postSource(post);
  const native = isMemberPost(post);
  const href = safePostLink(post?.sourceUrl);
  const internal = native || !href;
  if (internal && !post?.id) return null;
  const name = internal ? 'Open post' : label || sourcePostMenuItems(post).find(item => item.key === 'original')?.label || `Open on ${src.label}`;
  const CategoryIcon = { wikivoyage: Plane, travelnews: Plane, travelevents: Plane, livecamera: Plane, restaurants: Utensils, bars: Martini }[post.source];
  const props = { className: 'post-chrome-action post-chrome-source-link', onClick,
    style: { '--source-color': src.color }, 'aria-label': name, title: name };
  const content = <>
      <span className="post-chrome-open-mark" aria-hidden="true">{CategoryIcon ? <CategoryIcon size={16} /> : hasBrandIcon(post.source || 'uficonnect') ? <BrandIcon platform={post.source || 'uficonnect'} size={16} /> : <b>{src.icon}</b>}</span>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
    </>;
  return internal ? <Link to={`/p/${encodeURIComponent(post.id)}`} {...props}>{content}</Link>
    : <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{content}</a>;
}
