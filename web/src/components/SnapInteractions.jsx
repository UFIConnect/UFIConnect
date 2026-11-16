import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Share2, X } from 'lucide-react';
import client from '../api/client';
import { POST_ENGAGEMENT_EVENT, publishPostEngagement } from '../api/postEngagement.mjs';
import { useToast } from '../contexts/ToastContext';
import { HeartIcon } from './PostCardChrome';
import ConnectedPostActions from './ConnectedPostActions';
import { sourcePostCommands } from '../utils/sourceCommands.mjs';
import { safePostLink } from '../../../backend/post-links.mjs';
import { publicSiteUrl } from '../utils/publicSiteUrl.mjs';

// Requests, drafts and confirmed counts belong to one member and one Snap.
// A provider connection/session invalidation also retires retained callbacks.
function useSnapIdentity(snap, profile) {
  const [revision, setRevision] = useState(0);
  const key = `${profile?.id || 'guest'}:${snap.source}:${snap.id}:${revision}`;
  const generation = useRef({ key, value: 0 });
  if (generation.current.key !== key) generation.current = { key, value: generation.current.value + 1 };
  const identity = `${key}:${generation.current.value}`;
  const current = useRef(identity), mounted = useRef(false);
  current.current = identity;
  useEffect(() => {
    mounted.current = true;
    const retire = () => { current.current = ''; setRevision(value => value + 1); };
    window.addEventListener('ufi-session-cleared', retire);
    window.addEventListener('ufi-connections-changed', retire);
    return () => { mounted.current = false; window.removeEventListener('ufi-session-cleared', retire); window.removeEventListener('ufi-connections-changed', retire); };
  }, []);
  const isCurrent = useCallback(() => mounted.current && current.current === identity, [identity]);
  return { identity, isCurrent };
}
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const pendingSnapLikes = new Map();
function confirmedEngagement(data) {
  if (count(data?.likesCount) === null || count(data?.commentsCount) === null || typeof data?.likedByMe !== 'boolean') {
    throw new Error('The Snap response did not confirm its engagement.');
  }
  return { likesCount: data.likesCount, commentsCount: data.commentsCount, likedByMe: data.likedByMe };
}

export function useNativeSnapEngagement({ snap, profile }) {
  const { identity, isCurrent } = useSnapIdentity(snap, profile);
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const own = state?.identity === identity ? state : null;
  const native = snap.source === 'uficonnect';
  const key = `${profile?.id || 'guest'}:${snap.id}`;
  const path = `/snaps/${encodeURIComponent(snap.id)}`;
  const read = useCallback(async signal => {
    const { data } = await client.get(`${path}/engagement`, { signal });
    return confirmedEngagement(data);
  }, [path]);
  useEffect(() => {
    if (!native) return undefined;
    const abort = new AbortController();
    setState({ identity, loading: true });
    async function load() {
      // Reopening a Snap while its last like is saving should read after that write.
      await pendingSnapLikes.get(key)?.catch(() => {});
      if (abort.signal.aborted || !isCurrent()) return;
      try {
        const result = await read(abort.signal);
        if (isCurrent() && !abort.signal.aborted) setState({ identity, ...result });
      } catch (error) {
        if (isCurrent() && !abort.signal.aborted) setState({ identity, error: error.response?.data?.message || 'Snap likes could not load. Try again.' });
      }
    }
    void load();
    return () => abort.abort();
  }, [native, key, identity, isCurrent, read, attempt]);

  async function toggle() {
    if (!isCurrent() || !native || !profile?.id || !own || own.loading || own.error || own.busy || pendingSnapLikes.has(key)) return;
    const desired = !own.likedByMe;
    setState({ ...own, likedByMe: desired, likesCount: Math.max(0, own.likesCount + (desired ? 1 : -1)), busy: true, actionError: '' });
    async function save() {
      let result, actionError = '';
      try {
        const { data } = await client.post(`${path}/like`, { liked: desired });
        result = confirmedEngagement(data);
      } catch (error) {
        if (!isCurrent()) return;
        actionError = error.response?.data?.message || 'The like could not be confirmed. Please try again.';
        if ([401, 403, 404].includes(error.response?.status)) {
          setState({ identity, error: actionError, actionError });
          return;
        }
        // A response can be lost after the database has accepted the like.
        result = await read().catch(() => null);
      }
      if (!isCurrent()) return;
      if (result) {
        setState({ identity, ...result, actionError: result.likedByMe === desired ? '' : actionError });
        publishPostEngagement(snap, { action: 'like', ...result });
      } else {
        setState(previous => ({ ...previous, likesCount: own.likesCount, likedByMe: own.likedByMe, busy: false, actionError }));
      }
    }
    const request = save();
    pendingSnapLikes.set(key, request);
    try {
      await request;
    } finally {
      pendingSnapLikes.delete(key);
    }
  }
  const setCommentsCount = useCallback(value => {
    if (count(value) !== null && isCurrent()) setState(previous => previous?.identity === identity ? { ...previous, commentsCount: value } : previous);
  }, [identity, isCurrent]);
  const likesCount = own?.likesCount ?? (native && !own?.error ? count(snap.likesCount) : null);
  return { ...own, likesCount, loading: !own || own.loading, toggle, retry: () => setAttempt(value => value + 1), setCommentsCount };
}

