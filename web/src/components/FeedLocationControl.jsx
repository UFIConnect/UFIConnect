import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import { regionalFeedLocation } from '../utils/feedLocation.mjs';
import './FeedLocationControl.css';

export default function FeedLocationControl({ context, compact = false }) {
  const { profile, updateProfileLocally } = useAuth();
  const saved = regionalFeedLocation(profile?.roleSettings);
  const savedKey = JSON.stringify(saved);
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const memberRef = useRef(profile?.id);
  const profileRef = useRef(profile);
  const requestRef = useRef(null);
  memberRef.current = profile?.id;
  profileRef.current = profile;
  useEffect(() => { setDraft(JSON.parse(savedKey)); setMessage(''); }, [profile?.id, savedKey]);
  useEffect(() => { setSaving(false); }, [profile?.id]);
  useEffect(() => () => requestRef.current?.abort(), [profile?.id]);
  const place = [context?.city, context?.countryName || context?.country].filter(Boolean).join(', ');
  const label = saved.mode === 'off' ? 'Global' : saved.mode === 'manual'
    ? [saved.city, saved.country].filter(Boolean).join(', ') : place ? `Automatic · ${place}` : 'Automatic location';

  async function save(event) {
    event.preventDefault();
    if (saving || !profile?.id) return;
    const memberId = profile.id;
    const next = regionalFeedLocation({ feedRegionalLocation: draft });
    const controller = new AbortController();
    requestRef.current = controller;
    setSaving(true); setMessage('');
    try {
      const { data } = await client.patch('/profile', { roleSettings: { feedRegionalLocation: next } }, { signal: controller.signal });
      if (memberRef.current !== memberId || controller.signal.aborted) return;
      const persisted = (data.profile || data)?.roleSettings?.feedRegionalLocation || next;
      updateProfileLocally({ roleSettings: { ...profileRef.current?.roleSettings, feedRegionalLocation: persisted } });
      setMessage('Feed location saved.');
    } catch (error) {
      if (!controller.signal.aborted && memberRef.current === memberId) setMessage(error?.response?.data?.message || 'Location could not be saved. Your previous setting is still active.');
    } finally {
      if (memberRef.current === memberId) setSaving(false);
    }
  }

  return <details className={`feed-region-control${compact ? ' feed-region-control--compact' : ''}`}>
    <summary><MapPin size={16} aria-hidden="true" /><span>Feed location: {label}</span></summary>
    <form onSubmit={save} className="feed-region-form">
      <label>Location preference<select aria-label="Feed location preference" value={draft.mode} disabled={saving} onChange={event => setDraft(current => ({ ...current, mode: event.target.value }))}>
        <option value="auto">Automatic</option><option value="manual">Choose a location</option><option value="off">Global</option>
      </select></label>
      <p>Applies to your Home, source, video, and music feeds. Travel, Restaurants, and Bars each keep their own destination.</p>
      {draft.mode === 'auto' && <p>{context?.available && saved.mode === 'auto' ? `Current area: ${place || 'country available'}. ` : 'If an approximate area is unavailable, you will see global results. '}Automatic location is approximate and may follow your VPN connection.</p>}
      {draft.mode === 'manual' && <div className="feed-region-fields">
        <label>Country<input aria-label="Feed country" autoComplete="country-name" required maxLength={80} value={draft.country} disabled={saving} onChange={event => setDraft(current => ({ ...current, country: event.target.value }))} /></label>
        <label>City (optional)<input aria-label="Feed city" autoComplete="address-level2" maxLength={80} value={draft.city} disabled={saving} onChange={event => setDraft(current => ({ ...current, city: event.target.value }))} /></label>
      </div>}
      <button type="submit" className="btn btn-primary btn-sm" disabled={saving || !profile?.id}>{saving ? 'Saving…' : 'Save feed location'}</button>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
