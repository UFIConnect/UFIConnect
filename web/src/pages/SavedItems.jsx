import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { SavedJobCard, SavedPostCard } from '../components/SavedCards';
import { useAuth } from '../contexts/AuthContext';
import { useSavedItems } from '../contexts/SavedItemsContext';
import client from '../api/client';

export default function SavedItems() {
  const { kind } = useParams();
  const { profile } = useAuth();
  const { savedJobs, refreshSavedJobs } = useSavedItems();
  const [posts, setPosts] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [contentHidden, setContentHidden] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);

  async function load(offset = 0, request = generation.current) {
    if (busy.current) return;
    busy.current = true;
    offset ? setLoadingMore(true) : setLoading(true);
    setError('');
    try {
      if (kind === 'jobs') await refreshSavedJobs();
      else {
        const { data } = await client.get('/saved/posts', { params: { limit: 50, offset } });
        if (request !== generation.current) return;
        const incoming = data.posts || [];
        setPosts(current => offset ? [...current, ...incoming.filter(post => !current.some(item => item.id === post.id))] : incoming);
        setHasMore(!!data.hasMore);
      }
    } catch {
      if (request === generation.current) setError(`Saved ${kind} could not be loaded. Please try again.`);
    } finally {
      if (request === generation.current) { busy.current = false; setLoading(false); setLoadingMore(false); }
    }
  }

  useEffect(() => {
    const request = ++generation.current;
    busy.current = false;
    setPosts([]);
    setContentHidden(false);
    setHasMore(false);
    if (['posts', 'jobs'].includes(kind)) load(0, request);
    return () => { generation.current++; };
  }, [kind, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!['posts', 'jobs'].includes(kind)) return <Navigate to="/saved/posts" replace />;
  const jobs = savedJobs.filter(job => ['saved', 'applied'].includes(job.status));
  const count = kind === 'jobs' ? jobs.length : posts.length;
  return <Layout><main className="saved-page">
    <h1>Saved</h1>
    <p>{kind === 'jobs' ? 'Keep opportunities and applications in one place.' : 'Return to the posts you want to keep.'}</p>
    <nav className="profile-content-tabs" aria-label="Saved pages">
      <Link to="/saved/posts" aria-current={kind === 'posts' ? 'page' : undefined}>Posts</Link>
      <Link to="/saved/jobs" aria-current={kind === 'jobs' ? 'page' : undefined}>Jobs</Link>
    </nav>
    <button type="button" className="btn btn-ghost btn-sm saved-content-toggle" aria-expanded={!contentHidden} aria-controls="saved-page-content" onClick={() => setContentHidden(hidden => !hidden)}>{contentHidden ? 'Show' : 'Hide'} saved {kind}</button>
    {contentHidden && <p className="saved-content-hidden">Saved {kind} are hidden.</p>}
    <section id="saved-page-content" aria-label={`Saved ${kind}`} hidden={contentHidden}>
    {error && <div className="card profile-saved-state" role="alert">{error}<button className="btn btn-ghost" onClick={() => load(posts.length || 0)}>Try again</button></div>}
    {loading ? <div className="profile-saved-state" role="status">Loading saved {kind}…</div> : <>
      {count > 0 ? <div className="profile-saved-list">
        {kind === 'jobs' ? jobs.map(job => <SavedJobCard key={job.id} job={job} />) : posts.map(post => <SavedPostCard key={post.id} post={post} onRemoved={id => setPosts(current => current.filter(item => item.id !== id))} />)}
      </div> : !error && <div className="card profile-saved-state"><strong>No saved {kind} yet</strong><p>Use Save on a {kind === 'jobs' ? 'job listing' : 'post'} to keep it here.</p><Link className="btn btn-primary" to={kind === 'jobs' ? '/opportunities' : '/'}>Browse {kind}</Link></div>}
      {kind === 'posts' && hasMore && <button className="btn btn-ghost profile-saved-load-more" disabled={loadingMore} onClick={() => load(posts.length)}>{loadingMore ? 'Loading…' : 'Load more saved posts'}</button>}
    </>}
    </section>
  </main></Layout>;
}