export function NativeSnapLike({ engagement, profile, onNavigate }) {
  const value = count(engagement.likesCount), liked = engagement.likedByMe === true;
  const label = value === null ? 'likes unavailable' : `${value.toLocaleString()} ${value === 1 ? 'like' : 'likes'}`;
  const action = engagement.error ? 'Retry Snap likes' : liked ? 'Unlike' : 'Like';
  const visibleCount = value?.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 });
  const content = <><HeartIcon filled={liked} />{value !== null && <span className="post-chrome-like-count" aria-hidden="true">{visibleCount}</span>}</>;
  return <span className="post-chrome-like snap-viewer-native-like">
    {!profile?.id ? <Link className="post-chrome-action" to="/login" aria-label={`Sign in to like, ${label}`} title="Sign in to like" onClick={onNavigate}>{content}</Link>
      : <button type="button" className="post-chrome-action" aria-label={`${action}, ${label}`} title={engagement.error || `${action} · ${label}`}
        aria-pressed={engagement.error ? undefined : liked} disabled={engagement.loading || engagement.busy} onClick={engagement.error ? engagement.retry : engagement.toggle}>{content}</button>}
  </span>;
}

export function useSnapShare(snap) {
  const { showToast } = useToast();
  const native = snap.source === 'uficonnect';
  const href = native ? /^snap_[a-f0-9-]{36}$/i.test(snap.id || '') ? publicSiteUrl(`/snaps/${encodeURIComponent(snap.id)}`) : null : safePostLink(snap.sourceUrl);
  if (!href) return null;
  async function share() {
    if (native && Date.parse(snap.expiresAt) <= Date.now()) { showToast('This Snap has expired.', 'error'); return; }
    try {
      if (navigator.share) await navigator.share({ title: snap.caption || 'Snap', url: href });
      else { await navigator.clipboard.writeText(href); showToast(native ? 'Snap link copied. Its audience and expiry still apply.' : 'Original link copied.', 'success'); }
    } catch (error) { if (error?.name !== 'AbortError') showToast('Could not share this Snap. Open the source to share it.', 'error'); }
  }
  return share;
}

export function SnapShareButton({ snap, compact = false }) {
  const share = useSnapShare(snap);
  if (!share) return null;
  const label = snap.source === 'uficonnect' ? 'Share snap' : 'Share original';
  return <button type="button" className={compact ? 'post-chrome-action' : undefined} aria-label={label} title={label} onClick={share}><Share2 size={17} aria-hidden="true" />{!compact && label}</button>;
}

function commentKey(item) { return String(item?.id || `${item?.author || ''}:${item?.created || ''}:${item?.body || ''}`); }
function mergeComments(first, next) {
  const seen = new Set();
  return [...first, ...next].filter(item => { const key = commentKey(item); if (seen.has(key)) return false; seen.add(key); return true; });
}

