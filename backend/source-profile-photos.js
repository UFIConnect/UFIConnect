'use strict';

const PHOTO_TTL_MS = 24 * 60 * 60000;
const NEGATIVE_TTL_MS = 5 * 60000;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

function profilePhotoUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}

// Read only author-photo fields. Video/post thumbnails belong to the clip.
function authorProfilePhoto(post) {
  const author = post?.author || {};
  for (const value of [author.avatarUrl, author.avatar_url, author.profileImageUrl, author.profile_image_url,
    author.profile_image_90, author.profile_image, author.avatar_static, author.avatar,
    post?.authorAvatarUrl, post?.author_avatar_url]) {
    const photo = profilePhotoUrl(value);
    if (photo) return photo;
  }
  return null;
}

function youtubeChannelIdentity(post) {
  if (post?.source !== 'youtube') return null;
  const author = post.author || {};
  for (const value of [author.channelId, post.channelId, post.youtubeChannelId]) if (CHANNEL_ID.test(value || '')) return value;
  for (const value of [author.id, post.authorId]) {
    if (typeof value !== 'string') continue;
    // Legacy youtube_ch_ and youtube_channel_ IDs sometimes embedded a
    // display name. Those require a real profile URL or video lookup.
    const id = /^youtube_(UC[A-Za-z0-9_-]{22})$/.exec(value)?.[1];
    if (id) return id;
  }
  const link = profilePhotoUrl(author.profileUrl || post.authorUrl);
  if (!link) return null;
  const url = new URL(link);
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) return null;
  const id = /^\/channel\/(UC[A-Za-z0-9_-]{22})\/?$/.exec(url.pathname)?.[1];
  return id || null;
}

function youtubeVideoIdentity(post) {
  if (post?.source !== 'youtube') return null;
  for (const value of [post.sourceUrl, post.mediaUrl]) {
    const link = profilePhotoUrl(value);
    if (!link) continue;
    const url = new URL(link);
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) continue;
    const id = /^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
      || (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1 ? url.searchParams.get('v') : null)
      || (url.hostname === 'youtu.be' ? /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] : null);
    if (/^[A-Za-z0-9_-]{11}$/.test(id || '')) return id;
  }
  return null;
}

// Each batch shares an in-flight request, including overlapping concurrent
// loads. Failed and missing photos are cached briefly; no provider retry loop.
function createCachedProfileLookup({ load, now = Date.now, batchSize = 50, maxEntries = 1000,
  ttl = PHOTO_TTL_MS, negativeTtl = NEGATIVE_TTL_MS, validateValue = profilePhotoUrl } = {}) {
  const cache = new Map(), pending = new Map();
  let blockedUntil = 0;
  function seed(key, photo) {
    const url = validateValue(photo);
    cache.delete(key);
    cache.set(key, { url, expiresAt: now() + (url ? ttl : negativeTtl) });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  }
  async function lookup(values) {
    const keys = [...new Set(values)].filter(value => typeof value === 'string' && value.length <= 160);
    const missing = keys.filter(key => !pending.has(key) && !(cache.get(key)?.expiresAt > now()));
    // One bounded batch per rail load, regardless of input size.
    const batch = blockedUntil > now() ? [] : missing.slice(0, batchSize);
    if (batch.length) {
      const task = Promise.resolve().then(() => load(batch)).then(result => {
        for (const key of batch) seed(key, result instanceof Map ? result.get(key) : null);
      }).catch(() => {
        blockedUntil = now() + negativeTtl;
        for (const key of batch) seed(key, null);
      }).finally(() => { for (const key of batch) if (pending.get(key) === task) pending.delete(key); });
      for (const key of batch) pending.set(key, task);
    }
    await Promise.all([...new Set(keys.map(key => pending.get(key)).filter(Boolean))]);
    return new Map(keys.map(key => [key, cache.get(key)?.expiresAt > now() ? cache.get(key).url : null]));
  }
  return { lookup, seed };
}

