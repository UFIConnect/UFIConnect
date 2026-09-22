export const MIN_FEED_VIDEO_SECONDS = 5;

export function videoDurationSeconds(post) {
  for (const value of [post?.videoDurationSeconds, post?.video_duration_seconds, post?.durationSeconds]) {
    if (value === null || value === undefined || value === '') continue;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return null;
}

// Unknown metadata and live streams stay eligible until a player can verify
// a finite duration. Zero from YouTube means metadata is not available yet.
export function isShortFeedVideo(seconds) {
  const duration = Number(seconds);
  return Number.isFinite(duration) && duration > 0 && duration < MIN_FEED_VIDEO_SECONDS;
}

export function videoSourceKey(source) {
  return source ? `${source.kind}:${source.id || source.src}` : null;
}

export function safeMediaUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

export function fitVideoFrame(width, height, ratio = 16 / 9) {
  const fittedWidth = Math.min(Math.max(0, width), Math.max(0, height) * ratio);
  const fittedHeight = fittedWidth / ratio;
  return { width: fittedWidth, height: fittedHeight, left: (width - fittedWidth) / 2, top: (height - fittedHeight) / 2 };
}
