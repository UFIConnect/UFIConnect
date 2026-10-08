import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Bookmark, Copy, Grid2X2, RefreshCw } from 'lucide-react';
import client from '../api/client';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { importedAppActions, sourceForVaultEntry, SOURCE_APPS, IMPORTED_APPS } from '../vault/sourceApps.mjs';
import { safeLaunchUrl } from '../vault/vaultLaunchers.mjs';
function SourceWatermark({ source, label }) {
  return <span className="vault-source-watermark" aria-label={`Source: ${label}`}><span className="vault-source-watermark-icon" aria-hidden="true">{hasBrandIcon(source) ? <BrandIcon platform={source} size={15} /> : <b>{label.slice(0, 1).toUpperCase()}</b>}</span><span>{label}</span></span>;
}
export default function VaultSourceApp({ entry, busy, onBack, onCopy, launchLinks }) {
  const [catalog, setCatalog] = useState(null), [catalogError, setCatalogError] = useState('');
  const [library, setLibrary] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [pages, setPages] = useState([]), [pageIndex, setPageIndex] = useState(0);
  const [activity, setActivity] = useState(null), [activityLoading, setActivityLoading] = useState(false), [activityError, setActivityError] = useState(''), [actionId, setActionId] = useState('');
  const operation = useRef(null), mounted = useRef(false);
  const activityOperation = useRef(null);
  const pageHeading = useRef(null);
  useEffect(() => {
    mounted.current = true;
    pageHeading.current?.focus({ preventScroll: true });
    pageHeading.current?.scrollIntoView({ block: 'start' });
    const controller = new AbortController();
    client.get('/social/platforms', { signal: controller.signal }).then(({ data }) => { if (!controller.signal.aborted) setCatalog(data); })
      .catch(() => { if (!controller.signal.aborted) setCatalogError('Connected sources could not be checked. Try reopening this app page.'); });
    return () => { mounted.current = false; controller.abort(); operation.current?.abort(); activityOperation.current?.abort(); };
  }, []);
  const source = sourceForVaultEntry(entry, catalog?.platforms || {});
  const platform = catalog?.platforms?.[source] || {};
  const capability = SOURCE_APPS[source];
  const sourceLabel = platform.name || capability?.label || IMPORTED_APPS[source]?.label || entry.name;
  const actions = importedAppActions(entry, source, platform, Boolean(catalog?.connected?.[source] ?? platform.connected), catalog?.careerOnly);
  const selectedAction = activity?.actions?.find(action => action.id === actionId);
  async function loadActivity() {
    if (activityLoading || source !== 'github') return;
    activityOperation.current?.abort();
    const controller = new AbortController(); activityOperation.current = controller;
    setActivityLoading(true); setActivityError('');
    try {
      const { data } = await client.get(`/social/apps/${source}/activity`, { signal: controller.signal, timeout: 30000 });
      if (!mounted.current || controller.signal.aborted) return;
      setActivity(data); setActionId(data.actions?.[0]?.id || '');
    } catch (failure) { if (mounted.current && !controller.signal.aborted) setActivityError(failure.response?.data?.message || 'Source activity could not be loaded. Please retry.'); }
    finally { if (mounted.current && !controller.signal.aborted) setActivityLoading(false); }
  }
  useEffect(() => {
    if (source === 'github' && catalog?.connected?.github) void loadActivity();
  }, [source, catalog?.connected?.github]);
  async function loadFavorites(cursor = '', reset = false) {
    if (loading || !capability) return;
    operation.current?.abort();
    const controller = new AbortController(); operation.current = controller;
    setLoading(true); setError('');
    if (reset) { setLibrary(null); setPages([]); setPageIndex(0); }
    try {
      const { data } = await client.get(`/social/apps/${source}/favorites`, { params: { cursor: cursor || undefined }, signal: controller.signal, timeout: 30000 });
      if (!mounted.current || controller.signal.aborted) return;
      const page = { ...data, items: Array.isArray(data.items) ? data.items.filter(item => safeLaunchUrl(item.url, true)) : [] };
      setLibrary(page);
      setPages(previous => reset ? [page] : [...previous, page]);
      if (!reset) setPageIndex(previous => previous + 1);
    } catch (failure) { if (mounted.current && !controller.signal.aborted) setError(failure.response?.data?.message || 'Favorites could not be loaded. Please retry.'); }
    finally { if (mounted.current && !controller.signal.aborted) setLoading(false); }
  }
  function openFavorites() {
    if (!library) void loadFavorites('', true);
    document.getElementById('vault-source-library')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function forgetLibrary() {
    operation.current?.abort(); setLibrary(null); setPages([]); setPageIndex(0); setLoading(false); setError('');
  }
  return <section className="vault-panel vault-source-page" aria-labelledby="vault-source-title">
    <button type="button" className="vault-text-button" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" />Back to passwords</button>
    <header className="vault-source-heading"><div><span className="vault-eyebrow">IMPORTED APP</span><h2 ref={pageHeading} tabIndex={-1} id="vault-source-title">{entry.name}</h2><p>{entry.username || 'Saved account'}</p></div><div className="vault-source-heading-actions"><SourceWatermark source={source} label={sourceLabel} /><div className="vault-route-icons">{launchLinks(entry)}</div></div></header>
    <p className="vault-helper">Choose an action for this imported app. UFIConnect features open here; source websites and players open in their own tab or app.</p>
    {catalogError && <p className="vault-form-error" role="alert">{catalogError}</p>}
    {!catalog && !catalogError && <p role="status">Checking connected source…</p>}
    <section className="vault-app-commands" aria-label="Actions"><h3>Actions</h3>
      <div className="vault-source-command-grid">{actions.map(action => {
        const content = <><Grid2X2 size={19} aria-hidden="true" /><span><strong>{action.label}</strong><small>{action.to ? 'In UFIConnect' : 'On the source'}</small></span><ArrowUpRight size={15} aria-hidden="true" /></>;
        return action.to ? <Link key={action.id} to={action.to}>{content}</Link> : <a key={action.id} href={action.url} target="_blank" rel="noopener noreferrer">{content}</a>;
      })}</div>
      {source === 'netflix' && <p className="vault-helper">Watch using your own Netflix membership and Netflix’s player. Your saved password can be copied below if you need to sign in.</p>}
      {source === 'github' && <>
        <p className="vault-helper">Read your connected GitHub account’s recent activity to arrange its actions here. These are GitHub events; navigation and private app settings are unavailable.</p>
        {activityError && <p className="vault-form-error" role="alert">{activityError}</p>}
        <button type="button" className="vault-button vault-button--secondary" disabled={activityLoading || busy || !catalog} onClick={loadActivity}><RefreshCw size={15} aria-hidden="true" />{activityLoading ? 'Loading source activity…' : activity ? 'Refresh GitHub actions' : 'Load GitHub actions'}</button>
        {activity && <><p className="vault-source-account">From GitHub: <strong>{activity.account}</strong></p><p className="vault-helper">{activity.scope}</p>
          <div className="vault-source-command-grid">{activity.actions.map(action => <button key={action.id} type="button" aria-pressed={actionId === action.id} onClick={() => setActionId(action.id)}><span><strong>{action.label}</strong><small>{action.count} recent GitHub event{action.count === 1 ? '' : 's'}</small></span><ArrowUpRight size={15} aria-hidden="true" /></button>)}</div>
          {selectedAction && <ul className="vault-source-items">{selectedAction.items.map(item => <li key={item.id}><div><strong>{item.title}</strong><SourceWatermark source={source} label={sourceLabel} /></div><a className="vault-icon-button vault-route-icon" href={safeLaunchUrl(item.url, true)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.title} on GitHub`}><ArrowUpRight size={18} aria-hidden="true" /></a></li>)}</ul>}
          {!activity.actions.length && <p className="vault-helper">GitHub returned no supported actions in its available recent activity.</p>}
          <button type="button" className="vault-text-button" onClick={() => { activityOperation.current?.abort(); setActivity(null); setActionId(''); setActivityLoading(false); setActivityError(''); }}>Clear loaded activity</button>
        </>}
      </>}
      {capability && <div className="vault-source-command-grid"><button type="button" disabled={loading || busy || !catalog} onClick={openFavorites}><Bookmark size={19} aria-hidden="true" /><span><strong>{capability.collection}</strong><small>Read from {capability.label}</small></span><ArrowUpRight size={15} aria-hidden="true" /></button></div>}
      {source !== 'github' && capability && catalog && <p className="vault-helper">Additional collections available from this connected source are shown below.</p>}
    </section>
    {capability ? <section id="vault-source-library" className="vault-source-library" aria-labelledby="vault-source-library-title">
      <div className="vault-panel-heading"><h3 id="vault-source-library-title">{capability.collection}</h3>{library && <button type="button" className="vault-text-button" disabled={loading || busy} onClick={() => loadFavorites('', true)}><RefreshCw size={14} aria-hidden="true" />Refresh</button>}</div>
      <p className="vault-helper">Read from {capability.label} when you open this collection. Your connected source account may differ from the password account above. Results stay on this page until you leave, lock Vault, or clear them.</p>
      {source === 'youtube' && <p className="vault-helper">YouTube exposes your playlists through its API. Watch Later and external viewing history are unavailable.</p>}
      {error && <p className="vault-form-error" role="alert">{error}</p>}
      {loading && <p role="status">Loading from {capability.label}…</p>}
      {!library && <button type="button" className="vault-button vault-button--secondary" disabled={loading || busy || !catalog} onClick={openFavorites}>{error ? 'Retry' : `Load from ${capability.label}`}</button>}
      {error && <Link className="vault-text-button" to="/connected-accounts">Manage source connection <ArrowUpRight size={14} aria-hidden="true" /></Link>}
      {library && <><p className="vault-source-account">From {capability.label}: <strong>{library.account}</strong></p>
        {library.items.length ? <ul className="vault-source-items">{library.items.map(item => <li key={item.id}><div><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}<SourceWatermark source={source} label={sourceLabel} /></div><a className="vault-icon-button vault-route-icon" href={item.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.title} on ${capability.label}`} title={`Open on ${capability.label}`}><ArrowUpRight size={18} aria-hidden="true" /></a></li>)}</ul> : <p className="vault-helper">{capability.label} returned no items on this page.</p>}
        <div className="vault-source-pagination"><button type="button" className="vault-text-button" disabled={!pageIndex || loading} onClick={() => { setPageIndex(pageIndex - 1); setLibrary(pages[pageIndex - 1]); }}>Previous</button><span>Page {pageIndex + 1}</span><button type="button" className="vault-text-button" disabled={loading || (!pages[pageIndex + 1] && !library.nextCursor)} onClick={() => { if (pages[pageIndex + 1]) { setPageIndex(pageIndex + 1); setLibrary(pages[pageIndex + 1]); } else void loadFavorites(library.nextCursor); }}>Next</button></div>
        <button type="button" className="vault-text-button" onClick={forgetLibrary}>Clear loaded favorites</button>
      </>}
    </section> : null}
    <footer className="vault-source-footer"><button type="button" className="vault-text-button" disabled={busy} onClick={() => onCopy(entry.password)}><Copy size={15} aria-hidden="true" />Copy password</button><Link className="vault-text-button" to="/connected-accounts">Connected accounts</Link></footer>
  </section>;
}
