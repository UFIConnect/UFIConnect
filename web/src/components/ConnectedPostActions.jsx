import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

const requests = new Map();
if (typeof window !== 'undefined') window.addEventListener('ufi-session-cleared', () => requests.clear());
function getCapabilities(userId) {
  const existing = requests.get(userId);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;
  const promise = client.get('/social/interaction-capabilities').then(({ data }) => data.sources || {}).catch(() => { requests.delete(userId); return {}; });
  requests.set(userId, { promise, expiresAt: Date.now() + 60000 });
  return promise;
}

export function originalSourceUrl(post) {
  try {
    const url = new URL(post?.sourceUrl);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function useSourceCapability(post) {
  const { profile } = useAuth();
  const [capability, setCapability] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setCapability(null);
    if (!profile?.id || !post?.source) { setCapability(undefined); return undefined; }
    const update = () => getCapabilities(profile.id).then(sources => { if (!cancelled) setCapability(sources[post.source] || undefined); });
    update();
    const timer = window.setInterval(update, 60000);
    window.addEventListener('focus', update);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, [profile?.id, post?.source]);
  return capability;
}

// Source engagement is confirmed by the provider. This never changes a UFI counter.
export async function sendSourceInteraction(post, action, { liked, content, requestId = crypto.randomUUID() } = {}) {
  const payload = { source: post.source, sourceUrl: post.sourceUrl, action, ...(action === 'like' ? { liked } : { content }) };
  const { data } = await client.post('/social/interactions', { ...payload, requestId });
  if (!data.published) throw new Error('The source did not confirm this action.');
  return data;
}

export default function ConnectedPostActions({ post }) {
  const { showToast } = useToast();
  const capability = useSourceCapability(post);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lastRequest, setLastRequest] = useState(null);
  useEffect(() => { setOpen(false); setDraft(''); setError(''); setLastRequest(null); }, [post?.id, post?.source]);
  const sourceUrl = originalSourceUrl(post);
  const label = capability?.label || post?.sourceLabel || post?.source;
  const supportedPost = !['github', 'gitlab'].includes(post?.source) || /\/(?:issues|pull|merge_requests)\/\d+(?:[/?#]|$)/.test(sourceUrl || '');
  const canComment = capability?.connected === true && capability?.comment === true && supportedPost;
  if (!sourceUrl || !post?.source || post.source === 'uficonnect') return null;

  async function send() {
    if (busy || !canComment || !draft.trim()) return;
    const content = draft.trim();
    const requestId = lastRequest?.content === content ? lastRequest.requestId : crypto.randomUUID();
    setLastRequest({ content, requestId }); setBusy(true); setError('');
    try {
      await sendSourceInteraction(post, 'comment', { content, requestId });
      setDraft(''); setOpen(false); setLastRequest(null);
      showToast('Comment published on ' + label + '. Source counts update when the source supplies them.', 'success');
    } catch (err) { setError(err.response?.data?.message || 'The source did not confirm this comment. Check the original post before retrying.'); }
    finally { setBusy(false); }
  }
  return <div className="connected-post-actions" onClick={event => event.stopPropagation()}>
    <div className="connected-post-action-buttons">
      {canComment ? <button className="btn btn-ghost btn-sm" type="button" aria-expanded={open} disabled={busy} onClick={() => setOpen(value => !value)}>Comment on {label}</button>
        : <a className="btn btn-ghost btn-sm" href={sourceUrl} target="_blank" rel="noopener noreferrer">Comment on {label} ↗</a>}
    </div>
    {error && <div role="alert" className="connected-post-action-error">{error} <Link to="/connected-accounts?interactions=1">Manage connection</Link></div>}
    {open && canComment && <form onSubmit={event => { event.preventDefault(); send(); }}>
      <label className="form-label" htmlFor={'source-comment-' + post.id}>Publish a comment on {label}</label>
      <textarea id={'source-comment-' + post.id} className="form-textarea" rows={3} value={draft} onChange={event => setDraft(event.target.value)} maxLength={capability.maxLength || 1000} disabled={busy} required />
      <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !draft.trim()}>{busy ? 'Publishing…' : 'Publish on ' + label}</button>
    </form>}
  </div>;
}
