import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, X, ExternalLink, Trash2, Flag, Globe2, Users } from 'lucide-react';
import { postProfileLink, safePostLink } from '../../../backend/post-links.mjs';
import { SOURCE_META } from './sourceMeta';
import { snapTimeRemaining } from './snapRanking.mjs';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';

export default function SnapViewer({ items, index, profile, now, onChange, onClose, onDelete, onReport }) {
  const dialog = useRef(null), titleId = useId();
  const [failed, setFailed] = useState(false), [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false), [error, setError] = useState('');
  const snap = items[index], author = snap.author?.name || 'UFIConnect member';
  const profileLink = postProfileLink(snap, profile?.id), original = safePostLink(snap.sourceUrl);
  const source = SOURCE_META[snap.source]?.label || snap.source;
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
    onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); } else if (event.key === 'ArrowRight') { event.preventDefault(); move(1); } }}>
    <div className="snap-viewer-inner">
      <header><div className="snap-viewer-author"><strong id={titleId}>{profileLink?.to ? <Link to={profileLink.to} onClick={onClose}>{author}</Link> : profileLink?.href && !profileLink.fallback ? <a href={profileLink.href} target="_blank" rel="noopener noreferrer">{author}</a> : author}</strong><span>{source} · {snapTimeRemaining(snap.expiresAt, now)}</span></div><button type="button" className="snap-dialog-icon" disabled={deleting} onClick={onClose} aria-label="Close snap"><X size={22} /></button></header>
      <div className="snap-viewer-media">{failed ? <p role="status">This snap’s media could not load.{original && <a href={original} target="_blank" rel="noopener noreferrer">Open on {source}</a>}</p> : snap.mediaType === 'video'
        ? <video key={`${snap.source}:${snap.id}`} src={snap.mediaUrl} poster={snap.thumbnailUrl || undefined} controls autoPlay muted playsInline onError={() => setFailed(true)} />
        : <img src={snap.mediaUrl} alt={snap.caption || `${author}'s snap`} referrerPolicy="no-referrer" onError={() => setFailed(true)} />}</div>
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
