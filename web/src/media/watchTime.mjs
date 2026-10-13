// App-observed playback is an activity measurement, never a provider view,
// advertising impression, creator entitlement, or payable monetary amount.
export const MAX_SAMPLE_GAP_MS = 2000;

export function createWatchClock() {
  let previous = null;
  let watchedMs = 0;
  return {
    reset() { previous = null; },
    get watchedMs() { return watchedMs; },
    sample({ now, position, rate = 1, playing, enabled = true, seeking = false }) {
      const valid = enabled && playing && !seeking && Number.isFinite(now)
        && Number.isFinite(position) && position >= 0 && Number.isFinite(rate) && rate > 0 && rate <= 16;
      if (!valid) { previous = null; return 0; }
      const next = { now, position, rate };
      if (!previous) { previous = next; return 0; }
      const wall = now - previous.now;
      const media = (position - previous.position) * 1000;
      if (wall <= 0 || wall > MAX_SAMPLE_GAP_MS || rate !== previous.rate || media < 0) {
        previous = next; return 0;
      }
      // Keep the anchor while waiting for the next real timeupdate. Reset it
      // after a long stall; frozen positions and timer ticks earn no time.
      if (media === 0) return 0;
      previous = next;
      if (media > wall * rate + 350) return 0; // seek/discontinuity
      const delta = Math.max(0, Math.min(wall, media / rate));
      watchedMs += delta;
      return delta;
    },
  };
}

export function playbackMeasurementAllowed({ playbackSource, trackingAllowed, privacyClassification }) {
  if (trackingAllowed === false) return false;
  if (playbackSource === 'youtube') return trackingAllowed === true && privacyClassification === 'not_made_for_kids';
  return Boolean(playbackSource) && privacyClassification !== 'made_for_kids';
}

// The input may contain a signed media URL. Only this opaque grouping key is
// persisted; URLs, tokens, and URL query strings never enter playback history.
export function mediaHistoryKey(value) {
  const text = String(value || '');
  let first = 2166136261, second = 2246822519;
  for (let i = 0; i < text.length; i++) {
    first = Math.imul(first ^ text.charCodeAt(i), 16777619);
    second = Math.imul(second ^ text.charCodeAt(i), 3266489917);
  }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0');
}
