import PublicBrand from '../components/PublicBrand';
import { NavLink, Link } from 'react-router-dom';
import LegalLinks from '../components/LegalLinks';
import './PublicOverviews.css';

export default function PublicOverviewLayout({ children }) {
  return <div className="public-overview">
    <a className="public-overview-skip" href="#overview-content">Skip to content</a>
    <header className="public-overview-header">
      <Link to="/" className="public-overview-brand"><PublicBrand /></Link>
      <nav aria-label="Explore UFIconnect">
        <NavLink to="/global">Global Feed</NavLink>
        <NavLink to="/vault-device">Vault device</NavLink>
        <NavLink to="/how-it-works">How UFI works</NavLink>
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
