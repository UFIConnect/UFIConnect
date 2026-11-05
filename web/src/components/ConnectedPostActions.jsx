import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { publishPostEngagement } from '../api/postEngagement.mjs';
import { sourcePostCommands } from '../utils/sourceCommands.mjs';

const requests = new Map();
if (typeof window !== 'undefined') window.addEventListener('ufi-session-cleared', () => requests.clear());
if (typeof window !== 'undefined') window.addEventListener('ufi-connections-changed', () => requests.clear());
function getCapabilities(userId) {
  const existing = requests.get(userId);
  if (existing && existing.expiresAt > Date.now()) return existing.promise;
  const promise = client.get('/social/interaction-capabilities').then(({ data }) => data.sources || {}).catch(() => {
    if (requests.get(userId)?.promise === promise) requests.delete(userId);
    return {};
  });
  requests.set(userId, { promise, expiresAt: Date.now() + 60000 });
  return promise;
}

// A provider connection may be replaced while the UFIConnect account stays
// signed in. Drafts, confirmed state and retries belong to that exact context.
export function useSourceInteractionIdentity(post) {
  const { profile } = useAuth();
  const [revision, setRevision] = useState(0);
  const identity = `${profile?.id || ''}:${post?.source || ''}:${post?.id || ''}:${post?.sourceUrl || ''}:${revision}`;
  const current = useRef(identity); current.current = identity;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const invalidate = () => { current.current = ''; setRevision(value => value + 1); };
    window.addEventListener('ufi-connections-changed', invalidate);
    window.addEventListener('ufi-session-cleared', invalidate);
    return () => {
      mounted.current = false;
      window.removeEventListener('ufi-connections-changed', invalidate);
      window.removeEventListener('ufi-session-cleared', invalidate);
    };
  }, []);
  const isCurrent = useCallback(() => mounted.current && current.current === identity, [identity]);
  return { identity, isCurrent };
}

export function originalSourceUrl(post) {
  try {
    const url = new URL(post?.sourceUrl);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function useSourceCapability(post) {
  const { profile } = useAuth();
  const [result, setResult] = useState(null);
  const key = `${profile?.id || ''}:${post?.source || ''}`;
  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    if (!profile?.id || !post?.source) return undefined;
    const update = () => {
      const current = ++generation;
      return getCapabilities(profile.id).then(sources => { if (!cancelled && current === generation) setResult({ key, capability: sources[post.source] }); });
    };
    const refresh = () => { setResult(null); update(); };
    update();
    const timer = window.setInterval(update, 60000);
    window.addEventListener('focus', update);
    window.addEventListener('ufi-connections-changed', refresh);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', update); window.removeEventListener('ufi-connections-changed', refresh); };
  }, [profile?.id, post?.source, key]);
  return result?.key === key ? result.capability : null;
}

// Source engagement is confirmed by the provider. This never changes a UFI counter.
export async function sendSourceInteraction(post, action, { liked, content, requestId = crypto.randomUUID() } = {}) {
  const payload = { source: post.source, sourceUrl: post.sourceUrl, action, ...(action === 'like' ? { liked } : { content }) };
  const { data } = await client.post('/social/interactions', { ...payload, requestId });
  if (!data.published) throw new Error('The source did not confirm this action.');
  return data;
}

// The surrounding post owns the single comments action. This composer stays
// mounted while that section is collapsed so retries retain their request ID.
export default function ConnectedPostActions({ post, active = true, showFallback = true }) {
  const { showToast } = useToast();
  const capability = useSourceCapability(post);
  const { identity, isCurrent } = useSourceInteractionIdentity(post);
  const inputId = useId();
  const [state, setState] = useState(null);
  const own = state?.identity === identity ? state : null;
  const draft = own?.draft || '';
  const busy = own?.busy === true;
  const error = own?.error || '';
  const lastRequest = own?.lastRequest;
  const inFlight = useRef(null);
  const input = useRef(null);
  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = 'auto';
    input.current.style.height = `${Math.max(40, Math.min(112, input.current.scrollHeight))}px`;
  }, [draft, identity]);
  const sourceUrl = originalSourceUrl(post);
  const label = capability?.label || post?.sourceLabel || post?.source;
  const command = sourcePostCommands(post?.source).discussion;
  const noun = command === 'Reply' ? 'reply' : command === 'Respond' ? 'response' : 'comment';
  const supportedPost = !['github', 'gitlab'].includes(post?.source) || /\/(?:issues|pull|merge_requests)\/\d+(?:[/?#]|$)/.test(sourceUrl || '');
  const canComment = capability?.connected === true && capability?.comment === true && supportedPost;
  if (!sourceUrl || !post?.source || post.source === 'uficonnect') return null;

  async function send() {
    if (!isCurrent() || inFlight.current?.identity === identity || !canComment || !draft.trim()) return;
    const content = draft.trim();
    const requestId = lastRequest?.content === content ? lastRequest.requestId : crypto.randomUUID();
    const request = { identity, content, requestId };
    inFlight.current = request;
    setState({ identity, draft, lastRequest: request, busy: true, error: '' });
    try {
      const result = await sendSourceInteraction(post, 'comment', { content, requestId });
      if (!isCurrent()) return;
      setState({ identity, draft: '', lastRequest: null, busy: false, error: '' });
      publishPostEngagement(post, { action: 'comment', commentId: String(result.commentId || ''), commentsCount: result.commentsCount,
        comment: result.commentId ? { id: String(result.commentId), author: 'You', body: content, content,
          created: new Date().toISOString(), createdAt: new Date().toISOString(), url: result.commentUrl || '' } : null });
      showToast(`${noun[0].toUpperCase()}${noun.slice(1)} published on ${label}.`, 'success');
    } catch (err) {
      if (!isCurrent()) return;
      setState({ identity, draft, lastRequest: request, busy: false,
        error: err.response?.data?.message || 'The source did not confirm this comment. Check the original post before retrying.' });
    } finally { if (inFlight.current === request) inFlight.current = null; }
  }
  return <div className="connected-post-actions" hidden={!active} onClick={event => event.stopPropagation()}>
    {error && <div role="alert" className="connected-post-action-error">{error} <Link to="/connected-accounts?interactions=1">Manage connection</Link></div>}
    {canComment && <form onSubmit={event => { event.preventDefault(); send(); }}>
      <label className="connected-comment-label" htmlFor={inputId}>Write a {noun} on {label}</label>
      <textarea ref={input} id={inputId} className="form-textarea" rows={1} placeholder={`Write a ${noun}…`} value={draft}
        onChange={event => setState({ ...own, identity, draft: event.target.value })} maxLength={capability.maxLength || 1000} disabled={busy} required />
      <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !draft.trim()}>{busy ? 'Publishing…' : `${command} on ${label}`}</button>
    </form>}
    {!canComment && capability?.reconnectRequired && post.source === 'mastodon' && <Link className="post-chrome-action" to="/connected-accounts?connect=mastodon">Reconnect Mastodon to reply</Link>}
    {!canComment && showFallback && <a className="post-chrome-action" href={sourceUrl} target="_blank" rel="noopener noreferrer">Open original to {command.toLowerCase()} ↗</a>}
  </div>;
}
