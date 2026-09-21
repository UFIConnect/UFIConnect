import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownLeft, ArrowUpRight, Building2, Check, ChevronRight, CircleHelp, Focus, Home, Layers3, MessageSquare, Minus, Pause, Play, Plus, Radio, Search, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import { buildCityModel, cityNumber, cityTimestamp } from './city-model.mjs';
import './LiveCity.css';

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

function roadPath(from, to) {
  if (from.y === to.y) return `M${from.x} ${from.y + 30} L${to.x} ${to.y + 30}`;
  if (from.x === to.x) return `M${from.x} ${from.y + 30} L${from.x + 114} ${from.y + 87} L${to.x + 114} ${to.y - 40} L${to.x} ${to.y + 30}`;
  return `M${from.x} ${from.y + 30} L${from.x + 114} ${from.y + 87} L${to.x + 114} ${to.y - 40} L${to.x} ${to.y + 30}`;
}

const cityPhases = {
  morning: { label: 'Morning commute', detail: 'Agents are heading to work' },
  lunch: { label: 'Lunch hour', detail: 'Agents are out for lunch' },
  afternoon: { label: 'Workday', detail: 'Agents are running activities' },
  evening: { label: 'Evening return', detail: 'Agents are heading home' },
};

function CityActivity({ model, phase }) {
  const people = model.homes.slice(0, 18);
  const phaseInfo = cityPhases[phase];
  const positions = people.map((home, index) => {
    const column = index % 6;
    const row = Math.floor(index / 6);
    const base = phase === 'lunch' ? { x: 420 + column * 54, y: 690 + row * 44 } : phase === 'afternoon' ? { x: 180 + (index % 8) * 104, y: 360 + row * 34 } : { x: 112 + column * 105, y: 1060 + row * 88 };
    return { home, x: base.x, y: base.y, index };
  });
  return <g className="lc-city-activity" aria-label={`${phaseInfo.label}: ${phaseInfo.detail}`}>
    <g className="lc-activity-banner"><rect x="72" y="112" width="300" height="52" rx="8" /><text x="90" y="134">{phaseInfo.label.toUpperCase()}</text><text x="90" y="151">{phaseInfo.detail} · illustrative schedule</text></g>
    {positions.map(({ home, x, y, index }) => <g key={home.id} className="lc-activity-agent" transform={`translate(${x} ${y})`} style={{ '--activity-delay': `${index * -0.22}s`, '--activity-color': home.color || '#67e8f9' }}>
      <circle r="7" /><path d="M-8 14a8 8 0 0 1 16 0" /><text x="12" y="4">{home.name.length > 11 ? `${home.name.slice(0, 10)}...` : home.name}</text>
      <title>{home.name}: {phaseInfo.detail}. This schedule is illustrative.</title>
    </g>)}
  </g>;
}

function HighwayNetwork({ paused }) {
  const highways = [
    { name: 'NORTH LOOP', path: 'M70 315 C270 275 410 310 560 430 S850 600 1030 560' },
    { name: 'EAST CONNECTOR', path: 'M80 820 C280 710 390 600 540 510 S820 330 1040 260' },
    { name: 'RIVERWAY', path: 'M92 610 C280 540 410 550 560 610 S820 710 1010 690' },
    { name: 'CROSS-TOWN 7', path: 'M250 180 C330 350 365 500 350 700 S310 930 230 1110' },
    { name: 'AIRPORT SPUR', path: 'M820 150 C760 320 755 480 810 620 S900 850 980 1060' },
  ];
  return <g className="lc-highway-network" aria-label="City highways">
    {highways.map(({ name, path }, index) => <g key={name} className="lc-highway"><path d={path} className="lc-highway-bed" /><path d={path} className="lc-highway-line" /><text className="lc-highway-label" x={index % 2 ? 875 : 95} y={index * 105 + 245}>{name}</text>{[0, 1, 2, 3, 4].map(car => <g key={car} className={`lc-car ${car % 3 === 0 ? 'lc-car-bus' : ''}`} style={{ '--car-delay': `${(index * 5 + car) * -1.8}s` }}><circle r={car % 3 === 0 ? 6 : 5} /><path d="M-8 0h16" /><animateMotion dur={`${7 + index * 1.3}s`} repeatCount={paused ? '0' : 'indefinite'} path={path} /></g>)}</g>)}
  </g>;
}

