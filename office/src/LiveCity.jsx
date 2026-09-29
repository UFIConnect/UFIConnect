import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowUpRight, Building2, Check, ChevronRight, CircleHelp, Focus, Home, Layers3, MessageSquare, Minus, Pause, Play, Plus, Radio, Search, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import { buildCityModel, cityNumber, cityTimestamp } from './city-model.mjs';
import { buildCityStreets } from './city-streets.mjs';
import './LiveCity.css';
const CityScene3D = lazy(() => import('./CityScene3D'));

const roleName = role => role === 'api' ? 'API' : role === 'pipeline' ? 'Pipeline' : 'Unknown service';
const stateName = state => ({ fresh: 'Fresh observation', observed: 'Observed', degraded: 'Needs attention', unavailable: 'Unavailable', unknown: 'Not reported', stale: 'Stale observation', loading: 'Connecting', paused: 'Paused', disabled: 'Disabled' }[state] || state || 'Not reported');
const homeStateName = state => ({ working: 'Working', inactive: 'Inactive', attention: 'Needs attention', unobserved: 'Unobserved' }[state] || 'Unobserved');
const stamp = value => cityTimestamp(value) == null ? 'Not reported' : new Date(cityTimestamp(value)).toLocaleString();
const age = (value, now) => {
  const time = cityTimestamp(value);
  if (time == null) return 'No observation yet';
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : `${Math.floor(seconds / 3600)}h ago`;
};
const number = value => cityNumber(value) == null ? 'Not reported' : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
// Operational excerpts are text, not rendered HTML. Hide links and common credential
// forms; the full protected operations views remain the place for detailed review.
const excerpt = value => String(value || '').replace(/https?:\/\/[^\s]+/gi, '[link omitted]')
  .replace(/\b(Bearer\s+)[^\s,;]+/gi, '$1[redacted]')
  .replace(/\b((?:[a-z_]*token|password|secret|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]').slice(0, 450);
const knownRole = role => role === 'api' || role === 'pipeline';
const safeObservationError = value => [
  'API telemetry unavailable', 'Pipeline telemetry unavailable',
  'The API address returned pipeline process telemetry',
  'A separate pipeline service is not configured', 'The pipeline address returned API process telemetry',
].includes(value) ? value : value ? 'Service telemetry is unavailable. Check its connection and configuration.' : '';

function Status({ state }) { return <span className={`lc-status lc-status-${state || 'unknown'}`}><i aria-hidden="true" />{stateName(state)}</span>; }
function MetricGrid({ metrics }) {
  return <dl className="lc-metrics">{metrics.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value == null ? <span className="lc-unknown">Not reported</span> : item.time ? stamp(item.value) : item.text ? item.value : <>{number(item.value)}{item.unit && <small> {item.unit}</small>}</>}</dd></div>)}</dl>;
}
function History({ entries, heading = 'Reported activity' }) {
  return <section className="lc-history"><h3>{heading}</h3><p className="lc-hint">Reported entries may include presence heartbeats. They are not proof of a completed fetch or delivery.</p>
    {entries.length ? <ol>{entries.slice(0, 8).map((entry, index) => <li key={`${entry.id || entry.ts || ''}:${index}`}><time>{stamp(entry.ts)}</time><p>{excerpt(entry.msg) || 'Activity reported without a description.'}</p></li>)}</ol> : <p className="lc-empty">No recent entries reported for this selection.</p>}
  </section>;
}

function Building({ district, selected, onEnter, animationIndex }) {
  const { x, y, height: h, color } = district;
  const w = 70, d = 35;
  return <g transform={`translate(${x} ${y})`} className={`lc-building ${selected ? 'lc-building-selected' : ''}`} role="button" tabIndex={0}
    aria-label={`Enter ${district.label}`} aria-pressed={selected} data-stage={district.id} data-state={district.state}
    onClick={onEnter} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEnter(); } }}
    data-active={String(district.active)} style={{ '--district-color': color, '--motion-delay': `${animationIndex * -0.17}s` }}>
    <title>{district.label}: {stateName(district.state)}. Enter to inspect its levels.</title>
    <path className="lc-parcel" d="M-100 0 0-50 100 0 0 50Z" />
    <path className="lc-building-ring" d="M-108 0 0-54 108 0 0 54Z" />
    <path d={`M${-w} 0 0 ${d} ${w} 0 0 ${-d}Z`} fill="#080f1d" opacity=".7" transform="translate(8 12)" />
    <path className="lc-building-front" d={`M${-w} ${-h} 0 ${d - h} 0 ${d} ${-w} 0Z`} />
    <path className="lc-building-side" d={`M0 ${d - h} ${w} ${-h} ${w} 0 0 ${d}Z`} />
    <path className="lc-building-top" d={`M${-w} ${-h} 0 ${-d - h} ${w} ${-h} 0 ${d - h}Z`} />
    {Array.from({ length: Math.max(2, Math.floor(h / 22)) }, (_, floor) => <g key={floor} opacity=".65">
      {[0, 1, 2, 3].map(col => <path className="lc-building-window" key={col} d={`M${-57 + col * 14} ${-h + 15 + col * 7 + floor * 20}l8 4v8l-8-4Z`} fill={color} opacity={floor % 2 ? '.35' : '.75'} style={{ '--window-delay': `${(floor * 4 + col) * -0.11}s` }} />)}
      {[0, 1, 2, 3].map(col => <path className="lc-building-window" key={col} d={`M${10 + col * 14} ${-h + 38 - col * 7 + floor * 20}l8-4v8l-8 4Z`} fill={color} opacity=".3" style={{ '--window-delay': `${(floor * 4 + col + 2) * -0.13}s` }} />)}
    </g>)}
    <path d={`M-32 ${-h - 1} 0 ${-h - 17} 32 ${-h - 1} 0 ${-h + 15}Z`} fill="#111c31" stroke={color} strokeOpacity=".65" />
    <text x="0" y={-h + 4} textAnchor="middle" className="lc-roof-label" fill={color}>{district.short}</text>
    <path d={`M0 ${-h - 18}v-18`} stroke={color} strokeWidth="2" />
    <circle className="lc-building-beacon" cx="0" cy={-h - 39} r="4" fill={district.state === 'observed' ? color : district.state === 'degraded' ? '#fbbf24' : '#64748b'} />
    {district.agents.slice(0, 3).map((agent, index) => <g key={agent.key} transform={`translate(${-50 + index * 26} ${43 + index * 2})`} aria-hidden="true">
      <circle cy="-5" r="5" fill={color} /><path d="M-6 8v-4a6 6 0 0 1 12 0v4" stroke={color} strokeWidth="3" fill="none" />
    </g>)}
    <text x="0" y="79" textAnchor="middle" className="lc-building-label">{district.label}</text>
    <text x="0" y="98" textAnchor="middle" className="lc-building-sub">{roleName(district.role)} · {stateName(district.state)}</text>
  </g>;
}

