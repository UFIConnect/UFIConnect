import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

const PLATFORM_BENEFITS = {
  linkedin:  ['Import your work history & headline', 'Show LinkedIn posts in your feed', 'Get matched with relevant jobs'],
  github:    ['Showcase your repos & contributions', 'Display commit activity on profile', 'Find open-source collaborators'],
  twitter:   ['Surface relevant tech threads', 'Share posts across platforms', 'Follow industry conversations'],
  instagram: ['Display your creative portfolio', 'Import content to your profile', 'Connect with visual designers'],
  facebook:  ['Join professional Facebook Groups', 'Surface industry discussions', 'Expand your network'],
  discord:   ['See activity from your servers', 'Find community members on UFI', 'Share Discord highlights'],
  youtube:   ['Import your video library', 'Surface creator content in feed', 'Connect with fellow creators'],
  reddit:    ['Follow relevant subreddits', 'Surface top posts in your feed', 'Find niche communities'],
  medium:    ['Import your published articles', 'Share writing with your network', 'Discover great long-form reads'],
  dribbble:  ['Display your design shots', 'Get discovered by hiring managers', 'Connect with top designers'],
  behance:   ['Showcase your full portfolio', 'Import case studies to profile', 'Get design feedback'],
  indeed:    ['Surface matched job listings', 'Track applications in one place', 'Get salary insights'],
  tiktok:    ['Follow creators in your niche', 'Surface trending videos in your feed', 'Connect with content creators'],
  bluesky:   ['Follow decentralised conversations', 'Surface posts matching your interests', 'Connect with the open social web'],
};

