import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Send, Save } from 'lucide-react';
import Layout from '../components/Layout';
import BusinessAccessNotice from '../components/BusinessAccessNotice';
import { isBusinessAccount } from '../businessAccount.mjs';
import ConfirmActionDialog from '../components/ConfirmActionDialog';
import { WritingArea, PhotoAttachment, PostPreview, downloadPostText } from '../components/PublishingComposer';
import { useAuth } from '../contexts/AuthContext';
import { privateSessionStorage } from '../auth/session';
import { uploadMedia } from '../api/upload';
import api from '../api/client';
import './BusinessIndustries.css';

const EMPTY = { title: '', content: '', mediaUrl: '' };
const message = (error, fallback) => error.response?.data?.message || fallback;
const destination = platform => platform === 'uficonnect' ? 'UFIconnect' : 'LinkedIn';
const postDetails = post => ({ title: post.title, content: post.content.startsWith(post.title + '\n\n') ? post.content.slice(post.title.length + 2) : post.content, mediaUrl: post.mediaUrl || '' });
const statusLabels = { all: 'All posts', draft: 'My private drafts', published: 'Published', partial: 'Partly published', failed: 'Failed', unconfirmed: 'Delivery unconfirmed', processing: 'Processing' };
function readDraft(key) {
  try {
    const value = JSON.parse(privateSessionStorage.getItem(key) || 'null');
    if (!value || !['title', 'content', 'mediaUrl'].every(field => typeof value.details?.[field] === 'string')) return null;
    return { details: value.details, targets: Array.isArray(value.targets) ? value.targets.filter(item => ['uficonnect', 'linkedin'].includes(item)) : [],
      request: value.request && typeof value.request.id === 'string' && typeof value.request.fingerprint === 'string' ? value.request : null };
  } catch { return null; }
}
function Outcomes({ targets = [] }) {
  return <div className="business-post-outcomes">{targets.map(target => <p key={target.platform}>
    <strong>{destination(target.platform)}: {target.status}</strong>{target.error && <span>{target.error}</span>}
    {target.postedUrl && <a href={target.postedUrl} target="_blank" rel="noopener noreferrer">View on {destination(target.platform)}</a>}
  </p>)}</div>;
}

