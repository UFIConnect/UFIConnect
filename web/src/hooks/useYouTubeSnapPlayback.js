import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createYouTubePlayerFrame, loadYouTubeIframeApi } from '../components/videoMedia';

const EMPTY_SETTINGS = { ready: false, rates: [], rate: null, captionFontSize: null };
const EMPTY_PLAYBACK = { ready: false, failed: false, paused: true, playing: false, muted: true, currentTime: 0, duration: 0, settings: EMPTY_SETTINGS };

function readSettings(player) {
  let rates = [], rate = null, captionFontSize = null;
  try { rates = [...new Set((player.getAvailablePlaybackRates?.() || []).filter(value => Number.isFinite(value) && value > 0))].sort((a, b) => a - b); } catch {}
  try { const value = player.getPlaybackRate?.(); if (Number.isFinite(value) && value > 0) rate = value; } catch {}
  try {
    if (player.getOptions?.('captions')?.includes('fontSize')) {
      const size = player.getOption('captions', 'fontSize');
      if (Number.isInteger(size) && size >= -1 && size <= 3) captionFontSize = size;
    }
  } catch {}
  return { ready: true, rates, rate, captionFontSize };
}

// One official player owns the opened snap. Its identity is checked at render
// time as well as in asynchronous callbacks, so a previous account or snap
// cannot receive playback commands while its effect is being cleaned up.
export default function useYouTubeSnapPlayback({ enabled, mediaKey, videoId, title, forcePause = false }) {
  const hostRef = useRef(null), binding = useRef(null), identity = useRef(null);
  const [snapshot, setSnapshot] = useState(null);
  identity.current = { enabled, mediaKey, videoId, title, forcePause };

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
      if ((document.hidden || identity.current.forcePause) && (state === 1 || state === 3)) {
        player.pauseVideo();
        return;
      }
      const currentTime = player.getCurrentTime(), duration = player.getDuration();
      const playback = {
        ready: true, failed: false, paused: state !== 1 && state !== 3, playing: state === 1,
        muted: Boolean(player.isMuted()) || player.getVolume() === 0,
        currentTime: Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0,
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        settings: readSettings(player),
      };
      setSnapshot(previous => previous?.owner === owner && JSON.stringify(previous.playback) === JSON.stringify(playback)
        ? previous : { owner, playback });
    } catch { /* The official iframe remains usable if its API is unavailable. */ }
  }

  function startAutoplay(owner) {
    const player = currentPlayer(owner);
    if (!player || owner.autoplayAttempted || document.hidden || identity.current.forcePause) return;
    owner.autoplayAttempted = true;
    try { player.mute(); player.playVideo(); } catch { /* UFI Play remains available. */ }
  }

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!enabled || !host || !/^[\w-]{11}$/.test(String(videoId || ''))) return undefined;
    const owner = { host, mediaKey, videoId, player: null, ready: false, cancelled: false,
      autoplayAttempted: document.hidden };
    binding.current = owner;
    // The confirmed API starts this active clip muted once. The frame itself
    // cannot independently restart playback after a chrome or visibility pause.
    const frame = createYouTubePlayerFrame(host, videoId, { autoplay: 0, controls: 0, mute: 1 }, identity.current.title);
    let poll;
    loadYouTubeIframeApi().then(YT => {
      if (!owns(owner)) return;
      if (!YT?.Player) { setSnapshot({ owner, playback: { ...EMPTY_PLAYBACK, failed: true } }); return; }
      try {
        owner.player = new YT.Player(frame, {
          events: {
            onReady: event => {
              if (!owns(owner)) return;
              owner.player = event.target; owner.ready = true;
              startAutoplay(owner);
              read(owner);
              window.clearInterval(poll);
              poll = window.setInterval(() => { if (!document.hidden) read(owner); }, 250);
            },
            onStateChange: () => read(owner),
            onPlaybackRateChange: () => read(owner),
            onApiChange: () => read(owner),
            onError: () => {
              if (!owns(owner)) return;
              owner.ready = false;
              window.clearInterval(poll);
              setSnapshot({ owner, playback: { ...EMPTY_PLAYBACK, failed: true } });
            },
          },
        });
      } catch { if (owns(owner)) setSnapshot({ owner, playback: { ...EMPTY_PLAYBACK, failed: true } }); }
    }).catch(() => { if (owns(owner)) setSnapshot({ owner, playback: { ...EMPTY_PLAYBACK, failed: true } }); });
    return () => {
      owner.cancelled = true;
      window.clearInterval(poll);
      if (binding.current === owner) binding.current = null;
      try { owner.player?.destroy(); } catch { /* The frame may already have left the document. */ }
      host.replaceChildren();
    };
  }, [enabled, mediaKey, videoId]);

  useEffect(() => {
    const pauseBlocked = () => {
      const owner = binding.current, player = currentPlayer(owner);
      if (owns(owner) && document.hidden) owner.autoplayAttempted = true;
      if (!player) return;
      try {
        if (document.hidden || identity.current.forcePause) player.pauseVideo();
        else startAutoplay(owner);
        read(owner);
      } catch {}
    };
    pauseBlocked();
    document.addEventListener('visibilitychange', pauseBlocked);
    return () => document.removeEventListener('visibilitychange', pauseBlocked);
  }, [forcePause, enabled, mediaKey, videoId]);

  const togglePlay = () => {
    if (identity.current.mediaKey !== mediaKey || identity.current.videoId !== videoId
      || identity.current.forcePause || document.hidden) return;
    const owner = binding.current, player = currentPlayer(owner);
    if (!player) return;
    owner.autoplayAttempted = true;
    try {
      const state = player.getPlayerState();
      if (state === 1 || state === 3) player.pauseVideo(); else player.playVideo();
      read(owner);
    } catch { /* Do not optimistically claim that playback changed. */ }
  };
  const toggleMute = () => {
    if (identity.current.mediaKey !== mediaKey || identity.current.videoId !== videoId) return;
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
    if (identity.current.mediaKey !== mediaKey || identity.current.videoId !== videoId
      || identity.current.forcePause || document.hidden) return;
    const owner = binding.current, player = currentPlayer(owner);
    if (!player || !Number.isFinite(seconds)) return;
    try {
      const duration = player.getDuration();
      if (!Number.isFinite(duration) || duration <= 0) return;
      // seekTo starts unstarted/cued players. Cue the requested position
      // instead, preserving a paused or blocked autoplay attempt.
      const state = player.getPlayerState();
      const target = Math.max(0, Math.min(duration, seconds));
      if (state === -1 || state === 5) player.cueVideoById?.({ videoId: owner.videoId, startSeconds: target });
      else player.seekTo(target, true);
      read(owner);
    } catch { /* Seeking cannot claim a position the player did not accept. */ }
  };

  const setPlaybackRate = rate => {
    if (identity.current.mediaKey !== mediaKey || identity.current.videoId !== videoId) return false;
    const owner = binding.current, player = currentPlayer(owner);
    if (!player || !Number.isFinite(rate) || !readSettings(player).rates.includes(rate)) return false;
    try { player.setPlaybackRate(rate); read(owner); return true; } catch { read(owner); return false; }
  };
  const setCaptionFontSize = size => {
    if (identity.current.mediaKey !== mediaKey || identity.current.videoId !== videoId) return false;
    const owner = binding.current, player = currentPlayer(owner);
    if (!player || !Number.isInteger(size) || size < -1 || size > 3 || readSettings(player).captionFontSize === null) return false;
    try { player.setOption('captions', 'fontSize', size); read(owner); return true; } catch { read(owner); return false; }
  };

  const playback = snapshot && owns(snapshot.owner) && (snapshot.playback.failed || currentPlayer(snapshot.owner))
    ? snapshot.playback : EMPTY_PLAYBACK;
  return { hostRef, ...playback, togglePlay, toggleMute, seek, setPlaybackRate, setCaptionFontSize };
}
