import { privateSessionStorage } from '../auth/session';
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useLocation, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import client from '../api/client';
import { JobDetail as JobCard } from './Opportunities';

export default function JobDetail() {
  const { id } = useParams();
  const location = useLocation();
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setJob(null); setError(''); setLoading(true);
    if (String(id).startsWith('bp_')) {
      // Native listings must be revalidated even if navigation carries a
      // snapshot: a removed/reported/private job must not survive in a cache.
      client.get(`/opportunities/${encodeURIComponent(id)}`)
        .then(({ data }) => { if (!cancelled) setJob(data.job || null); })
        .catch(err => { if (!cancelled && err.response?.status !== 404) setError('This job could not be loaded. Please try again.'); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    let cached = location.state?.job?.id === id ? location.state.job : null;
    if (!cached) { try { cached = JSON.parse(privateSessionStorage.getItem(`ufi_job_detail:${id}`) || 'null'); } catch {} }
    if (cached && String(cached.id) === String(id)) { setJob(cached); setLoading(false); return () => { cancelled = true; }; }
    client.get('/opportunities', { params: { type: 'job', sort: 'newest', limit: 500 } })
      .then(({ data }) => {
        if (cancelled) return;
        const match = (data.opportunities || []).find((item) => String(item.id) === String(id));
        if (match) {
          setJob(match);
          try { privateSessionStorage.setItem(`ufi_job_detail:${id}`, JSON.stringify(match)); } catch {}
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, location.key, retry]);

  return (
    <Layout>
      <Helmet>
        <title>{job ? `${job.title} at ${job.org}` : 'Job listing'} | UFIconnect</title>
      </Helmet>
      <div className="job-detail-page">
        <Link to="/opportunities" className="btn-back"><span className="btn-back-icon">&#8249;</span> Back to jobs</Link>
        {loading && <div className="splash">Loading job...</div>}
        {!loading && error && <div className="card search-empty-state" role="alert"><p>{error}</p><button type="button" className="btn btn-outline" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
        {!loading && job && <JobCard job={job} />}
        {!loading && !job && !error && (
          <div className="card search-empty-state">
            <strong>This listing is no longer in the live job feed.</strong>
            <p>It may have closed or been removed by its source.</p>
            <Link to="/opportunities" className="btn btn-primary btn-sm">Browse current jobs</Link>
          </div>
        )}
      </div>
    </Layout>
  );
}