function Composer({ profile, workspace, platforms, draft, onChanged, onReset }) {
  const key = `ufi_industry_draft:${profile.id}:${workspace.id}`;
  const [initial] = useState(() => draft ? { details: postDetails(draft), targets: [], request: null } : readDraft(key));
  const [details, setDetails] = useState(initial?.details || { ...EMPTY });
  const [targets, setTargets] = useState(initial?.targets || []);
  const [saved, setSaved] = useState(draft ? { id: draft.id, version: draft.version, details: postDetails(draft) } : null);
  const request = useRef(initial?.request || null), sending = useRef(false), photoRequest = useRef(0), mounted = useRef(true);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [result, setResult] = useState(null);
  const [uploading, setUploading] = useState(false), [progress, setProgress] = useState(0), [photoError, setPhotoError] = useState(''), [discard, setDiscard] = useState(false);
  const connected = Boolean(platforms?.connected?.linkedin && platforms?.platforms?.linkedin?.configured && platforms.platforms.linkedin.crossPost?.supported);
  const photos = platforms?.businessPublishing?.photos === true;
  const content = [details.title.trim(), details.content.trim()].filter(Boolean).join('\n\n');
  const valid = details.title.trim().length >= 3 && details.title.length <= 150 && details.content.trim().length >= 20 && content.length <= 2000 && (!details.mediaUrl || photos);
  const dirty = saved ? JSON.stringify(details) !== JSON.stringify(saved.details) : Boolean(details.title || details.content || details.mediaUrl);
  const locked = pending || Boolean(result);
  const canSave = valid && !pending && !uploading && !result;
  const media = details.mediaUrl ? { url: details.mediaUrl, type: 'image' } : null;
  function persist(nextDetails = details, nextTargets = targets) {
    // Server drafts have their own versioned record; local scratch space never
    // silently turns an edited saved draft into a second publication.
    if (saved) return;
    try { privateSessionStorage.setItem(key, JSON.stringify({ details: nextDetails, targets: nextTargets, request: request.current })); } catch { /* Server drafts remain available if device storage is full. */ }
  }
  useEffect(() => { persist(); }, [key, details, targets, saved]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; photoRequest.current++; }; }, []);
  function edit(field, value) { request.current = null; setDetails(old => ({ ...old, [field]: value })); setResult(null); setNotice(''); }
  function toggle(platform, checked) { request.current = null; setTargets(old => checked ? [...new Set([...old, platform])] : old.filter(item => item !== platform)); setNotice(''); }
  async function submit(publish) {
    if (!canSave || sending.current || (publish && (!targets.length || saved && dirty || targets.includes('linkedin') && !connected))) return;
    const selected = publish ? targets : [];
    const payload = saved && publish ? { version: saved.version, targets: selected, publicConfirmed: selected.includes('uficonnect') }
      : { ...details, targets: selected, publicConfirmed: selected.includes('uficonnect') };
    const fingerprint = JSON.stringify({ savedId: saved?.id || null, ...payload });
    if (request.current?.fingerprint !== fingerprint) request.current = { id: crypto.randomUUID(), fingerprint };
    persist(details, selected); sending.current = true; setPending(true); setError(''); setNotice('');
    try {
      const endpoint = `/business/industries/${workspace.id}/posts`;
      const { data } = saved
        ? publish ? await api.post(`${endpoint}/${saved.id}/publish`, { ...payload, requestId: request.current.id })
          : await api.patch(`${endpoint}/${saved.id}`, { version: saved.version, ...details })
        : await api.post(endpoint, { ...payload, requestId: request.current.id });
      if (!mounted.current) return;
      if (data.status === 'draft') {
        const next = postDetails(data);
        setSaved({ id: data.id, version: data.version, details: next }); setDetails(next); request.current = null;
        privateSessionStorage.removeItem(key); setNotice(saved ? 'Draft changes saved.' : 'Your private draft is saved in this space.');
      } else {
        setResult(data); privateSessionStorage.removeItem(key);
        setNotice(data.status === 'published' ? 'Published to every selected destination.' : 'Review delivery below. Refresh the history before attempting another post.');
      }
      onChanged(data);
    } catch (err) { if (mounted.current) setError(message(err, 'Delivery could not be confirmed. Retry the unchanged request to check its saved status.')); }
    finally { sending.current = false; if (mounted.current) setPending(false); }
  }
  async function addPhoto(file) {
    if (!photos || locked || uploading || !file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setPhotoError('Choose a JPG, PNG or WebP photo smaller than 10 MB.'); return; }
    const current = ++photoRequest.current; setUploading(true); setPhotoError(''); setProgress(0);
    try { const uploaded = await uploadMedia(file, value => { if (current === photoRequest.current) setProgress(value); }, 'crossposts'); if (current === photoRequest.current) edit('mediaUrl', uploaded.url); }
    catch (err) { if (current === photoRequest.current) setPhotoError(message(err, 'Could not upload this photo.')); }
    finally { if (current === photoRequest.current) setUploading(false); }
  }
  function reset() { privateSessionStorage.removeItem(key); onReset(); }
  async function copy() {
    try { await navigator.clipboard.writeText(content); setNotice('Post text copied.'); } catch { setError('Select the preview text to copy it.'); }
  }
  return <>
    {error && <p role="alert" className="business-post-alert">{error}</p>}{notice && <p role="status" className="business-post-notice">{notice}</p>}
    <div className="industry-composer">
      <form className="business-post-panel industry-compose-form" onSubmit={event => { event.preventDefault(); void submit(true); }}>
        <h2>{saved ? 'Edit private draft' : 'Business update'}</h2>
        <label className="business-post-field">Post title<input required value={details.title} maxLength={150} disabled={locked} onChange={event => edit('title', event.target.value)} placeholder="What’s new with your team?" /></label>
        <WritingArea label="Business update text" value={details.content} onChange={value => edit('content', value)} maxLength={2000} rows={8} disabled={locked} placeholder="Share a hiring update, team project, event or useful industry insight." />
        <PhotoAttachment media={media} onFile={addPhoto} onRemove={() => edit('mediaUrl', '')} busy={uploading} disabled={locked || !photos} progress={progress} error={photoError} />
        {!photos && <p className="business-post-muted">Photo publishing is unavailable until account capabilities finish loading. Text publishing to UFIconnect is available.</p>}
        <p className={content.length > 2000 ? 'business-post-alert' : 'business-post-muted'}>{content.length.toLocaleString()} / 2,000 characters including the title</p>
        <fieldset className="business-post-targets industry-targets"><legend>Choose where to publish</legend>
          <label><input type="checkbox" checked={targets.includes('uficonnect')} disabled={locked} onChange={event => toggle('uficonnect', event.target.checked)} /><span>UFIconnect — public post<small>I want this post visible in the public UFI feed, under my own profile.</small></span></label>
          <label><input type="checkbox" checked={targets.includes('linkedin')} disabled={locked || !connected} onChange={event => toggle('linkedin', event.target.checked)} /><span>LinkedIn<small>{connected ? 'Publish to your connected LinkedIn profile.' : 'Connect LinkedIn with permission to share posts.'}</small></span></label>
          {!connected && <Link to="/connected-accounts">Manage your LinkedIn connection</Link>}
        </fieldset>
        <p className="industry-public-note">Your saved drafts are private to you. Published updates go only to the destinations you select, and delivery history is shared with your Business team.</p>
        {saved && dirty && !result && <p role="status" className="business-post-muted">Save your draft changes before publishing.</p>}
        <div className="business-post-buttons">
          <button type="submit" className="btn btn-primary" disabled={!canSave || !targets.length || Boolean(saved && dirty) || targets.includes('linkedin') && !connected}><Send size={16} />{pending ? 'Saving…' : 'Publish business update'}</button>
          <button type="button" className="btn btn-outline" disabled={!canSave || Boolean(saved && !dirty)} onClick={() => submit(false)}><Save size={16} />{saved ? 'Save draft changes' : 'Save private draft'}</button>
          <button type="button" className="btn btn-ghost" disabled={pending || uploading} onClick={() => dirty && !result ? setDiscard(true) : reset()}>Start a new post</button>
        </div>
        {result && <><Outcomes targets={result.targets} /><p>Saved in the history below. Refresh history for the latest delivery status. Published or uncertain deliveries cannot be edited or sent again here.</p></>}
      </form>
      <PostPreview content={content} media={media} name={profile.name} subtitle={workspace.name} destinations={targets.map(destination)} onCopy={copy} onDownload={value => downloadPostText(value, 'uficonnect-business-update.txt')} />
    </div>
    {discard && <ConfirmActionDialog title="Discard unsaved changes?" confirmLabel="Discard changes" pendingLabel="Discarding…" onClose={() => setDiscard(false)} onConfirm={reset}><p>Your unsaved changes will be removed. Any draft already saved in the history will stay there.</p></ConfirmActionDialog>}
  </>;
}

