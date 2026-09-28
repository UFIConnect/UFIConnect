'use strict';

const cache = new Map();
const inflight = new Map();
const windows = new Map();
const TTL = 10 * 60 * 1000;
const PAGE_SIZE = 20;
function unavailable(status, message) { return Object.assign(new Error(message), { status }); }

async function json(url, headers = {}) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'UFIconnect-People', ...headers },
    signal: AbortSignal.timeout(7000),
    redirect: 'error',
  });
  if (!response.ok) throw unavailable(response.status === 429 || response.status === 403 ? 429 : 502,
    response.status === 429 || response.status === 403 ? 'This source is busy. Please try again shortly.' : 'This source is temporarily unavailable.');
  return response.json();
}

async function searchExternalPeople({ source, q, topic, page = 1, cursor = '' }) {
  if (!['github', 'bluesky'].includes(source)) throw unavailable(400, 'Choose a supported profile source.');
  if (typeof q !== 'string' || q.length > 120 || typeof topic !== 'string' || topic.length > 120
      || typeof cursor !== 'string' || cursor.length > 512 || !Number.isInteger(page) || page < 1 || page > 50) {
    throw unavailable(400, 'Invalid people search.');
  }
  const term = q.trim() || topic.trim() || 'community';
  const key = JSON.stringify([source, q.trim(), term, page, cursor]);
  const stored = cache.get(key);
  if (stored && Date.now() - stored.at < TTL) return stored.value;
  if (inflight.has(key)) return inflight.get(key);
  const now = Date.now();
  const recent = (windows.get(source) || []).filter(time => now - time < 60000);
  // Keep public searches bounded even when no provider key is configured.
  const limit = source === 'github' ? (process.env.GITHUB_TOKEN ? 20 : 6) : 40;
  if (recent.length >= limit || inflight.size >= 8) throw unavailable(429, 'This source is busy. Please try again shortly.');
  windows.set(source, [...recent, now]);
  const work = (async () => {
    let value;
    if (source === 'bluesky') {
      const params = new URLSearchParams({ q: term, limit: String(PAGE_SIZE) });
      if (cursor) params.set('cursor', cursor);
      const data = await json('https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?' + params);
      const users = (data.actors || []).filter(actor => actor.did && actor.handle && !actor.labels?.some(label =>
        ['!hide', '!warn', 'porn', 'sexual', 'graphic-media'].includes(label.val))).map(actor => ({
        id: 'bluesky:' + actor.did, source: 'bluesky', name: actor.displayName || actor.handle,
        title: '@' + actor.handle, bio: String(actor.description || '').slice(0, 1200),
        avatarUrl: /^https:\/\//.test(actor.avatar || '') ? actor.avatar : '',
        profileUrl: 'https://bsky.app/profile/' + encodeURIComponent(actor.did),
        discoveryReason: 'Profile search: ' + term,
      }));
      value = { users, cursor: data.cursor || '', hasMore: Boolean(data.cursor && data.cursor !== cursor) };
    } else {
      const headers = process.env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {};
      const params = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(page) });
      // Names search the public member directory; interests discover people
      // through their public projects rather than claiming inferred interests.
      params.set('q', q.trim() ? q.trim() + ' in:login,name type:user' : term + ' is:public');
      const data = await json('https://api.github.com/search/' + (q.trim() ? 'users' : 'repositories') + '?' + params, headers);
      const seen = new Set();
      const users = (data.items || []).flatMap(item => {
        const user = q.trim() ? item : item.owner;
        if (!user?.login || user.type !== 'User' || seen.has(user.login)) return [];
        seen.add(user.login);
        return [{
          id: 'github:' + user.login.toLowerCase(), source: 'github', name: user.login,
          title: q.trim() ? 'GitHub member' : item.name,
          bio: q.trim() ? '' : String(item.description || '').slice(0, 1200),
          avatarUrl: /^https:\/\//.test(user.avatar_url || '') ? user.avatar_url : '',
          profileUrl: 'https://github.com/' + encodeURIComponent(user.login),
          discoveryReason: q.trim() ? 'Public profile search' : 'Public project about ' + term,
        }];
      });
      value = { users, page, hasMore: page < 50 && page * PAGE_SIZE < Math.min(Number(data.total_count) || 0, 1000) };
    }
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return value;
  })().finally(() => inflight.delete(key));
  inflight.set(key, work);
  return work;
}

function registerPeopleDiscovery(app, authenticate) {
  app.get('/people/external', authenticate, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const data = await searchExternalPeople({
        source: req.query.source, q: req.query.q ?? '', topic: req.query.topic ?? '',
        page: Number(req.query.page || 1), cursor: req.query.cursor ?? '',
      });
      res.json(data);
    } catch (error) {
      if (error.status === 429) res.set('Retry-After', '60');
      res.status(error.status || 502).json({ message: error.status ? error.message : 'This source is temporarily unavailable.' });
    }
  });
}
module.exports = { registerPeopleDiscovery };

