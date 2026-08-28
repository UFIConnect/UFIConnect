import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import { uploadMedia, MAX_UPLOAD_BYTES } from '../api/upload';
import EmojiPicker from '../components/EmojiPicker';

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
    if (!menuOpen) return;
    function handleOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          plusBtnRef.current && !plusBtnRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

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

  async function handleFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMenuOpen(false);
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      setAttachError('Only photos and videos are supported.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setAttachError(`File is too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB).`);
      return;
    }
    setAttachError('');
    setAttachment(null);
    setUploading(true);
    setUploadProgress(0);
    try {
      const result = await uploadMedia(file, setUploadProgress, 'messages');
      setAttachment(result);
    } catch (err) {
      // Same reasoning as Post.jsx's own handleFileSelect — the real
      // message (e.g. "Media upload is not configured yet.") tells the
      // user whether retrying can possibly help, a flat "upload failed"
      // doesn't.
      setAttachError(err?.response?.data?.message || err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim() && !attachment) return;
    if (uploading) return;
    setSending(true);
    try {
      const { data } = await client.post(`/messages/${userId}`, {
        content: text.trim(),
        ...(attachment ? { attachment } : {}),
      });
      setMessages((prev) => [...prev, data.message]);
      if (!participant && data.participant) setParticipant(data.participant);
      setText('');
      setAttachment(null);
      setAttachError('');
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
                  {msg.attachment && (
                    msg.attachment.type === 'video' ? (
                      <video src={msg.attachment.url} controls style={{ maxWidth: 240, maxHeight: 320, borderRadius: 10, display: 'block' }} />
                    ) : (
                      <a href={msg.attachment.url} target="_blank" rel="noopener noreferrer">
                        <img src={msg.attachment.url} alt="Attachment" style={{ maxWidth: 240, maxHeight: 320, borderRadius: 10, display: 'block', objectFit: 'cover' }} />
                      </a>
                    )
                  )}
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
                <video src={attachment.url} style={{ height: 56, borderRadius: 8, display: 'block' }} muted />
              ) : (
                <img src={attachment.url} alt="" style={{ height: 56, width: 56, objectFit: 'cover', borderRadius: 8, display: 'block' }} />
              )}
              <button
                type="button"
                onClick={() => setAttachment(null)}
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

      {/* Input bar */}
      <form className="msg-input-bar" onSubmit={handleSend}>
        <input ref={photoInputRef} type="file" accept="image/*,video/*" onChange={handleFileChosen} style={{ display: 'none' }} />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileChosen} style={{ display: 'none' }} />

        <div style={{ position: 'relative' }}>
          <button
            ref={plusBtnRef}
            type="button"
            className="msg-send-btn"
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button className="msg-send-btn" type="submit" disabled={sending || uploading || (!text.trim() && !attachment)}>
          ↑
        </button>
      </form>
    </div>
  );
}
