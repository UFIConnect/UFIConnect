import { useEffect, useState } from 'react';
import FocusNumberInput from './FocusNumberInput';
import { clockText } from './focus-studio-model.mjs';
import {
  downloadFocusFile, exportTrip, locationLength, locationSpeed, MAX_ROUTE_POINTS,
  recentTrips, redactTrip, ROUTE_FORMATS, routeStats, TRIP_RETENTION_DAYS,
} from './focus-tracking.mjs';

const LENGTH_OPTIONS = [{ value: 0, label: 'Whole trip' }, { value: 250, label: 'Hide points within 250 m of each end' },
  { value: 1000, label: 'Hide points within 1 km of each end' }];

export function TripSummary({ points, units }) {
  if (!points.length) return null;
  const stats = routeStats(points);
  const average = stats.movingMs ? stats.distance / (stats.movingMs / 1000) : null;
  const pace = stats.movingMs && stats.distance ? stats.movingMs * (units === 'imperial' ? 1609.344 : 1000) / stats.distance / 1000 : null;
  return <dl className="focus-location-metrics">
    <div><dt>Distance</dt><dd>{locationLength(stats.distance, units, { large: true })}</dd></div>
    <div><dt>Recorded time</dt><dd>{clockText(stats.durationMs / 1000)}</dd></div>
    <div><dt>Moving</dt><dd>{clockText(stats.movingMs / 1000)}</dd></div>
    <div><dt>Stopped</dt><dd>{clockText((stats.durationMs - stats.movingMs) / 1000)}</dd></div>
    {average !== null && <div><dt>Average moving speed</dt><dd>{locationSpeed(average, units)}</dd></div>}
    {stats.peak !== null && <div><dt>Peak device speed</dt><dd>{locationSpeed(stats.peak, units)}</dd></div>}
    {pace !== null && <div><dt>Moving pace</dt><dd>{clockText(pace)} / {units === 'imperial' ? 'mi' : 'km'}</dd></div>}
    {stats.climb !== null && <div><dt>Elevation gain</dt><dd>{locationLength(stats.climb, units)}</dd></div>}
  </dl>;
}