function CityHome({ home, index, selected, onSelect }) {
  return <g transform={`translate(${home.x} ${home.y}) scale(.8)`} className="lc-map-home" data-home-id={home.id} data-home-state={home.homeState} data-block={home.block} data-town={home.town}
    role="button" tabIndex={0} aria-label={`Visit ${home.name}'s home · ${homeStateName(home.homeState)}`} aria-pressed={selected}
    onClick={onSelect} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); } }}
    style={{ '--home-color': home.color || '#64748b', '--home-delay': `${index * -0.17}s` }}>
    <title>{home.name} · {homeStateName(home.homeState)} · Home {index + 1}</title>
    <path className="lc-home-parcel" d="M-44 7 0-15 44 7 0 29Z" />
    <g className="lc-map-home-art">
      <path className="lc-home-wall" d="M-28-15 0-1 28-15V9L0 23-28 9Z" />
      <path className="lc-home-roof" d="M-34-16-8-40 34-17 0 0Z" />
      <path d="M-8-40 34-17 8-28Z" fill="#263c50" />
      <path className="lc-home-window" d="M-20-8-12-4V4L-20 0ZM9 0 17-4V4L9 8Z" />
      <path d="M-4 9 3 12v10l-7-3Z" fill="#09121d" />
      <path className="lc-home-chimney" d="M16-26v-12" stroke="#71869a" strokeWidth="5" />
      <circle className="lc-home-smoke" cx="16" cy="-43" r="3" fill="#b2cbd3" />
    </g>
    <circle className="lc-home-state-light" cx="34" cy="18" r="4" />
    <text y="45" textAnchor="middle" className="lc-home-address">{String(index + 1).padStart(2, '0')} · {home.name.length > 13 ? `${home.name.slice(0, 12)}…` : home.name}</text>
    <text y="60" textAnchor="middle" className="lc-home-map-state">{homeStateName(home.homeState)}</text>
  </g>;
}

function CityTraffic({ homes, highway, speed, motionScope }) {
  return <g className="lc-city-traffic" aria-hidden="true">
    {homes.filter(home => motionScope === 'all' || home.homeState === 'working').map(home => {
      const duration = (64 + home.index % 7 * 4) / speed;
      const timing = { '--trip-duration': `${duration}s`, '--trip-delay': `${-(home.index * 13.7 % 84) / speed}s`, '--commute-stop': `${home.commuteStop}%` };
      return <g key={home.id} data-resident={home.id}>
        <g className="lc-commuter" style={{ ...timing, offsetPath: `path('${home.commutePath}')` }}>
          <rect x="-9" y="-4" width="18" height="8" rx="3" fill={home.color || '#7dd3fc'} /><rect x="-3" y="-3" width="7" height="6" rx="1" fill="#173049" /><path d="M8-3v6" stroke="#fff6c1" strokeWidth="2" />
        </g>
        <g className="lc-lunch-walker" style={{ ...timing, offsetPath: `path('${home.lunchPath}')` }}>
          <circle r="4" fill={home.color || '#7dd3fc'} /><circle cx="2" r="2" fill="#f0d3b9" />
        </g>
      </g>;
    })}
    {Array.from({ length: 16 }, (_, index) => <g key={index} className="lc-highway-car" style={{ offsetPath: `path('${highway}')`, '--trip-duration': `${(44 + index % 4 * 8) / speed}s`, '--trip-delay': `${-index * 5 / speed}s` }}>
      <rect x="-9" y="-4" width={index % 5 === 0 ? 24 : 18} height="8" rx="3" fill={['#94a3b8', '#d5dde5', '#fbbf24', '#60a5fa'][index % 4]} /><rect x="-3" y="-3" width="6" height="6" rx="1" fill="#193247" />
    </g>)}
  </g>;
}

