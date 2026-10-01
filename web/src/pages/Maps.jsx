import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import client from '../api/client';
import { SOURCE_META } from '../components/sourceMeta';
import { MAP_TOWNS, SOURCE_ALIASES } from '../data/mapTowns';
// The 3D city engine is shared with the Office. Only the local website preview has
// this page; the public build leaves it and the engine out (see App.jsx).
import { CITY_DISTRICTS } from '../data/mapDistricts.js';
import { buildCityStreets } from '../../../shared/city/city-streets.mjs';
import '../../../shared/city/scene.css';
import './Maps.css';

const CityScene3D = lazy(() => import('../../../shared/city/CityScene3D.jsx'));

const REFRESH_MS = 60_000;
const number = value => Math.round(value).toLocaleString();
const colorOf = id => { const color = SOURCE_META[id]?.color || ''; return color.startsWith('#') ? color : '#6366f1'; };

// One home per source, grouped into its category's town.
const ROSTER = MAP_TOWNS.flatMap(town => town.sources.map(id => ({ id, town })));


// Counts glide to each new value, so the city reads as live without jumping.
function useGlidingCounts(targets) {
  const [shown, setShown] = useState(targets);
  const from = useRef(targets);
  useEffect(() => {
    const start = performance.now(), before = from.current;
    const timer = setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / 1400), ease = 1 - (1 - t) ** 3;
      const next = Object.fromEntries(Object.keys(targets).map(id => [id, (before[id] ?? 0) + ((targets[id] ?? 0) - (before[id] ?? 0)) * ease]));
      setShown(next);
      if (t === 1) { clearInterval(timer); from.current = targets; }
    }, 90);
    return () => { clearInterval(timer); from.current = targets; };
  }, [targets]);
  return shown;
}

