function entities(value) {
  return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex, decimal) => {
      const n = parseInt(hex || decimal, hex ? 16 : 10); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    });
}
function attribute(tag, name) {
  return entities(tag.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'))?.slice(1).find(x => x !== undefined));
}
function mediaUrl(value, base) {
  if (!value) return null;
  try { const url = new URL(entities(value), entities(base)); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function extractFeedMedia(block, body, link) {
  let image = null, video = null;
  const tags = block.match(/<(?:media:thumbnail|media:content|enclosure|link)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const type = attribute(tag, 'type').toLowerCase(), medium = attribute(tag, 'medium').toLowerCase();
    const url = mediaUrl(attribute(tag,'url') || attribute(tag,'href'),link);
    if (!url) continue;
    if (!image && (/^<media:thumbnail/i.test(tag) || medium === 'image' || type.startsWith('image/'))) image = url;
    if (!video && (medium === 'video' || type.startsWith('video/') || /mpegurl/i.test(type))) video = url;
  }
  for (const tag of body.match(/<(?:img|video|source|iframe)\b[^>]*>/gi) || []) {
    const src = mediaUrl(attribute(tag,'data-src') || attribute(tag,'data-lazy-src') || attribute(tag,'src'),link);
    if (/^<img\b/i.test(tag) && !image) {
      if (['width','height'].some(name => /^(?:0|1)$/.test(attribute(tag,name)))) continue;
      const set = attribute(tag,'srcset').split(',').map(x=>x.trim().split(/\s+/)[0]).filter(Boolean);
      const candidate = src || mediaUrl(set.at(-1),link);
      if (candidate && !/\/(?:pixel|tracking|spacer|transparent)(?:[.-]|\?)/i.test(candidate)) image = candidate;
    }
    if (/^<video\b/i.test(tag) && !image) image = mediaUrl(attribute(tag,'poster'),link);
    if (!src || video) continue;
    if (/^<(?:video|source)\b/i.test(tag) && /\.(?:mp4|webm|mov|m4v|m3u8)(?:[?#]|$)/i.test(src)) video = src;
    if (/^<iframe\b/i.test(tag)) {
      const url = new URL(src);
      if (['youtube.com','www.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(url.hostname)) {
        const id = url.pathname.match(/^\/embed\/([\w-]{11})$/)?.[1];
        if (id) video = 'https://www.youtube.com/watch?v=' + id;
      } else if (url.hostname === 'player.vimeo.com') {
        const id = url.pathname.match(/^\/video\/(\d+)$/)?.[1]; if (id) video = 'https://vimeo.com/' + id;
      }
    }
  }
  return {image, video};
}
module.exports = { extractFeedMedia };
