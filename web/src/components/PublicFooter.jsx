import { Link } from 'react-router-dom';
import './PublicFooter.css';

const links = [
  ['/', 'Home'],
  ['/global', 'Global feed'],
  ['/search', 'Search'],
  ['/login', 'Sign in'],
  ['/register', 'Create account'],
  ['/privacy', 'Privacy policy'],
  ['/terms', 'Terms of service'],
  ['/child-safety', 'Child safety'],
];

export default function PublicFooter() {
  return (
    <footer className="public-footer">
      <nav aria-label="Public site links">
        {links.map(([to, label]) => <Link key={to} to={to}>{label}</Link>)}
      </nav>
      <p>UFIconnect — social connection and job discovery.</p>
    </footer>
  );
}
