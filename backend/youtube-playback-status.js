'use strict';

// Official current audience classification only. Missing data never implies
// that a video is not made for kids, and never changes whether it can play.
// https://developers.google.com/youtube/v3/docs/videos#status.madeForKids
const KNOWN_TTL_MS = 15 * 60 * 1000;
const UNKNOWN_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const MAX_IN_FLIGHT = 20;
const MAX_RESPONSE_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 5000;
const validVideoId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);

async function boundedJSON(response) {
  const length = Number(response.headers?.get('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Oversized response');
  }
  const reader = response.body?.getReader();
  let text;
  if (reader) {
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new Error('Oversized response');
        chunks.push(Buffer.from(value));
      }
      text = Buffer.concat(chunks).toString('utf8');
    } finally { await reader.cancel().catch(() => {}); }
  } else {
    text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('Oversized response');
  }
  return JSON.parse(text);
}

function createYouTubePlaybackStatus({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map(), inFlight = new Map();
  let configuredKey = env.YOUTUBE_API_KEY;
  const unknown = (videoId, status = 'unknown') => ({ videoId, madeForKids: null, checkedAt: new Date(now()).toISOString(), status });
  return async function lookup(videoId) {
    if (!validVideoId(videoId)) throw Object.assign(new Error('Use one valid YouTube video ID.'), { status: 400 });
    // Configuration rotation cannot reuse an old lookup or its promise.
    if (configuredKey !== env.YOUTUBE_API_KEY) { cache.clear(); inFlight.clear(); configuredKey = env.YOUTUBE_API_KEY; }
    const apiKey = configuredKey;
    if (typeof apiKey !== 'string' || !apiKey.trim()) return unknown(videoId, 'unavailable');
    const cached = cache.get(videoId);
    if (cached && cached.expiresAt > now()) {
      cache.delete(videoId); cache.set(videoId, cached);
      return { ...cached.value };
    }
    cache.delete(videoId);
    if (inFlight.has(videoId)) return { ...await inFlight.get(videoId) };
    if (inFlight.size >= MAX_IN_FLIGHT) return unknown(videoId, 'unavailable');
    const request = (async () => {
      let result;
      const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      try {
        const query = new URLSearchParams({ part: 'status', id: videoId, fields: 'items(id,status/madeForKids)', key: apiKey });
        const response = await fetchImpl(`https://www.googleapis.com/youtube/v3/videos?${query}`, {
          headers: { Accept: 'application/json' }, redirect: 'error', signal,
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw new Error('Source unavailable');
        }
        const data = await boundedJSON(response);
        if (signal.aborted) throw new Error('Source timeout');
        const item = Array.isArray(data?.items) && data.items.length === 1 && data.items[0]?.id === videoId ? data.items[0] : null;
        const flag = item?.status?.madeForKids;
        result = typeof flag === 'boolean'
          ? { videoId, madeForKids: flag, checkedAt: new Date(now()).toISOString(), status: 'available' }
          : unknown(videoId);
      } catch { result = unknown(videoId, 'unavailable'); }
      if (configuredKey === apiKey) {
        cache.set(videoId, { value: Object.freeze(result), expiresAt: now() + (result.madeForKids === null ? UNKNOWN_TTL_MS : KNOWN_TTL_MS) });
        while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
      }
      return result;
    })();
    inFlight.set(videoId, request);
    try { return { ...await request }; }
    finally { if (inFlight.get(videoId) === request) inFlight.delete(videoId); }
  };
}

module.exports = { createYouTubePlaybackStatus, validVideoId, KNOWN_TTL_MS, UNKNOWN_TTL_MS, MAX_CACHE_ENTRIES, MAX_IN_FLIGHT, REQUEST_TIMEOUT_MS };
