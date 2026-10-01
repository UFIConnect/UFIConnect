import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CITY_CATEGORIES } from '../local/localWorkspace';
import { CITY_NATURE } from '../local/cityNature';
import { CITY_DOWNTOWN } from '../local/cityDowntown';
import { SOURCE_META } from './sourceMeta';
import './maps-workspace.css';
const Scene = lazy(() => import('./MapCityScene'));

export default function SourceCity({ cities, enabled, active, onSelect, onAction, counts, cityCounts, houseSummaries = {}, sources, activeSource, onSourceSelect }) {
  const [fallback, setFallback] = useState(false), [reset, setReset] = useState(0), [page, setPage] = useState(0);
  const [overview, setOverview] = useState(true), [civic, setCivic] = useState('feed');
  const [motion, setMotion] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'paused' : 'full');
  const [intensity, setIntensity] = useState('full');
  const category = CITY_CATEGORIES.find(item => item.id === active) || CITY_CATEGORIES[0];
  const theme = CITY_NATURE[active];
  const pages = Math.max(1, Math.ceil(sources.length / 12));
  useEffect(() => { setPage(0); setFallback(false); }, [active, overview]);
  useEffect(() => { const index = sources.indexOf(activeSource); if (index >= 0) setPage(Math.floor(index / 12)); }, [activeSource, sources.join(',')]);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => { if (preference.matches) setMotion('paused'); };
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);
  const currentPage = Math.min(page, pages - 1);
  const visible = sources.slice(currentPage * 12, (currentPage + 1) * 12);
  const building = CITY_DOWNTOWN.find(item => item.id === civic) || CITY_DOWNTOWN[0];
  function openCity(id, source) { setOverview(false); onSelect(id); if (source) onSourceSelect(source); }
  return <section className="map-city-card" aria-label="Source city">
    <div className="map-city-picker" role="group" aria-label="Choose your city">
      <button type="button" className="map-all-cities" aria-pressed={overview} onClick={() => setOverview(true)} style={{ '--city-color': '#5879a5' }}><i aria-hidden="true" /><span>All<small>16 cities + UFI downtown</small></span></button>
      {CITY_CATEGORIES.map(item => <button type="button" key={item.id} aria-pressed={!overview && item.id === active} onClick={() => openCity(item.id)} style={{ '--city-color': CITY_NATURE[item.id].leaves }}><i aria-hidden="true" /><span>{item.label}<small>{enabled.includes(item.id) ? CITY_NATURE[item.id].name : 'Not in your app yet'}</small></span><b>{cityCounts[item.id] || 0}<small>saved</small></b></button>)}
    </div>
    <div className="map-city-title"><div><span className="local-eyebrow">{overview ? 'ONE CONNECTED WORLD' : category.label}</span><h2>{overview ? 'Your UFI city network' : theme.name}</h2><p>{overview ? 'Explore every nature city. Visit downtown to see how UFI connects it all.' : theme.description}</p></div></div>
    <div className="map-scene-toolbar">
      <span className="map-motion-status"><i className={motion === 'paused' ? '' : 'is-moving'} />{motion === 'paused' ? 'Motion paused' : 'City animation'}</span>
      <label>Motion<select aria-label="Animation intensity" value={intensity} onChange={event => { setIntensity(event.target.value); setMotion(event.target.value); }}><option value="full">Full</option><option value="calm">Calm</option></select></label>
      <button type="button" onClick={() => setMotion(motion === 'paused' ? intensity : 'paused')}>{motion === 'paused' ? 'Play animation' : 'Pause animation'}</button>
      <button type="button" onClick={() => setReset(value => value + 1)}>Reset view</button>
    </div>
    {fallback ? <p className="card">3D is unavailable on this device. Use the city, building, and source buttons below to explore.</p> : <Suspense fallback={<div className="map-city-scene">Opening your city…</div>}>
      <Scene overview={overview} cities={cities} motion={motion}
        homes={visible.map(id => ({ id, label: SOURCE_META[id]?.label || id, summary: (houseSummaries[id] || []).map(item => item.topic + ' ' + item.count + '/' + item.target).slice(0, 2).join(' · ') }))}
        theme={theme} title={category.label} selected={activeSource} onSelect={onSourceSelect}
        onCitySelect={openCity} onCivicSelect={id => { setCivic(id); setOverview(true); }} resetKey={reset} onFallback={() => setFallback(true)} />
    </Suspense>}
    {overview ? <>
      <div className="map-downtown"><div className="map-downtown-heading"><span className="local-eyebrow">UFI DOWNTOWN</span><h3>How your app works</h3></div>
        <div className="map-civic-buttons" role="group" aria-label="Downtown buildings">{CITY_DOWNTOWN.map(item => <button type="button" key={item.id} aria-pressed={civic === item.id} onClick={() => setCivic(item.id)}><i style={{ background: item.color }} />{item.label}</button>)}</div>
        <div className="map-building-detail"><strong>{building.label}</strong><p>{building.description}</p>{building.to ? <Link to={building.to}>Open {building.label}</Link> : <button type="button" onClick={() => { setOverview(false); onAction(building.action); }}>Explore {building.label.toLowerCase()}</button>}</div>
      </div>
      <details className="map-city-directory"><summary>All 16 nature cities</summary><div className="map-houses">{cities.map(item => <button key={item.id} type="button" onClick={() => openCity(item.id)}><strong>{item.label}</strong><span>{CITY_NATURE[item.id].name}</span><span>{item.sources.length} source houses · {cityCounts[item.id] || 0} saved</span></button>)}</div></details>
    </> : <div className="map-houses" aria-label="Open a source house">{visible.map(id => <button key={id} type="button" aria-pressed={activeSource === id} onClick={() => onSourceSelect(id)}><strong>{SOURCE_META[id]?.label || id}</strong><span>{counts[id] || 0} posts saved · {(houseSummaries[id] || []).length} selected topics</span><span className="map-house-topic-list">{(houseSummaries[id] || []).length ? houseSummaries[id].map(item => <small key={item.topic}>{item.topic} · {item.count}/{item.target} saved · {item.loaded} loaded</small>) : 'Open house to add topics'}</span></button>)}</div>}
    <div className="map-city-footer"><span>{overview ? 'All 16 cities · Up to 6 house previews per city. Open a city for every source.' : sources.length + ' source houses · Open a house for topics.'} Drag to orbit; scroll to zoom. Animation illustrates the app, not live user activity.</span>{!overview && pages > 1 && <nav aria-label="Source neighborhoods"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}</div>
  </section>;
}
