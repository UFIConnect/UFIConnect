'use strict';
const { createHash } = require('node:crypto');

// User authentication is required by the reverse chronological home endpoint:
// https://docs.x.com/x-api/users/get-timeline (tweet.read and users.read).
// Public keyword search is never a substitute for this timeline.
const API_ORIGIN = 'https://api.x.com';
const numericId = value => typeof value === 'string' && /^[0-9]{1,19}$/.test(value);
const count = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0;

function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function twitterFollowingError(error) {
  const status = Number(error?.status || error?.statusCode || String(error?.message || '').match(/\b(401|402|403|429|5\d\d)\b/)?.[1]) || 502;
  const messages = {
    401: 'HTTP 401: X access expired or was revoked. Reconnect X in Connected Accounts.',
    402: 'X API credits or paid access are unavailable for UFIConnect. Contact support to check X API access.',
    403: 'X denied timeline access. Reconnect X to grant read permissions. If it continues, contact support to check UFIConnect’s X API access.',
    429: 'X temporarily limited timeline requests. Please try again later.',
  };
  return Object.assign(new Error(messages[status] || 'X could not load your Following timeline. Please try again later.'), { status });
}

function mapTwitterTimeline(raw) {
  const authors = new Map((Array.isArray(raw?.includes?.users) ? raw.includes.users : []).map(user => [user.id, user]));
  const media = new Map((Array.isArray(raw?.includes?.media) ? raw.includes.media : []).map(item => [item.media_key, item]));
  return (Array.isArray(raw?.data) ? raw.data : []).filter(post => numericId(post?.id) && numericId(post?.author_id)).slice(0, 50)
    .map(post => {
      const author = authors.get(post.author_id) || {};
      const attachments = (Array.isArray(post.attachments?.media_keys) ? post.attachments.media_keys : []).map(key => media.get(key)).filter(Boolean);
      const primary = attachments.find(item => ['video', 'animated_gif'].includes(item.type)) || attachments.find(item => item.type === 'photo');
      const variants = (Array.isArray(primary?.variants) ? primary.variants : [])
        .filter(item => item.content_type === 'video/mp4' && safeUrl(item.url))
        .sort((a, b) => count(a.bit_rate) - count(b.bit_rate));
      // Keep a playable source URL, never substitute the poster for a video.
      const videoUrl = variants.find(item => count(item.bit_rate) >= 256000)?.url || variants[0]?.url || null;
      const isVideo = ['video', 'animated_gif'].includes(primary?.type) && Boolean(videoUrl);
      const photo = attachments.find(item => item.type === 'photo' && safeUrl(item.url));
      const imageUrl = safeUrl(photo?.url || primary?.preview_image_url);
      const username = typeof author.username === 'string' && /^[a-z0-9_]{1,15}$/i.test(author.username) ? author.username : null;
      let text = typeof post.text === 'string' ? post.text : '';
      for (const entity of Array.isArray(post.entities?.urls) ? post.entities.urls : []) {
        const expanded = safeUrl(entity.unwound_url || entity.expanded_url);
        if (expanded && typeof entity.url === 'string' && /^https:\/\/t\.co\//.test(entity.url)) text = text.split(entity.url).join(expanded);
      }
      return {
        id: `twitter_${post.id}`, authorId: `twitter_${post.author_id}`, groupId: 'ext_twitter',
        content: text, title: text.slice(0, 120), source: 'twitter', sourceLabel: 'X (Twitter)',
        sourceUrl: `https://x.com/${username || 'i/web'}/status/${post.id}`, topic: null,
        author: { id: `twitter_${post.author_id}`, name: typeof author.name === 'string' && author.name ? author.name.slice(0, 100) : username || 'X member',
          title: username ? `@${username}` : 'X (Twitter)', organization: 'X (Twitter)',
          avatarUrl: safeUrl(author.profile_image_url),
          profileUrl: username ? `https://x.com/${username}` : `https://x.com/i/user/${post.author_id}` },
        likes: [], likesCount: count(post.public_metrics?.like_count), commentsCount: count(post.public_metrics?.reply_count),
        createdAt: post.created_at, isExternal: true, visibility: author.protected ? 'followers' : 'public',
        mediaType: isVideo ? 'video' : imageUrl ? 'image' : null,
        mediaUrl: isVideo ? safeUrl(videoUrl) : imageUrl,
        mediaPoster: isVideo ? safeUrl(primary?.preview_image_url) : null,
        videoDurationSeconds: isVideo && count(primary?.duration_ms) ? count(primary.duration_ms) / 1000 : null,
        group: { id: 'ext_twitter', name: 'X (Twitter)', category: 'Social', externalUrl: 'https://x.com' },
      };
    });
}

function createTwitterFollowingFetcher({ fetchJSON, now = Date.now } = {}) {
  if (typeof fetchJSON !== 'function') throw new TypeError('A provider JSON client is required.');
  const identities = new Map();
  return async token => {
    if (typeof token !== 'string' || !token) return [];
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const key = createHash('sha256').update(token).digest('hex');
      let identity = identities.get(key);
      if (!identity || identity.expiresAt <= now()) {
        const me = await fetchJSON(`${API_ORIGIN}/2/users/me`, headers);
        if (!numericId(me?.data?.id)) throw { status: Number(me?.errors?.[0]?.status) || 502 };
        identity = { id: me.data.id, expiresAt: now() + 60 * 60 * 1000 };
        identities.set(key, identity);
        if (identities.size > 200) identities.delete(identities.keys().next().value);
      }
      const url = new URL(`${API_ORIGIN}/2/users/${identity.id}/timelines/reverse_chronological`);
      // One bounded page avoids multiplying paid API reads per feed request.
      url.searchParams.set('max_results', '50');
      url.searchParams.set('tweet.fields', 'created_at,author_id,attachments,entities,public_metrics');
      url.searchParams.set('expansions', 'author_id,attachments.media_keys');
      url.searchParams.set('user.fields', 'name,username,profile_image_url,protected');
      url.searchParams.set('media.fields', 'type,url,preview_image_url,variants,duration_ms');
      const raw = await fetchJSON(url.href, headers);
      if (!Array.isArray(raw?.data) && raw?.meta?.result_count !== 0) throw { status: Number(raw?.errors?.[0]?.status) || 502 };
      return mapTwitterTimeline(raw);
    } catch (error) { throw twitterFollowingError(error); }
  };
}

module.exports = { createTwitterFollowingFetcher, mapTwitterTimeline, twitterFollowingError };
