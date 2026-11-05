import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Copy, Send, Save, ArrowRight } from 'lucide-react';
import Layout from '../components/Layout';
import BusinessAccessNotice from '../components/BusinessAccessNotice';
import { isBusinessAccount } from '../businessAccount.mjs';
import './CommandCenterPlatforms.css';
import SourceButton from '../components/SourceButton';
import ExternalAccountLogin from '../components/ExternalAccountLogin';
import { WritingArea, PhotoAttachment, PostPreview, downloadPostText } from '../components/PublishingComposer';
import { privateSessionStorage } from '../auth/session';
import { uploadMedia } from '../api/upload';
import directory from '../../../backend/account-directory.json';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const empty = company => ({ title: '', company: company || '', location: '', pay: '', description: '', duties: '', requirements: '', applyUrl: '', mediaUrl: '' });
function initialDraft(profile) {
  const defaults = empty(profile?.organization);
  try {
    const key = `ufi_business_post_draft:${profile?.id}`;
    const saved = JSON.parse(privateSessionStorage.getItem(key) || sessionStorage.getItem(key) || 'null');
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, typeof saved?.[key] === 'string' ? saved[key] : value]));
  } catch { return defaults; }
}
export function hiringPostText(details) {
  const bullets = value => value.split(/\n+/).map(line => line.replace(/^(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).map(line => `- ${line}`).join('\n');
  return [details.title.trim(), details.company.trim(), details.location.trim() && `Location: ${details.location.trim()}`,
    details.pay.trim() && `Pay: ${details.pay.trim()}`, details.description.trim(),
    details.duties.trim() && `Responsibilities\n${bullets(details.duties)}`,
    details.requirements.trim() && `Requirements\n${bullets(details.requirements)}`,
    details.applyUrl.trim() && `Apply: ${details.applyUrl.trim()}`].filter(Boolean).join('\n\n');
}
export default function BusinessCrossPost() {
  const { profile } = useAuth();
  if (!isBusinessAccount(profile) || profile?.plan !== 'business') return <Layout><BusinessAccessNotice title="Hiring Cross Post" /></Layout>;
  return <BusinessCrossPostContent key={profile.id} profile={profile} />;
}

function BusinessCrossPostContent({ profile }) {
  const [details, setDetails] = useState(() => initialDraft(profile));
  const [catalog, setCatalog] = useState(null);
  const [selected, setSelected] = useState(['uficonnect']);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [photoError, setPhotoError] = useState('');
  const [photoName, setPhotoName] = useState('');
  const request = useRef(null);
  const sending = useRef(false);
  const photoRequest = useRef(0);
  useEffect(() => { let active = true; api.get('/social/platforms').then(({ data }) => { if (active) setCatalog(data); }).catch(() => { if (active) setError('Could not check LinkedIn availability. UFIConnect publishing remains available.'); }); return () => { active = false; }; }, []);
  useEffect(() => {
    const key = `ufi_business_post_draft:${profile?.id}`;
    sessionStorage.removeItem(key);
    if (details.title || details.description || details.mediaUrl) privateSessionStorage.setItem(key, JSON.stringify(details));
    else privateSessionStorage.removeItem(key);
  }, [profile?.id, details]);
  useEffect(() => () => {
    photoRequest.current++;
  }, [profile?.id]);
  const content = hiringPostText(details);
  const linkedInReady = catalog?.connected?.linkedin && catalog?.platforms?.linkedin?.configured && catalog.platforms.linkedin.crossPost?.supported;
  const photosSupported = catalog?.businessPublishing?.photos === true;
  const canSave = details.title.trim().length >= 3 && details.description.trim().length >= 20 && content.length <= 2000 && !uploading && (!details.mediaUrl || photosSupported) && !Object.entries(details).some(([key,value]) => ['description','duties','requirements'].includes(key) && value.length > 1500);
  const media = details.mediaUrl ? { url: details.mediaUrl, type: 'image', name: photoName } : null;
  const careers = Object.entries(directory).filter(([, entry]) => entry.category === 'career' && entry.name.toLowerCase().includes(search.toLowerCase()));
  const update = (key, value) => { setDetails(old => ({ ...old, [key]: value })); request.current = null; setResult(null); setNotice(''); };
  async function submit(publish) {
    if (!canSave || sending.current || (publish && !selected.length)) return;
    sending.current = true;
    setPending(true); setError(''); setNotice('');
    const targets = publish ? selected : [];
    const fingerprint = JSON.stringify({ details, targets });
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const { data } = await api.post('/business/posts', { details, targets, requestId: request.current.id });
      setResult(data);
      setNotice(data.status === 'draft' ? 'Draft saved. You can find it in Posts & comparisons.' : data.status === 'processing' ? 'Delivery is still being confirmed. Check Posts & comparisons before trying again.' : data.status === 'published' ? 'Your hiring post was published. Review each destination below.' : 'Delivery failed. Review the destination message before trying again.');
    } catch (err) { setError(err.response?.data?.message || 'The request could not be confirmed. Retry without changing the draft to check its status.'); }
    finally { sending.current = false; setPending(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(content); setNotice('Hiring post copied. Paste it into the career site’s job posting form.'); }
    catch { setError('Clipboard access was unavailable. Select and copy the post preview.'); }
  }
  async function addPhoto(file) {
    if (!file || uploading || pending || !photosSupported) return;
    if (!file.type.startsWith('image/')) { setPhotoError('Choose a photo file.'); return; }
    if (file.size > 10 * 1024 * 1024) { setPhotoError('Choose a photo smaller than 10 MB.'); return; }
    const id = ++photoRequest.current;
    setUploading(true); setUploadProgress(0); setPhotoError('');
    try {
      const uploaded = await uploadMedia(file, progress => { if (id === photoRequest.current) setUploadProgress(progress); }, 'crossposts');
      if (id === photoRequest.current) { update('mediaUrl', uploaded.url); setPhotoName(file.name); }
    } catch (err) { if (id === photoRequest.current) setPhotoError(err.response?.data?.message || err.message || 'Could not upload the photo.'); }
    finally { if (id === photoRequest.current) setUploading(false); }
  }
  const field = (key, label, options = {}) => options.multiline
    ? <WritingArea value={details[key]} onChange={value => update(key, value)} label={label} rows={options.rows || 4} maxLength={1500} disabled={pending} placeholder={options.placeholder} />
    : <label className="business-post-field">{label}<input type={options.type || 'text'} value={details[key]} onChange={event => update(key, event.target.value)} maxLength={key === 'applyUrl' ? 500 : 150} disabled={pending} placeholder={options.placeholder} /></label>;
  return <Layout>
    <Helmet><title>Cross Post | UFIConnect Business</title><meta name="robots" content="noindex" /></Helmet>
    <header className="recruiting-heading"><span className="recruiting-eyebrow">Business publishing</span><h1>Cross Post</h1>
      <p>Write a hiring post once. Publish it to UFIConnect and your connected LinkedIn account, or copy it to a career site’s posting form.</p>
      <Link className="btn btn-outline btn-sm" to="/business-posts">Posts & comparisons <ArrowRight size={16} /></Link>
    </header>
    {error && <div className="business-post-alert" role="alert">{error}</div>}
    {notice && <p className="business-post-notice" role="status">{notice}</p>}
    <div className="business-compose-grid">
      <form className="business-post-panel publish-business-form" onSubmit={event => { event.preventDefault(); void submit(true); }}>
        <div className="publish-section-heading"><h2>Hiring post</h2><span>Write · attach · publish</span></div>
        <div className="business-post-fields">{field('title', 'Role title', { placeholder: 'Senior software engineer' })}{field('company', 'Company')}
          {field('location', 'Location & work arrangement', { placeholder: 'Los Angeles, CA · Hybrid' })}{field('pay', 'Pay range', { placeholder: '$120,000–$160,000/year' })}</div>
        {field('description', 'Role description', { multiline: true, placeholder: 'Describe the team, the purpose of the role and its main responsibilities.' })}
        {field('duties', 'Responsibilities — one per line', { multiline: true, rows: 3 })}
        {field('requirements', 'Requirements — one per line', { multiline: true, rows: 3 })}
        {field('applyUrl', 'Application link (optional)', { type: 'url' })}
        <PhotoAttachment media={media} onFile={addPhoto} onRemove={() => { update('mediaUrl', ''); setPhotoName(''); setPhotoError(''); }} busy={uploading} disabled={pending || !photosSupported} progress={uploadProgress} error={photoError} />
        {!photosSupported && <p className="business-post-muted">{catalog ? 'Photo publishing is currently unavailable. You can still publish a text post.' : 'Checking photo publishing availability…'}</p>}
        <p className={content.length > 2000 ? 'business-post-alert' : 'business-post-muted'}>{content.length.toLocaleString()} / 2,000 characters, including headings</p>
        <fieldset className="business-post-targets"><legend>Publish destinations</legend>
          <SourceButton source="uficonnect" label="UFIConnect" connected selected={selected.includes('uficonnect')} disabled={pending} reason="Public hiring post in the UFI feed" onClick={() => { setSelected(old => old.includes('uficonnect') ? old.filter(key => key !== 'uficonnect') : [...old, 'uficonnect']); request.current = null; }} />
          <SourceButton source="linkedin" connected={Boolean(catalog?.connected?.linkedin)} selected={selected.includes('linkedin')} locked={!linkedInReady} disabled={pending} reason={linkedInReady ? 'Publish to your connected LinkedIn profile' : 'Connect LinkedIn with permission to share posts'} onClick={() => { setSelected(old => old.includes('linkedin') ? old.filter(key => key !== 'linkedin') : [...old, 'linkedin']); request.current = null; }} />
          {!linkedInReady && <Link to="/connected-accounts">Manage LinkedIn connection</Link>}
        </fieldset>
        <div className="business-post-buttons"><button className="btn btn-primary" type="submit" disabled={!canSave || !selected.length || pending || result?.status === 'published' || result?.status === 'processing'}><Send size={16} />{pending ? 'Saving…' : 'Publish hiring post'}</button>
          <button className="btn btn-outline" type="button" onClick={() => submit(false)} disabled={!canSave || pending || Boolean(result)}><Save size={16} />Save draft</button>
          <button className="btn btn-ghost" type="button" disabled={pending || uploading} onClick={() => { setDetails(empty(profile.organization)); setResult(null); setNotice(''); setError(''); setPhotoError(''); setPhotoName(''); request.current = null; }}>Start new post</button></div>
        <p className="business-post-muted">Save a draft to keep the complete post and photo in Posts & comparisons.</p>
        {result && <div className="business-post-outcomes">{result.targets.map(target => <p key={target.platform}><strong>{target.platform === 'uficonnect' ? 'UFIConnect' : 'LinkedIn'}: {target.status}</strong>{target.error && <span>{target.error}</span>}{target.postedUrl && target.platform === 'linkedin' && <a href={target.postedUrl} target="_blank" rel="noopener noreferrer">View on LinkedIn</a>}</p>)}<Link to={`/business-posts?post=${encodeURIComponent(result.id)}`}>View this post and compare similar roles</Link></div>}
      </form>
      <div className="publish-composer-main">
        <div className="publish-checklist" aria-label="Hiring post checklist"><strong>Publishing checklist</strong>
          {[[details.title.trim().length >= 3, 'Role title'], [details.description.trim().length >= 20, 'Role description'], [Boolean(details.duties.trim()), 'Responsibilities'], [Boolean(details.requirements.trim()), 'Requirements'], [content.length <= 2000, 'Within 2,000 characters'], [selected.length > 0, 'Publishing destination']].map(([complete,label]) => <span key={label} data-complete={complete}>{complete ? '✓' : '○'} {label}</span>)}
          <p>Responsibilities and requirements help candidates understand the role.</p>
        </div>
        <PostPreview content={content} media={media} name={details.company || profile?.name} subtitle={details.title || 'Hiring post'} destinations={selected.map(key => key === 'uficonnect' ? 'UFIConnect' : 'LinkedIn')} onCopy={copy} onDownload={text => downloadPostText(text, 'uficonnect-hiring-post.txt')} />
        <button type="button" className="btn btn-outline btn-sm" disabled={!content} onClick={copy}><Copy size={16} />Copy hiring post</button>
      </div>
    </div>
    <section className="business-post-panel business-career-handoff"><h2>Other career sources</h2><p className="business-post-muted">Direct publishing to these sources is unavailable. Use their official employer tools to post a job. You can copy your complete hiring post from the preview above.</p>
      <label className="business-post-field">Find a career site<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Indeed, Glassdoor, USAJobs…" /></label>
      <div className="business-career-list">{careers.map(([key, entry]) => <div key={key}><SourceButton source={key} label={entry.name} locked reason="Direct publishing is unavailable for this career source." /><ExternalAccountLogin platform={key} compact /></div>)}</div>
      {!careers.length && <p>No career sites match your search.</p>}
    </section>
  </Layout>;
}
