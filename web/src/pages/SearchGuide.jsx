import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GuestShell from '../components/GuestShell';

export default function SearchGuide() {
  return <GuestShell><Helmet><title>Find posts, people, groups and jobs | UFIconnect</title><meta name="description" content="Learn how to search UFIconnect for posts, people, groups and job opportunities. Browse the public feed or sign in to use search filters." /><link rel="canonical" href="https://uficonnect.org/search" /></Helmet>
    <main className="public-guide">
      <h1>Find posts, people, groups and jobs</h1>
      <p>Search brings the different parts of UFIconnect together. Sign in to search member profiles, discover communities, find posts by topic, and explore job opportunities.</p>
      <h2>Start with what you want to find</h2>
      <ul><li><strong>Posts:</strong> try an interest, subject, or keyword, then choose the sources that matter to you.</li>
        <li><strong>People:</strong> look for a name, shared interest, or professional connection.</li>
        <li><strong>Groups:</strong> find a community around a topic and review its description before joining.</li>
        <li><strong>Jobs:</strong> use a role, skill, or location to narrow the opportunities you explore.</li></ul>
      <p>Use a short, specific phrase first. If there are no useful results, try a broader term or adjust your filters. Search results depend on the content available and your account access.</p>
      <nav aria-label="Start exploring"><Link to="/login">Sign in to search</Link><Link to="/register">Create an account</Link><Link to="/global">Browse the public feed</Link></nav>
      <p>You can browse public posts before creating an account. Read our <Link to="/privacy">privacy policy</Link> to understand how account and activity data are handled.</p>
    </main>
  </GuestShell>;
}
