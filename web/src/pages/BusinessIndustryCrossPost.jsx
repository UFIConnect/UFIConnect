import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Send, Save } from 'lucide-react';
import Layout from '../components/Layout';
import { WritingArea, PhotoAttachment, PostPreview, downloadPostText } from '../components/PublishingComposer';
import { useAuth } from '../contexts/AuthContext';
import { privateSessionStorage } from '../auth/session';
import { uploadMedia } from '../api/upload';
import api from '../api/client';
import './BusinessIndustries.css';

const EMPTY = {title:'',content:'',mediaUrl:''};
const message = (error,fallback) => error.response?.data?.message || fallback;
function readDraft(key) {
  try {
    const value = JSON.parse(privateSessionStorage.getItem(key) || 'null');
    if (!value || !['title','content','mediaUrl'].every(field => typeof value.details?.[field] === 'string')) return null;
    return { details:value.details, targets:Array.isArray(value.targets) ? value.targets.filter(item => ['uficonnect','linkedin'].includes(item)) : [],
      request:value.request && typeof value.request.id === 'string' && typeof value.request.fingerprint === 'string' ? value.request : null };
  } catch { return null; }
}
const destination = platform => platform === 'uficonnect' ? 'UFIconnect' : 'LinkedIn';
function Outcomes({targets}) {
  return <div className="business-post-outcomes">{targets.map(target => <p key={target.platform}>
    <strong>{destination(target.platform)}: {target.status}</strong>{target.error && <span>{target.error}</span>}
    {target.postedUrl && <a href={target.postedUrl} target="_blank" rel="noopener noreferrer">View on {destination(target.platform)}</a>}
  </p>)}</div>;
}

