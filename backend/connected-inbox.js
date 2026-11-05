'use strict';

const crypto = require('node:crypto');
const { mastodonOrigin } = require('./mastodon-oauth');
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
const text = (value, max = 6000) => String(value || '').replace(/<[^>]*>/g, '').slice(0, max);
const stamp = value => { const n = Date.parse(value); return Number.isFinite(n) ? new Date(n).toISOString() : null; };
const idFor = (source, key, version) => `source:${source}:${hash(`${key}:${version || ''}`)}`;
const SOURCE_INFO = {
  discord: ['Discord', 'https://discord.com/channels/@me', 'https://discord.com/channels/@me'],
  figma: ['Figma', 'https://www.figma.com/files/', 'https://www.figma.com/files/'],
  github: ['GitHub', 'https://github.com/notifications', 'https://github.com/notifications'],
  reddit: ['Reddit', 'https://www.reddit.com/message/inbox/', 'https://www.reddit.com/message/messages/'],
  bluesky: ['Bluesky', 'https://bsky.app/notifications', 'https://bsky.app/messages'],
  youtube: ['YouTube', 'https://www.youtube.com/', 'https://www.youtube.com/'],
  twitter: ['X', 'https://x.com/notifications', 'https://x.com/messages'],
  linkedin: ['LinkedIn', 'https://www.linkedin.com/notifications/', 'https://www.linkedin.com/messaging/'],
  facebook: ['Facebook', 'https://www.facebook.com/notifications', 'https://www.messenger.com/'],
  instagram: ['Instagram', 'https://www.instagram.com/', 'https://www.instagram.com/direct/inbox/'],
  threads: ['Threads', 'https://www.threads.com/activity', 'https://www.threads.com/'],
  tiktok: ['TikTok', 'https://www.tiktok.com/', 'https://www.tiktok.com/messages'],
  gitlab: ['GitLab', 'https://gitlab.com/dashboard/todos', 'https://gitlab.com/'],
  twitch: ['Twitch', 'https://www.twitch.tv/', 'https://www.twitch.tv/'],
  medium: ['Medium', 'https://medium.com/', 'https://medium.com/'],
  dribbble: ['Dribbble', 'https://dribbble.com/', 'https://dribbble.com/'],
};
function publicUrl(value, fallback, hosts) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && (!hosts || hosts.includes(u.hostname)) ? u.href : fallback; }
  catch { return fallback; }
}
function safePds(value) {
  const u = new URL(value);
  // Only the official hosted PDS fleet receives these private inbox tokens.
  // Other federated accounts keep a source link until hardened discovery is available.
  if (u.protocol !== 'https:' || u.port || u.username || u.password || u.search || u.hash || u.pathname !== '/' ||
      !(u.hostname === 'bsky.social' || /^[a-z0-9-]+\.(?:[a-z0-9-]+\.)*host\.bsky\.network$/.test(u.hostname))) {
    throw Object.assign(new Error('This federated account uses a server that is not supported for inbox sync yet.'), { status: 422 });
  }
  return u.origin;
}
function createInboxRequest(https, createDPoPProof, mastodonService) {
  async function get(url, headers) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'UFIConnect/1.0 (connected inbox)', ...headers } }, res => {
        let raw = ''; let size = 0;
        res.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) req.destroy(new Error('Inbox response too large')); else raw += chunk; });
        res.on('error', reject);
        res.on('end', () => { let data = null; try { data = JSON.parse(raw); } catch {} resolve({ status: res.statusCode, headers: res.headers, data }); });
      });
      req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('Inbox request timed out'))); req.end();
    });
  }
  return async (source, token, kind, conversationId) => {
    let url; let headers = {};
    if (source === 'github') {
      url = 'https://api.github.com/notifications?all=true&per_page=50';
      headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    } else if (source === 'reddit') {
      // mark=false is essential: polling must never alter the source inbox.
      url = 'https://oauth.reddit.com/message/inbox?limit=100&mark=false&raw_json=1';
      headers.Authorization = `Bearer ${token}`;
    } else if (source === 'mastodon') {
      let session; try { session = JSON.parse(token); } catch { throw Object.assign(new Error('Reconnect Mastodon.'), { status: 401 }); }
      const scopes = String(session.scope || '').split(/\s+/);
      if (!session.accessToken || !session.accountId || !scopes.some(scope => ['read', 'read:notifications'].includes(scope))) {
        throw Object.assign(new Error('Reconnect Mastodon to grant notification access.'), { status: 403 });
      }
      if (kind !== 'notifications' || !mastodonService) throw Object.assign(new Error('Mastodon inbox unavailable.'), { status: 422 });
      // Use the existing DNS-pinned transport for federated servers.
      const data = await mastodonService.json(mastodonOrigin(session.origin), '/api/v1/notifications?limit=40', { token: session.accessToken });
      return { status: 200, data };
    } else if (source === 'bluesky') {
      let session; try { session = JSON.parse(token); } catch { throw Object.assign(new Error('Reconnect Bluesky.'), { status: 401 }); }
      if (!session?.accessToken || !session.did) throw Object.assign(new Error('Reconnect Bluesky.'), { status: 401 });
      const endpoint = kind === 'notifications' ? 'app.bsky.notification.listNotifications?limit=50'
        : conversationId ? `chat.bsky.convo.getMessages?convoId=${encodeURIComponent(conversationId)}&limit=50` : 'chat.bsky.convo.listConvos?limit=50';
      url = `${safePds(session.pdsUrl)}/xrpc/${endpoint}`;
      if (kind === 'messages') headers['atproto-proxy'] = 'did:web:api.bsky.chat#bsky_chat';
      let nonce;
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await get(url, { ...headers, Authorization: `DPoP ${session.accessToken}`, DPoP: createDPoPProof('GET', url, { accessToken: session.accessToken, nonce }) });
        nonce = result.headers?.['dpop-nonce'];
        if (attempt === 0 && result.status >= 400 && result.data?.error === 'use_dpop_nonce' && nonce) continue;
        return result;
      }
    } else throw new Error('Unsupported inbox source');
    return get(url, headers);
  };
}

