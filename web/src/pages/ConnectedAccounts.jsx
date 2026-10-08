import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useTabMetrics from '../analytics/useTabMetrics';
import Layout from '../components/Layout';
import AccountConnectionAction from '../components/AccountConnectionAction';
import AccountActionIcon from '../components/AccountActionIcon';
import client, { publicOAuthRequestConfig } from '../api/client';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import { withCareerAccountFallback } from '../components/sourceMeta';
import { sourceAuthorizationState } from '../components/sourceAuthorization.mjs';
import { useAuth } from '../contexts/AuthContext';
import { accountSections, filterAccounts } from '../components/sourceDirectory';

const PLATFORM_BENEFITS = {
  linkedin:  ['Import your work history & headline', 'Show LinkedIn posts in your feed', 'Get matched with relevant jobs'],
  github:    ['Showcase your repos & contributions', 'Display commit activity on profile', 'Find open-source collaborators'],
  gitlab:    ['Showcase GitLab projects', 'Display CI/CD and open-source work', 'Find developer collaborators'],
  twitter:   ['Surface relevant tech threads', 'Share posts across platforms', 'Follow industry conversations'],
  facebook:  ['Join professional Facebook Groups', 'Surface industry discussions', 'Expand your network'],
  instagram: ['Publish photos from Cross-Post', 'Keep visual work connected', 'Bring creator updates into your workspace'],
  tiktok:    ['Send photo posts through TikTok', 'Keep creator work organized', 'Use your TikTok account with Media Studio'],
  youtube:   ['Import your video library', 'Surface creator content in feed', 'Connect with fellow creators'],
  reddit:    ['Follow relevant subreddits', 'Surface top posts in your feed', 'Find niche communities'],
  medium:    ['Import your published articles', 'Share writing with your network', 'Discover great long-form reads'],
  dribbble:  ['Display your design shots', 'Get discovered by hiring managers', 'Connect with top designers'],
  twitch:    ['Surface streams from channels you follow', 'Share live content with your network', 'Connect with fellow streamers'],
  threads:   ['Import your Threads posts', 'Surface conversations in your feed', 'Cross-post to your network'],
  bluesky:   ['Follow decentralised conversations', 'Surface posts matching your interests', 'Connect with the open social web'],
  mastodon:  ['See public posts from your Mastodon home timeline', 'Review your own public posts in Your Feed', 'Manage authorization on your own Mastodon server'],
};

const PUBLICATION_BENEFITS = [
  'Connect your publication account when provider access opens',
  'Prepare article drafts in the AI Content Hub',
  'Publish from Cross-Post after the integration is approved',
];

const CAREER_BENEFITS = [
  'Authorize access at the career provider',
  'Keep account access revocable from UFIconnect',
  'Use connected career tools as provider access becomes available',
];

const MASTODON_CONNECTION_ERRORS = {
  browser_mismatch: 'Mastodon could not verify this browser session. Start the connection again in this browser and allow cookies for UFIconnect.',
  authorization_declined: 'Mastodon access was declined. Connect again and review the requested permissions on your server.',
  missing_code: 'Mastodon did not return an authorization code. Start the connection again.',
  account_unavailable: 'This UFIconnect account cannot connect Mastodon. Sign in with your personal account and try again.',
  token_exchange_failed: 'Mastodon could not complete authorization. Start the connection again on your server.',
  account_verification_failed: 'Mastodon authorized access, but your account could not be verified. Try connecting again.',
  connection_failed: 'The Mastodon connection could not be completed. Check that your server is available, then try again.',
};

