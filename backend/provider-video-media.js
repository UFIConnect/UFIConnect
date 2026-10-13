const { publicMediaUrl, officialVideoReference, suppliedHlsUrl } = require('./video-media-urls.mjs');
const { normalizeVideoDurationSeconds } = require('./video-placement');

const emptyMedia = () => ({ mediaType: null, mediaUrl: null, mediaPoster: null });

function mastodonMedia(attachments, card) {
  const items = Array.isArray(attachments) ? attachments : attachments ? [attachments] : [];
  const candidates = items.map(media => {
    if (!media || !['video', 'gifv', 'image'].includes(media.type)) return null;
    const mediaUrl = publicMediaUrl(media.url) || publicMediaUrl(media.remote_url);
    const poster = publicMediaUrl(media.preview_url);
    if (media.type === 'image') return mediaUrl || poster ? { mediaType: 'image', mediaUrl: poster || mediaUrl, mediaPoster: null } : null;
    return { mediaType: 'video', mediaUrl, mediaPoster: poster,
      videoDurationSeconds: normalizeVideoDurationSeconds(media.meta?.original?.duration ?? media.meta?.duration),
      ...(media.type === 'gifv' ? { videoPresentation: 'gif' } : {}) };
  }).filter(Boolean);
  const video = candidates.find(media => media.mediaType === 'video' && media.mediaUrl);
  if (video) return video;
  if (candidates.length) return candidates[0];
  const external = officialVideoReference(card?.url);
  return external ? { mediaType: 'video', mediaUrl: external.url, mediaPoster: publicMediaUrl(card.image) } : emptyMedia();
}

function blueskyMedia(post, { fullsize = false } = {}) {
  let embed = post?.embed;
  // Only this post's media is promoted. A quoted record keeps its own author.
  if (embed?.$type === 'app.bsky.embed.recordWithMedia#view') embed = embed.media;
  if (embed?.$type === 'app.bsky.embed.video#view') return {
    mediaType: 'video', mediaUrl: suppliedHlsUrl(embed.playlist), mediaPoster: publicMediaUrl(embed.thumbnail),
    ...(embed.presentation === 'gif' ? { videoPresentation: 'gif' } : {}),
  };
  if (embed?.$type === 'app.bsky.embed.images#view') {
    const item = embed.images?.[0];
    const mediaUrl = publicMediaUrl(fullsize ? item?.fullsize : item?.thumb) || publicMediaUrl(item?.fullsize) || publicMediaUrl(item?.thumb);
    return mediaUrl ? { mediaType: 'image', mediaUrl, mediaPoster: null } : emptyMedia();
  }
  if (embed?.$type === 'app.bsky.embed.external#view') {
    const external = officialVideoReference(embed.external?.uri);
    if (external) return { mediaType: 'video', mediaUrl: external.url, mediaPoster: publicMediaUrl(embed.external?.thumb) };
  }
  return emptyMedia();
}

module.exports = { mastodonMedia, blueskyMedia };
