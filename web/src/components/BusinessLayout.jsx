import { Link, NavLink, useNavigate } from 'react-router-dom';
import { BriefcaseBusiness, UsersRound, Link2, MessagesSquare, Settings, FileText, LockKeyhole, Send, ChartNoAxesCombined } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import './business.css';

const destinations = [
  { to: '/recruiting', label: 'Workspace', Icon: BriefcaseBusiness },
  { to: '/business/industries', label: 'Industry spaces', Icon: BriefcaseBusiness },
  { to: '/opportunities', label: 'Jobs', Icon: BriefcaseBusiness },
  { to: '/jobs/new', label: 'Post a job', Icon: FileText },
  { to: '/people', label: 'Candidates', Icon: UsersRound },
  { to: '/connected-accounts', label: 'Connected sources', Icon: Link2 },
  { to: '/business/cross-post', label: 'Cross Post', Icon: Send },
  { to: '/career-posts', label: 'Hiring cross-post', Icon: Send },
  { to: '/business-posts', label: 'Posts & comparisons', Icon: ChartNoAxesCombined },
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
      <nav className="business-nav" aria-label="Business workspace">{availableDestinations.map(({ to, label, Icon }) =>
        <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}><Icon size={18} aria-hidden="true" />{label}</NavLink>)}
        <p>Industry spaces and publishing for your company</p>
      </nav>
      <main className="business-main">{children}</main>
    </div>
  </div>;
}
