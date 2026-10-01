import { Link } from 'react-router-dom';
import { CITY_DOWNTOWN } from '../local/cityDowntown';

// The same descriptions serve the 3D buildings and their keyboard-accessible controls.
export default function CityAppGuide({ selected, onSelect, onAction, headingRef }) {
  const building = CITY_DOWNTOWN.find(item => item.id === selected) || CITY_DOWNTOWN[0];
  return <section className="card map-downtown" aria-labelledby="map-guide-heading">
    <div className="map-downtown-heading"><span className="local-eyebrow">UFI DOWNTOWN</span><h2 ref={headingRef} tabIndex={-1} id="map-guide-heading">How your app works</h2></div>
    <div className="map-civic-buttons" role="group" aria-label="Downtown buildings">
      {CITY_DOWNTOWN.map(item => <button type="button" key={item.id} aria-pressed={selected === item.id} onClick={() => onSelect(item.id)}><i style={{ background: item.color }} aria-hidden="true" />{item.label}</button>)}
    </div>
    <div className="map-building-detail">
      <strong>{building.label}</strong><p>{building.description}</p>
      {building.to ? <Link to={building.to}>Open {building.label}</Link>
        : <button type="button" onClick={() => onAction(building.action)}>Explore {building.label.toLowerCase()}</button>}
    </div>
  </section>;
}
