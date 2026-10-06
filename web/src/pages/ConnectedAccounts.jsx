import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import client, { publicOAuthRequestConfig } from '../api/client';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import { withCareerAccountFallback } from '../components/sourceMeta';
import { useAuth } from '../contexts/AuthContext';
import { DirectoryControls, AccountSiteLink } from '../components/DirectoryControls';
import { ACCOUNT_STATUSES, filterAccounts } from '../components/sourceDirectory';

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

export default function ConnectedAccounts() {
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [platforms, setPlatforms]       = useState([]);
  const [connected, setConnected]       = useState({});
  const [loading,   setLoading]         = useState(true);
  const [expanded,  setExpanded]        = useState(null);
  const [flash,     setFlash]           = useState(null);
  const [connecting, setConnecting]     = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);
  const [accountFilter, setAccountFilter] = useState('all');
  // null = modal closed; '' or partial text = open, mid-typing. Bluesky is
  // the one platform with no fixed authorization URL (AT Protocol is
  // federated — the handle is how we find which server to route to), so it
  // gets its own in-app prompt instead of the plain click-to-connect every
  // other platform uses.
  const [blueskyHandle, setBlueskyHandle] = useState(null);
  const isBusinessMembership = profile?.plan === 'business';

  useEffect(() => {
    client.get('/social/platforms').then((pRes) => {
      const includeCareer = pRes.data.careerOnly === true || isBusinessMembership;
      setPlatforms(Object.entries(withCareerAccountFallback(pRes.data.platforms, includeCareer)));
      setConnected(pRes.data.connected || {});
    }).catch(console.error).finally(() => setLoading(false));
  }, [isBusinessMembership]);

  // Handle OAuth callback redirect params (?social_connected=platform or ?social_error=platform)
  useEffect(() => {
    const connected_ = searchParams.get('social_connected');
    const errPlatform = searchParams.get('social_error');
    const errReason   = searchParams.get('reason');
    if (connected_) {
      window.dispatchEvent(new Event('ufi-connections-changed'));
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
        : reasonBase === 'access_denied' && errPlatform === 'youtube'
          ? 'YouTube did not grant access. In Google Cloud, publish the OAuth app or add this Google account as a test user, then try again.'
        : reasonBase === 'access_denied'          ? 'The provider did not grant access. Please try again.'
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
    const connectParams = new URLSearchParams();
    if (handle) connectParams.set('handle', handle.trim());
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
  const careerPlatforms = platforms.filter(([, p]) => p.category === 'career');
  const generalPlatforms = platforms.filter(([, p]) => p.category !== 'career' && !p.commandCenterOnly);
  const displayedGeneral = filterAccounts(generalPlatforms, connected, accountFilter);
  const displayedCareer = filterAccounts(careerPlatforms, connected, accountFilter);
  const connectedCareerCount = careerPlatforms.filter(([key]) => connected[key]).length;
  const connectedList   = displayedGeneral.filter(([k]) => connected[k]);
  const availableList   = displayedGeneral.filter(([k, p]) => !connected[k] && p.configured && !p.forceComingSoon);
  const comingSoonList  = displayedGeneral.filter(([k, p]) => !connected[k] && (p.forceComingSoon || !p.configured));
  const totalConnected = generalPlatforms.filter(([key]) => connected[key]).length;

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
            ? 'Your Business membership keeps account connections focused on career providers.'
            : 'Connect your social, magazine, and article accounts.'}
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
          {isBusinessMembership && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24,
              background: 'var(--bg-secondary)', borderRadius: 10, padding: '12px 16px',
            }}>
              <div style={{ fontSize: '.8rem', fontWeight: 800, color: 'var(--primary)' }}>BIZ</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '.95rem' }}>{connectedCareerCount} of {careerPlatforms.length} career accounts connected</div>
                <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>Career providers use the same secure authorization flow as social accounts.</div>
              </div>
            </div>
          )}
          {!isBusinessMembership && (
            <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24,
            background: 'var(--bg-secondary)', borderRadius: 10, padding: '12px 16px',
          }}>
            <div style={{ fontSize: '.8rem', fontWeight: 800, color: 'var(--primary)' }}>LINK</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.95rem' }}>
                {totalConnected} of {generalPlatforms.length} accounts connected
              </div>
              <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>
                {totalConnected === 0
                  ? 'Connect an account to personalise your feed.'
                  : `Connected: ${generalPlatforms.filter(([key]) => connected[key]).map(([, p]) => p.name).join(', ')}`}
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

          {platforms.some(([, p]) => p.commandCenterOnly) && (
            <div style={{ margin: '-10px 0 24px', fontSize: '.78rem', color: 'var(--muted)' }}>
              Account-only publishing and personal-post connections are managed in the <Link to="/command-center?tab=accounts" style={{ color: 'var(--primary)', fontWeight: 700 }}>Command Center</Link>.
            </div>
          )}
            </>
          )}

          {searchParams.get('interactions') === '1' && <section className="card" aria-label="Source interaction permissions" style={{ marginBottom: 20 }}>
            <h2>Likes and comments</h2>
            <p>Authorize publishing actions on a connected source. Your comments will be published on that platform.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['reddit', 'twitter', 'youtube', 'github', 'gitlab', 'bluesky'].filter(key => connected[key]).map(key => <button key={key} className="btn btn-outline btn-sm" disabled={!!connecting} onClick={() => handleConnect(key)}>Enable actions on {key === 'twitter' ? 'X' : key}</button>)}
            </div>
          </section>}
          {(searchParams.get('analytics') === '1' || searchParams.get('monetization') === '1') && <section className="card" aria-labelledby="source-analytics-permissions" style={{ marginBottom: 20, padding: 20 }}>
            <h2 id="source-analytics-permissions" style={{ fontSize: '1.1rem', margin: '0 0 8px' }}>YouTube analytics permissions</h2>
            <p style={{ color: 'var(--muted)', fontSize: '.85rem', lineHeight: 1.6 }}>Authorize read access to your channel analytics{searchParams.get('monetization') === '1' ? ' and estimated revenue' : ''}. YouTube controls eligibility, reporting delays, advertising, and payouts. Review the permissions on Google’s authorization screen.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={!!connecting || !platforms.some(([key, item]) => key === 'youtube' && item.configured && !item.forceComingSoon)} onClick={() => handleConnect('youtube')}>{connecting === 'youtube' ? 'Opening Google…' : connected.youtube ? 'Update YouTube permissions' : 'Connect YouTube analytics'}</button>
              <Link className="btn btn-ghost btn-sm" to="/analytics">Return to analytics</Link>
            </div>
          </section>}
          <div className="account-directory-page">
            <DirectoryControls label="accounts" filter={accountFilter} onFilterChange={setAccountFilter}
              options={[["all", "All statuses"], ...ACCOUNT_STATUSES]} />
          </div>
          {!(isBusinessMembership ? displayedCareer : displayedGeneral).length && <p className="source-directory-empty" role="status">No matching accounts</p>}
          {isBusinessMembership && displayedCareer.length > 0 && <section style={{ marginBottom: 28 }} aria-labelledby="career-sites-heading">
            <div id="career-sites-heading" style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 6 }}>
              Career accounts
            </div>
            <p style={{ fontSize: '.8rem', color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 10px' }}>
              Connect through each provider's authorization flow. Job browsing remains in Opportunities.
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

          {/* Connected section */}
          {!isBusinessMembership && connectedList.length > 0 && (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.6px', marginBottom: 10 }}>
                Connected
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
                  locked={Boolean(p.locked)}
                />
              ))}
            </div>
          )}

          {/* Coming Soon — all platforms pending OAuth integration */}
          {!isBusinessMembership && availableList.length > 0 && (
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
                  locked={Boolean(p.locked)}
                />
              ))}
            </div>
          )}

          {!isBusinessMembership && comingSoonList.length > 0 && (
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
                  locked={Boolean(p.locked)}
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
  onDisconnect, onConnect, connecting, disconnecting, locked,
}) {
  const benefits = PLATFORM_BENEFITS[platformKey]
    || (p.category === 'publication' ? PUBLICATION_BENEFITS : p.category === 'career' ? CAREER_BENEFITS : []);

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
            {isConnected && (
              <span style={{
                fontSize: '.65rem', fontWeight: 700, color: p.reconnectRequired ? '#92400E' : '#059669',
                background: p.reconnectRequired ? '#FEF3C7' : '#ECFDF5', padding: '1px 6px', borderRadius: 4,
              }}>
                {p.reconnectRequired ? 'Reconnect needed' : 'Connected'}
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
            {!isConnected && locked && !comingSoon && (
              <span style={{
                fontSize: '.65rem', fontWeight: 700, color: '#5B21B6',
                background: '#F3E8FF', padding: '1px 6px', borderRadius: 4,
              }}>
                Membership
              </span>
            )}
          </div>
          <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 1 }}>
            {p.description}
            {isConnected && p.reconnectRequired && <p role="status" style={{ margin: '6px 0 0' }}>Reconnect YouTube once to keep your videos syncing when access expires.</p>}
          </div>
        </div>

        {/* Action buttons */}
        <div className="account-platform-card-actions">
          {isConnected && platformKey === 'youtube' && <button type="button" className="btn btn-outline btn-sm" onClick={onConnect} disabled={connecting || disconnecting || !p.configured}>{connecting ? 'Opening Google…' : 'Reconnect YouTube'}</button>}
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
          ) : locked ? (
            <button className="btn btn-sm btn-outline" disabled title="An active membership is required to connect accounts.">
              Membership required
            </button>
          ) : (
            <button className="btn btn-sm btn-outline" onClick={onConnect} disabled={connecting} style={{ borderColor: p.color, color: p.color }}>
              {connecting ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : 'Connect'}
            </button>
          )}
          <AccountSiteLink platform={platformKey} name={p.name} />
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: benefits.length ? 12 : 0, lineHeight: 1.5 }}>
            {locked && !isConnected
              ? 'An active membership is required before an account can be connected.'
              : comingSoon
              // A platform note explains any provider-specific gate rather
              // than incorrectly blaming missing server credentials.
              ? (p.note || `Waiting on server credentials: ${(p.missingEnv || []).join(', ') || 'OAuth client ID/secret'}.`)
              : `Connect opens ${p.name}'s authorization page so you can approve UFIconnect access at the original source.`}
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
        </div>
      )}
    </div>
  );
}
