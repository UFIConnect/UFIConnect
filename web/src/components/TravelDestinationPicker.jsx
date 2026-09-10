import { useEffect, useState } from 'react';
import { ExternalLink, RotateCw } from 'lucide-react';
import client from '../api/client';

export default function TravelDestinationPicker({ location, disabled, onSelect }) {
  const [destinations, setDestinations] = useState([]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    client.get('/travel/destinations').then(({ data }) => {
      if (!cancelled) setDestinations(Array.isArray(data.destinations) ? data.destinations : []);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [attempt]);

  const selected = destinations.find(destination => destination.city.toLowerCase() === (location?.city || '').toLowerCase()
    && [destination.country, destination.countryCode].some(value => value.toLowerCase() === (location?.country || '').toLowerCase()));
  return (
    <div className="travel-destination-picker">
      <label className="feed-location-field">
        <span>Destinations{destinations.length ? ` (${destinations.length} cities)` : ''}</span>
        <select className="form-input" aria-label="Travel destination" disabled={disabled || !destinations.length}
          value={selected?.id || ''} onChange={event => {
            const destination = destinations.find(item => item.id === event.target.value);
            if (destination) onSelect(destination);
          }}>
          <option value="" disabled>{error ? 'Destinations unavailable' : destinations.length ? 'Choose a city' : 'Loading destinations...'}</option>
          {destinations.map(destination => <option key={destination.id} value={destination.id}>{destination.city}, {destination.country}</option>)}
        </select>
      </label>
      {selected && <a className="btn btn-ghost btn-sm" href={selected.guideUrl} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={14} aria-hidden="true" />City guide
      </a>}
      {error && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttempt(value => value + 1)}
        aria-label="Retry destinations" title="Retry destinations"><RotateCw size={16} /></button>}
    </div>
  );
}
