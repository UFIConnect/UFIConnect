import { useLayoutEffect, useRef, useState } from 'react';
import { createYouTubePlayerFrame, loadYouTubeIframeApi } from '../components/videoMedia';

const EMPTY_PLAYBACK = { ready: false, paused: true, muted: true, currentTime: 0, duration: 0 };

// One official player owns the opened snap. Its identity is checked at render
// time as well as in asynchronous callbacks, so a previous account or snap
// cannot receive playback commands while its effect is being cleaned up.
export default function useYouTubeSnapPlayback({ enabled, mediaKey, videoId, title }) {
  const hostRef = useRef(null), binding = useRef(null), identity = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  identity.current = { enabled, mediaKey, videoId, title };

  function owns(owner) {
    return Boolean(owner && !owner.cancelled && binding.current === owner && identity.current.enabled
      && identity.current.mediaKey === owner.mediaKey && identity.current.videoId === owner.videoId
      && hostRef.current === owner.host && owner.host.isConnected);
  }

  function currentPlayer(owner = binding.current) {
    if (!owns(owner) || !owner.ready || !owner.player) return null;
    try { return owner.player.getVideoData?.()?.video_id === owner.videoId ? owner.player : null; }
    catch { return null; }
  }

  function read(owner) {
    const player = currentPlayer(owner);
    if (!player) return;
    try {
      const state = player.getPlayerState();
      const currentTime = player.getCurrentTime(), duration = player.getDuration();
      const playback = {
        ready: true, paused: state !== 1 && state !== 3,
        muted: Boolean(player.isMuted()) || player.getVolume() === 0,
        currentTime: Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0,
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      };
      setSnapshot(previous => previous?.owner === owner && Object.keys(playback).every(key => previous.playback[key] === playback[key])
        ? previous : { owner, playback });
    } catch { /* The official iframe remains usable if its API is unavailable. */ }
  }

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!enabled || !host || !/^[\w-]{11}$/.test(String(videoId || ''))) return undefined;
    const owner = { host, mediaKey, videoId, player: null, ready: false, cancelled: false };
    binding.current = owner;
    // Keep official controls visible even when API loading is blocked. Loading
    // the frame never starts an external snap's playback.
    const frame = createYouTubePlayerFrame(host, videoId, { autoplay: 0, controls: 1, mute: 1 }, identity.current.title);
    let poll;
    loadYouTubeIframeApi().then(YT => {
      if (!owns(owner) || !YT?.Player) return;
      try {
        owner.player = new YT.Player(frame, {
          events: {
            onReady: event => {
              if (!owns(owner)) return;
              owner.player = event.target; owner.ready = true;
              read(owner);
              window.clearInterval(poll);
              poll = window.setInterval(() => { if (!document.hidden) read(owner); }, 250);
            },
            onStateChange: () => read(owner),
            onError: () => {
              if (!owns(owner)) return;
              owner.ready = false;
              window.clearInterval(poll);
              setSnapshot({ owner, playback: EMPTY_PLAYBACK });
            },
          },
        });
      } catch { /* Preserve the already mounted official player. */ }
    }).catch(() => {});
    return () => {
      owner.cancelled = true;
      window.clearInterval(poll);
      if (binding.current === owner) binding.current = null;
      try { owner.player?.destroy(); } catch { /* The frame may already have left the document. */ }
      host.replaceChildren();
    };
  }, [enabled, mediaKey, videoId]);

  const togglePlay = () => {
    const owner = binding.current, player = currentPlayer(owner);
    if (!player) return;
    try {
      const state = player.getPlayerState();
      if (state === 1 || state === 3) player.pauseVideo(); else player.playVideo();
      read(owner);
    } catch { /* Do not optimistically claim that playback changed. */ }
  };
  const toggleMute = () => {
    const owner = binding.current, player = currentPlayer(owner);
    if (!player) return;
    try {
      if (player.isMuted() || player.getVolume() === 0) {
        if (player.getVolume() === 0) player.setVolume(100);
        player.unMute();
      } else player.mute();
      read(owner);
    } catch { /* The next verified poll reports the actual volume. */ }
  };
  const seek = seconds => {
    const owner = binding.current, player = currentPlayer(owner);
    if (!player || !Number.isFinite(seconds)) return;
    try {
      const duration = player.getDuration();
      if (!Number.isFinite(duration) || duration <= 0) return;
      // seekTo starts unstarted/cued players. Cue the requested position
      // instead, preserving the external snap's explicit-play requirement.
      const state = player.getPlayerState();
      const target = Math.max(0, Math.min(duration, seconds));
      if (state === -1 || state === 5) player.cueVideoById?.({ videoId: owner.videoId, startSeconds: target });
      else player.seekTo(target, true);
      read(owner);
    } catch { /* Seeking cannot claim a position the player did not accept. */ }
  };

  const playback = snapshot && owns(snapshot.owner) && currentPlayer(snapshot.owner)
    ? snapshot.playback : EMPTY_PLAYBACK;
  return { hostRef, ...playback, togglePlay, toggleMute, seek };
}
