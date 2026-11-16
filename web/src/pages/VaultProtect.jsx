import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useLocation } from 'react-router-dom';
import {
  BellRing, ChevronRight, ClipboardList, Fingerprint, Globe2, Image, KeyRound, LockKeyhole,
  Radar, ScanFace, ShieldCheck, Trash2, UserRoundSearch,
} from 'lucide-react';
import client from '../api/client';
import Layout from '../components/Layout';
import WebProtectionPanel from '../components/WebProtectionPanel';
import { useAuth } from '../contexts/AuthContext';
import { isNativeRuntime } from '../nativeRuntime.mjs';
import { VaultNavigation } from './VaultDevice';
import './VaultProtect.css';

const PRIVACY_LINKS = [
  { to: '/settings?tab=privacy', title: 'Profile visibility', description: 'Control who can see your profile and manage blocked accounts.' },
  { to: '/connected-accounts', title: 'Connected apps', description: 'Review and disconnect linked services.' },
  { to: '/settings?tab=account#your-data', title: 'Data download and removal', description: 'Download your UFIConnect data or delete your account.' },
  { to: '/settings?tab=data', title: 'Data use preferences', description: 'Manage optional analytics, diagnostics and location use.' },
];

const PLANNED_PROTECTIONS = [
  { Icon: UserRoundSearch, title: 'Impersonation monitoring', description: 'Lookalike profiles, copied photos and voice impersonation.' },
  { Icon: Radar, title: 'Scam and phishing detection', description: 'Automatic checks for suspicious links and accounts.' },
  { Icon: BellRing, title: 'Identity alerts', description: 'Notifications about suspected impersonation and identity threats.' },
  { Icon: Fingerprint, title: 'Verified identity', description: 'Profile verification and device-backed proof of identity.' },
  { Icon: Image, title: 'Media provenance', description: 'Check the origin and edit history of signed photos or videos.' },
  { Icon: Globe2, title: 'Scraping protection', description: 'Controls for automated collection of profile data.' },
  { Icon: ScanFace, title: 'AI usage controls', description: 'Manage AI use of your content and likeness.' },
  { Icon: Trash2, title: 'External data removal', description: 'Request removal of exposed personal information from third parties.' },
  { Icon: ClipboardList, title: 'Account access log', description: 'Review when your UFIConnect account was accessed.' },
];

const REPORT_TARGETS = { user: 'Profile', post: 'Post', comment: 'Comment' };
const REPORT_STATUSES = { open: 'Awaiting review', resolved: 'Review closed' };

function ProtectLink({ to, title, description, Icon }) {
  return <li>
    <Link to={to} className="vault-protect-link">
      {Icon && <Icon size={19} aria-hidden="true" />}
      <span><strong>{title}</strong><span>{description}</span></span>
      <ChevronRight className="vault-protect-chevron" size={16} aria-hidden="true" />
    </Link>
  </li>;
}

function IdentityReports() {
  const { token } = useAuth();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const current = result?.revision === revision && result.token === token ? result : null;
  const reports = current?.reports;

  useEffect(() => {
    const controller = new AbortController();
    client.get('/reports/identity', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) setResult({ revision, token, reports: Array.isArray(data?.reports) ? data.reports : null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ revision, token, reports: null });
      });
    return () => controller.abort();
  }, [revision, token]);

  return <div className="vault-protect-reports">
    <div className="vault-protect-reports-heading">
      <h3>Recent identity reports</h3>
      <button className="vault-button vault-button--secondary" type="button" disabled={!current}
        onClick={() => setRevision(value => value + 1)}>Refresh reports</button>
    </div>
    <div aria-busy={!current}>
      {!current ? <p role="status">Loading your reports…</p>
        : !reports ? <p role="alert">Your reports could not be loaded. Try refreshing.</p>
          : !reports.length ? <p>No impersonation reports submitted yet.</p>
            : <ul className="vault-protect-report-list">
              {reports.map(report => <li key={report.id}>
                <div>
                  <strong>{REPORT_TARGETS[report.targetType] || 'Content'} report</strong>
                  <time dateTime={report.createdAt}>{new Date(report.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}</time>
                  <span className="vault-protect-report-reference">{report.id}</span>
                </div>
                <span className="vault-status">{REPORT_STATUSES[report.status] || 'Status unavailable'}</span>
              </li>)}
            </ul>}
    </div>
  </div>;
}

