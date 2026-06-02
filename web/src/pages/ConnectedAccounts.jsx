import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

const PLATFORM_BENEFITS = {
  linkedin:  ['Import your work history & headline', 'Show LinkedIn posts in your feed', 'Get matched with relevant jobs'],
  github:    ['Showcase your repos & contributions', 'Display commit activity on profile', 'Find open-source collaborators'],
  gitlab:    ['Showcase GitLab projects', 'Display CI/CD and open-source work', 'Find developer collaborators'],
  twitter:   ['Surface relevant tech threads', 'Share posts across platforms', 'Follow industry conversations'],
  instagram: ['Display your creative portfolio', 'Import content to your profile', 'Connect with visual designers'],
  facebook:  ['Join professional Facebook Groups', 'Surface industry discussions', 'Expand your network'],
  discord:   ['See activity from your servers', 'Find community members on UFI', 'Share Discord highlights'],
  youtube:   ['Import your video library', 'Surface creator content in feed', 'Connect with fellow creators'],
  reddit:    ['Follow relevant subreddits', 'Surface top posts in your feed', 'Find niche communities'],
  medium:    ['Import your published articles', 'Share writing with your network', 'Discover great long-form reads'],
  dribbble:  ['Display your design shots', 'Get discovered by hiring managers', 'Connect with top designers'],
  behance:   ['Showcase your full portfolio', 'Import case studies to profile', 'Get design feedback'],
  tiktok:    ['Follow creators in your niche', 'Surface trending videos in your feed', 'Connect with content creators'],
  bluesky:   ['Follow decentralised conversations', 'Surface posts matching your interests', 'Connect with the open social web'],
};

const HANDLE_PLATFORMS = new Set(['github', 'gitlab', 'reddit', 'youtube', 'medium', 'dribbble', 'behance', 'tiktok', 'bluesky']);

const HANDLE_PLACEHOLDER = {
  github:   'your-github-username',
  gitlab:   'your-gitlab-username',
  reddit:   'your-reddit-username',
  youtube:  'your-channel-handle',
  medium:   'your-medium-username',
  dribbble: 'your-dribbble-username',
  behance:  'your-behance-username',
  tiktok:   'your-tiktok-username',
  bluesky:  'yourhandle.bsky.social',
};

