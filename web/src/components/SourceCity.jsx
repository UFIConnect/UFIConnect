import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { CITY_CATEGORIES } from '../local/localWorkspace';
import { CITY_NATURE } from '../local/cityNature';
import { SOURCE_META } from './sourceMeta';
import './maps-workspace.css';
const Scene = lazy(() => import('./MapCityScene'));

export default function SourceCity({ cities, enabled, active, onSelect, onCivicSelect, counts, houseSummaries = {}, actions, sources, activeSource, onSourceSelect }) {
  const [fallback, setFallback] = useState(false), [reset, setReset] = useState(0), [page, setPage] = useState(0);
  const [overview, setOverview] = useState(true);
  const cityHeading = useRef(null), returnFocus = useRef(false);
  const [motion, setMotion] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'paused' : 'full');
  const [intensity, setIntensity] = useState('full');
  const category = CITY_CATEGORIES.find(item => item.id === active) || CITY_CATEGORIES[0];
  const theme = CITY_NATURE[active];
  const pages = Math.max(1, Math.ceil(sources.length / 12));
  useEffect(() => { setPage(0); setFallback(false); }, [active, overview]);
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
  function openCity(id, source) { setOverview(false); onSelect(id); if (source) onSourceSelect(source); }
  function showAllCities() {
    if (overview) { cityHeading.current?.focus({ preventScroll: true }); return; }
    returnFocus.current = true;
    setOverview(true);
  }
  return <section className="map-city-card" aria-label="Source city">
    <div className="map-city-title"><div><span className="local-eyebrow">{overview ? 'ONE CONNECTED WORLD' : category.label}</span><h2 ref={cityHeading} tabIndex={-1}>{overview ? 'Your UFI city network' : theme.name}</h2><p>{overview ? 'Explore every nature city. Visit downtown to see how UFI connects it all.' : theme.description}</p></div></div>
    {actions && <div className="map-actions-toolbar">{actions}</div>}
    <div className="map-scene-toolbar">
      {!overview && <button type="button" className="map-back-to-all" onClick={showAllCities}>← Back to all cities</button>}
      <span className="map-motion-status"><i className={motion === 'paused' ? '' : 'is-moving'} />{motion === 'paused' ? 'Motion paused' : 'City animation'}</span>
      <label>Motion<select aria-label="Animation intensity" value={intensity} onChange={event => { setIntensity(event.target.value); setMotion(event.target.value); }}><option value="full">Full</option><option value="calm">Calm</option></select></label>
      <button type="button" onClick={() => setMotion(motion === 'paused' ? intensity : 'paused')}>{motion === 'paused' ? 'Play animation' : 'Pause animation'}</button>
      <button type="button" onClick={() => setReset(value => value + 1)}>Reset view</button>
    </div>
    {fallback ? <p className="card">3D is unavailable on this device. Use the city, building, and source buttons below to explore.</p> : <Suspense fallback={<div className="map-city-scene">Opening your city…</div>}>
      <Scene overview={overview} cities={cities} motion={motion}
        homes={visible.map(id => ({ id, label: SOURCE_META[id]?.label || id, summary: (houseSummaries[id] || []).map(item => item.topic).slice(0, 2).join(' · ') }))}
        theme={theme} title={category.label} selected={activeSource} onSelect={onSourceSelect}
        onCitySelect={openCity} onCivicSelect={onCivicSelect} resetKey={reset} onFallback={() => setFallback(true)} />
    </Suspense>}
    <div className="map-city-picker" role="group" aria-label="Choose your city">
      <button type="button" className="map-all-cities" aria-pressed={overview} onClick={showAllCities} style={{ '--city-color': '#5879a5' }}><i aria-hidden="true" /><span>All<small>16 cities + UFI downtown</small></span></button>
      {CITY_CATEGORIES.map(item => <button type="button" key={item.id} aria-pressed={!overview && item.id === active} onClick={() => openCity(item.id)} style={{ '--city-color': CITY_NATURE[item.id].leaves }}><i aria-hidden="true" /><span>{item.label}<small>{enabled.includes(item.id) ? CITY_NATURE[item.id].name : 'Not in your app yet'}</small></span></button>)}
    </div>
    {overview ? <>
      <details className="map-city-directory"><summary>All 16 nature cities</summary><div className="map-houses">{cities.map(item => <button key={item.id} type="button" onClick={() => openCity(item.id)}><strong>{item.label}</strong><span>{CITY_NATURE[item.id].name}</span><span>{item.sources.length} source houses</span></button>)}</div></details>
    </> : <div className="map-houses" aria-label="Open a source house">{visible.map(id => <button key={id} type="button" aria-pressed={activeSource === id} onClick={() => onSourceSelect(id)}><strong>{SOURCE_META[id]?.label || id}</strong><span>{counts[id] || 0} posts loaded · {(houseSummaries[id] || []).length} selected topics</span><span className="map-house-topic-list">{(houseSummaries[id] || []).length ? houseSummaries[id].map(item => <small key={item.topic}>{item.topic} · {item.loaded} loaded</small>) : 'Open house to add topics'}</span></button>)}</div>}
    <div className="map-city-footer"><span>{overview ? 'All 16 cities · Up to 6 house previews per city. Open a city for every source.' : sources.length + ' source houses · Open a house for topics.'} Drag to orbit; scroll to zoom. Animation illustrates the app, not live user activity.</span>{!overview && pages > 1 && <nav aria-label="Source neighborhoods"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}</div>
  </section>;
}
