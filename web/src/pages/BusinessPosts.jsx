import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Plus, ArrowLeft, ArrowRight, Copy, RefreshCw } from 'lucide-react';
import Layout from '../components/Layout';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { summarizeJob } from '../utils/jobSummary.mjs';
import { trackCategoryview } from '../analytics';

const when = value => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unavailable';
const lines = value => String(value || '').split(/\n+/).map(line => line.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
function Metrics({ post }) {
  return <div><dl className="business-post-metrics">{['likes', 'comments', 'views'].map(key => <div key={key}><dt>{key}</dt><dd>{post.metrics?.[key] === null || post.metrics?.[key] === undefined ? 'Unavailable' : Number(post.metrics[key]).toLocaleString()}</dd></div>)}</dl><p className="business-post-muted">{post.metricScope}</p></div>;
}
function Detail({ post, own = false }) {
  const details = post.details || post;
  const summary = summarizeJob({ ...details, ...post });
  const duties = own ? lines(details.duties) : summary.tasks;
  const requirements = own ? lines(details.requirements) : summary.requirements;
  return <article className="business-post-panel business-comparison-card">
    <span className="recruiting-eyebrow">{own ? 'Your hiring post' : post.source}</span><h3>{details.title}</h3><p>{details.company || 'Company not listed'}</p>
    <dl className="business-post-facts"><div><dt>Location</dt><dd>{details.location || 'Not listed'}</dd></div><div><dt>Pay</dt><dd>{details.pay || 'Not listed'}</dd></div><div><dt>{own && post.status === 'draft' ? 'Saved' : 'Posted'}</dt><dd>{when(post.createdAt)}</dd></div></dl>
    <h4>Role description</h4><p>{own ? details.description : summary.intro || 'No role description was supplied.'}</p>
    <h4>Responsibilities</h4>{duties.length ? <ul>{duties.slice(0, 8).map((duty, i) => <li key={i}>{duty}</li>)}</ul> : <p className="business-post-muted">See the full description for role tasks.</p>}
    <h4>Requirements</h4>{requirements.length ? <ul>{requirements.slice(0, 8).map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="business-post-muted">No separate requirements section was provided.</p>}
    <h4>Role task summary</h4><p>{summary.summary || 'Specific tasks were not supplied in this listing.'}</p>
    <h4>Engagement</h4><Metrics post={post} />
    <details className="business-post-full"><summary>Read complete post</summary><pre>{post.content}</pre></details>
    {!own && post.source !== 'UFIConnect' && post.sourceUrl && <a className="btn btn-outline btn-sm" href={post.sourceUrl} target="_blank" rel="noopener noreferrer">Open original job listing</a>}
    {own && post.targets?.length > 0 && <div className="business-post-outcomes">{post.targets.map(target => <p key={target.platform}>{target.platform === 'uficonnect' ? 'UFIConnect' : 'LinkedIn'}: {target.status}{target.error && <span>{target.error}</span>}{target.platform === 'linkedin' && target.postedUrl && <a href={target.postedUrl} target="_blank" rel="noopener noreferrer">View on LinkedIn</a>}</p>)}</div>}
  </article>;
}
export default function BusinessPosts() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const postId = params.get('post');
  const [page, setPage] = useState(1);
  const [similarPage, setSimilarPage] = useState(1);
  const [listing, setListing] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { setSimilarPage(1); setComparison(null); }, [postId]);
  useEffect(() => {
    let active = true; setPending(true); setError('');
    const endpoint = postId ? `/business/posts/${encodeURIComponent(postId)}/similar?page=${similarPage}` : `/business/posts?page=${page}`;
    trackCategoryview(postId ? 'business_posts_compare' : 'business_posts_list', `${postId ? 'compare' : 'list'}:${refresh}`);
    api.get(endpoint).then(({ data }) => { if (!active) return; if (postId) { setComparison(data); setSelected(data.posts[0]?.id || ''); } else setListing(data); })
      .catch(err => { if (active) setError(err.response?.data?.message || 'Could not load hiring posts. Please try again.'); })
      .finally(() => { if (active) setPending(false); });
    return () => { active = false; };
  }, [postId, page, similarPage, refresh]);
  if (profile?.plan !== 'business') return <Navigate to="/settings" replace />;
  function reuse(post) { sessionStorage.setItem(`ufi_business_post_draft:${profile.id}`, JSON.stringify(post.details)); }
  const other = comparison?.posts.find(post => post.id === selected);
  return <Layout>
    <Helmet><title>Posts & comparisons | UFIConnect Business</title><meta name="robots" content="noindex" /></Helmet>
    <header className="recruiting-heading"><span className="recruiting-eyebrow">Business hiring posts</span><h1>Posts & comparisons</h1><p>Review your saved and published posts. Compare the role, responsibilities, requirements, pay and available engagement with similar listings.</p>
      <div className="business-post-buttons"><Link className="btn btn-primary btn-sm" to="/career-posts"><Plus size={16} />Cross Post</Link><button className="btn btn-outline btn-sm" disabled={pending} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={16} />Refresh</button></div>
    </header>
    {error && <div className="business-post-alert" role="alert">{error}</div>}
    {pending && <p role="status">Loading hiring posts…</p>}
    {!postId && !pending && !error && <>
      {!listing?.posts.length && <section className="business-post-panel"><h2>No hiring posts yet</h2><p>Create a hiring post in Cross Post, then save a draft or publish it. Your posts and comparisons will appear here.</p><Link className="btn btn-outline" to="/career-posts">Create a hiring post</Link></section>}
      <div className="business-post-list">{listing?.posts.map(post => <article className="business-post-panel" key={post.id}><div className="business-post-card-header"><span className="business-post-status">{post.status}</span><time>{when(post.createdAt)}</time></div><h2>{post.details.title}</h2><p>{post.details.company} {post.details.location && `· ${post.details.location}`}</p><p>{post.details.description}</p><Metrics post={post} /><div className="business-post-buttons"><button className="btn btn-primary btn-sm" onClick={() => { setComparison(null); setParams({ post: post.id }); }}>View & compare</button><Link className="btn btn-outline btn-sm" to="/career-posts" onClick={() => reuse(post)}><Copy size={16} />Use as new draft</Link></div></article>)}</div>
      {(page > 1 || listing?.hasMore) && <nav className="recruiting-pagination" aria-label="Your hiring posts pages"><button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ArrowLeft size={16} />Previous</button><span>Page {page}</span><button className="btn btn-outline btn-sm" disabled={!listing?.hasMore} onClick={() => setPage(value => value + 1)}>Next<ArrowRight size={16} /></button></nav>}
    </>}
    {postId && <button className="btn btn-ghost btn-sm" onClick={() => setParams({})}><ArrowLeft size={16} />All your posts</button>}
    {postId && comparison && !pending && !error && <>
      <section className="business-post-panel business-similar-picker"><h2>Similar roles ({comparison.total})</h2><p className="business-post-muted">Matched by shared role-title words and description terms. Counts are current totals on each post; posting dates and source audiences differ.</p>
        {comparison.warning && <p role="status">{comparison.warning}</p>}
        {comparison.posts.length > 0 ? <><label className="business-post-field">Compare with<select value={selected} onChange={event => setSelected(event.target.value)}>{comparison.posts.map(post => <option key={post.id} value={post.id}>{post.title} · {post.company} · {post.source}</option>)}</select></label><p className="business-post-muted">Shared role terms: {other?.match.titleTerms.join(', ')}{other?.match.sharedTerms.length > 0 && ` · Shared description terms: ${other.match.sharedTerms.slice(0, 6).join(', ')}`}</p></> : <p>No similar live listings are available for this role. You can still read your complete post below.</p>}
        {(similarPage > 1 || comparison.hasMore) && <nav className="recruiting-pagination" aria-label="Similar roles pages"><button className="btn btn-outline btn-sm" disabled={similarPage <= 1} onClick={() => setSimilarPage(value => value - 1)}>Previous roles</button><span>Page {similarPage}</span><button className="btn btn-outline btn-sm" disabled={!comparison.hasMore} onClick={() => setSimilarPage(value => value + 1)}>More roles</button></nav>}
      </section>
      <div className="business-comparison-grid"><Detail post={comparison.post} own />{other && <Detail post={other} />}</div>
    </>}
  </Layout>;
}
