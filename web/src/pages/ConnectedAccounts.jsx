import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';

const PLATFORM_BENEFITS = {
  linkedin:  ['Import your work history & headline', 'Show LinkedIn posts in your feed', 'Get matched with relevant jobs'],
  github:    ['Showcase your repos & contributions', 'Display commit activity on profile', 'Find open-source collaborators'],
  gitlab:    ['Showcase GitLab projects', 'Display CI/CD and open-source work', 'Find developer collaborators'],
  twitter:   ['Surface relevant tech threads', 'Share posts across platforms', 'Follow industry conversations'],
  facebook:  ['Join professional Facebook Groups', 'Surface industry discussions', 'Expand your network'],
  youtube:   ['Import your video library', 'Surface creator content in feed', 'Connect with fellow creators'],
  reddit:    ['Follow relevant subreddits', 'Surface top posts in your feed', 'Find niche communities'],
  medium:    ['Import your published articles', 'Share writing with your network', 'Discover great long-form reads'],
  dribbble:  ['Display your design shots', 'Get discovered by hiring managers', 'Connect with top designers'],
  twitch:    ['Surface streams from channels you follow', 'Share live content with your network', 'Connect with fellow streamers'],
  threads:   ['Import your Threads posts', 'Surface conversations in your feed', 'Cross-post to your network'],
  bluesky:   ['Follow decentralised conversations', 'Surface posts matching your interests', 'Connect with the open social web'],
};

