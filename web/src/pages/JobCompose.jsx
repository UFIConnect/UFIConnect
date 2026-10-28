import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, BriefcaseBusiness, Send } from 'lucide-react';
import Layout from '../components/Layout';
import BusinessAccessNotice from '../components/BusinessAccessNotice';
import { isBusinessAccount } from '../businessAccount.mjs';
import { WritingArea, PostPreview } from '../components/PublishingComposer';
import { useAuth } from '../contexts/AuthContext';
import { privateSessionStorage } from '../auth/session';
import api from '../api/client';
import './JobCompose.css';

const empty = company => ({ title: '', company: company || '', location: '', pay: '', description: '', duties: '', requirements: '', applyUrl: '' });
function readDraft(profile) {
  const defaults = empty(profile?.organization);
  try {
    const stored = JSON.parse(privateSessionStorage.getItem(`ufi_job_post_draft:${profile?.id}`) || 'null');
    const saved = stored?.details || stored;
    return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, typeof saved?.[key] === 'string' ? saved[key] : fallback]));
  } catch { return defaults; }
}
function postText(details) {
  const bullets = value => value.split(/\n+/).map(line => line.replace(/^(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean).map(line => `- ${line}`).join('\n');
  return [details.title.trim(), details.company.trim(), details.location.trim() && `Location: ${details.location.trim()}`,
    details.pay.trim() && `Pay: ${details.pay.trim()}`, details.description.trim(),
    details.duties.trim() && `Responsibilities\n${bullets(details.duties)}`,
    details.requirements.trim() && `Requirements\n${bullets(details.requirements)}`,
    details.applyUrl.trim() && `Apply: ${details.applyUrl.trim()}`].filter(Boolean).join('\n\n');
}

export default function JobCompose() {
  const { profile } = useAuth();
  if (!isBusinessAccount(profile) || profile?.plan !== 'business') return <Layout><BusinessAccessNotice title="Post a job" /></Layout>;
  return <JobComposePage key={profile?.id || 'signed-out'} profile={profile} />;
}
function JobComposePage({ profile }) {
  const [details, setDetails] = useState(() => readDraft(profile));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const request = useRef(null), sending = useRef(false), mounted = useRef(true);
  if (request.current === null) {
    try {
      const saved = JSON.parse(privateSessionStorage.getItem(`ufi_job_post_draft:${profile?.id}`) || 'null');
      if (saved?.request?.fingerprint === JSON.stringify(details)) request.current = saved.request;
    } catch { /* Only this account's current draft is eligible for retry. */ }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!profile?.id) return;
    const key = `ufi_job_post_draft:${profile.id}`;
    if (details.title || details.description) privateSessionStorage.setItem(key, JSON.stringify({ details, request: request.current }));
    else privateSessionStorage.removeItem(key);
  }, [details, profile?.id]);
  const content = postText(details);
  const canPublish = details.title.trim().length >= 3 && details.description.trim().length >= 20
    && content.length <= 2000 && !['description', 'duties', 'requirements'].some(key => details[key].length > 1500);
  const update = (key, value) => { setDetails(old => ({ ...old, [key]: value })); setError(''); setResult(null); request.current = null; };
  async function submit(event) {
    event.preventDefault();
    if (!canPublish || sending.current || profile?.plan !== 'business' || result?.job) return;
    sending.current = true; setPending(true); setError('');
    const fingerprint = JSON.stringify(details);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    privateSessionStorage.setItem(`ufi_job_post_draft:${profile.id}`, JSON.stringify({ details, request: request.current }));
    try {
      const { data } = await api.post('/jobs/posts', { details, requestId: request.current.id });
      if (mounted.current) setResult(data);
    } catch (err) {
      if (mounted.current) setError(err.response?.data?.message || 'Publication could not be confirmed. Retry this unchanged draft to check its status.');
    } finally { sending.current = false; if (mounted.current) setPending(false); }
  }
  const field = (key, label, options = {}) => options.multiline
    ? <WritingArea value={details[key]} onChange={value => update(key, value)} label={label} rows={options.rows || 4} maxLength={1500} disabled={pending || Boolean(result?.job)} placeholder={options.placeholder} />
    : <label className="job-compose-field">{label}<input type={options.type || 'text'} value={details[key]} onChange={event => update(key, event.target.value)} maxLength={key === 'applyUrl' ? 500 : 150} required={key === 'title'} disabled={pending || Boolean(result?.job)} placeholder={options.placeholder} /></label>;
  return <Layout>
    <Helmet><title>Post a job | UFIConnect</title><meta name="robots" content="noindex" /></Helmet>
    <div className="job-compose-page">
      <Link className="btn btn-ghost btn-sm" to="/opportunities"><ArrowLeft size={16} />Back to jobs</Link>
      <header className="job-compose-heading"><BriefcaseBusiness size={28} /><div><h1>Post a job</h1><p>Publish an opening to UFIConnect Jobs and the public UFI feed.</p></div></header>
      <>
        {error && <p className="job-compose-error" role="alert">{error}</p>}
        {result && <section className="card job-compose-result" role="status">
          {result.job ? <><h2>Your job is published</h2><p>It is available in UFIConnect Jobs.</p><Link className="btn btn-primary" to={`/opportunities/${encodeURIComponent(result.job.id)}`} state={{ job: result.job }}>View job listing</Link></>
            : <><h2>Publication is not confirmed</h2><p>{result.post?.targets?.find(target => target.platform === 'uficonnect')?.error || 'Check your hiring posts before creating another listing.'}</p><Link className="btn btn-outline" to="/business-posts">Review hiring posts</Link></>}
        </section>}
        <div className="job-compose-grid"><form className="card job-compose-form" onSubmit={submit}>
          <h2>Job details</h2><div className="job-compose-fields">{field('title', 'Role title', { placeholder: 'Role you are hiring for' })}{field('company', 'Company (optional)')}{field('location', 'Location & work arrangement (optional)', { placeholder: 'City, country · Remote, hybrid or on-site' })}{field('pay', 'Pay range (optional)')}</div>
          {field('description', 'Role description', { multiline: true, placeholder: 'Describe the role and team in at least 20 characters.' })}
          {field('duties', 'Responsibilities — one per line (optional)', { multiline: true, rows: 3 })}
          {field('requirements', 'Requirements — one per line (optional)', { multiline: true, rows: 3 })}
          {field('applyUrl', 'External application link (optional)', { type: 'url', placeholder: 'https://your-company.example/careers/role' })}
          <p className="job-compose-note">If you add an application link, candidates can open it from your listing. Your account remains the identified publisher.</p>
          <p className={content.length > 2000 ? 'job-compose-error' : 'job-compose-note'}>{content.length.toLocaleString()} / 2,000 characters, including headings</p>
          <div className="job-compose-actions"><button type="submit" className="btn btn-primary" disabled={!canPublish || pending || Boolean(result)}><Send size={16} />{pending ? 'Publishing…' : 'Publish job'}</button>
            <button type="button" className="btn btn-outline" disabled={pending} onClick={() => { setDetails(empty(profile.organization)); setResult(null); setError(''); request.current = null; }}>Start a new job</button></div>
          <p className="job-compose-note">This publishes to UFIConnect. To choose other destinations, use <Link to="/career-posts">Business Cross Post</Link>.</p>
        </form><PostPreview content={content} name={profile.name || 'You'} subtitle="UFIConnect job listing" destinations={['UFIConnect Jobs']} /></div>
      </>
    </div>
  </Layout>;
}
