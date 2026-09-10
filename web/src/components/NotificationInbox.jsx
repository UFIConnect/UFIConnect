import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Heart, MessageCircle, RefreshCw, UserPlus } from 'lucide-react';
import client from '../api/client';
import { useToast } from '../contexts/ToastContext';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';

const actions = { like: 'liked your post', comment: 'commented on your post', new_follower: 'started following you', connection_request: 'wants to connect' };
function age(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60000));
  if (!Number.isFinite(minutes)) return '';
  return minutes < 1 ? 'Now' : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
}

export default function NotificationInbox({ compact = false, onNavigate }) {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState({});
  const [resolved, setResolved] = useState({});
  const request = useRef(0);
  const { showToast } = useToast();
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError('');
    try {
      const { data } = await client.get('/notifications');
      if (id === request.current) setItems(Array.isArray(data.notifications) ? data.notifications.filter(Boolean).sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)) : []);
    } catch {
      if (id === request.current) setError('Could not load notifications. Please try again.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);
  useEffect(() => { load(); return () => { request.current += 1; }; }, [load]);
  useScrollToRefresh(load, { enabled: !compact && !loading });
  async function markRead() {
    setBusy(current => ({ ...current, read: true }));
    try {
      await client.post('/notifications/mark-read');
      setItems(current => current.map(item => ({ ...item, read: true })));
      window.dispatchEvent(new Event('ufi-notifications-updated'));
    } catch { showToast('Could not mark notifications read. Please try again.', 'error'); }
    finally { setBusy(current => ({ ...current, read: false })); }
  }
  async function respond(item, accept) {
    setBusy(current => ({ ...current, [item.id]: true }));
    try {
      const url = `/users/${encodeURIComponent(item.user.id)}/connect`;
      if (accept) await client.post(url); else await client.delete(url);
      setResolved(current => ({ ...current, [item.id]: accept ? 'Connected' : 'Declined' }));
      window.dispatchEvent(new Event('ufi-notifications-updated'));
    } catch { showToast('Could not update this request. Please try again.', 'error'); }
    finally { setBusy(current => ({ ...current, [item.id]: false })); }
  }
  const visible = items.filter(item => filter === 'All' || (filter === 'Unread' ? item.read === false : item.type === 'connection_request' && !resolved[item.id]));
  const groups = [['Today', []], ['This week', []], ['Earlier', []]];
  const today = new Date().setHours(0, 0, 0, 0);
  visible.forEach(item => { const date = Date.parse(item.createdAt); groups[date >= today ? 0 : date >= today - 6 * 86400000 ? 1 : 2][1].push(item); });
  return <div className={`notification-inbox${compact ? ' compact' : ''}`}>
    <div className="inbox-controls">
      <div className="inbox-tabs" role="group" aria-label="Notification filter">
        {['All', 'Unread', 'Requests'].map(label => <button key={label} aria-pressed={filter === label} onClick={() => setFilter(label)}>{label}</button>)}
      </div>
      <button className="inbox-icon" aria-label="Mark all as read" title="Mark all as read" disabled={busy.read || !items.some(item => item.read === false)} onClick={markRead}><CheckCheck size={19} /></button>
      <button className="inbox-icon" aria-label="Refresh notifications" title="Refresh notifications" disabled={loading} onClick={load}><RefreshCw size={18} /></button>
    </div>
    {error && <div className="inbox-state" role="alert">{error}<button className="btn btn-ghost btn-sm" onClick={load}>Retry</button></div>}
    {loading && !items.length ? <div className="inbox-state" role="status"><span className="spinner spinner-primary" /> Loading notifications</div> : !error && !visible.length ? <div className="inbox-state"><Bell size={28} /><strong>{filter === 'Unread' ? 'You are all caught up' : filter === 'Requests' ? 'No pending requests' : 'No notifications yet'}</strong></div> : groups.map(([label, rows]) => rows.length > 0 && <section key={label} className="inbox-section">
      <h2>{label}</h2>
      {rows.map(item => {
        const person = item.user;
        const target = ['like', 'comment'].includes(item.type) && item.targetId ? `/p/${encodeURIComponent(item.targetId)}` : person?.id ? `/u/${encodeURIComponent(person.id)}` : '/';
        const Icon = item.type === 'like' ? Heart : item.type === 'comment' ? MessageCircle : item.type === 'new_follower' || item.type === 'connection_request' ? UserPlus : Bell;
        return <article key={item.id} className={`inbox-item${item.read === false ? ' unread' : ''}`}>
          <Link to={target} onClick={onNavigate} className="inbox-item-link">
            <span className="inbox-avatar"><span>{(person?.name || 'UFI').split(' ').map(word => word[0]).join('').slice(0, 2)}</span>{person?.avatarUrl && <img src={person.avatarUrl} alt="" onError={event => { event.currentTarget.hidden = true; }} />}<span className={`inbox-kind ${item.type}`}><Icon size={11} /></span></span>
            <span className="inbox-copy"><span><strong>{person?.name || 'UFIconnect'}</strong> {actions[item.type] || 'sent you an update'}</span>{item.preview && <span className="inbox-preview">{item.preview}</span>}<time dateTime={item.createdAt || undefined}>{age(item.createdAt)}</time></span>
            {item.read === false && <span className="inbox-unread-dot" aria-label="Unread" />}
          </Link>
          {item.type === 'connection_request' && person?.id && <div className="inbox-request-actions">{resolved[item.id] ? <span role="status">{resolved[item.id]}</span> : <><button className="btn btn-primary btn-sm" disabled={busy[item.id]} onClick={() => respond(item, true)}>Accept</button><button className="btn btn-ghost btn-sm" disabled={busy[item.id]} onClick={() => respond(item, false)}>Decline</button></>}</div>}
        </article>;
      })}
    </section>)}
  </div>;
}