export function SnapComments({ snap, profile, active, id, onClose, onCountChange }) {
  const discussionLabel = sourcePostCommands(snap.source).discussions;
  const { identity, isCurrent } = useSnapIdentity(snap, profile);
  const native = snap.source === 'uficonnect', original = safePostLink(snap.sourceUrl);
  const [state, setState] = useState(null), [draftState, setDraftState] = useState(null);
  const inputId = useId(), input = useRef(null), section = useRef(null);
  const reading = useRef(null), writing = useRef(null), activeRef = useRef(active);
  activeRef.current = active;
  const own = state?.identity === identity ? state : null;
  const draft = draftState?.identity === identity ? draftState : { text: '' };
  const endpoint = native ? `/snaps/${encodeURIComponent(snap.id)}/comments` : `/feed/${encodeURIComponent(snap.id)}/comments`;
  const onCount = useRef(onCountChange); onCount.current = onCountChange;
  const read = useCallback(async (offset = 0) => {
    if (!isCurrent() || !activeRef.current) return;
    const request = { identity };
    reading.current = request;
    setState(previous => ({ ...(previous?.identity === identity ? previous : {}), identity, loading: true, error: '' }));
    try {
      const { data } = await client.get(endpoint, { params: { limit: 20, offset } });
      if (!Array.isArray(data?.comments)) throw new Error('No confirmed comments response.');
      if (!isCurrent() || reading.current !== request || !activeRef.current) return;
      setState(previous => ({ identity, comments: mergeComments(offset ? previous?.comments || [] : [], data.comments),
        offset: offset + (data.commentsReceived ?? data.comments.length), hasMore: data.hasMore === true, live: data.live === true || native, loading: false }));
      if (native) onCount.current?.(data.commentsCount);
    } catch (error) {
      if (isCurrent() && reading.current === request && activeRef.current) setState(previous => ({ ...previous,
        ...([403, 404].includes(error.response?.status) ? { comments: [], hasMore: false } : {}), identity, loading: false,
        error: error.response?.data?.message || 'Comments could not load. Please try again.' }));
    } finally { if (reading.current === request) reading.current = null; }
  }, [identity, isCurrent, endpoint, native]);
  useEffect(() => {
    if (active) { read(); section.current?.focus({ preventScroll: true }); }
    return () => { reading.current = null; };
  }, [active, read]);
  useEffect(() => {
    const changed = ({ detail }) => {
      if (!activeRef.current || !isCurrent() || detail?.action !== 'comment' || detail.postId !== snap.id || detail.source !== (snap.source || 'uficonnect')) return;
      if (detail.comment) setState(previous => ({ ...previous, identity, comments: mergeComments(previous?.identity === identity ? previous.comments || [] : [], [detail.comment]) }));
      if (Number.isFinite(detail.commentsCount)) onCount.current?.(detail.commentsCount);
      void read();
    };
    window.addEventListener(POST_ENGAGEMENT_EVENT, changed);
    return () => window.removeEventListener(POST_ENGAGEMENT_EVENT, changed);
  }, [identity, isCurrent, snap.id, snap.source, read]);
  async function publish(event) {
    event.preventDefault();
    const content = draft.text.trim();
    if (!native || !profile?.id || !activeRef.current || !isCurrent() || !content || writing.current?.identity === identity) return;
    const requestId = draft.lastRequest?.content === content ? draft.lastRequest.requestId : crypto.randomUUID();
    const request = { identity, content, requestId };
    writing.current = request;
    setDraftState({ identity, text: draft.text, lastRequest: request, busy: true, error: '' });
    try {
      const { data } = await client.post(endpoint, { content, requestId });
      if (data?.published !== true || !data.comment?.id) throw new Error('Comment was not confirmed.');
      if (!isCurrent()) return;
      setDraftState({ identity, text: '', notice: 'Comment published on UFIConnect.' });
      onCount.current?.(data.commentsCount);
      setState(previous => ({ ...previous, identity, comments: mergeComments(previous?.identity === identity ? previous.comments || [] : [], [data.comment]) }));
      publishPostEngagement(snap, { action: 'comment', comment: data.comment, commentsCount: data.commentsCount });
      // The engagement event refreshes the authorized page for this identity.
    } catch (error) {
      if (isCurrent()) setDraftState({ identity, text: draft.text, lastRequest: error.response?.status === 409 ? null : request,
        error: error.response?.data?.message || 'The comment was not confirmed. Retry to check the same request.' });
    } finally { if (writing.current === request) writing.current = null; }
  }
  return <section ref={section} id={id} className="snap-comments" aria-label={`Snap ${discussionLabel.toLowerCase()}`} hidden={!active} tabIndex={-1}>
    <header><h2>{discussionLabel}</h2><button type="button" className="snap-dialog-icon" aria-label={`Close ${discussionLabel.toLowerCase()}`} onClick={onClose}><X size={19} /></button></header>
    {own?.loading && <p role="status">Loading comments…</p>}
    {own?.error && <div className="snap-interaction-error" role="alert"><p>{own.error}</p><button type="button" onClick={() => read()}>Retry comments</button></div>}
    {!own?.loading && !own?.error && !own?.comments?.length && <p>{native || own?.live ? 'No comments yet.' : 'Comments are available on the original source.'}</p>}
    <ol className="snap-comment-list">{(own?.comments || []).map(item => <li key={commentKey(item)}>
      <strong>{typeof item.author === 'object' ? item.author?.name || 'Member' : item.author || 'Member'}</strong>
      <p>{item.content || item.body || ''}</p>
    </li>)}</ol>
    {own?.hasMore && <button type="button" className="snap-comments-more" disabled={own.loading} onClick={() => read(own.offset)}>Load more {discussionLabel.toLowerCase()}</button>}
    {native ? profile?.id ? <form className="post-comment-form" onSubmit={publish}>
      <label htmlFor={inputId}>Write a comment on UFIConnect</label>
      <textarea ref={input} id={inputId} rows={2} value={draft.text} maxLength={1000} disabled={draft.busy}
        onChange={event => setDraftState({ ...draft, identity, text: event.target.value, error: '', notice: '' })} required />
      {draft.error && <p className="snap-interaction-error" role="alert">{draft.error}</p>}
      {draft.notice && <p role="status">{draft.notice}</p>}
      <button type="submit" className="btn btn-primary" disabled={draft.busy || !draft.text.trim()}>{draft.busy ? 'Publishing…' : 'Publish comment'}</button>
    </form> : <Link to="/login">Sign in to comment</Link>
      : <ConnectedPostActions key={identity} post={snap} active={active} />}
    {original && <a className="snap-comments-original" href={original} target="_blank" rel="noopener noreferrer">Open original discussion</a>}
  </section>;
}
