'use strict';

const { officialVideoReference, suppliedHlsUrl, suppliedVideoFileUrl, openProtocolVideo } = require('./video-media-urls.mjs');

const VIDEO_FEED_MIN_DURATION_SECONDS = 5;
const VIDEO_FEED_MAX_DURATION_SECONDS = 15 * 60;

function normalizeVideoDurationSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.floor(seconds)) : null;
}

function meetsVideoMinimumDuration(post) {
  const duration = normalizeVideoDurationSeconds(post?.videoDurationSeconds ?? post?.video_duration_seconds ?? post?.durationSeconds);
  return duration == null || duration >= VIDEO_FEED_MIN_DURATION_SECONDS;
}

function isPlayableVideoPost(post) {
  if (!post || post.mediaType !== 'video') return false;
  const videoUrls = [post.mediaUrl, post.sourceUrl].filter(Boolean);
  if (videoUrls.some(url => officialVideoReference(url))) return true;
  if (post.source === 'youtube') return false;
  if (['mastodon', 'bluesky'].includes(post.source)) return Boolean(openProtocolVideo(post));
  return videoUrls.some(url => suppliedHlsUrl(url) || suppliedVideoFileUrl(url));
}

function isVideoSurfacePost(post) {
  if (!meetsVideoMinimumDuration(post)) return false;
  if (isMusicVideoPost(post)) return false;
  if (!isPlayableVideoPost(post)) return false;
  const duration = normalizeVideoDurationSeconds(post.videoDurationSeconds ?? post.video_duration_seconds);
  if (duration != null) return duration <= VIDEO_FEED_MAX_DURATION_SECONDS;
  return true;
}

function isRegularFeedSurfacePost(post) {
  if (isMusicVideoPost(post)) return false;
  if (!isPlayableVideoPost(post)) return true;
  const duration = normalizeVideoDurationSeconds(post.videoDurationSeconds ?? post.video_duration_seconds);
  if (duration != null) return duration > VIDEO_FEED_MAX_DURATION_SECONDS;
  return !/youtube(?:-nocookie)?\.com\/shorts\//i.test(post.sourceUrl || '');
}

function isMusicVideoPost(post) {
  if (!meetsVideoMinimumDuration(post)) return false;
  if (!isPlayableVideoPost(post)) return false;
  const text = [post.title, post.topic, post.genre, ...(Array.isArray(post.tags) ? post.tags : [])].filter(Boolean).join(' ');
  if (/\b(tutorial|lesson|review|music industry|music news)\b/i.test(text)) return false;
  return String(post.categoryId || post.category_id || '') === '10'
    || /\b(music|song|songs|lyrics?|official audio|live performance|concert|remix|karaoke|acoustic cover)\b/i.test(text);
}

function continuousVideoPageMeta(query = {}, upstreamHasMore) {
  const isSearch = Boolean(String(query.q || '').trim());
  const sourceHasMore = upstreamHasMore !== false;
  return {
    hasMore: isSearch ? sourceHasMore : true,
    waitingForNew: !isSearch && !sourceHasMore,
  };
}

module.exports = {
  VIDEO_FEED_MIN_DURATION_SECONDS,
  meetsVideoMinimumDuration,
  VIDEO_FEED_MAX_DURATION_SECONDS,
  normalizeVideoDurationSeconds,
  isPlayableVideoPost,
  isMusicVideoPost,
  isVideoSurfacePost,
  isRegularFeedSurfacePost,
  continuousVideoPageMeta,
};
