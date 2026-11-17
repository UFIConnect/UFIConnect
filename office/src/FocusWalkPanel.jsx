import { useEffect, useMemo, useRef, useState } from 'react';
import { Footprints, MapPin } from 'lucide-react';
import { coordinateLabel } from './focus-studio-model.mjs';
import { locationLength, routeStats } from './focus-tracking.mjs';
import { reviewWalk } from './focus-walk.mjs';

const SIGNALS = {
  accuracy: 'Waiting for a more accurate GPS reading. Try moving into an open area.',
  start: 'Walk to the dropped pin, or start from your GPS location.',
  rejoin: 'Return to the last recorded point to continue the boundary.',
  hidden: 'Walk paused while Focus Studio was out of view.',
  limit: 'This walk reached its recording limit. Review the recorded part below.',
};

export default function FocusWalkPanel({ walk, mode, units, onSave, saveBlocked, gpsPin }) {
  const state = walk.state?.mode === mode ? walk.state : null;
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const startButton = useRef(null);
  const boundary = mode === 'boundary';
  const label = boundary ? 'Walk a boundary' : 'Walk a route';
  const points = state?.points;
  const reviewing = state?.phase === 'review';
  const result = useMemo(() => reviewing ? reviewWalk({ mode, points }) : null, [mode, points, reviewing]);
  const stats = useMemo(() => points?.length ? routeStats(points) : null, [points]);
  const ready = state?.phase === 'ready';
  const walking = state?.phase === 'walking';
  const paused = state?.phase === 'paused';
  const canResetPin = state?.pin && (ready || walking && !points.length);
  const signal = SIGNALS[state?.signal];
  useEffect(() => {
    if (!ready || !startButton.current?.getClientRects().length) return;
    startButton.current.focus({ preventScroll: true });
    startButton.current.scrollIntoView({ block: 'nearest' });
  }, [ready]);

  function save() {
    const outcome = onSave(result, name.trim() || 'Walk');
    if (outcome !== false) setName('');
    setMessage(outcome === false ? 'This device could not save the walk. Your recording is still here.' : '');
  }

  return <section className="focus-walk" aria-label={label}>
    <div className="focus-walk-heading">
      <span className="focus-icon"><Footprints size={17} aria-hidden="true" /></span>
      <div>
        <h3>{label}</h3>
        <p>{boundary ? 'Trace the edge of an area and return to where you started.' : 'Record the path you walk and save it as a trip.'}</p>
      </div>
      {!state && <button type="button" className="focus-button" onClick={() => walk.open(mode)}>
        {walk.state ? 'Open current walk' : label}
      </button>}
    </div>
    {state && <div className="focus-walk-body">
      {ready && <p className="focus-footnote">Place an optional start pin on the map or at your location.</p>}
      {state.pin && <p className="focus-walk-pin"><MapPin size={15} aria-hidden="true" />Start pin <span>{coordinateLabel(state.pin)}</span></p>}
      <p className="focus-walk-progress" role="status">
        {ready ? 'Ready to start' : walking ? points.length ? 'Recording walk' : 'Finding your start' : paused ? 'Walk paused' : 'Review your walk'}
        {stats && <span>{points.length} {points.length === 1 ? 'point' : 'points'} · {locationLength(stats.distance, units)}</span>}
      </p>
      {(signal || result?.error) && <p className="focus-footnote" role="status">{result?.error ?? signal}</p>}
      {(gpsPin.error || walk.error || message) && <p className="focus-error" role="alert">{gpsPin.error || walk.error || message}</p>}
      {reviewing && result && !result.error && (boundary
        ? <p className="focus-footnote">{result.vertices.length} boundary points. Use the outline to open the zone editor.</p>
        : <label className="focus-select">Walk name<input value={name} placeholder="Walk" maxLength={80}
          onChange={event => setName(event.target.value)} /></label>)}
      {saveBlocked && reviewing && !result?.error && <p className="focus-footnote">{saveBlocked}</p>}
      <div className="focus-actions">
        {(ready || paused || reviewing && state.signal !== 'limit') && <button type="button"
          className={reviewing ? 'focus-button' : 'focus-button focus-primary'} onClick={walk.resume} ref={startButton}>
          {ready ? 'Start walk' : 'Resume walk'}
        </button>}
        {ready && <button type="button" className="focus-button" disabled={gpsPin.capturing} onClick={() => gpsPin.locate(walk.setPin)}>
          <MapPin size={15} aria-hidden="true" />{gpsPin.capturing ? 'Finding your location…' : 'Drop start at my location'}
        </button>}
        {canResetPin && <button type="button" className="focus-button" onClick={() => { gpsPin.cancel(); walk.setPin(null); }}>Use GPS start</button>}
        {walking && <button type="button" className="focus-button" onClick={walk.pause}>Pause walk</button>}
        {(walking || paused) && <button type="button" className="focus-button focus-primary"
          disabled={!points.length} onClick={walk.finish}>Finish walk</button>}
        {reviewing && result && !result.error && <button type="button" className="focus-button focus-primary"
          disabled={Boolean(saveBlocked)} onClick={save}>{boundary ? 'Use as zone' : 'Save walk'}</button>}
        <button type="button" className="focus-button" onClick={() => { setMessage(''); setName(''); walk.discard(); }}>Discard walk</button>
      </div>
    </div>}
  </section>;
}
