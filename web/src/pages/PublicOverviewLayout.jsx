import { NavLink, Link } from 'react-router-dom';
import LegalLinks from '../components/LegalLinks';
import './PublicOverviews.css';

export default function PublicOverviewLayout({ children }) {
  return <div className="public-overview">
    <a className="public-overview-skip" href="#overview-content">Skip to content</a>
    <header className="public-overview-header">
      <Link to="/" className="public-overview-brand">UFI<span>connect</span></Link>
      <nav aria-label="Explore UFIconnect">
        <NavLink to="/vault-device">Vault device</NavLink>
        <NavLink to="/how-office-works">How Office works</NavLink>
        <Link to="/login">Sign in</Link>
      </nav>
    </header>
    <main id="overview-content" className="public-overview-main" tabIndex={-1}>{children}</main>
    <footer className="public-overview-footer">
      <Link to="/">Back to the homepage</Link>
      <LegalLinks />
    </footer>
  </div>;
}
