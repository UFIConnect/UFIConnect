import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { SavedJobCard, SavedPostCard } from '../components/SavedCards';
import { useAuth } from '../contexts/AuthContext';
import { useSavedItems } from '../contexts/SavedItemsContext';
import usePostPages, { POST_PAGE_SIZE } from '../hooks/usePostPages';
import PostPagesNavigation from '../components/PostPagesNavigation';
import ResultsPagination from '../components/ResultsPagination';

export default function SavedItems() {
  const { kind } = useParams();
  const { profile } = useAuth();
  const { savedJobs, refreshSavedJobs } = useSavedItems();
  const postPages = usePostPages({ endpoint: '/saved/posts', viewerId: profile?.id, enabled: kind === 'posts' });
  const [jobPage, setJobPage] = useState(1);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState('');
  const [retryJobs, setRetryJobs] = useState(0);
  const [contentHidden, setContentHidden] = useState(false);

  useEffect(() => {
    setJobPage(1);
    setContentHidden(false);
  }, [kind, profile?.id]);
  useEffect(() => {
    let active = true;
    if (kind !== 'jobs' || !profile?.id) return undefined;
    setJobsLoading(true);
    setJobsError('');
    Promise.resolve().then(() => refreshSavedJobs()).catch(() => {
      if (active) setJobsError('Saved jobs could not be loaded. Please try again.');
    }).finally(() => { if (active) setJobsLoading(false); });
    return () => { active = false; };
  }, [kind, profile?.id, retryJobs, refreshSavedJobs]);

  const jobs = savedJobs.filter(job => ['saved', 'applied'].includes(job.status));
  const jobTotalPages = Math.max(1, Math.ceil(jobs.length / POST_PAGE_SIZE));
  const currentJobPage = Math.min(jobPage, jobTotalPages);
  useEffect(() => { setJobPage(page => Math.min(page, jobTotalPages)); }, [jobTotalPages]);
  if (!['posts', 'jobs'].includes(kind)) return <Navigate to="/saved/posts" replace />;
  const visibleJobs = jobs.slice((currentJobPage - 1) * POST_PAGE_SIZE, currentJobPage * POST_PAGE_SIZE);
  const posts = postPages.items;
  const loading = kind === 'jobs' ? jobsLoading : postPages.loading && !posts.length;
  const error = kind === 'jobs' ? jobsError : postPages.error;
  const count = kind === 'jobs' ? jobs.length : posts.length;
  function changeJobPage(page) {
    setJobPage(page);
    document.getElementById('saved-page-content')?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  return <Layout><main className="saved-page paginated-feed-page">
    <h1>Saved</h1>
    <p>{kind === 'jobs' ? 'Keep opportunities and applications in one place.' : 'Return to the posts you want to keep.'}</p>
    <nav className="profile-content-tabs" aria-label="Saved pages">
      <Link to="/saved/posts" aria-current={kind === 'posts' ? 'page' : undefined}>Posts</Link>
      <Link to="/saved/jobs" aria-current={kind === 'jobs' ? 'page' : undefined}>Jobs</Link>
    </nav>
    <button type="button" className="btn btn-ghost btn-sm saved-content-toggle" aria-expanded={!contentHidden} aria-controls="saved-page-content" onClick={() => setContentHidden(hidden => !hidden)}>{contentHidden ? 'Show' : 'Hide'} saved {kind}</button>
    {contentHidden && <p className="saved-content-hidden">Saved {kind} are hidden.</p>}
    <section id="saved-page-content" aria-label={`Saved ${kind}`} hidden={contentHidden} style={{ scrollMarginTop: 80 }}>
    {kind === 'jobs' && jobsError && <div className="card profile-saved-state" role="alert">{jobsError}<button type="button" className="btn btn-ghost" disabled={jobsLoading} onClick={() => setRetryJobs(value => value + 1)}>Try again</button></div>}
    {loading ? <div className="profile-saved-state" role="status">Loading saved {kind}…</div> : <>
      {count > 0 ? <div className="profile-saved-list">
        {kind === 'jobs' ? visibleJobs.map(job => <SavedJobCard key={job.id} job={job} />) : posts.map(post => <SavedPostCard key={post.id} post={post} onRemoved={() => postPages.refresh()} />)}
      </div> : !error && <div className="card profile-saved-state"><strong>No saved {kind} yet</strong><p>Use Save on a {kind === 'jobs' ? 'job listing' : 'post'} to keep it here.</p><Link className="btn btn-primary" to={kind === 'jobs' ? '/opportunities' : '/'}>Browse {kind}</Link></div>}
    </>}
    {kind === 'posts' ? <PostPagesNavigation results={postPages} targetId="saved-page-content" label="Saved post pages" /> : count > 0 && <ResultsPagination page={currentJobPage} totalPages={jobTotalPages} hasNext={currentJobPage < jobTotalPages} loading={jobsLoading} onPageChange={changeJobPage} ariaLabel="Saved job pages" />}
    </section>
  </main></Layout>;
}
