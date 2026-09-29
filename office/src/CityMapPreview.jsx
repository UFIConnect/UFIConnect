import { useEffect, useMemo, useState } from 'react';
import { CityMap } from './LiveCity';
import { buildCityModel } from './city-model.mjs';
import { buildCityStreets } from './city-streets.mjs';
import { sampleCityObservations } from './city-sample.mjs';

// The Live City map (downtown, towns, the beltway and the 3D region) drawn from
// sample observations, for reviewing the city in the local website preview.
// It never contacts the Office services.
export default function CityMapPreview() {
  const [now, setNow] = useState(Date.now);
  const [paused, setPaused] = useState(false), [speed, setSpeed] = useState(1), [motionScope, setMotionScope] = useState('all');
  const [reduced, setReduced] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [selection, setSelection] = useState({ type: 'district', id: 'sources' });
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return undefined;
    const update = () => setReduced(media.matches); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const model = useMemo(() => buildCityModel({ ...sampleCityObservations(now), now }), [now]);
  // The sample roster never changes, so each agent's town is fixed.
  const townOf = useMemo(() => {
    const city = buildCityStreets(model);
    return Object.fromEntries(city.homes.map(home => [home.id, city.towns.find(town => town.id === home.town)?.name]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedAgent = selection.type === 'agent' ? model.agents.find(agent => agent.key === selection.id) : null;
  const selectedDistrict = model.byId[selection.type === 'district' ? selection.id : selectedAgent?.district] || model.byId.sources;
  return <section className="live-city lc-map-preview" aria-label="Live City map preview">
    <CityMap model={model} selected={selectedDistrict.id} selectedAgent={selectedAgent} onSelectAgent={key => setSelection({ type: 'agent', id: key })}
      onEnter={id => setSelection({ type: 'district', id })} paused={paused} setPaused={setPaused} reduced={reduced}
      speed={speed} setSpeed={setSpeed} motionScope={motionScope} setMotionScope={setMotionScope} />
    <p className="lc-map-preview-selection" role="status">{selectedAgent
      ? <><strong>{selectedAgent.name}</strong> lives in {townOf[selectedAgent.id] || 'a town beside downtown'} and works at {model.byId[selectedAgent.district]?.label}.</>
      : <><strong>{selectedDistrict.label}</strong> · {selectedDistrict.description}</>}</p>
  </section>;
}