function CommuteTraffic({ model, phase, paused }) {
  if (!['morning', 'evening'].includes(phase)) return null;
  const route = phase === 'morning' ? 'M120 1100 C240 900 360 760 520 600 S700 390 820 260' : 'M820 260 C700 390 560 610 410 760 S230 940 120 1100';
  return <g className="lc-commute-traffic" aria-label="Illustrative agent commute traffic">
    <text x="120" y="1140" className="lc-commute-label">AGENT COMMUTE ROUTE</text>
    {model.homes.slice(0, 12).map((home, index) => <g key={home.id} className="lc-agent-car" style={{ '--car-delay': `${index * -1.1}s`, '--agent-color': home.color || '#67e8f9' }}>
      <rect x="-7" y="-4" width="14" height="8" rx="2" /><circle cx="-4" cy="5" r="2" /><circle cx="4" cy="5" r="2" /><text x="10" y="-7">{home.name.length > 10 ? `${home.name.slice(0, 9)}...` : home.name}</text><title>{home.name} driving {phase === 'morning' ? 'to work' : 'home'} · illustrative route</title><animateMotion dur={`${10 + index * .4}s`} repeatCount={paused ? '0' : 'indefinite'} path={route} /></g>)}
  </g>;
}

function CityHome({ home, index, selected, onSelect }) {
  const x = 100 + (index % 10) * 100, y = 1030 + Math.floor(index / 10) * 105;
  return <g transform={`translate(${x} ${y})`} className="lc-map-home" data-home-id={home.id} data-home-state={home.homeState}
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

function CityMap({ model, selected, selectedAgent, onSelectAgent, onEnter, paused, setPaused, reduced, speed, setSpeed, motionScope, setMotionScope, pov, setPov, phase, setPhase }) {
  const [zoom, setZoom] = useState(1), [offset, setOffset] = useState({ x: 0, y: 0 });
  const [area, setArea] = useState('all'), [homeFilter, setHomeFilter] = useState('all');
  const drag = useRef(null);
  const rows = Math.max(1, Math.ceil(model.homes.length / 10));
  const mapHeight = 1030 + rows * 105;
  const mapView = area === 'homes' ? `40 920 1020 ${mapHeight - 920}` : area === 'services' ? '0 0 1100 920' : `0 0 1100 ${mapHeight}`;
  const centerY = area === 'homes' ? (920 + mapHeight) / 2 : area === 'services' ? 460 : mapHeight / 2;
  const homeTotals = model.homes.reduce((counts, home) => ({ ...counts, [home.homeState]: (counts[home.homeState] || 0) + 1 }), {});
  const hasWork = model.edges.some(edge => edge.active);
  const motion = reduced ? 'reduced' : paused ? 'paused' : hasWork ? 'active' : 'idle';
  const reset = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };
  function move(event) {
    if (!drag.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = event.currentTarget.viewBox.baseVal.width / bounds.width;
    setOffset({ x: Math.max(-500, Math.min(500, drag.current.x + (event.clientX - drag.current.pointerX) * ratio)), y: Math.max(-350, Math.min(350, drag.current.y + (event.clientY - drag.current.pointerY) * ratio)) });
  }
  const phaseInfo = cityPhases[phase];
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
    <div className="lc-city-controls"><div className="lc-phase-controls" aria-label="Illustrative day phase">{Object.entries(cityPhases).map(([id, item]) => <button type="button" key={id} aria-pressed={phase === id} onClick={() => setPhase(id)}>{item.label}</button>)}</div><div className="lc-pov-controls" aria-label="City point of view"><span>POV</span>{[['map', 'Map'], ['third', '3rd person'], ['first', '1st person']].map(([id, label]) => <button type="button" key={id} aria-pressed={pov === id} onClick={() => setPov(id)}>{label}</button>)}</div></div>
    <div className="lc-city-navigation"><div className="lc-area-controls" aria-label="City map area">{[['all', 'Whole city'], ['services', 'Buildings'], ['homes', 'Homes']].map(([id, label]) => <button type="button" key={id} aria-pressed={area === id} onClick={() => { setArea(id); reset(); }}>{label}</button>)}</div>
      <div className="lc-home-controls" aria-label="Filter agent homes">{['all', 'working', 'inactive', 'attention', 'unobserved'].map(state => <button type="button" key={state} aria-pressed={homeFilter === state} onClick={() => setHomeFilter(state)}>{state === 'all' ? `All ${model.homes.length}` : `${homeStateName(state)} ${homeTotals[state] || 0}`}</button>)}</div>
    </div>
    <div className="lc-canvas" data-motion={motion} data-zoom={zoom} data-pov={pov}>
      <svg viewBox={mapView} aria-label="Live city: a logical map of UFIConnect services and agent homes" onPointerDown={event => {
        if (event.button !== 0 || event.target.closest('[role="button"]')) return;
        drag.current = { pointerX: event.clientX, pointerY: event.clientY, ...offset }; event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <defs>
          <pattern id="lc-grid" width="40" height="20" patternUnits="userSpaceOnUse"><path d="M0 10 20 0 40 10 20 20Z" fill="none" stroke="#24435b" strokeWidth=".55" /></pattern>
          <radialGradient id="lc-ground"><stop stopColor="#15364c" stopOpacity=".5" /><stop offset="1" stopColor="#080e19" stopOpacity="0" /></radialGradient>
        </defs>
        <rect width="1100" height={mapHeight} fill="url(#lc-ground)" /><rect x="30" y="65" width="1040" height={mapHeight - 90} fill="url(#lc-grid)" opacity=".22" />
        <g transform={`translate(${550 + offset.x} ${centerY + offset.y}) scale(${zoom}) translate(-550 ${-centerY})`}>
          <path d="M45 201 185 125 1057 662 917 860 45 434Z" fill="#0c2030" opacity=".28" />
          <g className="lc-street-grid" aria-label="City street grid">{Array.from({ length: 11 }, (_, index) => <path key={`vertical-${index}`} d={`M${90 + index * 92} 170V${mapHeight - 35}`} />)}{Array.from({ length: Math.max(8, rows + 3) }, (_, index) => <path key={`horizontal-${index}`} d={`M70 ${250 + index * 92}H1035`} />)}</g>
          <HighwayNetwork paused={paused || reduced} />
          <CommuteTraffic model={model} phase={phase} paused={paused || reduced} />
          <CityActivity model={model} phase={phase} />
          <text x="65" y="66" className="lc-map-zone">01 / INGESTION DISTRICT</text><text x="65" y="359" className="lc-map-zone">02 / STORAGE & PROCESSING</text><text x="65" y="625" className="lc-map-zone">03 / DELIVERY & RESILIENCE</text>
          {model.edges.map(edge => <g key={`${edge.from}-${edge.to}`} className="lc-road" data-from={edge.from} data-to={edge.to} data-active={String(edge.active)} aria-hidden="true">
            <path d={roadPath(model.byId[edge.from], model.byId[edge.to])} fill="none" stroke="#172f43" strokeWidth="15" strokeLinejoin="round" />
            <path d={roadPath(model.byId[edge.from], model.byId[edge.to])} fill="none" stroke="#385267" strokeWidth="1" strokeDasharray="4 7" />
            <path className="lc-road-flow" d={roadPath(model.byId[edge.from], model.byId[edge.to])} fill="none" stroke={model.byId[edge.from].color} strokeWidth="5" strokeLinecap="round" />
          </g>)}
          {model.districts.map((district, index) => <Building key={district.id} district={district} selected={selected === district.id} animationIndex={index} onEnter={() => onEnter(district.id)} />)}
          <g className="lc-residential-roads" aria-hidden="true"><path d={`M80 925H1030M80 925V${mapHeight - 45}M1030 925V${mapHeight - 45}M190 875V925M910 875V925`} />{Array.from({ length: rows }, (_, row) => <path key={row} d={`M80 ${1105 + row * 105}H1030`} />)}</g>
          <text x="65" y="965" className="lc-map-zone">04 / AGENT NEIGHBORHOOD · {model.homes.length} REGISTERED HOMES</text>
          <g className="lc-map-homes" aria-label="Agent homes">{model.homes.map((home, index) => (homeFilter === 'all' || home.homeState === homeFilter) && <CityHome key={home.id} home={home} index={index} selected={selectedAgent?.id === home.id} onSelect={() => onSelectAgent(home.primaryKey)} />)}</g>
          {!model.homes.length && <text x="550" y="1050" textAnchor="middle" className="lc-home-address">Waiting for the protected agent registry</text>}
        </g>
        <g className="lc-map-compass" aria-hidden="true"><path d="M1035 45v33m-16-17h32M1035 45l-5 9h10Z" fill="#64748b" stroke="#64748b" /><text x="1035" y="34" textAnchor="middle">N</text></g>
      </svg>
      <div className="lc-map-live"><span className={motion === 'active' ? 'lc-dot-active' : ''} />{motion === 'active' ? `${motionScope === 'all' ? 'Whole city' : 'Observed activity'} / ${speed}x` : motion === 'paused' ? 'Motion paused' : motion === 'reduced' ? 'Reduced motion' : 'No recent work to animate'}</div>
    </div>
    <div className="lc-map-legend"><p><Home size={14} />Green: working · Gray: inactive · Amber: attention · Dim: unobserved.</p><p><Radio size={14} />{phaseInfo.label}: cars, highways, and agent activities are illustrative, separate from telemetry.</p></div>
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
        {district.levels.map(item => <article className={`lc-level ${visibleLevel === item.number ? 'lc-level-active' : ''}`} key={item.id} data-level={item.number} aria-label={`Level ${item.number}: ${item.title}`}>
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
  const [speed, setSpeed] = useState(1), [motionScope, setMotionScope] = useState('all'), [pov, setPov] = useState('map'), [phase, setPhase] = useState('afternoon');
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
    <div className="lc-layout"><div className="lc-main"><CityMap model={model} selected={selectedDistrict.id} selectedAgent={selectedAgent} onSelectAgent={key => select('agent', key)} onEnter={enterBuilding} paused={paused} setPaused={setPaused} reduced={reduced} speed={speed} setSpeed={setSpeed} motionScope={motionScope} setMotionScope={setMotionScope} pov={pov} setPov={setPov} phase={phase} setPhase={setPhase} />
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
