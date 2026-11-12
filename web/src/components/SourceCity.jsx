import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { CITY_CATEGORIES } from '../local/localWorkspace';
import { CITY_NATURE } from '../local/cityNature';
import { SOURCE_META } from './sourceMeta';
import { Link } from 'react-router-dom';
import { CITY_LANDMARKS } from '../local/cityEngineering.mjs';
import { useResolvedAppearance } from '../preferences/useResolvedAppearance';
import DriveControls from './DriveControls';
import './maps-workspace.css';
const Scene = lazy(() => import('./MapCityScene'));

export default function SourceCity({ cities, enabled, active, onSelect, onCivicSelect, counts, houseSummaries = {}, actions, sources, activeSource, onSourceSelect, requestedLandmark = '' }) {
  const [fallback, setFallback] = useState(false), [reset, setReset] = useState(0), [page, setPage] = useState(0);
  const [overview, setOverview] = useState(true);
  const [viewMode, setViewMode] = useState('plan');
  const timeOfDay = useResolvedAppearance() === 'dark' ? 'night' : 'day';
  const [altitude, setAltitude] = useState(100);
  const [focusLandmark, setFocusLandmark] = useState(requestedLandmark);
  const cityHeading = useRef(null), returnFocus = useRef(false);
  const [motion, setMotion] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'paused' : 'full');
  const [intensity, setIntensity] = useState('full');
  const [quality, setQuality] = useState(() => globalThis.matchMedia?.('(min-width: 769px) and (pointer: fine)').matches ? 'maximum' : 'auto');
  const [driveMode, setDriveMode] = useState(false), [drivePaused, setDrivePaused] = useState(false);
  const [driveDestination, setDriveDestination] = useState(active), [driveArrival, setDriveArrival] = useState('');
  const [driveViaFreeway, setDriveViaFreeway] = useState(false);
  const [driveInput, setDriveInput] = useState({ throttle: false, brake: false });
  const [driveSkipRequest, setDriveSkipRequest] = useState(0);
  const [driveRouteReset, setDriveRouteReset] = useState(0);
  const [driveTurnRequest, setDriveTurnRequest] = useState({ id: 0, direction: 0 });
  const [driveStatus, setDriveStatus] = useState({ status: 'driving', signal: null });
  const requestDriveTurn = useCallback(direction => {
    setDriveTurnRequest(previous => ({ id: previous.id + 1, direction }));
  }, []);
  const receiveDriveStatus = useCallback(update => {
    const status = ['driving', 'turning', 'traffic', 'crosswalk', 'red-light', 'paused', 'arrived', 'accident', 'braking', 'reversing'].includes(update?.status) ? update.status : 'driving';
    const signal = ['red', 'yellow', 'green'].includes(update?.signal) ? update.signal : null;
    const accidentCount = Math.max(0, Number(update?.accidentCount) || 0);
    const pendingTurn = [-1, 1].includes(update?.pendingTurn) ? update.pendingTurn : 0;
    const turnUnavailable = Boolean(update?.turnUnavailable);
    const streetLabel = typeof update?.streetLabel === 'string' ? update.streetLabel : '';
    const freeway = update?.freeway || '';
    if (status !== 'arrived') setDriveArrival('');
    // Render only meaningful changes; speed and following distance belong to
    // the simulation and do not need to redraw the surrounding map controls.
    setDriveStatus(previous => previous.status === status && previous.signal === signal && previous.accidentCount === accidentCount
      && previous.pendingTurn === pendingTurn && previous.turnUnavailable === turnUnavailable && previous.streetLabel === streetLabel && previous.freeway === freeway
      ? previous : { status, signal, accidentCount, pendingTurn, turnUnavailable, streetLabel, freeway });
  }, []);
  const destinations = [...cities, ...CITY_LANDMARKS];
  const birdViewActive = overview && viewMode === 'plan' && !focusLandmark && !driveMode;
  const destinationLabel = id => destinations.find(item => item.id === id)?.label || id;
  const arrivedLandmark = CITY_LANDMARKS.find(item => item.id === driveArrival);
  const drivingMessage = driveStatus.status === 'accident' ? 'Accident reported · ' + (drivePaused ? 'Drive paused' : 'Continuing in 4 seconds')
    : driveArrival ? 'Arrived at ' + destinationLabel(driveArrival)
    : drivePaused ? 'Drive paused'
    : driveStatus.status === 'braking' ? 'Braking'
    : driveStatus.status === 'reversing' ? 'Reversing'
    : driveStatus.status === 'red-light' ? 'Waiting at traffic light'
    : driveStatus.status === 'crosswalk' ? 'Waiting for pedestrians'
    : driveStatus.status === 'traffic' ? 'Following traffic'
    : driveStatus.status === 'turning' ? 'Slowing for turn'
    : 'Driving to ' + destinationLabel(driveDestination);
  const turnMessage = driveStatus.pendingTurn ? (driveStatus.pendingTurn < 0 ? 'Turn left' : 'Turn right')
    + (driveStatus.streetLabel ? ' onto ' + driveStatus.streetLabel : ' at the next junction')
    : driveStatus.turnUnavailable ? 'No matching turn ahead' : '';
  const category = CITY_CATEGORIES.find(item => item.id === active) || CITY_CATEGORIES[0];
  const theme = CITY_NATURE[active];
  const pages = Math.max(1, Math.ceil(sources.length / 12));
  useEffect(() => { setPage(0); setFallback(false); }, [active, overview]);
  useEffect(() => {
    setFocusLandmark(requestedLandmark);
    if (requestedLandmark) { setOverview(true); setDriveMode(false); setDriveDestination(requestedLandmark); }
  }, [requestedLandmark]);
  useEffect(() => {
    if (overview && returnFocus.current) {
      cityHeading.current?.focus({ preventScroll: true });
      returnFocus.current = false;
    }
  }, [overview]);
  useEffect(() => { const index = sources.indexOf(activeSource); if (index >= 0) setPage(Math.floor(index / 12)); }, [activeSource, sources.join(',')]);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => { if (preference.matches) setMotion('paused'); };
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);
  const currentPage = Math.min(page, pages - 1);
  const visible = sources.slice(currentPage * 12, (currentPage + 1) * 12);
  function openCity(id, source) { setAltitude(100); setFocusLandmark(''); setDriveMode(false); setOverview(false); onSelect(id); if (source) onSourceSelect(source); }
  function showAllCities() {
    setFocusLandmark('');
    if (overview) { cityHeading.current?.focus({ preventScroll: true }); return; }
    returnFocus.current = true;
    setOverview(true);
  }
  function resetDriveControls() {
    setDriveRouteReset(value => value + 1);
    setDrivePaused(false);
    setDriveArrival('');
    setDriveStatus({ status: 'driving', signal: null });
  }
  return <section ref={cityHeading} tabIndex={-1} className="map-city-card" aria-label="Source city">
    {actions && <div className="map-actions-toolbar">{actions}</div>}
    <div className="map-scene-toolbar">
      {!overview && <button type="button" className="map-back-to-all" onClick={showAllCities}>← Back to all cities</button>}
      <span className="map-motion-status"><i className={motion === 'paused' ? '' : 'is-moving'} />{motion === 'paused' ? 'Motion paused' : 'City animation'}</span>
      <label>Motion<select aria-label="Animation intensity" value={intensity} onChange={event => { setIntensity(event.target.value); setMotion(event.target.value); }}><option value="full">Full</option><option value="calm">Calm</option></select></label>
      <label>Rendering<select aria-label="Rendering quality" value={quality} onChange={event => { setQuality(event.target.value); setDriveMode(false); }}><option value="maximum">Maximum detail</option><option value="auto">Automatic</option></select></label>
      <button type="button" onClick={() => setMotion(motion === 'paused' ? intensity : 'paused')}>{motion === 'paused' ? 'Play animation' : 'Pause animation'}</button>
      <button type="button" onClick={() => { setAltitude(100); setFallback(false); setReset(value => value + 1); }}>{fallback ? 'Retry 3D map' : 'Reset view'}</button>
      {overview && <button type="button" aria-pressed={birdViewActive} onClick={() => { setViewMode(birdViewActive ? 'perspective' : 'plan'); setFocusLandmark(''); setDriveMode(false); }}>Bird’s-eye view</button>}
      <label>Altitude<input type="range" aria-label="View altitude" min="35" max="180" step="5" value={altitude} disabled={driveMode} onChange={event => setAltitude(Number(event.target.value))} /><output aria-live="off">{altitude}%</output></label>
      <button type="button" aria-pressed={driveMode} disabled={fallback} title={fallback ? 'Drive mode requires the 3D map.' : undefined} onClick={() => { setOverview(true); setDriveMode(value => !value); setDrivePaused(false); setDriveArrival(''); setDriveStatus({ status: 'driving', signal: null }); }}>{driveMode ? 'Exit drive mode' : 'Drive mode'}</button>
    </div>
    {driveMode && <div className="map-drive-controls" role="group" aria-label="Drive between cities">
      <label>Destination<select aria-label="Drive destination" value={driveDestination} onChange={event => { setDriveDestination(event.target.value); resetDriveControls(); }}>{destinations.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Route<select aria-label="Drive route" value={driveViaFreeway ? 'freeway' : 'streets'} onChange={event => { setDriveViaFreeway(event.target.value === 'freeway'); resetDriveControls(); }}><option value="streets">City streets</option><option value="freeway">Via freeway</option></select></label>
      <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(driveArrival)} onClick={() => setDrivePaused(value => !value)}>{drivePaused ? 'Resume drive' : 'Pause drive'}</button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(driveArrival)} title="Skip the drive and arrive at your destination" onClick={() => { setDriveInput({ throttle: false, brake: false }); setDriveSkipRequest(value => value + 1); }}>Skip drive</button>
      <div className="map-drive-status"><span role="status" aria-live="polite" aria-atomic="true">{drivingMessage}{turnMessage && <span className="map-drive-turn-status">{turnMessage}</span>}</span>
        <small>{driveStatus.freeway && driveStatus.freeway + ' · '}{driveArrival || !drivePaused && driveStatus.status === 'driving' ? 'Traffic simulation' : 'To ' + destinationLabel(driveDestination) + ' · Traffic simulation'}{driveStatus.accidentCount > 0 ? ' · ' + driveStatus.accidentCount + ' simulated accident' + (driveStatus.accidentCount === 1 ? '' : 's') + ' reported' : ''}</small></div>
      {driveStatus.signal && !driveArrival && <span className="map-drive-signal" data-signal={driveStatus.signal} aria-label={'Traffic light: ' + (driveStatus.signal === 'yellow' ? 'amber' : driveStatus.signal)}><i aria-hidden="true" />{driveStatus.signal === 'yellow' ? 'Amber light' : driveStatus.signal === 'red' ? 'Red light' : 'Green light'}</span>}
      {driveArrival && (arrivedLandmark
        ? <Link className="btn btn-primary btn-sm" to={arrivedLandmark.to}>{arrivedLandmark.id === 'airport' ? 'Open Travel' : 'Open Shop'}</Link>
        : <button type="button" className="btn btn-primary btn-sm" onClick={() => openCity(driveArrival)}>Enter city</button>)}
      <DriveControls disabled={Boolean(driveArrival) || drivePaused || driveStatus.status === 'accident'} resetKey={driveRouteReset + ':' + driveSkipRequest + ':' + reset} pendingTurn={driveStatus.pendingTurn} onInput={setDriveInput} onTurn={requestDriveTurn} />
    </div>}
    {fallback ? <p className="card">3D is unavailable on this device. Use the city, building, and source buttons below to explore.</p> : <Suspense fallback={<div className="map-city-scene">Opening your city…</div>}>
      <Scene overview={overview} viewMode={viewMode} timeOfDay={timeOfDay} altitude={altitude} focusLandmark={focusLandmark} cities={cities} motion={motion} quality={quality}
        homes={visible.map(id => ({ id, label: SOURCE_META[id]?.label || id, summary: (houseSummaries[id] || []).map(item => item.topic).slice(0, 2).join(' · ') }))}
        theme={theme} cityId={active} title={category.label} selected={activeSource} onSelect={onSourceSelect}
        driving={driveMode} drivePaused={drivePaused} driveDestination={driveDestination} driveViaFreeway={driveViaFreeway} driveInput={driveInput} driveSkipRequest={driveSkipRequest} driveTurnRequest={driveTurnRequest} onDriveStatus={receiveDriveStatus} onDriveArrival={setDriveArrival} onDriveDestinationChange={setDriveDestination}
        onCitySelect={openCity} onCivicSelect={onCivicSelect} resetKey={reset} onFallback={() => { setFallback(true); setDriveMode(false); setDrivePaused(false); }} />
    </Suspense>}
    <div className="map-city-picker" role="group" aria-label="Choose your city">
      <button type="button" className="map-all-cities" aria-pressed={overview} onClick={showAllCities} style={{ '--city-color': '#5879a5' }}><i aria-hidden="true" /><span>All<small>16 cities + UFI downtown</small></span></button>
      {CITY_CATEGORIES.map(item => <button type="button" key={item.id} aria-pressed={!overview && item.id === active} onClick={() => openCity(item.id)} style={{ '--city-color': CITY_NATURE[item.id].leaves }}><i aria-hidden="true" /><span>{item.label}<small>{enabled.includes(item.id) ? CITY_NATURE[item.id].name : 'Not in your app yet'}</small></span></button>)}
    </div>
    {!overview && <div className="map-houses" aria-label="Open a source house">{visible.map(id => <button key={id} type="button" aria-pressed={activeSource === id} onClick={() => onSourceSelect(id)}><strong>{SOURCE_META[id]?.label || id}</strong><span>{counts[id] || 0} posts loaded · {(houseSummaries[id] || []).length} selected topics</span><span className="map-house-topic-list">{(houseSummaries[id] || []).length ? houseSummaries[id].map(item => <small key={item.topic}>{item.topic} · {item.loaded} / {item.target} posts</small>) : 'Open house to add topics'}</span></button>)}</div>}
    {!overview && pages > 1 && <nav className="map-options-pagination" aria-label="Source neighborhoods"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}
  </section>;
}
