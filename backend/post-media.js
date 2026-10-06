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
  if (mediaUrl && !mediaType) {
    const parsed = new URL(mediaUrl);
    if (/\.(?:mp4|webm|m4v|mov|m3u8)(?:[?#]|$)/i.test(mediaUrl) || ['youtube.com','www.youtube.com','youtu.be','vimeo.com','player.vimeo.com'].includes(parsed.hostname)) mediaType='video';
    else if (/\.(?:png|jpe?g|gif|webp|avif)(?:[?#]|$)/i.test(mediaUrl) || post.imageUrl || post.thumbnailUrl) mediaType='image';
  }
  return { ...post, mediaUrl, mediaPoster, mediaType };
}
module.exports = { normalizePostMedia };
