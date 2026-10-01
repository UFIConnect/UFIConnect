import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import SourceWorkspace from '../components/SourceWorkspace';
import { useAuth } from '../contexts/AuthContext';
import { UfiFeedContent } from './Post';
import { CENTERS, readWorkspace, useLocalWorkspace, downloadText, safeLink } from '../local/localWorkspace';
import '../components/local-workspaces.css';

const EMPTY = { documents: [] };
const string = value => typeof value === 'string' ? value : '';
const newDraft = () => ({ id: crypto.randomUUID(), title: '', body: '', sources: [], ingredients: '', servings: 2, portions: 2, team: '', opponent: '', date: '', code: '<!doctype html>\n<html lang="en"><head><title>My prototype</title></head>\n<body><h1>Hello, UFIconnect</h1></body></html>', method: 'GET', endpoint: 'https://example.com/api/items', payload: '{}' });
const cleanDraft = draft => ({ ...newDraft(), ...draft, title: string(draft.title), body: string(draft.body), sources: Array.isArray(draft.sources) ? draft.sources.filter(source => typeof source?.url === 'string').slice(0, 50) : [] });
function Analytics({ accountId }) {
  const [revision, setRevision] = useState(0);
  const city = readWorkspace(accountId, 'city', {});
  const rows = CENTERS.filter(center => center.id !== 'developer-analytics').map(center => {
    const stored = readWorkspace(accountId, center.id, EMPTY);
    const documents = Array.isArray(stored.documents) ? stored.documents : [];
    return { ...center, count: documents.length, words: documents.reduce((sum, doc) => sum + string(doc.body).split(/\s+/).filter(Boolean).length, 0), updated: stored.updatedAt };
  });
  const report = { generatedAt: new Date().toISOString(), selectedPosts: Array.isArray(city.selected) ? city.selected.length : 0, categories: Array.isArray(city.enabled) ? city.enabled.length : 0, workspaces: rows };
  return <div key={revision}><div className="local-chip-row"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevision(value => value + 1)}>Refresh</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText('ufi-local-analytics.json', JSON.stringify(report, null, 2), 'application/json')}>Export report</button></div>
    <p className="local-muted">Counts come from this account’s saved work on this browser. They do not represent production traffic, server health, or other users.</p>
    <div className="local-metric-grid"><div className="card"><strong>{report.selectedPosts}</strong><span>Selected city posts</span></div><div className="card"><strong>{report.categories}</strong><span>Enabled categories</span></div><div className="card"><strong>{rows.reduce((sum, row) => sum + row.count, 0)}</strong><span>Saved documents</span></div></div>
    <div className="local-table-scroll"><table className="local-table"><thead><tr><th>Workspace</th><th>Documents</th><th>Words</th><th>Last saved</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td><Link to={'/centers/' + row.id}>{row.label}</Link></td><td>{row.count}</td><td>{row.words}</td><td>{row.updated && Number.isFinite(Date.parse(row.updated)) ? new Date(row.updated).toLocaleString() : 'No saved work'}</td></tr>)}</tbody></table></div>
  </div>;
}
function DraftWorkspace({ center, accountId }) {
  const stored = useLocalWorkspace(accountId, center.id, EMPTY);
  const initial = readWorkspace(accountId, center.id, EMPTY);
  const [draft, setDraft] = useState(() => cleanDraft(Array.isArray(initial.documents) && initial.documents[0] || newDraft()));
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [previewCode, setPreviewCode] = useState('');
  const [composer, setComposer] = useState(null);
  const saveTimer = useRef(null);
  const documents = Array.isArray(stored.value.documents) ? stored.value.documents : [];
  const update = patch => { setDraft(current => ({ ...current, ...patch })); setDirty(true); setNotice(''); };
  function save() {
    const record = { ...draft, updatedAt: new Date().toISOString() };
    const next = [record, ...documents.filter(item => item.id !== draft.id)].slice(0, 50);
    if (stored.save({ documents: next, updatedAt: record.updatedAt })) { setDirty(false); setNotice('Saved in this browser.'); return true; }
    return false;
  }
  useEffect(() => {
    const beforeUnload = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    const beforeLink = event => {
      const anchor = event.target.closest?.('a[href]');
      if (!dirty || !anchor || anchor.target === '_blank') return;
      let url;
      try { url = new URL(anchor.href, window.location.href); } catch { return; }
      if (url.origin === window.location.origin && url.href !== window.location.href && !save()) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeLink, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', beforeLink, true); };
  }, [dirty, draft, documents]);
  useEffect(() => {
    if (!dirty) return;
    saveTimer.current = setTimeout(save, 900);
    return () => clearTimeout(saveTimer.current);
  }, [draft, dirty]);
  const wordCount = string(draft.body).trim().split(/\s+/).filter(Boolean).length;
  const sourceText = draft.sources.map((source, index) => (index + 1) + '. ' + source.title + ' — ' + source.url).join('\n');
  const articleText = [draft.title, draft.body, sourceText && 'Sources\n' + sourceText].filter(Boolean).join('\n\n');
  const safeCode = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; img-src data: blob:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">' + string(draft.code);
  const ingredientRows = string(draft.ingredients).split('\n').filter(Boolean).map(line => {
    const [quantity, unit = '', ...name] = line.split('|').map(value => value.trim());
    const amount = Number(quantity), scale = Math.max(1, Number(draft.portions) || 1) / Math.max(1, Number(draft.servings) || 1);
    return { amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * scale * 100) / 100 : '—', unit, name: name.join(' | ') || line };
  });
  let validJson = true, formattedJson = '';
  try { formattedJson = JSON.stringify(JSON.parse(string(draft.payload)), null, 2); } catch { validJson = false; }
  const endpoint = safeLink(draft.endpoint);
  const requestExample = JSON.stringify({ method: draft.method, url: endpoint, ...(draft.method !== 'GET' && validJson ? { headers: { 'Content-Type': 'application/json' }, body: JSON.parse(draft.payload) } : {}) }, null, 2);
  function addSource(event) {
    event.preventDefault();
    const url = safeLink(sourceUrl);
    if (!url) return setNotice('Enter a full HTTP or HTTPS source link.');
    if (draft.sources.length >= 50) return setNotice('This notebook can hold 50 sources.');
    update({ sources: [...draft.sources, { title: sourceTitle.trim() || new URL(url).hostname, url }] });
    setSourceTitle(''); setSourceUrl('');
  }
  function exportEvent() {
    const date = new Date(draft.date);
    if (!draft.date || !Number.isFinite(date.getTime())) return setNotice('Choose a valid date and time.');
    const stamp = value => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const escape = value => String(value).replace(/\\/g, '\\\\').replace(/[\r\n]+/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const text = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UFIconnect//Sports Center//EN', 'BEGIN:VEVENT',
      'UID:' + draft.id + '@uficonnect.local', 'DTSTAMP:' + stamp(new Date()), 'DTSTART:' + stamp(date), 'DTEND:' + stamp(new Date(date.getTime() + 7200000)),
      'SUMMARY:' + escape(draft.title || draft.team + ' vs ' + draft.opponent), 'DESCRIPTION:' + escape(draft.body), 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
    downloadText('ufi-match.ics', text, 'text/calendar');
  }
  function chooseDraft(id) {
    if (dirty && !save()) return;
    const record = documents.find(item => item.id === id);
    setDraft(cleanDraft(record || newDraft())); setDirty(false); setNotice(''); setComposer(null); setPreviewCode('');
  }
  return <div className="center-workspace-grid">
    <aside className="card center-drafts"><div className="local-workspace-heading"><h2>Saved work</h2><button type="button" className="btn btn-ghost btn-sm" onClick={() => chooseDraft('')}>New</button></div>
      {documents.map(item => <button type="button" key={item.id} className={'center-draft-button' + (item.id === draft.id ? ' active' : '')} onClick={() => chooseDraft(item.id)}>{item.title || 'Untitled draft'}</button>)}
      {!documents.length && <p className="local-muted">Your drafts appear here as you write.</p>}<p className="local-muted">Up to 50 documents per center, stored in this browser.</p>
    </aside>
    <section className="card center-editor"><label className="local-field">Title<input value={draft.title} maxLength={200} onChange={event => update({ title: event.target.value })} placeholder={center.id === 'sports' ? 'Match or training session' : 'Name your project'} /></label>
      {center.id === 'sports' && <div className="local-field-grid"><label className="local-field">Your team<input value={string(draft.team)} maxLength={100} onChange={event => update({ team: event.target.value })} /></label><label className="local-field">Opponent<input value={string(draft.opponent)} maxLength={100} onChange={event => update({ opponent: event.target.value })} /></label><label className="local-field">Date and time (your timezone)<input type="datetime-local" value={string(draft.date)} onChange={event => update({ date: event.target.value })} /></label></div>}
      {center.id === 'cooking' && <><div className="local-field-grid"><label className="local-field">Recipe servings<input type="number" min="1" max="50" value={draft.servings} onChange={event => update({ servings: Math.min(50, Math.max(1, Number(event.target.value) || 1)) })} /></label><label className="local-field">Cook for<input type="number" min="1" max="50" value={draft.portions} onChange={event => update({ portions: Math.min(50, Math.max(1, Number(event.target.value) || 1)) })} /></label></div>
        <label className="local-field">Ingredients · quantity | unit | ingredient<textarea rows={5} value={string(draft.ingredients)} maxLength={10000} placeholder={'200 | g | rice\n2 | tbsp | olive oil'} onChange={event => update({ ingredients: event.target.value })} /></label>
        {ingredientRows.length > 0 && <div className="local-table-scroll"><table className="local-table"><caption>Ingredients for {draft.portions} servings</caption><thead><tr><th>Amount</th><th>Unit</th><th>Ingredient</th></tr></thead><tbody>{ingredientRows.map((row, index) => <tr key={index}><td>{row.amount}</td><td>{row.unit}</td><td>{row.name}</td></tr>)}</tbody></table></div>}
      </>}
      {center.id === 'developer' && <><label className="local-field">HTML, CSS and JavaScript<textarea className="center-code" rows={14} spellCheck={false} value={string(draft.code)} maxLength={100000} onChange={event => update({ code: event.target.value })} /></label>
        <div className="local-chip-row"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreviewCode(safeCode)}>Run preview</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText('ufi-prototype.html', string(draft.code), 'text/html')}>Download HTML</button></div>
        {previewCode && <iframe className="center-code-preview" title="Isolated prototype preview" sandbox="allow-scripts" srcDoc={previewCode} />}
        <p className="local-muted">Prototype scripts run in an isolated frame. Fetch and external resource loading are blocked.</p>
      </>}
      {center.id === 'backend' && <><div className="local-field-grid"><label className="local-field">Method<select value={draft.method} onChange={event => update({ method: event.target.value })}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(method => <option key={method}>{method}</option>)}</select></label><label className="local-field">Endpoint<input type="url" value={string(draft.endpoint)} maxLength={2000} onChange={event => update({ endpoint: event.target.value })} /></label></div>
        <label className="local-field">JSON payload<textarea className="center-code" rows={10} value={string(draft.payload)} maxLength={100000} onChange={event => update({ payload: event.target.value })} spellCheck={false} /></label>
        <p className={validJson ? 'local-muted' : 'local-error'} role="status">{validJson ? 'Valid JSON' : 'Invalid JSON. Check quotes, commas, and brackets.'}</p>
        <div className="local-chip-row"><button type="button" className="btn btn-ghost btn-sm" disabled={!validJson} onClick={() => update({ payload: formattedJson })}>Format JSON</button><button type="button" className="btn btn-ghost btn-sm" disabled={!endpoint || (draft.method !== 'GET' && !validJson)} onClick={() => downloadText('ufi-api-request.json', requestExample, 'application/json')}>Export request</button></div>
        <p className="local-muted">Request design only; this tool does not send requests or deploy a backend. Keep credentials out of locally saved examples.</p>
      </>}
      <label className="local-field">{center.id === 'writing' ? 'Article' : center.id === 'cooking' ? 'Cooking instructions' : 'Notes'}<textarea rows={center.id === 'writing' ? 15 : 7} maxLength={100000} value={draft.body} onChange={event => update({ body: event.target.value })} placeholder={center.id === 'research' ? 'Research question, findings, and next steps…' : 'Start writing…'} /></label>
      {['writing', 'research'].includes(center.id) && <section className="center-sources"><h3>Sources</h3><form className="local-field-grid" onSubmit={addSource}><label className="local-field">Source title<input maxLength={200} value={sourceTitle} onChange={event => setSourceTitle(event.target.value)} /></label><label className="local-field">Source URL<input type="url" required maxLength={2000} placeholder="https://" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} /></label><button type="submit" className="btn btn-ghost btn-sm">Add source</button></form><ol>{draft.sources.map((source, index) => <li key={index}><a href={safeLink(source.url)} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a><button type="button" className="btn btn-ghost btn-sm" aria-label={'Remove ' + (source.title || 'source')} onClick={() => update({ sources: draft.sources.filter((_, i) => i !== index) })}>Remove</button></li>)}</ol></section>}
      <div className="local-chip-row"><button type="button" className="btn btn-ghost btn-sm" onClick={save}>Save draft</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText('ufi-' + center.id + '.md', '# ' + (draft.title || 'Untitled') + '\n\n' + draft.body + (sourceText ? '\n\n## Sources\n' + sourceText : ''))}>Download notes</button>
        {center.id === 'writing' && <button type="button" className="btn btn-ghost btn-sm" disabled={!articleText.trim()} onClick={() => setComposer({ key: crypto.randomUUID(), text: articleText })}>Review post to UFIconnect</button>}
        {center.id === 'cooking' && <button type="button" className="btn btn-ghost btn-sm" disabled={!ingredientRows.length} onClick={() => downloadText('ufi-shopping-list.txt', ingredientRows.map(row => row.amount + ' ' + row.unit + ' ' + row.name).join('\n'))}>Download shopping list</button>}
        {center.id === 'sports' && <button type="button" className="btn btn-ghost btn-sm" disabled={!draft.date} onClick={exportEvent}>Add to calendar</button>}
        {documents.some(item => item.id === draft.id) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
          if (!window.confirm('Delete this saved document?')) return;
          clearTimeout(saveTimer.current);
          if (stored.save({ documents: documents.filter(item => item.id !== draft.id), updatedAt: new Date().toISOString() })) { setDraft(newDraft()); setDirty(false); setNotice('Document deleted.'); }
        }}>Delete draft</button>}
      </div>
      <p className="local-muted" role="status">{stored.error || (dirty ? 'Saving…' : notice || 'Ready')} · {wordCount} words</p>
      {center.id === 'writing' && draft.body && <details className="center-article-preview"><summary>Preview article</summary><h2>{draft.title}</h2><div>{draft.body}</div></details>}
      {composer && <UfiFeedContent key={composer.key} embedded composeOnly initiallyOpen initialContent={composer.text} />}
    </section>
  </div>;
}
export default function WorkspaceCenter() {
  const { kind } = useParams();
  const { profile } = useAuth();
  const center = CENTERS.find(item => item.id === kind);
  if (!center) return <Layout><h1>Workspace not found</h1><Link to="/maps">Open your city</Link></Layout>;
  return <Layout wide><Helmet><title>{center.label} | UFIconnect</title><meta name="robots" content="noindex" /></Helmet>
    <div className="local-workspace"><header className="local-workspace-heading"><div><span className="local-eyebrow">MORE FROM YOUR WORLD</span><h1>{center.label}</h1><p>{center.description}</p></div><Link to="/maps" className="btn btn-ghost btn-sm">Your city</Link></header>
      <nav className="local-chip-row" aria-label="More workspaces">{CENTERS.map(item => <Link key={item.id} className={'search-filter-chip' + (item.id === kind ? ' active' : '')} to={item.route || '/centers/' + item.id}>{item.label}</Link>)}</nav>
      <div className="local-chip-row"><Link className="btn btn-ghost btn-sm" to={'/search?tab=posts&q=' + encodeURIComponent(center.topic)}>Explore {center.topic.toLowerCase()} posts</Link><Link className="btn btn-ghost btn-sm" to={'/search?tab=groups&q=' + encodeURIComponent(center.topic)}>Find a group</Link></div>
      {['monetization', 'deep-learning', 'source-analytics'].includes(kind) ? <SourceWorkspace key={profile.id + ':' + kind} kind={kind} accountId={profile.id} /> : kind === 'developer-analytics' ? <Analytics accountId={profile.id} /> : <DraftWorkspace key={profile.id + ':' + kind} center={center} accountId={profile.id} />}
    </div>
  </Layout>;
}
