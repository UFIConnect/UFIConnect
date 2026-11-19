import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { Crosshair, Globe2, LocateFixed, Minus, Plus } from 'lucide-react';
import { geoAzimuthalEquidistant, geoCentroid, geoCircle, geoDistance, geoGraticule10, geoOrthographic, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import atlas from './focus-media/countries-110m.json';
import { MIN_RADIUS, coordinateLabel, radiusLabel } from './focus-studio-model.mjs';
import { EARTH_RADIUS_METERS, MAX_SURFACE_DISTANCE_METERS, zoneGeometry } from './focus-geofence.mjs';
import { routeSegments } from './focus-tracking.mjs';
import { gridCell, gridGeometry } from './focus-movement.mjs';
import { dragMap, GLOBE_RADIUS, headingPoint, MAP_CENTER as ORIGIN, MAP_HEIGHT, MAP_WIDTH } from './focus-map.mjs';
import { MAX_STREET_LATITUDE, streetViewZoom, visibleStreetTiles } from './focus-streets.mjs';
import { reviewWalk } from './focus-walk.mjs';
import FocusGlobeSurface from './FocusGlobeSurface';
import FocusStreetTile from './FocusStreetTile';
import { LOCAL_PIN_SOURCE } from './focus-live-pins.mjs';

// Natural Earth 1:110m boundaries, distributed by world-atlas 2.0.2.
const LAND = feature(atlas, atlas.objects.land);
const BORDERS = mesh(atlas, atlas.objects.countries, (a, b) => a !== b);
const COUNTRIES = feature(atlas, atlas.objects.countries).features
  .map(country => ({ name: country.properties.name, center: geoCentroid(country) }))
  .sort((a, b) => a.name.localeCompare(b.name));
const GRID = geoGraticule10();
const SPHERE = { type: 'Sphere' };
const DEFAULT_VIEW = [-20, 24, 0];
const FIT_RADIUS = 72;
const MAX_ZOOM = FIT_RADIUS / (GLOBE_RADIUS * Math.sin(MIN_RADIUS / EARTH_RADIUS_METERS));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const wrap = value => ((value + 180) % 360 + 360) % 360 - 180;
const coordinates = ({ longitude, latitude }) => [longitude, latitude];

function zoomToAngle(angle, flat) {
  const width = flat ? angle * 2 / Math.PI : Math.sin(angle);
  return clamp(FIT_RADIUS / (GLOBE_RADIUS * width), 1, MAX_ZOOM);
}

function MapScale({ zoom, flat }) {
  const scale = GLOBE_RADIUS * zoom;
  const maxMeters = (flat ? 80 / scale * Math.PI / 2 : Math.asin(80 / scale)) * EARTH_RADIUS_METERS;
  const step = 10 ** Math.floor(Math.log10(maxMeters));
  const meters = Math.max(1, ([5, 2, 1].find(value => value * step <= maxMeters) ?? 1) * step);
  const angle = meters / EARTH_RADIUS_METERS;
  const width = scale * (flat ? angle * 2 / Math.PI : Math.sin(angle));
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

export default function FocusGlobe({ zones = [], selected, draft, deviceFix, deviceLabel = 'Live device location',
  trail = [], waypoints = [], plan = [], places = [], liveSources = [], savedPins = [], activePinIds = [],
  livePins = [], followTarget, deviceSourceId = LOCAL_PIN_SOURCE, onPickSource,
  movementGrid, activeCell, initialCenter, detail,
  onPick, onSelect, onMove, movePreview, walk, mapMode, setMapMode,
  showStreets, setShowStreets, locateCenter, visible = true, preserveFollowOnPin = false, followRequest = 0 }) {
  const editable = Boolean(onPick);
  const zoneEditing = editable && Boolean(onMove);
  const flat = mapMode === 'flat';
  const [mapView, setView] = useState(() => initialCenter ? [...coordinates(initialCenter), 0]
    : selected ? [...coordinates(selected.center), 0] : DEFAULT_VIEW);
  const [zoom, setZoom] = useState(() => selected && (!selected.shape || selected.shape === 'circle')
    ? zoomToAngle(Math.min(selected.radius / EARTH_RADIUS_METERS, Math.PI / 2), flat) : 1);
  const [countryName, setCountryName] = useState('');
  const [following, setFollowing] = useState(true);
  const [showBorders, setShowBorders] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showRelief, setShowRelief] = useState(true);
  const [depthReady, setDepthReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [moving, setMoving] = useState(null);
  const surface = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  const clipId = useId();
  const waterId = useId();
  const target = draft ?? selected;
  const latitude = target?.center.latitude;
  const longitude = target?.center.longitude;
  const radius = GLOBE_RADIUS * zoom;
  const hasDepth = visible && !flat && depthReady;
  const route = walk ? walk.points : trail;
  const routeWaypoints = walk ? [] : waypoints;
  const first = route[0];
  const last = route.at(-1);
  const walking = walk?.phase === 'walking';
  const reviewing = walk?.phase === 'review';
  const walkShape = useMemo(() => reviewing && walk.mode === 'boundary' ? reviewWalk(walk) : null, [reviewing, walk]);
  useEffect(() => {
    if (latitude === undefined || walk) return;
    setView([longitude, latitude, 0]);
    setCountryName('');
  }, [latitude, longitude, walk]);
  const pin = walk?.pin ?? savedPins.at(-1)?.center;
  const processedPin = useRef(null);
  useEffect(() => {
    if (processedPin.current === pin) return;
    processedPin.current = pin;
    if (!pin || preserveFollowOnPin) return;
    setFollowing(false);
    setView([...coordinates(pin), 0]);
    setCountryName('');
  }, [pin, preserveFollowOnPin]);
  useEffect(() => { if (followRequest) setFollowing(true); }, [followRequest]);
  const goToLocation = useEffectEvent(point => {
    setFollowing(false);
    setView([...coordinates(point), 0]);
    setCountryName('');
    setZoom(current => point.radius === undefined ? Math.max(current, streetViewZoom(point.latitude, flat))
      : zoomToAngle(Math.min(point.radius / EARTH_RADIUS_METERS, Math.PI / 2), flat));
  });
  useEffect(() => {
    if (locateCenter) goToLocation(locateCenter);
  }, [locateCenter]);

  const device = deviceFix && coordinates(deviceFix);
  const walkingFix = walking && last ? coordinates(last) : null;
  const followPoint = walkingFix ?? (!zoneEditing && !walk
    ? followTarget ? followTarget.fix && coordinates(followTarget.fix) : device : null);
  useEffect(() => {
    if (following && followTarget?.fix) setView([...coordinates(followTarget.fix), 0]);
  }, [following, followTarget?.fix]);
  const view = following && followPoint ? [...followPoint, 0] : mapView;
  const followingLocation = Boolean(following && followPoint);
  const zoomToFollowPoint = useEffectEvent(() => {
    setZoom(current => Math.max(current, streetViewZoom(followPoint[1], flat)));
  });
  useEffect(() => {
    if (followingLocation) zoomToFollowPoint();
  }, [followingLocation]);
  const [viewLongitude, viewLatitude, roll] = view;
  const viewCenter = [viewLongitude, viewLatitude];
  const { projection, path, outline, land, borders, grid } = useMemo(() => {
    const projection = (flat ? geoAzimuthalEquidistant().clipAngle(90) : geoOrthographic())
      .translate(ORIGIN).scale(flat ? radius * 2 / Math.PI : radius)
      .rotate([-viewLongitude, -viewLatitude, roll]).precision(0.4).clipExtent([[0, 0], [MAP_WIDTH, MAP_HEIGHT]]);
    const path = geoPath(projection).digits(2);
    return { projection, path, outline: path(SPHERE), land: hasDepth ? null : path(LAND),
      borders: showBorders ? path(BORDERS) : null, grid: showGrid ? path(GRID) : null };
  }, [viewLongitude, viewLatitude, roll, radius, flat, hasDepth, showBorders, showGrid]);
  const streetTiles = useMemo(() => visible && showStreets
    ? visibleStreetTiles(projection, [viewLongitude, viewLatitude], zoom, flat) : [],
  [visible, showStreets, projection, viewLongitude, viewLatitude, zoom, flat]);
  const devicePoint = device && geoDistance(viewCenter, device) < Math.PI / 2 ? projection(device) : null;
  const heading = useMemo(() => {
    if (!devicePoint || !Number.isFinite(deviceFix.heading)) return null;
    const [x, y] = projection(headingPoint(coordinates(deviceFix), deviceFix.heading));
    return 90 + Math.atan2(y - devicePoint[1], x - devicePoint[0]) * 180 / Math.PI;
  }, [devicePoint, deviceFix, projection]);
  const trailLines = useMemo(() => routeSegments(route).filter(line => line.length > 1)
    .map(line => line.map(coordinates)), [route]);
  const linePath = path({ type: 'MultiLineString', coordinates: trailLines });
  const planPath = plan.length > 1 ? path({ type: 'LineString', coordinates: plan.map(coordinates) }) : null;
  const drawnGrid = useMemo(() => {
    if (!movementGrid || !showGrid || zoom < 1 / movementGrid) return null;
    return path(gridGeometry(gridCell({ longitude: viewLongitude, latitude: viewLatitude, accuracy: 0 }, movementGrid), 11));
  }, [movementGrid, showGrid, zoom, path, viewLongitude, viewLatitude]);
  const currentCell = movementGrid && showGrid && activeCell && zoom >= 1 / movementGrid
    ? path(gridGeometry(activeCell)) : null;

  function fitPoints(points, width = 0) {
    if (!points.length) return;
    const pairs = points.map(coordinates);
    const center = geoCentroid({ type: 'MultiPoint', coordinates: pairs });
    const middle = center.every(Number.isFinite) ? center : pairs[0];
    const angle = Math.min(Math.PI / 2, Math.max(1e-6, ...pairs.map(point => geoDistance(middle, point))) + width);
    setFollowing(false);
    setView([...middle, 0]);
    setCountryName('');
    setZoom(zoomToAngle(angle, flat));
  }

  function fitZone() {
    if (target.vertices?.length) {
      fitPoints(target.vertices, target.shape === 'corridor' ? target.radius / EARTH_RADIUS_METERS : 0);
      return;
    }
    setFollowing(false);
    setView([...coordinates(target.center), 0]);
    setCountryName('');
    setZoom(zoomToAngle(Math.min(target.radius / EARTH_RADIUS_METERS, Math.PI / 2), flat));
  }

  function fitTrack() {
    fitPoints([...route, ...routeWaypoints, ...plan]);
  }

  function zoomDetails() {
    const angle = movementGrid ? movementGrid * Math.PI / 180 * 2 : 350 / EARTH_RADIUS_METERS;
    setZoom(zoomToAngle(angle, flat));
  }
  const zoomForDetail = useEffectEvent(zoomDetails);
  useEffect(() => {
    if (detail && (initialCenter || followingLocation)) zoomForDetail();
  }, [detail, initialCenter, followingLocation, movementGrid, flat]);

  const firstTimestamp = first?.timestamp;
  useEffect(() => {
    if (firstTimestamp !== undefined && walking) {
      setFollowing(true);
    }
  }, [firstTimestamp, walking]);

  const fitReview = useEffectEvent(fitTrack);
  useEffect(() => {
    if (reviewing) fitReview();
  }, [reviewing]);

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
    if (!point || point.x < 0 || point.x > MAP_WIDTH || point.y < 0 || point.y > MAP_HEIGHT
      || Math.hypot(point.x - ORIGIN[0], point.y - ORIGIN[1]) > radius) return null;
    const [longitude, latitude] = projection.invert([point.x, point.y]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    return { latitude, longitude, accuracy: 0 };
  }

  function pickCenter() {
    onPick({ longitude: viewLongitude, latitude: viewLatitude, accuracy: 0 }, countryName);
  }

  function pinch() {
    const [first, second] = pointers.current.values();
    return { center: [(first.x + second.x) / 2, (first.y + second.y) / 2],
      spread: Math.hypot(first.x - second.x, first.y - second.y) };
  }

  function startDrag(event) {
    if (event.button !== 0 || pointers.current.size >= 2) return;
    const point = pagePoint(event);
    if (!point) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 2) {
      setMoving(null);
      gesture.current = { ...pinch(), view, zoom, pinching: true };
      return;
    }
    const pin = zoneEditing ? event.target.closest('[data-zone-id], [data-focus-draft]') : null;
    gesture.current = { x: point.x, y: point.y, view, zoom, dragged: false,
      sourceId: onPickSource ? event.target.closest('[data-focus-source-id]')?.getAttribute('data-focus-source-id') : null,
      zoneId: pin?.getAttribute('data-zone-id'), draftPin: Boolean(pin?.hasAttribute('data-focus-draft')) };
  }

  function move(event) {
    const start = gesture.current;
    if (!start || !pointers.current.has(event.pointerId)) return;
    const point = pagePoint(event);
    if (!point) return;
    pointers.current.set(event.pointerId, point);
    if (start.pinching) {
      if (pointers.current.size !== 2) return;
      const { center, spread } = pinch();
      const nextZoom = clamp(start.zoom * spread / Math.max(1, start.spread), 1, MAX_ZOOM);
      setDragging(true);
      setFollowing(false);
      setCountryName('');
      setZoom(nextZoom);
      setView(dragMap(start.view, start.center, center, GLOBE_RADIUS * start.zoom, GLOBE_RADIUS * nextZoom, flat));
      return;
    }
    if (!start.dragged && Math.hypot(point.x - start.x, point.y - start.y) < 5) return;
    start.dragged = true;
    setDragging(true);
    if (start.zoneId || start.draftPin) {
      const center = mapPoint(event);
      if (center) setMoving({ id: start.zoneId, draft: start.draftPin, center });
      return;
    }
    setFollowing(false);
    setCountryName('');
    setView(dragMap(start.view, [start.x, start.y], [point.x, point.y], radius, radius, flat));
  }

  function finish(event, cancelled = false) {
    if (!pointers.current.delete(event.pointerId) || pointers.current.size > 0) return;
    const start = gesture.current;
    gesture.current = null;
    setDragging(false);
    setMoving(null);
    if (cancelled || !editable || !start || start.pinching) return;
    if (!start.dragged && start.sourceId && onPickSource) { onPickSource(start.sourceId); return; }
    const { dragged, zoneId, draftPin } = start;
    if (zoneId && !dragged) { onSelect?.(zoneId); return; }
    if (draftPin && !dragged || dragged && !zoneId && !draftPin) return;
    const center = mapPoint(event);
    if (!center) return;
    if (zoneId) onMove?.(zoneId, center);
    else onPick(center, countryName);
  }

  function keyMove(event) {
    const delta = 22 / zoom;
    const shifts = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, delta], ArrowDown: [0, -delta] };
    if (shifts[event.key]) {
      event.preventDefault();
      const [dx, dy] = shifts[event.key];
      setFollowing(false);
      setCountryName('');
      const [x, y] = view;
      setView([wrap(x + dx), clamp(y + dy, -90, 90), 0]);
    }
    if (editable && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      pickCenter();
    }
    if (event.key === '+' || event.key === '-') {
      event.preventDefault();
      adjustZoom(event.key === '+' ? 2 : 0.5);
    }
  }

  function circleBoundary(pair, meters, className) {
    const distance = geoDistance(viewCenter, pair);
    const angle = meters / EARTH_RADIUS_METERS;
    if (distance > Math.PI / 2 + angle) return null;
    if (meters >= MAX_SURFACE_DISTANCE_METERS) return <path className={className} d={outline || undefined} />;
    if (distance + angle < Math.PI / 2 && !flat) {
      // Project small circles directly so meter-scale boundaries survive clipping tolerances.
      const [x, y] = projection(pair);
      const dx = x - ORIGIN[0], dy = y - ORIGIN[1];
      const cx = ORIGIN[0] + dx * Math.cos(angle), cy = ORIGIN[1] + dy * Math.cos(angle);
      const screenRadius = radius * Math.sin(angle);
      const rotation = Math.atan2(dy, dx) * 180 / Math.PI;
      return <ellipse className={className} cx={cx} cy={cy}
        rx={screenRadius * Math.cos(distance)} ry={screenRadius} transform={`rotate(${rotation} ${cx} ${cy})`} />;
    }
    const circle = geoCircle().center(pair).radius(angle * 180 / Math.PI).precision(6)();
    const shape = distance + angle < Math.PI / 2
      ? 'M' + circle.coordinates[0].map(point => projection(point).join(',')).join('L') + 'Z'
      : path(circle);
    return <path className={className} d={shape || undefined} />;
  }

  function marker(zone, state, draftPin = false) {
    const pair = coordinates(zone.center);
    const distance = geoDistance(viewCenter, pair);
    const geometry = zoneGeometry(zone);
    const custom = zone.shape && zone.shape !== 'circle';
    const [x, y] = projection(pair);
    let boundary;
    if (custom) {
      const vertices = (zone.vertices ?? []).map(coordinates);
      const sketch = vertices.length > 1 ? { type: 'LineString', coordinates: vertices } : null;
      const line = geometry?.type === 'LineString';
      boundary = <>
        {line && <path className="focus-globe-corridor" d={path(geometry) || undefined}
          strokeWidth={2 * radius * (flat ? 2 / Math.PI : 1) * Math.sin(Math.min(Math.PI / 2, zone.radius / EARTH_RADIUS_METERS))} />}
        {(geometry || sketch) && <path className={line || !geometry ? 'focus-globe-custom-line' : 'focus-globe-boundary'}
          d={path(geometry ?? sketch) || undefined} />}
        {state === 'draft' && vertices.filter(point => geoDistance(viewCenter, point) < Math.PI / 2)
          .map((point, index) => {
            const [vx, vy] = projection(point);
            return <circle key={index} className="focus-globe-pin" cx={vx} cy={vy} r="3" />;
          })}
      </>;
    } else {
      boundary = circleBoundary(pair, zone.radius, 'focus-globe-boundary');
      if (!boundary) return null;
    }
    return <g key={zone.id} className="focus-globe-marker" data-marker={state}>
      <title>{zone.name || coordinateLabel(zone.center)}</title>
      {boundary}
      {distance < Math.PI / 2 && (!draftPin || !custom) && <>
        <g data-zone-id={draftPin || state === 'draft' ? undefined : zone.id} data-focus-draft={draftPin || undefined}>
          <circle cx={x} cy={y} r="13" fill="transparent" />
          <circle className="focus-globe-pin-halo" cx={x} cy={y} r={state === 'active' ? 7 : 5} />
          <circle className="focus-globe-pin" cx={x} cy={y} r="2.6" />
        </g>
      </>}
    </g>;
  }

  function routePin(point, type, label, key) {
    const pair = coordinates(point);
    if (geoDistance(viewCenter, pair) >= Math.PI / 2) return null;
    const [x, y] = projection(pair);
    return <g key={key} className="focus-globe-route-pin" data-pin={type}
      data-focus-source-id={type === 'source' ? key : undefined} transform={`translate(${x} ${y})`}>
      <title>{label}</title>
      {type === 'drop' || type === 'live' ? <path d="M0 2L-4 -4a5 5 0 1 1 8 0Z" /> : <circle r="4.3" />}
    </g>;
  }

  return <>
    <div className="focus-map-view" role="group" aria-label="Map view">
      {[['globe', '3D globe'], ['flat', 'Flat map']].map(([id, label]) => <button key={id} type="button"
        className="focus-button" aria-pressed={mapMode === id} onClick={() => setMapMode(id)}>{label}</button>)}
      <button className="focus-button" type="button" aria-pressed={showStreets}
        onClick={() => setShowStreets(!showStreets)}>Streets</button>
    </div>
    {visible && showStreets && !streetTiles.length && <p className="focus-footnote focus-street-hint">
      {Math.abs(viewLatitude) > MAX_STREET_LATITUDE ? 'Street coverage ends near the poles.' : 'Zoom in to see streets.'}
    </p>}
    {editable && <label className="focus-globe-country">Find a country
      <select value={countryName} onChange={event => {
        const country = COUNTRIES.find(item => item.name === event.target.value);
        if (country) { setFollowing(false); setCountryName(country.name); setView([...country.center, 0]); setZoom(2); }
      }}>
        <option value="" disabled>Jump to a country…</option>
        {COUNTRIES.map(country => <option key={country.name} value={country.name}>{country.name}</option>)}
      </select>
    </label>}
    <div className="focus-globe" data-renderer={hasDepth ? 'webgl' : 'vector'}>
    {visible && !flat && <FocusGlobeSurface camera={view} zoom={zoom} relief={showRelief} onReady={setDepthReady} />}
    <svg ref={surface} className="focus-globe-map" data-editable={true} data-dragging={dragging || undefined}
      data-source-picking={editable && Boolean(onPickSource) || undefined}
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} tabIndex={0} role="group" aria-label={editable
        ? 'Interactive world map. Drag or use arrow keys to pan. Press plus or minus to zoom and Enter to drop a pin.'
        : 'Live location map. Drag or use arrow keys to pan. Press plus or minus to zoom.'}
      onKeyDown={keyMove} onPointerDown={startDrag}
      onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
      onLostPointerCapture={event => finish(event, true)}>
      <defs>
        <clipPath id={clipId}><path d={outline || undefined} /></clipPath>
        <radialGradient id={waterId} cx="40%" cy="26%" r="80%"><stop stopColor="#273550" /><stop offset="1" stopColor="#0c182c" /></radialGradient>
      </defs>
      <path d={outline || undefined} fill={hasDepth ? "none" : `url(#${waterId})`} className="focus-globe-ocean" />
      <g clipPath={`url(#${clipId})`}>
        {!hasDepth && <path d={land || undefined} className="focus-globe-land" />}
        {grid && <path d={grid} className="focus-globe-grid" />}
        {borders && <path d={borders} className="focus-globe-borders" />}
        {streetTiles.length > 0 && <g className="focus-street-tiles" aria-hidden="true">
          {streetTiles.map(tile => <FocusStreetTile key={tile.path} tile={tile} />)}
        </g>}
        {drawnGrid && <path d={drawnGrid} className="focus-ops-grid-lines" data-movement-grid />}
        {currentCell && <path d={currentCell} className="focus-ops-grid-cell" data-current-grid-cell />}
        {planPath && <path d={planPath} className="focus-ops-planned-line" />}
        {linePath && <>
          <path className="focus-globe-route-outline" d={linePath} />
          <path className="focus-globe-route" d={linePath} />
        </>}
        {first && routePin(first, 'start', 'Route start')}
        {last && last !== first && routePin(last, 'end', reviewing ? 'Route finish' : 'Last recorded point')}
        {routeWaypoints.map((point, index) => {
          const pair = coordinates(point);
          if (geoDistance(viewCenter, pair) >= Math.PI / 2) return null;
          const [x, y] = projection(pair);
          return <circle key={point.id ?? index} className="focus-globe-waypoint" cx={x} cy={y} r="3"><title>{point.name}</title></circle>;
        })}
        {places.map(place => routePin(place, 'place', place.name, place.id))}
        {liveSources.map(source => routePin(source, 'source', source.name, source.id))}
        {zones.map(zone => {
          const movingThis = moving?.id === zone.id;
          const display = movingThis ? movePreview(zone, moving.center) : zone;
          if (draft?.id === zone.id && !movingThis) return null;
          return marker(display, movingThis ? 'draft' : !zone.enabled ? 'disabled' : zone.id === selected?.id ? 'active' : 'saved');
        })}
        {draft && (!moving || moving.draft) && marker({ ...draft, id: 'draft',
          center: moving?.center ?? draft.center }, 'draft', true)}
        {walkShape?.vertices && marker({ ...walkShape, id: 'walk-preview', radius: 0, name: 'Walked boundary' }, 'walk')}
        {devicePoint && deviceFix.accuracy > 0 && circleBoundary(device, deviceFix.accuracy, 'focus-globe-accuracy')}
        {devicePoint && <g className="focus-globe-device" data-focus-source-id={deviceSourceId} transform={`translate(${devicePoint.join(' ')})`}>
          <title>{deviceLabel}</title>
          {heading !== null && <path className="focus-globe-heading" d="m0-13 4 7-4-2-4 2z" transform={`rotate(${heading})`} />}
          <circle r="7" /><circle r="3.5" />
        </g>}
        {walk?.pin && !first && routePin(walk.pin, 'drop', 'Dropped start pin')}
        {savedPins.map(pin => <g key={pin.id} className="focus-globe-marker" data-marker={activePinIds.includes(pin.id) ? 'active' : 'saved'}>
          {circleBoundary(coordinates(pin.center), pin.radius, 'focus-globe-boundary')}
          {routePin(pin.center, 'drop', pin.name)}
        </g>)}
        {livePins.filter(pin => pin.fix).map(pin => <g key={pin.id} data-live-map-pin={pin.id} data-focus-source-id={pin.sourceId}>
          {routePin(pin.fix, 'live', `Live pin · ${pin.name}`)}
        </g>)}
      </g>
      {editable && <path className="focus-globe-crosshair" d="M222 146h5m6 0h5m-8-8v5m0 6v5" />}
      <MapScale zoom={zoom} flat={flat} />
    </svg>
    <button className="focus-button focus-globe-compass" type="button" aria-label="Point north up" title="Point north up"
      onClick={() => { setFollowing(false); setView([viewLongitude, viewLatitude, 0]); }}>
      <span aria-hidden="true" style={{ transform: `rotate(${-roll}deg)` }}>▲</span>N
    </button>
    <div className="focus-globe-tools" role="group" aria-label="Globe controls">
      <button className="focus-button focus-icon-button" type="button" aria-label="Zoom in on globe" title="Zoom in"
        disabled={zoom >= MAX_ZOOM} onClick={() => adjustZoom(2)}><Plus size={16} aria-hidden="true" /></button>
      <button className="focus-button focus-icon-button" type="button" aria-label="Zoom out on globe" title="Zoom out"
        disabled={zoom <= 1} onClick={() => adjustZoom(0.5)}><Minus size={16} aria-hidden="true" /></button>
      {zoneEditing && <button className="focus-button focus-icon-button" type="button" aria-label="Fit zone on globe" title="Fit zone"
        disabled={!target} onClick={fitZone}><LocateFixed size={16} aria-hidden="true" /></button>}
      <button className="focus-button focus-icon-button" type="button" aria-label="World view" title="World view"
        onClick={() => { setFollowing(false); setView(DEFAULT_VIEW); setZoom(1); }}><Globe2 size={16} aria-hidden="true" /></button>
    </div>
    {streetTiles.length > 0 && <a className="focus-street-attribution" href="https://www.openstreetmap.org/copyright"
      target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>}
    </div>
    {(!zoneEditing || walk) && <div className="focus-actions focus-globe-actions">
      {(!editable || walking) && <button type="button" className="focus-button" aria-pressed={following} onClick={() => {
        setView(view);
        setFollowing(value => !value);
      }}>{walking ? 'Follow walk' : deviceLabel === 'Replay position' ? 'Follow replay' : 'Follow location'}</button>}
      {device && <button type="button" className="focus-button" onClick={() => {
        setFollowing(false);
        setView([...device, 0]);
        if (movementGrid) zoomDetails();
        else setZoom(current => Math.max(current, streetViewZoom(device[1], flat)));
      }}>Center on location</button>}
      <button type="button" className="focus-button" disabled={!route.length && !routeWaypoints.length && !plan.length} onClick={fitTrack}>Fit route</button>
      {places.length > 0 && <button type="button" className="focus-button" onClick={() => fitPoints(places, 250 / EARTH_RADIUS_METERS)}>Fit places</button>}
      {liveSources.length > 0 && <button type="button" className="focus-button"
        onClick={() => fitPoints(deviceFix ? [deviceFix, ...liveSources] : liveSources, 250 / EARTH_RADIUS_METERS)}>Fit shared devices</button>}
    </div>}
    {preserveFollowOnPin && device && !following && <p className="focus-footnote">Map following is off; live GPS tracking continues. Select Follow location to recenter.</p>}
    {editable && <><div className="focus-globe-footer">
      <div className="focus-globe-center">Map center <span>{coordinateLabel({ longitude: view[0], latitude: view[1] })}</span></div>
      <div className="focus-actions">
        {device && <button className="focus-button focus-globe-choose" type="button" onClick={() => {
          setFollowing(false);
          setView([...device, 0]);
          setCountryName('');
          setZoom(current => Math.max(current, streetViewZoom(device[1], flat)));
        }}>Center on my location</button>}
        <button className="focus-button focus-globe-choose" type="button" onClick={pickCenter}>
          <Crosshair size={15} aria-hidden="true" />{walk ? 'Drop start pin here' : 'Drop pin here'}</button>
      </div>
    </div>
    <CoordinatePicker onPick={point => {
      onPick(point);
      if (!draft && showStreets) setZoom(current => Math.max(current, streetViewZoom(point.latitude, flat)));
    }} /></>}
    <details className="focus-globe-coordinate-picker focus-map-layers">
      <summary>Map layers</summary>
      <div className="focus-actions">
        <button type="button" className="focus-button" aria-pressed={showBorders} onClick={() => setShowBorders(value => !value)}>Country borders</button>
        <button type="button" className="focus-button" aria-pressed={showGrid} onClick={() => setShowGrid(value => !value)}>Map grid</button>
        {!flat && <button type="button" className="focus-button" aria-pressed={showRelief} disabled={!hasDepth}
          onClick={() => setShowRelief(value => !value)}>Shaded relief</button>}
      </div>
      <p className="focus-footnote">Map data from <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>.</p>
    </details>
  </>;
}
