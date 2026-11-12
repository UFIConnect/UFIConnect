import { privateSessionStorage } from '../auth/session';
import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useLocation, useParams } from 'react-router-dom';
import { jobReadIdentity } from '../../../shared/job-read.mjs';
import Layout from '../components/Layout';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { recordJobRead } from '../utils/jobReads';
import { JobDetail as JobCard } from './Opportunities';

export default function JobDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { profile, token } = useAuth();
  const viewerId = profile?.id;
  const source = new URLSearchParams(location.search).get('source') || '';
  const detailScope = JSON.stringify([viewerId, location.key, id, source]);
  const [detail, setDetail] = useState(null);
  const job = detail?.scope === detailScope ? detail.job : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDetail(null); setError(''); setLoading(true);
    const sourceKey = jobReadIdentity({ id, source })?.source;
    const cacheKey = `ufi_job_detail:${JSON.stringify([viewerId, sourceKey || '', id])}`;
    const matches = candidate => String(candidate?.id ?? '') === id
      && (!source || jobReadIdentity(candidate)?.source === sourceKey);
    function show(candidate) {
      if (cancelled || !matches(candidate)) return;
      setDetail({ scope: detailScope, job: candidate });
      recordJobRead(viewerId, candidate, token);
    }
    if (sourceKey === 'uficonnect' || (!source && String(id).startsWith('bp_'))) {
      // Native listings must be revalidated even if navigation carries a
      // snapshot: a removed/reported/private job must not survive in a cache.
      client.get(`/opportunities/${encodeURIComponent(id)}`)
        .then(({ data }) => show(data.job))
        .catch(err => { if (!cancelled && err.response?.status !== 404) setError('This job could not be loaded. Please try again.'); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }
    let cached = location.state?.viewerId === viewerId && matches(location.state?.job) ? location.state.job : null;
    if (!cached) { try { cached = JSON.parse(privateSessionStorage.getItem(cacheKey) || 'null'); } catch {} }
    if (matches(cached)) {
      show(cached);
      privateSessionStorage.setItem(cacheKey, JSON.stringify(cached));
      setLoading(false);
      return () => { cancelled = true; };
    }
    client.get('/opportunities', { params: { type: 'job', sort: 'newest', limit: 500, ...(source ? { sources: source } : {}) } })
      .then(({ data }) => {
        if (cancelled) return;
        const match = (data.opportunities || []).find(matches);
        if (match) {
          show(match);
          privateSessionStorage.setItem(cacheKey, JSON.stringify(match));
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [detailScope, id, location.state, retry, source, token, viewerId]);

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