export default function ConnectedAccounts() {
  const { profile: authProfile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [platforms, setPlatforms]       = useState([]);
  const [connected, setConnected]       = useState({});
  const [loading,   setLoading]         = useState(true);
  const [expanded,  setExpanded]        = useState(null);
  const [flash,     setFlash]           = useState(null);
  const [connecting, setConnecting]     = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);
  // null = modal closed; '' or partial text = open, mid-typing. Bluesky is
  // the one platform with no fixed authorization URL (AT Protocol is
  // federated — the handle is how we find which server to route to), so it
  // gets its own in-app prompt instead of the plain click-to-connect every
  // other platform uses.
  const [blueskyHandle, setBlueskyHandle] = useState(null);

  useEffect(() => {
    Promise.all([
      client.get('/social/platforms'),
      client.get('/profile'),
    ]).then(([pRes]) => {
      setPlatforms(Object.entries(pRes.data.platforms || {}));
      setConnected(pRes.data.connected || {});
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  // Handle OAuth callback redirect params (?social_connected=platform or ?social_error=platform)
  useEffect(() => {
    const connected_ = searchParams.get('social_connected');
    const errPlatform = searchParams.get('social_error');
    const errReason   = searchParams.get('reason');
    if (connected_) {
      setConnected(prev => ({ ...prev, [connected_]: true }));
      flash_('success', `${connected_} connected successfully.`);
      setSearchParams({}, { replace: true });
    } else if (errPlatform) {
      // token_exchange_failed:<providerErrorCode> — see the backend
      // callback's own comment — carries the provider's own short error
      // code (invalid_client, invalid_scope, etc), not a generic dead end,
      // so a failure can actually be diagnosed from what's on screen
      // instead of needing server log access.
      const [reasonBase, providerCode] = (errReason || '').split(':');
      const msg = reasonBase === 'invalid_state' ? 'Connection expired — please try again.'
        : reasonBase === 'access_denied'          ? 'You cancelled the connection.'
        : providerCode                            ? `Could not connect ${errPlatform}: ${decodeURIComponent(providerCode)}.`
        : `Could not connect ${errPlatform}.`;
      flash_('error', msg, 8000);
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line

  function flash_(type, msg, ms = 4000) {
    setFlash({ type, msg });
    setTimeout(() => setFlash(null), ms);
  }

  async function handleConnect(platform) {
    // Bluesky has no fixed authorization URL to redirect straight to — AT
    // Protocol is federated, so the real authorization server first has to
    // be discovered from whichever handle the member actually uses (see
    // /auth/social/bluesky/start server-side). Every other platform here
    // needs nothing beyond the click itself.
    if (platform === 'bluesky') { setBlueskyHandle(''); return; }
    startConnect(platform);
  }

  async function startConnect(platform, handle) {
    const handleParam = handle ? `?handle=${encodeURIComponent(handle.trim())}` : '';
    setConnecting(platform);
    try {
      const { data } = await client.get(`/auth/social/${platform}/start${handleParam}`);
      if (data?.url) { window.location.href = data.url; return; }
      throw new Error('Missing provider authorization URL.');
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.response?.data?.error || err.message;
      flash_('error', detail || 'Could not start this connection.', 7000);
      setConnecting(null);
    }
  }

  function handleBlueskySubmit(e) {
    e.preventDefault();
    const handle = blueskyHandle.trim();
    if (!handle) return;
    setBlueskyHandle(null);
    startConnect('bluesky', handle);
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

  const connectedList   = platforms.filter(([k]) =>  connected[k]);
  // forceComingSoon (LinkedIn) — real OAuth credentials are configured and
  // working, but it stays in "Coming Soon" anyway: full feed integration
  // needs LinkedIn's own Partner Program approval, a product gate, not a
  // missing-credentials one. See PlatformCard's own message below, which
  // shows p.note (the real reason) instead of the generic "waiting on
  // credentials" line whenever a platform has one.
  const availableList   = platforms.filter(([k, p]) => !connected[k] &&  p.configured && !p.forceComingSoon);
  const comingSoonList  = platforms.filter(([k, p]) => !connected[k] && (!p.configured || p.forceComingSoon));

  return (
    <Layout>
      <div style={{ marginBottom: 20 }}>
        <Link to="/profile" className="btn-back">
          <span className="btn-back-icon">‹</span> Back to Profile
        </Link>
      </div>

      <div className="page-header">
        <h1 className="page-title">Connected Accounts</h1>
        <p className="page-subtitle">
          Connect your social accounts through each provider's permission screen, then return to UFconnect automatically.
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
              background: flash.type === 'success' ? '#ECFDF5' : flash.type === 'info' ? '#EFF6FF' : '#FEF2F2',
              color:      flash.type === 'success' ? '#059669' : flash.type === 'info' ? '#2563EB' : '#DC2626',
              border: `1px solid ${flash.type === 'success' ? '#A7F3D0' : flash.type === 'info' ? '#BFDBFE' : '#FECACA'}`,
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
                    background: hasBrandIcon(k) ? '#fff' : p.color,
                    border: hasBrandIcon(k) ? '1px solid var(--border)' : 'none',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '.7rem', color: '#fff', fontWeight: 700,
                  }}>
                    {hasBrandIcon(k) ? <BrandIcon platform={k} size={15} /> : p.name[0]}
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
                  connecting={connecting === key}
                  disconnecting={disconnecting === key}
                />
              ))}
            </div>
          )}

          {/* Coming Soon — all platforms pending OAuth integration */}
          {availableList.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 10 }}>
                Available
              </div>
              {availableList.map(([key, p]) => (
                <PlatformCard
                  key={key}
                  platformKey={key}
                  p={p}
                  isConnected={false}
                  expanded={expanded === key}
                  onToggle={() => setExpanded(expanded === key ? null : key)}
                  onConnect={() => handleConnect(key)}
                  connecting={connecting === key}
                />
              ))}
            </div>
          )}

          {comingSoonList.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 10 }}>
                Coming Soon
              </div>
              {comingSoonList.map(([key, p]) => (
                <PlatformCard
                  key={key}
                  platformKey={key}
                  p={p}
                  isConnected={false}
                  comingSoon
                  expanded={expanded === key}
                  onToggle={() => setExpanded(expanded === key ? null : key)}
                />
              ))}
            </div>
          )}

        </>
      )}

      {blueskyHandle !== null && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,.45)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={() => setBlueskyHandle(null)}
        >
          <form
            className="card"
            onClick={e => e.stopPropagation()}
            onSubmit={handleBlueskySubmit}
            style={{ width: '100%', maxWidth: 360, padding: 20 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              {hasBrandIcon('bluesky') && <BrandIcon platform="bluesky" size={20} />}
              <span style={{ fontWeight: 700, fontSize: '.95rem' }}>Connect Bluesky</span>
            </div>
            <p style={{ fontSize: '.78rem', color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
              Bluesky is decentralised — every account lives on its own server, so we need
              your handle to route you to the right one.
            </p>
            <input
              className="form-input"
              autoFocus
              value={blueskyHandle}
              onChange={e => setBlueskyHandle(e.target.value)}
              placeholder="alice.bsky.social"
              style={{ marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBlueskyHandle(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={!blueskyHandle.trim()}>
                Continue
              </button>
            </div>
          </form>
        </div>
      )}
    </Layout>
  );
}

function PlatformCard({
  platformKey, p, isConnected, comingSoon, expanded, onToggle,
  onDisconnect, onConnect, connecting, disconnecting,
}) {
  const benefits = PLATFORM_BENEFITS[platformKey] || [];

  return (
    <div className="card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Platform icon — the platform's own official mark where one's
            available (see BrandIcon), initials-on-brand-color otherwise. */}
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: hasBrandIcon(platformKey) ? '#fff' : p.color,
          border: hasBrandIcon(platformKey) ? '1px solid var(--border)' : 'none',
          display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
        }}>
          {hasBrandIcon(platformKey) ? (
            <BrandIcon platform={platformKey} size={22} />
          ) : (
            <span style={{ color: '#fff', fontWeight: 700, fontSize: '.85rem' }}>
              {p.name.slice(0, 2).toUpperCase()}
            </span>
          )}
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
                ✓ Connected
              </span>
            )}
            {comingSoon && (
              <span style={{
                fontSize: '.65rem', fontWeight: 700, color: '#92400E',
                background: '#FEF3C7', padding: '1px 6px', borderRadius: 4,
              }}>
                Coming Soon
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
          ) : comingSoon ? (
            <button className="btn btn-sm btn-outline" disabled>
              Coming Soon
            </button>
          ) : (
            <button className="btn btn-sm btn-outline" onClick={onConnect} disabled={connecting} style={{ borderColor: p.color, color: p.color }}>
              {connecting ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : 'Connect'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: benefits.length ? 12 : 0, lineHeight: 1.5 }}>
            {comingSoon
              // p.note covers a real product-gated reason (LinkedIn: full
              // feed integration pending LinkedIn's own Partner Program
              // approval) — shown instead of the generic credentials
              // message whenever a platform actually has one, since
              // "waiting on server credentials" would be simply false for
              // a platform whose OAuth is already fully configured.
              ? (p.note || `Waiting on server credentials: ${(p.missingEnv || []).join(', ') || 'OAuth client ID/secret'}.`)
              : `Connect opens ${p.name}'s authorization page so you can approve UFconnect access at the original source.`}
          </div>

          {/* Benefits */}
          {benefits.length > 0 && (
            <>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
