import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

const EFFECTIVE_DATE = 'August 20, 2026';
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

export default function TermsOfService() {
  return (
    <>
      <Helmet>
        <title>Terms of Service — UFIconnect</title>
        <meta name="description" content="UFIconnect terms of service — the rules for using the platform." />
        <link rel="canonical" href="https://uficonnect.org/terms" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://uficonnect.org/terms" />
        <meta property="og:title" content="Terms of Service | UFIconnect" />
        <meta property="og:description" content="The rules for using UFIconnect." />
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
            Terms of Service
          </h1>
          <p style={{ color: '#64748B', fontSize: '.88rem' }}>
            Effective date: <strong>{EFFECTIVE_DATE}</strong> &nbsp;·&nbsp; Applies to {APP_URL}
          </p>
        </div>

        <Section title="1. Agreement to these terms">
          <P>
            These Terms of Service ("Terms") are an agreement between you and {APP_NAME} ("we", "us",
            or "our") governing your use of the platform at {APP_URL}, including the website, any
            associated apps, and all features offered through them (collectively, the "Service"). By
            creating an account or otherwise using the Service, you agree to these Terms. If you do not
            agree, do not use the Service.
          </P>
        </Section>

        <Section title="2. What the Service is">
          <P>
            {APP_NAME} is a professional networking platform: a personalised content feed, communities,
            direct messaging, and job/opportunity listings, built for engineers, designers, founders,
            and other professionals. The feed aggregates publicly available content from third-party
            sources (see Section 5) alongside content posted directly by members.
          </P>
        </Section>

        <Section title="3. Eligibility and accounts">
          <UL items={[
            'You must be at least 13 years old (16 in the EU) to use the Service.',
            'You must provide accurate information when registering and keep it up to date.',
            'You are responsible for maintaining the confidentiality of your password and for all activity under your account.',
            'One person may not maintain more than one account for deceptive or abusive purposes.',
            <>Notify us immediately at <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: 'var(--primary)' }}>{CONTACT_EMAIL}</a> if you suspect unauthorised use of your account.</>,
          ]} />
        </Section>

        <Section title="4. Your content">
          <P>
            You retain ownership of the posts, comments, messages, and other content you submit to the
            Service ("Your Content"). By posting Your Content, you grant {APP_NAME} a non-exclusive,
            worldwide, royalty-free licence to host, store, display, and distribute it as necessary to
            operate the Service (for example, showing your post to other members).
          </P>
          <P>You agree not to post content that:</P>
          <UL items={[
            'Is unlawful, defamatory, harassing, or infringes another person\'s rights',
            'Impersonates any person or entity, or misrepresents your affiliation with one',
            'Contains malware or is intended to disrupt the Service',
            'Is spam, or unauthorised commercial solicitation',
          ]} />
          <P>
            We may remove content or suspend accounts that violate these Terms, at our discretion, with
            or without notice.
          </P>
        </Section>

        <Section title="5. Third-party and aggregated content">
          <P>
            Much of the feed consists of publicly available content aggregated from third-party
            platforms (including Reddit, Hacker News, GitHub, DEV.to, Medium, YouTube, Stack Overflow,
            Mastodon, Bluesky, Lobsters, arXiv, Indeed, Product Hunt, TechCrunch, The Verge, and others),
            shown with attribution and a link back to its original source. We do not own this content,
            do not control it, and do not endorse the views expressed in it. Your use of any linked
            third-party site is governed by that site's own terms.
          </P>
          <P>UFIConnect uses YouTube API Services. By using its YouTube features, you agree to the <a href="https://www.youtube.com/t/terms" style={{ color: 'var(--primary)' }}>YouTube Terms of Service</a>. See our <Link to="/privacy" style={{ color: 'var(--primary)' }}>Privacy Policy</Link> for YouTube data use and connection controls.</P>
        </Section>

        <Section title="6. Connected accounts">
          <P>
            The Connected Accounts feature lets you optionally link third-party platforms (for example
            LinkedIn, Twitter/X, or Facebook) via that platform's official OAuth
            login. Doing so is subject to that platform's own terms of service in addition to these
            Terms. You can disconnect any linked platform at any time from Profile → Connected Accounts;
            see our <Link to="/privacy" style={{ color: 'var(--primary)' }}>Privacy Policy</Link> for
            how connected-account data is stored and used.
          </P>
        </Section>

        <Section title="7. Pro subscription and billing">
          <P>
            {APP_NAME} is free to join and use. We also offer an optional Pro subscription as a way to
            support the platform, purchased and managed through Stripe. If you subscribe:
          </P>
          <UL items={[
            'Billing is processed by Stripe; we never see or store your full card details.',
            'Subscriptions renew automatically until cancelled.',
            'You can cancel or manage your subscription at any time from Settings, which opens Stripe\'s billing portal.',
            'Fees are non-refundable except where required by law.',
          ]} />
        </Section>

        <Section title="8. Acceptable use">
          <P>You agree not to:</P>
          <UL items={[
            'Scrape, crawl, or use automated means to access the Service beyond normal use, without our written permission',
            'Attempt to gain unauthorised access to any part of the Service, other accounts, or our systems',
            'Interfere with or disrupt the Service, or introduce malicious code',
            'Use the Service to violate any applicable law',
            'Use another member\'s content or personal information outside the Service without their consent',
          ]} />
        </Section>

        <Section title="9. Intellectual property">
          <P>
            The {APP_NAME} name, logo, and the Service's software, design, and branding are owned by us
            or our licensors and are protected by intellectual property law. These Terms do not grant
            you any right to use our trademarks or branding without prior written consent.
          </P>
        </Section>

        <Section title="10. Termination">
          <P>
            You may stop using the Service and delete your account at any time from Settings. We may
            suspend or terminate your access to the Service if you violate these Terms, or at our
            discretion with reasonable notice where practical. Sections of these Terms that by their
            nature should survive termination (including Sections 4, 9, 11, and 12) will continue to
            apply.
          </P>
        </Section>

        <Section title="11. Disclaimers">
          <P>
            The Service is provided "as is" and "as available," without warranties of any kind, express
            or implied. We do not warrant that the Service will be uninterrupted, error-free, or
            completely secure. Aggregated third-party content is provided for informational purposes and
            we make no representation as to its accuracy.
          </P>
        </Section>

        <Section title="12. Limitation of liability">
          <P>
            To the fullest extent permitted by law, {APP_NAME} will not be liable for any indirect,
            incidental, special, consequential, or punitive damages arising from your use of, or
            inability to use, the Service. Our total liability for any claim relating to the Service is
            limited to the amount you paid us, if any, in the 12 months before the claim arose.
          </P>
        </Section>

        <Section title="13. Changes to these Terms">
          <P>
            We may update these Terms as the platform evolves. We will post the revised Terms here with
            an updated effective date. For material changes, we will make a reasonable effort to notify
            you by email or an in-app notice before they take effect. Continued use of the Service after
            a change takes effect constitutes acceptance of the revised Terms.
          </P>
        </Section>

        <Section title="14. Contact">
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
          <Link to="/privacy"      style={{ color: '#64748B', textDecoration: 'none' }}>Privacy Policy</Link>
          <Link to="/child-safety" style={{ color: '#64748B', textDecoration: 'none' }}>Child Safety Standards</Link>
          <Link to="/login"        style={{ color: '#64748B', textDecoration: 'none' }}>Sign in</Link>
          <Link to="/register"     style={{ color: '#64748B', textDecoration: 'none' }}>Register</Link>
          <span>© {new Date().getFullYear()} {APP_NAME}</span>
        </div>
      </main>
    </>
  );
}
