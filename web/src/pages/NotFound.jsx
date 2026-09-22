import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import GuestShell from '../components/GuestShell';

export default function NotFound() {
  return <GuestShell><Helmet><title>Page not found | UFIconnect</title><meta name="robots" content="noindex, follow" /></Helmet>
    <main className="public-guide">
      <p>404 · Page not found</p><h1>We couldn’t find that page</h1>
      <p>The link may be outdated or the address may be incorrect. Check the address, return home, or explore the public feed.</p>
      <nav aria-label="Find another page"><Link to="/">Home</Link><Link to="/global">Explore the feed</Link><Link to="/search">Search guide</Link><Link to="/login">Sign in</Link></nav>
    </main>
  </GuestShell>;
}