function CityMap({ model, selected, selectedAgent, onSelectAgent, onEnter, paused, setPaused, reduced, speed, setSpeed, motionScope, setMotionScope }) {
  const [zoom, setZoom] = useState(1), [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dimension, setDimension] = useState('3d'), [cameraReset, setCameraReset] = useState(0), [graphicsFallback, setGraphicsFallback] = useState(false);
  const [area, setArea] = useState('all'), [homeFilter, setHomeFilter] = useState('all');
  const drag = useRef(null);
  const city = useMemo(() => buildCityStreets(model), [model]);
  const mapView = area === 'homes' ? city.homesView : area === 'services' ? city.buildingsView : city.viewBox;
  const [viewX, viewY, viewWidth, viewHeight] = mapView.split(' ').map(Number);
  const centerX = viewX + viewWidth / 2, centerY = viewY + viewHeight / 2;
  const homeTotals = model.homes.reduce((counts, home) => ({ ...counts, [home.homeState]: (counts[home.homeState] || 0) + 1 }), {});
  const hasWork = model.edges.some(edge => edge.active);
  const motion = reduced ? 'reduced' : paused ? 'paused' : hasWork || motionScope === 'all' ? 'active' : 'idle';
  const reset = () => { setZoom(1); setOffset({ x: 0, y: 0 }); setCameraReset(value => value + 1); };
  function move(event) {
    if (!drag.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = event.currentTarget.viewBox.baseVal.width / bounds.width;
    setOffset({ x: Math.max(-500, Math.min(500, drag.current.x + (event.clientX - drag.current.pointerX) * ratio)), y: Math.max(-350, Math.min(350, drag.current.y + (event.clientY - drag.current.pointerY) * ratio)) });
  }
  return <section className="lc-map-panel" aria-label="Service city map">
    <div className="lc-map-toolbar"><div><span className="lc-eyebrow">CITY MAP · {model.homes.length} HOMES</span><span className="lc-map-caption">Enter a building or visit an agent’s home</span></div><div className="lc-map-tools">
      <button type="button" aria-label="Zoom out" disabled={zoom <= .8} onClick={() => setZoom(value => Math.max(.8, +(value - .2).toFixed(1)))}><Minus size={16} /></button>
      <output aria-label="Map zoom">{Math.round(zoom * 100)}%</output>
      <button type="button" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, +(value + .2).toFixed(1)))}><Plus size={16} /></button>
      <button type="button" aria-label="Reset view" title="Reset view" onClick={reset}><Focus size={16} /></button>
      <label className="lc-speed"><span>Motion speed</span><select aria-label="City motion speed" value={speed} disabled={reduced} onChange={event => setSpeed(Number(event.target.value))}><option value="0.5">0.5x</option><option value="1">1x</option><option value="1.75">1.75x</option></select></label>
      <button type="button" className="lc-scope-button" aria-label="Change animation scope" aria-pressed={motionScope === 'all'} disabled={reduced} title="All animates every city element; observed limits strong motion to reported activity." onClick={() => setMotionScope(value => value === 'all' ? 'observed' : 'all')}><Activity size={15} /><span>{motionScope === 'all' ? 'All city' : 'Observed'}</span></button>
      <button type="button" className="lc-motion-button" aria-label={paused ? 'Resume motion' : 'Pause motion'} aria-pressed={paused} disabled={reduced} title={reduced ? 'Reduced motion is enabled in your system settings' : undefined} onClick={() => setPaused(value => !value)}>{paused || reduced ? <Play size={15} /> : <Pause size={15} />}<span>{reduced ? 'Reduced motion' : paused ? 'Resume' : 'Pause'}</span></button>
    </div></div>
    <div className="lc-city-navigation"><div className="lc-area-controls" aria-label="City map view">{[['3d', '3D city'], ['plan', 'Street map']].map(([id, label]) => <button type="button" key={id} aria-pressed={dimension === id} onClick={() => { setDimension(id); reset(); }}>{label}</button>)}</div><div className="lc-area-controls" aria-label="City map area">{[['all', 'All'], ['services', 'Buildings'], ['homes', 'Homes']].map(([id, label]) => <button type="button" key={id} aria-pressed={area === id} title={id === 'all' ? 'The whole region in 3D: downtown, every town, the roads and the grid' : undefined} onClick={() => { setArea(id); if (id === 'all' && !graphicsFallback) setDimension('3d'); reset(); }}>{label}</button>)}</div>
      <div className="lc-home-controls" aria-label="Filter agent homes">{['all', 'working', 'inactive', 'attention', 'unobserved'].map(state => <button type="button" key={state} aria-pressed={homeFilter === state} onClick={() => setHomeFilter(state)}>{state === 'all' ? `All ${model.homes.length}` : `${homeStateName(state)} ${homeTotals[state] || 0}`}</button>)}</div>
    </div>
    {graphicsFallback && <p className="lc-hint">Street map is available while 3D graphics are unavailable on this device.</p>}
    <div className="lc-canvas" data-motion={motion} data-zoom={zoom} data-area={area}>
      {dimension === '3d' ? <Suspense fallback={<div className="lc-3d-loading">Opening the city…</div>}><CityScene3D city={city} edges={model.edges} motion={motion} speed={speed} motionScope={motionScope} homeFilter={homeFilter} area={area} zoom={zoom} resetKey={cameraReset} selectedHomeId={selectedAgent?.id} onEnter={onEnter} onSelectAgent={onSelectAgent} onFallback={() => { setGraphicsFallback(true); setDimension('plan'); }} /></Suspense> : <svg viewBox={mapView} aria-label="Live city: a logical map of UFIConnect services and agent homes" onPointerDown={event => {
        if (event.button !== 0 || event.target.closest('[role="button"]')) return;
        drag.current = { pointerX: event.clientX, pointerY: event.clientY, ...offset }; event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <defs>
          <pattern id="lc-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#294638" strokeWidth=".6" /></pattern>
          <radialGradient id="lc-ground"><stop stopColor="#15364c" stopOpacity=".5" /><stop offset="1" stopColor="#080e19" stopOpacity="0" /></radialGradient>
        </defs>
        <rect x={city.minX} y={city.minY} width={city.width} height={city.height} fill="#0d211f" /><rect x={city.minX} y={city.minY} width={city.width} height={city.height} fill="url(#lc-grid)" opacity=".4" />
        <g transform={`translate(${centerX + offset.x} ${centerY + offset.y}) scale(${zoom}) translate(${-centerX} ${-centerY})`}>
          <g className="lc-town-grounds" aria-hidden="true">{city.towns.map(town => <rect key={town.id} x={town.left - 24} y={town.top - 24} width={town.right - town.left + 48} height={town.bottom - town.top + 48} rx="30" fill="#152a2b" stroke="#2d4744" strokeWidth="2" />)}
            <rect x="20" y="20" width={city.downtown.width - 40} height={city.downtown.height - 40} rx="40" fill="#142629" stroke="#2d4744" strokeWidth="2" /></g>
          <g className="lc-city-blocks" aria-hidden="true">{city.blocks.map(block => block.kind === 'town' ? <g key={block.id} data-town-block={block.town}>
            <rect x={block.x - block.lawn[0] / 2} y={block.y - block.lawn[1] / 2} width={block.lawn[0]} height={block.lawn[1]} rx="16" fill="#1a3031" stroke="#35504c" strokeWidth="2" />
            {block.trees.map(([x, y]) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}><ellipse cy="6" rx="10" ry="5" fill="#091c20" /><circle cy="-8" r="11" fill="#2b5146" /><circle cx="-3" cy="-12" r="6" fill="#467657" /></g>)}
          </g> : <g key={block.id}>
            <rect x={block.x - 160} y={block.y - 150} width="320" height="300" rx="18" fill="#1a3031" stroke="#35504c" strokeWidth="2" />
            <rect x={block.x - 108} y={block.y - 120} width="216" height="237" rx="12" fill="#142a31" />
            {[-1, 1].flatMap(side => [-115, -30].map((dy, i) => <g key={`${side}-${dy}`} transform={`translate(${block.x + side * 86} ${block.y + dy})`}>
              <ellipse cy="6" rx="12" ry="6" fill="#091c20" /><path d="M0 8V-8" stroke="#627760" strokeWidth="3" /><circle cy="-12" r={i === 1 ? 11 : 14} fill={i % 2 ? '#355c48' : '#2b5146'} /><circle cx="-4" cy="-17" r="7" fill="#467657" />
            </g>))}
          </g>)}</g>
          <g className="lc-street-grid" aria-label="Connected city street grid">{city.roads.map((d, i) => <g key={i}>
            <path d={d} fill="none" stroke="#536069" strokeWidth="30" /><path d={d} fill="none" stroke="#23323e" strokeWidth="24" /><path d={d} fill="none" stroke="#819293" strokeWidth="1" strokeDasharray="8 10" />
          </g>)}</g>
          <g className="lc-city-highways" aria-label="Downtown highway loop, central expressway and the beltway joining the towns">
            {[city.highway, `M800 40V${city.downtown.bottom}`, ...city.beltway].map((d, i) => <g key={i}>
              <path d={d} fill="none" stroke="#789091" strokeWidth="46" /><path d={d} fill="none" stroke="#1e2c39" strokeWidth="40" /><path d={d} fill="none" stroke="#59685d" strokeWidth="4" /><path d={d} fill="none" stroke="#b3b39b" strokeWidth="1" strokeDasharray="10 12" />
            </g>)}
            <text x="1140" y="29" className="lc-street-label">NORTH LOOP · H1</text><text x="813" y="65" className="lc-street-label">CENTRAL EXPRESSWAY</text>
          </g>
          <g className="lc-city-crosswalks" aria-hidden="true">{city.blocks.filter(block => block.kind === 'downtown').map(block => <g key={block.id}>
            <path d={`M${block.x - 160} ${block.bottom - 9}v18M${block.x + 160} ${block.bottom - 9}v18`} stroke="#c9d0bd" strokeWidth="16" strokeDasharray="2 3" opacity=".6" />
            <text x={block.x} y={block.bottom - 22} textAnchor="middle" className="lc-street-label">{['COLLECTION AVENUE', 'CIVIC BOULEVARD', 'DELIVERY WAY'][block.row % 3]}</text>
          </g>)}</g>
          <g className="lc-city-driveways" aria-hidden="true">{city.homes.map(home => <path key={home.id} d={home.driveway} />)}{city.districts.map(district => <path key={district.id} d={`M${district.x} ${district.y + 38}V${district.streetY}`} />)}</g>
          <g className="lc-arrival-courts" aria-label="Workplace garages with separate arrival and departure lanes">{city.districts.map(district => <g key={district.id} data-garage={district.id}>
            <title>{district.label}: eight arrival bays and indoor parking for {district.residents} residents.</title>
            <path d={district.arrivalPath} fill="none" stroke="#52666d" strokeWidth="30" strokeLinejoin="round" />
            <path d={district.arrivalPath} fill="none" stroke="#23343e" strokeWidth="24" strokeLinejoin="round" />
            <path d={district.arrivalPath} fill="none" stroke="#a6bba8" strokeWidth="1" strokeDasharray="6 7" />
            {district.accessRoutes.map(route => <g key={route.id} data-source-route={route.id} aria-label={route.id === 'in' ? 'Source collection entrance from west street' : 'Source collection exit to east street'}>
              <path d={route.path} fill="none" stroke={route.color} strokeWidth="3" />
              <path d={`M${(route.points[0][0] + route.points[1][0]) / 2 - 5} ${route.points[0][1] - 6}l7 6-7 6`} fill="none" stroke={route.color} strokeWidth="3" />
              <text x={(route.points[0][0] + route.points[1][0]) / 2} y={route.points[0][1] + 27} textAnchor="middle" className="lc-street-label" style={{ fill: route.color }}>{route.label}</text>
            </g>)}
            <rect x={district.x - 82} y={district.y + 103} width="164" height="21" rx="3" fill="#425c68" stroke="#849eaa" />
            {district.bays.map(([x, y], index) => <g key={index}><rect x={x - 6} y={y - 4} width="12" height="9" fill="#122a34" /><path d={`M${x - 8} ${y + 6}v10m16-10v10`} stroke="#8fa89f" strokeWidth="1" /></g>)}
          </g>)}</g>
          {model.edges.map(edge => <g key={`${edge.from}-${edge.to}`} className="lc-road" data-from={edge.from} data-to={edge.to} data-active={String(edge.active)} aria-hidden="true">
            <path className="lc-road-flow" d={city.servicePath(edge.from, edge.to)} fill="none" stroke={model.byId[edge.from].color} strokeWidth="3" strokeLinecap="round" />
          </g>)}
          <g className="lc-city-cafes" aria-label="Lunch cafes and public gardens">{city.cafes.map((cafe, index) => <g key={cafe.label} transform={`translate(${cafe.x} ${cafe.y})`}>
            <rect x="-150" y="-58" width="300" height="118" rx="22" fill="#213e35" stroke="#3c5d48" />
            <path d="M0 24V68" stroke="#647367" strokeWidth="7" />
            <path d="M-48-12 0 12 48-12V16L0 40-48 16Z" fill="#6b7060" /><path d="M-54-14 0-42 54-14 0 14Z" fill={['#6d8893', '#608a78', '#8a8270', '#587b86'][index]} />
            <path d="M-40 0 0 20 40 0" stroke="#e2c9a0" strokeWidth="7" />
            {[-100, 100].map(x => <g key={x} transform={`translate(${x} 0)`}><circle r="19" fill="#927f5d" /><path d="M-19 0H19M0-19V19" stroke="#e5d3a8" strokeWidth="2" /><circle cy="25" r="4" fill="#849b89" /><circle cy="-25" r="4" fill="#849b89" /></g>)}
            <text y="-46" textAnchor="middle" className="lc-cafe-label">{cafe.label}</text>
          </g>)}</g>
          {city.districts.map((district, index) => <Building key={district.id} district={district} selected={selected === district.id} animationIndex={index} onEnter={() => onEnter(district.id)} />)}
          <g className="lc-map-homes" aria-label="Agent homes">{city.homes.map((home, index) => (homeFilter === 'all' || home.homeState === homeFilter) && <CityHome key={home.id} home={home} index={index} selected={selectedAgent?.id === home.id} onSelect={() => onSelectAgent(home.primaryKey)} />)}</g>
          <CityTraffic homes={city.homes.filter(home => homeFilter === 'all' || home.homeState === homeFilter)} highway={city.highway} speed={speed} motionScope={motionScope} />
          <g className="lc-town-labels" aria-label="Towns">{city.towns.map(town => <g key={town.id} data-town={town.id} aria-label={`${town.name}: ${town.homes.length} homes. ${town.label}.`}>
            <text x={town.x} y={town.top - 58} textAnchor="middle" className="lc-town-name">{town.name}</text>
            <text x={town.x} y={town.top - 36} textAnchor="middle" className="lc-street-label">{town.label.toUpperCase()}</text>
          </g>)}<text x="800" y="16" textAnchor="middle" className="lc-town-name">Downtown</text></g>
          {!model.homes.length && <text x="800" y={city.downtown.height - 65} textAnchor="middle" className="lc-home-address">Waiting for the protected agent registry</text>}
        </g>
      </svg>}
      <div className="lc-map-live"><span className={motion === 'active' ? 'lc-dot-active' : ''} />{motion === 'active' ? `${motionScope === 'all' ? 'Whole city' : 'Observed activity'} / ${speed}x` : motion === 'paused' ? 'Motion paused' : motion === 'reduced' ? 'Reduced motion' : 'No recent work to animate'}</div>
    </div>
    <div className="lc-map-legend"><p><Home size={14} />Green: working · Gray: inactive · Amber: attention · Dim: unobserved.</p>{dimension === '3d' && <p><Activity size={14} />Downtown holds every building; agents live in towns named for where they work, joined to downtown by the beltway. Streets carry each commute. The grid, the lines on utility poles, links buildings that hand work to each other; pulses run along a line while the services report that handoff active.</p>}<p>Source collection: blue entrance from the west, green exit to the east. Indoor parking keeps entrances clear. Commutes are illustrative; status labels use live telemetry.</p></div>
    <div className="lc-district-nav" aria-label="Enter city buildings">{model.districts.map(district => <button key={district.id} type="button" aria-pressed={selected === district.id} onClick={() => onEnter(district.id)} style={{ '--district-color': district.color }}><span />{district.label}</button>)}</div>
  </section>;
}

