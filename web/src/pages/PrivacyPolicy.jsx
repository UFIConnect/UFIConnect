import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

const EFFECTIVE_DATE = 'October 8, 2026';
const CONTACT_EMAIL  = 'privacy@uficonnect.org';
const APP_NAME       = 'UFIConnect';
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
        <title>Privacy Policy — UFIConnect</title>
        <meta name="description" content="UFIConnect privacy policy — how we collect, use, and protect your data." />
        <link rel="canonical" href="https://uficonnect.org/privacy" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://uficonnect.org/privacy" />
        <meta property="og:title" content="Privacy Policy | UFIConnect" />
        <meta property="og:description" content="How UFIConnect collects, uses, and protects your data." />
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
            {APP_NAME} ("we", "us", or "our") is a trade name operating in California, United States,
            and operates the platform at {APP_URL}. We provide a personalised feed, communities,
            messaging, job and recruiting tools, resume tools and a local encrypted Vault.
            This policy explains what personal data we collect, why we collect it,
            and how you can control it.
          </P>
          <P>
            Questions? Email us at <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--primary)' }}>{CONTACT_EMAIL}</a>.
          </P>
        </Section>

        <Section title="2. Data we collect">
          <P><strong>Nearby recommendations</strong> use device location after you allow the browser's location permission. Coordinates are rounded to about 100 metres and used to prioritize posts within 100 miles. They stay in the current signed-in session and feed request; we do not save them to your profile or send them to advertising or analytics providers. Automatic location is required for signed-in feeds. If device access is denied or unavailable, approximate city or country information from your network satisfies this requirement. If neither is available, the feed pauses until an automatic location can be detected. You can revoke device access in your browser's site permissions and still use your profile, settings and privacy pages.</P>
          <P>City lookup runs on UFIConnect using adapted <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a> data under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>. City labels and IP location are approximate. Source posts without reliable location information can still appear in your personalized feed.</P>
          <P><strong>Account data</strong> — when you register:</P>
          <UL items={[
            'Name, email address, phone number, and password (stored as a bcrypt hash — we never store plaintext passwords)',
            'Your phone number is private and used only to create and keep your Stripe billing customer accurate',
            'Professional role, title, organisation, skills, goals, and interests you provide during onboarding',
            'Profile photo URL (if you add one)',
            'Links to external profiles (GitHub, LinkedIn, Twitter, portfolio, etc.) that you optionally add',
          ]} />

          <P><strong>Content you create</strong> — posts, comments, and messages you send on the platform.</P>
          <P><strong>Imported app pages</strong> — Vault uses the website address in an imported password to identify an app locally. Passwords and usernames are not sent to that app or to our server to load its actions. With a separate connected-account authorization, supported app pages can read GitHub stars and recent account activity, Mastodon bookmarks, YouTube playlists, or Twitch followed channels. Results are private to the authorizing user and held on the current page; leaving or locking Vault clears them. Source activity can arrange available actions, but we do not infer navigation history that an API does not provide. Vault pages and their imported account details are excluded from optional analytics.</P>
          <P><strong>Work and AI tools</strong> — resumes, draft content and prompts you choose to submit are processed to provide the requested feature. Where a tool uses an external AI provider, the submitted content is sent to that provider for generation or safety screening. The configured generation and screening services can include OpenAI. Avoid including information about other people that you are not entitled to share. Connected Google account data and local Vault contents are not used to train general-purpose AI models.</P>
          <P><strong>Reports and correspondence</strong> — when you report content or contact support, we receive your account or contact information, the affected links, your explanation, and related review correspondence. Formal copyright notices and counter-notices can require additional contact details. See our <Link to="/copyright" style={{ color: 'var(--primary)' }}>copyright process</Link>.</P>

          <P><strong>Snaps</strong> — photo and video Snaps can be public or followers-only, subject to your profile visibility and blocks. They stop displaying after 24 hours or when you delete them. Scheduled cleanup removes their uploaded media and clears captions and links; failed cleanup retries. A small cleanup record remains for seven days to prevent reuse of a deleted upload. Your account export includes your Snaps, and deleting your account schedules removal of their uploaded media.</P>
          <P><strong>Core service metrics and aggregate usage counts</strong> — these are always active. We count visits to general page and app-screen categories and measure request outcomes and service response times. These metrics do not store account IDs, visitor IDs, IP addresses, full page links, search terms, passwords, or message content. Counts represent views, not individual people. Hosting and security systems still process connection information, including IP addresses, to deliver and protect the service.</P>
          <P><strong>Optional performance insights</strong> — when enabled on your browser or app, we count general error categories to identify reliability problems. These reports exclude raw error messages, stack traces, account details, and personal content. You can turn future reporting off in Data and privacy settings.</P>

          <P><strong>Connected-account credentials</strong> — when you connect an available provider, such as YouTube or GitHub, we store the OAuth access token and any refresh token the provider issues. Our servers send these credentials to that provider to retrieve your connected content or perform actions you request. We never receive your provider password.</P>
          <P><strong>Connected notifications and messages</strong> — supported inbox connections retrieve your private notifications, recent conversations, message text, participants and timestamps using the permissions you grant. These appear only in your signed-in inbox and are not added to public feeds. Source responses are temporarily cached in server memory; message bodies are not saved to our inbox database. We store opaque item identifiers and read timestamps to remember what you have viewed in UFIConnect. Those read records are included in your account export and removed when your account is deleted. Reading an imported item here does not mark it read on the source service. Open the source to reply, view older messages or manage its read status. Disconnecting stops further authorized retrieval and display. Temporary server caches expire automatically.</P>
          <P><strong>Creator analytics and copyright concerns</strong> — your private analytics page shows available authorized source metrics and your own UFIConnect activity. Separately authorized YouTube access can include channel analytics and estimated revenue. We keep source snapshots for one day, source-action request and audit records for 30 days, and copyright concerns, including your reason and original URL, for 90 days; expired records are removed during regular cleanup. Source snapshots stop displaying after 15 minutes until refreshed. Copyright concerns are stored for operator review and do not automatically send a legal notice or remove source content.</P>
          <P><strong>Activity insights and your browser Vault</strong> — when enabled, an experimental model analyzes your daily activity counts on our server. It does not use source engagement, revenue, message content, credentials, or device-verification records. Your browser Vault stores encrypted entries locally; its passwords, passphrase, and entry contents are excluded from telemetry and learning. Hardware device protection remains a separate prototype and does not protect the browser Vault.</P>
          <P><strong>VPN devices and connections</strong> — we store your account ID, device label and public key, assigned tunnel address, gateway, registration type and time, authorization expiry and revocation state. We use these records to authenticate devices, verify membership, provide the requested connection, and honor revocation, export and deletion. Private keys are generated on your device and never sent to our API. Native clients keep their keys in protected local storage. When you request a WireGuard profile, your browser places the private key in the configuration file you download and import into WireGuard. Keep that file private and delete the downloaded copy after import. Profile registrations remain available until you revoke them or account security changes invalidate them; a connection requires verified paid access. Signing out of the website does not disconnect an imported profile. Use WireGuard to disconnect or revoke the profile in UFIConnect. Device records remain until account deletion and are included in your account export. This metadata is separate from your encrypted local Vault passwords, documents and keys.</P>
          <P><strong>VPN privacy commitment</strong> — we do not sell VPN user data, use it for advertising, profiling or AI training, or disclose it to third parties for their own purposes. VPN screens and connection activity are excluded from app analytics. Render hosts the account API and database; Hetzner hosts the VPN gateway. These providers process the information needed to operate the service. The gateway forwards your network traffic and DNS requests; our supplied configuration does not log DNS queries or browsing activity. Network and hosting operators still process connection information. The separate browser analytics and advertising choices described in this policy do not permit collection of VPN data.</P>
          <P><strong>Vault subscription and existing data</strong> — creating a new Vault or adding, editing and importing private items requires an active UFI Vault subscription. Your existing encrypted data remains accessible for unlocking, viewing, downloading, exporting, restoring and deletion even after cancellation or while checkout is unavailable. Billing status does not give UFI access to your Vault contents or passphrase.</P>

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
          <P>We do not sell your personal data. With your separate advertising consent, the Google Ads tag measures signed-out visits to the public homepage and ad click attribution. We do not use your account content or connected Google user data for advertising or enable ad personalization.</P>
        </Section>

        <Section title="4. Content feed and third-party sources">
          <P>
            {APP_NAME} displays content from available public APIs, feeds and supported connections,
            with source attribution. Available sources and permissions can change. Opening a source
            link or loading embedded media connects your browser to that provider, which can receive
            your IP address, device information and its own cookies under its privacy policy.
          </P>
          <P>
            Public feed metadata is cached and may be archived to support the feed. Refresh intervals
            differ from storage retention periods. See the{' '}
            <Link to="/policies#retention" style={{ color: 'var(--primary)' }}>retention schedule</Link>
            {' '}for the active cache and archive lifecycle. Source links identify the original content.
          </P>
        </Section>

        <Section title="5. Connected social accounts (OAuth)">
          <P><strong>Provider sign-in</strong> — when configured, UFIConnect uses Auth0 to offer sign-in through supported identity providers, which can include Google. Auth0 and the selected provider handle authentication; UFIConnect receives the identity information needed to create or recognize your account, such as a provider identifier, name, email address and profile picture. We do not receive your provider password. Signing in does not itself grant access to your YouTube subscriptions, channel analytics or publishing actions; those features require separate authorization.</P>
          <P>
            The Connected Accounts feature lets you link supported providers to your {APP_NAME}
            account through their official authorization flow. Availability depends on provider access and app approval. When you connect a platform:
          </P>
          <UL items={[
            'You are redirected to that platform\'s official login page — we never see your social password',
            'You choose the permissions shown by the provider; reading content and publishing interactions may require different permissions',
            'Connected-account tokens are encrypted before database storage and used for the connection you authorise',
            'You can disconnect any platform at any time from your Profile → Connected Accounts page',
            'Disconnecting removes the active connection credentials; hosting backups have separate retention settings',
          ]} />
          <P><strong>Google and YouTube data</strong> — UFIConnect uses YouTube API Services. If you connect YouTube, read access lets us retrieve your channel subscriptions and recent videos from those channels, and your own channel and upload metadata. This includes video identifiers, titles, descriptions, thumbnail links, publication dates, durations, and available engagement counts. We use this information to display your connected feed and your own content. When you open your YouTube app collection, we can also read your channel identity and playlist metadata to display your playlists privately. We do not retrieve Watch Later, external viewing history, or download YouTube video files.</P>
          <P>If you separately authorize interaction permissions, we send a video rating or comment to YouTube when you select the corresponding action in UFIConnect. Comments and ratings are then subject to YouTube's visibility rules. Read-only authorization does not permit these writes. We do not request YouTube upload permission in the standard connection flow.</P>
          <P>Connection credentials are encrypted before database storage. Connected-feed metadata is cached on our servers to deliver the requested features. Render hosts these systems. Google and YouTube receive the API requests and any comments or ratings you ask us to send. Google user data is not sold, used for advertising, or used to train general-purpose AI models. UFIConnect does not use Google APIs to create non-consensual intimate imagery. Our use and transfer of Google user data is limited to the authorized features and permitted security or legal purposes under the <a href="https://developers.google.com/terms/api-services-user-data-policy" style={{ color: 'var(--primary)' }}>Google API Services User Data Policy</a>, including its Limited Use requirements.</P>
          <P>Disconnect YouTube in Connected Accounts to remove active connection credentials and stop future authorized requests. You can also revoke UFIConnect's access through <a href="https://myaccount.google.com/connections" style={{ color: 'var(--primary)' }}>Google Account connections</a>. Disconnecting does not delete videos, comments, or ratings already on YouTube; manage those on YouTube. To request deletion of data held by UFIConnect, use Settings → Account or contact {CONTACT_EMAIL}. Backup retention is described below. Google's processing is covered by the <a href="https://policies.google.com/privacy" style={{ color: 'var(--primary)' }}>Google Privacy Policy</a>.</P>
        </Section>

        <Section title="6. Data sharing">
          <P>We share data only in the following limited circumstances:</P>
          <UL items={[
            'Service providers: our hosting provider (Render) and database (PostgreSQL on Render) process data to operate the platform. Auth0 processes provider sign-in when configured. Email delivery, payment and configured AI providers process the information needed for their requested functions.',
            'Optional analytics: if you accept analytics in a browser, Google Analytics receives generic page categories, a random analytics identifier, and basic browser/device information. Google receives your IP address when your browser connects. We do not send passwords, messages, account details, search terms, or your full page links to Google Analytics.',
            'Legal requirements: if required by law, court order, or to protect our rights and users\' safety.',
            'Business transfer: a change in ownership may involve a data transfer subject to applicable law, required notice and consent, and provider restrictions. Connected Google user data remains subject to Google’s Limited Use requirements.',
          ]} />
          <P>Google Analytics keeps advertising storage, Google signals, advertising personalisation, and advertising user data disabled. Separately, after advertising consent, the Google Ads tag loads only on the signed-out public homepage to measure visits and attribute ad clicks. Google receives your IP address, browser/device information and permitted ad click identifiers, and uses cookies for attribution. Private page links and account content are excluded from the conversion event.</P>
          <P>You can change analytics and advertising separately through <Link to="/privacy#analytics" style={{ color: 'var(--primary)' }}>Analytics privacy</Link> or Settings. Global Privacy Control keeps both optional integrations off, including when an earlier choice allowed collection.</P>
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
          <P>Your advertising choice is stored separately in this browser. Advertising consent permits Google attribution cookies on the public homepage. Withdrawing it stops future Ads collection by this integration and clears its first-party attribution storage. It does not delete records already processed by Google. Google’s own cookie lifetimes and processing are described in its <a href="https://policies.google.com/technologies/cookies" style={{ color: 'var(--primary)' }}>cookie information</a>.</P>
        </Section>

        <Section title="8. Data retention">
          <UL items={[
            'Account data and member content: retained to provide your account. Successful account deletion removes your account and associated records from active application storage, including authored posts, comments and account-linked messages. Shared communities and other members’ content remain.',
            'Public feed cache: live items are generally subject to 8- or 20-day age limits by source volume and type, and an archive with a configurable age limit of 30 days by default. Count limits and source requirements can remove items sooner.',
            'Hosting logs, backups and payment-provider records have separate retention settings and legal obligations. A successful account deletion does not erase every provider record or backup immediately.',
            'Aggregate page, app-screen, and optional performance counts: retained for 30 UTC calendar days. Request outcome and response-time counters reset when the server process restarts.',
            'OAuth tokens: active credentials are removed when you disconnect; backup copies follow the hosting service’s separate retention settings.',
            'Local Vault data and downloaded exports remain on your device until you remove them. Account deletion cannot remotely erase these copies.',
          ]} />
          <P>The <Link to="/policies#retention" style={{ color: 'var(--primary)' }}>data retention and deletion schedule</Link> also covers source metrics, action records and copyright concerns. A safety report, formal complaint or legal preservation request may require separate handling. Contact privacy support for requests involving retained records or provider copies.</P>
        </Section>

        <Section title="9. Your rights">
          <P>Use Settings → Account to download your account data, correct your profile, or request account deletion. For other requests, contact the privacy address below. Do not send passwords or full payment-card details.</P>
          <P>We honor Global Privacy Control in supported browsers by keeping optional Google Analytics and Google Ads off, including when an earlier browser choice allowed them. You can review this in <Link to="/privacy#analytics" style={{ color: 'var(--primary)' }}>Analytics privacy</Link>. This does not disable security, login, or the aggregate service counts described above.</P>
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
            We may ask for information reasonably needed to verify your request and will handle it
            within the time required by applicable law. An authorized agent may contact us on your
            behalf with evidence of authority. Do not send identity documents unless requested securely.
          </P>
          <P>Where California privacy law applies, rights can include knowing, accessing, correcting and deleting personal information, opting out of sale or sharing, limiting certain uses of sensitive information, and exercising rights without unlawful discrimination. Contact privacy support or use the controls above. See the <a href="https://oag.ca.gov/privacy/ccpa" style={{ color: 'var(--primary)' }}>California Attorney General’s privacy rights information</a>.</P>
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
            {APP_NAME} is not directed at children under 13, or under 16 in the EU, EEA and UK.
            Users must meet any higher minimum age required where they live. We do not knowingly
            collect personal information from users below these ages. If you believe an underage
            account exists, contact us so we can investigate and take appropriate deletion steps.
            Our <Link to="/child-safety" style={{ color: 'var(--primary)' }}>Child Safety Standards</Link>
            {' '}explain how to report concerns.
          </P>
        </Section>

        <Section title="12. Changes to this policy">
          <P>
            We may update this policy as the platform evolves. We will post the new version here with
            a revised effective date. Material changes will receive notice and, where required,
            renewed consent before a new use of personal information begins.
          </P>
        </Section>

        <Section title="13. Contact">
          <P>
            <strong>{APP_NAME}</strong><br />
            California, United States<br />
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
          <Link to="/policies"     style={{ color: '#64748B', textDecoration: 'none' }}>Policies and safety</Link>
          <Link to="/copyright"    style={{ color: '#64748B', textDecoration: 'none' }}>Copyright</Link>
          <Link to="/child-safety" style={{ color: '#64748B', textDecoration: 'none' }}>Child Safety Standards</Link>
          <Link to="/login"        style={{ color: '#64748B', textDecoration: 'none' }}>Sign in</Link>
          <Link to="/register"     style={{ color: '#64748B', textDecoration: 'none' }}>Register</Link>
          <span>© {new Date().getFullYear()} {APP_NAME}</span>
        </div>
      </main>
    </>
  );
}
