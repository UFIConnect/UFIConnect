import { useState } from 'react';
import { measureLocation } from './focus-geofence.mjs';
import { directionsLink, movementPlace, PLACE_LIMIT, plannedDistance, pointFromFields, STOP_LIMIT } from './focus-movement.mjs';
import { locationLength } from './focus-tracking.mjs';
import { locationTime } from './FocusLocation';

export const EMPTY_PLACE = { name: '', address: '', latitude: '', longitude: '', radius: 100, dwellMinutes: 2 };

export function placeWithCoordinates(draft, point) {
  return { ...draft, latitude: point.latitude.toFixed(6), longitude: point.longitude.toFixed(6), accuracy: point.accuracy };
}

export function FocusAddresses({ tools, draft, setDraft, picking, setPicking, units }) {
  const { settings, state, fix, update } = tools;
  const locked = Boolean(state.route);
  const lookup = draft.address.trim() && 'https://www.google.com/maps/search/?' +
    new URLSearchParams({ api: '1', query: draft.address.trim() }).toString();
  function change(field, value) {
    setDraft(current => ({ ...current, [field]: value, ...(['latitude', 'longitude'].includes(field) ? { accuracy: 0 } : {}) }));
  }
  function save(event) {
    event.preventDefault();
    const point = pointFromFields(draft.latitude, draft.longitude);
    const place = movementPlace({ ...draft, id: draft.id ?? crypto.randomUUID(),
      center: point && { ...point, accuracy: draft.accuracy ?? 0 } });
    if (!place) return;
    update({ places: draft.id ? settings.places.map(item => item.id === draft.id ? place : item) : [...settings.places, place] });
    setDraft(EMPTY_PLACE);
    setPicking(false);
  }
  function edit(place) {
    setDraft(placeWithCoordinates({ ...place }, place.center));
  }
  return <section aria-labelledby="focus-address-heading" className="focus-ops-tool">
    <h3 id="focus-address-heading">Saved addresses</h3>
    <p className="focus-footnote">Pin each address on the map. Office tracks arrivals, departures, and time spent there for the live source.</p>
    {settings.places.length > 0 && <ul className="focus-ops-list">
      {settings.places.map(place => {
        const reading = fix && state.movement.places[place.id];
        const status = reading ? { inside: 'At address', edge: 'GPS overlaps boundary', outside: 'Away' }[reading.relation] : 'Waiting for GPS';
        return <li key={place.id}>
          <div><strong>{place.name}</strong>{place.address && <span>{place.address}</span>}
            <span>{status}{reading ? ` · ${locationLength(reading.distance, units, { large: true })} away` : ''}</span>
            {reading?.enteredAt && <span>At address since {locationTime(reading.enteredAt)}</span>}</div>
          <div className="focus-actions">
            <button className="focus-button" type="button" disabled={locked} aria-label={`Edit ${place.name}`} onClick={() => edit(place)}>Edit</button>
            <button className="focus-button" type="button" disabled={locked} aria-label={`Remove ${place.name}`} onClick={() => {
              if (draft.id === place.id) setDraft(EMPTY_PLACE);
              update({ places: settings.places.filter(item => item.id !== place.id) });
            }}>Remove</button>
          </div>
        </li>;
      })}
    </ul>}
    {locked ? <p className="focus-footnote">Reset the current route to edit its saved places.</p> : <form onSubmit={save} className="focus-ops-form">
      <label className="focus-select">Place name
        <input value={draft.name} onChange={event => change('name', event.target.value)} required maxLength={80} />
      </label>
      <label className="focus-select">Street address
        <input value={draft.address} onChange={event => change('address', event.target.value)} maxLength={180} autoComplete="off" />
      </label>
      <div className="focus-actions">
        <button type="button" className="focus-button" aria-pressed={picking} onClick={() => setPicking(!picking)}>
          {picking ? 'Cancel map pin' : 'Pick on map'}
        </button>
        <button type="button" className="focus-button" disabled={!fix} onClick={() => setDraft(current => placeWithCoordinates(current, fix))}>Use live GPS</button>
        {lookup && <a className="focus-button" href={lookup} target="_blank" rel="noreferrer">Find in Google Maps</a>}
      </div>
      <div className="focus-ops-fields">
        <label className="focus-select">Place latitude
          <input type="number" min="-90" max="90" step="any" required value={draft.latitude} onChange={event => change('latitude', event.target.value)} />
        </label>
        <label className="focus-select">Place longitude
          <input type="number" min="-180" max="180" step="any" required value={draft.longitude} onChange={event => change('longitude', event.target.value)} />
        </label>
        <label className="focus-select">Arrival radius (m)
          <input type="number" min="20" max="5000" required value={draft.radius} onChange={event => change('radius', event.target.valueAsNumber || event.target.value)} />
        </label>
        <label className="focus-select">Time at address (min)
          <input type="number" min="1" max="120" required value={draft.dwellMinutes} onChange={event => change('dwellMinutes', event.target.valueAsNumber || event.target.value)} />
        </label>
      </div>
      <div className="focus-actions">
        <button className="focus-button focus-primary" type="submit" disabled={!draft.id && settings.places.length >= PLACE_LIMIT}>Save address</button>
        {draft.id && <button className="focus-button" type="button" onClick={() => setDraft(EMPTY_PLACE)}>Cancel edit</button>}
      </div>
    </form>}
  </section>;
}

