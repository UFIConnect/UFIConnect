import { useEffect, useState, useCallback, useRef } from 'react';
import { deriveBlueskyPlaylistUrl, isDirectVideoUrl, HlsVideoPlayer } from './videoMedia';

// Full-screen media viewer with next/prev navigation across every
// image- OR video-bearing post currently on screen. Photos and videos used
// to open into two separate, non-scrollable viewers (this one for images
// only, a single-post VideoModal for videos) — browsing meant closing back
// out to the list between every photo and every video. Now both media
// types share one scrollable rail, in the same order they appear in the
// list. Video source resolution mirrors what VideoModal used: Bluesky's
// HLS playlist, a direct video file, or (for sources that only ever hand
// back a thumbnail — no scrapable playable URL) a static poster with a
// play badge rather than silently rendering nothing.
export default function ImageLightbox({ items, startIndex = 0, onClose, onNearEnd }) {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(items.length - 1, 0)));
  const touchStartX = useRef(null);

  const goNext = useCallback(() => setIndex(i => Math.min(items.length - 1, i + 1)), [items.length]);
  const goPrev = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
    }
    document.addEventListener('keydown', handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, goNext, goPrev]);

  // Browsing through media used to dead-end at whatever was already loaded
  // into the underlying list — this pulls in more (same "load more before
  // actually running out" pattern as the video feed) as the viewer nears
  // the last few already-loaded items, so scrolling keeps updating with
  // fresh photos/videos instead of stopping.
  useEffect(() => {
    if (onNearEnd && index >= items.length - 3) onNearEnd();
  }, [index, items.length, onNearEnd]);

  const item = items[index];
  if (!item) return null;
  const post = item.post || {};
  const isVideo = item.type === 'video';
  const playlistUrl = isVideo && post.source === 'bluesky' ? deriveBlueskyPlaylistUrl(item.url) : null;
  const directVideoUrl = isVideo && !playlistUrl && isDirectVideoUrl(item.url) ? item.url : null;

  function handleTouchStart(e) { touchStartX.current = e.touches[0].clientX; }
  function handleTouchEnd(e) {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 40) return;
    if (delta < 0) goNext(); else goPrev();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={post.title || (isVideo ? 'Video' : 'Photo')}
      onClick={onClose}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        position: 'fixed', inset: 0, zIndex: 2500,
        background: 'rgba(0,0,0,.92)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <button onClick={onClose} aria-label="Close" style={{
        position: 'absolute', top: 16, right: 16, zIndex: 10, width: 38, height: 38, borderRadius: '50%',
        background: 'rgba(255,255,255,.12)', border: 'none', color: '#fff', fontSize: '1.3rem', cursor: 'pointer',
      }}>×</button>

      {items.length > 1 && index > 0 && (
        <button onClick={e => { e.stopPropagation(); goPrev(); }} aria-label="Previous" style={{
          position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', zIndex: 10,
          width: 42, height: 42, borderRadius: '50%', background: 'rgba(255,255,255,.12)',
          border: 'none', color: '#fff', fontSize: '1.4rem', cursor: 'pointer',
        }}>‹</button>
      )}
      {items.length > 1 && index < items.length - 1 && (
        <button onClick={e => { e.stopPropagation(); goNext(); }} aria-label="Next" style={{
          position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', zIndex: 10,
          width: 42, height: 42, borderRadius: '50%', background: 'rgba(255,255,255,.12)',
          border: 'none', color: '#fff', fontSize: '1.4rem', cursor: 'pointer',
        }}>›</button>
      )}

      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '92vw', maxHeight: '90vh' }}>
        {isVideo ? (
          playlistUrl ? (
            <HlsVideoPlayer key={item.url} src={playlistUrl} poster={item.url} autoPlay
              style={{ maxWidth: '92vw', maxHeight: '72vh', borderRadius: 10 }} />
          ) : directVideoUrl ? (
            <video key={item.url} src={directVideoUrl} controls autoPlay playsInline
              style={{ maxWidth: '92vw', maxHeight: '72vh', objectFit: 'contain', borderRadius: 10, display: 'block', background: '#000' }} />
          ) : (
            <div style={{ position: 'relative', maxWidth: '92vw' }}>
              <img src={item.url} alt="" style={{ maxWidth: '92vw', maxHeight: '72vh', objectFit: 'contain', borderRadius: 10, display: 'block', opacity: 0.85 }} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(0,0,0,.5)' }}>
                  <span style={{ color: '#fff', fontSize: '1.6rem', marginLeft: 3 }}>▶</span>
                </div>
              </div>
            </div>
          )
        ) : (
          <img
            key={item.url}
            src={item.url}
            alt={post.title || ''}
            style={{ maxWidth: '92vw', maxHeight: '72vh', objectFit: 'contain', borderRadius: 10, display: 'block' }}
          />
        )}
        <div style={{ color: '#fff', marginTop: 14, textAlign: 'center', maxWidth: 560, padding: '0 12px' }}>
          {post.title && <div style={{ fontWeight: 700, fontSize: '.92rem', marginBottom: 4 }}>{post.title}</div>}
          {post.content && (
            <div style={{ fontSize: '.82rem', opacity: 0.8, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {post.content}
            </div>
          )}
          <div style={{ fontSize: '.72rem', opacity: 0.55, marginTop: 8 }}>
            {post.author?.name ? `${post.author.name} · ` : ''}{index + 1} / {items.length}
          </div>
          {/* Video items previously had a "watch on source" link in the
              single-post VideoModal this replaced — preserved here so
              merging video into the shared viewer didn't quietly drop it. */}
          {isVideo && post.sourceUrl && (
            <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-block', marginTop: 10, fontSize: '.78rem', color: '#93c5fd', textDecoration: 'none', fontWeight: 600 }}>
              Watch on {post.sourceLabel || post.source} ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
