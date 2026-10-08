import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Copy, Send, Save, ArrowRight } from 'lucide-react';
import Layout from '../components/Layout';
import ExternalAccountLogin from '../components/ExternalAccountLogin';
import BrandIcon from '../components/BrandIcon';
import directory from '../../../backend/account-directory.json';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const empty = company => ({ title: '', company: company || '', location: '', pay: '', description: '', duties: '', requirements: '', applyUrl: '' });
const SourceIcon = ({ source, size }) => <BrandIcon platform={source} size={size} />;
function initialDraft(profile) {
  const defaults = empty(profile?.organization);
  try {
    const saved = JSON.parse(sessionStorage.getItem(`ufi_business_post_draft:${profile?.id}`) || 'null');
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, typeof saved?.[key] === 'string' ? saved[key] : value]));
  } catch { return defaults; }
}
export function hiringPostText(details) {
  const bullets = value => value.split(/\n+/).map(line => line.replace(/^[-*•]\s*/, '').trim()).filter(Boolean).map(line => `- ${line}`).join('\n');
  return [details.title.trim(), details.company.trim(), details.location.trim() && `Location: ${details.location.trim()}`,
    details.pay.trim() && `Pay: ${details.pay.trim()}`, details.description.trim(),
    details.duties.trim() && `Responsibilities\n${bullets(details.duties)}`,
    details.requirements.trim() && `Requirements\n${bullets(details.requirements)}`,
    details.applyUrl.trim() && `Apply: ${details.applyUrl.trim()}`].filter(Boolean).join('\n\n');
}
export default function BusinessCrossPost() {
  const { profile } = useAuth();
  const [details, setDetails] = useState(() => initialDraft(profile));
  const [catalog, setCatalog] = useState(null);
  const [selected, setSelected] = useState(['uficonnect']);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const request = useRef(null);
  useEffect(() => { let active = true; api.get('/social/platforms').then(({ data }) => { if (active) setCatalog(data); }).catch(() => { if (active) setError('Could not check LinkedIn availability. UFIConnect publishing remains available.'); }); return () => { active = false; }; }, []);
  useEffect(() => {
    const key = `ufi_business_post_draft:${profile?.id}`;
    sessionStorage.removeItem(key);
  }, [profile?.id]);
  if (profile?.plan !== 'business') return <Navigate to="/settings" replace />;
  const content = hiringPostText(details);
  const linkedInReady = catalog?.connected?.linkedin && catalog?.platforms?.linkedin?.configured && catalog.platforms.linkedin.crossPost?.supported;
  const canSave = details.title.trim().length >= 3 && details.description.trim().length >= 20 && content.length <= 2000;
  const careers = Object.entries(directory).filter(([, entry]) => entry.category === 'career' && entry.name.toLowerCase().includes(search.toLowerCase()));
  const update = (key, value) => { setDetails(old => ({ ...old, [key]: value })); request.current = null; setResult(null); setNotice(''); };
  async function submit(publish) {
    setPending(true); setError(''); setNotice('');
    const targets = publish ? selected : [];
    const fingerprint = JSON.stringify({ details, targets });
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const { data } = await api.post('/business/posts', { details, targets, requestId: request.current.id });
      setResult(data);
      setNotice(data.status === 'draft' ? 'Draft saved. You can find it in Posts & comparisons.' : data.status === 'processing' ? 'Delivery is still being confirmed. Check Posts & comparisons before trying again.' : data.status === 'published' ? 'Your hiring post was published. Review each destination below.' : 'Delivery failed. Review the destination message before trying again.');
    } catch (err) { setError(err.response?.data?.message || 'The request could not be confirmed. Retry without changing the draft to check its status.'); }
    finally { setPending(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(content); setNotice('Hiring post copied. Paste it into the career site’s job posting form.'); }
    catch { setError('Clipboard access was unavailable. Select and copy the post preview.'); }
  }
  const field = (key, label, options = {}) => <label className="business-post-field">{label}
    {options.multiline ? <textarea value={details[key]} onChange={event => update(key, event.target.value)} rows={options.rows || 4} maxLength={1500} disabled={pending} placeholder={options.placeholder} />
      : <input type={options.type || 'text'} value={details[key]} onChange={event => update(key, event.target.value)} maxLength={key === 'applyUrl' ? 500 : 150} disabled={pending} placeholder={options.placeholder} />}
  </label>;
  return <Layout>
    <Helmet><title>Cross Post | UFIConnect Business</title><meta name="robots" content="noindex" /></Helmet>
    <header className="recruiting-heading"><span className="recruiting-eyebrow">Business publishing</span><h1>Cross Post</h1>
      <p>Write a hiring post once. Publish it to UFIConnect and your connected LinkedIn account, or copy it to a career site’s posting form.</p>
      <Link className="btn btn-outline btn-sm" to="/business-posts">Posts & comparisons <ArrowRight size={16} /></Link>
    </header>
    {error && <div className="business-post-alert" role="alert">{error}</div>}
    {notice && <p className="business-post-notice" role="status">{notice}</p>}
    <div className="business-compose-grid">
      <form className="business-post-panel" onSubmit={event => { event.preventDefault(); void submit(true); }}>
        <h2>Hiring post</h2>
        <div className="business-post-fields">{field('title', 'Role title', { placeholder: 'Senior software engineer' })}{field('company', 'Company')}
          {field('location', 'Location & work arrangement', { placeholder: 'Los Angeles, CA · Hybrid' })}{field('pay', 'Pay range', { placeholder: '$120,000–$160,000/year' })}</div>
        {field('description', 'Role description', { multiline: true, placeholder: 'Describe the team, the purpose of the role and its main responsibilities.' })}
        {field('duties', 'Responsibilities — one per line', { multiline: true, rows: 3 })}
        {field('requirements', 'Requirements — one per line', { multiline: true, rows: 3 })}
        {field('applyUrl', 'Application link (optional)', { type: 'url' })}
        <p className={content.length > 2000 ? 'business-post-alert' : 'business-post-muted'}>{content.length.toLocaleString()} / 2,000 characters, including headings</p>
        <fieldset className="business-post-targets"><legend>Publish destinations</legend>
          <label><input type="checkbox" checked={selected.includes('uficonnect')} disabled={pending} onChange={event => { setSelected(old => event.target.checked ? [...old, 'uficonnect'] : old.filter(key => key !== 'uficonnect')); request.current = null; }} /><SourceIcon source="uficonnect" size={22} /><span>UFIConnect <small>Public hiring post in the UFI feed</small></span></label>
          <label><input type="checkbox" checked={selected.includes('linkedin')} disabled={!linkedInReady || pending} onChange={event => { setSelected(old => event.target.checked ? [...old, 'linkedin'] : old.filter(key => key !== 'linkedin')); request.current = null; }} /><SourceIcon source="linkedin" size={22} /><span>LinkedIn <small>{linkedInReady ? 'Publish to your connected profile' : 'Connect LinkedIn with permission to share posts'}</small></span></label>
          {!linkedInReady && <Link to="/connected-accounts">Manage LinkedIn connection</Link>}
        </fieldset>
        <div className="business-post-buttons"><button className="btn btn-primary" type="submit" disabled={!canSave || !selected.length || pending || result?.status === 'published' || result?.status === 'processing'}><Send size={16} />{pending ? 'Saving…' : 'Publish hiring post'}</button>
          <button className="btn btn-outline" type="button" onClick={() => submit(false)} disabled={!canSave || pending || Boolean(result)}><Save size={16} />Save draft</button></div>
        {result && <div className="business-post-outcomes">{result.targets.map(target => <p key={target.platform}><strong>{target.platform === 'uficonnect' ? 'UFIConnect' : 'LinkedIn'}: {target.status}</strong>{target.error && <span>{target.error}</span>}{target.postedUrl && target.platform === 'linkedin' && <a href={target.postedUrl} target="_blank" rel="noopener noreferrer">View on LinkedIn</a>}</p>)}<Link to={`/business-posts?post=${encodeURIComponent(result.id)}`}>View this post and compare similar roles</Link></div>}
      </form>
      <aside className="business-post-panel business-post-preview"><h2>Post preview</h2><pre>{content || 'Your hiring post preview appears here as you write.'}</pre><button className="btn btn-outline btn-sm" onClick={copy} disabled={!content}><Copy size={16} />Copy hiring post</button></aside>
    </div>
    <section className="business-post-panel business-career-handoff"><h2>Career site handoff</h2><p className="business-post-muted">Copy your post, sign in on the destination and complete its job posting form. These sites do not confirm publication or report engagement to UFIConnect.</p>
      <label className="business-post-field">Find a career site<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Indeed, Glassdoor, USAJobs…" /></label>
      <div className="business-career-list">{careers.map(([key, entry]) => <div key={key}><SourceIcon source={key} size={24} /><strong>{entry.name}</strong><ExternalAccountLogin platform={key} compact /></div>)}</div>
      {!careers.length && <p>No career sites match your search.</p>}
    </section>
  </Layout>;
}