export default function FocusTrips({ tracking, preferences, onChange, onPreview, sectionRef, trips, onSave }) {
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [mark, setMark] = useState('');
  const [markNote, setMarkNote] = useState('');
  const [compareId, setCompareId] = useState('');
  const [format, setFormat] = useState('gpx');
  const [redact, setRedact] = useState(0);
  const [customRedact, setCustomRedact] = useState(500);
  const [first, setFirst] = useState(1);
  const [last, setLast] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [replay, setReplay] = useState(null);
  const [playing, setPlaying] = useState(false);
  const selected = trips.find(trip => trip.id === selectedId);
  const compare = trips.find(trip => trip.id === compareId && trip.id !== selectedId);
  const current = { name: name.trim() || 'Office trip', points: tracking.points, waypoints: tracking.waypoints };
  const viewed = selected ?? current;
  const trimmed = selected && first <= last && last <= selected.points.length ? selected.points.slice(first - 1, last) : null;
  const filtered = trips.filter(trip => (trip.name + ' ' + new Date(trip.savedAt).toLocaleDateString()).toLowerCase().includes(search.trim().toLowerCase()));

  function persist(next, notice) {
    if (onSave(next)) {
      setError('');
      setMessage(notice);
      return true;
    }
    setError('This device could not save the trip. You can export it instead.');
    return false;
  }

  useEffect(() => {
    const fresh = recentTrips(trips, preferences.retentionDays);
    if (fresh.length === trips.length) return;
    persist(fresh, 'Expired trips cleared.');
  }, [trips, preferences.retentionDays]);
  useEffect(() => {
    if (!preferences.retentionDays) return undefined;
    const timer = window.setInterval(() => {
      const fresh = recentTrips(trips, preferences.retentionDays);
      if (fresh.length !== trips.length) persist(fresh, 'Expired trips cleared.');
    }, 3600000);
    return () => window.clearInterval(timer);
  }, [trips, preferences.retentionDays]);

  useEffect(() => {
    if (replay === null) return;
    const playback = { points: viewed.points, waypoints: viewed.waypoints, cursor: viewed.points[replay] };
    onPreview(playback);
  }, [replay, viewed.points, viewed.waypoints, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  useEffect(() => {
    if (!playing || replay === null) return undefined;
    if (replay >= viewed.points.length - 1) {
      setPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setReplay(replay + 1), 450);
    return () => window.clearTimeout(timer);
  }, [playing, replay, viewed.points.length]);

  function selectTrip(id) {
    setSelectedId(id);
    const trip = trips.find(item => item.id === id);
    setName(trip?.name ?? '');
    setFirst(1);
    setLast(trip?.points.length ?? 0);
    setReplay(id && trip?.points.length ? 0 : null);
    setPlaying(false);
    if (!id || !trip?.points.length) onPreview(null);
    setMessage('');
    setError('');
  }

  function saveTrip() {
    const trip = { ...current, id: crypto.randomUUID(), savedAt: Date.now() };
    persist(recentTrips([trip, ...trips], preferences.retentionDays), 'Trip saved on this device.');
  }

  function updateTrip() {
    const points = trimmed ?? selected.points;
    const start = points[0]?.timestamp, end = points.at(-1)?.timestamp;
    const waypoints = trimmed ? selected.waypoints.filter(point => point.timestamp >= start && point.timestamp <= end) : selected.waypoints;
    const saved = persist(trips.map(trip => trip.id === selectedId ? { ...trip, name: name.trim() || trip.name, points, waypoints } : trip),
      'Saved trip updated.');
    if (!saved) return;
    setReplay(points.length ? 0 : null);
    setPlaying(false);
    setFirst(1);
    setLast(points.length);
  }

  function download() {
    const safe = redactTrip(viewed.points, viewed.waypoints, redact < 0 ? customRedact : redact);
    if (!safe.points.length && !safe.waypoints.length) {
      setMessage('');
      setError('No points remain for this export. Choose a smaller exclusion or a different trip.');
      return;
    }
    const extension = format === 'geojson' ? 'geojson' : format;
    const { data, mime } = exportTrip(format, { ...safe, name: viewed.name });
    downloadFocusFile(data, 'office-trip.' + extension, mime);
    setError('');
    setMessage('Trip exported.');
  }

  const samples = viewed.points.length;
  return <details className="focus-advanced focus-trips" ref={sectionRef}>
    <summary>Routes and trip history</summary>
    <div className="focus-advanced-body">
      <div className="focus-actions">
        <button type="button" className="focus-button" aria-pressed={tracking.recording} disabled={!tracking.active}
          onClick={tracking.toggleRecording}>{tracking.recording ? 'Stop recording route' : 'Record route'}</button>
        <button type="button" className="focus-button" disabled={!tracking.points.length && !tracking.waypoints.length}
          onClick={() => { tracking.clearRoute(); if (!selected) { setReplay(null); setPlaying(false); onPreview(null); } }}>
          Clear current recording
        </button>
      </div>
      <p className="focus-footnote">Recordings keep the latest {MAX_ROUTE_POINTS} samples. Saving a trip keeps it on this device.</p>
      <form className="focus-option-grid" onSubmit={event => {
        event.preventDefault();
        if (tracking.addWaypoint(mark, markNote)) {
          setMark(''); setMarkNote(''); setError(''); setMessage('Waypoint added to the current recording.');
        }
        else setError('Get a fresh location reading to add a waypoint.');
      }}>
        <label className="focus-select">Waypoint name
          <input value={mark} maxLength={80} onChange={event => setMark(event.target.value)} />
        </label>
        <label className="focus-select">Waypoint note
          <input value={markNote} maxLength={160} onChange={event => setMarkNote(event.target.value)} />
        </label>
        <button className="focus-button" type="submit" disabled={!tracking.fix}>Save this location as a waypoint</button>
      </form>
      {trips.length > 0 && <div className="focus-option-grid">
        <label className="focus-select">Find saved trips
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
        <label className="focus-select">View trip
          <select value={selectedId} onChange={event => selectTrip(event.target.value)}>
            <option value="">Current recording</option>
            {trips.filter(trip => trip.id === selectedId || filtered.includes(trip)).map(trip =>
              <option key={trip.id} value={trip.id}>{trip.name} · {new Date(trip.savedAt).toLocaleDateString()}</option>)}
          </select>
        </label>
      </div>}
      <label className="focus-select">Trip name
        <input value={name} maxLength={80} onChange={event => setName(event.target.value)} />
      </label>
      <div className="focus-zone-activity-heading">
        <strong>{selected?.name ?? 'Current recording'}</strong>
        <span className="focus-footnote">{samples} samples · {viewed.waypoints.length} waypoints</span>
      </div>
      <TripSummary points={viewed.points} units={preferences.units} />
      {selected && trips.length > 1 && <label className="focus-select">Compare with another saved trip
        <select value={compare?.id ?? ''} onChange={event => setCompareId(event.target.value)}>
          <option value="">No comparison</option>
          {trips.filter(trip => trip.id !== selectedId).map(trip => <option key={trip.id} value={trip.id}>{trip.name}</option>)}
        </select>
      </label>}
      {selected && compare && <div>
        <strong>{compare.name}</strong>
        <TripSummary points={compare.points} units={preferences.units} />
      </div>}
      {viewed.waypoints.length > 0 && <ul className="focus-zone-events" aria-label="Waypoints">
        {viewed.waypoints.map((point, index) => <li key={point.id ?? index}>
          <span>{point.name || 'Waypoint ' + (index + 1)}{point.note && ' · ' + point.note}</span>
          <time dateTime={new Date(point.timestamp).toISOString()}>{new Date(point.timestamp).toLocaleTimeString()}</time>
        </li>)}
      </ul>}
      {samples > 0 && <div className="focus-route-playback">
        <label className="focus-slider">
          <span>Replay position</span><output>{replay !== null ? replay + 1 : 'Live'} / {samples}</output>
          <input type="range" min="0" max={samples - 1} value={replay ?? 0}
            onChange={event => { setPlaying(false); setReplay(Number(event.target.value)); }} />
        </label>
        <div className="focus-actions">
          <button className="focus-button" type="button" onClick={() => {
            if (playing) { setPlaying(false); return; }
            if (replay === null || replay >= samples - 1) setReplay(0);
            setPlaying(true);
          }}>{playing ? 'Pause replay' : 'Play route'}</button>
          {replay !== null && <button className="focus-button" type="button" onClick={() => {
            setReplay(null); setPlaying(false); onPreview(null);
          }}>Return to live map</button>}
        </div>
      </div>}
      {selected && samples > 1 && <div className="focus-option-grid">
        <label className="focus-select">Keep from sample
          <FocusNumberInput min={1} max={samples} value={first} onChange={setFirst} />
        </label>
        <label className="focus-select">Keep through sample
          <FocusNumberInput min={1} max={samples} value={last} onChange={setLast} />
        </label>
      </div>}
      <div className="focus-actions">
        {selected ? <>
          <button type="button" className="focus-button" disabled={samples > 1 && !trimmed} onClick={updateTrip}>Update saved trip</button>
          <button type="button" className="focus-button" onClick={() => {
            if (persist(trips.filter(trip => trip.id !== selectedId), 'Trip deleted.')) {
              selectTrip('');
              setMessage('Trip deleted.');
            }
          }}>Delete trip</button>
        </> : <button type="button" className="focus-button" disabled={!samples && !viewed.waypoints.length} onClick={saveTrip}>
          Save trip on this device
        </button>}
      </div>
      <div className="focus-option-grid">
        <label className="focus-select">Export format
          <select value={format} onChange={event => setFormat(event.target.value)}>
            {ROUTE_FORMATS.map(value => <option key={value} value={value}>{value === 'geojson' ? 'GeoJSON' : value.toUpperCase()}</option>)}
          </select>
        </label>
        <label className="focus-select">Export privacy
          <select value={redact} onChange={event => setRedact(Number(event.target.value))}>
            {LENGTH_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            <option value={-1}>Custom exclusion distance</option>
          </select>
        </label>
        {redact < 0 && <label className="focus-select">Hide points near each end (meters)
          <FocusNumberInput value={customRedact} min={1} max={20000} onChange={setCustomRedact} />
        </label>}
      </div>
      <div className="focus-actions">
        <button type="button" className="focus-button" disabled={!samples && !viewed.waypoints.length} onClick={download}>Export trip</button>
      </div>
      <div className="focus-option-grid">
        <label className="focus-select">Keep saved trips
          <select value={preferences.retentionDays} onChange={event => onChange({ retentionDays: Number(event.target.value) })}>
            {TRIP_RETENTION_DAYS.map(days => <option key={days} value={days}>{days === 0 ? 'Until I delete them' : days + (days === 1 ? ' day' : ' days')}</option>)}
          </select>
        </label>
        <button className="focus-button" type="button" disabled={!trips.length} onClick={() => {
          if (persist([], 'Saved trips cleared.')) {
            selectTrip('');
            setMessage('Saved trips cleared.');
          }
        }}>Clear saved trips</button>
      </div>
      {message && <p role="status" className="focus-feedback">{message}</p>}
      {error && <p role="alert" className="focus-error">{error}</p>}
    </div>
  </details>;
}
