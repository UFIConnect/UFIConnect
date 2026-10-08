import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X, ExternalLink, Trash2, Flag, Globe2, Users } from 'lucide-react';
import { postProfileLink, safePostLink } from '../../../backend/post-links.mjs';
import { SOURCE_META } from './sourceMeta';
import { isExternalSnap, snapAvailabilityLabel, snapPlaybackInfo } from './snapRanking.mjs';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { HlsVideoPlayer, youTubeEmbedUrl } from './videoMedia';
import { officialSnapEmbedUrl } from '../utils/snapSourcePlayer.mjs';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';

export default function SnapViewer({ items, index, profile, now, onChange, onClose, onDelete, onReport }) {
  const dialog = useRef(null), titleId = useId();
  const [failed, setFailed] = useState(false), [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false), [error, setError] = useState('');
  const snap = items[index], author = snap.author?.name || 'UFIConnect member';
  const profileLink = postProfileLink(snap, profile?.id), original = safePostLink(snap.sourceUrl);
  const source = SOURCE_META[snap.source]?.label || snap.source;
  const playback = snapPlaybackInfo(snap);
  const sourceEmbedCandidate = playback.kind === 'source' ? officialSnapEmbedUrl(snap) : null;
  const sourceEmbed = sourceEmbedCandidate && typeof window !== 'undefined' && new URL(sourceEmbedCandidate).origin !== window.location.origin ? sourceEmbedCandidate : null;
  const mediaKey = `${snap.source}:${snap.id}`;
  const canDelete = onDelete && snap.source === 'uficonnect' && profile?.id && (snap.owned || String(snap.author?.id || snap.authorId) === String(profile.id));
  useLockBodyScroll();
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { setFailed(false); setConfirmDelete(false); setError(''); }, [snap.id, snap.source]);
  function move(direction) { if (!deleting && items[index + direction]) onChange(items[index + direction]); }
  async function remove() {
    if (deleting) return;
    setDeleting(true); setError('');
    try { await onDelete(snap.id); onClose(); }
    catch (failure) { setError(failure.response?.data?.message || 'Could not delete this snap. Please try again.'); setDeleting(false); }
  }
  return createPortal(<dialog ref={dialog} className="snap-viewer" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!deleting) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !deleting) onClose(); }}
    onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest?.('video, iframe, input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); } else if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    }}>
    <div className="snap-viewer-inner">
      <header><div className="snap-viewer-author"><strong id={titleId}>{profileLink?.to ? <Link to={profileLink.to} onClick={onClose}>{author}</Link> : profileLink?.href && !profileLink.fallback ? <a href={profileLink.href} target="_blank" rel="noopener noreferrer">{author}</a> : author}</strong>
        <span className="snap-viewer-source-details"><span className="snap-source-mark" aria-hidden="true">{hasBrandIcon(snap.source) ? <BrandIcon platform={snap.source} size={16} /> : <b>{source.slice(0, 2)}</b>}</span><span>{source} · {snapAvailabilityLabel(snap, now)}</span></span>
      </div><button type="button" className="snap-dialog-icon" disabled={deleting} onClick={onClose} aria-label="Close snap"><X size={22} /></button></header>
      <div className="snap-viewer-media">{failed ? <p role="status">This snap’s media could not load.{original && <a href={original} target="_blank" rel="noopener noreferrer">Open on {source}</a>}</p>
        : playback.kind === 'youtube' ? <iframe key={mediaKey} src={youTubeEmbedUrl(playback.id, { autoplay: '0' })} title={`${source} clip by ${author}`} referrerPolicy="strict-origin-when-cross-origin" allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen onError={() => setFailed(true)} />
        : playback.kind === 'source' && sourceEmbed ? <iframe key={mediaKey} src={sourceEmbed} title={`${source} post by ${author}`} referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen onError={() => setFailed(true)} />
        : playback.kind === 'source' ? <div className="snap-viewer-source-preview">{playback.poster && <img src={playback.poster} alt={snap.caption || `${author}'s source clip`} referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}{playback.original ? <a href={playback.original} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} />Watch on {source}</a> : <p role="status">Open this clip on its original source.</p>}</div>
        : playback.kind === 'hls' ? <HlsVideoPlayer key={mediaKey} src={playback.mediaUrl} poster={playback.poster} autoPlay={!isExternalSnap(snap)} muted loop={false} onError={() => setFailed(true)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        : playback.kind === 'file' ? <video key={mediaKey} src={playback.mediaUrl} poster={playback.poster || undefined} controls autoPlay={!isExternalSnap(snap)} muted playsInline preload="metadata" onError={() => setFailed(true)} />
        : playback.mediaUrl ? <img src={playback.mediaUrl} alt={snap.caption || `${author}'s snap`} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <p role="status">This snap’s media could not load.</p>}</div>
      {snap.caption && <p className="snap-viewer-caption">{snap.caption}</p>}
      {snap.source === 'uficonnect' && <p className="snap-viewer-audience">{snap.visibility === 'followers' ? <><Users size={13} />Followers only</> : <><Globe2 size={13} />Public</>}</p>}
      {error && <p className="snap-viewer-error" role="alert">{error}</p>}
      <footer><div className="snap-viewer-navigation"><button type="button" disabled={index === 0 || deleting} onClick={() => move(-1)} aria-label="Previous snap"><ChevronLeft size={20} /></button><span>{index + 1} / {items.length}</span><button type="button" disabled={index === items.length - 1 || deleting} onClick={() => move(1)} aria-label="Next snap"><ChevronRight size={20} /></button></div>
        <div className="snap-viewer-actions">{original && <a href={original} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} />Open on {source}</a>}
          {onReport && <button type="button" disabled={deleting} onClick={() => onReport(snap)} aria-label="Report this snap"><Flag size={16} /></button>}
          {canDelete && (confirmDelete ? <><button type="button" disabled={deleting} onClick={remove}>{deleting ? 'Deleting…' : 'Delete snap'}</button><button type="button" disabled={deleting} onClick={() => setConfirmDelete(false)}>Cancel</button></> : <button type="button" onClick={() => setConfirmDelete(true)} aria-label="Delete this snap"><Trash2 size={16} /></button>)}</div>
      </footer>
    </div>
  </dialog>, document.body);
}
