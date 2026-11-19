import { useRef, useState } from 'react';
import FocusGlobe from './FocusGlobe';
import FocusTrackingDetails from './FocusTrackingDetails';
import FocusLivePins from './FocusLivePins';
import { LOCAL_PIN_SOURCE } from './focus-live-pins.mjs';
import { locationTime } from './FocusLocation';
import { EMPTY_PLACE, FocusAddresses, FocusRoutePlanner, placeWithCoordinates } from './FocusLivePlanning';
import { coordinateLabel } from './focus-studio-model.mjs';
import { locationLength, locationSpeed } from './focus-tracking.mjs';
import {
  directionsLink, gridVisitors, GRID_STEPS, liveMovementFix, MESSAGE_EVENTS, messageRule, movementProfile, normalizePhone,
  PROFILE_LIMIT, REPEAT_MINUTES, RULE_LIMIT, SOURCE_TYPES, VEHICLE_TYPES,
} from './focus-movement.mjs';

const VIEWS = [['route', 'Routes'], ['places', 'Addresses'], ['profiles', 'Vehicles & devices'], ['grid', 'Grid'], ['messages', 'Messages']];
const GRID_LABELS = { detail: 'Detail (0.001°)', neighborhood: 'Neighborhood (0.01°)', district: 'District (0.1°)' };
const DEFAULT_PROFILE = { name: '', kind: 'vehicle', type: 'sedan', phone: '' };
const kindLabel = item => item.kind === 'vehicle' ? VEHICLE_TYPES[item.type].label : SOURCE_TYPES[item.kind];

function LiveSourceControls({ tools, tracking, devices, profile }) {
  const { state, fix, selectSource, remote } = tools;
  const [sharingName, setSharingName] = useState('Office phone');
  return <div className="focus-ops-source">
    <div className="focus-ops-fields">
      <label className="focus-select">Live tracking source
        <select value={state.sourceId} onChange={event => selectSource(event.target.value)}>
          <option value="">This device</option>
          {state.sourceId && !remote && <option value={state.sourceId}>Selected device (waiting)</option>}
          {devices.sources.map(item => <option key={item.id} value={item.id}>{item.name} · {kindLabel(item)}</option>)}
        </select>
      </label>
      <p className="focus-ops-signal" role="status">
        {fix ? <><strong>{state.sourceId && devices.viewError ? 'Last shared GPS · connection delayed' : remote?.signalNotice ? 'Last accepted shared GPS' : !state.sourceId && tracking.signalNotice ? 'Last accepted GPS' : 'GPS live'}</strong><span>{locationTime(fix.timestamp)} · ±{Math.ceil(fix.accuracy)} m</span></> :
          <><strong>{state.sourceId ? 'Waiting for shared GPS' : tracking.active && !tracking.paused ? 'Waiting for GPS' : 'Live GPS off'}</strong>
            {tracking.paused && !state.sourceId && <span>Geo Tracking paused</span>}</>}
      </p>
    </div>
    <div className="focus-actions">
      {!state.sourceId && <button className="focus-button focus-primary" type="button" onClick={
        tracking.paused ? tracking.resume : tracking.active ? () => tracking.stop() : () => tracking.start()}>
        {tracking.paused ? 'Resume live GPS' : tracking.active ? 'Stop live GPS' : 'Start live GPS'}
      </button>}
      {!state.sourceId && <button className="focus-button" type="button" disabled={tracking.continuous && tracking.recording && !tracking.paused}
        onClick={tracking.startContinuous}>{tracking.continuous && tracking.recording
          ? tracking.paused ? 'Resume moving tracking' : 'Continuous moving mode on' : 'Track while moving'}</button>}
      {devices.available && <button className="focus-button" type="button" aria-pressed={devices.viewing} onClick={() => {
        if (devices.viewing) {
          if (state.sourceId) selectSource('');
          devices.stopViewing();
        } else devices.startViewing();
      }}>{devices.viewing ? `Stop viewing shared devices (${devices.sources.length})` : 'View shared devices'}</button>}
      {devices.available && <button className="focus-button" type="button" aria-pressed={Boolean(devices.sharing)}
        disabled={!devices.sharing && (!devices.canShare || Boolean(state.sourceId))}
        onClick={devices.sharing ? devices.stopSharing : () => devices.share(profile ?? { name: sharingName.trim() || 'Office phone', kind: 'phone' })}>
        {devices.sharing ? 'Stop sharing my GPS' : 'Share my GPS with Office'}
      </button>}
    </div>
    {devices.available && !devices.sharing && !profile && <label className="focus-select">Your sharing label
      <input maxLength={80} value={sharingName} onChange={event => setSharingName(event.target.value)} />
    </label>}
    {devices.sharing && <p className="focus-feedback" role="status">{devices.sharing}</p>}
    {devices.viewing && !devices.sources.length && !devices.viewError && <p className="focus-footnote">
      Start live GPS on another signed-in Office device, then use Share my GPS with Office there.</p>}
    {[!state.sourceId && tracking.error, devices.viewError, devices.shareError].filter(Boolean).map(error =>
      <p key={error} role="alert" className="focus-error">{error}</p>)}
    {tracking.signalNotice && !state.sourceId && <p role="status" className="focus-feedback">{tracking.signalNotice}</p>}
    {remote?.signalNotice && <p role="status" className="focus-feedback">{remote.signalNotice}</p>}
    <FocusTrackingDetails tracking={tracking} devices={devices} />
  </div>;
}

