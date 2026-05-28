import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
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
};

export default function ConnectedAccounts() {
  const [platforms,           setPlatforms]           = useState([]);
  const [connected,           setConnected]           = useState({});
  const [loading,             setLoading]             = useState(true);
  const [expanded,            setExpanded]            = useState(null);
  const [subscriptionStatus,  setSubscriptionStatus]  = useState('free');
  const [showPaywall,         setShowPaywall]         = useState(false);
  const [subscribing,         setSubscribing]         = useState(false);
  const [pendingPlatform,     setPendingPlatform]     = useState(null);

  useEffect(() => {
    Promise.all([
      client.get('/social/platforms'),
      client.get('/profile'),
    ]).then(([pRes, uRes]) => {
      setPlatforms(Object.entries(pRes.data.platforms || {}));
      const keys = uRes.data.connectedPlatforms || [];
      const map = {};
      keys.forEach(k => { map[k] = true; });
      setConnected(map);
      setSubscriptionStatus(uRes.data.subscriptionStatus || 'free');
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  async function handleConnect(platform) {
    if (subscriptionStatus !== 'pro') {
      setPendingPlatform(platform);
      setShowPaywall(true);
      return;
    }
    doConnect(platform);
  }

  async function doConnect(platform) {
    const p = platforms.find(([key]) => key === platform)?.[1];
    if (p?.loginUrl) window.open(p.loginUrl, '_blank', 'noopener,noreferrer');
    try {
      await client.post('/social/connect', { platform, mockUsername: `demo_${platform}_user` });
      setConnected((prev) => ({ ...prev, [platform]: true }));
    } catch (err) { console.error(err); }
  }

  async function handleDisconnect(platform) {
    try {
      await client.delete(`/social/connect/${platform}`);
      setConnected((prev) => { const n = { ...prev }; delete n[platform]; return n; });
    } catch (err) { console.error(err); }
  }

  async function handleSubscribe() {
    setSubscribing(true);
    try {
      await client.post('/subscribe');
      setSubscriptionStatus('pro');
      setShowPaywall(false);
      if (pendingPlatform) {
        doConnect(pendingPlatform);
        setPendingPlatform(null);
      }
    } catch (err) { console.error(err); }
    finally { setSubscribing(false); }
  }

  async function handleUnsubscribe() {
    try {
      await client.post('/unsubscribe');
      setSubscriptionStatus('free');
    } catch (err) { console.error(err); }
  }

  const connectedList = platforms.filter(([k]) => connected[k]);
  const availableList = platforms.filter(([k]) => !connected[k]);
  const isPro = subscriptionStatus === 'pro';

  return (
    <Layout>
      {/* Paywall modal */}
      {showPaywall && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div className="card" style={{ maxWidth: 420, width: '100%', padding: 32, position: 'relative' }}>
            <button
              onClick={() => setShowPaywall(false)}
              style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--muted)' }}
            >✕</button>

            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 8 }}>🔓</div>
              <h2 style={{ margin: '0 0 6px', fontSize: '1.3rem' }}>Unlock All Social Accounts</h2>
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: '.88rem' }}>
                Connect LinkedIn, GitHub, Twitter, Instagram, Facebook, and more to personalise your feed and expand your reach.
              </p>
            </div>

            {/* Price */}
            <div style={{
              background: 'linear-gradient(135deg,#4F46E5,#7C3AED)', borderRadius: 14,
              padding: '20px 24px', textAlign: 'center', marginBottom: 20, color: '#fff',
            }}>
              <div style={{ fontSize: '2.4rem', fontWeight: 800, lineHeight: 1 }}>$5.99</div>
              <div style={{ fontSize: '.85rem', opacity: .85, marginTop: 4 }}>per month · cancel any time</div>
            </div>

            {/* Feature list */}
            <ul style={{ margin: '0 0 20px', paddingLeft: 0, listStyle: 'none' }}>
              {[
                'Connect all 12 social platforms',
                'Personalised feed from your accounts',
                'Import posts, repos & portfolios',
                'Priority access to new features',
              ].map((f, i) => (
                <li key={i} style={{ display: 'flex', gap: 8, fontSize: '.85rem', marginBottom: 8 }}>
                  <span style={{ color: '#7C3AED', fontWeight: 700 }}>✓</span> {f}
                </li>
              ))}
            </ul>

            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', fontSize: '1rem', background: 'linear-gradient(135deg,#4F46E5,#7C3AED)', border: 'none' }}
              onClick={handleSubscribe}
              disabled={subscribing}
            >
              {subscribing ? 'Processing…' : 'Subscribe for $5.99 / mo'}
            </button>
            <div style={{ textAlign: 'center', fontSize: '.72rem', color: 'var(--muted)', marginTop: 10 }}>
              No hidden fees. Cancel any time from your settings.
            </div>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <Link to="/profile">
          <button className="btn btn-ghost btn-sm">← Back to Profile</button>
        </Link>
      </div>

      <div className="page-header">
        <h1 className="page-title">Connected Accounts</h1>
        <p className="page-subtitle">
          Link your social profiles to personalise your feed, import content, and expand your reach.
        </p>
      </div>

      {/* Subscription status banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20,
        background: isPro ? 'linear-gradient(135deg,#4F46E5,#7C3AED)' : 'var(--bg-secondary)',
        borderRadius: 12, padding: '14px 18px', color: isPro ? '#fff' : 'inherit',
      }}>
        <div style={{ fontSize: '1.4rem' }}>{isPro ? '⭐' : '🔒'}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '.95rem' }}>
            {isPro ? 'Pro Plan — All socials unlocked' : 'Free Plan'}
          </div>
          <div style={{ fontSize: '.78rem', opacity: isPro ? .85 : 1, color: isPro ? 'inherit' : 'var(--muted)' }}>
            {isPro
              ? 'You can connect all social accounts.'
              : 'Upgrade to Pro for $5.99/mo to connect social accounts.'}
          </div>
        </div>
        {!isPro && (
          <button
            className="btn btn-sm"
            style={{ background: 'linear-gradient(135deg,#4F46E5,#7C3AED)', color: '#fff', border: 'none', flexShrink: 0 }}
            onClick={() => setShowPaywall(true)}
          >
            Upgrade — $5.99/mo
          </button>
        )}
        {isPro && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'rgba(255,255,255,.7)', flexShrink: 0, fontSize: '.72rem' }}
            onClick={handleUnsubscribe}
          >
            Cancel plan
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <span className="spinner spinner-primary" />
        </div>
      ) : (
        <>
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
                  ? 'Connect accounts to personalise your feed and unlock features.'
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
                  isPro={isPro}
                  expanded={expanded === key}
                  onToggle={() => setExpanded(expanded === key ? null : key)}
                  onDisconnect={() => handleDisconnect(key)}
                  onConnect={() => handleConnect(key)}
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
                  isPro={isPro}
                  expanded={expanded === key}
                  onToggle={() => setExpanded(expanded === key ? null : key)}
                  onDisconnect={() => handleDisconnect(key)}
                  onConnect={() => handleConnect(key)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}

function PlatformCard({ platformKey, p, isConnected, isPro, expanded, onToggle, onDisconnect, onConnect }) {
  const benefits = PLATFORM_BENEFITS[platformKey] || [];

  return (
    <div className="card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Platform colour icon */}
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: p.color, display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
          opacity: !isConnected && !isPro ? .55 : 1,
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
            {!isConnected && !isPro && (
              <span style={{
                fontSize: '.65rem', fontWeight: 700, color: '#7C3AED',
                background: '#F5F3FF', padding: '1px 6px', borderRadius: 4,
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
          {isConnected ? (
            <button className="btn btn-danger btn-sm" onClick={onDisconnect}>Disconnect</button>
          ) : isPro ? (
            <button
              className="btn btn-sm btn-outline"
              onClick={onConnect}
              style={{ borderColor: p.color, color: p.color }}
            >
              Connect
            </button>
          ) : (
            <button
              className="btn btn-sm"
              onClick={onConnect}
              style={{ background: 'linear-gradient(135deg,#4F46E5,#7C3AED)', color: '#fff', border: 'none', fontSize: '.75rem' }}
            >
              🔒 Unlock
            </button>
          )}
        </div>
      </div>

      {/* Expanded details */}
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
