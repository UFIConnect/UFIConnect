import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { deriveBlueskyPlaylistUrl, isDirectVideoUrl, extractYouTubeId, loadYouTubeIframeApi, HlsVideoPlayer, userWantsSound, rememberSoundPreference } from './videoMedia';

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
// list. Video source resolution mirrors VideoFeedView's resolveVideoSource:
// YouTube (via the real IFrame Player API, same as the swipe feed), Bluesky's
// HLS playlist, a direct video file, or (for sources that hand back neither
// a YouTube ID nor a scrapable playable URL) a static poster with a link out
// to watch on the original source rather than silently rendering nothing.
export default function ImageLightbox({ items, startIndex = 0, onClose, onNearEnd }) {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(items.length - 1, 0)));
  const touchStartX = useRef(null);
  const navigate = useNavigate();
  // Muted by default, even though opening the lightbox is itself a
  // deliberate click — a *previous* version of this started unmuted on the
  // theory that click counted as consent, and revealed sound automatically
  // once play() resolved. That reveal is a delayed, asynchronous
  // `.muted = false` write, not the direct synchronous result of a user
  // gesture, and Safari in particular can silently accept the property
  // write (so the mute button's icon correctly shows "unmuted") while still
  // refusing to actually output audio — confirmed live as "shows unmuted
  // but no voice is playing." The mute button below is what actually
  // unmutes now, since a direct click handler is a gesture every browser
  // honors, same fix applied to VideoFeedView's swipe feed.
  //
  // Starting *every* video muted-until-clicked, taken alone, meant a real
  // click was needed on every single one, forever — see userWantsSound's
  // own comment. Once the user has directly clicked unmute at all, this
  // starts already unmuted instead.
  const [muted, setMuted] = useState(() => !userWantsSound());
  const [paused, setPaused] = useState(false);
  // See VideoFeedView's identical ytFailed — the IFrame Player API script
  // doesn't load on some devices/networks; falls back to a plain embed
  // iframe (still autoplays on its own, just without this app's own
  // pause/mute control layer) instead of leaving the mount blank.
  const [ytFailed, setYtFailed] = useState(false);
  const fileVideoRef = useRef(null);
  const hlsVideoRef = useRef(null);
  const ytMountRef = useRef(null);
  const ytPlayerRef = useRef(null);

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
  // Same precedence as VideoFeedView's resolveVideoSource — a dedicated
  // YouTube post carries embedId (or a recoverable sourceUrl); any other
  // source's article can embed a real YouTube video too, in which case
  // mediaUrl itself is the watch URL.
  const youtubeId = isVideo
    ? (post.source === 'youtube' ? (post.embedId || extractYouTubeId(post.sourceUrl)) : extractYouTubeId(post.mediaUrl))
    : null;
  const playlistUrl = isVideo && !youtubeId && post.source === 'bluesky' ? deriveBlueskyPlaylistUrl(item.url) : null;
  const directVideoUrl = isVideo && !youtubeId && !playlistUrl && item?.url && isDirectVideoUrl(item.url) ? item.url : null;
  const playableVideo = !!(youtubeId || playlistUrl || directVideoUrl);

  const getNativeEl = useCallback(
    () => (playlistUrl ? hlsVideoRef.current : fileVideoRef.current),
    [playlistUrl]
  );

  // Every new video — including one swapped in via next/prev, a fresh mount
  // each time since the element below is keyed by item.url — always starts
  // genuinely muted (the one autoplay policy every browser reliably
  // allows). Direct-file videos need this handled here explicitly;
  // HlsVideoPlayer already does the equivalent internally for the HLS path,
  // so this effect skips it there to avoid fighting over the same element.
  useEffect(() => {
    if (!directVideoUrl) return;
    const v = fileVideoRef.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.play().catch(() => {});
  }, [directVideoUrl]);

  // React's `muted` JSX prop doesn't reliably keep a <video> element's live
  // property in sync with prop changes after mount (see HlsVideoPlayer's
  // own version of this same fix) — without this, the mute button could
  // update its own icon with nothing actually changing on the element.
  useEffect(() => {
    if (!directVideoUrl) return;
    const v = fileVideoRef.current;
    if (v) v.muted = muted;
  }, [muted, directVideoUrl]);

  // Fresh video each time the index changes — starts playing (see above),
  // so the pause indicator resets instead of carrying over the previous
  // video's state.
  useEffect(() => { setPaused(false); }, [index]);

  // youtube: the real IFrame Player API, same as VideoFeedView's swipe
  // feed — a raw <iframe src="..."> embed has no programmatic control at
  // all, so pause needs this instead. The player always mounts muted
  // (playerVars.mute stays 1 — the one autoplay policy every browser
  // reliably allows), but if `muted` was already false when this effect
  // ran — the user has directly clicked unmute on an earlier video this
  // session, see userWantsSound — it's unmuted right away in onReady
  // instead of waiting for a fresh click on this one too. Unlike the
  // "shows unmuted but no voice is playing" bug this replaced, this isn't
  // a blind reveal: it's only reached because of real, prior, direct
  // engagement, which is the same signal browsers themselves use to judge
  // autoplay-with-sound more leniently.
  useEffect(() => {
    if (!youtubeId) return;
    let cancelled = false;
    const startUnmuted = !muted;
    setYtFailed(false);
    const readyTimeout = setTimeout(() => { if (!cancelled) setYtFailed(true); }, 6000);
    loadYouTubeIframeApi().then((YT) => {
      if (cancelled || !ytMountRef.current) return;
      const player = new YT.Player(ytMountRef.current, {
        videoId: youtubeId,
        playerVars: { autoplay: 1, mute: 1, playsinline: 1, controls: 0, modestbranding: 1, rel: 0 },
        events: {
          onReady: (e) => {
            if (cancelled) return;
            clearTimeout(readyTimeout);
            ytPlayerRef.current = e.target;
            if (startUnmuted) e.target.unMute();
            // Same fix as VideoFeedView's YouTube slide: playerVars.autoplay:1
            // alone isn't reliable on every re-construction (confirmed live
            // there — a re-activated player's iframe carried autoplay=1 the
            // same as its first activation, yet never actually started).
            // Explicit call removes the dependency on implicit autoplay.
            e.target.playVideo();
          },
          onStateChange: (e) => {
            if (cancelled) return;
            setPaused(e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED);
          },
          onError: () => { if (!cancelled) setYtFailed(true); },
        },
      });
    }).catch(() => { if (!cancelled) setYtFailed(true); });
    return () => {
      cancelled = true;
      clearTimeout(readyTimeout);
      try { ytPlayerRef.current?.destroy(); } catch {}
      ytPlayerRef.current = null;
    };
  }, [youtubeId]);

  // Keep an already-mounted YouTube player's mute state in sync with the
  // mute button — the mount effect above only sets it once, at onReady.
  useEffect(() => {
    if (!youtubeId || !ytPlayerRef.current) return;
    if (muted) ytPlayerRef.current.mute(); else ytPlayerRef.current.unMute();
  }, [muted, youtubeId]);

  function togglePlay() {
    if (youtubeId) {
      const p = ytPlayerRef.current;
      if (!p) return;
      if (paused) p.playVideo(); else p.pauseVideo();
      return;
    }
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
          onClick={e => { e.stopPropagation(); setMuted(m => { rememberSoundPreference(m); return !m; }); }}
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
          ) : youtubeId ? (
            <div style={{ position: 'relative', width: 'min(92vw, 640px)', aspectRatio: '16 / 9', borderRadius: 10, overflow: 'hidden', background: '#000' }}>
              {ytFailed ? (
                // See VideoFeedView's identical fallback — a plain embed
                // iframe doesn't depend on the IFrame Player API script at
                // all and still autoplays muted on its own, so real
                // playback survives even where that script doesn't load.
                <iframe
                  src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=${userWantsSound() ? 0 : 1}&playsinline=1&controls=1&modestbranding=1&rel=0`}
                  style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  title={post.title}
                />
              ) : (
                <>
                  {/* Cross-origin iframe — the parent page can't see clicks
                      that land inside it, so pointer-events are disabled on
                      the mount itself and this wrapper's onClick drives
                      play/pause instead (same technique VideoFeedView's
                      YouTube slide uses). */}
                  <div onClick={e => { e.stopPropagation(); togglePlay(); }} style={{ position: 'absolute', inset: 0 }}>
                    <div key={youtubeId} ref={ytMountRef} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />
                  </div>
                  {paused && (
                    <button onClick={e => { e.stopPropagation(); togglePlay(); }} aria-label="Play" style={{
                      position: 'absolute', inset: 0, margin: 'auto', width: 60, height: 60,
                      borderRadius: '50%', background: 'rgba(0,0,0,.5)', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontSize: '1.5rem', cursor: 'pointer',
                    }}>▶</button>
                  )}
                </>
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
