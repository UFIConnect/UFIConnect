import { Link, Navigate, useLocation } from 'react-router-dom';
import { UsersRound, Link2, MessagesSquare, Send, ChartNoAxesCombined } from 'lucide-react';
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
      <p>Publish hiring posts, compare similar roles, find candidates, and manage your recruiting conversations.</p>
    </header>
    <section className="recruiting-stats" aria-label="Membership overview">
      <div><strong>{profile.businessSeats || 1}</strong><span>{profile.businessSeats > 1 ? 'people on your membership' : 'person on your membership'}</span></div>
      <div><strong>{profile.connectedPlatforms?.length || 0}</strong><span>connected recruiting accounts</span></div>
      <div><strong>Business</strong><span>Workspace for recruiting companies</span></div>
    </section>
    <section className="recruiting-actions" aria-label="Recruiting tools">
      <Link to="/career-posts"><Send size={25} /><h2>Cross Post</h2><p>Publish hiring posts to UFIConnect and LinkedIn, or prepare a draft for a career site.</p></Link>
      <Link to="/business-posts"><ChartNoAxesCombined size={25} /><h2>Posts & comparisons</h2><p>Review your hiring posts beside similar listings. Compare role details and available engagement counts.</p></Link>
      <Link to="/people"><UsersRound size={25} /><h2>Find candidates</h2><p>Search member profiles by name, role, organization, or skill. Contact candidates directly.</p></Link>
      <Link to="/connected-accounts"><Link2 size={25} /><h2>Career sources</h2><p>Review available career providers and manage the accounts your company connects.</p></Link>
      <Link to="/messages"><MessagesSquare size={25} /><h2>Recruiting conversations</h2><p>Continue candidate outreach and discuss open roles with your contacts.</p></Link>
    </section>
    <BusinessTeamSettings />
  </Layout>;
}
