import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const NATIVE_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const EMPTY_SETTINGS = { ready: false, rates: [], rate: null, captionTracks: [], captionTrack: 'off' };
const captionTrack = track => track?.kind === 'captions' || track?.kind === 'subtitles';
const resourceOf = video => `${video.currentSrc || ''}|${video.getAttribute('src') || ''}`;

function currentVideo(getVideo) {
  try {
    const video = getVideo?.();
    return video?.tagName === 'VIDEO' && video.isConnected === true ? video : null;
  } catch { return null; }
}

// The hook observes the actual mounted native player. No tracks or provider
// capabilities are inferred from the post metadata.
export default function useNativePlayerSettings({ getVideo, enabled = true, mediaKey } = {}) {
  const identity = useRef(null), binding = useRef(null);
  identity.current = { getVideo, enabled, mediaKey };
  const [snapshot, setSnapshot] = useState(null);

  const owns = useCallback(owner => Boolean(owner && binding.current === owner && identity.current.enabled
    && Object.is(identity.current.mediaKey, owner.mediaKey)
    && currentVideo(identity.current.getVideo) === owner.video
    && resourceOf(owner.video) === owner.resource), []);

  function read(owner) {
    if (!owns(owner)) return;
    const tracks = Array.from(owner.video.textTracks || []).filter(captionTrack);
    const captionTracks = tracks.map((track, index) => {
      if (!owner.trackIds.has(track)) owner.trackIds.set(track, `caption-${owner.nextTrackId++}`);
      return { value: owner.trackIds.get(track), label: track.label || track.language || `Caption track ${index + 1}` };
    });
    const active = tracks.find(track => track.mode === 'showing');
    const rate = owner.video.playbackRate;
    const settings = { ready: true, rate,
      rates: [...new Set([...NATIVE_RATES, ...(Number.isFinite(rate) && rate > 0 ? [rate] : [])])].sort((a, b) => a - b),
      captionTracks, captionTrack: active ? owner.trackIds.get(active) : 'off' };
    setSnapshot(previous => previous?.owner === owner && JSON.stringify(previous.settings) === JSON.stringify(settings)
      ? previous : { owner, settings });
  }

  function detach() {
    binding.current?.cleanup();
    binding.current = null;
  }

  // Refs can change after an HLS/file player mounts without changing getVideo's
  // callback identity. Check the node after every commit and bind only on change.
  useLayoutEffect(() => {
    const current = identity.current;
    const video = current.enabled ? currentVideo(current.getVideo) : null;
    if (video && binding.current?.video === video && Object.is(binding.current.mediaKey, current.mediaKey)
      && binding.current.resource === resourceOf(video)) return;
    detach();
    if (!video) { setSnapshot(previous => previous === null ? previous : null); return; }
    const owner = { video, mediaKey: current.mediaKey, resource: resourceOf(video), trackIds: new WeakMap(), nextTrackId: 0 };
    const update = () => {
      if (binding.current !== owner || !identity.current.enabled || !Object.is(identity.current.mediaKey, owner.mediaKey)
        || currentVideo(identity.current.getVideo) !== video) return;
      // Loading resolves currentSrc after the initial node binding. Update that
      // resource only while the same media identity still owns this video.
      owner.resource = resourceOf(video);
      read(owner);
    };
    const events = ['ratechange', 'loadedmetadata', 'loadstart', 'emptied'];
    for (const name of events) video.addEventListener(name, update);
    const tracks = video.textTracks;
    for (const name of ['change', 'addtrack', 'removetrack']) tracks?.addEventListener?.(name, update);
    owner.cleanup = () => {
      for (const name of events) video.removeEventListener(name, update);
      for (const name of ['change', 'addtrack', 'removetrack']) tracks?.removeEventListener?.(name, update);
    };
    binding.current = owner;
    read(owner);
  });
  useEffect(() => () => detach(), []);

  const setRate = useCallback(rate => {
    const owner = binding.current;
    if (!enabled || !Object.is(mediaKey, owner?.mediaKey) || !owns(owner) || !Number.isFinite(rate) || rate <= 0
      || (!NATIVE_RATES.includes(rate) && rate !== owner.video.playbackRate)) return false;
    try { owner.video.playbackRate = rate; read(owner); return owner.video.playbackRate === rate; }
    catch { read(owner); return false; }
  }, [enabled, mediaKey, owns]);

  const setCaptionTrack = useCallback(value => {
    const owner = binding.current;
    if (!enabled || !Object.is(mediaKey, owner?.mediaKey) || !owns(owner)) return false;
    const tracks = Array.from(owner.video.textTracks || []).filter(captionTrack);
    const selected = value === 'off' ? null : tracks.find(track => owner.trackIds.get(track) === value);
    if (value !== 'off' && !selected) return false;
    try {
      for (const track of tracks) track.mode = track === selected ? 'showing' : 'disabled';
      read(owner); return true;
    } catch { read(owner); return false; }
  }, [enabled, mediaKey, owns]);

  const settings = snapshot && owns(snapshot.owner) ? snapshot.settings : EMPTY_SETTINGS;
  return { settings, setRate, setCaptionTrack };
}
