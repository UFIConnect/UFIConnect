import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { deriveBlueskyPlaylistUrl, isDirectVideoUrl, HlsVideoPlayer } from './videoMedia';

// Same floating-control look as VideoFeedView's overlay buttons (back/
// refresh/mute) — kept as one consistent control language for every video
// surface in the app rather than each screen inventing its own.
const OVERLAY_BTN_STYLE = {
  zIndex: 10, width: 38, height: 38, borderRadius: '50%',
  background: 'rgba(0,0,0,.4)',
  backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,.18)',
  boxShadow: '0 2px 10px rgba(0,0,0,.35)',
  color: '#fff', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;

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
  const navigate = useNavigate();
  // Unmuted by default — opening the lightbox is itself a deliberate click,
  // same reasoning VideoFeedView already uses for the swipe feed, so video
  // should just play with sound right away instead of requiring an extra
  // tap to unmute every time. What was actually breaking mute/pause on
  // mobile/tablet wasn't the unmuted default itself — it was the native
  // <video controls autoPlay> this used to render having no play()-
  // rejection handling at all (the HLS path didn't even receive a muted
  // prop), so desktop's much more lenient autoplay policy let it start fine
  // while mobile Safari/Chrome — which block autoplay-with-sound far more
  // aggressively — silently failed to start it with nothing to recover, and
  // every "next" swap remounted a brand new native player that lost
  // whatever the user had done to the last one. The effect below (and
  // HlsVideoPlayer's own internal handling for the HLS path) primes muted
  // state right before every play() call and falls back to muted — syncing
  // this state so the button stays truthful — only if the browser actually
  // blocks it, and the state living here instead of on the transient video
  // element means it survives across next/prev either way.
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const fileVideoRef = useRef(null);
  const hlsVideoRef = useRef(null);

  // Photo zoom/pan — pinch, double-tap, wheel, or the +/− buttons below all
  // funnel into the same zoom/pan state. Scoped to plain photos only (not
  // video posters or playable video), since that's what was actually asked
  // for and videos already have their own play/pause/mute interactions that
  // pinch-to-zoom would conflict with.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pinchRef = useRef(null); // { startDist, startZoom } while a 2-finger gesture is live
  const panDragRef = useRef(null); // { x, y, panX, panY } while a pan/drag is live
  const lastTapRef = useRef(0);

  const goNext = useCallback(() => setIndex(i => Math.min(items.length - 1, i + 1)), [items.length]);
  const goPrev = useCallback(() => setIndex(i => Math.max(0, i - 1)), []);

  function resetZoom() { setZoom(1); setPan({ x: 0, y: 0 }); }

  // A zoomed-in view of photo N shouldn't carry over to photo N+1.
  useEffect(() => { resetZoom(); }, [index]);

  function clampPan(z, p) {
    // Loose heuristic bound (not measured against actual rendered image
    // size) so a full-zoom drag can't fling the image arbitrarily far off
    // screen — generous enough not to feel clamped during normal panning.
    const maxOffset = z > 1 ? (z - 1) * 180 : 0;
    return { x: Math.max(-maxOffset, Math.min(maxOffset, p.x)), y: Math.max(-maxOffset, Math.min(maxOffset, p.y)) };
  }

  function zoomBy(delta) {
    setZoom(z => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +(z + delta).toFixed(2))));
    setPan({ x: 0, y: 0 });
  }

  function handleImageTap(e) {
    // Doubles as both double-click (desktop) and double-tap (mobile) —
    // the browser fires a synthetic click after a tap either way.
    const now = Date.now();
    const isDouble = now - lastTapRef.current < 300;
    lastTapRef.current = now;
    if (!isDouble) return;
    e.stopPropagation();
    if (zoom > 1) resetZoom(); else { setZoom(DOUBLE_TAP_ZOOM); setPan({ x: 0, y: 0 }); }
  }

  function handleImageWheel(e) {
    if (isVideo) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 0.3 : -0.3);
  }

  function handleImageMouseDown(e) {
    if (isVideo || zoom <= 1) return;
    panDragRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }
  function handleImageMouseMove(e) {
    if (!panDragRef.current) return;
    const { x, y, panX, panY } = panDragRef.current;
    setPan(clampPan(zoom, { x: panX + (e.clientX - x), y: panY + (e.clientY - y) }));
  }
  function handleImageMouseUp() { panDragRef.current = null; }

  function touchDist(t1, t2) { return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY); }

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

  // Derived before the hooks below (rather than after, past an early
  // return) so every hook still runs on every render regardless of whether
  // `item` happens to be defined — item should always exist in practice
  // (index is kept in range by goNext/goPrev), but Rules of Hooks requires
  // this either way.
  const item = items[index];
  const post = item?.post || {};
  const isVideo = item?.type === 'video';
  const playlistUrl = isVideo && post.source === 'bluesky' ? deriveBlueskyPlaylistUrl(item.url) : null;
  const directVideoUrl = isVideo && !playlistUrl && item?.url && isDirectVideoUrl(item.url) ? item.url : null;
  const playableVideo = !!(playlistUrl || directVideoUrl);

  const getNativeEl = useCallback(
    () => (playlistUrl ? hlsVideoRef.current : fileVideoRef.current),
    [playlistUrl]
  );

  // Every new video — including one swapped in via next/prev, a fresh mount
  // each time since the element below is keyed by item.url — needs its
  // play() primed with the current muted state right before the call, not
  // just via the JSX/element attribute: mobile Safari/Chrome check muted
  // state at the moment play() actually runs (see the note on the `muted`
  // state above). Direct-file videos need this handled here explicitly;
  // HlsVideoPlayer already does the equivalent internally for the HLS path,
  // so this effect skips it there to avoid fighting over the same element.
  useEffect(() => {
    if (!directVideoUrl) return;
    const v = fileVideoRef.current;
    if (!v) return;
    v.muted = muted;
    v.defaultMuted = muted;
    v.playsInline = true;
    v.play().catch(() => {
      if (!v.muted) {
        v.muted = true;
        setMuted(true);
        v.play().catch(() => {});
      }
    });
    // Deliberately excludes `muted` — this should only re-run when the
    // video itself changes (new index/src), not every time the mute button
    // is pressed; the live element's muted state after that point is kept
    // in sync by the reactive `muted={muted}` prop on the element instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directVideoUrl]);

  // Fresh video each time the index changes — starts playing (see above),
  // so the pause indicator resets instead of carrying over the previous
  // video's state.
  useEffect(() => { setPaused(false); }, [index]);

  function togglePlay() {
    const v = getNativeEl();
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }

  if (!item) return null;

  function handleTouchStart(e) {
    if (!isVideo && e.touches.length === 2) {
      pinchRef.current = { startDist: touchDist(e.touches[0], e.touches[1]), startZoom: zoom };
      touchStartX.current = null;
      return;
    }
    if (e.touches.length === 1) {
      if (!isVideo && zoom > 1) {
        panDragRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, panX: pan.x, panY: pan.y };
        touchStartX.current = null;
      } else {
        touchStartX.current = e.touches[0].clientX;
      }
    }
  }
  function handleTouchMove(e) {
    if (pinchRef.current && e.touches.length === 2) {
      const scale = pinchRef.current.startZoom * (touchDist(e.touches[0], e.touches[1]) / pinchRef.current.startDist);
      setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale)));
      return;
    }
    if (panDragRef.current && e.touches.length === 1) {
      const { x, y, panX, panY } = panDragRef.current;
      setPan(clampPan(zoom, { x: panX + (e.touches[0].clientX - x), y: panY + (e.touches[0].clientY - y) }));
    }
  }
  function handleTouchEnd(e) {
    if (pinchRef.current) {
      pinchRef.current = null;
      if (zoom <= 1.05) resetZoom();
      return;
    }
    if (panDragRef.current) { panDragRef.current = null; return; }
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
      onTouchMove={handleTouchMove}
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

      {/* Same control (position, style, persists across next/prev) on every
          device — the native <video controls> this replaced rendered its
          own browser/OS-specific chrome per platform, which is what made
          mute/pause behave differently on mobile and tablet than desktop. */}
      {playableVideo && (
        <button
          onClick={e => { e.stopPropagation(); setMuted(m => !m); }}
          aria-label={muted ? 'Unmute' : 'Mute'}
          style={{ position: 'absolute', top: 16, right: 64, ...OVERLAY_BTN_STYLE, fontSize: '1.05rem' }}
        >{muted ? '🔇' : '🔊'}</button>
      )}

      {/* Zoom controls — photos only. Pinch/double-tap/wheel all drive the
          same zoom state; these buttons just make it discoverable. */}
      {!isVideo && (
        <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, display: 'flex', gap: 8 }}>
          <button
            onClick={() => zoomBy(-0.5)}
            aria-label="Zoom out"
            disabled={zoom <= MIN_ZOOM}
            style={{ ...OVERLAY_BTN_STYLE, fontSize: '1.2rem', opacity: zoom <= MIN_ZOOM ? 0.4 : 1, cursor: zoom <= MIN_ZOOM ? 'default' : 'pointer' }}
          >−</button>
          <button
            onClick={() => zoomBy(0.5)}
            aria-label="Zoom in"
            disabled={zoom >= MAX_ZOOM}
            style={{ ...OVERLAY_BTN_STYLE, fontSize: '1.2rem', opacity: zoom >= MAX_ZOOM ? 0.4 : 1, cursor: zoom >= MAX_ZOOM ? 'default' : 'pointer' }}
          >+</button>
          {zoom > 1 && (
            <button
              onClick={resetZoom}
              aria-label="Reset zoom"
              style={{ ...OVERLAY_BTN_STYLE, width: 'auto', padding: '0 12px', fontSize: '.72rem', fontWeight: 700 }}
            >{Math.round(zoom * 100)}%</button>
          )}
        </div>
      )}

      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '92vw', maxHeight: '90vh' }}>
        {isVideo ? (
          playlistUrl ? (
            <div style={{ position: 'relative', display: 'inline-block', maxWidth: '92vw' }}>
              <HlsVideoPlayer key={item.url} src={playlistUrl} poster={item.url} autoPlay muted={muted}
                videoRef={hlsVideoRef} onClick={togglePlay}
                onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
                onMutedFallback={() => setMuted(true)}
                style={{ maxWidth: '92vw', maxHeight: '72vh', borderRadius: 10 }} />
              {paused && (
                <button onClick={e => { e.stopPropagation(); togglePlay(); }} aria-label="Play" style={{
                  position: 'absolute', inset: 0, margin: 'auto', width: 60, height: 60,
                  borderRadius: '50%', background: 'rgba(0,0,0,.5)', border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '1.5rem', cursor: 'pointer',
                }}>▶</button>
              )}
            </div>
          ) : directVideoUrl ? (
            <div style={{ position: 'relative', display: 'inline-block', maxWidth: '92vw' }}>
              <video key={item.url} ref={fileVideoRef} src={directVideoUrl} muted={muted} playsInline
                onClick={togglePlay}
                onPlay={() => setPaused(false)} onPause={() => setPaused(true)}
                style={{ maxWidth: '92vw', maxHeight: '72vh', objectFit: 'contain', borderRadius: 10, display: 'block', background: '#000' }} />
              {paused && (
                <button onClick={e => { e.stopPropagation(); togglePlay(); }} aria-label="Play" style={{
                  position: 'absolute', inset: 0, margin: 'auto', width: 60, height: 60,
                  borderRadius: '50%', background: 'rgba(0,0,0,.5)', border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '1.5rem', cursor: 'pointer',
                }}>▶</button>
              )}
            </div>
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
          <div style={{ maxWidth: '92vw', maxHeight: '72vh', overflow: 'hidden', borderRadius: 10 }}>
            <img
              key={item.url}
              src={item.url}
              alt={post.title || ''}
              draggable={false}
              onClick={handleImageTap}
              onWheel={handleImageWheel}
              onMouseDown={handleImageMouseDown}
              onMouseMove={handleImageMouseMove}
              onMouseUp={handleImageMouseUp}
              onMouseLeave={handleImageMouseUp}
              style={{
                maxWidth: '92vw', maxHeight: '72vh', objectFit: 'contain', display: 'block',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transition: pinchRef.current || panDragRef.current ? 'none' : 'transform .15s ease',
                cursor: zoom > 1 ? 'grab' : 'zoom-in',
                touchAction: zoom > 1 ? 'none' : 'pan-y',
              }}
            />
          </div>
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
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            {/* Stays inside the app — the full post, with comments, instead
                of sending the viewer off-site. The external link below is
                still there for anyone who specifically wants the original. */}
            {post.id && (
              <button
                onClick={e => { e.stopPropagation(); onClose(); navigate(`/p/${encodeURIComponent(post.id)}`); }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '.78rem',
                  color: '#fff', background: 'rgba(255,255,255,.14)', border: 'none',
                  borderRadius: 16, padding: '6px 14px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                View
              </button>
            )}
            {/* Video items previously had a "watch on source" link in the
                single-post VideoModal this replaced — preserved here so
                merging video into the shared viewer didn't quietly drop it. */}
            {isVideo && post.sourceUrl && (
              <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ display: 'inline-flex', alignItems: 'center', fontSize: '.78rem', color: '#93c5fd', textDecoration: 'none', fontWeight: 600 }}>
                Watch on {post.sourceLabel || post.source} ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
