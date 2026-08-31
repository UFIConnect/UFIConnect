import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

const EFFECTIVE_DATE = 'May 28, 2026';
const CONTACT_EMAIL  = 'privacy@uficonnect.org';
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

export default function PrivacyPolicy() {
  return (
    <>
      <Helmet>
        <title>Privacy Policy — UFIconnect</title>
        <meta name="description" content="UFIconnect privacy policy — how we collect, use, and protect your data." />
        <link rel="canonical" href="https://uficonnect.org/privacy" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://uficonnect.org/privacy" />
        <meta property="og:title" content="Privacy Policy | UFIconnect" />
        <meta property="og:description" content="How UFIconnect collects, uses, and protects your data." />
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
            Privacy Policy
          </h1>
          <p style={{ color: '#64748B', fontSize: '.88rem' }}>
            Effective date: <strong>{EFFECTIVE_DATE}</strong> &nbsp;·&nbsp; Applies to {APP_URL}
          </p>
        </div>

        <Section title="1. Who we are">
          <P>
            {APP_NAME} ("we", "us", or "our") operates the professional networking platform at {APP_URL}.
            We connect professionals through a personalised content feed, communities, messaging, and
            job opportunities. This policy explains what personal data we collect, why we collect it,
            and how you can control it.
          </P>
          <P>
            Questions? Email us at <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--primary)' }}>{CONTACT_EMAIL}</a>.
          </P>
        </Section>

        <Section title="2. Data we collect">
          <P><strong>Account data</strong> — when you register:</P>
          <UL items={[
            'Name, email address, phone number, and password (stored as a bcrypt hash — we never store plaintext passwords)',
            'Your phone number is private and used only to create and keep your Stripe billing customer accurate',
            'Professional role, title, organisation, skills, goals, and interests you provide during onboarding',
            'Profile photo URL (if you add one)',
            'Links to external profiles (GitHub, LinkedIn, Twitter, portfolio, etc.) that you optionally add',
          ]} />

          <P><strong>Content you create</strong> — posts, comments, and messages you send on the platform.</P>

          <P><strong>Usage data</strong> — standard server logs including IP address, browser user-agent, pages visited, and timestamps. We use this to operate and improve the service.</P>

          <P><strong>Social account tokens</strong> — if you connect a social platform (LinkedIn, Twitter/X, Instagram, or Facebook) via the Connected Accounts feature, we store the OAuth access token you authorise. This token is used only to fetch content relevant to your feed and is never shared with third parties.</P>

          <P><strong>Feed interactions</strong> — likes, saves, and clicks on posts. Used to personalise your feed.</P>
        </Section>

        <Section title="3. How we use your data">
          <UL items={[
            'To create and manage your account',
            'To personalise your content feed based on your role, interests, and skills',
            'To deliver communities, messaging, and opportunities relevant to you',
            'To fetch posts from connected social platforms on your behalf (using your OAuth token)',
            'To send transactional emails (password reset, account notifications) — no marketing without consent',
            <>To monitor platform health, prevent abuse, and enforce our <Link to="/terms" style={{ color: 'var(--primary)' }}>Terms of Service</Link></>,
            'To improve and develop new features',
          ]} />
          <P>We do not sell your personal data. We do not use your data for advertising.</P>
        </Section>

        <Section title="4. Content feed and third-party sources">
          <P>
            {APP_NAME} aggregates publicly available content from platforms including Reddit, Hacker News,
            GitHub, DEV.to, Medium, YouTube, Stack Overflow, Mastodon, Lobsters, arXiv, Indeed,
            Product Hunt, TechCrunch, The Verge, Indie Hackers, and Hashnode. This content is fetched
            via public APIs and RSS feeds and is attributed to its original source.
          </P>
          <P>
            We do not store third-party content permanently — posts are cached temporarily to reduce API
            load and improve performance. Original attribution links are always preserved.
          </P>
        </Section>

        <Section title="5. Connected social accounts (OAuth)">
          <P>
            The Connected Accounts feature lets you link LinkedIn, Twitter/X, Instagram, and Facebook
            to your {APP_NAME} profile via OAuth 2.0. When you connect a platform:
          </P>
          <UL items={[
            'You are redirected to that platform\'s official login page — we never see your social password',
            'You grant us a limited-scope access token (e.g. read-only access to your posts or feed)',
            'We store that token encrypted in our database and use it only to personalise your feed',
            'You can disconnect any platform at any time from your Profile → Connected Accounts page',
            'Disconnecting immediately removes the token from our systems',
          ]} />
        </Section>

        <Section title="6. Data sharing">
          <P>We share data only in the following limited circumstances:</P>
          <UL items={[
            'Service providers: our hosting provider (Render) and database (PostgreSQL on Render) process data to operate the platform. They are contractually bound to keep it confidential.',
            'Legal requirements: if required by law, court order, or to protect our rights and users\' safety.',
            'Business transfer: if UFIconnect is acquired or merges, data may transfer to the new entity under the same policy.',
          ]} />
          <P>We do not share your data with advertisers, data brokers, or analytics platforms.</P>
        </Section>

        <Section title="7. Cookies and local storage">
          <P>
            We use <strong>localStorage</strong> to store your authentication token (JWT) on your device.
            We use a <strong>service worker</strong> to cache app shell assets for faster load times.
            We do not use third-party tracking cookies or analytics cookies.
          </P>
          <P>
            You can clear your browser's localStorage and cache at any time through your browser settings.
            Doing so will log you out of {APP_NAME}.
          </P>
        </Section>

        <Section title="8. Data retention">
          <UL items={[
            'Account data: retained for as long as your account is active. Deleted within 30 days of account deletion request.',
            'Posts and messages: deleted with your account. Community posts visible to others may be anonymised rather than deleted.',
            'Feed cache: external posts are cached for up to 60 minutes and then evicted.',
            'Server logs: retained for up to 90 days for security and debugging.',
            'OAuth tokens: deleted immediately when you disconnect a social account.',
          ]} />
        </Section>

        <Section title="9. Your rights">
          <P>Depending on where you live, you may have the right to:</P>
          <UL items={[
            'Access the personal data we hold about you',
            'Correct inaccurate data',
            'Delete your account and associated data',
            'Export your data in a portable format',
            'Withdraw consent for optional data uses at any time',
            'Object to or restrict certain processing',
          ]} />
          <P>
            To exercise any of these rights, email us at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--primary)' }}>{CONTACT_EMAIL}</a>.
            We will respond within 30 days.
          </P>
        </Section>

        <Section title="10. Security">
          <P>
            We take reasonable technical and organisational measures to protect your data, including:
          </P>
          <UL items={[
            'Passwords hashed with bcrypt (never stored in plaintext)',
            'Authentication via short-lived JWT tokens (7-day expiry)',
            'HTTPS enforced on all connections',
            'Database access restricted to the application server',
            'OAuth tokens stored in a dedicated database column',
          ]} />
          <P>
            No system is 100% secure. If you discover a security vulnerability, please report it
            responsibly to <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--primary)' }}>{CONTACT_EMAIL}</a>.
          </P>
        </Section>

        <Section title="11. Children">
          <P>
            {APP_NAME} is not directed at children under 13 (or 16 in the EU). We do not knowingly
            collect personal data from children. If you believe a child has registered, contact us and
            we will delete the account promptly.
          </P>
        </Section>

        <Section title="12. Changes to this policy">
          <P>
            We may update this policy as the platform evolves. We will post the new version here with
            a revised effective date. For significant changes, we will notify you by email or an
            in-app notice at least 14 days before they take effect.
          </P>
        </Section>

        <Section title="13. Contact">
          <P>
            <strong>{APP_NAME}</strong><br />
            Email: <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--primary)' }}>{CONTACT_EMAIL}</a><br />
            Website: <a href={APP_URL} style={{ color: 'var(--primary)' }}>{APP_URL}</a>
          </P>
        </Section>

        {/* Footer links */}
        <div style={{
          marginTop: 48, paddingTop: 24, borderTop: '1px solid #E2E8F0',
          display: 'flex', gap: 24, flexWrap: 'wrap',
          fontSize: '.82rem', color: '#94A3B8',
        }}>
          <Link to="/"             style={{ color: '#64748B', textDecoration: 'none' }}>Home</Link>
          <Link to="/terms"        style={{ color: '#64748B', textDecoration: 'none' }}>Terms of Service</Link>
          <Link to="/child-safety" style={{ color: '#64748B', textDecoration: 'none' }}>Child Safety Standards</Link>
          <Link to="/login"        style={{ color: '#64748B', textDecoration: 'none' }}>Sign in</Link>
          <Link to="/register"     style={{ color: '#64748B', textDecoration: 'none' }}>Register</Link>
          <span>© {new Date().getFullYear()} {APP_NAME}</span>
        </div>
      </main>
    </>
  );
}
