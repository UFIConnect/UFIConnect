import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, BriefcaseBusiness, Send } from 'lucide-react';
import Layout from '../components/Layout';
import { isBusinessAccount } from '../businessAccount.mjs';
import { WritingArea, PostPreview } from '../components/PublishingComposer';
import { useAuth } from '../contexts/AuthContext';
import { privateSessionStorage } from '../auth/session';
import api from '../api/client';
import JobPublishingSources, { JobCareerSites, useJobPublishingCatalog } from '../components/JobPublishingSources';
import { usePublishingOptions } from '../components/PublishingOptions';
import { publishingPlan } from '../components/publishingPlan.mjs';
import { SOURCE_META } from '../components/sourceMeta';
import './JobCompose.css';

const empty = company => ({ title: '', company: company || '', location: '', pay: '', description: '', duties: '', requirements: '', applyUrl: '' });
function readDraft(profile) {
  const defaults = empty(profile?.organization);
  try {
    const stored = JSON.parse(privateSessionStorage.getItem(`ufi_job_post_draft:${profile?.id}`) || 'null');
    const saved = stored?.details || stored;
    const details = Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, typeof saved?.[key] === 'string' ? saved[key] : fallback]));
    const targets = [...new Set((Array.isArray(stored?.targets) ? stored.targets : stored?.request?.payload?.targets || [])
      .filter(key => typeof key === 'string' && key !== 'uficonnect' && /^[a-z][a-z0-9_-]{0,79}$/.test(key)))].slice(0, 32);
    const publisherSettings = stored?.publisherSettings && typeof stored.publisherSettings === 'object' ? stored.publisherSettings : {};
    const previous = stored?.request;
    const request = previous?.payload && JSON.stringify(previous.payload.details) === JSON.stringify(details) ? previous
      : previous?.fingerprint === JSON.stringify(details) && !targets.length
        ? { ...previous, payload: { details, targets: ['uficonnect'], publisherSettings: {} } } : null;
    return { details, targets, publisherSettings, request };
  } catch { return { details: defaults, targets: [], publisherSettings: {}, request: null }; }
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
  const [draftRevision, setDraftRevision] = useState(0);
  return <JobComposePage key={`${profile?.id || 'signed-out'}:${draftRevision}`} profile={profile} onNewJob={() => {
    privateSessionStorage.removeItem(`ufi_job_post_draft:${profile?.id}`);
    setDraftRevision(value => value + 1);
  }} />;
}
function JobComposePage({ profile, onNewJob }) {
  const [draft] = useState(() => readDraft(profile));
  const [details, setDetails] = useState(draft.details);
  const [selected, setSelected] = useState(draft.targets);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const request = useRef(draft.request), sending = useRef(false), mounted = useRef(true);
  const restoredSettings = useRef(draft.publisherSettings), hydrated = useRef(new Set());
  const catalog = useJobPublishingCatalog(profile?.id);
  const sourceOptions = usePublishingOptions({ selected, accounts: catalog.platforms, connected: catalog.connected });
  const edited = () => { setError(''); setResult(null); request.current = null; };
  const publishing = { ...sourceOptions, forSource: key => {
    const options = sourceOptions.forSource(key);
    return { ...options, change: (field, value) => { edited(); options.change(field, value); } };
  } };
  useEffect(() => {
    for (const key of selected) {
      const options = sourceOptions.forSource(key), saved = restoredSettings.current[key];
      if (!options.schema || !saved || hydrated.current.has(key)) continue;
      hydrated.current.add(key);
      for (const [field, value] of Object.entries(saved)) options.change(field, value);
    }
  }, [selected, sourceOptions.payload]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!profile?.id) return;
    const key = `ufi_job_post_draft:${profile.id}`;
    if (details.title || details.description) privateSessionStorage.setItem(key, JSON.stringify({ details, targets: selected, publisherSettings: sourceOptions.payload, request: request.current }));
    else privateSessionStorage.removeItem(key);
  }, [details, selected, sourceOptions.payload, profile?.id]);
  const content = postText(details);
  const sourcePlan = publishingPlan(selected, { accounts: catalog.platforms, connected: catalog.connected,
    plan: profile?.plan === 'business' ? 'pro' : profile?.plan, content, loading: catalog.loading, optionReasons: sourceOptions.reasons,
    extraReasons: content.trim().length > 500 ? { twitch: 'Shorten this draft to 500 characters for Twitch.' } : {} });
  const sourceReason = sourcePlan.pending[0]?.reason || '';
  const completed = Boolean(result?.job) && (result.post?.targets || []).every(target => ['posted', 'handoff'].includes(target.status));
  const checking = Boolean(request.current?.payload) && !completed;
  const canPublish = details.title.trim().length >= 3 && details.description.trim().length >= 20
    && content.length <= 2000 && !['description', 'duties', 'requirements'].some(key => details[key].length > 1500);
  const update = (key, value) => { setDetails(old => ({ ...old, [key]: value })); edited(); };
  async function submit(event) {
    event.preventDefault();
    if (sending.current || !profile?.id || completed || (!checking && (!canPublish || sourceReason))) return;
    sending.current = true; setPending(true); setError('');
    if (!request.current?.payload) {
      const payload = { details, targets: ['uficonnect', ...selected], publisherSettings: sourceOptions.payload };
      request.current = { fingerprint: JSON.stringify(payload), id: crypto.randomUUID(), payload };
    }
    privateSessionStorage.setItem(`ufi_job_post_draft:${profile.id}`, JSON.stringify({ details, targets: selected, publisherSettings: sourceOptions.payload, request: request.current }));
    try {
      const { data } = await api.post('/jobs/posts', { ...request.current.payload, requestId: request.current.id });
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
            : <><h2>Publication is not confirmed</h2><p>{result.post?.targets?.find(target => target.platform === 'uficonnect')?.error || 'Check this unchanged draft again before creating another listing.'}</p><p>Checking again uses the same request and does not publish another copy.</p>{isBusinessAccount(profile) && <Link className="btn btn-outline" to="/business-posts">Review hiring posts</Link>}</>}
        </section>}
        {result?.post?.targets?.length > 0 && <section className="card job-source-results" aria-label="Job publishing results">
          <h2>Publishing results</h2><ul>{result.post.targets.map(target => <li key={target.platform}>
            <strong>{target.platform === 'uficonnect' ? 'UFIConnect Jobs' : SOURCE_META[target.platform]?.label || target.platform}: {{ posted: 'Published', failed: 'Failed', unconfirmed: 'Unconfirmed', processing: 'Processing', handoff: 'Review at source', skipped: 'Not sent', unsupported: 'Unavailable' }[target.status] || 'Unconfirmed'}</strong>
            {target.error && <span>{target.error}</span>}
            {target.postedUrl && /^https:\/\//.test(target.postedUrl) && <a href={target.postedUrl} target="_blank" rel="noopener noreferrer">View at source</a>}
          </li>)}</ul>
        </section>}
        {checking && <p className="job-compose-note" role="status">Your original publish request is retained. Checking its status uses the same request and does not send another copy.</p>}
        <div className="job-compose-grid"><form className="card job-compose-form" onSubmit={submit}>
          <JobPublishingSources catalog={catalog} selected={selected} plan={profile?.plan} publishing={publishing} content={content}
            onClear={() => { edited(); setSelected([]); }}
            disabled={pending || Boolean(result?.job)} onToggle={key => { edited(); setSelected(old => old.includes(key) ? old.filter(value => value !== key) : [...old, key]); }} />
          <h2>Job details</h2><div className="job-compose-fields">{field('title', 'Role title', { placeholder: 'Role you are hiring for' })}{field('company', 'Company (optional)')}{field('location', 'Location & work arrangement (optional)', { placeholder: 'City, country · Remote, hybrid or on-site' })}{field('pay', 'Pay range (optional)')}</div>
          {field('description', 'Role description', { multiline: true, placeholder: 'Describe the role and team in at least 20 characters.' })}
          {field('duties', 'Responsibilities — one per line (optional)', { multiline: true, rows: 3 })}
          {field('requirements', 'Requirements — one per line (optional)', { multiline: true, rows: 3 })}
          {field('applyUrl', 'External application link (optional)', { type: 'url', placeholder: 'https://your-company.example/careers/role' })}
          <p className="job-compose-note">If you add an application link, candidates can open it from your listing. Your account remains the identified publisher.</p>
          <p className={content.length > 2000 ? 'job-compose-error' : 'job-compose-note'}>{content.length.toLocaleString()} / 2,000 characters, including headings</p>
          {sourceReason && !checking && <p className="job-compose-note" role="status">{sourceReason}</p>}
          <div className="job-compose-actions"><button type="submit" className="btn btn-primary" disabled={pending || completed || (!checking && (!canPublish || Boolean(sourceReason)))}><Send size={16} />{pending ? 'Publishing…' : checking ? 'Check publication status' : 'Publish job'}</button>
            <button type="button" className="btn btn-outline" disabled={pending} onClick={onNewJob}>Start a new job</button></div>
        </form><PostPreview content={content} name={profile.name || 'You'} subtitle="UFIConnect job listing" destinations={['UFIConnect Jobs', ...selected.map(key => SOURCE_META[key]?.label || key)]} /></div>
        <JobCareerSites content={content} disabled={pending} />
      </>
    </div>
  </Layout>;
}