function githubRows(data) {
  if (!Array.isArray(data)) throw new Error('Invalid GitHub inbox response');
  return { notifications: data.filter(n => n?.id).map(n => {
    const rawUrl = String(n.subject?.url || '').replace('https://api.github.com/repos/', 'https://github.com/').replace('/pulls/', '/pull/');
    const url = publicUrl(rawUrl, publicUrl(n.repository?.html_url, SOURCE_INFO.github[1], ['github.com']), ['github.com']);
    return { id: idFor('github', n.id, n.updated_at), source: 'github', type: 'connected_source', title: text(n.subject?.title || 'GitHub update', 400), preview: text(`${n.repository?.full_name || ''} · ${n.reason || 'update'}`, 500), createdAt: stamp(n.updated_at), url, read: n.unread === false, user: { name: 'GitHub', avatarUrl: null } };
  }), conversations: [] };
}
function redditRows(data) {
  if (!Array.isArray(data?.data?.children)) throw new Error('Invalid Reddit inbox response');
  const notifications = []; const conversations = [];
  for (const child of data.data.children) {
    const n = child?.data; if (!n?.name) continue;
    const createdAt = stamp(new Date(Number(n.created_utc || 0) * 1000).toISOString());
    const id = idFor('reddit', n.name, createdAt); const name = text(n.author || 'Reddit', 100);
    const preview = text(n.body); const read = n.new === false;
    if (n.was_comment || child.kind === 't1') {
      notifications.push({ id, source: 'reddit', type: 'connected_source', title: text(n.subject || 'Reddit reply', 400), preview, createdAt,
        url: publicUrl(new URL(String(n.context || '/message/inbox/'), 'https://www.reddit.com').href, SOURCE_INFO.reddit[1], ['www.reddit.com', 'reddit.com']), read, user: { name, avatarUrl: null } });
    } else {
      const url = `https://www.reddit.com/message/messages/${encodeURIComponent(String(n.id || n.name).replace(/^t4_/, ''))}`;
      conversations.push({ id, source: 'reddit', title: text(n.subject || 'Reddit message', 400), participant: { id: name, name, avatarUrl: null },
        lastMessage: { text: preview, createdAt }, unreadCount: read ? 0 : 1, url,
        messages: [{ id: text(n.name, 150), text: preview, senderName: name, createdAt }] });
    }
  }
  return { notifications, conversations };
}
function blueskyMessage(m, members = []) {
  const sender = members.find(member => member.did === m?.sender?.did);
  return { id: text(m?.id, 150), text: text(m?.text || (m?.$type?.includes('deleted') ? 'Message deleted on Bluesky.' : 'Open Bluesky to view this message.')),
    senderName: text(sender?.displayName || sender?.handle || m?.sender?.did || 'Bluesky member', 150), createdAt: stamp(m?.sentAt) };
}
function blueskyRows(data, kind, token) {
  const did = JSON.parse(token).did;
  if (kind === 'notifications') {
    if (!Array.isArray(data?.notifications)) throw new Error('Invalid Bluesky inbox response');
    return { conversations: [], notifications: data.notifications.filter(n => n?.uri).map(n => {
      const target = String(n.reasonSubject || n.uri).match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);
      const name = text(n.author?.displayName || n.author?.handle || 'Bluesky member', 150);
      return { id: idFor('bluesky', `${did}:${n.uri}:${n.reason}`, n.indexedAt), source: 'bluesky', type: 'connected_source',
        title: `${name} · ${text(n.reason || 'update', 60)}`, preview: text(n.record?.text || ''), createdAt: stamp(n.indexedAt), read: n.isRead === true,
        url: target ? `https://bsky.app/profile/${encodeURIComponent(target[1])}/post/${encodeURIComponent(target[2])}` : `https://bsky.app/profile/${encodeURIComponent(n.author?.did || did)}`,
        user: { name, avatarUrl: publicUrl(n.author?.avatar, null) } };
    }) };
  }
  if (!Array.isArray(data?.convos)) throw new Error('Invalid Bluesky messages response');
  return { notifications: [], conversations: data.convos.filter(c => c?.id).map(c => {
    const others = (c.members || []).filter(m => m.did !== did); const name = text(others.map(m => m.displayName || m.handle).join(', ') || 'Bluesky conversation', 150);
    const last = c.lastMessage ? blueskyMessage(c.lastMessage, c.members) : { text: 'Open conversation', createdAt: null };
    return { id: idFor('bluesky', `${did}:${c.id}`, c.lastMessage?.id || c.rev), source: 'bluesky', title: name,
      participant: { id: text(others[0]?.did || c.id, 150), name, avatarUrl: publicUrl(others[0]?.avatar, null) },
      lastMessage: last, unreadCount: Math.max(0, Math.min(10000, Number(c.unreadCount) || 0)), url: `https://bsky.app/messages/${encodeURIComponent(c.id)}`,
      messages: c.lastMessage ? [last] : [], _providerId: c.id, _members: c.members || [] };
  }) };
}

