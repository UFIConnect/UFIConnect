import { useEffect, useId, useRef, useState } from 'react';
import { Crosshair, MapPin, Navigation } from 'lucide-react';
import FocusGlobe from './FocusGlobe';
import FocusNumberInput from './FocusNumberInput';
import FocusSavedPins from './FocusSavedPins';
import FocusTrips from './FocusTrips';
import FocusWalkPanel from './FocusWalkPanel';
import FocusTrackingDetails from './FocusTrackingDetails';
import { coordinateLabel } from './focus-studio-model.mjs';
import useFocusPinLocation from './useFocusPinLocation';
import { MAX_FIX_AGE_MS } from './focus-geofence.mjs';
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
        <label className="focus-check"><input type="checkbox" checked={preferences.recoverSignal}
          onChange={event => onChange({ recoverSignal: event.target.checked })} />Automatic GPS recovery</label>
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
      <fieldset className="focus-stop-options"><legend>Optional automatic stops</legend>
        <label className="focus-check"><input type="checkbox" checked={preferences.timeStop}
          onChange={event => onChange({ timeStop: event.target.checked })} />Enable time stop</label>
        <label className="focus-select">Stop after (minutes)
          <FocusNumberInput {...TRACKING_FIELDS.stopMinutes} value={preferences.stopMinutes} disabled={!preferences.timeStop}
            onChange={stopMinutes => onChange({ stopMinutes })} /></label>
        <label className="focus-check"><input type="checkbox" checked={preferences.distanceStop}
          onChange={event => onChange({ distanceStop: event.target.checked })} />Enable distance stop</label>
        <label className="focus-select">Stop at distance (m)
          <FocusNumberInput {...TRACKING_FIELDS.stopMeters} value={preferences.stopMeters} disabled={!preferences.distanceStop}
            onChange={stopMeters => onChange({ stopMeters })} /></label>
      </fieldset>
      <p className="focus-footnote">Stop limits are off by default. Enabling a limit applies to the next start; switching it off removes that stop from the active session. Timed shortcuts set a separate time limit. Recording accepts readings within ±{profile.maxAccuracy} m.</p>
    </div>
  </details>;
}

