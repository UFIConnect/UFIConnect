// Request the chosen sound state before play. A browser policy rejection may
// fall back to silent playback without changing the user's sound preference.
export async function playMedia(video, { muted = false, fallbackToMuted = true, isCurrent = () => true } = {}) {
  if (!video || !isCurrent()) return false;
  video.muted = muted;
  video.defaultMuted = muted;
  video.playsInline = true;
  if (!muted && video.volume === 0) video.volume = 1;
  try { await video.play(); return isCurrent(); }
  catch (error) {
    if (error?.name !== 'NotAllowedError' || !fallbackToMuted || muted || !isCurrent() || video.muted) return false;
    video.muted = true;
    try { await video.play(); return isCurrent(); } catch { return false; }
  }
}

// Vimeo rejects the pending play request when audio autoplay is blocked.
export async function playVimeo(controller, {
  muted = false, isCurrent = () => true, isSoundCurrent = () => true, onStartDeferred,
  applyMute = value => controller.call('setMuted', value),
} = {}) {
  if (!isCurrent()) return false;
  const canPlay = () => {
    if (isCurrent() && isSoundCurrent()) return true;
    onStartDeferred?.();
    return false;
  };
  try {
    for (const attemptMuted of muted ? [true] : [false, true]) {
      await applyMute(attemptMuted);
      if (!canPlay()) return false;
      try {
        await controller.call('play');
        return isCurrent();
      } catch (error) {
        if (error?.name !== 'NotAllowedError' || !canPlay()) return false;
      }
    }
  } catch {}
  return false;
}
