import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { publishPostEngagement } from '../api/postEngagement.mjs';
import { useSourceInteractionIdentity } from './ConnectedPostActions';

export default function NativePostCommentComposer({ post }) {
  const { profile } = useAuth();
  const { identity, isCurrent } = useSourceInteractionIdentity(post);
  const [state, setState] = useState(null);
  const inFlight = useRef(null);
  const own = state?.identity === identity ? state : {};
  const draft = own.draft || '';

  async function submit(event) {
    event.preventDefault();
    if (!profile?.id || !isCurrent() || !draft.trim() || inFlight.current?.identity === identity) return;
    const request = { identity };
    inFlight.current = request;
    setState({ identity, draft, busy: true });
    try {
      const { data } = await client.post(`/posts/${encodeURIComponent(post.id)}/comments`, { content: draft.trim() });
      if (!isCurrent()) return;
      if (!data.comment?.id) throw new Error('Comment was not confirmed.');
      setState({ identity, draft: '', busy: false });
      publishPostEngagement(post, { action: 'comment', comment: data.comment, commentId: data.comment.id,
        commentsCount: data.commentsCount ?? data.post?.commentsCount });
    } catch (error) {
      if (isCurrent()) setState({ identity, draft, busy: false,
        error: error.response?.data?.message || 'Could not publish your comment. Your draft is saved here; please try again.' });
    } finally { if (inFlight.current === request) inFlight.current = null; }
  }

  if (!profile?.id) return <Link to="/login">Sign in to comment</Link>;
  return <div className="connected-post-actions">
    {own.error && <p role="alert" className="connected-post-action-error">{own.error}</p>}
    <form onSubmit={submit}>
      <label className="connected-comment-label">
        Write a comment on UFIConnect
        <textarea className="form-textarea" rows={2} aria-label="Write a comment on UFIConnect" value={draft}
          onChange={event => setState({ identity, draft: event.target.value })} disabled={own.busy} maxLength={1000} required />
      </label>
      <button className="btn btn-primary btn-sm" type="submit" disabled={own.busy || !draft.trim()}>
        {own.busy ? 'Publishing…' : 'Publish comment'}
      </button>
    </form>
  </div>;
}