function FleetProfiles({ tools, selected, setSelected, units }) {
  const { settings, state, fix, now, dispatch, update } = tools;
  const [draft, setDraft] = useState(DEFAULT_PROFILE);
  const [phoneSearch, setSearch] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [error, setError] = useState('');
  const vehicle = state.vehicle;
  const profile = settings.profiles.find(item => item.id === selected);
  const canTrack = profile?.kind === 'vehicle';
  const trip = (vehicle?.profile.id === selected ? vehicle : null) ?? state.trips[selected];
  const currentVehicle = vehicle?.profile.id === selected;
  const vehicleLive = currentVehicle && fix && liveMovementFix(trip?.last, now);
  const normalizedSearch = normalizePhone(phoneSearch);
  const profileList = settings.profiles.filter(item =>
    (!vehicleType || item.type === vehicleType) && (!phoneSearch.trim() || normalizedSearch && item.phone === normalizedSearch));

  function save(event) {
    event.preventDefault();
    const phone = normalizePhone(draft.phone);
    if (draft.phone.trim() && !phone) { setError('Enter the phone identifier with its country code, starting with +.'); return; }
    const profile = movementProfile({ ...draft, id: draft.id ?? crypto.randomUUID() });
    if (!profile) return;
    update({ profiles: draft.id ? settings.profiles.map(item => item.id === draft.id ? profile : item) : [...settings.profiles, profile] });
    if (!vehicle) setSelected(profile.id);
    setDraft(DEFAULT_PROFILE);
    setError('');
    setSearch('');
    setVehicleType('');
  }

  function updateParking(parking) {
    update({ profiles: settings.profiles.map(item => item.id === selected ? { ...item, parking } : item) });
  }

  return <section className="focus-ops-tool" aria-labelledby="focus-profiles-heading">
    <h3 id="focus-profiles-heading">Vehicles & devices</h3>
    <p className="focus-footnote">Link an optional phone number to identify a profile. Movement comes from the chosen live GPS source.</p>
    {settings.profiles.length > 0 && <div className="focus-ops-fields">
      <label className="focus-select">Filter by vehicle type
        <select value={vehicleType} onChange={event => setVehicleType(event.target.value)}>
          <option value="">All profiles</option>
          {Object.entries(VEHICLE_TYPES).map(([key, type]) => <option key={key} value={key}>{type.label}</option>)}
        </select>
      </label>
      <label className="focus-select">Find by phone identifier
        <input type="tel" value={phoneSearch} onChange={event => setSearch(event.target.value)} autoComplete="off" />
      </label>
    </div>}
    {settings.profiles.length > 0 && (!profileList.length ? <p className="focus-footnote">No matching profiles.</p> : <ul className="focus-ops-list">
      {profileList.map(item => <li key={item.id}>
        <div><strong>{item.name}</strong><span>{kindLabel(item)}{item.phone ? ` · Phone ending ${item.phone.slice(-4)}` : ''}</span></div>
        <div className="focus-actions">
          <button className="focus-button" type="button" disabled={Boolean(vehicle)} aria-pressed={selected === item.id}
            aria-label={`Select ${item.name}`} onClick={() => setSelected(item.id)}>{selected === item.id ? 'Selected' : 'Select'}</button>
          <button className="focus-button" type="button" disabled={vehicle?.profile.id === item.id} aria-label={`Edit ${item.name}`}
            onClick={() => { setDraft(item); setError(''); }}>Edit</button>
          <button className="focus-button" type="button" disabled={vehicle?.profile.id === item.id} aria-label={`Delete ${item.name}`}
            onClick={() => {
              if (selected === item.id) setSelected('');
              if (draft.id === item.id) setDraft(DEFAULT_PROFILE);
              update({ profiles: settings.profiles.filter(profile => profile.id !== item.id) });
            }}>Delete</button>
        </div>
      </li>)}
    </ul>)}
    {canTrack && <div className="focus-ops-vehicle">
      <h4>{profile.name} <span>{kindLabel(profile)}</span></h4>
      {trip && <dl className="focus-ops-stats" aria-label="Vehicle telemetry">
        <div><dt>Status</dt><dd>{currentVehicle ? vehicleLive ? trip.state : 'Waiting for GPS' : 'Trip ended'}</dd></div>
        <div><dt>Speed · {trip.speedSource ?? 'GPS'}</dt><dd>{vehicleLive && trip.speed != null ? locationSpeed(trip.speed, units) : '—'}</dd></div>
        <div><dt>Peak speed</dt><dd>{trip.peak != null ? locationSpeed(trip.peak, units) : '—'}</dd></div>
        <div><dt>Distance</dt><dd>{locationLength(trip.distance, units, { large: true })}</dd></div>
        <div><dt>Heading</dt><dd>{vehicleLive && Number.isFinite(trip.last.heading) ? `${Math.round(trip.last.heading) % 360}°` : '—'}</dd></div>
        <div><dt>Stops</dt><dd>{trip.stops}</dd></div>
      </dl>}
      <p className="focus-footnote">Stop detection waits {VEHICLE_TYPES[profile.type].parkSeconds} seconds of low movement.</p>
      <p className="focus-footnote">Vehicle connection: chosen GPS source only. Engine codes, fuel and vehicle battery are unavailable. The device must travel with this vehicle; stopped status is an estimate from GPS.</p>
      <div className="focus-actions">
        <button className="focus-button focus-primary" type="button" disabled={!currentVehicle && !fix}
          onClick={() => dispatch(currentVehicle ? { type: 'vehicle' } : { type: 'vehicle', profile, now: Date.now(), fix })}>
          {currentVehicle ? 'Finish vehicle trip' : 'Start vehicle trip'}
        </button>
        <button className="focus-button" type="button" disabled={!fix || fix.accuracy > 50} onClick={() => updateParking(fix)}>
          Save parking pin
        </button>
        {profile.parking && <button className="focus-button" type="button" onClick={() => updateParking(null)}>Clear parking pin</button>}
      </div>
      {profile.parking && <p className="focus-footnote">Parking pin {coordinateLabel(profile.parking)}</p>}
    </div>}
    <form className="focus-ops-form" onSubmit={save}>
      <label className="focus-select">Profile name
        <input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} maxLength={80} required />
      </label>
      <div className="focus-ops-fields">
        <label className="focus-select">Tracking type
          <select value={draft.kind} onChange={event => setDraft({ ...draft, kind: event.target.value, type: draft.type || 'sedan' })}>
            {Object.entries(SOURCE_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        {draft.kind === 'vehicle' && <label className="focus-select">Vehicle type
          <select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value })}>
            {Object.entries(VEHICLE_TYPES).map(([key, type]) => <option key={key} value={key}>{type.label}</option>)}
          </select>
        </label>}
      </div>
      <label className="focus-select">Phone identifier (optional)
        <input type="tel" value={draft.phone} onChange={event => setDraft({ ...draft, phone: event.target.value })}
          placeholder="+1 555 010 0123" maxLength={40} autoComplete="off" />
      </label>
      {error && <p className="focus-error" role="alert">{error}</p>}
      <div className="focus-actions">
        <button className="focus-button focus-primary" type="submit" disabled={!draft.id && settings.profiles.length >= PROFILE_LIMIT}>Save profile</button>
        {draft.id && <button className="focus-button" type="button" onClick={() => { setDraft(DEFAULT_PROFILE); setError(''); }}>Cancel edit</button>}
      </div>
    </form>
  </section>;
}