function Composer({profile,workspace,platforms,onPublished,prefill}) {
  const key = `ufi_industry_draft:${profile.id}:${workspace.id}`;
  const [initial] = useState(() => prefill ? {details:prefill,targets:[],request:null} : readDraft(key));
  const [details,setDetails] = useState(initial?.details || EMPTY), [targets,setTargets] = useState(initial?.targets || []);
  const request = useRef(initial?.request || null), sending = useRef(false), photoRequest = useRef(0);
  const [pending,setPending] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState(''), [result,setResult] = useState(null);
  const [uploading,setUploading] = useState(false), [progress,setProgress] = useState(0), [photoError,setPhotoError] = useState('');
  const connected = Boolean(platforms?.connected?.linkedin && platforms?.platforms?.linkedin?.configured && platforms.platforms.linkedin.crossPost?.supported);
  const photos = platforms?.businessPublishing?.photos === true;
  const content = [details.title.trim(),details.content.trim()].filter(Boolean).join('\n\n');
  const canSave = details.title.trim().length >= 3 && details.title.length <= 150 && details.content.trim().length >= 20 && content.length <= 2000 && (!details.mediaUrl || photos) && !pending && !uploading;
  const media = details.mediaUrl ? {url:details.mediaUrl,type:'image'} : null;
  function persist(nextDetails=details,nextTargets=targets) {
    try { privateSessionStorage.setItem(key,JSON.stringify({details:nextDetails,targets:nextTargets,request:request.current})); } catch { /* Server-saved drafts remain available if private device storage is full. */ }
  }
  useEffect(() => { persist(); }, [key,details,targets]);
  useEffect(() => () => { photoRequest.current++; }, []);
  function edit(field,value) { request.current=null;setDetails(old => ({...old,[field]:value}));setResult(null);setNotice(''); }
  function toggle(platform,checked) { request.current=null;setTargets(old => checked ? [...new Set([...old,platform])] : old.filter(item => item!==platform));setResult(null);setNotice(''); }
  async function submit(publish) {
    if (!canSave || sending.current || (publish && (!targets.length || targets.includes('linkedin') && !connected))) return;
    const selected = publish ? targets : [];
    const payload = {...details,targets:selected,publicConfirmed:selected.includes('uficonnect')};
    const fingerprint = JSON.stringify(payload);
    if (request.current?.fingerprint !== fingerprint) request.current={id:crypto.randomUUID(),fingerprint};
    persist(details,selected);sending.current=true;setPending(true);setError('');setNotice('');
    try {
      const {data} = await api.post(`/business/industries/${workspace.id}/posts`,{...payload,requestId:request.current.id});
      setResult(data);
      setNotice(data.status === 'draft' ? 'Your private draft is saved in this space.' : data.status === 'published' ? 'Published to every selected destination.' : 'Review each destination’s delivery status before creating another post.');
      onPublished();
    } catch (err) { setError(message(err,'Delivery could not be confirmed. Retry the unchanged post to check its saved status.')); }
    finally { sending.current=false;setPending(false); }
  }
  async function addPhoto(file) {
    if (!photos || pending || uploading || !file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 10*1024*1024) { setPhotoError('Choose a JPG, PNG or WebP photo smaller than 10 MB.');return; }
    const current = ++photoRequest.current;setUploading(true);setPhotoError('');setProgress(0);
    try { const uploaded=await uploadMedia(file,value => {if(current===photoRequest.current)setProgress(value);},'crossposts');if(current===photoRequest.current)edit('mediaUrl',uploaded.url); }
    catch(err) { if(current===photoRequest.current)setPhotoError(message(err,'Could not upload this photo.')); }
    finally { if(current===photoRequest.current)setUploading(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(content);setNotice('Post text copied.'); } catch { setError('Select the preview text to copy it.'); }
  }
  return <>
    {error && <p role="alert" className="business-post-alert">{error}</p>}{notice && <p role="status" className="business-post-notice">{notice}</p>}
    <div className="industry-composer">
      <form className="business-post-panel industry-compose-form" onSubmit={event => {event.preventDefault();void submit(true);}}>
        <h2>Business update</h2>
        <label className="business-post-field">Post title<input required value={details.title} maxLength={150} disabled={pending || Boolean(result)} onChange={event => edit('title',event.target.value)} placeholder="What’s new with your team?" /></label>
        <WritingArea label="Business update text" value={details.content} onChange={value => edit('content',value)} maxLength={2000} rows={8} disabled={pending || Boolean(result)} placeholder="Share a product update, project, event or useful insight." />
        <PhotoAttachment media={media} onFile={addPhoto} onRemove={() => edit('mediaUrl','')} busy={uploading} disabled={pending || Boolean(result) || !photos} progress={progress} error={photoError} />
        {!photos && <p className="business-post-muted">Photo publishing is unavailable until account capabilities finish loading. Text publishing to UFIconnect is available.</p>}
        <p className={content.length > 2000 ? 'business-post-alert' : 'business-post-muted'}>{content.length.toLocaleString()} / 2,000 characters including the title</p>
        <fieldset className="business-post-targets industry-targets"><legend>Choose where to publish</legend>
          <label><input type="checkbox" checked={targets.includes('uficonnect')} disabled={pending || Boolean(result)} onChange={event => toggle('uficonnect',event.target.checked)} /><span>UFIconnect — public post<small>I want this post visible in the public UFI feed, under my own profile.</small></span></label>
          <label><input type="checkbox" checked={targets.includes('linkedin')} disabled={pending || Boolean(result) || !connected} onChange={event => toggle('linkedin',event.target.checked)} /><span>LinkedIn<small>{connected ? 'Publish to your connected LinkedIn profile.' : 'Connect LinkedIn with permission to share posts.'}</small></span></label>
          {!connected && <Link to="/connected-accounts">Manage your LinkedIn connection</Link>}
        </fieldset>
        <p className="industry-public-note">Your space settings stay with your Business team. A published post goes to the destinations you select. Your saved drafts are private to you.</p>
        <div className="business-post-buttons"><button type="submit" className="btn btn-primary" disabled={!canSave || !targets.length || Boolean(result) || targets.includes('linkedin') && !connected}><Send size={16} />{pending ? 'Saving…' : 'Publish business update'}</button>
          <button type="button" className="btn btn-outline" disabled={!canSave || Boolean(result)} onClick={() => submit(false)}><Save size={16} />Save private draft</button>
          <button type="button" className="btn btn-ghost" disabled={pending || uploading} onClick={() => {request.current=null;setDetails({...EMPTY});setTargets([]);setResult(null);setError('');setNotice('');setPhotoError('');}}>Start a new post</button></div>
        {result && <><Outcomes targets={result.targets} /><p>Saved in the space history below. Start a new post to write another update.</p></>}
      </form>
      <PostPreview content={content} media={media} name={profile.name} subtitle={workspace.name} destinations={targets.map(destination)} onCopy={copy} onDownload={value => downloadPostText(value,'uficonnect-business-update.txt')} />
    </div>
  </>;
}

export default function BusinessIndustryCrossPost() {
  const {profile}=useAuth();const [search,setSearch]=useSearchParams();
  const [data,setData]=useState(null),[platforms,setPlatforms]=useState(null),[error,setError]=useState(''),[capabilityWarning,setCapabilityWarning]=useState('');
  const [history,setHistory]=useState(null),[historyError,setHistoryError]=useState(''),[page,setPage]=useState(1),[reload,setReload]=useState(0),[refresh,setRefresh]=useState(0);
  const [reuse,setReuse]=useState(null);
  useEffect(() => {
    if(profile?.plan!=='business')return;let active=true;setError('');
    api.get('/business/industries').then(({data:result})=>{if(active)setData(result);}).catch(err=>{if(active)setError(message(err,'Could not load your industry spaces.'));});
    api.get('/social/platforms').then(({data:result})=>{if(active){setPlatforms(result);setCapabilityWarning('');}}).catch(()=>{if(active)setCapabilityWarning('Could not check LinkedIn or photo publishing. You can still save a text draft or publish text to UFIconnect.');});
    return()=>{active=false;};
  },[profile?.id,profile?.plan,reload]);
  const requested=search.get('workspace');
  const workspace=data?.workspaces.find(item=>item.id===requested) || (!requested ? data?.workspaces[0] : null);
  useEffect(()=>{setPage(1);setReuse(null);},[workspace?.id]);
  useEffect(()=>{
    if(!workspace)return;let active=true;setHistory(null);setHistoryError('');
    api.get(`/business/industries/${workspace.id}/posts`,{params:{page}}).then(({data:result})=>{if(active)setHistory(result);})
      .catch(err=>{if(active)setHistoryError(message(err,'Could not load this space’s posts.'));});
    return()=>{active=false;};
  },[workspace?.id,page,refresh]);
  if(profile?.plan!=='business')return <Navigate to="/settings" replace />;
  return <Layout>
    <Helmet><title>Business cross post | UFIconnect</title><meta name="robots" content="noindex" /></Helmet>
    <header className="recruiting-heading"><span className="recruiting-eyebrow">Business publishing</span><h1>Cross Post</h1><p>Share business updates from an industry space. Choose your destinations, preview the post and review delivery for each account.</p>
      <div className="industry-actions"><Link className="btn btn-outline btn-sm" to="/business/industries">Manage industry spaces</Link><Link className="btn btn-ghost btn-sm" to="/career-posts">Write a hiring post</Link></div></header>
    {error && <p role="alert" className="business-post-alert">{error} <button type="button" className="btn btn-ghost btn-sm" onClick={()=>setReload(value=>value+1)}>Try again</button></p>}
    {capabilityWarning && <p role="status" className="business-post-muted">{capabilityWarning}</p>}
    {!data && !error && <p role="status">Loading your Business spaces…</p>}
    {data && !data.workspaces.length && <section className="business-post-panel"><h2>Create an industry space first</h2><p>{data.canManage ? 'Choose an industry and its resources to keep your business updates organized.' : 'Ask your Business membership owner to create a space for your team.'}</p><Link className="btn btn-primary" to="/business/industries">Open industry spaces</Link></section>}
    {data?.workspaces.length > 0 && <div className="industry-context"><label className="business-post-field">Industry space<select value={workspace?.id || ''} onChange={event=>{setPage(1);setSearch({workspace:event.target.value});}}>
      {!workspace && <option value="">Choose an available space</option>}{data.workspaces.map(item=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      {requested && !workspace && <p role="alert">This space is not available to your Business membership.</p>}</div>}
    {workspace && <>
      <div id="industry-composer"><Composer key={`${profile.id}:${workspace.id}:${reuse?.revision || 0}`} profile={profile} workspace={workspace} platforms={platforms} prefill={reuse?.details} onPublished={()=>{setPage(1);setRefresh(value=>value+1);}} /></div>
      <section className="business-post-panel industry-history" aria-label="Industry post history"><h2>{workspace.name} — post history</h2><p>Published updates are shared with your Business team. Only you can see your private drafts. External reactions are available on the source platform.</p>
        {historyError && <p role="alert">{historyError} <button className="btn btn-ghost btn-sm" onClick={()=>setRefresh(value=>value+1)}>Try again</button></p>}
        {!history && !historyError && <p role="status">Loading posts…</p>}
        {history?.posts.length === 0 && <p>No posts on this page yet.</p>}
        {history?.posts.map(post=><article className="industry-history-card" key={post.id}><h3>{post.title}</h3><small>{post.status} · {new Date(post.createdAt).toLocaleString()}</small><pre>{post.content}</pre>{post.mediaUrl && <img src={post.mediaUrl} alt="Business post attachment" loading="lazy" />}<Outcomes targets={post.targets} />
          {post.status==='draft' && <><p className="business-post-muted">Private draft. Use it to prepare a new update; this saved copy stays in your history.</p>
            <button type="button" className="btn btn-outline btn-sm" onClick={()=>{setReuse(old=>({revision:(old?.revision || 0)+1,details:{title:post.title,content:post.content.startsWith(post.title+'\n\n')?post.content.slice(post.title.length+2):post.content,mediaUrl:post.mediaUrl || ''}}));document.getElementById('industry-composer')?.scrollIntoView({block:'start',behavior:'smooth'});}}>Use this draft</button></>}</article>)}
        {history && <nav className="industry-history-pager" aria-label="Industry post history pages"><button className="btn btn-outline btn-sm" disabled={page===1} onClick={()=>setPage(value=>value-1)}>Previous</button><span>Page {page}</span><button className="btn btn-outline btn-sm" disabled={!history.hasMore} onClick={()=>setPage(value=>value+1)}>Next</button></nav>}
      </section>
    </>}
  </Layout>;
}