export default function ConnectedAccounts() {
  const { profile: authProfile } = useAuth();
  const [platforms, setPlatforms]       = useState([]);
  const [connected, setConnected]       = useState({});
  const [loading,   setLoading]         = useState(true);
  const [expanded,  setExpanded]        = useState(null);
  const [flash,     setFlash]           = useState(null);
  const [connecting, setConnecting]     = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);
  const [handleInputs, setHandleInputs] = useState({});
  const [savingHandle, setSavingHandle] = useState(null);

  useEffect(() => {
    Promise.all([
      client.get('/social/platforms'),
      client.get('/profile'),
    ]).then(([pRes]) => {
      setPlatforms(Object.entries(pRes.data.platforms || {}));
      setConnected(pRes.data.connected || {});
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  function flash_(type, msg, ms = 4000) {
    setFlash({ type, msg });
    setTimeout(() => setFlash(null), ms);
  }

  async function handleConnect(platform) {
    setConnecting(platform);
    try {
      const { data } = await client.get(`/auth/social/${platform}/start`);
      if (data?.url) window.location.href = data.url;
    } catch (err) {
      flash_('error', err?.response?.data?.error || 'Could not start this connection.', 6000);
      setConnecting(null);
    }
  }

  async function handleDisconnect(platform) {
    setDisconnecting(platform);
    try {
      await client.delete(`/social/connect/${platform}`);
      setConnected(prev => { const n = { ...prev }; delete n[platform]; return n; });
      flash_('success', 'Account disconnected.');
    } catch (err) {
      flash_('error', err?.response?.data?.error || 'Could not disconnect.', 6000);
    } finally {
      setDisconnecting(null);
    }
  }

  async function saveHandle(platform) {
    const raw = (handleInputs[platform] || '').replace(/^@/, '').trim();
    if (!raw) return;
    setSavingHandle(platform);
    try {
      await client.post('/social/connect/handle', { platform, handle: raw });
      setConnected(prev => ({ ...prev, [platform]: raw }));
      setHandleInputs(prev => ({ ...prev, [platform]: '' }));
      flash_('success', `Connected ${platform} as @${raw}.`);
    } catch (err) {
      flash_('error', err?.response?.data?.error || 'Could not save handle.', 6000);
    } finally {
      setSavingHandle(null);
    }
  }

  const connectedList = platforms.filter(([k]) => connected[k]);
  const availableList = platforms.filter(([k]) => !connected[k]);

  return (
    <Layout>
      <div style={{ marginBottom: 20 }}>
        <Link to="/profile">
          <button className="btn btn-ghost btn-sm">← Back to Profile</button>
        </Link>
      </div>

      <div className="page-header">
        <h1 className="page-title">Connected Accounts</h1>
        <p className="page-subtitle">
          Connect your social accounts to personalise your feed. Handle-based platforms connect instantly — OAuth platforms redirect you to the app and back.
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <span className="spinner spinner-primary" />
        </div>
      ) : (
        <>
          {flash && (
            <div style={{
              marginBottom: 16, padding: '10px 14px', borderRadius: 8, fontSize: '.85rem', fontWeight: 600,
              background: flash.type === 'success' ? '#ECFDF5' : '#FEF2F2',
              color: flash.type === 'success' ? '#059669' : '#DC2626',
              border: `1px solid ${flash.type === 'success' ? '#A7F3D0' : '#FECACA'}`,
            }}>
              {flash.msg}
            </div>
          )}

          {/* Summary bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24,
            background: 'var(--bg-secondary)', borderRadius: 10, padding: '12px 16px',
          }}>
            <div style={{ fontSize: '1.5rem' }}>🔗</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.95rem' }}>
                {connectedList.length} of {platforms.length} accounts connected
              </div>
              <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>
                {connectedList.length === 0
                  ? 'Connect an account to personalise your feed.'
                  : `Connected: ${connectedList.map(([k, p]) => p.name).join(', ')}`}
              </div>
            </div>
            {connectedList.length > 0 && (
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {connectedList.slice(0, 5).map(([k, p]) => (
                  <div key={k} style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '.7rem', color: '#fff', fontWeight: 700,
                  }}>
                    {p.name[0]}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Connected section */}
          {connectedList.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 10 }}>
                ✓ Connected
              </div>
              {connectedList.map(([key, p]) => (
                <PlatformCard
                  key={key}
                  platformKey={key}
                  p={p}
                  isConnected
                  handle={typeof connected[key] === 'string' ? connected[key] : null}
                  expanded={expanded === key}
                  onToggle={() => setExpanded(expanded === key ? null : key)}
                  onDisconnect={() => handleDisconnect(key)}
                  onConnect={() => handleConnect(key)}
                  connecting={connecting === key}
                  disconnecting={disconnecting === key}
                  isHandlePlatform={HANDLE_PLATFORMS.has(key)}
                  handleInput={handleInputs[key] || ''}
                  onHandleChange={v => setHandleInputs(prev => ({ ...prev, [key]: v }))}
                  onHandleSave={() => saveHandle(key)}
                  savingHandle={savingHandle === key}
                  placeholder={HANDLE_PLACEHOLDER[key] || 'your-username'}
                />
              ))}
            </div>
          )}

          {/* Available section */}
          {availableList.length > 0 && (
            <div>
              <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 10 }}>
                Available to Connect
              </div>
              {availableList.map(([key, p]) => (
                <PlatformCard
                  key={key}
                  platformKey={key}
                  p={p}
                  isConnected={false}
                  handle={null}
                  expanded={expanded === key}
                  onToggle={() => setExpanded(expanded === key ? null : key)}
                  onDisconnect={() => handleDisconnect(key)}
                  onConnect={() => handleConnect(key)}
                  connecting={connecting === key}
                  disconnecting={disconnecting === key}
                  isHandlePlatform={HANDLE_PLATFORMS.has(key)}
                  handleInput={handleInputs[key] || ''}
                  onHandleChange={v => setHandleInputs(prev => ({ ...prev, [key]: v }))}
                  onHandleSave={() => saveHandle(key)}
                  savingHandle={savingHandle === key}
                  placeholder={HANDLE_PLACEHOLDER[key] || 'your-username'}
                />
              ))}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

function PlatformCard({
  platformKey, p, isConnected, handle, expanded, onToggle,
  onDisconnect, onConnect, connecting, disconnecting,
  isHandlePlatform, handleInput, onHandleChange, onHandleSave, savingHandle, placeholder,
}) {
  const benefits = PLATFORM_BENEFITS[platformKey] || [];

  return (
    <div className="card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Platform icon */}
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: p.color, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
        }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '.85rem' }}>
            {p.name.slice(0, 2).toUpperCase()}
          </span>
        </div>

        {/* Name + description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: '.92rem' }}>{p.name}</span>
            {isConnected && (
              <span style={{
                fontSize: '.65rem', fontWeight: 700, color: '#059669',
                background: '#ECFDF5', padding: '1px 6px', borderRadius: 4,
              }}>
                ✓ {handle ? `@${handle}` : 'Connected'}
              </span>
            )}
          </div>
          <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 1 }}>
            {p.description}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button onClick={onToggle} className="btn btn-ghost btn-sm" style={{ fontSize: '.72rem', padding: '4px 8px' }}>
            {expanded ? '▲' : '▼'} Details
          </button>
          {isConnected ? (
            <button className="btn btn-danger btn-sm" onClick={onDisconnect} disabled={disconnecting}>
              {disconnecting ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : 'Disconnect'}
            </button>
          ) : isHandlePlatform ? (
            <button className="btn btn-sm btn-outline" onClick={onToggle} style={{ borderColor: p.color, color: p.color }}>
              Connect
            </button>
          ) : (
            <button className="btn btn-sm btn-outline" onClick={onConnect} disabled={connecting} style={{ borderColor: p.color, color: p.color }}>
              {connecting ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {/* Handle input — shown inline when expanded for handle platforms not yet connected */}
      {expanded && isHandlePlatform && !isConnected && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '.78rem', fontWeight: 600, marginBottom: 8 }}>
            Enter your {p.name} username
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              className="input"
              value={handleInput}
              onChange={e => onHandleChange(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && onHandleSave()}
              placeholder={placeholder}
              style={{ flex: 1, fontSize: '.85rem' }}
              autoFocus
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={onHandleSave}
              disabled={savingHandle || !handleInput.trim()}
            >
              {savingHandle ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Benefits */}
      {expanded && (benefits.length > 0) && (isConnected || !isHandlePlatform) && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            What you unlock
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, listStyle: 'none' }}>
            {benefits.map((b, i) => (
              <li key={i} style={{ fontSize: '.8rem', color: 'var(--text)', marginBottom: 4, display: 'flex', gap: 6 }}>
                <span style={{ color: p.color }}>✦</span> {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Benefits after handle input when expanded (show both) */}
      {expanded && isHandlePlatform && !isConnected && benefits.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.5px' }}>
            What you unlock
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, listStyle: 'none' }}>
            {benefits.map((b, i) => (
              <li key={i} style={{ fontSize: '.8rem', color: 'var(--text)', marginBottom: 4, display: 'flex', gap: 6 }}>
                <span style={{ color: p.color }}>✦</span> {b}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