function BuildingInterior({ district, model, onClose, onSelectAgent, interiorRef }) {
  const [visibleLevel, setVisibleLevel] = useState(1);
  useEffect(() => setVisibleLevel(1), [district.id]);
  const upstream = model.edges.filter(edge => edge.to === district.id).map(edge => model.byId[edge.from]?.label).filter(Boolean);
  const downstream = model.edges.filter(edge => edge.from === district.id).map(edge => model.byId[edge.to]?.label).filter(Boolean);
  const moveTo = level => {
    const target = interiorRef.current?.querySelector(`[data-level="${level}"]`);
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setVisibleLevel(level);
  };
  return <section className="lc-interior" aria-label={`${district.label} building interior`} ref={interiorRef} tabIndex={-1} style={{ '--district-color': district.color }}>
    <header className="lc-interior-header"><div><span className="lc-eyebrow"><Building2 size={14} /> BUILDING INTERIOR / {roleName(district.role)}</span><h2>{district.label}</h2><p>{district.description}</p></div><button type="button" className="lc-interior-close" onClick={onClose} aria-label={`Exit ${district.label}`}><X size={17} /> Exit building</button></header>
    <div className="lc-building-flow" aria-label="Building route"><span>{upstream.length ? upstream.join(' + ') : 'External inputs'}</span><ChevronRight size={15} /><strong>{district.label}</strong><ChevronRight size={15} /><span>{downstream.length ? downstream.join(' + ') : 'Observed operations'}</span></div>
    <div className="lc-interior-body">
      <nav className="lc-elevator" aria-label={`${district.label} levels`}><span>ELEVATOR</span>{district.levels.map(item => <button type="button" key={item.id} aria-current={visibleLevel === item.number ? 'step' : undefined} onClick={() => moveTo(item.number)}><b>{String(item.number).padStart(2, '0')}</b><small>{item.title}</small></button>)}</nav>
      <div className="lc-level-stack" tabIndex={0} aria-label={`Scrollable levels in ${district.label}`} onScroll={event => {
        const frame = event.currentTarget.getBoundingClientRect();
        const cards = [...event.currentTarget.querySelectorAll('[data-level]')];
        const closest = cards.sort((a, b) => Math.abs(a.getBoundingClientRect().top - frame.top) - Math.abs(b.getBoundingClientRect().top - frame.top))[0];
        if (closest) setVisibleLevel(Number(closest.dataset.level));
      }}>
        {district.levels.map(item => <article className="lc-level" key={item.id} data-level={item.number} aria-label={`Level ${item.number}: ${item.title}`}>
          <header><span>LEVEL {String(item.number).padStart(2, '0')}</span><div><h3>{item.title}</h3><p>{item.purpose}</p></div></header>
          <div className="lc-level-route"><section><h4>What enters</h4><ul>{item.pulls.map(value => <li key={value}>{value}</li>)}</ul></section><section><h4>How it works</h4><ol>{item.process.map(value => <li key={value}>{value}</li>)}</ol></section><section><h4>What leaves</h4><ul>{item.outputs.map(value => <li key={value}>{value}</li>)}</ul></section></div>
          <section className="lc-level-evidence"><div><h4><Activity size={14} /> Live evidence</h4><Status state={district.state} /></div><MetricGrid metrics={item.metrics} />
            {!!item.breakdown.length && <div className="lc-level-breakdown"><h4>What is currently represented</h4><ul>{item.breakdown.slice(0, 71).map((entry, index) => <li key={`${entry.label}:${index}`}><span>{entry.label}<small>{entry.detail}</small></span><strong>{typeof entry.value === 'number' ? number(entry.value) : entry.value || 'Not reported'}</strong></li>)}</ul></div>}
          </section>
          {item.number === district.levels.length && <section className="lc-level-agents"><h4>Agents connected to this building</h4>{district.agents.length ? <div>{district.agents.map(agent => <button type="button" key={agent.key} onClick={() => onSelectAgent(agent.key)}>{agent.name}<small>{roleName(agent.serviceRole)}</small></button>)}</div> : <p>No agent instance is assigned here; this building is driven by service-stage telemetry.</p>}</section>}
        </article>)}
      </div>
    </div>
    <footer><span>Scroll the level deck or use the elevator.</span><span>Unknown means the owning service did not report that measurement.</span></footer>
  </section>;
}

