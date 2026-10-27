const RETRY_MS = 10 * 60 * 1000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const isMap = value => Object.prototype.toString.call(value) === '[object Map]';
const isPublicLive = state => state?.live === true && state.public === true;

// Call once per normal videos.list verification cycle. This stores candidate
// IDs, never liveness proof. Include videoIds in the next normal status batch;
// pass the returned states and resolvedIds to the provider verifier.
// searchChannel(channelId, { maxResults: 5 }) supplies an official search.list
// response with snippet.channelId/liveBroadcastContent and id.videoId.
// fetchStates(ids) supplies a fresh videos.list Map of { live, public, ... }.
// A null status batch means an API outage: no discovery or proof is returned.
// Superseded concurrent cycles also return null instead of older status proof.
function createYouTubeCameraChannelResolver(catalog, { now = Date.now } = {}) {
  if (!Array.isArray(catalog) || catalog.length > 200) throw new TypeError('Invalid camera channel catalog');
  const entries = catalog.filter(entry => entry.verification?.kind === 'youtube-provider').map(entry => {
    const { videoId, channelId } = entry.verification;
    if (typeof entry.id !== 'string' || !entry.id || typeof videoId !== 'string' || !VIDEO_ID.test(videoId)
      || channelId !== undefined && (typeof channelId !== 'string' || !CHANNEL_ID.test(channelId))) throw new TypeError('Invalid YouTube camera identity');
    return { id: entry.id, videoId, channelId };
  });
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new TypeError('Duplicate YouTube camera provider');
  const selectedIds = new Map(entries.map(entry => [entry.id, entry.videoId]));
  const attempts = new Map();
  let generation = 0;

  async function resolve(states, { searchChannel, fetchStates } = {}) {
    const cycle = ++generation;
    if (states == null) return null;
    if (!isMap(states)) throw new TypeError('YouTube states must be a Map or null');
    const result = new Map(states);
    for (const entry of entries) {
      if (cycle !== generation) break;
      const currentId = selectedIds.get(entry.id);
      if (isPublicLive(states.get(currentId))) { attempts.delete(entry.id); continue; }
      const previousAttempt = attempts.get(entry.id);
      if (!entry.channelId || previousAttempt?.pending || (previousAttempt?.retryAt || 0) > now()) continue;
      if (typeof searchChannel !== 'function' || typeof fetchStates !== 'function') throw new TypeError('Camera channel discovery callbacks are required');
      const attempt = { pending: true, retryAt: now() + RETRY_MS };
      attempts.set(entry.id, attempt);
      let resolved = false;
      try {
        const search = await searchChannel(entry.channelId, { maxResults: 5 });
        if (cycle !== generation) break;
        const items = Array.isArray(search?.items) ? search.items.slice(0, 5) : [];
        const candidates = [...new Set(items.filter(item => item?.snippet?.channelId === entry.channelId
          && item.snippet.liveBroadcastContent === 'live' && VIDEO_ID.test(item.id?.videoId || ''))
          .map(item => item.id.videoId))];
        if (!candidates.length) continue;
        const freshStates = await fetchStates(candidates);
        if (cycle !== generation || !isMap(freshStates)) continue;
        const replacement = candidates.find(id => {
          const state = freshStates.get(id);
          return isPublicLive(state) && (!state.channelId || state.channelId === entry.channelId);
        });
        if (!replacement) continue;
        selectedIds.set(entry.id, replacement);
        result.set(replacement, { ...freshStates.get(replacement) });
        resolved = true;
      } catch {
        // Failure keeps the last candidate identity, without reviving its proof.
      } finally {
        if (attempts.get(entry.id) === attempt) {
          if (resolved) attempts.delete(entry.id);
          else { attempt.pending = false; attempt.retryAt = now() + RETRY_MS; }
        }
      }
    }
    // A newer status cycle (including an outage) supersedes in-flight proof.
    return cycle === generation ? result : null;
  }

  return {
    get videoIds() { return [...new Set(selectedIds.values())]; },
    get resolvedIds() { return new Map(selectedIds); },
    resolve,
  };
}

module.exports = { createYouTubeCameraChannelResolver };
