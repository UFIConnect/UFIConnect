import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import SnapViewer from '../components/SnapViewer';
import ReportModal from '../components/ReportModal';
import '../components/SnapRail.css';

function SnapLinkContent({ id, profile }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true }), [reporting, setReporting] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false, request = 0;
    const abort = new AbortController();
    async function load() {
      const sequence = ++request;
      try {
        const { data } = await client.get(`/snaps/${encodeURIComponent(id)}`, { signal: abort.signal });
        if (cancelled || sequence !== request) return;
        if (data?.snap?.id !== id || data.snap.source !== 'uficonnect' || !Number.isFinite(Date.parse(data.snap.expiresAt))) throw new Error('Invalid Snap response');
        if (Date.parse(data.snap.expiresAt) <= Date.now()) { setState({ error: 'This Snap has expired.', unavailable: true }); return; }
        setState({ snap: data.snap });
      } catch (error) {
        if (cancelled || sequence !== request) return;
        const unavailable = [403, 404].includes(error.response?.status);
        setState({ unavailable, error: unavailable ? 'This Snap has expired or is not available to you.' : 'This Snap could not load. Please try again.' });
      }
    }
    if (!/^snap_[a-f0-9-]{36}$/i.test(id || '')) { setState({ unavailable: true, error: 'This Snap link is not valid.' }); return undefined; }
    load();
    const refresh = () => { if (!document.hidden) load(); };
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; request++; abort.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [id, retry]);
  useEffect(() => {
    if (!state.snap) return undefined;
    const timer = window.setTimeout(() => { setReporting(false); setState({ unavailable: true, error: 'This Snap has expired.' }); }, Math.max(0, Date.parse(state.snap.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [state.snap]);
  const close = () => navigate('/');
  async function remove(snapId) {
    const { data } = await client.delete(`/snaps/${encodeURIComponent(snapId)}`);
    if (data?.deleted !== true) throw new Error('Snap deletion was not confirmed.');
  }
  return <main className="snap-permalink-state">
    <Helmet><title>Snap | UFIConnect</title><meta name="robots" content="noindex, noarchive" /></Helmet>
    <section aria-label="Shared Snap"><h1>Snaps</h1>
      {state.loading && <p role="status">Loading Snap…</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {state.error && !state.unavailable && <button type="button" className="btn btn-primary" onClick={() => { setState({ loading: true }); setRetry(value => value + 1); }}>Try again</button>}
      {!profile?.id && state.unavailable && <p><Link to={`/login?returnTo=${encodeURIComponent(`/snaps/${id}`)}`}>Sign in to check your access</Link>. Sharing a link does not change its audience or expiry.</p>}
      <p><Link to="/">Back to UFIConnect</Link></p>
    </section>
    {state.snap && !reporting && <SnapViewer items={[state.snap]} index={0} profile={profile} now={Date.now()} onChange={() => {}} onClose={close}
      onDelete={remove} onReport={() => setReporting(true)} />}
    {state.snap && reporting && <ReportModal targetType="post" targetId={state.snap.id} targetLabel="snap" source="uficonnect"
      signInRequired={!profile?.id} onClose={() => setReporting(false)} />}
  </main>;
}

export default function SnapPermalink() {
  const { id } = useParams(), { profile, loading } = useAuth();
  if (loading) return <main className="snap-permalink-state"><p role="status">Checking your session…</p></main>;
  // Remount rather than reusing a private Snap across member changes, including
  // a switch away from and back to the same account during a pending request.
  return <SnapLinkContent key={`${profile?.id || 'guest'}:${id}`} id={id} profile={profile} />;
}
