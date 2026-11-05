import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Pause, Play } from 'lucide-react';
import { SoundIcon } from './videoMedia';
import './MediaPlaybackControls.css';

export function playbackTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—:—';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const tail = String(total % 60).padStart(2, '0');
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${tail}` : `${minutes}:${tail}`;
}

// This row stays outside the scrolling caption and never fades on idle.
// Each surface supplies its actual player state and supported operations.
export default function MediaPlaybackControls({ paused, muted, currentTime, duration, onTogglePlay, onToggleMute, onSeek, onFullScreen, fullScreen, showFullscreen = true, disabled = false, label = 'video', mediaKey }) {
  const row = useRef(null);
  const expandedTarget = useRef(null);
  const [expanded, setExpanded] = useState(false), [fullscreenError, setFullscreenError] = useState('');
  useEffect(() => {
    const changed = () => setExpanded(Boolean(document.fullscreenElement?.contains(row.current)));
    document.addEventListener('fullscreenchange', changed);
    const escape = event => {
      if (event.key === 'Escape' && expandedTarget.current) {
        expandedTarget.current.removeAttribute('data-ufi-fullscreen'); expandedTarget.current = null; setExpanded(false);
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('fullscreenchange', changed); document.removeEventListener('keydown', escape);
      expandedTarget.current?.removeAttribute('data-ufi-fullscreen');
    };
  }, []);
  async function toggleFullscreen() {
    setFullscreenError('');
    if (onFullScreen) { await onFullScreen(); return; }
    let target = row.current?.parentElement;
    while (target && target !== document.body && !target.querySelector('video, iframe')) target = target.parentElement;
    if (!target || target === document.body) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (expandedTarget.current) {
        expandedTarget.current.removeAttribute('data-ufi-fullscreen'); expandedTarget.current = null; setExpanded(false);
      }
      else if (target.requestFullscreen && document.fullscreenEnabled) await target.requestFullscreen();
      else if (target.querySelector('video')?.webkitEnterFullscreen) target.querySelector('video').webkitEnterFullscreen();
      else { target.setAttribute('data-ufi-fullscreen', 'true'); expandedTarget.current = target; setExpanded(true); }
    } catch { setFullscreenError('Fullscreen could not open. Please try again.'); }
  }
  const end = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const position = Math.max(0, Math.min(end, Number.isFinite(currentTime) ? currentTime : 0));
  const [seekState, setSeekState] = useState(null);
  const seekTimer = useRef(null), gesture = useRef(null);
  const seekDraft = seekState?.mediaKey === mediaKey ? seekState : null;
  useEffect(() => () => clearTimeout(seekTimer.current), []);
  useEffect(() => { clearTimeout(seekTimer.current); gesture.current = null; setSeekState(null); }, [mediaKey, disabled]);
  useEffect(() => {
    if (seekDraft && (disabled || !end || (seekDraft.mode === 'pending' && Math.abs(position - seekDraft.seconds) < .5))) {
      clearTimeout(seekTimer.current);
      setSeekState(null);
    }
  }, [position, seekDraft, disabled, end]);
  const cursor = seekDraft === null ? position : Math.max(0, Math.min(end, seekDraft.seconds));
  const commitSeek = seconds => {
    if (disabled || !end || !onSeek || !Number.isFinite(seconds)) return;
    const target = Math.max(0, Math.min(end, seconds));
    clearTimeout(seekTimer.current);
    setSeekState({ mediaKey, seconds: target, mode: 'pending' });
    // A provider may confirm asynchronously or reject the command. Only the
    // final pointer position is sent; keyboard changes remain immediate.
    seekTimer.current = setTimeout(() => setSeekState(current => current?.mediaKey === mediaKey && current.mode === 'pending' ? null : current), 1500);
    onSeek(target);
  };
  const seek = event => {
    const seconds = Number(event.target.value);
    if (disabled || !end || !onSeek || !Number.isFinite(seconds)) return;
    if (gesture.current?.mediaKey === mediaKey) setSeekState({ mediaKey, seconds, mode: 'dragging' });
    else commitSeek(seconds);
  };
  const beginSeek = event => {
    if (disabled || !end || !onSeek || event.button !== 0) return;
    clearTimeout(seekTimer.current);
    gesture.current = { mediaKey, pointerId: event.pointerId };
    setSeekState({ mediaKey, seconds: Number(event.currentTarget.value), mode: 'dragging' });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const finishSeek = (event, cancelled = false) => {
    const owner = gesture.current;
    if (!owner || owner.mediaKey !== mediaKey || owner.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (cancelled) setSeekState(null);
    else commitSeek(Number(event.currentTarget.value));
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const playLabel = `${paused ? 'Play' : 'Pause'} ${label}`;
  const soundLabel = `${muted ? 'Unmute' : 'Mute'} ${label}`;
  return <div ref={row} className="media-playback-controls" role="group" aria-label="Playback controls">
    <button type="button" aria-label={playLabel} title={playLabel} onClick={onTogglePlay} disabled={disabled || !onTogglePlay}>
      {paused ? <Play size={19} aria-hidden="true" /> : <Pause size={19} aria-hidden="true" />}
    </button>
    <button type="button" aria-label={soundLabel} title={soundLabel} onClick={onToggleMute} disabled={disabled || !onToggleMute}>
      <SoundIcon muted={muted} size={20} />
    </button>
    <input type="range" min="0" max={end || 1} step="0.1" value={cursor}
      aria-label="Video progress" aria-valuetext={`${playbackTime(cursor)} of ${playbackTime(end || NaN)}`}
      disabled={disabled || !end || !onSeek} onChange={seek} onPointerDown={beginSeek}
      onPointerUp={finishSeek} onPointerCancel={event => finishSeek(event, true)} onLostPointerCapture={event => finishSeek(event, true)} />
    <span className="media-playback-time" aria-label="Playback time">{playbackTime(seekDraft ? cursor : currentTime)} / {playbackTime(end || NaN)}</span>
    {showFullscreen && <button type="button" aria-label={(fullScreen ?? expanded) ? 'Exit full screen' : 'Full screen'} title={(fullScreen ?? expanded) ? 'Exit full screen' : 'Full screen'} onClick={toggleFullscreen} disabled={disabled}>
      {(fullScreen ?? expanded) ? <Minimize size={19} aria-hidden="true" /> : <Maximize size={19} aria-hidden="true" />}
    </button>}
    {showFullscreen && fullscreenError && <span className="media-fullscreen-error" role="status">{fullscreenError}</span>}
  </div>;
}
