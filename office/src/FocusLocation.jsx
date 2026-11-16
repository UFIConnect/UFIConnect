import { useId } from 'react';
import { Navigation } from 'lucide-react';
import FocusGlobe from './FocusGlobe';
import { coordinateLabel } from './focus-studio-model.mjs';

export function locationTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function BackgroundLocation({ feature, checked, onChange }) {
  const description = useId();
  return <>
    <label className="focus-check">
      <input type="checkbox" checked={checked} aria-describedby={description} onChange={event => onChange(event.target.checked)} />
      Background {feature}
    </label>
    <p className="focus-footnote focus-location-background" id={description}>
      Stay active as you switch Office views. Updates pause when the tab is hidden or the screen locks. Closing Office ends the session.
    </p>
  </>;
}

export default function FocusLocation({ tracking, background, onBackgroundChange }) {
  const { active, error, fix, refreshing, visible } = tracking;
  let status = 'Geo Tracking off';
  if (active) {
    if (!visible) status = 'Geo Tracking paused while this browser tab is hidden';
    else status = fix ? 'Receiving live location' : 'Waiting for your device’s location…';
  }

  return <section className="focus-card" aria-labelledby="focus-location-title">
    <div className="focus-card-heading">
      <span className="focus-icon"><Navigation size={18} aria-hidden="true" /></span>
      <h2 id="focus-location-title">Live location</h2>
    </div>
    <div className="focus-grid">
      <div>
        <div className="focus-zone-status" role="status">
          <span className="focus-dot" data-location={fix ? 'inside' : undefined} />
          <span>{status}</span>
        </div>
        {fix && <p className="focus-location-reading">
          <strong>{coordinateLabel(fix)}</strong>
          <small>Device accuracy ±{Math.ceil(fix.accuracy)} m · Updated <time dateTime={new Date(fix.timestamp).toISOString()}>
            {locationTime(fix.timestamp)}
          </time></small>
        </p>}
        {error && <p className="focus-error" role="alert">{error}</p>}
        <div className="focus-actions focus-monitor-actions">
          <button type="button" className={active ? 'focus-button' : 'focus-button focus-primary'}
            onClick={active ? tracking.stop : tracking.start}>{active ? 'Stop Geo Tracking' : 'Start Geo Tracking'}</button>
          <button type="button" className="focus-button" disabled={!active || !visible || refreshing} onClick={tracking.refresh}>
            {refreshing ? 'Checking location…' : 'Refresh live location'}
          </button>
        </div>
        <BackgroundLocation feature="Geo Tracking" checked={background} onChange={onBackgroundChange} />
        <p className="focus-footnote">Live coordinates stay in this browser.</p>
      </div>
      <FocusGlobe deviceFix={fix} />
    </div>
  </section>;
}