// Public channel metadata only: fixed official endpoint, proven channel IDs,
// one channels.list read (one quota unit) for up to 50 authors, then 24h cache.
// https://developers.google.com/youtube/v3/docs/channels/list
function createYouTubeProfilePhotoHydrator({ fetcher = fetch, now = Date.now,
  getApiKey = () => process.env.YOUTUBE_API_KEY } = {}) {
  async function read(resource, ids, fields) {
    const key = String(getApiKey() || '').trim();
    if (!key) return [];
    const url = new URL('https://www.googleapis.com/youtube/v3/' + resource);
    url.search = new URLSearchParams({ part: 'snippet', id: ids.join(','), fields, key }).toString();
    const response = await fetcher(url.href, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Channel profile photos are unavailable.');
    const data = await response.json();
    return Array.isArray(data?.items) ? data.items : [];
  }
  // Historical cached posts can lack an uploader ID. Resolve only proven
  // video URLs, in one 16-video batch; never search by the displayed name.
  // https://developers.google.com/youtube/v3/docs/videos/list
  const uploaders = createCachedProfileLookup({ now, batchSize: 16,
    validateValue: value => CHANNEL_ID.test(value || '') ? value : null,
    load: async ids => {
      const requested = new Set(ids), result = new Map();
      for (const video of await read('videos', ids, 'items(id,snippet/channelId)')) {
        if (requested.has(video.id) && CHANNEL_ID.test(video.snippet?.channelId || '')) result.set(video.id, video.snippet.channelId);
      }
      return result;
    },
  });
  const photos = createCachedProfileLookup({ now, batchSize: 50, load: async ids => {
    const requested = new Set(ids), result = new Map();
    for (const channel of await read('channels', ids, 'items(id,snippet/thumbnails)')) {
      if (!requested.has(channel.id)) continue;
      const thumbnails = channel.snippet?.thumbnails || {};
      result.set(channel.id, profilePhotoUrl(thumbnails.medium?.url) || profilePhotoUrl(thumbnails.default?.url) || profilePhotoUrl(thumbnails.high?.url));
    }
    return result;
  } });
  return async posts => {
    if (!Array.isArray(posts) || !String(getApiKey() || '').trim()) return posts;
    // A supplied URL can expire or change at the provider. Refresh proven
    // selected authors once per cached day without probing image URLs.
    const candidates = posts.filter(post => post?.source === 'youtube');
    const videos = candidates.filter(post => !youtubeChannelIdentity(post)).map(youtubeVideoIdentity).filter(Boolean);
    const resolved = videos.length ? await uploaders.lookup(videos) : new Map();
    const channelFor = post => youtubeChannelIdentity(post) || resolved.get(youtubeVideoIdentity(post));
    const ids = candidates.map(channelFor).filter(Boolean);
    if (!ids.length) return posts;
    const result = await photos.lookup(ids);
    return posts.map(post => {
      const id = channelFor(post), photo = id && result.get(id);
      return photo ? { ...post, author: { ...post.author, avatarUrl: photo, channelId: id,
        profileUrl: 'https://www.youtube.com/channel/' + id } } : post;
    });
  };
}

function devToArticleIdentity(post) {
  return post?.source === 'devto' && typeof post.id === 'string'
    ? /^devto_video_(\d{1,15})$/.exec(post.id)?.[1] || null : null;
}

// The video listing omits user photos and can have an organization in its
// path. Read only the exact public article's user; never infer its author
// from that path, an article thumbnail, or the displayed name.
// https://developers.forem.com/api/v0#tag/articles/operation/getArticleById
function createDevToProfilePhotoHydrator({ fetcher = fetch, now = Date.now, timeoutMs = 5000 } = {}) {
  let blockedUntil = 0;
  const deadline = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(5000, timeoutMs)) : 5000;
  const profiles = createCachedProfileLookup({ now, batchSize: 16,
    validateValue: value => value && profilePhotoUrl(value.avatarUrl) ? value : null,
    load: async ids => {
      const result = new Map();
      if (blockedUntil > now()) return result;
      const controller = new AbortController();
      let cursor = 0, stopped = false, timer;
      function stopForFailure() {
        stopped = true;
        blockedUntil = now() + NEGATIVE_TTL_MS;
        controller.abort();
      }
      const worker = async () => {
        while (!stopped && cursor < ids.length) {
          const id = ids[cursor++];
          try {
            const response = await fetcher('https://dev.to/api/articles/' + id, {
              headers: { Accept: 'application/json', 'User-Agent': 'UFIConnect/1.0 (https://uficonnect.org)' },
              credentials: 'omit', redirect: 'error', signal: controller.signal,
            });
            if (stopped) return;
            if (!response.ok) {
              if (response.status === 404) continue;
              stopForFailure(); return;
            }
            const article = await response.json();
            if (stopped || String(article?.id) !== id) continue;
            const user = article.user;
            const avatarUrl = profilePhotoUrl(user?.profile_image_90) || profilePhotoUrl(user?.profile_image);
            if (!avatarUrl) continue;
            const providerId = /^(?:[1-9]\d{0,14})$/.test(String(user?.id || '')) ? String(user.id) : null;
            const username = typeof user?.username === 'string' && /^[A-Za-z0-9_]{1,100}$/.test(user.username) ? user.username : null;
            const name = typeof user?.name === 'string' && user.name.trim().length <= 200 && !/[\x00-\x1f\x7f]/.test(user.name)
              ? user.name.trim() : null;
            result.set(id, { avatarUrl, ...(providerId ? { providerId, id: 'devto_user_' + providerId } :
              username ? { id: 'devto_' + username } : {}), ...(name ? { name } : {}),
              ...(username ? { username, profileUrl: 'https://dev.to/' + username } : {}) });
          } catch { if (!stopped) stopForFailure(); return; }
        }
      };
      const expired = new Promise(resolve => {
        timer = setTimeout(() => { stopForFailure(); resolve(); }, deadline);
      });
      try {
        // Also settle on deadline if a custom fetcher ignores cancellation.
        await Promise.race([Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker)), expired]);
      } finally { clearTimeout(timer); }
      return result;
    },
  });
  return async posts => {
    if (!Array.isArray(posts)) return posts;
    const ids = posts.map(devToArticleIdentity).filter(Boolean);
    if (!ids.length) return posts;
    const result = await profiles.lookup(ids);
    return posts.map(post => {
      const metadata = result.get(devToArticleIdentity(post));
      return metadata ? { ...post, ...(metadata.id ? { authorId: metadata.id } : {}),
        author: { ...post.author, ...metadata } } : post;
    });
  };
}

module.exports = { PHOTO_TTL_MS, NEGATIVE_TTL_MS, profilePhotoUrl, authorProfilePhoto,
  youtubeChannelIdentity, youtubeVideoIdentity, createCachedProfileLookup, createYouTubeProfilePhotoHydrator,
  devToArticleIdentity, createDevToProfilePhotoHydrator };
