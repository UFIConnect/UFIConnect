import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

const EFFECTIVE_DATE = 'August 25, 2026';
const CONTACT_EMAIL  = 'support@uficonnect.org';
const APP_NAME       = 'UFIconnect';
const APP_URL        = 'https://uficonnect.org';

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{
        fontSize: '1.05rem', fontWeight: 800, color: '#0F172A',
        marginBottom: 12, paddingBottom: 8,
        borderBottom: '1px solid #E2E8F0',
      }}>{title}</h2>
      <div style={{ color: '#334155', lineHeight: 1.75, fontSize: '.9rem' }}>
        {children}
      </div>
    </section>
  );
}

function P({ children }) {
  return <p style={{ marginBottom: 10 }}>{children}</p>;
}

function UL({ items }) {
  return (
    <ul style={{ paddingLeft: 20, marginBottom: 10 }}>
      {items.map((item, i) => (
        <li key={i} style={{ marginBottom: 6 }}>{item}</li>
      ))}
    </ul>
  );
}

export default function ChildSafety() {
  return (
    <>
      <Helmet>
        <title>Child Safety Standards — UFIconnect</title>
        <meta name="description" content="UFIconnect's standards on child sexual abuse and exploitation (CSAE): what we prohibit, how to report a concern, and what happens next." />
        <link rel="canonical" href="https://uficonnect.org/child-safety" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://uficonnect.org/child-safety" />
        <meta property="og:title" content="Child Safety Standards | UFIconnect" />
        <meta property="og:description" content="Our standards on child sexual abuse and exploitation, and how to report a concern." />
      </Helmet>

      {/* Nav bar */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: '#fff', borderBottom: '1px solid #E2E8F0',
        padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 56,
      }}>
        <Link to="/" style={{ fontWeight: 900, fontSize: '1.1rem', color: 'var(--primary)', textDecoration: 'none' }}>
          {APP_NAME}
        </Link>
        <div style={{ display: 'flex', gap: 16, fontSize: '.85rem' }}>
          <Link to="/login"    style={{ color: '#64748B', textDecoration: 'none' }}>Sign in</Link>
          <Link to="/register" className="btn btn-primary btn-sm">Join free</Link>
        </div>
      </header>

      {/* Content */}
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 80px' }}>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
            Legal
          </div>
          <h1 style={{ fontSize: '2rem', fontWeight: 900, color: '#0F172A', marginBottom: 12 }}>
            Child Safety Standards
          </h1>
          <p style={{ color: '#64748B', fontSize: '.88rem' }}>
            Effective date: <strong>{EFFECTIVE_DATE}</strong> &nbsp;·&nbsp; Applies to {APP_URL}
          </p>
        </div>

        <Section title="1. Our commitment">
          <P>
            {APP_NAME} has zero tolerance for child sexual abuse and exploitation ("CSAE"). We do not
            permit content, behaviour, or use of the Service that sexualises, endangers, or exploits
            minors, under any circumstances. This page describes what we prohibit, how to report a
            concern, and what happens after you report one.
          </P>
        </Section>

        <Section title="2. Who can use UFIconnect">
          <P>
            {APP_NAME} is a professional networking platform intended for users who are at least 13
            years old (16 in the EU/EEA/UK), consistent with our{' '}
            <Link to="/terms" style={{ color: 'var(--primary)' }}>Terms of Service</Link>. It is not
            directed at children and is not designed or marketed to appeal primarily to minors.
          </P>
        </Section>

        <Section title="3. What we prohibit">
          <P>The following are never allowed on {APP_NAME}, without exception:</P>
          <UL items={[
            'Child sexual abuse material (CSAM) in any form, real or synthetic (including AI-generated)',
            'Grooming, sextortion, or any attempt to solicit a minor',
            'Sexualisation of minors in images, text, or any other content',
            'Content or behaviour that otherwise endangers a minor\'s physical or psychological well-being',
            'Using the Service to contact, recruit, or arrange to meet a minor for an exploitative purpose',
          ]} />
        </Section>

        <Section title="4. How to report a concern">
          <P>
            Every profile and every post on {APP_NAME} has a <strong>Report</strong> option — open
            the "•••" menu on a profile, or the "•••" menu on a post, choose <strong>Report</strong>,
            and select <strong>"Child safety concern"</strong> as the reason. Reports filed under this
            reason are routed to our team for immediate review.
          </P>
          <P>
            If you can't access the in-app report option, or a child is in immediate danger, email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--primary)' }}>{CONTACT_EMAIL}</a>{' '}
            directly. In an emergency, contact local law enforcement first. In the United States, you can
            also report CSAE material directly to the National Center for Missing & Exploited Children
            (NCMEC) at{' '}
            <a href="https://report.cybertip.org" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
              report.cybertip.org
            </a>.
          </P>
        </Section>

        <Section title="5. What happens after you report">
          <UL items={[
            'Our team reviews every report — reports involving a child\'s safety are treated as highest priority.',
            'Content that violates this policy is removed, and the account responsible is suspended or permanently banned.',
            'Where required by law, we cooperate with law enforcement and report apparent CSAE violations to NCMEC or other appropriate authorities.',
            'We keep the details of individual reports confidential, to protect both the reporter and any minor involved.',
          ]} />
        </Section>

        <Section title="6. Contact">
          <P>
            To report a concern, ask a question about this policy, or follow up on a report you've
            already filed, email{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--primary)' }}>{CONTACT_EMAIL}</a>.
          </P>
        </Section>

        {/* Footer links */}
        <div style={{
          marginTop: 48, paddingTop: 24, borderTop: '1px solid #E2E8F0',
          display: 'flex', gap: 24, flexWrap: 'wrap',
          fontSize: '.82rem', color: '#94A3B8',
        }}>
          <Link to="/"         style={{ color: '#64748B', textDecoration: 'none' }}>Home</Link>
          <Link to="/terms"    style={{ color: '#64748B', textDecoration: 'none' }}>Terms of Service</Link>
          <Link to="/privacy"  style={{ color: '#64748B', textDecoration: 'none' }}>Privacy Policy</Link>
          <span>© {new Date().getFullYear()} {APP_NAME}</span>
        </div>
      </main>
    </>
  );
}
