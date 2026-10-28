import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowUpRight, Layers, Send, Save } from 'lucide-react';
import Layout from '../components/Layout';
import PagedList from '../components/PagedList';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
import './BusinessIndustries.css';

export default function BusinessIndustries() {
  const { profile } = useAuth();
  const [data,setData] = useState(null), [industryId,setIndustryId] = useState('');
  const [name,setName] = useState(''), [sourceIds,setSourceIds] = useState([]);
  const [error,setError] = useState(''), [notice,setNotice] = useState(''), [pending,setPending] = useState(false);
  const [reload,setReload] = useState(0);
  useEffect(() => {
    if (profile?.plan !== 'business') return;
    let active = true;
    setError('');
    api.get('/business/industries').then(({data:result}) => { if (active) setData(result); })
      .catch(err => { if (active) setError(err.response?.data?.message || 'Could not load your industry spaces.'); });
    return () => { active = false; };
  }, [profile?.id,profile?.plan,reload]);
  if (profile?.plan !== 'business') return <Navigate to="/settings" replace />;
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
  return <Layout>
    <Helmet><title>Industry spaces | UFIconnect Business</title><meta name="robots" content="noindex" /></Helmet>
    <header className="recruiting-heading"><span className="recruiting-eyebrow">Business membership</span><h1>Industry spaces</h1>
      <p>Keep your team’s industries, selected resources and business updates together. Each space belongs to your Business membership.</p>
      <Link className="btn btn-outline btn-sm" to="/business/cross-post"><Send size={16} />Write a business update</Link>
    </header>
    {error && <div role="alert" className="business-post-alert">{error} {!data && <button className="btn btn-ghost btn-sm" onClick={() => setReload(value => value+1)}>Try again</button>}</div>}
    {notice && <p role="status" className="business-post-notice">{notice}</p>}
    {!data && !error && <p role="status">Loading your industry spaces…</p>}
    {data && <div className="industry-workbench">
      <section className="business-post-panel industry-spaces" aria-label="Your industry spaces"><h2>Your spaces</h2>
        {!data.workspaces.length && <p>{data.canManage ? 'Choose an industry below to create your first space.' : 'Your Business membership owner can create an industry space for your team.'}</p>}
        <PagedList pageSize={4} label="Industry spaces">{data.workspaces.map(space => <article key={space.id} className="industry-space-card">
          <Layers size={20} /><div><h3>{space.name}</h3><p>{data.catalog.find(item => item.id === space.industryId)?.name} · {space.sourceIds.length} selected resources</p>
            <div className="industry-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => choose(space.industryId)} disabled={pending}>{data.canManage ? 'Resources & settings' : 'View resources'}</button>
              <Link className="btn btn-outline btn-sm" to={`/business/cross-post?workspace=${encodeURIComponent(space.id)}`}>Posts & publishing</Link></div></div>
        </article>)}</PagedList>
      </section>
      <form className="business-post-panel industry-editor" onSubmit={save}><h2>{existing ? 'Space resources' : 'Explore industries'}</h2>
        <label className="business-post-field">Industry<select aria-label="Industry" value={industryId} disabled={pending} onChange={event => choose(event.target.value)}>
          <option value="">Choose an industry</option>{data.catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {industry && <>
          <p>{industry.description}</p>
          <label className="business-post-field">Space name<input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required disabled={pending || !data.canManage} /></label>
          <fieldset className="industry-source-options"><legend>Official industry resources</legend>
            <p>These links open the source’s website. Selecting a resource saves it for your team; it does not connect an account or publish a post.</p>
            {industry.sources.map(source => <div className="industry-resource" key={source.id}>
              <label><input type="checkbox" checked={sourceIds.includes(source.id)} disabled={pending || !data.canManage} onChange={event => setSourceIds(old => event.target.checked ? [...old,source.id] : old.filter(id => id !== source.id))} /><strong>{source.name}</strong></label>
              <p>{source.description}</p><a href={source.url} target="_blank" rel="noopener noreferrer">Visit {source.name} <ArrowUpRight size={14} /></a>
            </div>)}
          </fieldset>
          {data.canManage ? <button type="submit" className="btn btn-primary" disabled={pending || name.trim().length < 2}><Save size={16} />{pending ? 'Saving…' : existing ? 'Save space settings' : 'Create industry space'}</button>
            : <p className="business-post-muted">Your membership owner manages shared space settings. You can publish using your own connected account.</p>}
          {existing && <Link className="btn btn-ghost" to={`/business/cross-post?workspace=${encodeURIComponent(existing.id)}`}>Open this space’s posts</Link>}
        </>}
      </form>
    </div>}
  </Layout>;
}
