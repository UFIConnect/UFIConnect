'use strict';

const { createHash } = require('node:crypto');
const { authorProfilePhoto, createCachedProfileLookup, profilePhotoUrl } = require('./source-profile-photos');
const LOOKBACK_MS = 7 * 86400000;
const CLIP_SLUG = /^[A-Za-z0-9_-]{1,140}$/;
const CHANNEL_ID = /^\d{1,30}$/;
const CHANNEL_LOGIN = /^[a-zA-Z0-9_]{1,25}$/;
const fault = (status, message) => Object.assign(new Error(message), { status });
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const count = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(value))) : 0;

function imageUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.replace('{width}', '440').replace('{height}', '248'));
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['twitch.tv', 'jtvnw.net', 'ttvnw.net'].some(host => url.hostname === host || url.hostname.endsWith('.' + host)) ? url.href : null;
  } catch { return null; }
}

function clipPost(clip, channel, now = Date.now()) {
  if (!clip || !CHANNEL_ID.test(channel?.id || '') || !CHANNEL_LOGIN.test(channel?.login || '')
    || clip.broadcaster_id !== channel.id || typeof clip.id !== 'string' || !CLIP_SLUG.test(clip.id)) return null;
  const created = Date.parse(clip.created_at), duration = Number(clip.duration);
  if (!Number.isFinite(created) || created <= now - LOOKBACK_MS || created > now
    || !Number.isFinite(duration) || duration <= 0 || duration > 180) return null;
  try {
    const url = new URL(clip.url);
    const canonical = url.hostname === 'clips.twitch.tv' && url.pathname === '/' + clip.id;
    const channelClip = ['twitch.tv', 'www.twitch.tv'].includes(url.hostname)
      && url.pathname === '/' + channel.login + '/clip/' + clip.id;
    if (url.protocol !== 'https:' || url.username || url.password || url.port || (!canonical && !channelClip)) return null;
  } catch { return null; }
  const sourceUrl = 'https://clips.twitch.tv/' + clip.id;
  return {
    id: 'twitch_clip_' + clip.id, externalId: clip.id, authorId: 'twitch_' + channel.id, groupId: 'ext_twitch',
    source: 'twitch', sourceLabel: 'Twitch', sourceUrl, authorUrl: 'https://www.twitch.tv/' + channel.login,
    title: clip.title || 'Clip on Twitch', content: clip.title || 'Clip on Twitch', topic: channel.category || null,
    author: { id: 'twitch_' + channel.id, name: clip.broadcaster_name || channel.name || 'Twitch', title: channel.category || 'Twitch creator',
      ...(imageUrl(authorProfilePhoto({ author: channel })) ? { avatarUrl: imageUrl(authorProfilePhoto({ author: channel })) } : {}),
      profileUrl: 'https://www.twitch.tv/' + channel.login },
    clipCreator: { id: clip.creator_id || null, name: clip.creator_name || null },
    likes: [], likesCount: 0, commentsCount: 0, viewsCount: count(clip.view_count),
    createdAt: clip.created_at, isExternal: true, visibility: 'public', language: clip.language || null,
    mediaType: 'video', mediaUrl: sourceUrl, mediaPoster: imageUrl(clip.thumbnail_url), videoDurationSeconds: duration,
    sourceEmbedUrl: 'https://clips.twitch.tv/embed?clip=' + encodeURIComponent(clip.id),
    group: { id: 'ext_twitch', name: 'Twitch', category: 'Streaming' },
  };
}

function streamPost(stream) {
  if (!CHANNEL_ID.test(stream?.user_id || '') || !CHANNEL_LOGIN.test(stream?.user_login || '')
    || !CHANNEL_ID.test(stream?.id || '') || !Number.isFinite(Date.parse(stream.started_at))) return null;
  return {
    id: 'twitch_' + stream.id, authorId: 'twitch_' + stream.user_id, groupId: 'ext_twitch',
    content: stream.title || 'Live on Twitch', title: stream.title || 'Live on Twitch', source: 'twitch', sourceLabel: 'Twitch',
    sourceUrl: 'https://www.twitch.tv/' + stream.user_login, authorUrl: 'https://www.twitch.tv/' + stream.user_login,
    topic: stream.game_name || null, author: { id: 'twitch_' + stream.user_id, name: stream.user_name || 'Twitch', title: stream.game_name ? 'Streaming ' + stream.game_name : 'Live now',
      ...(imageUrl(stream.profile_image_url) ? { avatarUrl: imageUrl(stream.profile_image_url) } : {}),
      profileUrl: 'https://www.twitch.tv/' + stream.user_login },
    likes: [], likesCount: 0, commentsCount: 0, viewsCount: count(stream.viewer_count),
    createdAt: stream.started_at, isExternal: true, visibility: 'public', mediaType: 'image', mediaUrl: imageUrl(stream.thumbnail_url),
    group: { id: 'ext_twitch', name: 'Twitch', category: 'Streaming' },
  };
}

