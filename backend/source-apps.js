'use strict';
// Private source libraries use documented read APIs and the member's OAuth
// connection. Vault credentials, site cookies and scraped pages are never inputs.
const { mastodonOrigin, mastodonPostUrl } = require('./mastodon-oauth');
const { mastodonContentText } = require('./mastodon-content');
const { getSourcePolicy } = require('./source-policy');
const SOURCE_APPS = Object.freeze(require('../shared/source-apps.json'));
const fail = (message, status = 502) => Object.assign(new Error(message), { status });
const plain = (value, max = 300) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').slice(0, max) : '';
function httpsLink(value, hosts) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname) ? url.href : null; }
  catch { return null; }
}
function cleanCursor(source, value) {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 512 || !/^[a-zA-Z0-9_=.-]+$/.test(value)) throw fail('Invalid source page.', 400);
  if (source === 'github' && (!/^[1-9]\d{0,3}$/.test(value) || Number(value) > 1000)) throw fail('Invalid source page.', 400);
  if (source === 'mastodon' && !/^\d{1,64}$/.test(value)) throw fail('Invalid source page.', 400);
  return value;
}
function bookmarkCursor(header, origin) {
  for (const match of String(header || '').matchAll(/<([^>]+)>\s*;\s*rel="?([^";,]+)"?/g)) {
    if (match[2] !== 'next') continue;
    try {
      const url = new URL(match[1]);
      if (url.origin === origin && url.pathname === '/api/v1/bookmarks' && !url.username && !url.password) return cleanCursor('mastodon', url.searchParams.get('max_id'));
    } catch { /* Never follow untrusted pagination URLs. */ }
  }
  return null;
}
function githubActivity(events, login, now = Date.now()) {
  const definitions = { code: 'Code and repositories', pulls: 'Pull requests and reviews', issues: 'Issue management', discussion: 'Issue discussions', stars: 'Star repositories' };
  const types = { PushEvent: 'code', CreateEvent: 'code', DeleteEvent: 'code', ForkEvent: 'code', PullRequestEvent: 'pulls', PullRequestReviewEvent: 'pulls', PullRequestReviewCommentEvent: 'pulls', IssuesEvent: 'issues', IssueCommentEvent: 'discussion', WatchEvent: 'stars' };
  const groups = new Map(), seen = new Set(); let reviewed = 0, oldest = now;
  for (const event of events.slice(0, 100)) {
    const time = Date.parse(event.created_at);
    if (event.actor?.login?.toLowerCase() !== login.toLowerCase() || !event.id || seen.has(String(event.id)) || !Number.isFinite(time) || time > now || time < now - 30 * 86400000) continue;
    seen.add(String(event.id)); reviewed++; oldest = Math.min(oldest, time);
    const id = types[event.type], repo = event.repo?.name;
    if (!id || !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo || '') || repo.split('/').some(part => ['.', '..'].includes(part))) continue;
    const group = groups.get(id) || { id, label: definitions[id], count: 0, repos: new Map() };
    group.count++;
    group.repos.set(repo, (group.repos.get(repo) || 0) + 1);
    groups.set(id, group);
  }
  return { account: login, eventsReviewed: reviewed, since: reviewed ? new Date(oldest).toISOString() : null,
    scope: 'Up to 100 recent GitHub events from the past 30 days. This API does not expose clicks, page views or complete app usage.',
    actions: [...groups.values()].sort((a, b) => b.count - a.count).map(({ repos, ...group }) => ({ ...group, items: [...repos].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([title, count]) => ({ id: title, title, count, url: 'https://github.com/' + title })) })) };
}
function createSourceApps({ getAccount, fetchImpl = fetch, mastodonService, refreshToken, env = process.env } = {}) {
  async function request(url, token, source) {
    let response;
    try { response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(12000), headers: {
      Authorization: `Bearer ${token}`, Accept: source === 'github' ? 'application/vnd.github+json' : 'application/json',
      'User-Agent': 'UFIConnect/1.0 (member app favorites)',
      ...(source === 'github' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}),
      ...(source === 'twitch' ? { 'Client-Id': env.TWITCH_CLIENT_ID } : {}),
    } }); } catch { throw fail('This source is temporarily unavailable. Try again later.'); }
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw fail('Reconnect this source to grant access to its favorites.', response.status);
      if (response.status === 429) throw fail('This source is rate limited. Try again later.', 429);
      throw fail('This source could not load your favorites.');
    }
    const length = Number(response.headers?.get('content-length'));
    if (length > 2 * 1024 * 1024) throw fail('This source returned too much data.');
    try {
      // Read incrementally so an absent or incorrect Content-Length cannot
      // turn this small library view into an unbounded download.
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2 * 1024 * 1024) { await reader.cancel(); throw fail('This source returned too much data.'); } chunks.push(Buffer.from(value)); } }
      finally { reader.releaseLock(); }
      return { data: JSON.parse(Buffer.concat(chunks).toString('utf8')), link: response.headers.get('link') || '' };
    } catch (error) { if (error.status) throw error; throw fail('This source returned an unexpected response.'); }
  }
  async function fetchActivity(source, token) {
    if (source !== 'github') throw fail('This source does not expose supported app-usage history. No usage ranking is available.', 422);
    const { data: account } = await request('https://api.github.com/user', token, source);
    if (!/^[a-zA-Z0-9-]{1,39}$/.test(account.login || '')) throw fail('GitHub did not identify the connected account.');
    const { data } = await request(`https://api.github.com/users/${account.login}/events?per_page=100`, token, source);
    if (!Array.isArray(data)) throw fail('GitHub returned unexpected activity data.');
    return githubActivity(data, account.login);
  }
  async function fetchLibrary(source, token, cursor) {
    if (source === 'github') {
      const { data: account } = await request('https://api.github.com/user', token, source);
      const page = Number(cursor || 1);
      const { data, link } = await request(`https://api.github.com/user/starred?per_page=20&page=${page}&sort=created&direction=desc`, token, source);
      if (!Array.isArray(data)) throw fail('GitHub returned an unexpected library.');
      return { account: plain(account.login, 100), items: data.slice(0, 20).map(row => ({ id: String(row.id), title: plain(row.full_name, 200), description: plain(row.description), url: httpsLink(row.html_url, ['github.com']) })).filter(row => row.url && row.title), nextCursor: /rel="next"/.test(link) && page < 1000 ? String(page + 1) : null };
    }
    if (source === 'mastodon') {
      let credentials;
      try { credentials = JSON.parse(token); } catch { throw fail('Reconnect Mastodon to access bookmarks.', 403); }
      const scopes = String(credentials.scope || '').split(/\s+/);
      if (!scopes.includes('read') && !scopes.includes('read:bookmarks')) throw fail('Reconnect Mastodon to grant read access to bookmarks.', 403);
      const origin = mastodonOrigin(credentials.origin);
      const response = await mastodonService.json(origin, '/api/v1/bookmarks?limit=20' + (cursor ? '&max_id=' + cursor : ''), { token: credentials.accessToken, includeResponse: true });
      if (!Array.isArray(response.data)) throw fail('Mastodon returned an unexpected library.');
      return { account: origin + ' · account ' + plain(credentials.accountId, 80), items: response.data.slice(0, 20).map(row => ({
        id: String(row.id), title: row.sensitive || row.spoiler_text ? plain(row.spoiler_text || 'Sensitive bookmarked post', 200) : mastodonContentText(row.content, 160) || 'Bookmarked post',
        description: row.sensitive || row.spoiler_text ? 'Open the original post to view this content.' : plain(row.account?.display_name || row.account?.acct, 100),
        url: mastodonPostUrl(row.url || row.uri),
      })).filter(row => row.url), nextCursor: bookmarkCursor(response.headers?.link, origin) };
    }
    if (source === 'youtube') {
      const { data: channels } = await request('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', token, source);
      const { data } = await request('https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=20' + (cursor ? '&pageToken=' + encodeURIComponent(cursor) : ''), token, source);
      if (!Array.isArray(data.items)) throw fail('YouTube returned an unexpected library.');
      return { account: plain(channels.items?.[0]?.snippet?.title || 'Connected YouTube account', 100), items: data.items.slice(0, 20).filter(row => /^[\w-]{1,100}$/.test(row.id || '')).map(row => ({ id: row.id, title: plain(row.snippet?.title, 200), description: plain(row.snippet?.description), url: 'https://www.youtube.com/playlist?list=' + encodeURIComponent(row.id) })), nextCursor: data.nextPageToken ? cleanCursor(source, data.nextPageToken) : null };
    }
    if (!env.TWITCH_CLIENT_ID) throw fail('Twitch app access is not configured.', 503);
    const { data: account } = await request('https://api.twitch.tv/helix/users', token, source);
    const user = account.data?.[0];
    if (!/^\d+$/.test(user?.id || '')) throw fail('Twitch did not identify the connected account.');
    const { data } = await request('https://api.twitch.tv/helix/channels/followed?first=20&user_id=' + user.id + (cursor ? '&after=' + encodeURIComponent(cursor) : ''), token, source);
    if (!Array.isArray(data.data)) throw fail('Twitch returned an unexpected library.');
    return { account: plain(user.display_name || user.login, 100), items: data.data.slice(0, 20).filter(row => /^[a-zA-Z0-9_]{1,25}$/.test(row.broadcaster_login || '')).map(row => ({ id: String(row.broadcaster_id), title: plain(row.broadcaster_name, 100), description: 'Channel you follow on Twitch', url: 'https://www.twitch.tv/' + row.broadcaster_login })), nextCursor: data.pagination?.cursor ? cleanCursor(source, data.pagination.cursor) : null };
  }
  async function load(userId, source, cursor, mode = 'favorites') {
    if (!Object.hasOwn(SOURCE_APPS, source)) throw fail('Favorites are not available through a supported API for this source.', 422);
    if (!getSourcePolicy(source, { env })?.enabled) throw fail('This source is disabled for UFIConnect.', 403);
    cursor = cleanCursor(source, cursor);
    const account = await getAccount(userId);
    const token = account?.socialTokens?.[source];
    if (!token) throw fail('Connect this source in Connected Accounts first. Importing a password does not authorize API access.', 403);
    let usedToken = token, result;
    const read = mode === 'activity' ? fetchActivity : fetchLibrary;
    try { result = await read(source, usedToken, cursor); }
    catch (error) {
      if (error.status !== 401 || !refreshToken || source === 'mastodon') throw error;
      usedToken = await refreshToken(userId, source, token);
      if (!usedToken) throw fail('Reconnect this source to load favorites.', 403);
      result = await read(source, usedToken, cursor);
    }
    const current = await getAccount(userId);
    if (current?.socialTokens?.[source] !== usedToken) throw fail('The source connection changed. Reopen this app page.', 403);
    return { source, ...SOURCE_APPS[source], ...result, fetchedAt: new Date().toISOString() };
  }
  return { load };
}
function registerSourceAppRoutes(app, { authenticate, limiter, ...options }) {
  const service = createSourceApps(options);
  const handler = mode => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try { res.json(await service.load(req.user.id, req.params.source, req.query.cursor, mode)); }
    catch (error) { res.status([400, 403, 422, 429, 503].includes(error.status) ? error.status : 502).json({ message: error.status ? error.message : 'The source could not load favorites. Please retry.' }); }
  };
  app.get('/social/apps/:source/favorites', authenticate, limiter, handler('favorites'));
  app.get('/social/apps/:source/activity', authenticate, limiter, handler('activity'));
}
module.exports = { SOURCE_APPS, cleanCursor, bookmarkCursor, githubActivity, createSourceApps, registerSourceAppRoutes };