export default function VaultProtect({ accountId }) {
  const { hash } = useLocation();
  const identitySection = useRef(null);
  const native = isNativeRuntime();

  useEffect(() => {
    if (hash !== '#identity-reports') return undefined;
    const frame = requestAnimationFrame(() => {
      identitySection.current?.focus({ preventScroll: true });
      identitySection.current?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash]);

  return <Layout wide>
    <Helmet><title>UFI Protect | UFIconnect</title><meta name="robots" content="noindex,nofollow" /></Helmet>
    <div className="vault-page vault-protect">
      <header className="vault-protect-hero">
        <div className="vault-protect-brand">
          <span className="vault-protect-mark"><ShieldCheck size={32} strokeWidth={1.6} aria-hidden="true" /></span>
          <div><h1>UFI Protect</h1><p>Check your connection, report impersonation and manage your privacy.</p></div>
        </div>
        <Link to="/vault/device" className="vault-protect-device">
          <LockKeyhole size={19} aria-hidden="true" />
          <span><strong>Vault Card</strong><span>Hardware locked</span></span>
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </header>

      <VaultNavigation />

      <div className="vault-protect-grid">
        <WebProtectionPanel accountId={accountId} variant="settings" />
        <section className="vault-panel" aria-labelledby="vault-protect-access">
          <h2 id="vault-protect-access">VPN and account access</h2>
          <ul className="vault-protect-links">
            <ProtectLink to="/vault?device=vpn#vpn" title="Device VPN" Icon={Globe2}
              description="Set up VPN on supported devices with a Vault membership." />
            <ProtectLink to="/vault#web-protection" title="Vault connection monitoring" Icon={Radar}
              description="Manage automatic connection checks on this browser." />
            <ProtectLink to="/vault" title="Vault unlock" Icon={KeyRound}
              description={native ? 'Use your Vault passphrase.' : 'Use your passphrase or supported device verification, including Face ID.'} />
            <ProtectLink to="/settings?tab=security" title="Sign-in and sessions" Icon={LockKeyhole}
              description="Manage your sign-in methods, password and sessions." />
          </ul>
        </section>

        <section ref={identitySection} className="vault-panel" id="identity-reports" tabIndex={-1} aria-labelledby="vault-protect-identity">
          <h2 id="vault-protect-identity">Identity Shield</h2>
          <p>Open the suspected profile, post or comment menu and choose <strong>Report</strong>, then select <strong>Impersonation</strong>.</p>
          <div className="vault-protect-actions">
            <Link className="vault-button vault-button--primary" to="/people">Find a profile</Link>
            <Link className="vault-text-button" to="/policies#reporting">Reporting and support <ChevronRight size={14} aria-hidden="true" /></Link>
          </div>
          <IdentityReports />
        </section>

        <section className="vault-panel" aria-labelledby="vault-protect-privacy">
          <h2 id="vault-protect-privacy">Data access &amp; privacy</h2>
          <ul className="vault-protect-links">
            {PRIVACY_LINKS.map(link => <ProtectLink key={link.to} {...link} />)}
          </ul>
        </section>
      </div>

      <section className="vault-panel vault-protect-planned" aria-labelledby="vault-protect-planned">
        <h2 id="vault-protect-planned">Planned protections</h2>
        <ul>
          {PLANNED_PROTECTIONS.map(({ Icon, title, description }) => <li key={title}>
            <Icon size={19} aria-hidden="true" />
            <div><h3>{title}</h3><p>{description}</p></div>
          </li>)}
        </ul>
      </section>
    </div>
  </Layout>;
}
