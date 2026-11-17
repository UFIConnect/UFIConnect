'use strict';

const { officialVideoReference, publicMediaUrl, suppliedHlsUrl, suppliedVideoFileUrl, openProtocolVideo, followingVideoOriginalUrl } = require('./video-media-urls.mjs');
const { isAgeRestricted } = require('./content-age');
const { getSourcePolicy, validateOriginalUrl } = require('./source-policy');
const { home } = require('../shared/feed-source-catalog.json');

const VIDEO_FEED_MIN_DURATION_SECONDS = 5;
const VIDEO_FEED_MAX_DURATION_SECONDS = 15 * 60;
const CLIP_MAX_SECONDS = 180;
const CLIP_LOOKBACK_MS = 7 * 86400000;
const FOLLOWING_CLIP_SOURCES = ['youtube', 'reddit', 'mastodon', 'bluesky', 'twitter', 'twitch'];
const publicClipSources = new Set(home);
const followingClipSources = new Set(FOLLOWING_CLIP_SOURCES);

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

function isVideoSurfacePost(post, mode = 'home') {
  if (!meetsVideoMinimumDuration(post)) return false;
  if (isMusicVideoPost(post)) return false;
  const following = mode === 'following';
  if (!isPlayableVideoPost(post) && !(following && followingVideoOriginalUrl(post))) return false;
  const duration = normalizeVideoDurationSeconds(post.videoDurationSeconds ?? post.video_duration_seconds ?? post.durationSeconds);
  // Following can also show clips from the member's Snaps rail. Some
  // providers, including Twitch, only return short clips from followed accounts.
  return (duration == null || duration <= VIDEO_FEED_MAX_DURATION_SECONDS) && (following || !externalSnapVideo(post, { mode }));
}

function isRegularFeedSurfacePost(post) {
  if (isAgeRestricted(post)) return true;
  if (isMusicVideoPost(post)) return false;
  if (!isPlayableVideoPost(post)) return true;
  const duration = normalizeVideoDurationSeconds(post.videoDurationSeconds ?? post.video_duration_seconds);
  if (duration != null) return duration > VIDEO_FEED_MAX_DURATION_SECONDS;
  return !/youtube(?:-nocookie)?\.com\/shorts\//i.test(post.sourceUrl || '');
}

function isMusicVideoPost(post) {
  if (post?.mediaType !== 'video' || !meetsVideoMinimumDuration(post)) return false;
  const text = [post.title, post.topic, post.genre, ...(Array.isArray(post.tags) ? post.tags : [])].filter(Boolean).join(' ');
  if (/\b(tutorial|lesson|review|music industry|music news)\b/i.test(text)) return false;
  return (String(post.categoryId || post.category_id || '') === '10'
    || /\b(music|song|songs|lyrics?|official audio|live performance|concert|remix|karaoke|acoustic cover)\b/i.test(text))
    && isPlayableVideoPost(post);
}

// Match the active Snap pool before reserving a clip for it. Once an external
// clip ages out of the rail, it can still be found in retained Videos history.
function externalSnapVideo(post, { mode = 'home', now = Date.now(), env = process.env } = {}) {
  const following = mode === 'following';
  const sources = following ? followingClipSources : publicClipSources;
  if (!sources.has(post?.source) || post.mediaType !== 'video' || post.isExternal === false
    || isAgeRestricted(post) || post.isLiveCamera || post.isLive || post.matchedByInterest === true
    || (!following && post.visibility && post.visibility !== 'public')) return null;
  const createdAt = Date.parse(post.createdAt);
  if (!Number.isFinite(createdAt) || createdAt > now || createdAt + CLIP_LOOKBACK_MS <= now) return null;
  const rawDuration = Number(post.videoDurationSeconds ?? post.video_duration_seconds ?? post.durationSeconds);
  const duration = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;
  if (duration !== null && duration > CLIP_MAX_SECONDS) return null;
  const sourceUrl = getSourcePolicy(post.source, { env })
    ? validateOriginalUrl(post.source, post.sourceUrl, { env }) : publicMediaUrl(post.sourceUrl);
  if (!sourceUrl) return null;
  const references = [officialVideoReference(sourceUrl), officialVideoReference(post.mediaUrl)];
  const youtube = references.find(reference => reference?.kind === 'youtube');
  if (duration === null && !references.some(reference => reference?.kind === 'youtube' && reference.vertical)) return null;
  if (isMusicVideoPost(post)) return null;

  const openMedia = openProtocolVideo({ ...post, sourceUrl });
  const mediaUrl = youtube ? `https://www.youtube.com/watch?v=${youtube.id}` : openMedia?.src || publicMediaUrl(post.mediaUrl);
  return mediaUrl ? { createdAt, duration, sourceUrl, mediaUrl, youtube, openMedia } : null;
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
  CLIP_MAX_SECONDS,
  CLIP_LOOKBACK_MS,
  FOLLOWING_CLIP_SOURCES,
  externalSnapVideo,
};