export function FocusRoutePlanner({ tools, planned, units, openAddresses }) {
  const { fix, state, settings, dispatch, update } = tools;
  const [addId, setAddId] = useState('');
  const { route } = state;
  const stops = route?.stops ?? planned;
  const remaining = stops.slice(route?.next ?? 0);
  const launch = directionsLink(remaining.map(stop => stop.center), settings.mode, fix);
  const next = remaining[0];
  const distance = fix && next ? measureLocation(next.center, fix, 0).distance : null;

  function move(from, to) {
    const stops = [...settings.stops];
    [stops[from], stops[to]] = [stops[to], stops[from]];
    update({ stops });
  }

  return <section aria-labelledby="focus-route-heading" className="focus-ops-tool">
    <h3 id="focus-route-heading">Route planner</h3>
    <div className="focus-ops-fields">
      <label className="focus-select">Travel mode
        <select value={settings.mode} disabled={Boolean(route)} onChange={event => update({ mode: event.target.value })}>
          <option value="driving">Driving</option><option value="walking">Walking</option><option value="bicycling">Cycling</option>
        </select>
      </label>
      <label className="focus-select">Planned corridor alert
        <select value={settings.corridor} disabled={Boolean(route)} onChange={event => update({ corridor: Number(event.target.value) })}>
          <option value="0">Off</option>
          {[100, 250, 500, 1000, 2000].map(meters =>
            <option key={meters} value={meters}>{locationLength(meters, units)} from line</option>)}
        </select>
      </label>
    </div>
    {!route && (settings.places.length ? <form className="focus-ops-inline" onSubmit={event => {
      event.preventDefault();
      if (!settings.places.some(place => place.id === addId) || settings.stops.length >= STOP_LIMIT) return;
      update({ stops: [...settings.stops, addId] });
      setAddId('');
    }}>
      <label className="focus-select">Add a saved address as a stop
        <select required value={addId} onChange={event => setAddId(event.target.value)}>
          <option value="">Choose an address</option>
          {settings.places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
        </select>
      </label>
      <button className="focus-button" type="submit" disabled={!addId || stops.length >= STOP_LIMIT}>Add stop</button>
    </form> : <button className="focus-button" type="button" onClick={openAddresses}>Add a saved address</button>)}
    {stops.length > 0 && <ol className="focus-ops-list" aria-label="Route stops">
      {stops.map((stop, index) => <li key={`${stop.id}:${index}`}>
        <div><strong>{index + 1}. {stop.name}</strong>
          {route && <span>{index < route.next ? 'Reached' : index === route.next ? 'Next stop' : 'Upcoming'}</span>}</div>
        {!route && <div className="focus-actions">
          <button className="focus-button focus-icon-button" type="button" aria-label={`Move stop ${index + 1} up`}
            disabled={index === 0} onClick={() => move(index, index - 1)}>↑</button>
          <button className="focus-button focus-icon-button" type="button" aria-label={`Move stop ${index + 1} down`}
            disabled={index === stops.length - 1} onClick={() => move(index, index + 1)}>↓</button>
          <button className="focus-button" type="button" aria-label={`Remove stop ${index + 1}`}
            onClick={() => update({ stops: settings.stops.filter((_, position) => position !== index) })}>Remove</button>
        </div>}
      </li>)}
    </ol>}
    {stops.length > 0 && <p className="focus-footnote">Planned distance between pins {locationLength(plannedDistance(route?.origin ?? fix, stops), units, { large: true })}.
      {distance !== null && ` Next stop ${locationLength(distance, units, { large: true })} away.`}</p>}
    {route && <p role="status" className="focus-feedback">
      {next ? route.deviating ? 'Outside the planned corridor.' : fix ? `Following route to ${next.name}.` : 'Waiting for fresh GPS.' : 'All route stops reached.'}
    </p>}
    <div className="focus-actions">
      {route ? <button className="focus-button" type="button" onClick={() => dispatch({ type: 'route' })}>Reset route progress</button>
        : <button className="focus-button focus-primary" type="button" disabled={!fix || !stops.length}
          onClick={() => dispatch({ type: 'route', fix, stops, corridor: settings.corridor })}>Track route live</button>}
      {launch && <a className="focus-button" href={launch} target="_blank" rel="noreferrer">
        {remaining.length > 4 ? 'Open next 4 stops in Google Maps' : 'Open road directions in Google Maps'}
      </a>}
    </div>
  </section>;
}
