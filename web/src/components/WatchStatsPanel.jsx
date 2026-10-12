import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { SOURCE_META } from './sourceMeta';
import { watchHistoryStore, WATCH_CHANGED, WATCH_STORE_PREFIX } from '../media/watchHistory.mjs';
import './WatchStatsPanel.css';

const duration = milliseconds => {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
};
const sourceLabel = key => SOURCE_META[key]?.label || ({ youtube: 'YouTube', vimeo: 'Vimeo', uficonnect: 'UFIConnect' }[key]) || key;

export default function WatchStatsPanel({ accountId: requestedAccountId, days = 30 }) {
  const { profile } = useAuth();
  const accountId = requestedAccountId || profile?.id;
  const store = watchHistoryStore();
  const [entry, setEntry] = useState(() => ({ accountId, value: store.read(accountId) }));
  const [source, setSource] = useState('all');
  const [surface, setSurface] = useState('all');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const refresh = () => setEntry({ accountId, value: store.read(accountId) });
    const storageChanged = event => { if (!event.key || event.key.startsWith(WATCH_STORE_PREFIX)) refresh(); };
    refresh(); setSource('all'); setSurface('all'); setPage(1); setNotice('');
    window.addEventListener(WATCH_CHANGED, refresh);
    window.addEventListener('storage', storageChanged);
    window.addEventListener('ufi-session-cleared', refresh);
    return () => {
      window.removeEventListener(WATCH_CHANGED, refresh);
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('ufi-session-cleared', refresh);
    };
  }, [accountId, store]);
  const value = entry.accountId === accountId ? entry.value : { enabled: false, records: [], available: true };
  const cutoff = Date.now() - (days === 7 ? 7 : 30) * 86400000;
  const all = value.records.filter(row => row.lastWatchedAt >= cutoff);
  const rows = all.filter(row => (source === 'all' || row.source === source) && (surface === 'all' || row.surface === surface));
  const totals = new Map();
  for (const row of rows) totals.set(row.source, (totals.get(row.source) || 0) + row.watchMs);
  const videos = new Map();
  for (const row of rows) {
    const key = `${row.mediaKey}:${row.surface}:${row.hostSource}`;
    const previous = videos.get(key);
    if (previous) { previous.watchMs += row.watchMs; previous.sessions += row.sessions; }
    else videos.set(key, { ...row });
  }
  const visible = [...videos.values()].sort((a, b) => b.lastWatchedAt - a.lastWatchedAt);
  const pageCount = Math.max(1, Math.ceil(visible.length / 10));
  const currentPage = Math.min(page, pageCount);
  function change(work, success) { setNotice(work() ? success : 'Playback history could not be saved on this device.'); }
  return <section className="creator-analytics-section watch-stats" aria-labelledby="playback-history-title">
    <div className="creator-analytics-section-heading"><div><h2 id="playback-history-title">Your playback</h2><p>Time you spent playing Videos, Music, and Snaps in this app.</p></div></div>
    <p className="creator-analytics-caption">Stored on this device for up to 30 days and cleared when you sign out. Pauses, seeking, hidden players, and sources without measurable playback are excluded. These measurements are not provider views or earnings.</p>
    <div className="creator-analytics-card watch-stats-preferences">
      <label><input type="checkbox" checked={value.enabled} disabled={!accountId || !value.available} onChange={event => change(() => store.setEnabled(accountId, event.target.checked), event.target.checked ? 'Playback history enabled.' : 'Playback history paused.')} /> Save playback history on this device</label>
      <button type="button" className="btn btn-ghost btn-sm" disabled={!value.records.length} onClick={() => change(() => store.clear(accountId), 'Playback history cleared.')}>Clear history</button>
    </div>
    {!value.available && <p className="creator-analytics-message is-error" role="alert">Playback storage is unavailable. Videos still play normally.</p>}
    {notice && <p className="creator-analytics-message" role="status">{notice}</p>}
    <div className="watch-stats-filters"><label>Playing source<select value={source} onChange={event => { setSource(event.target.value); setPage(1); }}><option value="all">All sources</option>{[...new Set(all.map(row => row.source))].sort().map(key => <option value={key} key={key}>{sourceLabel(key)}</option>)}</select></label><label>Section<select value={surface} onChange={event => { setSurface(event.target.value); setPage(1); }}><option value="all">Videos, Music, and Snaps</option><option value="videos">Videos</option><option value="music">Music</option><option value="snaps">Snaps</option></select></label></div>
    <div className="creator-analytics-source-grid">{[...totals].map(([key, time]) => <article className="creator-analytics-card" key={key}><h3>{sourceLabel(key)}</h3><strong className="watch-stats-total">{duration(time)}</strong><p className="creator-analytics-caption">Measured playback on this device</p></article>)}</div>
    {visible.length ? <><div className="creator-analytics-table-wrap" role="region" aria-label="Playback history by video" tabIndex={0}><table><caption>Your recently played media</caption><thead><tr><th scope="col">Video</th><th scope="col">Playing source</th><th scope="col">Section</th><th scope="col">Watch time</th><th scope="col"><span className="creator-analytics-sr">Actions</span></th></tr></thead><tbody>{visible.slice((currentPage - 1) * 10, currentPage * 10).map(row => <tr key={`${row.mediaKey}:${row.surface}:${row.hostSource}`}><th scope="row">{row.title || 'Untitled video'}<small>{new Date(row.lastWatchedAt).toLocaleDateString()}{row.hostSource !== row.source ? ` · Shared from ${sourceLabel(row.hostSource)}` : ''}</small></th><td>{sourceLabel(row.source)}</td><td>{row.surface}</td><td>{duration(row.watchMs)}</td><td><button type="button" className="btn btn-ghost btn-sm" onClick={() => change(() => store.remove(accountId, row.mediaKey), 'Video removed from history.')}>Remove<span className="creator-analytics-sr"> {row.title || 'video'}</span></button></td></tr>)}</tbody></table></div><nav className="watch-stats-pages" aria-label="Playback history pages"><button type="button" className="btn btn-ghost btn-sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {pageCount}</span><button type="button" className="btn btn-ghost btn-sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></nav></> : <div className="creator-analytics-card creator-analytics-empty"><h3>No measured playback yet</h3><p>Play a supported video while history is enabled. YouTube history requires a confirmed audience classification; videos made for kids and videos with unknown classification are excluded.</p></div>}
    <p className="creator-analytics-caption">Source-player ads, creator revenue, and provider-counted views remain with the original platform. Official embeds without a playback API cannot supply watch-time measurements here.</p>
  </section>;
}
