import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useTabMetrics from '../analytics/useTabMetrics';
import Layout from '../components/Layout';
import client from '../api/client';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import ConnectedInboxSources, { inboxExternalUrl, inboxSourceName } from '../components/ConnectedInboxSources';
import './Messages.css';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function NewMessageModal({ onClose, onSelect }) {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const opener = document.activeElement;
    inputRef.current?.focus();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!query.trim()) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await client.get(`/users/search?q=${encodeURIComponent(query.trim())}&limit=8`);
        setResults(data.users || data.results || []);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  return (
    <div
      onClick={onClose}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 80,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New message"
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--surface)', borderRadius: 16,
          width: 'min(480px, 92vw)',
          boxShadow: '0 16px 48px rgba(0,0,0,.18)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 700, fontSize: '.95rem' }}>New Message</span>
          <button type="button" aria-label="Close new message" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--muted)', lineHeight: 1 }}>×</button>
        </div>

        {/* Search input */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.4, fontSize: '.85rem', pointerEvents: 'none' }}>Q</span>
            <input
              ref={inputRef}
              className="form-input"
              placeholder="Search by name, role or skills…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ paddingLeft: 34, width: '100%', borderRadius: 10 }}
            />
          </div>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <span className="spinner spinner-primary" />
            </div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <div style={{ padding: '20px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: '.85rem' }}>
              No users found for "{query}"
            </div>
          )}
          {!loading && !query.trim() && (
            <div style={{ padding: '20px 20px', textAlign: 'center', color: 'var(--muted)', fontSize: '.85rem' }}>
              Type a name to search
            </div>
          )}
          {results.map(user => (
            <button
              key={user.id}
              onClick={() => onSelect(user)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                width: '100%', padding: '12px 20px', background: 'none',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                borderBottom: '1px solid var(--border)',
              }}
              onMouseOver={e => e.currentTarget.style.background = 'var(--bg-secondary)'}
              onMouseOut={e => e.currentTarget.style.background = 'none'}
            >
              <div className="avatar avatar-md" style={{ flexShrink: 0 }}>
                {initials(user.name)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '.88rem' }}>{user.name}</div>
                {(user.title || user.preferences?.role) && (
                  <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.title || user.preferences?.role}
                    {user.organization ? ` · ${user.organization}` : ''}
                  </div>
                )}
              </div>
              <span style={{ fontSize: '.72rem', color: 'var(--primary)', fontWeight: 600, flexShrink: 0 }}>Message →</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Messages({ embedded = false }) {
  const navigate = useNavigate();
  const [convs, setConvs] = useState([]);
  const [sources, setSources] = useState([]);
  const [filter, setFilter] = useState('all');
  useTabMetrics('message_source', filter);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selected, setSelected] = useState(null);
  const [thread, setThread] = useState(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState('');
  const [readError, setReadError] = useState('');
  const request = useRef(0);
  const threadRequest = useRef(0);
  const selectedRef = useRef(null);

  const loadMessages = useCallback(async () => {
    const id = ++request.current;
    setError('');
    setSourceError('');
    setLoading(true);
    const loadGroup = async (endpoint, origin) => {
      try {
        const { data } = await client.get(endpoint);
        if (id !== request.current) return;
        const next = (data.conversations || []).map(conv => ({ ...conv, ...(origin === 'native' ? { source: 'ufi' } : {}), origin }));
        if (origin === 'connected') {
          setSources(data.sources || []);
          setFilter(current => ['all', 'ufi'].includes(current) || next.some(conv => conv.source === current) || (data.sources || []).some(source => source.source === current) ? current : 'all');
          if (selectedRef.current && !next.some(conv => conv.source === selectedRef.current.source && conv.id === selectedRef.current.id)) {
            threadRequest.current += 1;
            selectedRef.current = null;
            setSelected(null);
            setThread(null);
          }
        }
        setConvs(current => [...current.filter(conv => conv.origin !== origin), ...next]
          .sort((a, b) => (Date.parse(b.lastMessage?.createdAt) || 0) - (Date.parse(a.lastMessage?.createdAt) || 0)));
      } catch {
        if (id !== request.current) return;
        if (origin === 'native') setError('Could not load UFIConnect messages. Try refreshing.');
        else setSourceError('Could not refresh connected sources. Try again.');
      }
    };
    await Promise.allSettled([loadGroup('/messages', 'native'), loadGroup('/connected-inbox/messages', 'connected')]);
    if (id === request.current) setLoading(false);
  }, []);
  useEffect(() => { loadMessages(); return () => { request.current += 1; threadRequest.current += 1; }; }, [loadMessages]);

  useEffect(() => {
    if (!showModal) return;
    const close = event => { if (event.key === 'Escape') setShowModal(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [showModal]);

  async function markThreadRead(conv, requestId) {
    try {
      const { data } = await client.post('/connected-inbox/messages/mark-read', { ids: [conv.id] });
      if (requestId !== threadRequest.current) return;
      if (Array.isArray(data.markedIds) && !data.markedIds.includes(conv.id)) throw new Error('Read status was not saved');
      setConvs(current => current.map(item => item.id === conv.id && item.source === conv.source ? { ...item, unreadCount: 0 } : item));
      setReadError('');
      window.dispatchEvent(new Event('ufi-notifications-updated'));
    } catch {
      if (requestId === threadRequest.current) setReadError('Could not save read status. Try opening this conversation again.');
    }
  }
  async function openConversation(conv) {
    if (conv.origin !== 'connected') { navigate(`/messages/${encodeURIComponent(conv.participant?.id || conv.id)}`); return; }
    const id = ++threadRequest.current;
    selectedRef.current = conv;
    setSelected(conv);
    setThread(null);
    setThreadError('');
    setReadError('');
    setThreadLoading(true);
    try {
      const { data } = await client.get(`/connected-inbox/messages/${encodeURIComponent(conv.source)}/${encodeURIComponent(conv.id)}`);
      if (id !== threadRequest.current) return;
      setThread({ ...conv, ...data.conversation, messages: data.messages || data.conversation?.messages || [] });
      setThreadLoading(false);
      await markThreadRead(conv, id);
    } catch {
      if (id === threadRequest.current) {
        setThreadError('Could not load this conversation. Refresh it or open the original source.');
        setThreadLoading(false);
      }
    }
  }
  function closeThread() { threadRequest.current += 1; selectedRef.current = null; setSelected(null); setThread(null); }
  function handleSelectUser(user) { setShowModal(false); navigate(`/messages/${encodeURIComponent(user.id)}`); }
  const totalUnread = convs.reduce((sum, conv) => sum + Math.max(0, Number(conv.unreadCount) || 0), 0);
  const visible = convs.filter(conv => filter === 'all' || conv.source === filter);
  const sourceOptions = [...new Set([...sources.map(source => source.source), ...convs.filter(conv => conv.origin === 'connected').map(conv => conv.source)])];
  const threadUrl = inboxExternalUrl(thread?.url || selected?.url);

  const content = <>
    {showModal && <NewMessageModal onClose={() => setShowModal(false)} onSelect={handleSelectUser} />}
    <div className="page-header messages-header">
      <div>{!embedded && <h1 className="page-title">Messages</h1>}<p className="page-subtitle">{loading ? 'Loading your inboxes' : totalUnread > 0 ? `${totalUnread} unread message${totalUnread > 1 ? 's' : ''}` : 'Your UFIConnect and connected source conversations'}</p></div>
      <div className="messages-header-actions"><button className="btn btn-ghost btn-sm" aria-label="Refresh messages" disabled={loading} onClick={loadMessages}><RefreshCw size={17} /></button><button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>New Message</button></div>
    </div>
    <div className="messages-inboxes">
      <div className={`messages-list-pane${selected ? ' has-selection' : ''}`}>
        <label className="inbox-source-filter">Source<select aria-label="Message source" value={filter} onChange={event => { setFilter(event.target.value); closeThread(); }}><option value="all">All sources</option><option value="ufi">UFIConnect</option>{sourceOptions.map(source => <option key={source} value={source}>{inboxSourceName(source)}</option>)}</select></label>
        <ConnectedInboxSources sources={sources} kind="messages" error={sourceError} onRetry={loadMessages} />
        {error && <div role="alert" className="connected-inbox-error">{error}<button className="btn btn-ghost btn-sm" onClick={loadMessages}>Try again</button></div>}
        {loading && !convs.length ? <div className="inbox-state" role="status"><span className="spinner spinner-primary" /> Loading conversations</div> : !visible.length ? <div className="empty-state"><div className="empty-title">No conversations in this inbox</div><div className="empty-desc">{filter === 'ufi' ? 'Start a conversation with someone in your UFIConnect network.' : 'Messages from supported connected accounts appear here. Check connected sources for access and availability.'}</div><Link to={filter === 'ufi' ? '/search' : '/connected-accounts'} className="btn btn-ghost btn-sm">{filter === 'ufi' ? 'Find people' : 'Manage connected accounts'}</Link></div> : <div className="conv-list">{visible.map(conv => <button key={`${conv.source}:${conv.id}`} className={`conv-item${conv.unreadCount > 0 ? ' unread' : ''}${selected?.id === conv.id ? ' selected' : ''}`} onClick={() => openConversation(conv)}>
          <span className="avatar avatar-md">{initials(conv.participant?.name || conv.title || inboxSourceName(conv.source))}</span>
          <span className="conv-info"><span className="conv-name">{conv.title || conv.participant?.name || 'Conversation'}</span><span className="message-source-label">{inboxSourceName(conv.source)}</span><span className="conv-last">{conv.lastMessage?.isMe && 'You: '}{conv.lastMessage?.text || conv.lastMessage?.content || (conv.lastMessage?.hasAttachment ? 'Attachment' : 'Open conversation')}</span></span>
          <span className="conv-right"><span className="conv-time">{timeAgo(conv.lastMessage?.createdAt)}</span>{conv.unreadCount > 0 && <span className="conv-unread-badge" aria-label={`${conv.unreadCount} unread`}>{conv.unreadCount}</span>}</span>
        </button>)}</div>}
      </div>
      {selected && <section className="connected-message-thread" aria-label="Connected source conversation">
        <div className="connected-message-heading"><button className="btn btn-ghost btn-sm" aria-label="Back to conversations" onClick={closeThread}><ArrowLeft size={18} /></button><div><h2>{selected.title || selected.participant?.name || 'Conversation'}</h2><span>{inboxSourceName(selected.source)}</span></div></div>
        <p className="connected-message-note">Recent messages synced from {inboxSourceName(selected.source)}. Open the source to reply or view older messages.</p>
        {threadUrl && <a href={threadUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm connected-message-open">Open {inboxSourceName(selected.source)} <ExternalLink size={14} /></a>}
        {threadLoading ? <div className="inbox-state" role="status"><span className="spinner spinner-primary" /> Loading conversation</div> : threadError ? <div className="connected-inbox-error" role="alert">{threadError}<button className="btn btn-ghost btn-sm" onClick={() => openConversation(selected)}>Retry conversation</button></div> : <>
          {readError && <div className="connected-inbox-error" role="alert">{readError}<button className="btn btn-ghost btn-sm" onClick={() => markThreadRead(selected, threadRequest.current)}>Retry read status</button></div>}
          {thread?.messages?.length ? <ol className="connected-message-list">{thread.messages.map((message, index) => <li key={message.id || index}><div><strong>{message.senderName || selected.participant?.name || inboxSourceName(selected.source)}</strong><time dateTime={message.createdAt || undefined}>{message.createdAt && new Date(message.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></div><p>{message.text || 'This message contains content available on the original source.'}</p></li>)}</ol> : <div className="inbox-state">No recent messages were returned. Open the source to view the conversation.</div>}
        </>}
      </section>}
    </div>
  </>;
  return embedded ? content : <Layout unreadCount={totalUnread}>{content}</Layout>;
}
