'use strict';

// Public primary-source announcement feeds. These URLs were checked directly;
// no credential, user query or Office observation is sent to their publishers.
const FEEDS = Object.freeze([
  Object.freeze({ publisher: 'Cloudflare', url: 'https://blog.cloudflare.com/tag/ai/rss/', article: /^\/[a-z0-9][a-z0-9-]*\/?$/i }),
  Object.freeze({ publisher: 'OpenAI', url: 'https://openai.com/news/rss.xml', article: /^\/index\/[^/]+\/?$/ }),
  Object.freeze({ publisher: 'Google', url: 'https://blog.google/innovation-and-ai/technology/ai/rss/', article: /^\/(?:innovation-and-ai|technology|products|inside-google)\/[^?#]+/ }),
  // Community-authored /blog/<organization>/<slug> posts are excluded.
  Object.freeze({ publisher: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', article: /^\/blog\/[^/]+\/?$/ }),
]);
const MAX_BYTES = 1024 * 1024;
const MAX_AGE = 90 * 86400000;
const CACHE_MS = 5 * 60000;

function isAIUpdateQuestion(message) {
  if (typeof message !== 'string') return false;
  return /\b(?:ai|artificial intelligence|llms?|language models?|chatbots?|openai|chatgpt|claude|anthropic|gemini|deepmind|hugging\s*face|workers\s*ai)\b/i.test(message)
    && /\b(?:latest|recent|new|updates?|releases?|announc(?:e|ed|ements?)|launch(?:es|ed)?|news|this\s+(?:week|month)|today|current)\b/i.test(message);
}

function decodeEntities(value) {
  const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return value.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== '#') return names[entity.toLowerCase()] ?? match;
    const value = /^#x/i.test(entity) ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '';
  });
}
function plain(value, limit) {
  return decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}
function field(item, name) {
  return item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}\\s*>`, 'i'))?.[1] || '';
}

function parseFeed(xml, feed, now = Date.now()) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_BYTES || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)
    || !/<rss(?:\s|>)/i.test(xml) || !/<\/rss\s*>/i.test(xml)) return [];
  const expected = FEEDS.find(item => item.url === feed.url);
  if (!expected) return [];
  const origin = new URL(expected.url).origin;
  const sources = [], seen = new Set();
  let count = 0;
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item\s*>/gi)) {
    if (++count > 1000) break;
    const item = match[1], title = plain(field(item, 'title'), 240), urlText = plain(field(item, 'link'), 2048);
    const published = Date.parse(plain(field(item, 'pubDate'), 100));
    if (!title || !urlText || !Number.isFinite(published) || published > now || published < now - MAX_AGE) continue;
    let url;
    try { url = new URL(urlText); } catch { continue; }
    if (url.origin !== origin || url.username || url.password || url.port || url.search || url.hash || !expected.article.test(url.pathname) || seen.has(url.href)) continue;
    seen.add(url.href);
    sources.push({ title, url: url.href, description: plain(field(item, 'description'), 1200), publishedAt: new Date(published).toISOString(), publisher: expected.publisher });
  }
  return sources.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

async function readFeed(fetcher, feed) {
  const signal = AbortSignal.timeout(5000);
  let url = new URL(feed.url);
  for (let redirect = 0; redirect <= 2; redirect++) {
    const response = await fetcher(url.href, { method: 'GET', redirect: 'manual', signal,
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'UFIConnect-Office/1.0' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel?.().catch(() => {});
      if (redirect === 2 || !response.headers.get('location')) throw new Error('Feed redirect limit.');
      const target = new URL(response.headers.get('location'), url);
      if (target.origin !== new URL(feed.url).origin || target.username || target.password || target.port || target.search || target.hash) throw new Error('Feed redirect rejected.');
      url = target;
      continue;
    }
    if (!response.ok || !/(?:rss\+xml|application\/xml|text\/xml)/i.test(response.headers.get('content-type') || '')) {
      await response.body?.cancel?.().catch(() => {});
      throw new Error('Feed unavailable.');
    }
    const reader = response.body?.getReader?.();
    if (!reader) throw new Error('Feed unreadable.');
    let bytes = 0; const chunks = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BYTES) throw new Error('Feed exceeds capacity.');
        chunks.push(Buffer.from(part.value));
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  throw new Error('Feed unavailable.');
}

function diverseLatest(groups) {
  const selected = [], counts = new Map(), seen = new Set();
  const add = item => {
    if (!item || selected.length >= 8 || seen.has(item.url) || (counts.get(item.publisher) || 0) >= 3) return;
    selected.push(item); seen.add(item.url); counts.set(item.publisher, (counts.get(item.publisher) || 0) + 1);
  };
  // Include each responding publisher once, then favor the most recent posts.
  for (const group of groups) add(group[0]);
  for (const item of groups.flat().sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))) add(item);
  return selected.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function createOfficialAIUpdates({ fetcher = globalThis.fetch, now = Date.now } = {}) {
  let cache = null, pending = null;
  return async function officialUpdates() {
    if (cache && now() - cache.storedAt < CACHE_MS) return structuredClone(cache.value);
    if (!pending) pending = (async () => {
      const checkedAt = new Date(now()).toISOString();
      const results = await Promise.allSettled(FEEDS.map(async feed => parseFeed(await readFeed(fetcher, feed), feed, now())));
      const groups = results.map(result => result.status === 'fulfilled' ? result.value : []);
      const sources = diverseLatest(groups);
      const value = { sources, checkedAt, providers: [...new Set(sources.map(source => source.publisher))],
        failedProviders: results.flatMap((result, index) => result.status === 'rejected' ? [FEEDS[index].publisher] : []) };
      cache = { storedAt: now(), value };
      return value;
    })().finally(() => { pending = null; });
    return structuredClone(await pending);
  };
}

module.exports = { createOfficialAIUpdates, isAIUpdateQuestion, parseFeed, FEEDS };
