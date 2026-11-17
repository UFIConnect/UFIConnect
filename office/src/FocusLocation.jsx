import { useId, useRef, useState } from 'react';
import { Navigation } from 'lucide-react';
import FocusGlobe from './FocusGlobe';
import FocusNumberInput from './FocusNumberInput';
import FocusTrips from './FocusTrips';
import FocusWalkPanel from './FocusWalkPanel';
import { coordinateLabel } from './focus-studio-model.mjs';
import {
  LOCATION_INTERVALS, locationLength, locationSpeed, readTrips, recentTrips,
  TRACKING_FIELDS, TRACKING_PROFILES, trackingProfile, TRIP_STORAGE_KEY,
} from './focus-tracking.mjs';

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

const SETTINGS_FIELDS = [
  ['minSeconds', 'Seconds between recorded samples'],
  ['minMeters', 'Minimum movement to record (m)'],
  ['stopMinutes', 'Stop after (minutes)'],
  ['stopMeters', 'Stop at distance (m)'],
  ['speedLimit', 'Speed alert (km/h)'],
  ['timeoutSeconds', 'Wait for a reading (seconds)'],
];
const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function TrackingPreferences({ preferences, onChange, onProfile, sectionRef }) {
  const profile = trackingProfile(preferences);
  return <details className="focus-advanced" ref={sectionRef}>
    <summary>Geo Tracking settings</summary>
    <div className="focus-advanced-body">
      <div className="focus-option-grid">
        <label className="focus-select">Tracking accuracy
          <select value={preferences.profile} onChange={event => onProfile(event.target.value)}>
            {Object.entries(TRACKING_PROFILES).map(([id, value]) => <option key={id} value={id}>{value.label}</option>)}
          </select>
        </label>
        <label className="focus-select">Request a fresh reading
          <select value={preferences.interval} onChange={event => onChange({ interval: Number(event.target.value) })}>
            {LOCATION_INTERVALS.map(seconds => <option key={seconds} value={seconds}>{seconds ? 'Every ' + seconds + ' seconds' : 'On movement only'}</option>)}
          </select>
        </label>
        <label className="focus-select">Display units
          <select value={preferences.units} onChange={event => onChange({ units: event.target.value })}>
            <option value="metric">Metric</option><option value="imperial">Imperial</option>
          </select>
        </label>
        {preferences.profile === 'custom' && <>
          <label className="focus-select">Maximum recording uncertainty (m)
            <FocusNumberInput {...TRACKING_FIELDS.maxAccuracy} value={preferences.custom.maxAccuracy}
              onChange={maxAccuracy => onChange({ custom: { ...preferences.custom, maxAccuracy } })} />
          </label>
          <label className="focus-check"><input type="checkbox" checked={preferences.custom.highAccuracy}
            onChange={event => onChange({ custom: { ...preferences.custom, highAccuracy: event.target.checked } })} />Request high accuracy</label>
        </>}
        {SETTINGS_FIELDS.map(([field, label]) => <label className="focus-select" key={field}>{label}
          <FocusNumberInput {...TRACKING_FIELDS[field]} value={preferences[field]} onChange={value => onChange({ [field]: value })} />
        </label>)}
      </div>
      <p className="focus-footnote">Recording accepts readings within ±{profile.maxAccuracy} m. Set stop limits or the speed alert to 0 to disable them. The time limit applies to your next start.</p>
    </div>
  </details>;
}

