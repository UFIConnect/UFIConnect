import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function Conversation() {
  const { userId } = useParams();
  const navigate   = useNavigate();
  const { profile } = useAuth();

  const [messages,     setMessages]     = useState([]);
  const [participant,  setParticipant]  = useState(null);
  const [text,         setText]         = useState('');
  const [sending,      setSending]      = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(false);
  const bottomRef = useRef(null);

  function loadConversation() {
    setError(false);
    setLoading(true);
    client.get(`/messages/${userId}`)
      .then(({ data }) => {
        setMessages(data.messages || []);
        setParticipant(data.participant || null);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadConversation(); }, [userId]); // eslint-disable-line

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      const { data } = await client.post(`/messages/${userId}`, { content: text.trim() });
      setMessages((prev) => [...prev, data.message]);
      if (!participant && data.participant) setParticipant(data.participant);
      setText('');
    } catch (err) { console.error(err); }
    finally { setSending(false); }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); }
  }

  return (
    <div className="conversation-page">
      {/* Top bar */}
      <div className="conv-topbar">
        <button className="conv-topbar-back" onClick={() => navigate('/messages')}>←</button>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: participant ? 'pointer' : 'default', minWidth: 0 }}
          onClick={() => participant && navigate(userId === profile?.id ? '/profile' : `/u/${userId}`)}
        >
          {participant && (
            <div className="avatar avatar-md" style={{ marginRight: 4 }}>
              {initials(participant.name)}
            </div>
          )}
          <div>
            <div className="conv-topbar-name">{participant?.name || 'Loading…'}</div>
            {participant?.title && (
              <div className="conv-topbar-title">{participant.title}{participant.organization ? ` · ${participant.organization}` : ''}</div>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="messages-area">
        {loading && (
          <div style={{ textAlign:'center', padding:32 }}>
            <span className="spinner spinner-primary" />
          </div>
        )}
        {!loading && error && (
          <div style={{ textAlign:'center', color:'var(--muted)', marginTop:48, fontSize:'.875rem' }}>
            <div style={{ fontSize:'1.5rem', marginBottom:8 }}>⚠️</div>
            Couldn't load messages.{' '}
            <button style={{ background:'none', border:'none', cursor:'pointer', color:'var(--primary)', textDecoration:'underline', fontSize:'.875rem' }} onClick={loadConversation}>
              Try again
            </button>
          </div>
        )}
        {!loading && !error && messages.length === 0 && (
          <div style={{ textAlign:'center', color:'var(--muted)', marginTop:48, fontSize:'.875rem' }}>
            Send a message to start the conversation.
          </div>
        )}
        {messages.map((msg) => {
          const isMe = msg.senderId === profile?.id;
          return (
            <div key={msg.id} className={`msg-row ${isMe ? 'me' : 'them'}`}>
              {!isMe && (
                <div className="avatar avatar-sm">{initials(participant?.name)}</div>
              )}
              <div>
                <div className="msg-bubble">{msg.content}</div>
                <div className="msg-time">{timeLabel(msg.createdAt)}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <form className="msg-input-bar" onSubmit={handleSend}>
        <textarea
          className="msg-input"
          rows={1}
          placeholder="Write a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="msg-send-btn" type="submit" disabled={sending || !text.trim()}>
          ↑
        </button>
      </form>
    </div>
  );
}
