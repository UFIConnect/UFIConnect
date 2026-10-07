export function normalizeFeedLocation(value = {}) {
  return {
    country: String(value?.country || '').replace(/[<>]/g, '').trim().slice(0, 80),
    city: String(value?.city || '').replace(/[<>]/g, '').trim().slice(0, 80),
  };
}

export function savedFeedLocation(settings = {}, mode) {
  const scoped = settings?.feedLocations;
  return normalizeFeedLocation(scoped && Object.hasOwn(scoped, mode) ? scoped[mode] : settings?.feedLocation);
}

export function regionalFeedLocation(settings = {}) {
  const saved = settings?.feedRegionalLocation || {};
  const mode = ['auto', 'manual', 'off'].includes(saved.mode) ? saved.mode : 'auto';
  return { mode, ...normalizeFeedLocation(mode === 'manual' ? saved : {}) };
}

export function feedLocationKey(settings = {}, mode = 'feed') {
  return JSON.stringify(['countries', 'restaurants', 'bars', 'local'].includes(mode)
    ? { regional: regionalFeedLocation(settings), destination: savedFeedLocation(settings, mode) }
    : regionalFeedLocation(settings));
}
