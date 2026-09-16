import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

const EFFECTIVE_DATE = 'September 15, 2026';
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
            'Connected-account tokens are encrypted before database storage and used for the connection you authorise',
            'You can disconnect any platform at any time from your Profile → Connected Accounts page',
            'Disconnecting removes the active connection credentials; backup copies follow the backup retention policy',
          ]} />
        </Section>

        <Section title="6. Data sharing">
          <P>We share data only in the following limited circumstances:</P>
          <UL items={[
            'Service providers: our hosting provider (Render) and database (PostgreSQL on Render) process data to operate the platform. They are contractually bound to keep it confidential.',
            'Optional analytics: if you accept analytics in a browser, Google Analytics receives generic page categories, a random analytics identifier, and basic browser/device information. Google receives your IP address when your browser connects. We do not send passwords, messages, account details, search terms, or your full page links to Google Analytics.',
            'Legal requirements: if required by law, court order, or to protect our rights and users\' safety.',
            'Business transfer: if UFIconnect is acquired or merges, data may transfer to the new entity under the same policy.',
          ]} />
          <P>Our analytics integration disables advertising storage, Google signals, advertising personalisation, and advertising user data.</P>
        </Section>

        <Section title="7. Cookies and local storage">
          <P>
            The web app keeps your sign-in token and private profile data in the current page's memory,
            not in localStorage or sessionStorage. Reloading or closing the page ends the local session;
            a connected sign-in provider may restore access through its own session.
            The native mobile app stores its sign-in token using the operating system's secure storage.
          </P>
          <P>
            We use a service worker to cache public app assets. Browser storage may also hold non-sensitive
            display preferences. Private API responses are not cached by the service worker. We use
            first-party operational analytics. Optional Google Analytics loads only after you accept it,
            inside a separate document that cannot read the app's contents.
          </P>
          <P>
            Your analytics choice is saved in this browser until you change it or clear browser storage.
            If you accept, a separate random analytics identifier is stored for up to 30 days, with
            session analytics cookies scoped to the analytics document. Use Analytics privacy
            (Analytics preferences in the browser version of the mobile app) to decline at any time.
            Declining stops future Google collection and clears this integration's local analytics
            identifier and cookies. It does not delete previously collected reports from Google.
            Standalone iOS and Android builds currently do not collect Google Analytics.
          </P>
        </Section>

        <Section title="8. Data retention">
          <UL items={[
            'Account data: retained for as long as your account is active. Deleted within 30 days of account deletion request.',
            'Posts and messages: deleted with your account. Community posts visible to others may be anonymised rather than deleted.',
            'Feed cache: external posts are cached for up to 60 minutes and then evicted.',
            'Server logs: retained for up to 90 days for security and debugging.',
            'OAuth tokens: active credentials are removed when you disconnect; retained backups follow the backup retention policy.',
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
            'Local sign-in sessions expire after 12 hours and can be revoked from Security settings',
            'Changing or resetting a local password invalidates existing local sign-in sessions',
            'Password-reset links expire, work once, and cannot be used as sign-in tokens',
            'Public production connections require HTTPS; database TLS certificates are verified by default',
            'Connected-account tokens are encrypted before persistence; passwords and sign-in tokens are excluded from public profiles',
          ]} />
          <P>
            Password fields are hidden by default. You can choose Show to check what you entered;
            leaving the field or submitting hides it again. Copy protection remains active while
            the password is visible. Password-manager autofill and pasting remain available.
            We check new passwords against a local list of common passwords without sending them
            to a password-checking service. These controls cannot protect a password that you independently
            copy into another app or a device that is already compromised.
          </P>
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
