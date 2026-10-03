import { Link, NavLink, useNavigate } from 'react-router-dom';
import { BriefcaseBusiness, UsersRound, Link2, MessagesSquare, Settings, FileText, LockKeyhole } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import './business.css';

const destinations = [
  { to: '/recruiting', label: 'Workspace', Icon: BriefcaseBusiness },
  { to: '/people', label: 'Candidates', Icon: UsersRound },
  { to: '/connected-accounts', label: 'Career sources', Icon: Link2 },
  { to: '/messages', label: 'Messages', Icon: MessagesSquare },
  { to: '/settings', label: 'Settings & billing', Icon: Settings },
];

export default function BusinessLayout({ children }) {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const availableDestinations = [...destinations,
    ...(profile?.resumeBuilderAddon ? [{ to: '/resume-builder', label: 'Resume Builder', Icon: FileText }] : []),
    ...(profile?.vpnConnectorAddon ? [{ to: '/vault', label: 'Vault', Icon: LockKeyhole }] : []),
  ];
  return <div className="business-shell">
    <header className="business-header">
      <Link to="/recruiting" className="business-brand">UFIconnect <span>Business</span></Link>
      <div><span>{profile?.organization || profile?.name}</span><button className="btn btn-ghost btn-sm" onClick={async () => { await logout(); navigate('/login'); }}>Log out</button></div>
    </header>
    <div className="business-body">
      <nav className="business-nav" aria-label="Recruiting workspace">{availableDestinations.map(({ to, label, Icon }) =>
        <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}><Icon size={18} aria-hidden="true" />{label}</NavLink>)}
        <p>Recruiting tools for your company</p>
      </nav>
      <main className="business-main">{children}</main>
    </div>
  </div>;
}
