import { lazy, Suspense, useEffect, useState } from 'react';
import { CITY_CATEGORIES } from '../local/localWorkspace';
import { CITY_NATURE } from '../local/cityNature';
import { SOURCE_META } from './sourceMeta';
import './maps-workspace.css';
const Scene = lazy(() => import('./MapCityScene'));
export default function SourceCity({ enabled, active, onSelect, counts, cityCounts, houseSummaries = {}, sources, activeSource, onSourceSelect }) {
  const [fallback, setFallback] = useState(false), [reset, setReset] = useState(0), [page, setPage] = useState(0);
  const category = CITY_CATEGORIES.find(item => item.id === active) || CITY_CATEGORIES[0];
  const theme = CITY_NATURE[active];
  const pages = Math.max(1, Math.ceil(sources.length / 12));
  useEffect(() => { setPage(0); setFallback(false); }, [active]);
  useEffect(() => { const index = sources.indexOf(activeSource); if (index >= 0) setPage(Math.floor(index / 12)); }, [activeSource, sources.join(',')]);
  const currentPage = Math.min(page, pages - 1);
  const visible = sources.slice(currentPage * 12, (currentPage + 1) * 12);
  return <section className="map-city-card" aria-label="Source city">
    <div className="map-city-picker" role="group" aria-label="Choose your city">{CITY_CATEGORIES.filter(item => enabled.includes(item.id)).map(item =>
      <button type="button" key={item.id} aria-pressed={item.id === active} onClick={() => onSelect(item.id)} style={{ '--city-color': CITY_NATURE[item.id].leaves }}><i aria-hidden="true" /><span>{item.label}<small>{CITY_NATURE[item.id].name}</small></span><b>{cityCounts[item.id] || 0}<small>saved</small></b></button>)}</div>
    <div className="map-city-title"><div><span className="local-eyebrow">{category.label}</span><h2>{theme.name}</h2><p>{theme.description}</p></div><button type="button" className="btn btn-ghost btn-sm" onClick={() => setReset(value => value + 1)}>Reset view</button></div>
    {fallback ? <p className="card">Choose a source house below. 3D is unavailable on this device.</p> : <Suspense fallback={<div className="map-city-scene">Opening your city…</div>}>
      <Scene homes={visible.map(id => ({ id, label: SOURCE_META[id]?.label || id, summary: (houseSummaries[id] || []).map(item => item.topic + ' ' + item.count + '/' + item.target).slice(0, 2).join(' · ') }))} theme={theme} title={category.label} selected={activeSource} onSelect={onSourceSelect} resetKey={reset} onFallback={() => setFallback(true)} />
    </Suspense>}
    <div className="map-houses" aria-label="Open a source house">{visible.map(id => <button key={id} type="button" aria-pressed={activeSource === id} onClick={() => onSourceSelect(id)}><strong>{SOURCE_META[id]?.label || id}</strong><span>{counts[id] || 0} posts saved · {(houseSummaries[id] || []).length} selected topics</span><span className="map-house-topic-list">{(houseSummaries[id] || []).length ? houseSummaries[id].map(item => <small key={item.topic}>{item.topic} · {item.count}/{item.target} saved · {item.loaded} loaded</small>) : 'Open house to add topics'}</span></button>)}</div>
    <div className="map-city-footer"><span>{sources.length} source houses · Drag to explore. Select a house for topics.</span>{pages > 1 && <nav aria-label="Source neighborhoods"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></nav>}</div>
  </section>;
}
