import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

const EFFECTIVE_DATE = 'September 30, 2026';
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

          <P><strong>Core service metrics and aggregate usage counts</strong> — these are always active. We count visits to general page and app-screen categories and measure request outcomes and service response times. These metrics do not store account IDs, visitor IDs, IP addresses, full page links, search terms, passwords, or message content. Counts represent views, not individual people. Hosting and security systems still process connection information, including IP addresses, to deliver and protect the service.</P>
          <P><strong>Optional performance insights</strong> — when enabled on your browser or app, we count general error categories to identify reliability problems. These reports exclude raw error messages, stack traces, account details, and personal content. You can turn future reporting off in Data and privacy settings.</P>

          <P><strong>Connected-account credentials</strong> — when you connect an available provider, such as YouTube or GitHub, we store the OAuth access token and any refresh token the provider issues. Our servers send these credentials to that provider to retrieve your connected content or perform actions you request. We never receive your provider password.</P>
          <P><strong>Creator analytics and copyright concerns</strong> — your private analytics page shows available authorized source metrics and your own UFIconnect activity. Separately authorized YouTube access can include channel analytics and estimated revenue. We keep source snapshots for one day, source-action request and audit records for 30 days, and copyright concerns, including your reason and original URL, for 90 days; expired records are removed during regular cleanup. Source snapshots stop displaying after 15 minutes until refreshed. Copyright concerns are stored for operator review and do not automatically send a legal notice or remove source content.</P>
          <P><strong>Activity insights and your browser Vault</strong> — when enabled, an experimental model analyzes your daily activity counts on our server. It does not use source engagement, revenue, message content, credentials, or device-verification records. Your browser Vault stores encrypted entries locally; its passwords, passphrase, and entry contents are excluded from telemetry and learning. Hardware device protection remains a separate prototype and does not protect the browser Vault.</P>
          <P><strong>VPN Connector labels</strong> — the optional paid connector saves device types, profile labels and country labels in your UFI account so you can access them on your devices. Do not enter credentials in these labels. This metadata is separate from your encrypted local Vault passwords, documents and keys. We do not receive VPN credentials, keys, traffic or browsing history. Saved labels are included in your account export and deleted with your account; you may also remove them individually, including after canceling. Local connection activity contains connect/disconnect request timestamps only and clears when the local companion stops.</P>
          <P><strong>Vault subscription and existing data</strong> — creating a new Vault or adding, editing and importing private items requires an active UFI Vault subscription when subscriptions become available. Your existing encrypted data remains accessible for unlocking, viewing, downloading, exporting, restoring and deletion even after cancellation or while checkout is unavailable. Billing status does not give UFI access to your Vault contents or passphrase.</P>

          <P><strong>Feed interactions</strong> — likes, saves, and clicks on posts. Used to personalise your feed.</P>
          <P><strong>Membership billing</strong> — Stripe hosts checkout and manages payment methods. We store Stripe customer and subscription references, membership status, and limited checkout and webhook records to confirm access and prevent duplicate processing. Card numbers and security codes are entered on Stripe’s website and are not stored by UFIConnect.</P>
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
            The Connected Accounts feature lets you link supported providers to your {APP_NAME}
            account through their official authorization flow. Availability depends on provider access and app approval. When you connect a platform:
          </P>
          <UL items={[
            'You are redirected to that platform\'s official login page — we never see your social password',
            'You choose the permissions shown by the provider; reading content and publishing interactions may require different permissions',
            'Connected-account tokens are encrypted before database storage and used for the connection you authorise',
            'You can disconnect any platform at any time from your Profile → Connected Accounts page',
            'Disconnecting removes the active connection credentials; backup copies follow the backup retention policy',
          ]} />
          <P><strong>Google and YouTube data</strong> — UFIConnect uses YouTube API Services. If you connect YouTube, read access lets us retrieve your channel subscriptions and recent videos from those channels, and your own channel and upload metadata. This includes video identifiers, titles, descriptions, thumbnail links, publication dates, durations, and available engagement counts. We use this information to display your connected feed and your own content. We do not download YouTube video files.</P>
          <P>If you separately authorize interaction permissions, we send a video rating or comment to YouTube when you select the corresponding action in UFIConnect. Comments and ratings are then subject to YouTube's visibility rules. Read-only authorization does not permit these writes. We do not request YouTube upload permission in the standard connection flow.</P>
          <P>Connection credentials are encrypted before database storage. Connected-feed metadata is cached on our servers to deliver the requested features. Render hosts these systems. Google and YouTube receive the API requests and any comments or ratings you ask us to send. Google user data is not sold or used for advertising. Our use and transfer of this data is limited to the authorized features and permitted security or legal purposes under the <a href="https://developers.google.com/terms/api-services-user-data-policy" style={{ color: 'var(--primary)' }}>Google API Services User Data Policy</a>, including its Limited Use requirements.</P>
          <P>Disconnect YouTube in Connected Accounts to remove active connection credentials and stop future authorized requests. You can also revoke UFIConnect's access through <a href="https://myaccount.google.com/connections" style={{ color: 'var(--primary)' }}>Google Account connections</a>. Disconnecting does not delete videos, comments, or ratings already on YouTube; manage those on YouTube. To request deletion of data held by UFIConnect, use Settings → Account or contact {CONTACT_EMAIL}. Backup retention is described below. Google's processing is covered by the <a href="https://policies.google.com/privacy" style={{ color: 'var(--primary)' }}>Google Privacy Policy</a>.</P>
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
          <P>Stripe processes payment details and the account information needed to manage your membership. You can review invoices, update payment methods, and cancel through Settings → Manage billing. Stripe’s handling of payment records is described in its <a href="https://stripe.com/privacy" style={{ color: 'var(--primary)' }}>privacy policy</a>.</P>
        </Section>

        <Section title="7. Cookies and local storage">
          <P>
            The web app keeps your sign-in token and private profile data in the current page's memory,
            not in localStorage or sessionStorage. A Secure, HttpOnly cookie lets the same saved browser restore a revocable local session without exposing the credential to page scripts. IP addresses are not used as account credentials;
            a connected sign-in provider may also restore access through its own session.
            The native mobile app stores its sign-in token using the operating system's secure storage.
          </P>
          <P>
            We use a service worker to cache public app assets. Browser storage may also hold non-sensitive
            display preferences. Private API responses are not cached by the service worker. We use
            core service metrics and aggregate usage counts without analytics cookies or visitor identifiers. Optional Google Analytics loads only after you accept it,
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
          <P>
            Data-saving and performance preferences are saved on this browser or app installation.
            They do not change your phone's cellular or roaming permissions. Data Saver reduces automatic
            media loading or background feed requests where supported; content you choose to open can
            still use data. Turning off optional analytics does not disable account security or the
            interactions needed for requested features, such as saving posts and personalising your feed.
          </P>
        </Section>

        <Section title="8. Data retention">
          <UL items={[
            'Account data: retained for as long as your account is active. Deleted within 30 days of account deletion request.',
            'Posts and messages: deleted with your account. Community posts visible to others may be anonymised rather than deleted.',
            'Feed cache: external posts are cached for up to 60 minutes and then evicted.',
            'Server logs: retained for up to 90 days for security and debugging.',
            'Aggregate page, app-screen, and optional performance counts: retained for 30 UTC calendar days. Request outcome and response-time counters reset when the server process restarts.',
            'OAuth tokens: active credentials are removed when you disconnect; retained backups follow the backup retention policy.',
          ]} />
        </Section>

        <Section title="9. Your rights">
          <P>Use Settings → Account to download your account data, correct your profile, or request account deletion. For other requests, contact the privacy address below. Do not send passwords or full payment-card details.</P>
          <P>We honor Global Privacy Control in supported browsers by keeping optional Google Analytics off, including when an earlier browser choice allowed it. You can review this in <Link to="/privacy#analytics" style={{ color: 'var(--primary)' }}>Analytics privacy</Link>. This does not disable security, login, or the aggregate service counts described above.</P>
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
            'Local sign-in sessions expire after 30 days and can be revoked from Security settings',
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
