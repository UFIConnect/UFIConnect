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
  const [job, setJob] = useState(() => {
    if (location.state?.job) return location.state.job;
    try {
      return JSON.parse(privateSessionStorage.getItem(`ufi_job_detail:${id}`) || 'null');
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(!job);

  useEffect(() => {
    if (job) return;
    let cancelled = false;
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
  }, [id, job]);

  return (
    <Layout>
      <Helmet>
        <title>{job ? `${job.title} at ${job.org}` : 'Job listing'} | UFIconnect</title>
      </Helmet>
      <div className="job-detail-page">
        <Link to="/opportunities" className="btn-back"><span className="btn-back-icon">&#8249;</span> Back to jobs</Link>
        {loading && <div className="splash">Loading job...</div>}
        {!loading && job && <JobCard job={job} />}
        {!loading && !job && (
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