export default function ConnectedAccounts() {
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [platforms, setPlatforms]       = useState([]);
  const [connected, setConnected]       = useState({});
  const [loading,   setLoading]         = useState(true);
  const [catalogAccountId, setCatalogAccountId] = useState(null);
  const [expanded,  setExpanded]        = useState(null);
  const [flash,     setFlash]           = useState(null);
  const [connecting, setConnecting]     = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  useTabMetrics('connected_accounts_category', categoryFilter);
  // null = modal closed; '' or partial text = open, mid-typing. Bluesky is
  // the one platform with no fixed authorization URL (AT Protocol is
  // federated — the handle is how we find which server to route to), so it
  // gets its own in-app prompt instead of the plain click-to-connect every
  // other platform uses.
  const [blueskyHandle, setBlueskyHandle] = useState(null);
  const [mastodonServer, setMastodonServer] = useState(null);
  const isBusinessMembership = profile?.plan === 'business';

  useEffect(() => {
    const requested = searchParams.get('connect');
    if (!['mastodon', 'bluesky'].includes(requested) || isBusinessMembership || loading) return;
    const platform = platforms.find(([key]) => key === requested)?.[1];
    const state = sourceAuthorizationState(platform, { isConnected: !!connected[requested] });
    if (!state.ready) flash_('error', state.reason);
    else if (requested === 'mastodon') setMastodonServer('');
    else setBlueskyHandle('');
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('connect');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, isBusinessMembership, loading, platforms, connected]);

  useEffect(() => {
    if (!profile?.id) return undefined;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setCatalogAccountId(null);
    setPlatforms([]);
    setConnected({});
    setMastodonServer(null);
    setBlueskyHandle(null);
    client.get('/social/platforms', { signal: controller.signal }).then((pRes) => {
      if (!active) return;
      const includeCareer = pRes.data.careerOnly === true || isBusinessMembership;
      setPlatforms(Object.entries(withCareerAccountFallback(pRes.data.platforms, includeCareer)));
      setConnected(pRes.data.connected || {});
    }).catch(() => {
      if (active) flash_('error', 'Could not load account connections. Sign-in remains locked.');
    }).finally(() => {
      if (active) {
        setCatalogAccountId(profile.id);
        setLoading(false);
      }
    });
    return () => { active = false; controller.abort(); };
  }, [profile?.id, isBusinessMembership]);

  // Redirect parameters identify the callback. Current account metadata must
  // confirm the connection before displaying success or notifying other tabs.
  useEffect(() => {
    if (!profile?.id || loading || catalogAccountId !== profile.id) return;
    const connected_ = searchParams.get('social_connected');
    const errPlatform = searchParams.get('social_error');
    const errReason   = searchParams.get('reason');
    if (connected_) {
      const platform = platforms.find(([key]) => key === connected_)?.[1];
      const confirmed = connected[connected_] === true
        && sourceAuthorizationState(platform, { isConnected: true }).ready;
      if (confirmed) {
        window.dispatchEvent(new Event('ufi-connections-changed'));
        flash_('success', `${platform.name} connected successfully.`);
      } else {
        flash_('error', 'Could not confirm the source connection. Refresh and connect again.', 8000);
      }
    } else if (errPlatform) {
      // token_exchange_failed:<providerErrorCode> — see the backend
      // callback's own comment — carries the provider's own short error
      // code (invalid_client, invalid_scope, etc), not a generic dead end,
      // so a failure can actually be diagnosed from what's on screen
      // instead of needing server log access.
      const [reasonBase, providerCode] = (errReason || '').split(':');
      const msg = errPlatform === 'mastodon' && MASTODON_CONNECTION_ERRORS[reasonBase]
        ? MASTODON_CONNECTION_ERRORS[reasonBase]
        : reasonBase === 'invalid_state' ? 'Connection expired — please try again.'
        : reasonBase === 'browser_mismatch' ? 'Allow cookies for UFIConnect and start the connection again in this browser.'
        : reasonBase === 'account_unavailable' ? 'This connection is not available for your current account membership.'
        : reasonBase === 'access_denied' && errPlatform === 'youtube'
          ? 'YouTube did not grant access. In Google Cloud, publish the OAuth app or add this Google account as a test user, then try again.'
        : reasonBase === 'access_denied'          ? 'The provider did not grant access. Please try again.'
        : providerCode                            ? `Could not connect ${errPlatform}: ${decodeURIComponent(providerCode)}.`
        : `Could not connect ${errPlatform}.`;
      flash_('error', msg, 8000);
    }
    if (connected_ || errPlatform) {
      const nextParams = new URLSearchParams(searchParams);
      ['social_connected', 'social_error', 'reason'].forEach(key => nextParams.delete(key));
      setSearchParams(nextParams, { replace: true });
    }
  }, [profile?.id, loading, catalogAccountId, searchParams, setSearchParams, platforms, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  function flash_(type, msg, ms = 4000) {
    setFlash({ type, msg });
    setTimeout(() => setFlash(null), ms);
  }

  async function handleConnect(platform) {
    const state = sourceAuthorizationState(platforms.find(([key]) => key === platform)?.[1], { isConnected: !!connected[platform] });
    if (!state.ready) { flash_('error', state.reason); return; }
    // Bluesky has no fixed authorization URL to redirect straight to — AT
    // Protocol is federated, so the real authorization server first has to
    // be discovered from whichever handle the member actually uses (see
    // /auth/social/bluesky/start server-side). Every other platform here
    // needs nothing beyond the click itself.
    if (platform === 'bluesky') { setBlueskyHandle(''); return; }
    if (platform === 'mastodon') { setMastodonServer(''); return; }
    startConnect(platform);
  }

  async function startConnect(platform, handle) {
    const state = sourceAuthorizationState(platforms.find(([key]) => key === platform)?.[1], { isConnected: !!connected[platform] });
    if (!state.ready) { flash_('error', state.reason); return; }
    const connectParams = new URLSearchParams();
    if (searchParams.get('returnTo') === 'command-center') connectParams.set('returnTo', 'command-center');
    if (handle) connectParams.set(platform === 'mastodon' ? 'server' : 'handle', handle.trim());
    if (searchParams.get('interactions') === '1') connectParams.set('interactions', '1');
    if (platform === 'youtube' && searchParams.get('analytics') === '1') connectParams.set('analytics', '1');
    if (platform === 'youtube' && searchParams.get('monetization') === '1') connectParams.set('monetization', '1');
    const handleParam = connectParams.size ? `?${connectParams}` : '';
    setConnecting(platform);
    try {
      const { data } = await client.get(
        `/auth/social/${platform}/start${handleParam}`,
        publicOAuthRequestConfig(),
      );
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
      window.dispatchEvent(new Event('ufi-connections-changed'));
      setConnected(prev => { const n = { ...prev }; delete n[platform]; return n; });
      flash_('success', 'Account disconnected.');
    } catch (err) {
      flash_('error', err?.response?.data?.error || 'Could not disconnect.', 6000);
    } finally {
      setDisconnecting(null);
    }
  }

  // Account-owned integrations live in Command Center. Keeping them out of
  // this general page prevents a member from connecting a source here and
  // then wondering why it only appears in their private workspace.
  const careerPlatforms = platforms.filter(([key, p]) => p.category === 'career' || (isBusinessMembership && key === 'linkedin'));
  const generalPlatforms = platforms.filter(([, p]) => !p.commandCenterOnly);
  const accountCategories = accountSections(isBusinessMembership ? careerPlatforms : generalPlatforms, connected);
  const activeCategory = accountCategories.some(section => section.id === categoryFilter) ? categoryFilter : 'all';
  const selectedCategory = accountCategories.find(section => section.id === activeCategory);
  const selectedKeys = selectedCategory && new Set(selectedCategory.items.map(([key]) => key));
  const inSelectedCategory = ([key]) => !selectedKeys || selectedKeys.has(key);
  const displayedGeneral = filterAccounts(generalPlatforms.filter(inSelectedCategory), connected, 'all');
  const displayedCareer = filterAccounts(careerPlatforms.filter(inSelectedCategory), connected, 'all');
  const generalSections = accountSections(generalPlatforms, connected)
    .filter(section => activeCategory === 'all' || section.id === activeCategory);
  const categoryOptions = [
    { id: 'all', label: 'All', count: (isBusinessMembership ? careerPlatforms : generalPlatforms).length },
    ...accountCategories.map(section => ({ id: section.id, label: section.label, count: section.total })),
  ];

  return (
    <Layout>
      <div style={{ marginBottom: 20 }}>
        <Link to="/" className="btn-back">
          <span className="btn-back-icon">‹</span> Back to Home
        </Link>
      </div>

      <div className="page-header">
        <h1 className="page-title">{isBusinessMembership ? 'Business Career Connections' : 'Connected Accounts'}</h1>
        <p className="page-subtitle">
          {isBusinessMembership
            ? 'Sign in to LinkedIn to authorize hiring posts, or open your career provider’s account.'
            : 'Sign in to your sources and authorize supported accounts in one step.'}
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

          {!isBusinessMembership && platforms.some(([, p]) => p.commandCenterOnly) && (
            <div style={{ margin: '0 0 24px', fontSize: '.78rem', color: 'var(--muted)' }}>
              Account-only publishing and personal-post connections are managed in the <Link to="/command-center?tab=accounts" style={{ color: 'var(--primary)', fontWeight: 700 }}>Command Center</Link>.
            </div>
          )}

          {searchParams.get('interactions') === '1' && <section className="card" aria-label="Source interaction permissions" style={{ marginBottom: 20 }}>
            <h2>Likes and comments</h2>
            <p>Authorize publishing actions on a connected source. Your comments will be published on that platform.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['reddit', 'twitter', 'youtube', 'github', 'gitlab', 'bluesky', 'mastodon'].filter(key => connected[key]).map(key => {
                const label = `Enable actions on ${key === 'twitter' ? 'X' : key === 'mastodon' ? 'Mastodon' : key}`;
                const authorization = sourceAuthorizationState(platforms.find(([id]) => id === key)?.[1], { isConnected: true });
                return <button key={key} type="button" className="btn btn-outline btn-sm account-icon-action" disabled={!!connecting || !authorization.ready} onClick={() => handleConnect(key)} aria-label={label} title={authorization.ready ? label : `${label}. Locked. ${authorization.reason}`} aria-busy={connecting === key}><AccountActionIcon platform={key} busy={connecting === key} /></button>;
              })}
            </div>
          </section>}
          {(searchParams.get('analytics') === '1' || searchParams.get('monetization') === '1') && <section className="card" aria-labelledby="source-analytics-permissions" style={{ marginBottom: 20, padding: 20 }}>
            <h2 id="source-analytics-permissions" style={{ fontSize: '1.1rem', margin: '0 0 8px' }}>YouTube analytics permissions</h2>
            <p style={{ color: 'var(--muted)', fontSize: '.85rem', lineHeight: 1.6 }}>Authorize read access to your channel analytics{searchParams.get('monetization') === '1' ? ' and estimated revenue' : ''}. YouTube controls eligibility, reporting delays, advertising, and payouts. Review the permissions on Google’s authorization screen.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-primary btn-sm account-icon-action" disabled={!!connecting || !sourceAuthorizationState(platforms.find(([key]) => key === 'youtube')?.[1], { isConnected: !!connected.youtube }).ready} onClick={() => handleConnect('youtube')}
                aria-label={connecting === 'youtube' ? 'Opening Google…' : connected.youtube ? 'Update YouTube permissions' : 'Connect YouTube analytics'} title={connected.youtube ? 'Update YouTube permissions' : 'Connect YouTube analytics'} aria-busy={connecting === 'youtube'}><AccountActionIcon platform="youtube" busy={connecting === 'youtube'} /></button>
              <Link className="btn btn-ghost btn-sm" to="/analytics">Return to analytics</Link>
            </div>
          </section>}
          <div className="account-directory-page">
            <fieldset className="account-category-filter" aria-label="Account categories">
              <legend>Categories</legend>
              <ul>
                {categoryOptions.map(category => <li key={category.id}>
                  <button type="button" aria-pressed={activeCategory === category.id} onClick={() => setCategoryFilter(category.id)}>
                    {category.label} <span>{category.count}</span>
                  </button>
                </li>)}
              </ul>
            </fieldset>
          </div>
          {!(isBusinessMembership ? displayedCareer : displayedGeneral).length && <div className="source-directory-empty account-directory-empty" role="status">
            <p>No matching accounts</p>
            {activeCategory !== 'all' && <button type="button" className="btn btn-outline btn-sm" onClick={() => setCategoryFilter('all')}>Clear category</button>}
          </div>}
          {isBusinessMembership && displayedCareer.length > 0 && <section style={{ marginBottom: 28 }} aria-labelledby="career-sites-heading">
            <div id="career-sites-heading" style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 6 }}>
              Recruiting accounts
            </div>
            <p style={{ fontSize: '.8rem', color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 10px' }}>
              LinkedIn authorization enables hiring posts in Cross Post. Visit career websites or compare available job listings in Posts & comparisons.
            </p>
            {displayedCareer.map(([key, p]) => {
              const unavailable = p.forceComingSoon || !p.configured;
              return (
                <PlatformCard
                  key={key}
                  platformKey={key}
                  p={p}
                  isConnected={Boolean(connected[key])}
                  comingSoon={!connected[key] && unavailable}
                  expanded={expanded === key}
                  onToggle={() => setExpanded(expanded === key ? null : key)}
                  onConnect={() => handleConnect(key)}
                  onDisconnect={() => handleDisconnect(key)}
                  connecting={connecting === key}
                  disconnecting={disconnecting === key}
                  locked={Boolean(p.locked)}
                />
              );
            })}
          </section>}

          {!isBusinessMembership && generalSections.map(section => (
            <section key={section.id} className="account-category-section" aria-labelledby={`accounts-${section.id}-heading`}>
              <div className="account-category-heading">
                <h2 id={`accounts-${section.id}-heading`}>{section.label}</h2>
              </div>
              <div className="account-category-items">
              {section.items.map(([key, p]) => (
                <PlatformCard
                  key={key}
                  platformKey={key}
                  p={p}
                  isConnected={Boolean(connected[key])}
                  comingSoon={!connected[key] && (p.forceComingSoon || !p.configured)}
                  expanded={expanded === key}
                  onToggle={() => setExpanded(expanded === key ? null : key)}
                  onConnect={() => handleConnect(key)}
                  onDisconnect={() => handleDisconnect(key)}
                  connecting={connecting === key}
                  disconnecting={disconnecting === key}
                  locked={Boolean(p.locked)}
                />
              ))}
              </div>
            </section>
          ))}

        </>
      )}

      {mastodonServer !== null && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setMastodonServer(null)}>
          <form className="card" role="dialog" aria-modal="true" aria-labelledby="mastodon-connect-title" style={{ width: '100%', maxWidth: 420, padding: 20 }}
            onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setMastodonServer(null); }}
            onSubmit={event => { event.preventDefault(); const server = mastodonServer.trim(); if (server) { setMastodonServer(null); startConnect('mastodon', server); } }}>
            <h2 id="mastodon-connect-title">Connect Mastodon</h2>
            <p>Your account belongs to a Mastodon server. Enter its address or your full handle, then approve UFIConnect on that server.</p>
            <label htmlFor="mastodon-server">Server or full handle</label>
            <input id="mastodon-server" className="form-input" autoFocus autoComplete="off" value={mastodonServer} onChange={event => setMastodonServer(event.target.value)} placeholder="mastodon.social or @you@your.server" />
            <p style={{ color: 'var(--muted)', fontSize: '.8rem' }}>Your password stays on your server. UFIConnect imports public posts from your Mastodon home timeline and your own account. You will also grant permission to find original posts, like or unlike them, and publish replies when you choose.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMastodonServer(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary btn-sm account-icon-action" disabled={!mastodonServer.trim()} aria-label="Continue to Mastodon" title="Continue to Mastodon"><AccountActionIcon platform="mastodon" /></button>
            </div>
          </form>
        </div>
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
            role="dialog" aria-modal="true" aria-label="Connect Bluesky"
            onClick={e => e.stopPropagation()}
            onKeyDown={event => { if (event.key === 'Escape') setBlueskyHandle(null); }}
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
              aria-label="Bluesky handle"
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
              <button type="submit" className="btn btn-primary btn-sm account-icon-action" disabled={!blueskyHandle.trim()} aria-label="Continue" title="Continue to Bluesky">
                <AccountActionIcon platform="bluesky" />
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
  onDisconnect, onConnect, connecting, disconnecting, locked,
}) {
  const external = p.connectionMode === 'external';
  const benefits = external ? [] : PLATFORM_BENEFITS[platformKey]
    || (p.category === 'publication' ? PUBLICATION_BENEFITS : p.category === 'career' ? CAREER_BENEFITS : []);
  const reconnectMessage = p.reconnectMessage || (platformKey === 'youtube'
    ? 'Reconnect YouTube once to keep your videos syncing when access expires.'
    : `Reconnect ${p.name} to update your account permissions.`);
  const detailsId = `account-${platformKey}-details`;
  const authorization = sourceAuthorizationState(p, { isConnected });
  const authorizationUnavailable = !authorization.ready;

  return (
    <div className="card account-platform-card">
      <div className="account-platform-card-header">
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
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '.92rem' }}>{p.name}</span>
          </div>
          <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 1 }}>
            {p.description}
          </div>
        </div>

        {/* Action buttons */}
        <div className="account-platform-card-actions">
          <button type="button" onClick={onToggle} className="btn btn-ghost btn-sm" aria-expanded={expanded} aria-controls={detailsId} style={{ fontSize: '.72rem', padding: '4px 8px' }}>
            {expanded ? '▲' : '▼'} Details
          </button>
          <AccountConnectionAction platformKey={platformKey} platform={p} isConnected={isConnected}
            onConnect={onConnect} connecting={connecting} disabled={disconnecting} compact />
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div id={detailsId} style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: benefits.length ? 12 : 0, lineHeight: 1.5 }}>
            {external ? p.note : locked && !isConnected
              ? 'An active membership is required before an account can be connected.'
              : authorizationUnavailable
              ? (p.note || authorization.reason)
              : `Sign in & connect opens ${p.name}'s authorization page. Sign in there and approve UFIConnect access.`}
            {isConnected && p.reconnectRequired && <p role="alert" style={{ margin: '6px 0 0' }}>{reconnectMessage}</p>}
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
                    <span style={{ color: p.color, fontWeight: 800 }}>OK</span> {b}
                  </li>
                ))}
              </ul>
            </>
          )}
          {!external && <div className="account-platform-detail-actions">
            {isConnected && <button type="button" className="btn btn-danger btn-sm" onClick={onDisconnect} disabled={disconnecting || connecting}>
              {disconnecting ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> Disconnecting…</> : `Disconnect ${p.name}`}
            </button>}
          </div>}
        </div>
      )}
    </div>
  );
}