function chatError(status) {
  if (status === 401 || status === 403) return 'Office access is required. Reconnect your Office session and try again.';
  if (status === 404) return 'Agent chat is unavailable on this service version. Refresh after the service is updated.';
  if (status === 429) return 'This agent is handling another request or its request limit was reached. Try again shortly.';
  if (status === 400 || status === 413) return 'That message could not be accepted. Try a shorter question about this agent.';
  return 'The agent service is unavailable. Your message was not completed. Try again shortly.';
}

function AgentChat({ agent, officeFetch, base, messages, updateMessages }) {
  const [draft, setDraft] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(null);
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current += 1; pending.current?.abort(); }, []);
  function clear() { sequence.current += 1; pending.current?.abort(); pending.current = null; setBusy(false); setError(''); setDraft(''); updateMessages([]); }
  async function send(event) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy || !knownRole(agent.serviceRole)) return;
    const token = ++sequence.current, controller = new AbortController();
    pending.current = controller; setBusy(true); setError('');
    const history = messages.filter(item => item.role === 'user').slice(-4).map(item => ({ role: 'user', content: item.content.slice(0, 1200) }));
    while (history.length && new TextEncoder().encode(JSON.stringify({ message, history })).length > 7800) history.shift();
    const sentMessages = [...messages, { role: 'user', content: message }].slice(-12);
    updateMessages(sentMessages); setDraft('');
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 35_000);
    try {
      const response = await officeFetch(`${String(base || '').replace(/\/$/, '')}/office/agents/${encodeURIComponent(agent.id)}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, history }), signal: controller.signal,
      });
      if (!response.ok) throw Object.assign(new Error('Agent request failed'), { status: response.status });
      const data = await response.json();
      if (data?.agentId !== agent.id || data?.serviceRole !== agent.serviceRole || !['ai', 'diagnostics'].includes(data?.mode) || typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('Invalid agent reply');
      if (sequence.current !== token || controller.signal.aborted) return;
      updateMessages([...sentMessages, { role: 'assistant', content: data.reply.slice(0, 6000), mode: data.mode, observedAt: data.observedAt,
        suggestions: Array.isArray(data.suggestions) ? data.suggestions.filter(item => typeof item === 'string').slice(0, 4).map(item => item.slice(0, 160)) : [] }].slice(-12));
    } catch (failure) {
      if (sequence.current === token && (!controller.signal.aborted || timedOut)) setError(timedOut ? 'The agent took too long to respond. Try again shortly.' : chatError(failure.status));
    } finally {
      clearTimeout(timeout);
      if (sequence.current === token) { pending.current = null; setBusy(false); }
    }
  }
  const suggestions = messages.at(-1)?.suggestions || [];
  return <section className="lc-chat" aria-label="Agent conversation"><div className="lc-section-heading"><h3><MessageSquare size={16} /> Ask this agent</h3><button type="button" aria-label="Clear conversation" onClick={clear} disabled={!messages.length && !busy && !draft}><Trash2 size={14} />Clear</button></div>
    <p className="lc-hint">Read-only explanations of this service’s observations. AI responses are labeled; diagnostics work without AI. Chat cannot trigger jobs or change settings.</p>
    <div className="lc-chat-history" role="log" aria-live="polite" aria-relevant="additions text" aria-label={`${agent.name} conversation`}>
      {!messages.length && <div className="lc-chat-empty"><MessageSquare size={24} /><p>Ask about health, recent work, failures, or the next check.</p></div>}
      {messages.map((item, index) => <article className={`lc-message lc-message-${item.role}`} key={index}><header>{item.role === 'user' ? 'You' : item.mode === 'ai' ? 'AI explanation' : 'Diagnostics reply'}{item.observedAt && <time>{stamp(item.observedAt)}</time>}</header><p>{item.content}</p></article>)}
      {busy && <p className="lc-chat-wait" role="status">Reading this agent’s observations…</p>}
    </div>
    {error && <p role="alert" className="lc-error">{error}</p>}
    {!!suggestions.length && <div className="lc-suggestions">{suggestions.map(suggestion => <button type="button" key={suggestion} disabled={busy} onClick={() => setDraft(suggestion)}>{suggestion}</button>)}</div>}
    <form onSubmit={send}><label htmlFor="lc-agent-message">Message this agent</label><textarea id="lc-agent-message" rows={3} maxLength={1200} value={draft} onChange={event => setDraft(event.target.value)} placeholder="What needs attention in your service?" disabled={!knownRole(agent.serviceRole)} />
      <div className="lc-compose-footer"><small>{draft.length}/1200 · memory only</small><button type="submit" disabled={busy || !draft.trim() || !knownRole(agent.serviceRole)}><Send size={14} />Send message</button></div>
    </form><p className="lc-hint">Up to 12 messages per conversation, in this page only. Clear removes this local history.</p>
  </section>;
}

function AgentInspector({ agent, model, officeFetch, apiBase, pipelineBase, onNavigate, messages, updateMessages }) {
  const health = agent.health || {};
  const state = agent.observation !== 'fresh' ? agent.observation : health.status || 'unknown';
  const entries = Array.isArray(agent.logs) ? agent.logs : model.log.filter(item => item.agentId === agent.id && item.serviceRole === agent.serviceRole);
  return <><div className="lc-inspector-header"><span className="lc-eyebrow">AGENT / {roleName(agent.serviceRole)}</span><h2>{agent.name}</h2><Status state={state} /><p>{excerpt(agent.description) || 'No description reported by this service.'}</p></div>
    {agent.executionRole === 'pipeline' && agent.serviceRole !== 'pipeline' && <p className="lc-notice">This is the API’s registry entry. Source fetching belongs to Pipeline; select that service’s instance to inspect its work.</p>}
    {agent.observation !== 'fresh' && <p className="lc-notice" role="status">Agent observations are {stateName(agent.observation).toLowerCase()}. Displayed values describe the last received snapshot.</p>}
    <MetricGrid metrics={[
      { label: 'Service', value: roleName(agent.serviceRole), text: true }, { label: 'Execution role', value: agent.executionRole || null, text: true },
      { label: 'Configured cadence', value: agent.interval || null, text: true }, { label: 'Reported posts', value: cityNumber(agent.postCount) },
      { label: 'Fetch count', value: cityNumber(health.fetchCount) }, { label: 'Total errors', value: cityNumber(health.totalErrors) },
      { label: 'Consecutive errors', value: cityNumber(health.consecutiveErrors) }, { label: 'Last successful work', value: cityTimestamp(health.lastSuccess), time: true },
      { label: 'Last fetch', value: cityTimestamp(agent.lastFetch), time: true }, { label: 'Registry received', value: cityTimestamp(agent.receivedAt), time: true },
    ]} />
    {health.lastError && <p className="lc-notice">This service reports an agent error. Inspect its protected service logs for details.</p>}
    <div className="lc-crosslinks"><button type="button" onClick={() => onNavigate('agents')}>Open Agents <ArrowUpRight size={14} /></button><button type="button" onClick={() => onNavigate('post-pipeline')}>Open Post Pipeline <ArrowUpRight size={14} /></button></div>
    <AgentChat key={agent.key} agent={agent} officeFetch={officeFetch} base={agent.serviceRole === 'pipeline' ? pipelineBase : apiBase} messages={messages} updateMessages={updateMessages} />
    <History entries={entries} />
  </>;
}

function DistrictInspector({ district, onNavigate, onSelectAgent, onEnter }) {
  return <><div className="lc-inspector-header" style={{ '--district-color': district.color }}><span className="lc-eyebrow">DISTRICT / {roleName(district.role)}</span><h2>{district.label}</h2><Status state={district.state} /><p>{district.description}</p></div>
    {district.observation.state !== 'fresh' && <p className="lc-notice" role="status">{safeObservationError(district.observation.error) || `${roleName(district.role)} telemetry is ${stateName(district.observation.state).toLowerCase()}.`} Movement stops until fresh observations arrive.</p>}
    {district.error && <p className="lc-notice">This stage reports a problem. Review its detailed operations view and service logs.</p>}
    <MetricGrid metrics={district.metrics} />
    <div className="lc-crosslinks"><button type="button" onClick={onEnter}>Enter all {district.levels.length} levels <Building2 size={14} /></button><button type="button" onClick={() => onNavigate('post-pipeline')}>Open Post Pipeline <ArrowUpRight size={14} /></button>{district.link !== 'post-pipeline' && <button type="button" onClick={() => onNavigate(district.link)}>Open {({ sources: 'Sources', pipeline: 'Pipeline', overview: 'Overview', agents: 'Agents', controls: 'Controls' }[district.link])} <ArrowUpRight size={14} /></button>}</div>
    {!!district.breakdown.length && <section className="lc-breakdown"><h3>Reported breakdown</h3><ul>{district.breakdown.slice(0, 60).map((item, index) => <li key={`${item.label}:${index}`}><span>{item.label}<small>{item.detail}</small></span><strong>{typeof item.value === 'number' ? number(item.value) : item.value || 'Not reported'}</strong></li>)}</ul></section>}
    <section className="lc-residents"><h3>Agents in this district <span>{district.agents.length}</span></h3>{district.agents.length ? district.agents.map(agent => <button type="button" key={agent.key} onClick={() => onSelectAgent(agent.key)}><span>{agent.name}<small>{roleName(agent.serviceRole)} · {stateName(agent.observation === 'fresh' ? agent.health?.status : agent.observation)}</small></span><ChevronRight size={16} /></button>) : <p className="lc-empty">No agent instance reported for this district. The district can still report service metrics.</p>}</section>
    {!!district.history.length && <History entries={district.history} heading={district.id === 'transfer' ? 'Recent transfer runs' : 'Reported activity'} />}
  </>;
}

export default function LiveCity({ status, pipelineStatus, agents = {}, log = [], telemetry = {}, officeFetch, apiBase = '', pipelineBase = '', onNavigate = () => {} }) {
  const [now, setNow] = useState(Date.now), [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1), [motionScope, setMotionScope] = useState('all');
  const [reduced, setReduced] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [selection, setSelection] = useState({ type: 'district', id: 'sources' });
  const [interior, setInterior] = useState(null);
  const [query, setQuery] = useState(''), [service, setService] = useState('all'), [healthFilter, setHealthFilter] = useState('all');
  const [conversations, setConversations] = useState({});
  const inspector = useRef(null);
  const interiorPanel = useRef(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return undefined;
    const update = () => setReduced(media.matches); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const model = useMemo(() => buildCityModel({ status, pipelineStatus, agents, log, telemetry, now }), [status, pipelineStatus, agents, log, telemetry, now]);
  const selectedAgent = selection.type === 'agent' ? model.agents.find(agent => agent.key === selection.id) : null;
  const selectedDistrict = model.byId[selection.type === 'district' ? selection.id : selectedAgent?.district] || model.byId.sources;
  const interiorDistrict = model.byId[interior] || null;
  const filteredAgents = model.agents.filter(agent => (service === 'all' || agent.serviceRole === service)
    && (healthFilter === 'all' || (healthFilter === 'attention' ? agent.observation !== 'fresh' || ['degraded', 'error', 'paused'].includes(agent.health?.status) : agent.observation === 'fresh'))
    && `${agent.name} ${agent.id} ${agent.district}`.toLowerCase().includes(query.trim().toLowerCase()));
  const motionState = reduced ? 'reduced' : paused ? 'paused' : 'active';
  function select(type, id) {
    setInterior(null);
    setSelection({ type, id });
    // Selection is an explicit request to inspect. Keep its result reachable on
    // small screens, where the inspector follows the map and bounded directory.
    window.requestAnimationFrame(() => {
      const target = inspector.current;
      if (!target) return;
      target.scrollTop = 0;
      const navigation = document.querySelector('nav[aria-label="Office sections"]')?.closest('aside');
      const stickyHeader = navigation && window.getComputedStyle(navigation).position === 'sticky';
      target.style.scrollMarginTop = `${stickyHeader ? navigation.getBoundingClientRect().height + 12 : 16}px`;
      target.focus({ preventScroll: true });
      if (window.matchMedia('(max-width: 1190px)').matches) target.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    });
  }
  function enterBuilding(id) {
    setSelection({ type: 'district', id });
    setInterior(id);
    window.requestAnimationFrame(() => {
      const target = interiorPanel.current;
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    });
  }
  function updateMessages(key, messages) { setConversations(current => {
    const next = { ...current }; delete next[key]; next[key] = messages;
    return Object.fromEntries(Object.entries(next).slice(-8));
  }); }
  return <section className="live-city" data-testid="live-city" aria-label="Live City" data-motion={motionState} data-animation-scope={motionScope} style={{ '--lc-fast-motion': `${1.4 / speed}s`, '--lc-medium-motion': `${2.8 / speed}s`, '--lc-slow-motion': `${4.8 / speed}s` }}>
    <header className="lc-page-header"><div><div className="lc-eyebrow"><span className="lc-brand-mark"><Layers3 size={14} /></span> UFICONNECT / SERVICE OBSERVATORY</div><h1>Live City<span>.</span></h1><p>A working map of your platform. Follow the content. Meet the agents. Inspect the evidence.</p></div><button type="button" className="lc-open-pipeline" onClick={() => onNavigate('post-pipeline')}>Explore post history <ArrowUpRight size={16} /></button></header>
    <div className="lc-observations">{['api', 'pipeline'].map(role => <div className="lc-observation" key={role} data-service={role} data-freshness={model.observations[role].state}><span>{roleName(role)} telemetry</span><Status state={model.observations[role].state} /><small>{safeObservationError(model.observations[role].error) || age(model.observations[role].updatedAt, now)}</small></div>)}<div className="lc-observation"><span>Agent activity stream</span><strong className={model.streamConnected ? 'lc-stream-connected' : ''}><Radio size={13} />{model.streamConnected ? 'Connected' : 'Disconnected'}</strong><small>Connection only; not a work counter</small></div><div className="lc-observation"><span>Registered agent homes</span><strong>{model.homes.length}</strong><small>{model.agents.length} distinct service observations</small></div></div>
    <div className="lc-layout"><div className="lc-main"><CityMap model={model} selected={selectedDistrict.id} selectedAgent={selectedAgent} onSelectAgent={key => select('agent', key)} onEnter={enterBuilding} paused={paused} setPaused={setPaused} reduced={reduced} speed={speed} setSpeed={setSpeed} motionScope={motionScope} setMotionScope={setMotionScope} />
      {interiorDistrict && <BuildingInterior district={interiorDistrict} model={model} interiorRef={interiorPanel} onClose={() => { setInterior(null); window.requestAnimationFrame(() => inspector.current?.focus()); }} onSelectAgent={key => select('agent', key)} />}
      <section className="lc-roster" aria-label="Agent roster"><div className="lc-roster-heading"><div><span className="lc-eyebrow">WORKERS & OPERATIONS</span><h2>Agent directory <span>{filteredAgents.length}</span></h2></div><p>Real registered workers and operational agents.<br />Each service instance has its own observations.</p></div>
        <div className="lc-roster-tools"><label className="lc-search"><Search size={16} /><span className="lc-sr-only">Search agents</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search agents or districts" /></label><label><span className="lc-sr-only">Agent service</span><select aria-label="Agent service" value={service} onChange={event => setService(event.target.value)}><option value="all">All services</option><option value="api">API</option><option value="pipeline">Pipeline</option></select></label><label><span className="lc-sr-only">Agent observation filter</span><select aria-label="Agent observation filter" value={healthFilter} onChange={event => setHealthFilter(event.target.value)}><option value="all">All observations</option><option value="fresh">Fresh observations</option><option value="attention">Needs review</option></select></label></div>
        {!filteredAgents.length && <p className="lc-empty">{model.agents.length ? 'No agents match these filters.' : 'No agent registry received yet. Service telemetry and agent telemetry arrive independently.'}</p>}
        <div className="lc-agent-grid">{filteredAgents.map(agent => <button type="button" className={`lc-agent-card ${selectedAgent?.key === agent.key ? 'lc-agent-selected' : ''}`} key={agent.key} data-agent-id={agent.id} data-service={agent.serviceRole} aria-label={`Inspect ${agent.name} · ${roleName(agent.serviceRole)}`} aria-pressed={selectedAgent?.key === agent.key} onClick={() => select('agent', agent.key)}>
          <span className="lc-agent-avatar" style={{ '--district-color': model.byId[agent.district]?.color }} aria-hidden="true">{String(agent.emoji || agent.id.slice(0, 3)).slice(0, 4)}</span><span className="lc-agent-summary"><strong>{agent.name}</strong><small>{roleName(agent.serviceRole)} · {model.byId[agent.district]?.label}</small><Status state={agent.observation === 'fresh' ? agent.health?.status || 'unknown' : agent.observation} /></span><ChevronRight size={15} />
        </button>)}</div>
      </section></div>
      <aside className="lc-inspector" aria-label="City inspector" ref={inspector} tabIndex={-1}><div className="lc-inspector-topline"><span><CircleHelp size={14} /> INSPECTOR</span><span><ShieldCheck size={13} /> Read only</span></div>
        {selectedAgent ? <AgentInspector key={selectedAgent.key} agent={selectedAgent} model={model} officeFetch={officeFetch} apiBase={apiBase} pipelineBase={pipelineBase} onNavigate={onNavigate} messages={conversations[selectedAgent.key] || []} updateMessages={messages => updateMessages(selectedAgent.key, messages)} /> : <DistrictInspector district={selectedDistrict} onNavigate={onNavigate} onSelectAgent={key => select('agent', key)} onEnter={() => enterBuilding(selectedDistrict.id)} />}
        <div className="lc-inspector-footer"><Check size={13} />Values come from the selected service’s last observation.</div>
      </aside>
    </div>
    <footer className="lc-page-footer"><ArrowDownLeft size={15} /><span>Need an individual post’s route? Open Post Pipeline for retained stages, retries, reasons, and storage copies. This map does not track individual posts.</span></footer>
  </section>;
}
