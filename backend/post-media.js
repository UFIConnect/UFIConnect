const { officialVideoReference, suppliedVideoFileUrl, suppliedHlsUrl } = require('./video-media-urls.mjs');

function normalizePostMedia(post) {
  const url = value => {
    if (typeof value !== 'string') return null;
    try {
      const parsed = new URL(value.replace(/&amp;/g,'&'), post.sourceUrl || undefined);
      return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
    } catch { return null; }
  };
  const mediaUrl = url(post.mediaUrl || post.imageUrl || post.thumbnailUrl);
  const mediaPoster = url(post.mediaPoster);
  let mediaType = post.mediaType;
  // Recover actual video references even when a legacy cache row called its
  // thumbnail an image. Provider labels and bare embed IDs are not evidence.
  if ([mediaUrl, post.sourceUrl].some(value => officialVideoReference(value))
      || suppliedVideoFileUrl(mediaUrl) || suppliedHlsUrl(mediaUrl)) mediaType = 'video';
  if (mediaUrl && !mediaType) {
    if (/\.(?:mp4|webm|m4v|mov|ogv|m3u8)(?:[?#]|$)/i.test(mediaUrl)) mediaType='video';
    else if (/\.(?:png|jpe?g|gif|webp|avif)(?:[?#]|$)/i.test(mediaUrl) || post.imageUrl || post.thumbnailUrl) mediaType='image';
  }
  return { ...post, mediaUrl, mediaPoster, mediaType };
}
module.exports = { normalizePostMedia };
