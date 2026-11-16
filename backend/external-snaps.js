'use strict';
const { isSourceDisplayAllowed } = require('./source-policy');
const { authorProfilePhoto } = require('./source-profile-photos');
const { CLIP_MAX_SECONDS, CLIP_LOOKBACK_MS, FOLLOWING_CLIP_SOURCES, externalSnapVideo } = require('./video-placement');

const CLIP_PER_SOURCE = 16;
const CLIP_TOTAL = 200;
const YOUTUBE_SHORTS_PATTERN = '^https://(www[.]|m[.])?youtube[.]com/shorts/[a-zA-Z0-9_-]{11}/?([?].*)?(#.*)?$';
const PUBLIC_CLIP_QUERY = `
  SELECT clip.* FROM unnest($1::text[]) AS sources(source)
  CROSS JOIN LATERAL (
    SELECT * FROM feed_posts_cache
    WHERE source = sources.source AND media_type = 'video'
      AND post_created_at > $2 AND post_created_at <= $3
      AND ((video_duration_seconds > 0 AND video_duration_seconds <= ${CLIP_MAX_SECONDS})
        OR ((video_duration_seconds IS NULL OR video_duration_seconds = 0)
          AND (source_url ~ '${YOUTUBE_SHORTS_PATTERN}' OR media_url ~ '${YOUTUBE_SHORTS_PATTERN}')))
    ORDER BY post_created_at DESC LIMIT 40
  ) AS clip`;

function httpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    return url.href;
  } catch { return null; }
}

// External clips are previews of source posts, separate from native 24-hour
// Snaps. Never convert article thumbnails or ordinary long videos into Snaps.
function externalSnapsFromPosts(posts, { mode = 'home', now = Date.now(), disabledSources = [], env = process.env } = {}) {
  const disabled = new Set(disabledSources);
  const groups = new Map(), seen = new Set();
  const candidates = [...(Array.isArray(posts) ? posts : [])].sort((a, b) => Date.parse(b?.createdAt || 0) - Date.parse(a?.createdAt || 0));
  for (const post of candidates) {
    if (!post?.id || disabled.has(post.source) || !isSourceDisplayAllowed(post.source, { env })) continue;
    const placement = externalSnapVideo(post, { mode, now, env });
    if (!placement) continue;
    const { createdAt, duration, sourceUrl, mediaUrl, youtube, openMedia } = placement;
    const key = `${post.source}:${post.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!groups.has(post.source)) groups.set(post.source, []);
    const group = groups.get(post.source);
    if (group.length >= CLIP_PER_SOURCE) continue;
    const trustedDirect = post.directPlaybackAuthorized === true;
    const suppliedLikes = post.sourceLikesCount ?? (post.likesScope === 'uficonnect' ? undefined : post.likesCount);
    const sourceLikes = typeof suppliedLikes === 'string' && /^\d+$/.test(suppliedLikes) ? Number(suppliedLikes) : suppliedLikes;
    const thumbnailUrl = httpsUrl(post.mediaPoster || post.thumbnailUrl)
      || (youtube ? /\.(?:jpg|jpeg|webp|png)(?:\?|$)/i.test(post.mediaUrl || '')
        ? httpsUrl(post.mediaUrl) : `https://i.ytimg.com/vi/${youtube.id}/hqdefault.jpg` : null);
    group.push({
      id: String(post.id), source: post.source, sourceLabel: post.sourceLabel || post.source,
      sourceUrl, author: { id: post.author?.id || post.authorId || null,
        name: post.author?.name || post.sourceLabel || post.source,
        avatarUrl: authorProfilePhoto(post), profileUrl: httpsUrl(post.author?.profileUrl || post.authorUrl),
        ...(post.author?.channelId ? { channelId: post.author.channelId } : {}) },
      caption: String(post.title || post.content || '').replace(/<[^>]*>/g, '').slice(0, 500),
      mediaType: 'video', mediaUrl, thumbnailUrl,
      mediaKind: youtube ? 'youtube' : openMedia?.kind || (trustedDirect ? /\.m3u8(?:[?#]|$)/i.test(mediaUrl) ? 'hls' : 'file' : 'source'),
      ...(youtube ? { embedId: youtube.id } : {}), directPlaybackAuthorized: trustedDirect,
      videoDurationSeconds: duration,
      ...(post.source !== 'twitch' && Number.isSafeInteger(sourceLikes) && sourceLikes >= 0 ? { sourceLikesCount: sourceLikes } : {}),
      ...(mode === 'following' && typeof post.sourceLikedByMe === 'boolean' ? { sourceLikedByMe: post.sourceLikedByMe } : {}),
      createdAt: new Date(createdAt).toISOString(), expiresAt: new Date(createdAt + CLIP_LOOKBACK_MS).toISOString(),
      visibility: post.visibility || 'public', owned: false, isExternal: true,
    });
  }
  // Keep a busy source from crowding out the other sources' boxes.
  const result = [], queues = [...groups.values()];
  for (let round = 0; round < CLIP_PER_SOURCE && result.length < CLIP_TOTAL; round++) {
    for (const queue of queues) if (queue[round] && result.length < CLIP_TOTAL) result.push(queue[round]);
  }
  return result;
}

function createExternalSnapLoader({ getPublicPosts, getFollowingPosts, getUser, filterVisible = async posts => posts,
  hydrateAvatars = async snaps => snaps, now = Date.now, env = process.env }) {
  return async ({ mode, viewerId, source = null, bust = false }) => {
    if (mode === 'ufi' || source === 'uficonnect' || (mode === 'following' && !viewerId)) return { snaps: [], sourceErrors: {} };
    const user = viewerId ? await getUser(viewerId) : null;
    if (mode === 'following' && !user) return { snaps: [], sourceErrors: {} };
    const disabledSources = Array.isArray(user?.roleSettings?.disabledSources) ? user.roleSettings.disabledSources : [];
    const sources = FOLLOWING_CLIP_SOURCES.filter(candidate => (!source || candidate === source)
      && !disabledSources.includes(candidate) && isSourceDisplayAllowed(candidate, { env }));
    // Snaps reuse the authenticated following cache. Loading/refreshing the
    // rail must not trigger an extra forced paid read after loading the feed.
    // An explicit refresh affects only the source whose button was clicked.
    const loaded = mode === 'following'
      ? sources.length ? await getFollowingPosts(viewerId, sources, { bust: Boolean(source && bust), surface: null }) : { posts: [], sourceErrors: {} }
      : await getPublicPosts({ source, bust: Boolean(source && bust) });
    const visible = await filterVisible((loaded.posts || []).filter(post => !source || post.source === source));
    const selected = externalSnapsFromPosts(visible, { mode, now: now(), disabledSources, env });
    // Hydrate only eligible short clips after audience and removal filtering.
    // Profile metadata is optional: an outage cannot hide playable clips.
    let snaps = selected;
    try { snaps = await hydrateAvatars(selected); } catch {}
    return { snaps: Array.isArray(snaps) ? snaps : selected, sourceErrors: loaded.sourceErrors || {} };
  };
}

module.exports = { CLIP_MAX_SECONDS, CLIP_LOOKBACK_MS, FOLLOWING_CLIP_SOURCES, PUBLIC_CLIP_QUERY, externalSnapsFromPosts, createExternalSnapLoader };
