import AppearanceControl from '../components/AppearanceControl';
import { NavLink, Link } from 'react-router-dom';
import LegalLinks from '../components/LegalLinks';
import './PublicOverviews.css';

export default function PublicOverviewLayout({ children }) {
  return <div className="public-overview">
    <a className="public-overview-skip" href="#overview-content">Skip to content</a>
    <header className="public-overview-header">
      <Link to="/" className="public-overview-brand"><img src="/uficonnect-wordmark.svg?v=blue-ufi-20261006" alt="UFIConnect" width="180" height="36" /></Link>
      <nav aria-label="Explore UFIconnect"><div className="public-theme-control"><AppearanceControl compact /></div>
        <NavLink to="/global">Global Feed</NavLink>
        <NavLink to="/vault-device">Vault device</NavLink>
        <NavLink to="/how-it-works">How UFIC works</NavLink>
        <Link to="/login">Sign in</Link>
        <Link to="/register" className="public-overview-button">Join free</Link>
      </nav>
    </header>
    <main id="overview-content" className="public-overview-main" tabIndex={-1}>{children}</main>
    <footer className="public-overview-footer">
      <Link to="/">Back to the homepage</Link>
      <LegalLinks />
    </footer>
  </div>;
}
