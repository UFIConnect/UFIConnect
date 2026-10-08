import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import { deviceFeedLocationHeader } from '../utils/deviceFeedLocation.mjs';
import { allowFeedLocation, feedLocationIsRequired, subscribeToRequiredFeedLocation } from '../utils/requiredFeedLocation.mjs';

export default function RequireFeedLocation({ children }) {
  const { token, deviceLocationRevision, retryDeviceLocation } = useAuth();
  const blocked = useSyncExternalStore(subscribeToRequiredFeedLocation, () => feedLocationIsRequired(token));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (blocked && deviceFeedLocationHeader(token)) allowFeedLocation(token);
  }, [blocked, token, deviceLocationRevision]);

  async function retry() {
    setPending(true); setMessage('');
    try {
      const { data } = await client.get('/feed/location');
      if (!data.automaticLocationAvailable) setMessage('We could not detect your area. Allow device location in your browser settings, then select Enable location.');
    } catch { setMessage('We could not check your location. Check your connection and try again.'); }
    finally { setPending(false); }
  }
  if (!blocked) return children;
  return <main className="session-recovery">
    <h1>Location is required for your feed</h1>
    <p>Enable device location for nearby posts, or use automatic IP location. Your feed opens when either is available.</p>
    <p>Device location is used for recommendations within 100 miles. IP location is approximate.</p>
    <button type="button" className="btn btn-primary" onClick={retryDeviceLocation}>Enable location</button>
    <button type="button" className="btn" disabled={pending} onClick={retry}>{pending ? 'Checking location…' : 'Retry automatic location'}</button>
    {message && <p role="status">{message}</p>}
    <p>If permission is blocked, allow location in your browser’s site settings.</p>
    <p><Link to="/profile">Profile</Link> · <Link to="/settings">Settings</Link> · <Link to="/privacy">Privacy policy</Link></p>
  </main>;
}
