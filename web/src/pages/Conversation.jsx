import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import { subscribeToSession, getAccessToken } from '../auth/session';
import { uploadMessageMedia } from './messageMediaUpload';
import { createMessageRequestScope, messageFileError } from './messageSecurity.mjs';
import MessageAttachment from './MessageAttachment';
import EmojiPicker from '../components/EmojiPicker';

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function Conversation() {
  const { userId } = useParams();
  const { profile, token } = useAuth();
  const session = useRef({ token, revision: 0 });
  if (session.current.token !== token) session.current = { token, revision: session.current.revision + 1 };
  return <ConversationThread key={JSON.stringify([profile?.id, userId, session.current.revision])} userId={userId} profile={profile} token={token} />;
}

function ConversationThread({ userId, profile, token }) {
  const navigate = useNavigate();
  const scope = useRef(createMessageRequestScope());
  const readRequest = useRef(0);
  const uploadRequest = useRef(0);
  const sendLock = useRef(false);
  const [sendError, setSendError] = useState('');
  const [previewUrl, setPreviewUrl] = useState(null);

  const [messages,     setMessages]     = useState([]);
  const [participant,  setParticipant]  = useState(null);
  const [text,         setText]         = useState('');
  const [sending,      setSending]      = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  // Staged attachment (photo library, camera, or — later — anything else
  // added to this menu): uploaded eagerly on pick, same as Post/GroupDetail's
  // own composers, so send() just fires with a real URL already in hand
  // instead of an upload-then-send round trip blocking the button.
  const [attachment,      setAttachment]      = useState(null);
  const [uploading,       setUploading]       = useState(false);
  const [uploadProgress,  setUploadProgress]  = useState(0);
  const [attachError,     setAttachError]     = useState('');
  const [menuOpen,        setMenuOpen]        = useState(false);
  const menuRef    = useRef(null);
  const plusBtnRef = useRef(null);
  const photoInputRef  = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          plusBtnRef.current && !plusBtnRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  function loadConversation() {
    const id = ++readRequest.current;
    const activeScope = scope.current;
    setError(false);
    setLoading(true);
    client.get(`/messages/${encodeURIComponent(userId)}`, { signal: activeScope.signal })
      .then(({ data }) => {
        if (!activeScope.isCurrent() || id !== readRequest.current) return;
        setMessages(data.messages || []);
        setParticipant(data.participant || null);
      })
      .catch(() => { if (activeScope.isCurrent() && id === readRequest.current) setError(true); })
      .finally(() => { if (activeScope.isCurrent() && id === readRequest.current) setLoading(false); });
  }

  useEffect(() => {
    scope.current = createMessageRequestScope();
    const activeScope = scope.current;
    const unsubscribe = subscribeToSession(next => { if (next !== token) activeScope.close(); });
    loadConversation();
    return () => { activeScope.close(); unsubscribe(); };
  }, []); // The parent remounts this thread whenever the member, session or recipient changes.

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages]);

  async function handleFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || uploading || sending || !scope.current.isCurrent()) return;
    setMenuOpen(false);
    const fileError = messageFileError(file);
    if (fileError) { setAttachError(fileError); return; }
    const id = ++uploadRequest.current;
    const activeScope = scope.current;
    setAttachError('');
    setAttachment(null);
    setPreviewUrl(null);
    setUploading(true);
    setUploadProgress(0);
    try {
      const result = await uploadMessageMedia(file, progress => {
        if (activeScope.isCurrent() && id === uploadRequest.current) setUploadProgress(progress);
      }, activeScope.signal);
      if (!activeScope.isCurrent() || id !== uploadRequest.current) return;
      setAttachment(result);
      setPreviewUrl(URL.createObjectURL(file));
    } catch (err) {
      if (!activeScope.isCurrent() || id !== uploadRequest.current) return;
      setAttachError(err?.response?.data?.message || err?.message || 'Upload failed. Please try again.');
    } finally {
      if (activeScope.isCurrent() && id === uploadRequest.current) setUploading(false);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim() && !attachment) return;
    if (uploading || sendLock.current || loading || error || !participant || !scope.current.isCurrent() || getAccessToken() !== token) return;
    const activeScope = scope.current;
    sendLock.current = true;
    setSendError('');
    setSending(true);
    try {
      const { data } = await client.post(`/messages/${encodeURIComponent(userId)}`, {
        content: text.trim(),
        ...(attachment ? { attachment } : {}),
      }, { signal: activeScope.signal });
      if (!activeScope.isCurrent()) return;
      setMessages((prev) => [...prev, data.message]);
      if (!participant && data.participant) setParticipant(data.participant);
      setText('');
      setAttachment(null);
      setPreviewUrl(null);
      setAttachError('');
    } catch { if (activeScope.isCurrent()) setSendError('Your message could not be sent. Try again.'); }
    finally { sendLock.current = false; if (activeScope.isCurrent()) setSending(false); }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(e); }
  }

  return (
    <div className="conversation-page">
      {/* Top bar */}
      <div className="conv-topbar">
        <button className="conv-topbar-back" onClick={() => navigate('/messages')}>←</button>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: participant ? 'pointer' : 'default', minWidth: 0 }}
          onClick={() => participant && navigate(userId === profile?.id ? '/profile' : `/u/${encodeURIComponent(userId)}`)}
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
            <div style={{ fontSize:'.82rem', fontWeight:800, marginBottom:8 }}>!</div>
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
                <div className="msg-bubble" style={msg.attachment ? { padding: msg.content ? undefined : 4 } : undefined}>
                  {msg.attachment && <MessageAttachment attachment={msg.attachment} userId={userId} messageId={msg.id} scope={scope.current} />}
                  {msg.content && <div style={msg.attachment ? { marginTop: 6 } : undefined}>{msg.content}</div>}
                </div>
                <div className="msg-time">{timeLabel(msg.createdAt)}</div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Staged attachment — uploaded eagerly on pick (see handleFileChosen),
          so this is a real preview of exactly what send() will attach, not
          a placeholder. */}
      {(attachment || uploading || attachError) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 14px', borderTop: '1px solid var(--border)',
        }}>
          {uploading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.8rem', color: 'var(--muted)' }}>
              <span className="spinner" style={{ width: 14, height: 14 }} />
              Uploading… {Math.round(uploadProgress * 100)}%
            </div>
          ) : attachError ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.8rem', color: 'var(--danger, #DC2626)' }}>
              ! {attachError}
              <button type="button" onClick={() => setAttachError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontWeight: 700 }}>Close</button>
            </div>
          ) : attachment && (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              {attachment.type === 'video' ? (
                <video src={previewUrl} style={{ height: 56, borderRadius: 8, display: 'block' }} muted />
              ) : (
                <img src={previewUrl} alt="" style={{ height: 56, width: 56, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
              )}
              <button
                type="button"
                onClick={() => { setAttachment(null); setPreviewUrl(null); }}
                aria-label="Remove attachment"
                style={{
                  position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%',
                  background: 'rgba(0,0,0,.65)', color: '#fff', border: 'none', cursor: 'pointer',
                  fontSize: '.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >Remove</button>
            </div>
          )}
        </div>
      )}
      {sendError && <div role="alert" style={{ padding: '8px 14px', color: 'var(--danger, #DC2626)' }}>{sendError}</div>}

      {/* Input bar */}
      <form className="msg-input-bar" onSubmit={handleSend}>
        <input ref={photoInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" onChange={handleFileChosen} style={{ display: 'none' }} />
        <input ref={cameraInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={handleFileChosen} style={{ display: 'none' }} />

        <div style={{ position: 'relative' }}>
          <button
            ref={plusBtnRef}
            type="button"
            className="msg-send-btn"
            disabled={loading || error || sending || uploading || !participant}
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Add attachment"
            aria-expanded={menuOpen}
            title="Add a photo, take a photo, or add an emoji"
          >
            +
          </button>
          {menuOpen && (
            <div
              ref={menuRef}
              role="menu"
              style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 40,
                minWidth: 190, background: 'var(--card-bg, var(--surface))', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', boxShadow: '0 12px 32px rgba(0,0,0,.18)',
                padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMenuOpen(false); photoInputRef.current?.click(); }}
                style={{
                  all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '9px 10px', borderRadius: 'var(--radius-sm)',
                  fontSize: '.85rem', fontWeight: 600, color: 'var(--text)', cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                Photo or video
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => { setMenuOpen(false); cameraInputRef.current?.click(); }}
                style={{
                  all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10,
                  width: '100%', padding: '9px 10px', borderRadius: 'var(--radius-sm)',
                  fontSize: '.85rem', fontWeight: 600, color: 'var(--text)', cursor: 'pointer',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                Take a photo
              </button>
              {/* Renders its own trigger button + popover — dropped in as a
                  menu row rather than reimplementing a picker, same
                  component Post/GroupDetail's composers already use. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 4px' }}>
                <EmojiPicker textareaRef={textareaRef} value={text} onChange={setText} />
                <span style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--text)' }}>Emoji</span>
              </div>
            </div>
          )}
        </div>

        <textarea
          ref={textareaRef}
          className="msg-input"
          rows={1}
          placeholder="Write a message…"
          value={text}
          maxLength={2000}
          disabled={loading || error || sending || !participant}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="msg-send-btn" type="submit" disabled={loading || error || !participant || sending || uploading || (!text.trim() && !attachment)}>
          ↑
        </button>
      </form>
    </div>
  );
}
