// Reuse the live-status batch already fetched for known cameras. An alternate
// must belong to the same city and have current public embedding permission.
function verifiedCityAlternates(camera, streams, states, cityMatches) {
  const seen = new Set([camera.videoId]);
  return streams.filter(stream => {
    const state = states?.get(stream.videoId);
    if (!/^[\w-]{11}$/.test(stream.videoId || '') || seen.has(stream.videoId)
        || !cityMatches(camera, stream) || !state?.live || !state.embeddable) return false;
    seen.add(stream.videoId);
    return true;
  }).map(stream => ({
    videoId: stream.videoId,
    sourceUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(stream.videoId)}`,
    title: stream.title || camera.title,
    channelTitle: stream.channelTitle || null,
    replacement: Boolean(stream.replacement),
    liveVerified: true,
  }));
}

module.exports = { verifiedCityAlternates };
