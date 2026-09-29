import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import client from '../api/client';
import { SOURCE_META } from '../components/sourceMeta';
import { MAP_TOWNS, SOURCE_ALIASES } from '../data/mapTowns';
// The 3D city engine is shared with the Office. Only the local website preview has
// this page; the public build leaves it and the engine out (see App.jsx).
import { CITY_DISTRICTS } from '../../../office/src/city-model.mjs';
import { buildCityStreets } from '../../../office/src/city-streets.mjs';
import '../../../office/src/LiveCity.css';
import './Maps.css';

const CityScene3D = lazy(() => import('../../../office/src/CityScene3D.jsx'));

// Content moves between downtown buildings in this order.
const ROUTES = [['sources', 'equalizer'], ['equalizer', 'filter'], ['filter', 'sort'], ['sort', 'staging'], ['staging', 'transfer'],
  ['transfer', 'database'], ['database', 'topics'], ['topics', 'feed'], ['database', 'backup']];
const BUILDING_NOTES = {
  sources: 'Every source home sends its posts here first.',
  equalizer: 'Balances sources so no single one floods the feed.',
  filter: 'Screens out duplicates and posts that do not belong.',
  sort: 'Orders posts for each feed.',
  staging: 'Posts wait here before they go live.',
  transfer: 'Moves checked posts into the live store.',
  database: 'Keeps every live post.',
  topics: 'Matches posts to the topics people follow.',
  feed: 'Serves the feeds people read.',
  backup: 'Keeps a recovery copy of the feed.',
  security: 'Watches sign-ins and unusual activity.',
  runtime: 'Keeps the services steady under load.',
};
const REFRESH_MS = 60_000;
const number = value => Math.round(value).toLocaleString();
const colorOf = id => { const color = SOURCE_META[id]?.color || ''; return color.startsWith('#') ? color : '#6366f1'; };

// One home per source, grouped into its category's town.
const ROSTER = MAP_TOWNS.flatMap(town => town.sources.map(id => ({ id, town })));
function sampleCounts() {
  return Object.fromEntries(ROSTER.map(({ id }, index) => [id, 40 + ((index * 73) % 260)]));
}

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

export default function LocalMaps() {
  const [counts, setCounts] = useState(() => Object.fromEntries(ROSTER.map(({ id }) => [id, 0])));
  const [live, setLive] = useState(null);
  const [selected, setSelected] = useState(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [resetKey, setResetKey] = useState(0);
  const [noGraphics, setNoGraphics] = useState(false);
  const [reduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  // Live counts come from the signed-in feed; without them the map shows marked sample counts.
  useEffect(() => {
    let active = true, sampleTimer, gotLive = false;
    const load = () => client.get('/feed/sources?sample=1').then(response => {
      if (!active) return;
      const byId = Object.fromEntries((response.data?.sources || []).map(source => [source.id, source.postCount || 0]));
      clearInterval(sampleTimer); sampleTimer = null; gotLive = true;
      setCounts(Object.fromEntries(ROSTER.map(({ id }) => [id, byId[id] ?? byId[SOURCE_ALIASES[id]] ?? 0])));
      setLive({ at: new Date() });
    }).catch(() => {
      // A failed refresh keeps the last live counts.
      if (!active || gotLive) return;
      setLive(false);
      setCounts(current => Object.values(current).some(Boolean) ? current : sampleCounts());
      if (sampleTimer) return;
      sampleTimer = setInterval(() => setCounts(current => {
        const next = { ...current };
        ROSTER.forEach(({ id }, index) => { if ((index + Date.now() / 4000) % 5 < 1) next[id] += 1 + (index % 3); });
        return next;
      }), 4000);
    });
    load();
    const refresh = setInterval(load, REFRESH_MS);
    return () => { active = false; clearInterval(refresh); clearInterval(sampleTimer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useGlidingCounts(counts);
  const selectedSource = selected?.type === 'source' ? ROSTER.find(item => item.id === selected.id) : null;
  const selectedBuilding = selected?.type === 'building' ? CITY_DISTRICTS.find(district => district.id === selected.id) : null;

  // The layout depends only on the roster, so it is built once.
  const layout = useMemo(() => buildCityStreets({
    districts: CITY_DISTRICTS,
    homes: ROSTER.map(({ id, town }) => ({ id, name: SOURCE_META[id]?.label || id, district: 'sources', primaryKey: id,
      group: town.id, townName: town.town, townLabel: town.label, townColor: town.color })),
  }), []);
  // Labels and lights change every tick without moving anything.
  const city = useMemo(() => {
    const labelOf = id => SOURCE_META[id]?.label || id;
    const homes = layout.homes.map(home => ({ ...home, homeState: shown[home.id] > 0 ? 'working' : 'inactive',
      badge: `${labelOf(home.id)} · ${number(shown[home.id] || 0)}`, badgeColor: colorOf(home.id) }));
    const districts = layout.districts.map(district => selectedSource
      ? { ...district, badge: `${labelOf(selectedSource.id)} · ${number(shown[selectedSource.id] || 0)} posts`, badgeColor: colorOf(selectedSource.id) }
      : district);
    return { ...layout, homes, districts, byId: Object.fromEntries(districts.map(district => [district.id, district])) };
  }, [layout, shown, selectedSource]);
  const edges = useMemo(() => ROUTES.map(([from, to]) => ({ from, to, active: true })), []);
  const total = Object.values(shown).reduce((sum, value) => sum + value, 0);

  return <Layout wide>
    <Helmet><title>Maps | UFIconnect</title><meta name="robots" content="noindex" /></Helmet>
    <header className="page-header maps-header">
      <div>
        <h1 className="page-title">Maps</h1>
        <p className="page-subtitle">Every source has a home in its category's town. Posts travel the highways into downtown, and the grid lights up as they move.</p>
      </div>
      <p className={`maps-status${live ? ' maps-status-live' : ''}`} role="status">
        {live ? `Live · ${number(total)} posts · updated ${live.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
          : live === false ? `Sample counts · ${number(total)} posts` : 'Loading post counts…'}
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
            <p>Downtown now follows this source: every building shows its posts on their way to the feed.</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>Show every source</button>
          </> : selectedBuilding ? <>
            <span className="maps-eyebrow" style={{ '--town': selectedBuilding.color }}>Downtown</span>
            <h2>{selectedBuilding.label}</h2>
            <p>{BUILDING_NOTES[selectedBuilding.id]}</p>
            <p className="maps-hint">Select a home to see its posts in every downtown building.</p>
          </> : <>
            <span className="maps-eyebrow">Downtown</span>
            <h2>All sources</h2>
            <p>Select a home on the map or a source below. Downtown's buildings then show that source.</p>
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
