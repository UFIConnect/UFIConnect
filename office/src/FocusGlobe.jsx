import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Crosshair, Globe2, LocateFixed, Minus, Plus } from 'lucide-react';
import { geoCentroid, geoCircle, geoDistance, geoGraticule10, geoOrthographic, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import atlas from './focus-media/countries-110m.json';
import { MIN_RADIUS, coordinateLabel, radiusLabel } from './focus-studio-model.mjs';
import { EARTH_RADIUS_METERS, MAX_SURFACE_DISTANCE_METERS } from './focus-geofence.mjs';

// Natural Earth 1:110m boundaries, distributed by world-atlas 2.0.2.
const LAND = feature(atlas, atlas.objects.land);
const BORDERS = mesh(atlas, atlas.objects.countries, (a, b) => a !== b);
const COUNTRIES = feature(atlas, atlas.objects.countries).features
  .map(country => ({ name: country.properties.name, center: geoCentroid(country) }))
  .sort((a, b) => a.name.localeCompare(b.name));
const GRID = geoGraticule10();
const SPHERE = { type: 'Sphere' };
const ORIGIN = [230, 146];
const GLOBE_RADIUS = 121;
const DEFAULT_VIEW = [-20, 24];
const FIT_RADIUS = 72;
const MAX_ZOOM = FIT_RADIUS / (GLOBE_RADIUS * Math.sin(MIN_RADIUS / EARTH_RADIUS_METERS));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;
const coordinates = ({ longitude, latitude }) => [longitude, latitude];

function MapScale({ zoom }) {
  const scale = GLOBE_RADIUS * zoom;
  const maxMeters = Math.asin(80 / scale) * EARTH_RADIUS_METERS;
  const step = 10 ** Math.floor(Math.log10(maxMeters));
  const meters = Math.max(1, ([5, 2, 1].find(value => value * step <= maxMeters) ?? 1) * step);
  const width = scale * Math.sin(meters / EARTH_RADIUS_METERS);
  return <g className="focus-globe-scale" aria-hidden="true">
    <rect x="12" y="249" width="102" height="30" rx="6" />
    <text x="23" y="262">{radiusLabel(meters)}</text>
    <path d={`M23 267v5h${width}v-5`} />
  </g>;
}

function CoordinatePicker({ onPick }) {
  return <details className="focus-globe-coordinate-picker">
    <summary>Enter coordinates</summary>
    <form onSubmit={event => {
      event.preventDefault();
      const { latitude, longitude } = event.currentTarget.elements;
      onPick({ latitude: latitude.valueAsNumber, longitude: longitude.valueAsNumber, accuracy: 0 });
    }}>
      <label className="focus-select">Latitude
        <input name="latitude" type="number" step="any" min="-90" max="90" required />
      </label>
      <label className="focus-select">Longitude
        <input name="longitude" type="number" step="any" min="-180" max="180" required />
      </label>
      <button className="focus-button" type="submit">Place pin</button>
    </form>
  </details>;
}

export default function FocusGlobe({ zones, selected, draft, deviceFix, onPick, onSelect, onMove }) {
  const [view, setView] = useState(() => selected ? coordinates(selected.center) : DEFAULT_VIEW);
  const [zoom, setZoom] = useState(1);
  const [countryName, setCountryName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [moving, setMoving] = useState(null);
  const surface = useRef(null);
  const pointer = useRef(null);
  const clipId = useId();
  const waterId = useId();
  const target = draft ?? selected;
  const latitude = target?.center.latitude;
  const longitude = target?.center.longitude;
  useEffect(() => {
    if (latitude === undefined) return;
    setView([longitude, latitude]);
    setCountryName('');
  }, [latitude, longitude]);
  const { projection, path, outline, land, borders, grid } = useMemo(() => {
    const projection = geoOrthographic().translate(ORIGIN).scale(GLOBE_RADIUS * zoom)
      .rotate([-view[0], -view[1]]).precision(0.4).clipExtent([[0, 0], [460, 292]]);
    const path = geoPath(projection).digits(2);
    return { projection, path, outline: path(SPHERE), land: path(LAND), borders: path(BORDERS), grid: path(GRID) };
  }, [view, zoom]);
  const device = deviceFix && coordinates(deviceFix);
  const devicePoint = device && geoDistance(view, device) < Math.PI / 2 ? projection(device) : null;

  function fitZone() {
    setView(coordinates(target.center));
    setCountryName('');
    const angle = Math.min(target.radius / EARTH_RADIUS_METERS, Math.PI / 2);
    setZoom(clamp(FIT_RADIUS / (GLOBE_RADIUS * Math.sin(angle)), 1, MAX_ZOOM));
  }

  function adjustZoom(factor) {
    setZoom(current => clamp(current * factor, 1, MAX_ZOOM));
  }

  function pagePoint(event) {
    const svg = surface.current;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  }

  function mapPoint(event) {
    const point = pagePoint(event);
    if (!point || point.x < 0 || point.x > 460 || point.y < 0 || point.y > 292
      || Math.hypot(point.x - ORIGIN[0], point.y - ORIGIN[1]) > GLOBE_RADIUS * zoom) return;
    const [longitude, latitude] = projection.invert([point.x, point.y]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    return { latitude, longitude, accuracy: 0 };
  }

  function pickCenter() {
    onPick({ longitude: view[0], latitude: view[1], accuracy: 0 }, countryName);
  }

  function move(event) {
    const start = pointer.current;
    if (!start || start.id !== event.pointerId) return;
    const point = pagePoint(event);
    if (!point) return;
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    if (!start.dragged && Math.hypot(dx, dy) < 5) return;
    start.dragged = true;
    setDragging(true);
    if (start.zoneId || start.draftPin) {
      const center = mapPoint(event);
      if (center) setMoving({ id: start.zoneId, draft: start.draftPin, center });
      return;
    }
    setCountryName('');
    const degrees = 0.66 / zoom;
    setView([wrap(start.view[0] - dx * degrees), clamp(start.view[1] + dy * degrees, -90, 90)]);
  }

  function finish(event, cancelled = false) {
    if (pointer.current?.id !== event.pointerId) return;
    const { dragged, zoneId, draftPin } = pointer.current;
    pointer.current = null;
    setDragging(false);
    setMoving(null);
    if (cancelled) return;
    if (zoneId && !dragged) { onSelect(zoneId); return; }
    if (draftPin && !dragged) return;
    if (dragged && !zoneId && !draftPin) return;
    const center = mapPoint(event);
    if (!center) return;
    if (zoneId) onMove(zoneId, center);
    else onPick(center, countryName);
  }

  function keyMove(event) {
    const delta = 22 / zoom;
    const shifts = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, delta], ArrowDown: [0, -delta] };
    if (shifts[event.key]) {
      event.preventDefault();
      const [dx, dy] = shifts[event.key];
      setCountryName('');
      setView(([x, y]) => [wrap(x + dx), clamp(y + dy, -90, 90)]);
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pickCenter();
    }
    if (event.key === '+' || event.key === '-') {
      event.preventDefault();
      adjustZoom(event.key === '+' ? 2 : 0.5);
    }
  }

  function marker(zone, state, draftPin = false) {
    const pair = coordinates(zone.center);
    const distance = geoDistance(view, pair);
    const angle = zone.radius / EARTH_RADIUS_METERS;
    if (distance > Math.PI / 2 + angle) return null;
    const [x, y] = projection(pair);
    let boundary;
    if (zone.radius >= MAX_SURFACE_DISTANCE_METERS) {
      boundary = <path className="focus-globe-boundary" d={outline || undefined} />;
    } else if (distance + angle < Math.PI / 2) {
      // Orthographic projection maps a fully visible small circle to an ellipse.
      // Project it directly so meter-scale zones survive geographic clipping tolerances.
      const dx = x - ORIGIN[0];
      const dy = y - ORIGIN[1];
      const cx = ORIGIN[0] + dx * Math.cos(angle);
      const cy = ORIGIN[1] + dy * Math.cos(angle);
      const screenRadius = GLOBE_RADIUS * zoom * Math.sin(angle);
      const rotation = Math.atan2(dy, dx) * 180 / Math.PI;
      boundary = <ellipse className="focus-globe-boundary" cx={cx} cy={cy}
        rx={screenRadius * Math.cos(distance)} ry={screenRadius} transform={`rotate(${rotation} ${cx} ${cy})`} />;
    } else {
      const shape = path(geoCircle().center(pair).radius(angle * 180 / Math.PI).precision(6)());
      boundary = <path className="focus-globe-boundary" d={shape || undefined} />;
    }
    return <g key={zone.id} className="focus-globe-marker" data-marker={state}>
      <title>{zone.name || coordinateLabel(zone.center)}</title>
      {boundary}
      {distance < Math.PI / 2 && <>
        <g data-zone-id={draftPin || state === 'draft' ? undefined : zone.id} data-focus-draft={draftPin || undefined}>
          <circle cx={x} cy={y} r="13" fill="transparent" />
          <circle className="focus-globe-pin-halo" cx={x} cy={y} r={state === 'active' ? 7 : 5} />
          <circle className="focus-globe-pin" cx={x} cy={y} r="2.6" />
        </g>
      </>}
    </g>;
  }

  return <>
    <label className="focus-globe-country">Find a country
      <select value={countryName} onChange={event => {
        const country = COUNTRIES.find(item => item.name === event.target.value);
        if (country) { setCountryName(country.name); setView(country.center); setZoom(2); }
      }}>
        <option value="" disabled>Jump to a country…</option>
        {COUNTRIES.map(country => <option key={country.name} value={country.name}>{country.name}</option>)}
      </select>
    </label>
    <div className="focus-globe">
    <svg ref={surface} className="focus-globe-map" data-dragging={dragging || undefined} viewBox="0 0 460 292"
      tabIndex={0} role="group" aria-label="Interactive world globe. Drag or use arrow keys to pan. Press plus or minus to zoom and Enter to place a pin."
      onKeyDown={keyMove}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        const point = pagePoint(event);
        if (!point) return;
        event.currentTarget.focus({ preventScroll: true });
        const pin = event.target.closest('[data-zone-id], [data-focus-draft]');
        pointer.current = { id: event.pointerId, x: point.x, y: point.y, view, dragged: false,
          zoneId: pin?.getAttribute('data-zone-id'), draftPin: Boolean(pin?.hasAttribute('data-focus-draft')) };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
      onLostPointerCapture={event => finish(event, true)}>
      <defs>
        <clipPath id={clipId}><path d={outline || undefined} /></clipPath>
        <radialGradient id={waterId} cx="40%" cy="26%" r="80%"><stop stopColor="#273550" /><stop offset="1" stopColor="#0c182c" /></radialGradient>
      </defs>
      <path d={outline || undefined} fill={`url(#${waterId})`} className="focus-globe-ocean" />
      <g clipPath={`url(#${clipId})`}>
        <path d={land || undefined} className="focus-globe-land" />
        <path d={grid || undefined} className="focus-globe-grid" />
        <path d={borders || undefined} className="focus-globe-borders" />
        {zones.map(zone => {
          const movingThis = moving?.id === zone.id;
          const display = movingThis ? { ...zone, center: moving.center } : zone;
          if (draft?.id === zone.id && !movingThis) return null;
          return marker(display, movingThis ? 'draft' : !zone.enabled ? 'disabled' : zone.id === selected?.id ? 'active' : 'saved');
        })}
        {draft && (!moving || moving.draft) && marker({ ...draft, id: 'draft',
          center: moving?.center ?? draft.center }, 'draft', true)}
        {devicePoint && <g className="focus-globe-device" transform={`translate(${devicePoint.join(' ')})`}>
          <title>Live device location</title>
          <circle r="7" /><circle r="3.5" />
        </g>}
      </g>
      <path className="focus-globe-crosshair" d="M222 146h5m6 0h5m-8-8v5m0 6v5" />
      <MapScale zoom={zoom} />
    </svg>
    <div className="focus-globe-tools" role="group" aria-label="Globe controls">
      <button className="focus-button focus-icon-button" type="button" aria-label="Zoom in on globe" title="Zoom in"
        disabled={zoom >= MAX_ZOOM} onClick={() => adjustZoom(2)}><Plus size={16} aria-hidden="true" /></button>
      <button className="focus-button focus-icon-button" type="button" aria-label="Zoom out on globe" title="Zoom out"
        disabled={zoom <= 1} onClick={() => adjustZoom(0.5)}><Minus size={16} aria-hidden="true" /></button>
      <button className="focus-button focus-icon-button" type="button" aria-label="Fit zone on globe" title="Fit zone"
        disabled={!target} onClick={fitZone}><LocateFixed size={16} aria-hidden="true" /></button>
      <button className="focus-button focus-icon-button" type="button" aria-label="World view" title="World view"
        disabled={zoom <= 1} onClick={() => setZoom(1)}><Globe2 size={16} aria-hidden="true" /></button>
    </div>
    </div>
    <div className="focus-globe-footer">
      <div className="focus-globe-center">Map center <span>{coordinateLabel({ longitude: view[0], latitude: view[1] })}</span></div>
      <div className="focus-actions">
        {device && <button className="focus-button focus-globe-choose" type="button" onClick={() => {
          setView(device);
          setCountryName('');
        }}>Center on my location</button>}
        <button className="focus-button focus-globe-choose" type="button" onClick={pickCenter}>
          <Crosshair size={15} aria-hidden="true" />Drop pin here</button>
      </div>
    </div>
    <CoordinatePicker onPick={onPick} />
  </>;
}
