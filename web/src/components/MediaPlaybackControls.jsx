import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
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
export default function MediaPlaybackControls({ paused, muted, currentTime, duration, onTogglePlay, onToggleMute, onSeek, disabled = false, label = 'video' }) {
  const end = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const position = Math.max(0, Math.min(end, Number.isFinite(currentTime) ? currentTime : 0));
  const [seekDraft, setSeekDraft] = useState(null);
  const seekTimer = useRef(null);
  useEffect(() => () => clearTimeout(seekTimer.current), []);
  useEffect(() => {
    if (seekDraft !== null && (disabled || Math.abs(position - seekDraft) < .5)) {
      clearTimeout(seekTimer.current);
      setSeekDraft(null);
    }
  }, [position, seekDraft, disabled]);
  const cursor = seekDraft === null ? position : Math.max(0, Math.min(end, seekDraft));
  const seek = event => {
    const seconds = Number(event.target.value);
    // Provider APIs confirm seeking asynchronously. Let the thumb follow the
    // gesture immediately, then return to verified time if it is not accepted.
    clearTimeout(seekTimer.current);
    setSeekDraft(seconds);
    seekTimer.current = setTimeout(() => setSeekDraft(null), 1500);
    onSeek?.(seconds);
  };
  const playLabel = `${paused ? 'Play' : 'Pause'} ${label}`;
  const soundLabel = `${muted ? 'Unmute' : 'Mute'} ${label}`;
  return <div className="media-playback-controls" role="group" aria-label="Playback controls">
    <button type="button" aria-label={playLabel} title={playLabel} onClick={onTogglePlay} disabled={disabled || !onTogglePlay}>
      {paused ? <Play size={19} aria-hidden="true" /> : <Pause size={19} aria-hidden="true" />}
    </button>
    <button type="button" aria-label={soundLabel} title={soundLabel} onClick={onToggleMute} disabled={disabled || !onToggleMute}>
      <SoundIcon muted={muted} size={20} />
    </button>
    <input type="range" min="0" max={end || 1} step="0.1" value={cursor}
      aria-label="Video progress" aria-valuetext={`${playbackTime(cursor)} of ${playbackTime(end || NaN)}`}
      disabled={disabled || !end || !onSeek} onChange={seek} />
    <span className="media-playback-time" aria-label="Playback time">{playbackTime(currentTime)} / {playbackTime(end || NaN)}</span>
  </div>;
}
