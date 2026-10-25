import { useEffect, useState } from 'react';
import { RotateCw, Search, X } from 'lucide-react';
import client from '../api/client';

export function useTravelDestinations() {
  const [destinations, setDestinations] = useState([]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    client.get('/travel/destinations').then(({ data }) => {
      if (!Array.isArray(data.destinations) || !data.destinations.length) throw new Error('Missing destinations');
      if (!cancelled) setDestinations([...data.destinations].sort((a, b) => a.city.localeCompare(b.city) || a.country.localeCompare(b.country)));
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [attempt]);

  return { destinations, error, retry: () => setAttempt(value => value + 1) };
}

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const normalizeCountry = value => {
  const country = normalize(value);
  return ({ usa: 'us', 'united states': 'us', 'united states of america': 'us', uk: 'gb', 'united kingdom': 'gb' })[country] || country;
};
export const travelCityMatches = (destination, place) => Boolean(destination?.city && place?.city)
  && normalize(destination.city) === normalize(place.city)
  && [destination.country, destination.countryCode].filter(Boolean).some(value =>
    [place.country, place.countryCode].filter(Boolean).some(country => normalizeCountry(value) === normalizeCountry(country)));

export const travelCameraSearchUrl = destination => `https://www.youtube.com/results?${new URLSearchParams({
  search_query: `${destination.city} ${destination.country || destination.countryCode || ''} live webcam`,
  sp: 'EgJAAQ==',
})}`;

export default function TravelDestinationPicker({ destinations, selected, disabled, onSelect, query, onQueryChange, feeds = [], activeCameraId, error, retry }) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const matches = destinations.filter(city => terms.every(term => normalize([city.city, city.country, city.countryCode].join(' ')).includes(term)));
  return (
    <div className="travel-destination-picker">
      <div className="travel-city-search">
        <Search size={17} aria-hidden="true" />
        <input type="search" aria-label="Search cities" placeholder="Search cities or countries"
          value={query} onChange={event => onQueryChange(event.target.value)} autoComplete="off" />
        {query && <button type="button" className="btn btn-ghost btn-sm" aria-label="Clear city search" onClick={() => onQueryChange('')}><X size={17} /></button>}
      </div>
      <div className="travel-live-loop-choices" role="group" aria-label="Travel cities">
        {matches.map(destination => {
          const active = selected?.id === destination.id;
          const camera = feeds.find(feed => travelCityMatches(destination, feed));
          return <button key={destination.id} type="button" disabled={disabled}
            className={`travel-live-loop-choice${active ? ' active' : ''}`}
            aria-label={`${destination.city}, ${destination.country}`} aria-pressed={active}
            data-destination-id={destination.id}
            onClick={() => onSelect(destination)}>
            <span>{destination.city}</span><small>{destination.country}</small>
            {camera?.liveVerified && <small className="travel-city-live-badge">{camera.livePlayback?.kind === 'provider' ? camera.liveMediaKind === 'image' ? 'Live image' : 'Live on provider' : activeCameraId === camera.id ? 'Playing live' : 'Live camera'}</small>}
          </button>;
        })}
        {destinations.length > 0 && matches.length === 0 && <span role="status">No cities match your search.</span>}
        {!destinations.length && <span role="status">{error ? 'Cities are temporarily unavailable.' : 'Loading cities...'}</span>}
      </div>
      {error && <button type="button" className="btn btn-ghost btn-sm" onClick={retry}
        aria-label="Retry destinations" title="Retry destinations"><RotateCw size={16} /></button>}
    </div>
  );
}