function createTwitchFeed({ fetcher = fetch, now = Date.now, getConfig = () => ({ clientId: process.env.TWITCH_CLIENT_ID, clientSecret: process.env.TWITCH_CLIENT_SECRET }) } = {}) {
  const cache = new Map(), pending = new Map();
  let appToken = null, appPending = null;
  function settings() {
    const value = getConfig() || {};
    return { clientId: String(value.clientId || '').trim(), clientSecret: String(value.clientSecret || '').trim() };
  }
  async function request(url, options, personal = false) {
    let response;
    try { response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) }); }
    catch { throw fault(503, 'Twitch content is temporarily unavailable.'); }
    if (!response.ok) {
      if (response.status === 401) throw fault(401, personal ? 'Twitch access expired or was revoked. Reconnect this account.' : 'Twitch public API authorization needs attention.');
      if (response.status === 403) throw fault(403, personal ? 'Twitch followed content requires user:read:follows permission. Reconnect this account.' : 'Twitch public API access is unavailable.');
      if (response.status === 429) throw fault(429, 'Twitch rate limit reached. Try again later.');
      throw fault(503, 'Twitch content is temporarily unavailable.');
    }
    try { return await response.json(); } catch { throw fault(503, 'Twitch returned an invalid response.'); }
  }
  async function appAccess(config) {
    const identity = fingerprint(config.clientId + '\0' + config.clientSecret);
    if (appToken?.identity === identity && appToken.expiresAt > now() + 30000) return appToken.token;
    if (appPending?.identity === identity) return appPending.task;
    const task = request('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'client_credentials' }).toString() })
      .then(data => {
        if (typeof data?.access_token !== 'string' || !data.access_token || !Number.isFinite(Number(data.expires_in)) || Number(data.expires_in) <= 30) throw fault(503, 'Twitch public API authorization is unavailable.');
        appToken = { identity, token: data.access_token, expiresAt: now() + Math.min(Number(data.expires_in), 86400) * 1000 };
        return appToken.token;
      });
    appPending = { identity, task };
    try { return await task; } finally { if (appPending?.task === task) appPending = null; }
  }
  const helix = (path, params, config, token, personal = false) => request('https://api.twitch.tv/helix/' + path + '?' + new URLSearchParams(params),
    { headers: { Authorization: 'Bearer ' + token, 'Client-Id': config.clientId } }, personal);
  function profileIdentity(post) {
    if (post?.source !== 'twitch') return null;
    for (const value of [post.author?.id, post.authorId]) {
      const id = typeof value === 'string' && /^twitch_(\d{1,30})$/.exec(value)?.[1];
      if (id) return 'id:' + id;
    }
    const link = profilePhotoUrl(post.author?.profileUrl || post.authorUrl);
    if (!link) return null;
    const url = new URL(link);
    if (!['twitch.tv', 'www.twitch.tv'].includes(url.hostname)) return null;
    const login = /^\/([a-zA-Z0-9_]{1,25})\/?$/.exec(url.pathname)?.[1];
    return login ? 'login:' + login.toLowerCase() : null;
  }
  // Get Users supplies the broadcaster's photo, never the clip creator's or
  // a stream thumbnail. Public metadata is safely shared across snap loads.
  // https://dev.twitch.tv/docs/api/reference/#get-users
  const profileLookups = new Map();
  function profileLookup(config) {
    const identity = fingerprint(config.clientId + '\0' + config.clientSecret);
    if (profileLookups.has(identity)) return profileLookups.get(identity);
    const lookup = createCachedProfileLookup({ now, batchSize: 100, load: async keys => {
      const token = await appAccess(config);
      const params = keys.map(key => key.startsWith('id:') ? ['id', key.slice(3)] : ['login', key.slice(6)]);
      let data;
      try { data = await helix('users', params, config, token); }
      catch (error) { if (error.status === 401) appToken = null; throw error; }
      const result = new Map(), requested = new Set(keys);
      for (const user of Array.isArray(data?.data) ? data.data : []) {
        if (!CHANNEL_ID.test(user.id || '') || !CHANNEL_LOGIN.test(user.login || '')) continue;
        const id = 'id:' + user.id, login = 'login:' + user.login.toLowerCase();
        if (!requested.has(id) && !requested.has(login)) continue;
        const photo = imageUrl(user.profile_image_url);
        if (requested.has(id)) result.set(id, photo);
        if (requested.has(login)) result.set(login, photo);
        lookup.seed(id, photo); lookup.seed(login, photo);
      }
      return result;
    } });
    profileLookups.set(identity, lookup);
    while (profileLookups.size > 2) profileLookups.delete(profileLookups.keys().next().value);
    return lookup;
  }
  async function hydrateAvatars(posts) {
    const config = settings();
    if (!Array.isArray(posts) || !config.clientId || !config.clientSecret) return posts;
    // Supplied profile URLs can become stale. Official cached metadata
    // replaces them; failed or missing lookups preserve the supplied photo.
    const keys = posts.map(profileIdentity).filter(Boolean);
    if (!keys.length) return posts;
    const photos = await profileLookup(config).lookup(keys);
    return posts.map(post => {
      const identity = profileIdentity(post), photo = identity && photos.get(identity);
      return photo ? { ...post, author: { ...post.author, avatarUrl: photo } } : post;
    });
  }
  async function inventory(key, ttl, load) {
    if (cache.get(key)?.expiresAt > now()) return cache.get(key).posts;
    if (pending.has(key)) return pending.get(key);
    const task = Promise.resolve().then(load).then(posts => {
      cache.delete(key); cache.set(key, { posts, expiresAt: now() + ttl });
      while (cache.size > 200) cache.delete(cache.keys().next().value);
      return posts;
    }).finally(() => pending.delete(key));
    pending.set(key, task); return task;
  }
  async function clips(channels, config, token, personal, first) {
    const since = new Date(now() - LOOKBACK_MS).toISOString(), until = new Date(now()).toISOString();
    const results = await Promise.all(channels.map(async channel => {
      const response = await helix('clips', { broadcaster_id: channel.id, first, started_at: since, ended_at: until }, config, token, personal);
      return (Array.isArray(response?.data) ? response.data : []).slice(0, first).map(clip => clipPost(clip, channel, now())).filter(Boolean);
    }));
    return [...new Map(results.flat().map(post => [post.id, post])).values()];
  }
  async function publicPosts({ bust = false } = {}) {
    const config = settings();
    // Public ingestion uses only this app's client-credentials token. It never
    // borrows a connected member's token, follow graph, or private inventory.
    if (!config.clientId || !config.clientSecret) return [];
    const key = 'public:' + fingerprint(config.clientId + '\0' + config.clientSecret);
    if (bust) cache.delete(key);
    return inventory(key, 5 * 60000, async () => {
      const token = await appAccess(config);
      try {
        const streams = await helix('streams', { first: 6 }, config, token);
        const live = (Array.isArray(streams?.data) ? streams.data : []).slice(0, 6)
          .filter(stream => stream.is_mature !== true && CHANNEL_ID.test(stream.user_id || '') && CHANNEL_LOGIN.test(stream.user_login || ''));
        const channels = live.map(stream => ({ id: stream.user_id, login: stream.user_login, name: stream.user_name, category: stream.game_name }));
        const recent = await clips(channels, config, token, false, 8);
        // Home can display genuine public stream cards. Short clips keep their
        // Videos/Snaps placement; neither path borrows a member's follow graph.
        // Reuse this existing stream response rather than adding provider reads.
        return [...live.map(streamPost).filter(Boolean), ...recent];
      }
      catch (error) { if (error.status === 401) appToken = null; throw error; }
    });
  }
  async function publicClips() {
    return (await publicPosts()).filter(post => post.mediaType === 'video');
  }
  async function following(token, { userId = '', connectedAt = null, bust = false } = {}) {
    const config = settings();
    if (!token) return [];
    if (!config.clientId) throw fault(503, 'Twitch account integration is not configured.');
    const key = 'following:' + fingerprint(JSON.stringify([userId, connectedAt, config.clientId, token]));
    if (bust) cache.delete(key);
    return inventory(key, 5 * 60000, async () => {
      const me = await helix('users', {}, config, token, true);
      const owner = me?.data?.[0]?.id;
      if (!CHANNEL_ID.test(owner || '')) throw fault(401, 'Twitch access expired or was revoked. Reconnect this account.');
      const [live, followed] = await Promise.all([
        helix('streams/followed', { user_id: owner, first: 100 }, config, token, true),
        helix('channels/followed', { user_id: owner, first: 100 }, config, token, true),
      ]);
      const channels = (Array.isArray(followed?.data) ? followed.data : []).slice(0, 100)
        .filter(channel => CHANNEL_ID.test(channel.broadcaster_id || '') && CHANNEL_LOGIN.test(channel.broadcaster_login || ''))
        .map(channel => ({ id: channel.broadcaster_id, login: channel.broadcaster_login, name: channel.broadcaster_name }));
      const recent = await clips(channels.slice(0, 3), config, token, true, 8);
      const streams = (Array.isArray(live?.data) ? live.data : []).slice(0, 100).map(streamPost).filter(Boolean);
      return [...streams, ...recent];
    });
  }
  return { publicPosts, publicClips, following, hydrateAvatars };
}

module.exports = { createTwitchFeed, clipPost, streamPost, LOOKBACK_MS };
