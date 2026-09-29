import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

const requests = new Map();
// Module scope also runs during prerendering, where there is no window.
if (typeof window !== 'undefined') window.addEventListener('ufi-session-cleared', () => requests.clear());
function getCapabilities(userId) {
  const existing = requests.get(userId);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;
  const promise = client.get('/social/interaction-capabilities').then(({ data }) => data.sources || {}).catch(() => { requests.delete(userId); return {}; });
  requests.set(userId, { promise, expiresAt: Date.now() + 60000 });
  return promise;
}
export const INTERACTIVE_SOURCES = new Set(['reddit', 'twitter', 'bluesky', 'youtube', 'github', 'gitlab']);
const SUPPORTED = INTERACTIVE_SOURCES;

// What this member can do on a post's source: null while loading, undefined
// when the source takes no interactions, else { connected, label, likeLabel, maxLength }.
export function useSourceCapability(post) {
  const { profile } = useAuth();
  const [capability, setCapability] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setCapability(null);
    if (!profile?.id || !SUPPORTED.has(post?.source)) { setCapability(undefined); return undefined; }
    getCapabilities(profile.id).then(sources => { if (!cancelled) setCapability(sources[post.source] || undefined); });
    return () => { cancelled = true; };
  }, [profile?.id, post?.source]);
  return capability;
}

// Sends a like or comment through the member's connected source account.
export async function sendSourceInteraction(post, action, { liked, content, requestId = crypto.randomUUID() } = {}) {
  const payload = { source: post.source, sourceUrl: post.sourceUrl, action, ...(action === 'like' ? { liked } : { content }) };
  const { data } = await client.post('/social/interactions', { ...payload, requestId });
  if (!data.published) throw new Error('The source did not confirm this action.');
  return data;
}

export default function ConnectedPostActions({ post }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [capability, setCapability] = useState(null);
  const [liked, setLiked] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastRequest, setLastRequest] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setCapability(null); setLiked(false); setOpen(false); setDraft(''); setError(''); setLastRequest(null);
    if (profile?.id && SUPPORTED.has(post?.source)) getCapabilities(profile.id).then(sources => { if (!cancelled) setCapability(sources[post.source]); });
    return () => { cancelled = true; };
  }, [profile?.id, post?.id, post?.source]);
  const canComment = !['github', 'gitlab'].includes(post?.source) || /\/(?:issues|pull|merge_requests)\/\d+(?:[/?#]|$)/.test(post?.sourceUrl || '');
  // Likes go through the heart in the action row; this offers commenting on the source.
  if (!capability?.connected || !post?.sourceUrl || !canComment) return null;
  async function send(action) {
    if (busy) return;
    const payload = { source: post.source, sourceUrl: post.sourceUrl, action, ...(action === 'like' ? { liked: !liked } : { content: draft.trim() }) };
    const fingerprint = JSON.stringify(payload);
    const requestId = lastRequest?.fingerprint === fingerprint ? lastRequest.requestId : crypto.randomUUID();
    setLastRequest({ fingerprint, requestId }); setBusy(true); setError('');
    try {
      const { data } = await client.post('/social/interactions', { ...payload, requestId });
      if (!data.published) throw new Error('The source did not confirm this action.');
      if (action === 'like') setLiked(data.liked === true);
      else { setDraft(''); setOpen(false); showToast(`Comment published on ${capability.label}.`, 'success'); }
      setLastRequest(null);
    } catch (err) { setError(err.response?.data?.message || 'The source did not confirm this action. Check the original post before retrying.'); }
    finally { setBusy(false); }
  }
  return <div className="connected-post-actions" onClick={event => event.stopPropagation()}>
    <div className="connected-post-action-buttons">
      {canComment && <button className="btn btn-ghost btn-sm" type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen(value => !value)}>Comment on {capability.label}</button>}
    </div>
    {error && <div role="alert" className="connected-post-action-error">{error} <Link to="/connected-accounts?interactions=1">Manage connection</Link></div>}
    {open && <form onSubmit={event => { event.preventDefault(); send('comment'); }}>
      <label className="form-label" htmlFor={`source-comment-${post.id}`}>Publish a comment on {capability.label}</label>
      <textarea id={`source-comment-${post.id}`} className="form-textarea" rows={3} value={draft} onChange={event => setDraft(event.target.value)} maxLength={capability.maxLength} disabled={busy} required />
      <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !draft.trim()}>{busy ? 'Publishing…' : `Publish on ${capability.label}`}</button>
    </form>}
  </div>;
}
