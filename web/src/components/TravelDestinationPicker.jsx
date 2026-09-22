import { useEffect, useState } from 'react';
import { ExternalLink, RotateCw } from 'lucide-react';
import client from '../api/client';

export default function TravelDestinationPicker({ location, disabled, onSelect, feeds = [], activeCameraId }) {
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

  const normalizeCountry = value => {
    const country = String(value || '').trim().toLowerCase();
    return ({ usa: 'us', 'united states': 'us', 'united states of america': 'us', uk: 'gb', 'united kingdom': 'gb' })[country] || country;
  };
  const matches = (destination, place) => destination.city.toLowerCase() === (place?.city || '').toLowerCase()
    && [destination.country, destination.countryCode].filter(Boolean).some(value => normalizeCountry(value) === normalizeCountry(place?.country));
  const choices = [...destinations];
  for (const feed of feeds) {
    if (feed.city && !choices.some(destination => matches(destination, feed))) {
      choices.push({ id: feed.id, city: feed.city, country: feed.country || '', camera: feed });
    }
  }
  const selected = choices.find(destination => matches(destination, location));
  const ordered = choices.map(destination => ({ ...destination, camera: destination.camera || feeds.find(feed => matches(destination, feed)) }))
    .sort((left, right) => Number(Boolean(right.camera)) - Number(Boolean(left.camera)) || left.city.localeCompare(right.city));
  return (
    <div className="travel-destination-picker">
      <div className="travel-city-rail-heading">
        <strong>Cities{destinations.length ? ` (${destinations.length})` : ''}</strong>
        {selected?.guideUrl && <a className="btn btn-ghost btn-sm" href={selected.guideUrl} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={14} aria-hidden="true" />City guide
        </a>}
      </div>
      <div className="travel-live-loop-choices" role="group" aria-label="Travel cities">
        {ordered.map(destination => {
          const active = selected?.id === destination.id || (!location?.city && Boolean(activeCameraId) && activeCameraId === destination.camera?.id);
          return <button key={destination.id} type="button" disabled={disabled}
            className={`travel-live-loop-choice${active ? ' active' : ''}`}
            aria-label={`${destination.city}, ${destination.country}`} aria-pressed={active}
            data-destination-id={destination.id}
            onClick={() => onSelect(destination, destination.camera)}>
            <span>{destination.city}</span><small>{destination.country}</small>
            {destination.camera?.liveVerified && <small className="travel-city-live-badge">{activeCameraId === destination.camera.id ? 'Playing live' : 'Live camera'}</small>}
          </button>;
        })}
        {!ordered.length && <span role="status">{error ? 'Cities are temporarily unavailable.' : 'Loading cities...'}</span>}
      </div>
      {error && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttempt(value => value + 1)}
        aria-label="Retry destinations" title="Retry destinations"><RotateCw size={16} /></button>}
    </div>
  );
}