export default function FocusLocation({ tracking, preferences, onChange, onProfile, allowViewBackground, walk, map,
  pinTools, pickingPin, setPickingPin, devices }) {
  const { pins, activeIds, add, save, activate, remove, onPhone, paused: geofencingPaused } = pinTools;
  const { active, error, fix, refreshing, visible, paused, capturing } = tracking;
  const [copyStatus, setCopyStatus] = useState('');
  const [playback, setPlayback] = useState(null);
  const [trips, setTrips] = useState(readTrips);
  const [walkSaved, setWalkSaved] = useState('');
  const [locateCenter, setLocateCenter] = useState(null);
  const [followRequest, setFollowRequest] = useState(0);
  const [waitingForDrop, setWaitingForDrop] = useState(false);
  const [dropStatus, setDropStatus] = useState('');
  const settingsRef = useRef(null);
  const tripsRef = useRef(null);
  const pinButton = useRef(null);
  const routeWalk = walk.state?.mode === 'route' ? walk.state : null;
  const gpsPin = useFocusPinLocation(routeWalk?.phase ?? 'map');

  function saveTrackingPin(point) {
    add(point);
    tracking.addWaypoint('Tracking pin', 'Dropped from an accepted live GPS reading.', point);
    tracking.recordDiagnostic('MOVING_PIN_DROPPED', 'A pin and route waypoint were saved from an accepted GPS reading. Moving tracking continues.');
    setFollowRequest(current => current + 1);
    setWaitingForDrop(false);
    setDropStatus('Pin dropped. Your live route continues while you move.');
  }

  useEffect(() => {
    if (!waitingForDrop) return;
    if (!tracking.active || routeWalk) {
      setWaitingForDrop(false);
      setDropStatus('No pin was saved before tracking stopped or a guided walk opened.');
    } else if (tracking.liveFix && Date.now() - tracking.liveFix.timestamp < MAX_FIX_AGE_MS) {
      saveTrackingPin(tracking.liveFix);
    }
  }, [waitingForDrop, tracking.active, tracking.liveFix, routeWalk]);

  function dropAndTrack() {
    if (!tracking.startContinuous()) return;
    gpsPin.cancel();
    setPlayback(null);
    setPickingPin(false);
    if (tracking.liveFix && Date.now() - tracking.liveFix.timestamp < MAX_FIX_AGE_MS) saveTrackingPin(tracking.liveFix);
    else {
      setWaitingForDrop(true);
      setDropStatus('Moving tracking started. Waiting for an accepted live GPS reading before dropping the pin.');
    }
  }

  useEffect(() => {
    if (!pickingPin || routeWalk || !pinButton.current) return;
    pinButton.current.focus({ preventScroll: true });
    pinButton.current.scrollIntoView({ block: 'nearest' });
  }, [pickingPin, routeWalk]);

  function placePin(point) {
    gpsPin.cancel();
    if (routeWalk) walk.setPin(point);
    else add(point);
  }

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
    else status = fix ? 'Receiving live location' : tracking.recovering ? 'Tracking active · recovering GPS signal'
      : tracking.lastAcceptedAt ? 'Tracking active · waiting for a fresh GPS reading' : 'Waiting for your device’s location…';
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
    <div className="focus-grid focus-tracking-layout">
      <div className="focus-tracking-controls">
        <div className="focus-tracking-status">
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
        {tracking.signalNotice && <p className="focus-feedback" role="status">{tracking.signalNotice}</p>}
        {speedAlert && <p role="status" className="focus-error">Your reported speed is above the configured limit.</p>}
        {error && <p className="focus-error" role="alert">{error}</p>}
        {tracking.notice && <p className="focus-feedback" role="status">{tracking.notice}</p>}
        {tracking.continuous && <p className="focus-footnote">Continuous tracking · no automatic stops · stays on across Office views.</p>}
        <div className="focus-actions focus-monitor-actions">
          <button type="button" className={active ? 'focus-button' : 'focus-button focus-primary'}
            onClick={active ? () => tracking.stop() : () => tracking.start()}>{active ? 'Stop Geo Tracking' : 'Start Geo Tracking'}</button>
          {active && <button type="button" className="focus-button" onClick={paused ? tracking.resume : tracking.pause}>
            {paused ? 'Resume Geo Tracking' : 'Pause Geo Tracking'}
          </button>}
        </div>
        {tracking.diagnostics.wakeSupported && <label className="focus-check focus-awake-control"><input type="checkbox"
          checked={tracking.diagnostics.keepAwake} disabled={!active}
          onChange={event => tracking.diagnostics.setKeepAwake(event.target.checked)} />Keep tracking screen awake</label>}
        <p className="focus-footnote">Keep Office visible for browser GPS. A locked screen or another app can suspend updates; your session resumes when Office is visible again.</p>
        </div>
        <div className="focus-tracking-options">
        <details className="focus-advanced"><summary>More tracking actions</summary><div className="focus-advanced-body focus-actions">
          <button type="button" className="focus-button" disabled={!visible || tracking.continuous && !paused}
            onClick={tracking.startContinuous}>{tracking.continuous ? paused ? 'Resume moving tracking' : 'Continuous moving mode on' : 'Track while moving'}</button>
          <button type="button" className="focus-button" disabled={!active || paused || !visible || refreshing} onClick={tracking.refresh}>
            {refreshing ? 'Checking location…' : 'Refresh live location'}
          </button>
          <button type="button" className="focus-button" disabled={active && !paused || capturing || !visible} onClick={tracking.captureOnce}>
            {capturing ? 'Checking location…' : 'Check my location once'}
          </button>
          {fix && <button type="button" className="focus-button" onClick={copyLocation}>Copy coordinates</button>}
          {fix && (!active || paused) && <button type="button" className="focus-button" onClick={tracking.clearSnapshot}>Clear reading</button>}
        </div></details>
        {copyStatus && <p className="focus-feedback" role="status">{copyStatus}</p>}
        {!tracking.continuous && allowViewBackground && <BackgroundLocation feature="Geo Tracking" checked={preferences.background}
          onChange={background => onChange({ background })} />}
        {!active && visible && <details className="focus-advanced"><summary>Start a timed session</summary><fieldset className="focus-quick-duration">
          <legend>Timed tracking session</legend>
          <div className="focus-actions">
            {[15, 30, 60].map(minutes => <button key={minutes} type="button" className="focus-button"
              aria-label={`Track for ${minutes} minutes`} onClick={() => tracking.start(minutes)}>{minutes} min</button>)}
          </div>
        </fieldset></details>}
        <TrackingPreferences preferences={preferences} onChange={onChange} onProfile={onProfile} sectionRef={settingsRef} />
        <FocusTrackingDetails tracking={tracking} preferences={preferences} devices={devices} />
        </div>
      </div>
      <div className="focus-tracking-map">
        {!routeWalk && <>
          <div className="focus-actions focus-tracking-pin-actions" role="group" aria-label="Location pin">
            <button type="button" className="focus-button focus-primary" disabled={!visible || waitingForDrop}
              onClick={dropAndTrack}><MapPin size={16} aria-hidden="true" />{waitingForDrop ? 'Waiting to drop pin…' : 'Drop & Track'}</button>
            <button type="button" className="focus-button" ref={pinButton} aria-pressed={pickingPin} onClick={() => setPickingPin(!pickingPin)}>
              <MapPin size={16} aria-hidden="true" />Drop pin on map
            </button>
            <button type="button" className="focus-button" disabled={gpsPin.capturing} onClick={() => {
              if (tracking.liveFix && Date.now() - tracking.liveFix.timestamp < MAX_FIX_AGE_MS) {
                placePin(tracking.liveFix);
                setFollowRequest(current => current + 1);
              } else gpsPin.locate(point => { placePin(point); setLocateCenter(point); });
            }}>
              <Crosshair size={16} aria-hidden="true" />{gpsPin.capturing ? 'Finding your location…' : 'Drop at my location'}
            </button>
          </div>
          {pickingPin && <p className="focus-footnote">Tap the map to place the pin.</p>}
          {gpsPin.error && <p className="focus-error" role="alert">{gpsPin.error}</p>}
          {dropStatus && <p className="focus-feedback" role="status">{dropStatus}</p>}
        </>}
        <FocusWalkPanel walk={walk} mode="route" units={preferences.units} onSave={saveWalk} gpsPin={gpsPin} />
        {walkSaved && !routeWalk && <p className="focus-feedback" role="status">{walkSaved}</p>}
        <FocusGlobe deviceFix={routeWalk ? walk.fix ?? fix : playback?.cursor ?? fix}
          deviceLabel={!routeWalk && playback ? 'Replay position' : 'Live device location'}
          trail={playback?.points ?? tracking.points} waypoints={playback?.waypoints ?? tracking.waypoints}
          walk={routeWalk} savedPins={routeWalk ? undefined : pins} activePinIds={activeIds} locateCenter={locateCenter}
          preserveFollowOnPin={active && !paused && !playback && !routeWalk} followRequest={followRequest}
          onPick={(routeWalk ? routeWalk.phase === 'ready' : pickingPin) ? placePin : undefined}
          {...map} />
        {!routeWalk && <FocusSavedPins pins={pins} activeIds={activeIds} onPhone={onPhone} paused={geofencingPaused}
          onLocate={pin => setLocateCenter({ ...pin.center, radius: pin.radius })} onSave={save} onActivate={activate}
          onRemove={id => {
            gpsPin.cancel();
            remove(id);
            pinButton.current.focus({ preventScroll: true });
          }} />}
        <FocusTrips sectionRef={tripsRef} tracking={tracking} preferences={preferences} onChange={onChange}
          onPreview={setPlayback} trips={trips} onSave={persistTrips} />
      </div>
    </div>
  </section>;
}