export default function BusinessIndustryCrossPost() {
  const { profile } = useAuth();
  return <CrossPostWorkspace key={`${profile?.id || 'guest'}:${profile?.plan || 'free'}`} profile={profile} />;
}

function CrossPostWorkspace({ profile }) {
  const [search, setSearch] = useSearchParams();
  const [data, setData] = useState(null), [platforms, setPlatforms] = useState(null), [error, setError] = useState(''), [capabilityWarning, setCapabilityWarning] = useState('');
  const [history, setHistory] = useState(null), [historyError, setHistoryError] = useState(''), [page, setPage] = useState(1), [status, setStatus] = useState('all'), [reload, setReload] = useState(0), [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState(null), [revision, setRevision] = useState(0), [deleting, setDeleting] = useState(null), [activeDraftId, setActiveDraftId] = useState(null);
  useEffect(() => {
    if (!isBusinessAccount(profile) || profile?.plan !== 'business') return; let active = true; setError('');
    api.get('/business/industries').then(({ data: result }) => { if (active) setData(result); }).catch(err => { if (active) setError(message(err, 'Could not load your industry spaces.')); });
    api.get('/social/platforms').then(({ data: result }) => { if (active) { setPlatforms(result); setCapabilityWarning(''); } }).catch(() => { if (active) setCapabilityWarning('Could not check LinkedIn or photo publishing. Text drafts and UFIconnect text posts remain available.'); });
    return () => { active = false; };
  }, [profile?.id, profile?.plan, reload]);
  const requested = search.get('workspace');
  const workspace = data?.workspaces.find(item => item.id === requested) || (!requested ? data?.workspaces.find(item => !item.archivedAt) : null);
  useEffect(() => { setPage(1); setStatus('all'); setEditing(null); setDeleting(null); setActiveDraftId(null); }, [workspace?.id]);
  useEffect(() => {
    if (!workspace) return; let active = true; setHistory(null); setHistoryError('');
    api.get(`/business/industries/${workspace.id}/posts`, { params: { page, status } }).then(({ data: result }) => {
      if (!active) return;
      if (!result.posts.length && page > 1) { setPage(value => value - 1); return; }
      setHistory(result);
      // A teammate may archive a space while this page is open.
      if (result.workspace) setData(old => ({ ...old, workspaces: old.workspaces.map(space => space.id === result.workspace.id ? result.workspace : space) }));
    }).catch(err => { if (active) setHistoryError(message(err, 'Could not load this space’s posts.')); });
    return () => { active = false; };
  }, [workspace?.id, page, status, refresh]);
  function resetComposer() { setEditing(null); setActiveDraftId(null); setRevision(value => value + 1); }
  function changed(post) { setActiveDraftId(post?.status === 'draft' ? post.id : null); setPage(1); setRefresh(value => value + 1); }
  async function deleteDraft() {
    await api.delete(`/business/industries/${workspace.id}/posts/${deleting.id}`, { data: { version: deleting.version } });
    if (editing?.id === deleting.id || activeDraftId === deleting.id) resetComposer();
    setDeleting(null); setRefresh(value => value + 1);
  }
  if (!isBusinessAccount(profile) || profile?.plan !== 'business') return <Layout><BusinessAccessNotice title="Business cross-posting" /></Layout>;
  return <Layout>
    <Helmet><title>Business cross post | UFIconnect</title><meta name="robots" content="noindex" /></Helmet>
    <header className="recruiting-heading"><span className="recruiting-eyebrow">Business publishing</span><h1>Cross Post</h1><p>Prepare updates in an industry space, save private drafts, choose destinations and review delivery for each account.</p>
      <div className="industry-actions"><Link className="btn btn-outline btn-sm" to="/business/industries">Manage industry spaces</Link><Link className="btn btn-ghost btn-sm" to="/career-posts">Write a hiring post</Link><Link className="btn btn-ghost btn-sm" to="/jobs/new">Post a job</Link></div></header>
    {error && <p role="alert" className="business-post-alert">{error} <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReload(value => value + 1)}>Try again</button></p>}
    {capabilityWarning && <p role="status" className="business-post-muted">{capabilityWarning} <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReload(value => value + 1)}>Check connections again</button></p>}
    {!data && !error && <p role="status">Loading your Business spaces…</p>}
    {data && !data.workspaces.length && <section className="business-post-panel"><h2>Create an industry space first</h2><p>{data.canManage ? 'Choose an industry and its resources to keep your business updates organized.' : 'Ask your Business membership owner to create a space for your team.'}</p><Link className="btn btn-primary" to="/business/industries">Open industry spaces</Link></section>}
    {data?.workspaces.length > 0 && <div className="industry-context"><label className="business-post-field">Industry space<select value={workspace?.id || ''} onChange={event => { setPage(1); setSearch({ workspace: event.target.value }); }}>
      {!workspace && <option value="">Choose an available space</option>}{data.workspaces.map(item => <option value={item.id} key={item.id}>{item.name}{item.archivedAt ? ' (archived)' : ''}</option>)}</select></label>
      {requested && !workspace && <p role="alert">This space is not available to your Business membership.</p>}</div>}
    {workspace && <>
      {workspace.archivedAt ? <p role="status" className="industry-archive-note">This space is archived. Its history is available below. The membership owner can restore it from Industry spaces before new posts or draft edits.</p>
        : <div id="industry-composer"><Composer key={`${profile.id}:${workspace.id}:${editing?.id || 'new'}:${revision}`} profile={profile} workspace={workspace} platforms={platforms} draft={editing} onChanged={changed} onReset={resetComposer} /></div>}
      <section className="business-post-panel industry-history" aria-label="Industry post history"><h2>{workspace.name} — post history</h2><p>Published updates are shared with your Business team. Only you can see your private drafts. External reactions are available on the source platform.</p>
        <div className="industry-history-tools"><label className="business-post-field">Post status<select aria-label="Post status" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><button type="button" className="btn btn-outline btn-sm" disabled={!history && !historyError} onClick={() => setRefresh(value => value + 1)}>Refresh history</button></div>
        {historyError && <p role="alert">{historyError} <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefresh(value => value + 1)}>Try again</button></p>}
        {!history && !historyError && <p role="status">Loading posts…</p>}
        {history?.posts.length === 0 && <p>No {status === 'draft' ? 'private drafts' : 'posts'} match this filter.</p>}
        {history?.posts.map(post => <article className="industry-history-card" key={post.id}><h3>{post.title}</h3><small>{statusLabels[post.status] || post.status} · {post.authorName || (post.authorId === profile.id ? profile.name : 'Team member')} · {new Date(post.updatedAt || post.createdAt).toLocaleString()}</small><pre>{post.content}</pre>{post.mediaUrl && <img src={post.mediaUrl} alt="Business post attachment" loading="lazy" />}<Outcomes targets={post.targets} />
          {post.canEdit && <div className="industry-actions"><button type="button" className="btn btn-outline btn-sm" disabled={Boolean(workspace.archivedAt)} onClick={() => { setEditing(post); setRevision(value => value + 1); document.getElementById('industry-composer')?.scrollIntoView({ block: 'start' }); }}>Edit draft</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleting(post)}>Delete draft</button></div>}
          {['processing', 'unconfirmed', 'partial', 'failed'].includes(post.status) && <p className="business-post-muted">Refresh history and check the selected destinations before creating another copy. Existing successful or uncertain deliveries are never resent here. <Link to="/connected-accounts">Review connections</Link></p>}
        </article>)}
        {history && <nav className="industry-history-pager" aria-label="Industry post history pages"><button type="button" className="btn btn-outline btn-sm" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button type="button" className="btn btn-outline btn-sm" disabled={!history.hasMore} onClick={() => setPage(value => value + 1)}>Next</button></nav>}
      </section>
    </>}
    {deleting && <ConfirmActionDialog title="Delete private draft?" confirmLabel="Delete draft" onClose={() => setDeleting(null)} onConfirm={deleteDraft}><p>Delete “{deleting.title}”? It has not been published to any destination. This cannot be undone.</p></ConfirmActionDialog>}
  </Layout>;
}