export default function Maps() {
  const [counts, setCounts] = useState(() => Object.fromEntries(ROSTER.map(({ id }) => [id, 0])));
  const [live, setLive] = useState(null);
  const [selected, setSelected] = useState(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const [noGraphics, setNoGraphics] = useState(false);
  const [reduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  // Keep the last real counts on refresh failure; never invent source activity.
  useEffect(() => {
    let active = true;
    const load = () => client.get('/feed/sources?sample=1').then(response => {
      if (!active) return;
      const byId = Object.fromEntries((response.data?.sources || []).map(source => [source.id, source.postCount || 0]));
      
      setCounts(Object.fromEntries(ROSTER.map(({ id }) => [id, byId[id] ?? byId[SOURCE_ALIASES[id]] ?? 0])));
      setLive({ at: new Date() });
    }).catch(() => {
      if (!active) return;
      setLive(previous => previous ? { ...previous, stale: true } : false);
    });
    load();
    const refresh = setInterval(load, REFRESH_MS);
    return () => { active = false; clearInterval(refresh); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useGlidingCounts(counts);
  const selectedSource = selected?.type === 'source' ? ROSTER.find(item => item.id === selected.id) : null;
  const selectedBuilding = selected?.type === 'building' ? CITY_DISTRICTS.find(district => district.id === selected.id) : null;

  // The layout depends only on the roster, so it is built once.
  const layout = useMemo(() => buildCityStreets({
    districts: CITY_DISTRICTS,
    homes: ROSTER.map(({ id, town }) => ({ id, name: SOURCE_META[id]?.label || id, district: town.id, primaryKey: id,
      group: town.id, townName: town.town, townLabel: town.label, townColor: town.color })),
  }), []);
  // Labels and lights change every tick without moving anything.
  const city = useMemo(() => {
    const labelOf = id => SOURCE_META[id]?.label || id;
    const homes = layout.homes.map(home => ({ ...home, homeState: shown[home.id] > 0 ? 'working' : 'inactive',
      badge: `${labelOf(home.id)} · ${number(shown[home.id] || 0)}`, badgeColor: colorOf(home.id) }));
    const districts = layout.districts;
    return { ...layout, homes, districts, byId: Object.fromEntries(districts.map(district => [district.id, district])) };
  }, [layout, shown, selectedSource]);
  const edges = useMemo(() => [], []);
  const total = Object.values(shown).reduce((sum, value) => sum + value, 0);

  return <Layout wide>
    <Helmet><title>Maps | UFIconnect</title><meta name="robots" content="noindex" /></Helmet>
    <header className="page-header maps-header">
      <div>
        <h1 className="page-title">Maps</h1>
        <p className="page-subtitle">Explore category neighborhoods and source houses. Traffic is decorative; counts come from your feed.</p>
      </div>
      <p className={`maps-status${live ? ' maps-status-live' : ''}`} role="status">
        {live ? `${live.stale ? 'Last available counts' : 'Feed counts'} · ${number(total)} posts · updated ${live.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
          : live === false ? 'Post counts unavailable. Sign in or try again later.' : 'Loading post counts…'}
      </p>
    </header>

    <div className="maps-layout">
      <section className="maps-scene" aria-label="UFIconnect map">
        <div className="maps-toolbar">
          <div className="maps-tool-group" role="group" aria-label="Zoom">
            <button type="button" aria-label="Zoom out" disabled={zoom <= .8} onClick={() => setZoom(value => Math.max(.8, +(value - .2).toFixed(1)))}>−</button>
            <output aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
            <button type="button" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, +(value + .2).toFixed(1)))}>+</button>
            <button type="button" onClick={() => { setZoom(1); setResetKey(value => value + 1); }}>Whole city</button>
          </div>
          <div className="maps-tool-group">
            <label htmlFor="maps-speed">Traffic speed</label>
            <select id="maps-speed" value={speed} disabled={reduced} onChange={event => setSpeed(Number(event.target.value))}>
              <option value="0.5">Slow</option><option value="1">Normal</option><option value="1.75">Fast</option>
            </select>
            <button type="button" aria-pressed={paused} disabled={reduced} onClick={() => setPaused(value => !value)}>{paused ? 'Resume' : 'Pause'}</button>
          </div>
        </div>
        <div className="live-city maps-canvas">
          {noGraphics ? <p className="maps-fallback">This device cannot show 3D graphics. The towns and post counts are listed beside the map.</p>
            : <Suspense fallback={<div className="lc-3d-loading">Opening the map…</div>}>
              <CityScene3D city={city} edges={edges} motion={reduced ? 'reduced' : paused ? 'paused' : 'active'} speed={speed} motionScope="all"
                homeFilter="all" area="all" zoom={zoom} resetKey={resetKey} selectedHomeId={selectedSource?.id}
                onEnter={id => setSelected({ type: 'building', id })} onSelectAgent={id => setSelected({ type: 'source', id })}
                onFallback={() => setNoGraphics(true)} />
            </Suspense>}
        </div>
      </section>

      <aside className="maps-panel" aria-label="Towns and sources">
        <section className="maps-selection" aria-live="polite">
          {selectedSource ? <>
            <span className="maps-eyebrow" style={{ '--town': selectedSource.town.color }}>{selectedSource.town.town} · {selectedSource.town.label}</span>
            <h2>{SOURCE_META[selectedSource.id]?.label || selectedSource.id}</h2>
            <p className="maps-big-count">{number(shown[selectedSource.id] || 0)} <small>posts</small></p>
            <p><a href={`/?sources=${encodeURIComponent(SOURCE_ALIASES[selectedSource.id] || selectedSource.id)}`}>Open source feed</a></p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>Show every source</button>
          </> : selectedBuilding ? <>
            <span className="maps-eyebrow" style={{ '--town': selectedBuilding.color }}>Category neighborhoods</span>
            <h2>{selectedBuilding.label}</h2>
            <p>{selectedBuilding.description}</p>
            <p className="maps-hint">Choose a source house in this category.</p>
          </> : <>
            <span className="maps-eyebrow">Category neighborhoods</span>
            <h2>All sources</h2>
            <p>Select a home on the map or a source below. Each house belongs to a category neighborhood.</p>
          </>}
        </section>
        <ul className="maps-towns">
          {MAP_TOWNS.map(town => <li key={town.id} style={{ '--town': town.color }}>
            <div className="maps-town-head"><span className="maps-town-dot" aria-hidden="true" /><strong>{town.town}</strong><span>{town.label}</span>
              <em>{number(town.sources.reduce((sum, id) => sum + (shown[id] || 0), 0))}</em></div>
            <div className="maps-sources">
              {town.sources.map(id => <button type="button" key={id} aria-pressed={selectedSource?.id === id} onClick={() => setSelected({ type: 'source', id })}>
                <span className="maps-source-dot" style={{ background: colorOf(id) }} aria-hidden="true" />
                <span>{SOURCE_META[id]?.label || id}</span><span className="maps-count">{number(shown[id] || 0)}</span>
              </button>)}
            </div>
          </li>)}
        </ul>
      </aside>
    </div>
  </Layout>;
}
