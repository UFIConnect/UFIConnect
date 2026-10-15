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

function completeTravelCameraCatalog(cameras, destinations) {
  const catalog = [...cameras];
  const key = place => `${place.countryCode}:${place.city}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const covered = new Set(cameras.map(key));
  for (const destination of destinations) {
    if (covered.has(key(destination))) continue;
    covered.add(key(destination));
    catalog.push({
      id: `camera_destination_${destination.countryCode}_${destination.slug}`,
      city: destination.city, country: destination.country, countryCode: destination.countryCode,
      title: `${destination.city} Live View`,
      content: `A current live view from ${destination.city}, ${destination.country}.`,
      sourceUrl: null, mediaUrl: null, discoveryOnly: true,
      createdAt: '2026-09-02T00:00:00.000Z',
    });
  }
  return Object.freeze(catalog);
}

// The provider's live search remains usable when its API quota or a camera's
// embedding permission is unavailable. A search link is never a verified feed.
function travelCameraSearchUrl(destination) {
  const params = new URLSearchParams({
    search_query: `${destination.city} ${destination.country || destination.countryCode} live webcam`,
    sp: 'EgJAAQ==', // YouTube's Live feature filter.
  });
  return `https://www.youtube.com/results?${params}`;
}

// Keep selected cities ahead of the rotating pool, including selections made
// while a previous discovery batch is still running.
function queueCameraDiscoveries(queue, cameras, requested = false) {
  for (const camera of cameras) {
    const existing = queue.get(camera.id);
    queue.set(camera.id, { camera, requested: requested || Boolean(existing?.requested) });
  }
}

function nextCameraDiscovery(queue, slots, reservedSlots) {
  const entries = [...queue.values()];
  const next = entries.find(entry => entry.requested) || entries[0];
  if (!next || slots <= (next.requested ? 0 : reservedSlots)) return null;
  queue.delete(next.camera.id);
  return next.camera;
}

module.exports = { verifiedCityAlternates, completeTravelCameraCatalog, travelCameraSearchUrl, queueCameraDiscoveries, nextCameraDiscovery };