export default function FocusLocation({ tracking, preferences, onChange, onProfile, walk, map }) {
  const { active, error, fix, refreshing, visible, paused, capturing } = tracking;
  const [copyStatus, setCopyStatus] = useState('');
  const [playback, setPlayback] = useState(null);
  const [trips, setTrips] = useState(readTrips);
  const [walkSaved, setWalkSaved] = useState('');
  const settingsRef = useRef(null);
  const tripsRef = useRef(null);
  const routeWalk = walk.state?.mode === 'route' ? walk.state : null;

  function persistTrips(next) {
    try {
      localStorage.setItem(TRIP_STORAGE_KEY, JSON.stringify(next));
      setTrips(next);
      return true;
    } catch { return false; }
  }

  function saveWalk({ points }, name) {
    const trip = { name, points, waypoints: [], id: crypto.randomUUID(), savedAt: Date.now() };
    if (!persistTrips(recentTrips([trip, ...trips], preferences.retentionDays))) return false;
    walk.discard();
    setWalkSaved(name + ' saved to Trip library.');
    return true;
  }

  function openPanel(ref) {
    const panel = ref.current;
    panel.open = true;
    panel.querySelector('summary').focus();
    panel.scrollIntoView({ block: 'start' });
  }
  let status = fix ? 'Single location reading' : 'Geo Tracking off';
  if (active) {
    if (paused) status = 'Geo Tracking paused';
    else if (!visible) status = 'Geo Tracking paused while this browser tab is hidden';
    else status = fix ? 'Receiving live location' : 'Waiting for your device’s location…';
  }
  const lowAccuracy = fix && fix.accuracy > trackingProfile(preferences).maxAccuracy;
  const speedAlert = active && !paused && fix?.speed != null && preferences.speedLimit > 0
    && fix.speed * 3.6 > preferences.speedLimit;
  async function copyLocation() {
    try {
      await navigator.clipboard.writeText(fix.latitude.toFixed(6) + ', ' + fix.longitude.toFixed(6));
      setCopyStatus('Coordinates copied.');
    } catch { setCopyStatus('Copy is unavailable. Select the displayed coordinates to copy them.'); }
  }

  return <section className="focus-card" aria-labelledby="focus-location-title">
    <div className="focus-card-heading">
      <span className="focus-icon"><Navigation size={18} aria-hidden="true" /></span>
      <h2 id="focus-location-title">Live location</h2>
    </div>
    <nav className="focus-jump" aria-label="Geo Tracking shortcuts">
      <button type="button" className="focus-button" onClick={() => openPanel(settingsRef)}>Tracking settings</button>
      <button type="button" className="focus-button" onClick={() => openPanel(tripsRef)}>Trip library</button>
    </nav>
    <div className="focus-grid">
      <div>
        <div className="focus-zone-status" role="status">
          <span className="focus-dot" data-location={fix ? lowAccuracy ? 'weak' : 'inside' : undefined} />
          <span>{status}</span>
        </div>
        {fix && <>
          <p className="focus-location-reading">
            <strong>{coordinateLabel(fix)}</strong>
            <small>Device accuracy ±{locationLength(Math.ceil(fix.accuracy), preferences.units)} · Updated <time dateTime={new Date(fix.timestamp).toISOString()}>
              {locationTime(fix.timestamp)}
            </time></small>
          </p>
          <dl className="focus-location-metrics">
            {fix.speed != null && <div><dt>Speed</dt><dd>{locationSpeed(fix.speed, preferences.units)}</dd></div>}
            {fix.heading != null && <div><dt>Heading</dt><dd>{Math.round(fix.heading)}° {DIRECTIONS[Math.round(fix.heading / 45) % 8]}</dd></div>}
            {fix.altitude != null && <div><dt>Altitude</dt><dd>{locationLength(fix.altitude, preferences.units)}{fix.altitudeAccuracy != null
              && ' ±' + locationLength(fix.altitudeAccuracy, preferences.units)}</dd></div>}
            {active && <div><dt>Tracked distance</dt><dd>{locationLength(tracking.distance, preferences.units, { large: true })}</dd></div>}
            {active && tracking.deadline && <div><dt>Stops at</dt><dd>{locationTime(tracking.deadline)}</dd></div>}
          </dl>
        </>}
        {lowAccuracy && <p className="focus-footnote">This reading is outside the recording accuracy threshold.</p>}
        {speedAlert && <p role="status" className="focus-error">Your reported speed is above the configured limit.</p>}
        {error && <p className="focus-error" role="alert">{error}</p>}
        {tracking.notice && <p className="focus-feedback" role="status">{tracking.notice}</p>}
        <div className="focus-actions focus-monitor-actions">
          <button type="button" className={active ? 'focus-button' : 'focus-button focus-primary'}
            onClick={active ? () => tracking.stop() : () => tracking.start()}>{active ? 'Stop Geo Tracking' : 'Start Geo Tracking'}</button>
          {active && <button type="button" className="focus-button" onClick={paused ? tracking.resume : tracking.pause}>
            {paused ? 'Resume Geo Tracking' : 'Pause Geo Tracking'}
          </button>}
          <button type="button" className="focus-button" disabled={!active || paused || !visible || refreshing} onClick={tracking.refresh}>
            {refreshing ? 'Checking location…' : 'Refresh live location'}
          </button>
          <button type="button" className="focus-button" disabled={active && !paused || capturing || !visible} onClick={tracking.captureOnce}>
            {capturing ? 'Checking location…' : 'Check my location once'}
          </button>
          {fix && <button type="button" className="focus-button" onClick={copyLocation}>Copy coordinates</button>}
          {fix && (!active || paused) && <button type="button" className="focus-button" onClick={tracking.clearSnapshot}>Clear reading</button>}
        </div>
        {copyStatus && <p className="focus-feedback" role="status">{copyStatus}</p>}
        <BackgroundLocation feature="Geo Tracking" checked={preferences.background}
          onChange={background => onChange({ background })} />
        {!active && visible && <fieldset className="focus-quick-duration">
          <legend>Timed tracking session</legend>
          <div className="focus-actions">
            {[15, 30, 60].map(minutes => <button key={minutes} type="button" className="focus-button"
              aria-label={`Track for ${minutes} minutes`} onClick={() => tracking.start(minutes)}>{minutes} min</button>)}
          </div>
        </fieldset>}
        <TrackingPreferences preferences={preferences} onChange={onChange} onProfile={onProfile} sectionRef={settingsRef} />
      </div>
      <div className="focus-tracking-map">
        <FocusWalkPanel walk={walk} mode="route" units={preferences.units} onSave={saveWalk} />
        {walkSaved && !routeWalk && <p className="focus-feedback" role="status">{walkSaved}</p>}
        <FocusGlobe deviceFix={routeWalk ? walk.fix ?? fix : playback?.cursor ?? fix}
          deviceLabel={!routeWalk && playback ? 'Replay position' : 'Live device location'}
          trail={playback?.points ?? tracking.points} waypoints={playback?.waypoints ?? tracking.waypoints}
          walk={routeWalk} onPick={routeWalk?.phase === 'ready' ? walk.setPin : undefined}
          {...map} />
        <FocusTrips sectionRef={tripsRef} tracking={tracking} preferences={preferences} onChange={onChange}
          onPreview={setPlayback} trips={trips} onSave={persistTrips} />
      </div>
    </div>
  </section>;
}
