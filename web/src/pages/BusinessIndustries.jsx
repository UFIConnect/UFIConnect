import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowUpRight, Layers, Send, Save } from 'lucide-react';
import Layout from '../components/Layout';
import PagedList from '../components/PagedList';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import ConfirmActionDialog from '../components/ConfirmActionDialog';
import BusinessAccessNotice from '../components/BusinessAccessNotice';
import { isBusinessAccount } from '../businessAccount.mjs';
import './BusinessIndustries.css';

export default function BusinessIndustries() {
  const { profile } = useAuth();
  return <IndustrySpaces key={`${profile?.id || 'guest'}:${profile?.plan || 'free'}`} profile={profile} />;
}

function IndustrySpaces({ profile }) {
  const [data,setData] = useState(null), [industryId,setIndustryId] = useState('');
  const [name,setName] = useState(''), [sourceIds,setSourceIds] = useState([]);
  const [error,setError] = useState(''), [notice,setNotice] = useState(''), [pending,setPending] = useState(false);
  const [reload,setReload] = useState(0);
  const [show,setShow] = useState('active'), [archive,setArchive] = useState(null);
  const initialChoice = useRef(false);
  useEffect(() => {
    if (!isBusinessAccount(profile) || profile?.plan !== 'business') return;
    let active = true;
    setError('');
    api.get('/business/industries').then(({data:result}) => {
      if (!active) return;
      setData(result);
      if (!initialChoice.current) {
        initialChoice.current=true;
        const category=result.catalog.find(item=>item.id===profile?.businessEnrollment?.industryId);
        const saved=result.workspaces.find(item=>item.industryId===category?.id);
        if (category) { setIndustryId(category.id);setName(saved?.name || category.name);setSourceIds(saved?.sourceIds || category.sources.map(item=>item.id)); }
      }
    })
      .catch(err => { if (active) setError(err.response?.data?.message || 'Could not load your industry spaces.'); });
    return () => { active = false; };
  }, [profile?.id,profile?.plan,reload]);
  if (!isBusinessAccount(profile) || profile?.plan !== 'business') return <Layout><BusinessAccessNotice title="Business industry spaces" /></Layout>;
  const industry = data?.catalog.find(item => item.id === industryId);
  const existing = data?.workspaces.find(item => item.industryId === industryId);
  function choose(id) {
    const category = data.catalog.find(item => item.id === id), saved = data.workspaces.find(item => item.industryId === id);
    setIndustryId(id); setName(saved?.name || category?.name || '');
    setSourceIds(saved?.sourceIds || category?.sources.map(item => item.id) || []);
    setNotice(''); setError('');
  }
  async function save(event) {
    event.preventDefault(); if (pending || !industry || !data.canManage) return;
    setPending(true); setError(''); setNotice('');
    try {
      const {data:result} = await api.post('/business/industries',{industryId,name,sourceIds});
      setData(old => ({...old,workspaces:[...old.workspaces.filter(item => item.id !== result.workspace.id),result.workspace].sort((a,b) => a.name.localeCompare(b.name))}));
      setNotice('Industry space saved for your Business team.');
    } catch (err) { setError(err.response?.data?.message || 'Could not save this industry space.'); }
    finally { setPending(false); }
  }
  async function changeArchive() {
    setPending(true);
    try {
      const { data:result } = await api.patch(`/business/industries/${archive.space.id}`,{archived:archive.archived});
      setData(old=>({...old,workspaces:old.workspaces.map(space=>space.id===result.workspace.id?result.workspace:space)}));
      setNotice(archive.archived?'Space archived. Its posts and private drafts remain available in history.':'Space restored. Your team can publish here again.');
      setArchive(null);
    } finally { setPending(false); }
  }
  const visibleSpaces = data?.workspaces.filter(space=>show==='all'||(show==='archived'?Boolean(space.archivedAt):!space.archivedAt)) || [];
  return <Layout>
    <Helmet><title>Industry spaces | UFIconnect Business</title><meta name="robots" content="noindex" /></Helmet>
    <header className="recruiting-heading"><span className="recruiting-eyebrow">Business membership</span><h1>Industry spaces</h1>
      <p>Keep your team’s industries, selected resources and business updates together. Each space belongs to your Business membership.</p>
      <div className="industry-actions"><Link className="btn btn-outline btn-sm" to="/business/cross-post"><Send size={16} />Write a business update</Link><Link className="btn btn-ghost btn-sm" to="/jobs/new">Post a job</Link></div>
    </header>
    {error && <div role="alert" className="business-post-alert">{error} {!data && <button className="btn btn-ghost btn-sm" onClick={() => setReload(value => value+1)}>Try again</button>}</div>}
    {notice && <p role="status" className="business-post-notice">{notice}</p>}
    {!data && !error && <p role="status">Loading your industry spaces…</p>}
    {data && <div className="industry-workbench">
      <section className="business-post-panel industry-spaces" aria-label="Your industry spaces"><h2>Your spaces</h2>
        <label className="business-post-field">Show spaces<select aria-label="Show industry spaces" value={show} onChange={event=>setShow(event.target.value)}><option value="active">Active spaces</option><option value="archived">Archived spaces</option><option value="all">All spaces</option></select></label>
        {!data.workspaces.length && <p>{data.canManage ? 'Choose an industry below to create your first space.' : 'Your Business membership owner can create an industry space for your team.'}</p>}
        {data.workspaces.length > 0 && !visibleSpaces.length && <p>No {show==='archived'?'archived':'active'} spaces.</p>}
        <PagedList pageSize={4} label="Industry spaces">{visibleSpaces.map(space => <article key={space.id} className="industry-space-card">
          <Layers size={20} /><div><h3>{space.name}</h3><p>{data.catalog.find(item => item.id === space.industryId)?.name} · {space.sourceIds.length} selected resources</p>
            {space.archivedAt && <p className="industry-archive-note">Archived — history is retained.</p>}
            <div className="industry-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => choose(space.industryId)} disabled={pending}>{data.canManage ? 'Resources & settings' : 'View resources'}</button>
              <Link className="btn btn-outline btn-sm" to={`/business/cross-post?workspace=${encodeURIComponent(space.id)}`}>{space.archivedAt?'View post history':'Posts & publishing'}</Link>
              {data.canManage && <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={()=>setArchive({space,archived:!space.archivedAt})}>{space.archivedAt?'Restore space':'Archive space'}</button>}</div></div>
        </article>)}</PagedList>
      </section>
      <form className="business-post-panel industry-editor" onSubmit={save}><h2>{existing ? 'Space resources' : 'Explore industries'}</h2>
        <label className="business-post-field">Industry<select aria-label="Industry" value={industryId} disabled={pending} onChange={event => choose(event.target.value)}>
          <option value="">Choose an industry</option>{data.catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {industry && <>
          <p>{industry.description}</p>
          {existing?.archivedAt && <p role="status" className="industry-archive-note">This space is archived. Restore it to change resources or publish new posts.</p>}
          <label className="business-post-field">Space name<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required disabled={pending || !data.canManage || Boolean(existing?.archivedAt)} /></label>
          <fieldset className="industry-source-options"><legend>Official industry resources</legend>
            <p>These links open the source’s website. Selecting a resource saves it for your team; it does not connect an account or publish a post.</p>
            {industry.sources.map(source => <div className="industry-resource" key={source.id}>
              <label><input type="checkbox" checked={sourceIds.includes(source.id)} disabled={pending || !data.canManage || Boolean(existing?.archivedAt)} onChange={event => setSourceIds(old => event.target.checked ? [...old,source.id] : old.filter(id => id !== source.id))} /><strong>{source.name}</strong></label>
              <p>{source.description}</p><a href={source.url} target="_blank" rel="noopener noreferrer">Visit {source.name} <ArrowUpRight size={14} /></a>
            </div>)}
          </fieldset>
          {data.canManage && existing?.archivedAt ? <button type="button" className="btn btn-outline" disabled={pending} onClick={()=>setArchive({space:existing,archived:false})}>Restore selected space</button> : data.canManage ? <button type="submit" className="btn btn-primary" disabled={pending || name.trim().length < 2}><Save size={16} />{pending ? 'Saving…' : existing ? 'Save space settings' : 'Create industry space'}</button>
            : <p className="business-post-muted">Your membership owner manages shared space settings. You can publish using your own connected account.</p>}
          {existing && <Link className="btn btn-ghost" to={`/business/cross-post?workspace=${encodeURIComponent(existing.id)}`}>Open this space’s posts</Link>}
        </>}
      </form>
    </div>}
    {archive && <ConfirmActionDialog title={archive.archived?'Archive industry space?':'Restore industry space?'} confirmLabel={archive.archived?'Archive space':'Restore space'} pendingLabel={archive.archived?'Archiving…':'Restoring…'} onClose={()=>setArchive(null)} onConfirm={changeArchive}>
      <p>{archive.archived?`Archive ${archive.space.name}? New posts and draft edits will stop. Saved history and drafts are retained.`:`Restore ${archive.space.name} so your team can use its resources and publish again?`}</p>
    </ConfirmActionDialog>}
  </Layout>;
}