export default function ConnectedAccounts() {
  const { profile: authProfile, updateProfileLocally } = useAuth();
  const [platforms, setPlatforms] = useState([]);
  const [connected, setConnected] = useState({});
  const [loading,   setLoading]   = useState(true);
  const [expanded,  setExpanded]  = useState(null);
  const [profile,   setProfile]   = useState(authProfile);
  const [flash,     setFlash]     = useState(null);
  const [connecting, setConnecting] = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => {
    Promise.all([
      client.get('/social/platforms'),
      client.get('/profile'),
    ]).then(([pRes, uRes]) => {
      setPlatforms(Object.entries(pRes.data.platforms || {}));
      setProfile(uRes.data);
      setConnected(pRes.data.connected || {});
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  async function handleConnect(platform) {
    setConnecting(platform);
    try {
      const { data } = await client.get(`/auth/social/${platform}/start`);
      if (data?.url) window.location.href = data.url;
    } catch (err) {
      setFlash({ type: 'error', msg: err?.response?.data?.error || 'Could not start this connection. Please try again.' });
      setTimeout(() => setFlash(null), 6000);
      setConnecting(null);
    }
  }

  async function handleDisconnect(platform) {
    setDisconnecting(platform);
    try {
      await client.delete(`/social/connect/${platform}`);
      setConnected((prev) => { const n = { ...prev }; delete n[platform]; return n; });
      setFlash({ type: 'success', msg: 'Account disconnected.' });
      setTimeout(() => setFlash(null), 4000);
    } catch (err) {
      setFlash({ type: 'error', msg: err?.response?.data?.error || 'Could not disconnect this account.' });
      setTimeout(() => setFlash(null), 6000);
    } finally {
      setDisconnecting(null);
    }
  }

  async function handleUpgrade() {
    setUpgrading(true);
    try {
      const { data } = await client.post('/user/plan/upgrade');
      const nextProfile = { ...(profile || {}), plan: data?.plan || 'pro', isPro: true };
      setProfile(nextProfile);
      updateProfileLocally({ plan: nextProfile.plan, isPro: true });
      setFlash({ type: 'success', msg: 'Pro is active. You can now connect social accounts.' });
      setTimeout(() => setFlash(null), 5000);
    } catch (err) {
      setFlash({ type: 'error', msg: err?.response?.data?.error || 'Could not activate Pro. Please try again.' });
      setTimeout(() => setFlash(null), 6000);
    } finally {
      setUpgrading(false);
    }
  }

  const connectedList = platforms.filter(([k]) => connected[k]);
  const availableList = platforms.filter(([k]) => !connected[k]);
  const isPro = !!profile?.isPro;

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
          Pro connectors are active for LinkedIn, X, Instagram, and Facebook. Additional platforms are staged for coming soon.
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
                  ? (isPro ? 'Connect active accounts to personalise your feed.' : 'Upgrade to Pro to connect active social accounts.')
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
                  expanded={expanded === key}
                  onToggle={() => setExpanded(expanded === key ? null : key)}
                  onDisconnect={() => handleDisconnect(key)}
                  onConnect={() => handleConnect(key)}
                  onUpgrade={handleUpgrade}
                  isPro={isPro}
                  connecting={connecting === key}
                  disconnecting={disconnecting === key}
                  upgrading={upgrading}
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
                  expanded={expanded === key}
                  onToggle={() => setExpanded(expanded === key ? null : key)}
                  onDisconnect={() => handleDisconnect(key)}
                  onConnect={() => handleConnect(key)}
                  onUpgrade={handleUpgrade}
                  isPro={isPro}
                  connecting={connecting === key}
                  disconnecting={disconnecting === key}
                  upgrading={upgrading}
                />
              ))}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

function PlatformCard({ platformKey, p, isConnected, expanded, onToggle, onDisconnect, onConnect, onUpgrade, isPro, connecting, disconnecting, upgrading }) {
  const benefits = PLATFORM_BENEFITS[platformKey] || [];

  return (
    <div className="card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: p.color, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
        }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: '.85rem' }}>
            {p.name.slice(0, 2).toUpperCase()}
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: '.92rem' }}>{p.name}</span>
            {isConnected && (
              <span style={{
                fontSize: '.65rem', fontWeight: 700, color: '#059669',
                background: '#ECFDF5', padding: '1px 6px', borderRadius: 4,
              }}>
                ✓ Connected
              </span>
            )}
            {p.proRequired && !isConnected && (
              <span style={{
                fontSize: '.65rem', fontWeight: 700, color: '#92400E',
                background: '#FEF3C7', padding: '1px 6px', borderRadius: 4,
              }}>
                Pro
              </span>
            )}
          </div>
          <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 1 }}>
            {p.description}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button
            onClick={onToggle}
            className="btn btn-ghost btn-sm"
            style={{ fontSize: '.72rem', padding: '4px 8px' }}
          >
            {expanded ? '▲' : '▼'} Details
          </button>
          {p.comingSoon ? (
            <span style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--muted)', background: 'var(--bg-secondary)', padding: '4px 8px', borderRadius: 6 }}>
              Coming Soon
            </span>
          ) : isConnected ? (
            <button className="btn btn-danger btn-sm" onClick={onDisconnect} disabled={disconnecting}>
              {disconnecting ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : 'Disconnect'}
            </button>
          ) : p.proRequired && !isPro ? (
            <button className="btn btn-primary btn-sm" onClick={onUpgrade} disabled={upgrading}>
              {upgrading ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : 'Upgrade'}
            </button>
          ) : (
            <button
              className="btn btn-sm btn-outline"
              onClick={onConnect}
              disabled={connecting}
              style={{ borderColor: p.color, color: p.color }}
            >
              {connecting ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {benefits.length > 0 && (
            <div style={{ marginBottom: 10 }}>
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
          {p.note && (
            <div style={{ fontSize: '.72rem', color: 'var(--warning)', background: '#FFFBEB', padding: '6px 10px', borderRadius: 6 }}>
              ℹ️ {p.note}
            </div>
          )}
          {p.setupUrl && (
            <a href={p.setupUrl} target="_blank" rel="noopener noreferrer"
               style={{ fontSize: '.72rem', color: p.color, display: 'block', marginTop: 6 }}>
              → Developer / API setup guide ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
