import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import client from '../api/client';
import './NativePostEditor.css';

export default function NativePostEditor({ post, onClose, onSaved }) {
  const dialog = useRef(null);
  const titleId = useId(), textId = useId();
  const [content, setContent] = useState(post.content || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canBeEmpty = post.mediaType === 'image' && Boolean(post.mediaUrl);
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function save(event) {
    event.preventDefault();
    if (busy || (!content.trim() && !canBeEmpty)) return;
    setBusy(true); setError('');
    try {
      const { data } = await client.patch(`/posts/${encodeURIComponent(post.id)}`, { content: content.trim() });
      if (!data?.post?.id) throw new Error('Post was not confirmed');
      onSaved(data.post);
      onClose();
    } catch (failure) {
      setError(failure.response?.data?.message || 'Could not save this post. Please try again.');
      setBusy(false);
    }
  }

  return createPortal(<dialog ref={dialog} className="native-post-editor" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={save}>
      <h2 id={titleId}>Edit post</h2>
      <label htmlFor={textId}>Post text</label>
      <textarea id={textId} className="form-textarea" value={content} maxLength={2000} rows={5} autoFocus
        onChange={event => setContent(event.target.value)} disabled={busy} required={!canBeEmpty} />
      <div className="native-post-editor-note">{content.length.toLocaleString()} / 2,000{post.mediaUrl ? ' · Your attachment stays with this post.' : ''}</div>
      {error && <p role="alert" className="native-post-editor-error">{error}</p>}
      <div className="native-post-editor-buttons">
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || (!content.trim() && !canBeEmpty) || content === (post.content || '')}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  </dialog>, document.body);
}
