import { directMediaPlaybackAllowed, officialYouTubeId, officialVimeoId, officialTwitchClipId, officialRedditPostEmbedUrl } from './sourceMediaPolicy.mjs';
import { safeMediaUrl } from './videoFeedPolicy.mjs';
import { followingVideoOriginalUrl, openProtocolVideo, publicMediaUrl, suppliedHlsUrl } from '../../../backend/video-media-urls.mjs';

// Compatibility name: this validates the supplied API playlist, never guesses
// a stream path from an image, post URL, provider label or video ID.
export function deriveBlueskyPlaylistUrl(value) {
  return suppliedHlsUrl(value);
}

export function isDirectVideoUrl(value, post) {
  if (!directMediaPlaybackAllowed(post)) return false;
  const url = safeMediaUrl(value);
  if (!url) return false;
  if (['mastodon', 'bluesky'].includes(post?.source) && post.directPlaybackAuthorized !== true) {
    const native = openProtocolVideo(post);
    return native?.kind === 'file' && native.src === url.href;
  }
  return /\.(?:mp4|webm|mov|m4v|ogv)$/i.test(url.pathname);
}

export function resolveVideoSource(post, mode = 'feed') {
  if (!post || typeof post !== 'object' || post.sourcePlaybackOnly) return null;
  const urls = [post.mediaUrl, post.sourceUrl];
  const poster = safeMediaUrl(post.mediaPoster)?.href || null;
  for (const value of urls) {
    const id = officialYouTubeId(value);
    if (id) return { kind: 'youtube', id, poster: poster || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      vertical: urls.some(candidate => officialYouTubeId(candidate) === id && /^\/shorts\//.test(new URL(candidate).pathname)) ? true : null };
  }
  for (const value of urls) {
    const id = officialVimeoId(value);
    if (id) return { kind: 'vimeo', id, poster };
  }
  if (directMediaPlaybackAllowed(post)) {
    const open = openProtocolVideo(post);
    if (open) return { ...open, poster };
    for (const value of urls) {
      const url = safeMediaUrl(value);
      if (url && /\.m3u8$/i.test(url.pathname)) return { kind: 'hls', src: url.href, poster };
    }
    const file = urls.find(value => isDirectVideoUrl(value, post));
    if (file) return { kind: 'file', src: safeMediaUrl(file).href, poster };
  }
  if (mode !== 'following') return null;
  const original = followingVideoOriginalUrl(post);
  if (!original) return null;
  const twitchId = post.source === 'twitch' ? officialTwitchClipId(original) : null;
  if (twitchId) return { kind: 'twitch', id: twitchId };
  const embed = post.source === 'reddit' && post.visibility === 'public' ? officialRedditPostEmbedUrl(original) : null;
  return { kind: 'source', src: original, poster: publicMediaUrl(post.mediaPoster), embed };
}
