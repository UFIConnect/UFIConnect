import { Link, Navigate, useLocation } from 'react-router-dom';
import { UsersRound, Link2, MessagesSquare } from 'lucide-react';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import BusinessTeamSettings from '../components/BusinessTeamSettings';
import { useAuth } from '../contexts/AuthContext';

export default function Recruiting() {
  const { profile } = useAuth();
  const { hash } = useLocation();
  if (new URLSearchParams(hash.slice(1)).has('invite')) return <Layout><BusinessTeamSettings /></Layout>;
  if (profile?.plan !== 'business') return <Navigate to="/settings" replace />;
  return <Layout>
    <Helmet><title>Recruiting workspace | UFIconnect Business</title><meta name="robots" content="noindex" /></Helmet>
    <header className="recruiting-heading"><span className="recruiting-eyebrow">Business membership active</span>
      <h1>{profile.organization ? `${profile.organization} recruiting` : 'Your recruiting workspace'}</h1>
      <p>Find candidates, connect your career sources, and start conversations about the roles you are hiring for.</p>
    </header>
    <section className="recruiting-stats" aria-label="Membership overview">
      <div><strong>{profile.businessSeats || 1}</strong><span>{profile.businessSeats > 1 ? 'people on your membership' : 'person on your membership'}</span></div>
      <div><strong>{profile.connectedPlatforms?.length || 0}</strong><span>connected career sources</span></div>
      <div><strong>Business</strong><span>Workspace for recruiting companies</span></div>
    </section>
    <section className="recruiting-actions" aria-label="Recruiting tools">
      <Link to="/people"><UsersRound size={25} /><h2>Find candidates</h2><p>Search member profiles by name, role, organization, or skill. Contact candidates directly.</p></Link>
      <Link to="/connected-accounts"><Link2 size={25} /><h2>Career sources</h2><p>Review available career providers and manage the accounts your company connects.</p></Link>
      <Link to="/messages"><MessagesSquare size={25} /><h2>Recruiting conversations</h2><p>Continue candidate outreach and discuss open roles with your contacts.</p></Link>
    </section>
    <BusinessTeamSettings />
  </Layout>;
}
