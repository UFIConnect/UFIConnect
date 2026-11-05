import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import SourceButton from './SourceButton';
import PublishingOptions, { EnablePublishingButton } from './PublishingOptions';
import { publishingUnavailableReason } from './publishingAvailability.mjs';
import { sourceAuthorizationState } from './sourceAuthorization.mjs';
import { SOURCE_META } from './sourceMeta';
import directory from '../../../backend/account-directory.json';
import api from '../api/client';
import { composerTextLimit } from '../utils/publishingDraft.mjs';

export function useJobPublishingCatalog(owner) {
  const [catalog, setCatalog] = useState({ platforms: {}, connected: {}, loading: true, error: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!owner) return undefined;
    const controller = new AbortController();
    setCatalog(previous => ({ ...previous, loading: true, error: '' }));
    api.get('/social/platforms', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) setCatalog({ platforms: data.platforms || {}, connected: data.connected || {}, loading: false, error: '' });
    }).catch(() => {
      if (!controller.signal.aborted) setCatalog({ platforms: {}, connected: {}, loading: false, error: 'Publishing sources could not load. You can still post to UFIConnect.' });
    });
    return () => controller.abort();
  }, [owner, revision]);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('focus', refresh);
    window.addEventListener('ufi-connections-changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('ufi-connections-changed', refresh);
    };
  }, [owner]);
  return { ...catalog, retry: () => setRevision(value => value + 1) };
}

export function jobSourceReason(source, catalog, plan) {
  if (catalog.loading) return 'Checking publishing access.';
  if (plan === 'business' && source !== 'linkedin') return 'Business accounts can share hiring posts to LinkedIn.';
  return publishingUnavailableReason(catalog.platforms[source], {
    connected: Boolean(catalog.connected[source]),
    plan: plan === 'business' && source === 'linkedin' ? 'pro' : plan,
  });
}

export default function JobPublishingSources({ catalog, selected, onToggle, onClear, publishing, plan, disabled, content = '' }) {
  const [search, setSearch] = useState('');
  const entries = Object.entries(catalog.platforms)
    .filter(([key, entry]) => key !== 'uficonnect' && entry?.crossPost?.supported && (plan !== 'business' || key === 'linkedin'))
    .sort(([a], [b]) => Number(Boolean(catalog.connected[b])) - Number(Boolean(catalog.connected[a]))
      || (SOURCE_META[a]?.label || a).localeCompare(SOURCE_META[b]?.label || b));
  const visible = entries.filter(([key, entry]) => `${key} ${entry.name || SOURCE_META[key]?.label || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const renderSource = ([key, entry]) => {
    const name = SOURCE_META[key]?.label || entry.name || key;
    const selectedHere = selected.includes(key);
    const limit = key === 'twitch' ? 500 : composerTextLimit([key]).limit;
    const reason = jobSourceReason(key, catalog, plan) || (content.trim().length > limit ? `Shorten this draft to ${limit.toLocaleString()} characters for this source.` : '');
    const authorization = sourceAuthorizationState(entry, { isConnected: Boolean(catalog.connected[key]) });
    const canConnect = authorization.ready && !catalog.connected[key] && ['pro', 'business'].includes(plan);
    return <div className="job-source-choice" key={key}>
      <SourceButton source={key} label={name} selected={selectedHere} connected={Boolean(catalog.connected[key])}
        disabled={disabled || (!selectedHere && Boolean(reason))}
        aria-label={`${selectedHere ? 'Remove' : 'Select'} ${name}`} reason={reason || `Share this job to ${name}`}
        onClick={() => onToggle(key)} />
      {reason && <small>{reason}</small>}
      {canConnect && <EnablePublishingButton source={key} disabled={disabled || catalog.loading} label={`Connect ${name}`} newTab />}
    </div>;
  };
  return <fieldset className="job-publishing-sources" aria-label="Job publishing sources" disabled={disabled}>
    <legend>Post to</legend>
    <SourceButton source="uficonnect" label="UFIConnect Jobs" selected connected disabled aria-label="UFIConnect Jobs" />
    {selected.length > 0 && <button type="button" className="btn btn-ghost btn-sm job-clear-other-sources" onClick={onClear}>Clear other sources</button>}
    <p className="job-compose-note">Your listing is posted on UFIConnect. Choose connected sources to share the same job elsewhere.</p>
    <label className="job-compose-field">Find a publishing source<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="LinkedIn, Reddit, Bluesky…" /></label>
    <div className="job-source-choices">{visible.slice(0, 8).map(renderSource)}</div>
    {visible.length > 8 && <details className="job-more-sources"><summary>More publishing sources ({visible.length - 8})</summary><div className="job-source-choices">{visible.slice(8).map(renderSource)}</div></details>}
    {!visible.length && !catalog.loading && <p className="job-compose-note">{search ? 'No publishing sources match your search.' : 'No other direct publishing sources are available for this account.'}</p>}
    {catalog.loading && <p role="status">Loading publishing sources…</p>}
    {catalog.error && <p role="alert">{catalog.error} <button type="button" className="btn btn-ghost btn-sm" onClick={catalog.retry}>Retry sources</button></p>}
    <PublishingOptions publishing={publishing} disabled={disabled} newTab />
    {plan === 'free' && <p className="job-compose-note">Sharing directly to connected accounts requires <Link to="/settings">Pro</Link>. Posting on UFIConnect and using the career-site links below are available to you.</p>}
  </fieldset>;
}

export function JobCareerSites({ content, disabled = false }) {
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const entries = [
    ['linkedin', { name: 'LinkedIn', siteUrl: 'https://www.linkedin.com/' }],
    ...Object.entries(directory).filter(([, entry]) => entry.category === 'career'),
  ].filter(([, entry]) => entry.name.toLowerCase().includes(query.trim().toLowerCase()));
  async function openSite(entry) {
    window.open(entry.siteUrl, '_blank', 'noopener,noreferrer');
    try {
      await navigator.clipboard.writeText(content);
      setNotice(`Job text copied. Finish your listing on ${entry.name}.`);
    } catch {
      setNotice(`Opened ${entry.name}. Copy the job text from your preview to finish your listing.`);
    }
  }
  return <section className="card job-career-sites" aria-label="Career site posting links">
    <h2>Other career sites</h2>
    <p className="job-compose-note">Copy your job text and finish posting on a career site. These links open the site; they do not automatically publish a listing.</p>
    <label className="job-compose-field">Find a career site<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Indeed, Glassdoor, USAJobs…" /></label>
    <div className="job-career-site-grid">{entries.slice(0, query ? entries.length : 8).map(([key, entry]) => <button key={key} type="button" className="btn btn-outline btn-sm" disabled={disabled || !content.trim()} onClick={() => openSite(entry)}>Copy and open {entry.name}</button>)}</div>
    {!query && entries.length > 8 && <details className="job-more-sources"><summary>More career sites ({entries.length - 8})</summary><div className="job-career-site-grid">{entries.slice(8).map(([key, entry]) => <button key={key} type="button" className="btn btn-outline btn-sm" disabled={disabled || !content.trim()} onClick={() => openSite(entry)}>Copy and open {entry.name}</button>)}</div></details>}
    {!entries.length && <p>No career sites match your search.</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
