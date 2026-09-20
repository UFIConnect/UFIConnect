import './VideoDurationControl.css';

export const VIDEO_DURATION_LIMIT = 300;
export function formatVideoDuration(value) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 4) return 'Choose length';
  const minutes = Math.floor(seconds / 60), remaining = seconds % 60;
  return [minutes ? `${minutes} min` : '', remaining ? `${remaining} sec` : ''].filter(Boolean).join(' ');
}

export default function VideoDurationControl({ value, onChange, disabled = false }) {
  const seconds = Number(value);
  const valid = Number.isInteger(seconds) && seconds >= 4 && seconds <= VIDEO_DURATION_LIMIT;
  return <details className="video-duration-control">
    <summary><span>Duration</span><strong>{formatVideoDuration(value)}</strong><span aria-hidden="true">⌄</span></summary>
    <div className="video-duration-options">
      <label htmlFor="studio-video-duration">Video length in seconds</label>
      <div className="video-duration-input">
        <input id="studio-video-duration" type="number" min={4} max={VIDEO_DURATION_LIMIT} step={1}
          value={value} onChange={event => onChange(event.target.value)} disabled={disabled}
          aria-describedby="studio-duration-help studio-duration-lock" aria-invalid={!valid} required />
        <span>{valid ? formatVideoDuration(value) : '4–300 seconds'}</span>
      </div>
      <input type="range" aria-label="Adjust video duration" min={4} max={VIDEO_DURATION_LIMIT} step={1}
          value={valid ? seconds : 4} onChange={event => onChange(Number(event.target.value))} disabled={disabled}
          aria-valuetext={formatVideoDuration(valid ? seconds : 4)} />
      <div className="video-duration-scale"><span>4 sec</span><span>5 min</span></div>
      <p id="studio-duration-help">Choose any length up to 5 minutes.</p>
      <div id="studio-duration-lock" className="video-duration-lock">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
        <span>Longer videos, up to 30 minutes, are locked for now.</span>
      </div>
      {!valid && <p role="alert" className="video-duration-error">{seconds > VIDEO_DURATION_LIMIT ? 'The current limit is 5 minutes. Longer videos are locked.' : 'Enter a whole number from 4 to 300 seconds.'}</p>}
    </div>
  </details>;
}