function MovementGrid({ tools, tracking, devices, onVisit }) {
  const { fix, settings, setGrid, state, now } = tools;
  const { grid, crossings, pendingGrid, visited, cellVisits = [] } = state.movement;
  const sources = gridVisitors(devices.viewing ? devices.sources : [], GRID_STEPS[settings.grid], now);
  const currentSources = grid ? sources.filter(source => source.cell.id === grid.id) : sources;
  return <section className="focus-ops-tool" aria-labelledby="focus-grid-heading">
    <h3 id="focus-grid-heading">Grid tracking</h3>
    <p className="focus-footnote">Grid lines follow latitude and longitude. Office confirms crossings with two GPS readings clear of the boundary.</p>
    <label className="focus-select">Grid spacing
      <select value={settings.grid} onChange={event => setGrid(event.target.value)}>
        {Object.entries(GRID_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
    <dl className="focus-ops-stats" aria-label="Grid telemetry">
      <div><dt>{fix ? 'Confirmed cell' : 'Last confirmed cell'}</dt><dd>{grid?.id ?? '—'}</dd></div>
      <div><dt>Crossings</dt><dd>{crossings}</dd></div>
      <div><dt>Recent cells visited</dt><dd>{visited.length}{visited.length === 200 && '+'}</dd></div>
      <div><dt>Shared sources {grid ? 'in selected cell' : 'available'}</dt><dd>{currentSources.filter(source => source.cell.reliable).length}</dd></div>
    </dl>
    <p className="focus-feedback" role="status">{!fix ? 'Waiting for GPS' : pendingGrid ? 'Confirming a crossing' :
      grid ? 'Watching for a crossing' : 'Waiting for a reading clear of the grid boundary'}</p>
    <h4>Grid visitors · shared devices</h4>
    <p className="focus-footnote">Only devices explicitly sharing GPS with this Office are listed. A device name is a publisher-supplied label; the person's identity is unverified. Office cannot detect other people nearby.</p>
    {!devices.viewing && <button className="focus-button" type="button" disabled={!devices.available}
      onClick={devices.startViewing}>Load shared grid visitors</button>}
    {devices.viewError && <p role="status" className="focus-footnote">Visitor data is incomplete while the Office connection is unavailable.</p>}
    {devices.viewing && !currentSources.length && <p className="focus-footnote">No fresh shared GPS observations{grid ? ' in this cell' : ''}. This does not establish that the area is empty.</p>}
    <ul className="focus-grid-visitors" aria-label="Shared grid visitors">{currentSources.map(source => <li key={source.id}>
      <h4>{source.name}</h4>
      <p className="focus-footnote">{kindLabel(source)} · Identity unverified · {source.cell.reliable ? 'GPS uncertainty fits within cell' : 'Near boundary — cell membership uncertain'}</p>
      {source.signalNotice && <p className="focus-footnote">{source.signalNotice}</p>}
      <dl className="focus-ops-stats">
        <div><dt>Sharing session</dt><dd>{source.id}</dd></div>
        {Number.isFinite(source.firstSharedAt) && <div><dt>Sharing started</dt><dd>{new Date(source.firstSharedAt).toLocaleString()}</dd></div>}
        <div><dt>Grid cell</dt><dd>{source.cell.id}</dd></div>
        <div><dt>Coordinates</dt><dd>{coordinateLabel(source.fix)}</dd></div>
        <div><dt>Accuracy</dt><dd>±{Math.ceil(source.fix.accuracy)} m</dd></div>
        <div><dt>GPS observed</dt><dd>{new Date(source.fix.timestamp).toLocaleString()} · {source.ageSeconds} s ago</dd></div>
        <div><dt>Speed · device-reported</dt><dd>{source.fix.speed == null ? 'Unavailable' : locationSpeed(source.fix.speed, 'metric')}</dd></div>
      </dl>
      <p className="focus-footnote">Source: GPS shared through the Office API. Readings expire after 25 seconds.</p>
      <div className="focus-actions">
        <button type="button" className="focus-button" onClick={() => onVisit(source.fix)}>View location on map</button>
        <button type="button" className="focus-button" onClick={() => tools.selectSource(source.id)}>Follow shared device</button>
        <a className="focus-button" href={directionsLink([source.fix], settings.mode, tracking.liveFix)} target="_blank" rel="noopener noreferrer">Directions to shared location</a>
      </div>
    </li>)}</ul>
    <details className="focus-advanced">
      <summary>Observed cell history · selected source</summary>
      <p className="focus-footnote">Up to 50 cells from this session. First and last times are accepted observations, not continuous presence. Changing source or grid spacing clears this history.</p>
      {cellVisits.length ? <ul className="focus-grid-visitors" aria-label="Observed grid cells">{cellVisits.slice(0, 10).map(visit => <li key={visit.cell.id}>
        <strong>Cell {visit.cell.id}</strong>
        <p className="focus-footnote">First observed {new Date(visit.firstAt).toLocaleString()} · Last observed {new Date(visit.lastAt).toLocaleString()} · {visit.samples} reliable readings · Last accuracy ±{Math.ceil(visit.fix.accuracy)} m</p>
        <button className="focus-button" type="button" onClick={() => onVisit(visit.fix)}>View recorded point</button>
      </li>)}</ul> : <p className="focus-footnote">No reliable cell observations yet.</p>}
    </details>
  </section>;
}

function MovementMessages({ tools }) {
  const { settings, state, dispatch, update, commandsEnabled } = tools;
  const [kind, setKind] = useState('interval');
  const [target, setTarget] = useState('');
  const [message, setMessage] = useState('');
  const [minutes, setMinutes] = useState(5);
  const [repeats, setRepeats] = useState(3);
  const locationEvent = ['arrival', 'departure', 'dwell', 'stop'].includes(kind);
  function add(event) {
    event.preventDefault();
    const rule = messageRule({ id: crypto.randomUUID(), event: kind, message, minutes, repeats,
      target: locationEvent ? target : '' });
    if (!rule) return;
    update({ rules: [...settings.rules, rule] });
    if (rule.event === 'interval' && commandsEnabled) dispatch({ type: 'timer', rule, now: Date.now() });
    setMessage('');
  }

  return <section className="focus-ops-tool" aria-labelledby="focus-message-heading">
    <h3 id="focus-message-heading">Repeat messages</h3>
    <p className="focus-footnote">Messages appear in the Office activity log while this session is open. A missed interval resumes with one message.</p>
    {!commandsEnabled && <p className="focus-feedback" role="status">Automatic commands are off. Enable them in Commands to run messages.</p>}
    <form className="focus-ops-form" onSubmit={add}>
      <div className="focus-ops-fields">
        <label className="focus-select">Message trigger
          <select value={kind} onChange={event => {
            setKind(event.target.value);
            setTarget('');
            setMinutes(event.target.value === 'interval' ? 5 : 0);
          }}>
            {Object.entries(MESSAGE_EVENTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        {locationEvent && <label className="focus-select">Address for message
          <select value={target} onChange={event => setTarget(event.target.value)}>
            <option value="">Any saved address</option>
            {settings.places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
          </select>
        </label>}
      </div>
      <label className="focus-select">Message text
        <input value={message} onChange={event => setMessage(event.target.value)} required maxLength={220} />
      </label>
      <div className="focus-ops-fields">
        <label className="focus-select">Repeat cadence
          <select value={minutes} onChange={event => setMinutes(Number(event.target.value))}>
            {kind !== 'interval' && <option value="0">Once per event</option>}
            {REPEAT_MINUTES.map(value => <option key={value} value={value}>Every {value} min</option>)}
          </select>
        </label>
        {minutes > 0 && <label className="focus-select">{kind === 'interval' ? 'Number of messages' : 'Follow-up messages'}
          <input type="number" min="1" max="20" required value={repeats} onChange={event => setRepeats(event.target.valueAsNumber || '')} />
        </label>}
      </div>
      <button className="focus-button focus-primary" type="submit" disabled={settings.rules.length >= RULE_LIMIT}>Add message</button>
    </form>
    {settings.rules.length > 0 && <ul className="focus-ops-list">
      {settings.rules.map(rule => {
        const running = state.schedule[rule.id];
        const place = settings.places.find(place => place.id === rule.target);
        return <li key={rule.id}>
          <div><strong>{rule.message}</strong><span>{MESSAGE_EVENTS[rule.event]}{place ? ` · ${place.name}` : ''}
            {rule.minutes ? ` · every ${rule.minutes} min` : ''}</span>
            {running && <span>{running.left} remaining · next {locationTime(running.at)}</span>}</div>
          <div className="focus-actions">
            <label className="focus-check"><input type="checkbox" checked={rule.enabled}
              aria-label={`Enable message ${rule.message}`} onChange={event => {
                dispatch({ type: 'cancel', id: rule.id });
                update({ rules: settings.rules.map(item => item.id === rule.id ? { ...item, enabled: event.target.checked } : item) });
              }} />Enabled</label>
            {rule.event === 'interval' && <button type="button" className="focus-button"
              disabled={!commandsEnabled || !rule.enabled}
              onClick={() => dispatch({ type: 'timer', rule, now: Date.now() })}>{running ? 'Pause timer' : 'Start timer'}</button>}
            {running && rule.event !== 'interval' && <button type="button" className="focus-button"
              onClick={() => dispatch({ type: 'cancel', id: rule.id })}>Cancel follow-ups</button>}
            <button className="focus-button" type="button" aria-label={`Remove message ${rule.message}`} onClick={() => {
              dispatch({ type: 'cancel', id: rule.id });
              update({ rules: settings.rules.filter(item => item.id !== rule.id) });
            }}>Remove</button>
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}

export default function FocusLiveTools({ tracking, tools, devices, map, units, livePins }) {
  const { fix, settings, state, remote, dispatch } = tools;
  const sourceTools = { ...tools, selectSource: id => {
    livePins.clearFollow();
    tools.selectSource(id);
  } };
  const [view, setView] = useState('route');
  const [selection, setSelection] = useState('');
  const [draft, setDraft] = useState(EMPTY_PLACE);
  const [picking, setPicking] = useState(false);
  const [streetSource, setStreetSource] = useState('');
  const [visitCenter, setVisitCenter] = useState(null);
  const [pickingLivePin, setPickingLivePin] = useState(false);
  const mapPanel = useRef(null);
  const mapOptions = state.sourceId ? { ...map, showStreets: streetSource === state.sourceId,
    setShowStreets: enabled => setStreetSource(enabled ? state.sourceId : '') } : map;
  const selected = state.vehicle?.profile.id ?? selection;
  const profile = settings.profiles.find(item => item.id === selected);
  const activeSource = state.sourceId ? remote : profile;
  const planned = settings.stops.flatMap(id => settings.places.find(place => place.id === id) ?? []);
  const plan = [
    ...([state.route?.origin ?? fix].filter(Boolean)),
    ...(state.route?.stops ?? planned).map(stop => stop.center),
  ];
  const liveSources = devices.sources.filter(source => source.id !== state.sourceId && liveMovementFix(source.fix, tools.now))
    .map(source => ({ ...source.fix, id: source.id, name: source.name }));
  const places = settings.places.map(place => ({ ...place.center, id: place.id, name: place.name }));
  if (profile?.parking) places.push({ ...profile.parking, id: 'parking', name: `${profile.name} parking pin` });
  const showingGrid = view === 'grid';
  const home = settings.places[0]?.center;

  return <section className="focus-card focus-ops" aria-labelledby="focus-live-maps">
    <div className="focus-ops-title"><h2 id="focus-live-maps">Live maps</h2></div>
    <LiveSourceControls tools={sourceTools} tracking={tracking} devices={devices} profile={profile} />
    {tools.storageError && <p className="focus-error" role="alert">Office could not save your map settings on this device.</p>}
    <div className="focus-ops-tabs" role="group" aria-label="Live map tools">
      {VIEWS.map(([id, label]) => <button className="focus-button" type="button" key={id} aria-pressed={view === id}
        onClick={() => { setView(id); setPicking(false); }}>{label}</button>)}
    </div>
    <div className="focus-ops-layout">
      <div className="focus-ops-map" ref={mapPanel}>
        <div className="focus-actions">
          <button type="button" className="focus-button" aria-pressed={pickingLivePin} onClick={() => {
            setPicking(false); setPickingLivePin(value => !value);
          }}>{pickingLivePin ? 'Cancel live pin placement' : 'Drop live pin on map'}</button>
        </div>
        {pickingLivePin && <p className="focus-footnote">Tap a live GPS marker to attach a pin. A map point without a GPS source cannot be tracked.</p>}
        <FocusGlobe deviceFix={fix} deviceLabel={activeSource ? `Live GPS · ${activeSource.name}` : 'Live device location'}
          trail={state.sourceId ? [] : tracking.points} places={places} plan={plan} liveSources={liveSources}
          deviceSourceId={state.sourceId || LOCAL_PIN_SOURCE} livePins={livePins.pins}
          followTarget={livePins.selected} followRequest={livePins.followRequest}
          onPickSource={pickingLivePin ? id => { if (livePins.attach(id)) setPickingLivePin(false); } : undefined}
          detail initialCenter={home} movementGrid={showingGrid ? GRID_STEPS[settings.grid] : undefined}
          activeCell={fix && state.movement.grid} locateCenter={visitCenter} {...mapOptions}
          onPick={pickingLivePin ? () => {} : picking && view === 'places' ? point => {
            setDraft(current => placeWithCoordinates(current, point));
            setPicking(false);
          } : undefined} />
        <FocusLivePins tools={livePins} />
      </div>
      {view === 'route' && <FocusRoutePlanner tools={tools} planned={planned} units={units} openAddresses={() => setView('places')} />}
      {view === 'places' && <FocusAddresses tools={tools} draft={draft} setDraft={setDraft} picking={picking} units={units}
        setPicking={enabled => { setPicking(enabled); setPickingLivePin(false); if (enabled) mapPanel.current?.scrollIntoView({ block: 'start' }); }} />}
      {view === 'profiles' && <FleetProfiles tools={tools} selected={selected} setSelected={setSelection} units={units} />}
      {view === 'grid' && <MovementGrid tools={sourceTools} tracking={tracking} devices={devices}
        onVisit={point => { setVisitCenter({ ...point }); mapPanel.current?.scrollIntoView({ block: 'nearest' }); }} />}
      {view === 'messages' && <MovementMessages tools={tools} />}
    </div>
    <div className="focus-ops-activity">
      <div className="focus-ops-title"><h3>Live activity</h3>
        {state.log.length > 0 && <button className="focus-button" type="button" onClick={() => dispatch({ type: 'clear-log' })}>Clear activity</button>}
      </div>
      <div role="log" aria-label="Live tracking activity">
        {state.log.length ? <ul>{state.log.map(entry => <li key={entry.id}>
          <span>{locationTime(entry.at)}</span><strong>{entry.title}</strong>
        </li>)}</ul> : <p className="focus-footnote">Address, route, grid and vehicle events will appear here.</p>}
      </div>
    </div>
  </section>;
}