function mastodonRows(data, token) {
  if (!Array.isArray(data)) throw new Error('Invalid Mastodon inbox response');
  const session = JSON.parse(token), origin = mastodonOrigin(session.origin);
  const verbs = { favourite: 'favourited your post', reblog: 'boosted your post', follow: 'followed you', follow_request: 'requested to follow you',
    mention: 'mentioned you', poll: 'poll update', status: 'posted an update', update: 'edited a post' };
  return { conversations: [], notifications: data.filter(item => item?.id).map(item => {
    const name = text(item.account?.display_name || item.account?.acct || 'Mastodon member', 150);
    return { id: idFor('mastodon', `${origin}:${session.accountId}:${item.id}`), source: 'mastodon', type: 'connected_source',
      title: `${name} · ${verbs[item.type] || text(item.type || 'update', 60)}`, preview: text(item.status?.content || ''),
      createdAt: stamp(item.created_at), read: false,
      url: publicUrl(item.status?.url || item.account?.url, `${origin}/notifications`),
      user: { name, avatarUrl: publicUrl(item.account?.avatar_static || item.account?.avatar, null) } };
  }) };
}

function createConnectedInbox({ request, refreshToken, receipts, getAccount, now = Date.now }) {
  const cache = new Map(); const pending = new Map();
  const generations = new Map();
  const cacheKey = (user, source, kind) => `${user.id}:${source}:${source === 'reddit' ? 'inbox' : kind}:${hash(user.socialTokens[source])}`;
  const invalidate = (userId, source) => {
    generations.set(userId, (generations.get(userId) || 0) + 1);
    for (const key of cache.keys()) if (key.startsWith(`${userId}:${source || ''}`)) { clearTimeout(cache.get(key).timer); cache.delete(key); }
  };
  function remember(key, userId, generation, value, ttl) {
    if ((generations.get(userId) || 0) !== generation) return;
    const entry = { expires: now() + ttl, value };
    clearTimeout(cache.get(key)?.timer);
    cache.set(key, entry);
    const timer = setTimeout(() => { if (cache.get(key) === entry) cache.delete(key); }, ttl);
    timer.unref?.();
    entry.timer = timer;
    while (cache.size > 500) { const oldest = cache.keys().next().value; clearTimeout(cache.get(oldest).timer); cache.delete(oldest); }
  }
  async function fetchSource(user, source, kind) {
    const key = cacheKey(user, source, kind); const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.value;
    if (pending.has(key)) return pending.get(key);
    const generation = generations.get(user.id) || 0;
    const task = (async () => {
      let token = user.socialTokens[source]; let result = await request(source, token, kind);
      if (result.status === 401) { const next = await refreshToken(user.id, source, token); if (next) { token = next; result = await request(source, token, kind); } }
      if (result.status < 200 || result.status >= 300) throw Object.assign(new Error('Source inbox unavailable'), { status: result.status, retryAfter: result.headers?.['retry-after'] });
      const rows = source === 'github' ? githubRows(result.data) : source === 'reddit' ? redditRows(result.data)
        : source === 'mastodon' ? mastodonRows(result.data, token) : blueskyRows(result.data, kind, token);
      const value = { ...rows, fetchedAt: new Date(now()).toISOString(), tokenFingerprint: hash(token) };
      const minimum = ['github', 'reddit'].includes(source) ? 60000 : 15000;
      const pollSeconds = Number(result.headers?.['x-poll-interval']);
      const ttl = Math.max(minimum, Math.min(15 * 60000, Number.isFinite(pollSeconds) && pollSeconds > 0 ? pollSeconds * 1000 : minimum));
      remember(key, user.id, generation, value, ttl);
      return value;
    })().catch(error => {
      const status = [401, 403].includes(error.status) ? 'reconnect_required' : error.status === 422 ? 'external' : 'unavailable';
      const previous = status === 'unavailable' ? cached?.value : null;
      const value = { notifications: previous?.notifications || [], conversations: previous?.conversations || [], fetchedAt: previous?.fetchedAt || null,
        status, tokenFingerprint: hash(user.socialTokens[source]), message: status === 'reconnect_required' ? 'Reconnect this account to grant inbox access. Provider approval may also be required.' : status === 'external' ? 'Open this source to view its inbox; this connection cannot sync it here.' : 'The source inbox is temporarily unavailable. Try again shortly.' };
      remember(key, user.id, generation, value, Math.max(60000, Math.min(15 * 60000, Number(error.retryAfter || 60) * 1000))); return value;
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    // Bound private cache lifetime and memory. Never persist message bodies.
    if (cache.size > 500) { for (const [k, entry] of cache) if (entry.expires < now()) cache.delete(k); while (cache.size > 500) cache.delete(cache.keys().next().value); }
    return task;
  }
  async function list(user, kind) {
    const sources = []; const items = [];
    await Promise.all(Object.keys(user.socialTokens || {}).filter(source => user.socialTokens[source]).map(async source => {
      let info = SOURCE_INFO[source] || [source, 'https://uficonnect.org/connected-accounts', 'https://uficonnect.org/connected-accounts'];
      if (source === 'mastodon') {
        try { const origin = mastodonOrigin(JSON.parse(user.socialTokens[source]).origin); info = ['Mastodon', origin + '/notifications', origin + '/conversations']; }
        catch { info = ['Mastodon', 'https://joinmastodon.org/servers', 'https://joinmastodon.org/servers']; }
      }
      const supported = ['reddit', 'bluesky'].includes(source) || ['github', 'mastodon'].includes(source) && kind === 'notifications';
      const rows = supported ? await fetchSource(user, source, kind) : null;
      const fresh = getAccount ? await getAccount(user.id) : user;
      if (!fresh?.socialTokens?.[source] || hash(fresh.socialTokens[source]) !== (rows?.tokenFingerprint || hash(user.socialTokens[source]))) return;
      const reason = source === 'github' && kind === 'messages' ? 'GitHub does not provide a private messaging inbox API.'
        : source === 'twitter' ? 'This X connection does not have inbox API access or direct-message read permission. Open X to view its inbox.'
        : 'Inbox sync is not available with this connection’s permissions. Open the source to view it.';
      sources.push({ source, name: info[0], url: info[kind === 'notifications' ? 1 : 2], supported, status: rows?.status || (supported ? 'ready' : 'external'),
        message: rows?.message || (supported ? 'Read status is saved in UFIConnect. Open the source to reply or manage its inbox.' : reason), fetchedAt: rows?.fetchedAt || null });
      if (rows) items.push(...(kind === 'notifications' ? rows.notifications : rows.conversations));
    }));
    const seen = await receipts.read(user.id, items.map(item => item.id));
    const visible = items.map(item => {
      const { _providerId, _members, ...safe } = item;
      return kind === 'notifications' ? { ...safe, read: item.read || seen.has(item.id) } : { ...safe, unreadCount: seen.has(item.id) ? 0 : item.unreadCount };
    }).sort((a, b) => new Date(b.createdAt || b.lastMessage?.createdAt || 0) - new Date(a.createdAt || a.lastMessage?.createdAt || 0));
    return { [kind === 'notifications' ? 'notifications' : 'conversations']: visible, sources: sources.sort((a, b) => a.name.localeCompare(b.name)), fetchedAt: new Date(now()).toISOString() };
  }
  async function detail(user, source, id) {
    if (!user.socialTokens?.[source] || !['reddit', 'bluesky'].includes(source)) throw Object.assign(new Error('Conversation not found.'), { status: 404 });
    const rows = await fetchSource(user, source, 'messages'); const item = rows.conversations.find(c => c.id === id);
    if (!item) throw Object.assign(new Error('Conversation not found. Refresh the inbox.'), { status: 404 });
    let messages = item.messages;
    if (source === 'bluesky') {
      let token = user.socialTokens[source]; let result = await request(source, token, 'messages', item._providerId);
      if (result.status === 401) { const next = await refreshToken(user.id, source, token); if (next) { token = next; result = await request(source, token, 'messages', item._providerId); } }
      if (result.status < 200 || result.status >= 300 || !Array.isArray(result.data?.messages)) throw Object.assign(new Error('Could not load this source conversation. Open the source or try again.'), { status: 502 });
      messages = result.data.messages.map(m => blueskyMessage(m, item._members)).reverse();
    }
    const fresh = getAccount ? await getAccount(user.id) : user;
    if (!fresh?.socialTokens?.[source] || hash(fresh.socialTokens[source]) !== rows.tokenFingerprint) throw Object.assign(new Error('This connection changed. Refresh your inbox.'), { status: 409 });
    const { _providerId, _members, ...safe } = item; return { conversation: { ...safe, messages }, messages };
  }
  async function mark(user, kind, ids) {
    if (!Array.isArray(ids) || ids.length > 500) throw Object.assign(new Error('Provide the displayed inbox item IDs.'), { status: 400 });
    const payload = await list(user, kind); const allowed = new Set((payload.notifications || payload.conversations).map(item => item.id));
    const requested = [...new Set(ids)].filter(id => allowed.has(id));
    if (requested.length !== new Set(ids).size) throw Object.assign(new Error('Some items are no longer available. Refresh the inbox before marking them read.'), { status: 409 });
    return receipts.mark(user.id, requested);
  }
  return { list, detail, mark, invalidate };
}

module.exports = { createConnectedInbox, createInboxRequest, githubRows, redditRows, blueskyRows, mastodonRows, safePds };
