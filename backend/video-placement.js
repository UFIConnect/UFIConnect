'use strict';

const VIDEO_FEED_MAX_DURATION_SECONDS = 15 * 60;
const PLAYABLE_YOUTUBE_URL = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#\s]*?&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)[\w-]{11}/i;

function normalizeVideoDurationSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : null;
}

function isPlayableVideoPost(post) {
  if (!post || post.mediaType !== 'video') return false;
  if (post.source === 'bluesky') return Boolean(post.mediaUrl && /\.m3u8(\?|$)/i.test(post.mediaUrl));
  const videoUrls = [post.mediaUrl, post.sourceUrl].filter(Boolean);
  if (post.source === 'youtube') {
    return Boolean(post.embedId || videoUrls.some(url => PLAYABLE_YOUTUBE_URL.test(url)));
  }
  if (videoUrls.some(url => PLAYABLE_YOUTUBE_URL.test(url))) return true;
  if (videoUrls.some(url => /vimeo\.com\/(?:video\/)?\d+/i.test(url))) return true;
  if (videoUrls.some(url => /\.m3u8(\?|$)/i.test(url))) return true;
  return videoUrls.some(url => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url));
}

function isVideoSurfacePost(post) {
  if (!isPlayableVideoPost(post)) return false;
  const duration = normalizeVideoDurationSeconds(post.videoDurationSeconds ?? post.video_duration_seconds);
  if (duration != null) return duration <= VIDEO_FEED_MAX_DURATION_SECONDS;
  return true;
}

function isRegularFeedSurfacePost(post) {
  if (!isPlayableVideoPost(post)) return true;
  const duration = normalizeVideoDurationSeconds(post.videoDurationSeconds ?? post.video_duration_seconds);
  if (duration != null) return duration > VIDEO_FEED_MAX_DURATION_SECONDS;
  return !/youtube(?:-nocookie)?\.com\/shorts\//i.test(post.sourceUrl || '');
}

module.exports = {
  VIDEO_FEED_MAX_DURATION_SECONDS,
  normalizeVideoDurationSeconds,
  isPlayableVideoPost,
  isVideoSurfacePost,
  isRegularFeedSurfacePost,
};
