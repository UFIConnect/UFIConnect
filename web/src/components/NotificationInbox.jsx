import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Heart, MessageCircle, RefreshCw, UserPlus, ExternalLink } from 'lucide-react';
import client from '../api/client';
import { useToast } from '../contexts/ToastContext';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import ConnectedInboxSources, { inboxExternalUrl, inboxSourceName } from './ConnectedInboxSources';

const actions = { like: 'liked your post', comment: 'commented on your post', new_follower: 'started following you', connection_request: 'wants to connect' };
const readFailureMessage = 'Could not save read status. Your unread updates are still available.';
function age(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  if (!Number.isFinite(minutes)) return '';
  return minutes < 1 ? 'Now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
}

export default function NotificationInbox({ compact = false, onNavigate }) {
  const [items, setItems] = useState([]);
  const [sources, setSources] = useState([]);
  const [filter, setFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [readError, setReadError] = useState('');
  const [busy, setBusy] = useState({});
  const [resolved, setResolved] = useState({});
  const request = useRef(0);
  const mounted = useRef(false);
  const readInFlight = useRef(false);
  const attempted = useRef(new Set());
  const failedReads = useRef(new Map());
  const { showToast } = useToast();
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    setSourceError('');
    const loadGroup = async (endpoint, origin) => {
      try {
        const { data } = await client.get(endpoint);
        if (id !== request.current) return;
        const rows = (data.notifications || []).filter(Boolean).map(item => ({ ...item, ...(origin === 'native' ? { source: 'ufi' } : {}), origin }));
        for (const [itemId, itemOrigin] of failedReads.current) if (itemOrigin === origin) failedReads.current.delete(itemId);
        setReadError(failedReads.current.size ? readFailureMessage : '');
        rows.forEach(item => attempted.current.delete(item.id));
        if (origin === 'connected') {
          setSources(data.sources || []);
          setSourceFilter(current => ['all', 'ufi'].includes(current) || rows.some(item => item.source === current) || (data.sources || []).some(source => source.source === current) ? current : 'all');
        }
        setItems(current => [...current.filter(item => item.origin !== origin), ...rows]
          .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)));
      } catch {
        if (id !== request.current) return;
        if (origin === 'native') setError('Could not load UFIConnect notifications. Please try again.');
        else setSourceError('Could not refresh connected sources. Please try again.');
      }
    };
    await Promise.allSettled([loadGroup('/notifications', 'native'), loadGroup('/connected-inbox/notifications', 'connected')]);
    if (id === request.current) setLoading(false);
  }, []);
  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; request.current += 1; }; }, [load]);
  useScrollToRefresh(load, { enabled: !compact && !loading });

  const markRead = useCallback(async (rows) => {
    if (readInFlight.current || !rows.length) return;
    readInFlight.current = true;
    rows.forEach(item => attempted.current.add(item.id));
    setBusy(current => ({ ...current, read: true }));
    const groups = [
      { endpoint: '/notifications/mark-read', rows: rows.filter(item => item.origin === 'native') },
      { endpoint: '/connected-inbox/notifications/mark-read', rows: rows.filter(item => item.origin === 'connected') },
    ].filter(group => group.rows.length);
    const results = await Promise.allSettled(groups.map(group => client.post(group.endpoint, { ids: group.rows.map(item => item.id) })));
    const marked = new Set();
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') (result.value.data.markedIds || groups[index].rows.map(item => item.id)).forEach(id => marked.add(id));
    });
    rows.forEach(item => { if (marked.has(item.id)) failedReads.current.delete(item.id); else failedReads.current.set(item.id, item.origin); });
    if (marked.size) window.dispatchEvent(new CustomEvent('ufi-notifications-read', { detail: { ids: [...marked] } }));
    window.dispatchEvent(new Event('ufi-notifications-updated'));
    readInFlight.current = false;
    if (!mounted.current) return;
    setItems(current => current.map(item => marked.has(item.id) ? { ...item, read: true } : item));
    setReadError(failedReads.current.size ? readFailureMessage : '');
    setBusy(current => ({ ...current, read: false }));
  }, []);

  // Acknowledge only the updates this inbox has loaded. New arrivals stay unread.
  useEffect(() => {
    if (!busy.read) markRead(items.filter(item => item.read === false && !attempted.current.has(item.id)));
  }, [items, busy.read, markRead]);
  useEffect(() => {
    const syncRead = event => {
      const ids = new Set(event.detail?.ids || []);
      ids.forEach(id => failedReads.current.delete(id));
      setReadError(failedReads.current.size ? readFailureMessage : '');
      setItems(current => current.map(item => ids.has(item.id) ? { ...item, read: true } : item));
    };
    window.addEventListener('ufi-notifications-read', syncRead);
    return () => window.removeEventListener('ufi-notifications-read', syncRead);
  }, []);

  async function respond(item, accept) {
    setBusy(current => ({ ...current, [item.id]: true }));
    try {
      const url = `/users/${encodeURIComponent(item.user.id)}/connect`;
      if (accept) await client.post(url); else await client.delete(url);
      setResolved(current => ({ ...current, [item.id]: accept ? 'Connected' : 'Declined' }));
      window.dispatchEvent(new Event('ufi-notifications-updated'));
    } catch { showToast('Could not update this request. Please try again.', 'error'); }
    finally { if (mounted.current) setBusy(current => ({ ...current, [item.id]: false })); }
  }
  const sourceOptions = [...new Set([...sources.map(source => source.source), ...items.filter(item => item.origin === 'connected').map(item => item.source)])];
  const visible = items.filter(item => (sourceFilter === 'all' || item.source === sourceFilter) && (filter === 'All' || (filter === 'Unread' ? item.read === false : item.type === 'connection_request' && !resolved[item.id])));
  const groups = [['Today', []], ['This week', []], ['Earlier', []]];
  const today = new Date().setHours(0, 0, 0, 0);
  visible.forEach(item => { const date = Date.parse(item.createdAt); groups[date >= today ? 0 : date >= today - 6 * 86400000 ? 1 : 2][1].push(item); });
  return <div className={`notification-inbox${compact ? ' compact' : ''}`}>
    <div className="inbox-controls">
      <div className="inbox-tabs" role="group" aria-label="Notification filter">
        {['All', 'Unread', 'Requests'].map(label => <button key={label} aria-pressed={filter === label} onClick={() => setFilter(label)}>{label}</button>)}
      </div>
      <button className="inbox-icon" aria-label="Mark all as read" title="Mark all loaded notifications as read" disabled={busy.read || !items.some(item => item.read === false)} onClick={() => markRead(items.filter(item => item.read === false))}><CheckCheck size={19} /></button>
      <button className="inbox-icon" aria-label="Refresh notifications" title="Refresh notifications" disabled={loading || busy.read} onClick={load}><RefreshCw size={18} /></button>
    </div>
    <label className="inbox-source-filter">Source<select value={sourceFilter} onChange={event => setSourceFilter(event.target.value)} aria-label="Notification source"><option value="all">All sources</option><option value="ufi">UFIConnect</option>{sourceOptions.map(source => <option key={source} value={source}>{inboxSourceName(source)}</option>)}</select></label>
    <ConnectedInboxSources sources={sources} error={sourceError} onRetry={load} />
    {readError && <div className="connected-inbox-error" role="alert">{readError}<button className="btn btn-ghost btn-sm" disabled={busy.read} onClick={() => markRead(items.filter(item => item.read === false))}>Retry read status</button></div>}
    {error && <div className="inbox-state" role="alert">{error}<button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>}
    {loading && !items.length ? <div className="inbox-state" role="status"><span className="spinner spinner-primary" /> Loading notifications</div> : !error && !visible.length ? <div className="inbox-state"><Bell size={28} /><strong>{filter === 'Unread' ? 'You are all caught up' : filter === 'Requests' ? 'No pending requests' : 'No notifications yet'}</strong></div> : groups.map(([label, rows]) => rows.length > 0 && <section key={label} className="inbox-section">
      <h2>{label}</h2>
      {rows.map(item => {
        const person = item.user;
        const connected = item.origin === 'connected';
        const external = connected && inboxExternalUrl(item.url);
        const target = ['like', 'comment'].includes(item.type) && item.targetId ? `/p/${encodeURIComponent(item.targetId)}` : person?.id ? `/u/${encodeURIComponent(person.id)}` : '/';
        const Icon = item.type === 'like' ? Heart : item.type === 'comment' ? MessageCircle : item.type === 'new_follower' || item.type === 'connection_request' ? UserPlus : Bell;
        const content = <><span className="inbox-avatar"><span>{(person?.name || inboxSourceName(item.source)).split(' ').map(word => word[0]).join('').slice(0, 2)}</span>{person?.avatarUrl && <img src={person.avatarUrl} alt="" onError={event => { event.currentTarget.hidden = true; }} />}<span className={`inbox-kind ${item.type}`}><Icon size={11} /></span></span>
          <span className="inbox-copy"><span>{connected ? <strong>{item.title || person?.name || inboxSourceName(item.source)}</strong> : <><strong>{person?.name || 'UFIConnect'}</strong> {actions[item.type] || 'sent you an update'}</>}</span>{item.preview && <span className="inbox-preview">{item.preview}</span>}<span className="inbox-item-meta"><span>{inboxSourceName(item.source)}</span><time dateTime={item.createdAt || undefined}>{age(item.createdAt)}</time>{external && <ExternalLink size={12} aria-label="Opens source" />}</span></span>
          {item.read === false && <span className="inbox-unread-dot" aria-label="Unread" />}</>;
        return <article key={item.id} className={`inbox-item${item.read === false ? ' unread' : ''}`}>
          {connected ? external ? <a href={external} target="_blank" rel="noopener noreferrer" onClick={onNavigate} className="inbox-item-link">{content}</a> : <div className="inbox-item-link">{content}</div> : <Link to={target} onClick={onNavigate} className="inbox-item-link">{content}</Link>}
          {item.type === 'connection_request' && person?.id && <div className="inbox-request-actions">{resolved[item.id] ? <span role="status">{resolved[item.id]}</span> : <><button className="btn btn-primary btn-sm" disabled={busy[item.id]} onClick={() => respond(item, true)}>Accept</button><button className="btn btn-ghost btn-sm" disabled={busy[item.id]} onClick={() => respond(item, false)}>Decline</button></>}</div>}
        </article>;
      })}
    </section>)}
  </div>;
}
