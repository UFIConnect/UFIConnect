// Request the chosen sound state before play. A browser policy rejection may
// fall back to silent playback without changing the user's sound preference.
export async function playMedia(video, { muted = false, isCurrent = () => true } = {}) {
  if (!video || !isCurrent()) return false;
  video.muted = muted;
  video.defaultMuted = muted;
  video.playsInline = true;
  if (!muted && video.volume === 0) video.volume = 1;
  try { await video.play(); return isCurrent(); }
  catch (error) {
    if (error?.name !== 'NotAllowedError' || muted || !isCurrent() || video.muted) return false;
    video.muted = true;
    try { await video.play(); return isCurrent(); } catch { return false; }
  }
}

// Vimeo rejects the pending play request when audio autoplay is blocked.
export async function playVimeo(controller, { muted = false, isCurrent = () => true } = {}) {
  if (!isCurrent()) return false;
  try {
    await controller.call('setMuted', muted);
    if (!isCurrent()) return false;
    try { await controller.call('play'); }
    catch (error) {
      if (error?.name !== 'NotAllowedError' || muted || !isCurrent()) return false;
      await controller.call('setMuted', true);
      if (!isCurrent()) return false;
      await controller.call('play');
    }
    return isCurrent();
  } catch { return false; }
}
