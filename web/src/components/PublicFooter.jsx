import { Link } from 'react-router-dom';
import LegalLinks from './LegalLinks';
import './PublicFooter.css';

const links = [
  ['/', 'Home'],
  ['/global', 'Global feed'],
  ['/search', 'Search'],
  ['/login', 'Sign in'],
  ['/register', 'Create account'],
];

export default function PublicFooter() {
  return (
    <footer className="public-footer">
      <nav aria-label="Public site links">
        {links.map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}
      </nav>
      <LegalLinks />
      <p>UFIconnect — social connection and job discovery.</p>
    </footer>
  );
}
