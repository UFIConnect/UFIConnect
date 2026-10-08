import { useEffect, useRef, useState } from 'react';
import client from '../api/client';
import { legacyMessageUrl, messageAttachmentPath, messageBlobError } from './messageSecurity.mjs';

export default function MessageAttachment({ attachment, userId, messageId, scope }) {
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const controller = useRef(null);
  const objectUrl = useRef(null);
  const path = messageAttachmentPath(attachment, userId, messageId);
  const legacyUrl = legacyMessageUrl(attachment);

  useEffect(() => {
    const abort = () => { controller.current?.abort(); };
    scope.signal.addEventListener('abort', abort, { once: true });
    return () => {
      request.current += 1;
      controller.current?.abort();
      scope.signal.removeEventListener('abort', abort);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, [scope]);

  async function load() {
    if (loading || !scope.isCurrent()) return;
    const id = ++request.current;
    setError('');
    setLoading(true);
    try {
      if (legacyUrl) { setUrl(legacyUrl); return; }
      controller.current = new AbortController();
      const { data } = await client.get(path, { responseType: 'blob', signal: controller.current.signal });
      if (id !== request.current || !scope.isCurrent()) return;
      const blobError = messageBlobError(data, attachment.type);
      if (blobError) throw new Error(blobError);
      objectUrl.current = URL.createObjectURL(data);
      setUrl(objectUrl.current);
    } catch {
      if (id === request.current && scope.isCurrent()) setError('Could not load this attachment. Try again.');
    } finally { if (id === request.current && scope.isCurrent()) setLoading(false); }
  }

  if (!path && !legacyUrl) return <span>Attachment unavailable</span>;
  return <div>
    {url ? attachment.type === 'video'
      ? <video src={url} controls preload="metadata" style={{ maxWidth: 240, maxHeight: 320, borderRadius: 10, display: 'block' }} />
      : <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><img src={url} alt="Attachment" referrerPolicy="no-referrer" style={{ maxWidth: 240, maxHeight: 320, borderRadius: 10, display: 'block', objectFit: 'cover' }} /></a>
      : <button type="button" className="btn btn-ghost btn-sm" disabled={loading} onClick={load}>{loading ? 'Loading attachment…' : `View ${attachment.type === 'video' ? 'video' : 'photo'}`}</button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
